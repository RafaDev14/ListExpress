// Modelo de datos para ListExpress
// Soporta planificación previa (precios web/estimados) y compras en vivo (precios reales en góndola)

let products = (function initProducts() {
    try {
        const stored = JSON.parse(localStorage.getItem('products')) || [];
        // Migración suave de datos antiguos
        return stored.map((item, idx) => {
            const price = parseFloat(item.price) || 0;
            const estimated = item.estimatedPrice !== undefined ? parseFloat(item.estimatedPrice) : price;
            const real = item.realPrice !== undefined ? parseFloat(item.realPrice) : estimated;
            return {
                id: item.id || `prod_${Date.now()}_${idx}`,
                name: (item.name || '').trim(),
                quantity: parseInt(item.quantity, 10) || 1,
                estimatedPrice: estimated,
                realPrice: real,
                price: item.inCart ? real : estimated, // compatibilidad
                inCart: Boolean(item.inCart),
                priceOverridden: Boolean(item.priceOverridden),
                createdAt: item.createdAt || new Date().toISOString()
            };
        });
    } catch (e) {
        console.error('Error al inicializar productos:', e);
        return [];
    }
})();

function saveProducts() {
    localStorage.setItem('products', JSON.stringify(products));
}

// Catálogo histórico de productos frecuentes para autocompletado inteligente
function getCatalog() {
    try {
        return JSON.parse(localStorage.getItem('productCatalog')) || [];
    } catch (e) {
        return [];
    }
}

function saveToCatalog(name, price) {
    if (!name || !name.trim()) return;
    const cleanName = name.trim();
    const catalog = getCatalog();
    const existingIndex = catalog.findIndex(item => item.name.toLowerCase() === cleanName.toLowerCase());
    
    if (existingIndex >= 0) {
        catalog[existingIndex].lastPrice = parseFloat(price) || catalog[existingIndex].lastPrice || 0;
        catalog[existingIndex].useCount = (catalog[existingIndex].useCount || 1) + 1;
        catalog[existingIndex].lastUsed = new Date().toISOString();
    } else {
        catalog.push({
            name: cleanName,
            lastPrice: parseFloat(price) || 0,
            useCount: 1,
            lastUsed: new Date().toISOString()
        });
    }
    // Mantener hasta 200 productos frecuentes ordenados por uso
    catalog.sort((a, b) => (b.useCount || 0) - (a.useCount || 0));
    localStorage.setItem('productCatalog', JSON.stringify(catalog.slice(0, 200)));
}

/**
 * Agrega un nuevo producto
 * @param {string} name 
 * @param {number} quantity 
 * @param {number} price Precio inicial/estimado
 * @param {Object} options Opciones adicionales { inCart, realPrice, priceOverridden }
 */
function addProduct(name, quantity, price, options = {}) {
    const qty = parseInt(quantity, 10) || 1;
    const estPrice = parseFloat(price) || 0;
    const realPrice = options.realPrice !== undefined ? parseFloat(options.realPrice) : estPrice;
    const inCart = Boolean(options.inCart);
    const priceOverridden = Boolean(options.priceOverridden);

    const product = {
        id: `prod_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
        name: (name || '').trim(),
        quantity: qty,
        estimatedPrice: estPrice,
        realPrice: realPrice,
        price: inCart ? realPrice : estPrice,
        inCart: inCart,
        priceOverridden: priceOverridden,
        createdAt: new Date().toISOString()
    };

    products.push(product);
    saveProducts();
    saveToCatalog(product.name, estPrice > 0 ? estPrice : realPrice);
    return product;
}

function getProducts() {
    return products;
}

function getProductById(id) {
    return products.find(p => p.id === id);
}

function updateProduct(index, name, quantity, price, extra = {}) {
    if (index < 0 || index >= products.length) return;
    const current = products[index];
    const qty = parseInt(quantity, 10) || 1;
    const estPrice = price !== undefined ? parseFloat(price) : current.estimatedPrice;
    const realPrice = extra.realPrice !== undefined ? parseFloat(extra.realPrice) : (current.realPrice || estPrice);

    products[index] = {
        ...current,
        name: (name || current.name).trim(),
        quantity: qty,
        estimatedPrice: estPrice,
        realPrice: realPrice,
        price: current.inCart ? realPrice : estPrice,
        priceOverridden: extra.priceOverridden !== undefined ? extra.priceOverridden : current.priceOverridden,
        inCart: extra.inCart !== undefined ? extra.inCart : current.inCart
    };
    saveProducts();
    saveToCatalog(products[index].name, realPrice > 0 ? realPrice : estPrice);
}

function deleteProduct(index) {
    if (index >= 0 && index < products.length) {
        products.splice(index, 1);
        saveProducts();
    }
}

function deleteProductById(id) {
    const idx = products.findIndex(p => p.id === id);
    if (idx >= 0) {
        deleteProduct(idx);
    }
}

/**
 * Alterna el estado en carrito de un producto
 * @param {number|string} identifier Índice o ID del producto
 * @param {number|null} newRealPrice Precio real confirmado en góndola (opcional)
 */
function toggleProductInCart(identifier, newRealPrice = null) {
    let index = typeof identifier === 'number' ? identifier : products.findIndex(p => p.id === identifier);
    if (index < 0 || index >= products.length) return null;

    const p = products[index];
    p.inCart = !p.inCart;

    if (newRealPrice !== null && !isNaN(parseFloat(newRealPrice))) {
        const parsedNew = parseFloat(newRealPrice);
        if (parsedNew !== p.estimatedPrice) {
            p.realPrice = parsedNew;
            p.priceOverridden = true;
        } else {
            p.realPrice = parsedNew;
            p.priceOverridden = false;
        }
    } else if (p.inCart && (!p.realPrice || p.realPrice === 0)) {
        p.realPrice = p.estimatedPrice;
    }

    p.price = p.inCart ? p.realPrice : p.estimatedPrice;
    saveProducts();
    return p;
}

/**
 * Ajusta únicamente el precio real en góndola
 */
function setProductRealPrice(identifier, realPrice) {
    let index = typeof identifier === 'number' ? identifier : products.findIndex(p => p.id === identifier);
    if (index < 0 || index >= products.length) return null;

    const p = products[index];
    const parsed = parseFloat(realPrice) || 0;
    p.realPrice = parsed;
    p.priceOverridden = (parsed !== p.estimatedPrice);
    p.inCart = true; // si ajusta precio real, se entiende que lo tiene en mano en el carrito
    p.price = p.realPrice;
    saveProducts();
    return p;
}

/**
 * Cambia la cantidad rápidamente (+1, -1)
 */
function changeQuantity(identifier, delta) {
    let index = typeof identifier === 'number' ? identifier : products.findIndex(p => p.id === identifier);
    if (index < 0 || index >= products.length) return null;

    const p = products[index];
    const newQty = (p.quantity || 1) + delta;
    if (newQty > 0) {
        p.quantity = newQty;
        saveProducts();
        return p;
    } else {
        // Si baja a 0, se elimina
        deleteProduct(index);
        return null;
    }
}

/**
 * Limpia todos los productos que ya fueron comprados
 */
function clearPurchasedProducts() {
    products = products.filter(p => !p.inCart);
    saveProducts();
}

/**
 * Vacía la lista completa
 */
function clearAllProducts() {
    products = [];
    saveProducts();
}

/**
 * Calcula todas las métricas de resumen
 */
function getSummaryMetrics() {
    const totalItems = products.length;
    const inCartItems = products.filter(p => p.inCart).length;
    const pendingItems = totalItems - inCartItems;

    // Presupuesto planeado (suma de todos los productos a precio estimado)
    const estimatedBudget = products.reduce((acc, p) => acc + ((p.estimatedPrice || 0) * (p.quantity || 1)), 0);

    // Lo que ya está dentro del carrito físico (lo que pagarías ahora en caja)
    const currentCartTotal = products
        .filter(p => p.inCart)
        .reduce((acc, p) => {
            const priceToUse = (p.realPrice !== undefined && p.realPrice !== null) ? p.realPrice : p.estimatedPrice;
            return acc + ((priceToUse || 0) * (p.quantity || 1));
        }, 0);

    // Total proyectado al terminar todo el súper (ítems en carrito a precio real + ítems pendientes a precio estimado)
    const projectedTotal = products.reduce((acc, p) => {
        const priceToUse = p.inCart ? (p.realPrice || p.estimatedPrice) : (p.estimatedPrice || 0);
        return acc + ((priceToUse || 0) * (p.quantity || 1));
    }, 0);

    // Variación con respecto al presupuesto inicial
    const diff = projectedTotal - estimatedBudget;

    return {
        totalItems,
        inCartItems,
        pendingItems,
        estimatedBudget: Number(estimatedBudget.toFixed(2)),
        currentCartTotal: Number(currentCartTotal.toFixed(2)),
        projectedTotal: Number(projectedTotal.toFixed(2)),
        diff: Number(diff.toFixed(2)),
        progressPercent: totalItems > 0 ? Math.round((inCartItems / totalItems) * 100) : 0
    };
}
