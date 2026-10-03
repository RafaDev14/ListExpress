// Controlador principal de ListExpress
// Gestiona el Modo Compra en Vivo, Modo Planificación, Escaneo OCR y Dictado por Voz

let currentTab = 'shopping'; // 'shopping' | 'planning' | 'summary'
let currentFilter = 'all';    // 'all' | 'pending' | 'incart'
let activePriceEditId = null;

// Inicialización
document.addEventListener('DOMContentLoaded', () => {
    initServiceWorker();
    setupEventListeners();
    populateCatalogDatalist();
    renderApp();
});

function initServiceWorker() {
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('./sw.js')
            .then(reg => console.log('Service Worker registrado correctamente'))
            .catch(err => console.warn('Fallo al registrar Service Worker:', err));
    }
}

function setupEventListeners() {
    // Escáner OCR de Etiquetas con Cámara
    const cameraInput = document.getElementById('cameraFileInput');
    if (cameraInput) {
        cameraInput.addEventListener('change', async (e) => {
            const file = e.target.files && e.target.files[0];
            if (!file) return;
            await processTagImage(file);
            e.target.value = ''; // Resetear input
        });
    }

    // Modal de Precio Rápido - Form submit
    const priceForm = document.getElementById('priceOverrideForm');
    if (priceForm) {
        priceForm.addEventListener('submit', (e) => {
            e.preventDefault();
            savePriceOverrideFromModal();
        });
    }

    // Formulario de Agregar / Planificar Producto
    const quickAddForm = document.getElementById('quickAddForm');
    if (quickAddForm) {
        quickAddForm.addEventListener('submit', (e) => {
            e.preventDefault();
            submitQuickAdd();
        });
    }

    // Input en tiempo real para importación masiva (escucha input, paste, keyup, change)
    const bulkTextarea = document.getElementById('bulkImportTextarea');
    if (bulkTextarea) {
        ['input', 'paste', 'keyup', 'change'].forEach(evt => {
            bulkTextarea.addEventListener(evt, () => {
                setTimeout(updateBulkImportPreview, 20);
            });
        });
    }
}

// ==========================================
// RENDERIZADO PRINCIPAL
// ==========================================

function switchTab(tab) {
    currentTab = tab;
    // Actualizar botones de pestañas
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.tab === tab);
    });

    // Mostrar sección correspondiente
    document.querySelectorAll('.tab-pane').forEach(pane => {
        pane.classList.toggle('d-none', pane.id !== `tab-${tab}`);
    });

    renderApp();
}

function setFilter(filter) {
    currentFilter = filter;
    document.querySelectorAll('.filter-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.filter === filter);
    });
    renderShoppingList();
}

function renderApp() {
    renderHeaderSummary();
    if (currentTab === 'shopping') {
        renderShoppingList();
    } else if (currentTab === 'planning') {
        renderPlanningList();
    } else if (currentTab === 'summary') {
        renderSummaryView();
    }
}

/**
 * Renderiza el Resumen Sticky superior (Totales, Carrito vs Presupuesto, Ahorro/Diferencia)
 */
function renderHeaderSummary() {
    const metrics = getSummaryMetrics();

    const cartTotalEl = document.getElementById('headerCartTotal');
    const budgetTotalEl = document.getElementById('headerBudgetTotal');
    const diffBadgeEl = document.getElementById('headerDiffBadge');
    const progressTextEl = document.getElementById('headerProgressText');
    const progressBarEl = document.getElementById('headerProgressBar');

    if (cartTotalEl) cartTotalEl.textContent = `S/ ${metrics.currentCartTotal.toFixed(2)}`;
    if (budgetTotalEl) budgetTotalEl.textContent = `S/ ${metrics.estimatedBudget.toFixed(2)}`;
    
    if (progressTextEl) {
        progressTextEl.textContent = `${metrics.inCartItems} de ${metrics.totalItems} en carrito`;
    }
    if (progressBarEl) {
        progressBarEl.style.width = `${metrics.progressPercent}%`;
        progressBarEl.setAttribute('aria-valuenow', metrics.progressPercent);
    }

    if (diffBadgeEl) {
        if (metrics.totalItems === 0) {
            diffBadgeEl.className = 'badge badge-secondary p-1';
            diffBadgeEl.innerHTML = '<i class="fas fa-check"></i> Sin productos';
        } else if (metrics.diff < -0.05) {
            diffBadgeEl.className = 'badge badge-success p-1';
            diffBadgeEl.innerHTML = `<i class="fas fa-arrow-down"></i> Ahorraste S/ ${Math.abs(metrics.diff).toFixed(2)}`;
        } else if (metrics.diff > 0.05) {
            diffBadgeEl.className = 'badge badge-warning text-dark p-1';
            diffBadgeEl.innerHTML = `<i class="fas fa-arrow-up"></i> +S/ ${metrics.diff.toFixed(2)} sobre web`;
        } else {
            diffBadgeEl.className = 'badge badge-info p-1';
            diffBadgeEl.innerHTML = '<i class="fas fa-equals"></i> Igual a lo estimado';
        }
    }
}

/**
 * Renderiza la Lista del Modo Compra en Vivo (Checklist de Carrito)
 */
function renderShoppingList() {
    const container = document.getElementById('shoppingListContainer');
    if (!container) return;

    let items = getProducts();

    // Filtros
    if (currentFilter === 'pending') {
        items = items.filter(p => !p.inCart);
    } else if (currentFilter === 'incart') {
        items = items.filter(p => p.inCart);
    }

    if (items.length === 0) {
        container.innerHTML = `
            <div class="text-center py-5 text-muted">
                <i class="fas fa-shopping-cart fa-3x mb-3" style="color: #424242;"></i>
                <h5 class="text-white">Tu carrito está vacío</h5>
                <p class="small mb-3">Empieza pegando tu lista de la web o agrega productos con la cámara.</p>
                <div class="d-flex flex-column flex-sm-row justify-content-center align-items-center" style="gap: 10px;">
                    <button class="btn btn-success btn-lg font-weight-bold px-4 mb-2 mb-sm-0" onclick="openBulkImportModal()">
                        <i class="fas fa-paste mr-2"></i> Pegar Lista Masiva
                    </button>
                    <button class="btn btn-outline-info font-weight-bold px-3" onclick="openAddModal({ inCart: true })">
                        <i class="fas fa-plus mr-1"></i> Agregar Uno a Uno
                    </button>
                </div>
            </div>
        `;
        return;
    }

    let html = '';
    items.forEach(p => {
        const itemTotal = ((p.inCart ? p.realPrice : p.estimatedPrice) * p.quantity).toFixed(2);
        const hasPriceDiff = p.priceOverridden && (p.realPrice !== p.estimatedPrice);
        const estPriceText = p.estimatedPrice ? `S/ ${p.estimatedPrice.toFixed(2)}` : 'S/ 0.00';
        const realPriceText = `S/ ${(p.realPrice || p.estimatedPrice).toFixed(2)}`;

        html += `
            <div class="product-card ${p.inCart ? 'in-cart' : ''}" id="card-${p.id}">
                <div class="d-flex align-items-center">
                    <!-- Checkbox de Carrito 1-tap -->
                    <button type="button" class="btn-cart-check ${p.inCart ? 'checked' : ''}" 
                            onclick="handleToggleCart('${p.id}')" 
                            title="${p.inCart ? 'Sacar del carrito' : 'Meter al carrito'}">
                        <i class="fas ${p.inCart ? 'fa-check-circle' : 'fa-circle'}"></i>
                    </button>

                    <!-- Info Producto -->
                    <div class="flex-grow-1 ml-2 product-info" onclick="handleToggleCart('${p.id}')">
                        <div class="product-name ${p.inCart ? 'text-strikethrough text-muted' : ''}">
                            ${escapeHtml(p.name)}
                        </div>
                        <div class="product-subinfo small text-muted">
                            <span>Cant: <b>${p.quantity}</b></span>
                            <span class="mx-1">•</span>
                            <span>Unit: ${p.inCart ? realPriceText : estPriceText}</span>
                            ${hasPriceDiff ? `<span class="badge badge-warning ml-1">Web: ${estPriceText}</span>` : ''}
                        </div>
                    </div>

                    <!-- Precio Total y Botón Ajustar Precio -->
                    <div class="text-right ml-2">
                        <div class="product-total-price ${p.inCart ? 'text-teal font-weight-bold' : ''}">
                            S/ ${itemTotal}
                        </div>
                        <button type="button" class="btn btn-sm btn-outline-info py-0 px-2 mt-1" 
                                onclick="openPriceOverrideModal('${p.id}')" title="Ajustar precio de góndola">
                            <i class="fas fa-tag"></i> ${p.priceOverridden ? 'Editado' : 'Precio'}
                        </button>
                    </div>
                </div>

                <!-- Barra rápida de cantidad y acciones -->
                <div class="card-quick-actions mt-2 pt-2 border-top border-secondary d-flex justify-content-between align-items-center">
                    <div class="btn-group btn-group-sm">
                        <button class="btn btn-outline-secondary px-2" onclick="handleChangeQty('${p.id}', -1)">
                            <i class="fas fa-minus"></i>
                        </button>
                        <span class="btn btn-dark disabled text-white px-3 font-weight-bold">${p.quantity}</span>
                        <button class="btn btn-outline-secondary px-2" onclick="handleChangeQty('${p.id}', 1)">
                            <i class="fas fa-plus"></i>
                        </button>
                    </div>
                    <div>
                        <button class="btn btn-sm btn-outline-danger py-0 px-2" onclick="handleDeleteProduct('${p.id}')">
                            <i class="fas fa-trash-alt"></i>
                        </button>
                    </div>
                </div>
            </div>
        `;
    });

    container.innerHTML = html;
}

/**
 * Renderiza la Lista de Planificación Previa (Para armar en casa con precios web)
 */
function renderPlanningList() {
    const container = document.getElementById('planningListContainer');
    if (!container) return;

    const items = getProducts();
    if (items.length === 0) {
        container.innerHTML = `
            <div class="text-center py-5 text-muted">
                <i class="fas fa-clipboard-list fa-3x mb-3" style="color: #424242;"></i>
                <h5>Tu lista de planificación está vacía</h5>
                <p class="small">Agrega los productos que deseas comprar y sus precios vistos en la web del supermercado.</p>
            </div>
        `;
        return;
    }

    let html = `
        <div class="table-responsive">
            <table class="table table-dark table-sm table-hover mb-0">
                <thead>
                    <tr class="text-muted small">
                        <th>Producto</th>
                        <th class="text-center">Cant.</th>
                        <th class="text-right">Precio Web</th>
                        <th class="text-right">Subtotal</th>
                        <th class="text-center">Acción</th>
                    </tr>
                </thead>
                <tbody>
    `;

    items.forEach(p => {
        const subtotal = ((p.estimatedPrice || 0) * (p.quantity || 1)).toFixed(2);
        html += `
            <tr>
                <td class="align-middle font-weight-bold">${escapeHtml(p.name)}</td>
                <td class="align-middle text-center">
                    <span class="badge badge-secondary">${p.quantity}</span>
                </td>
                <td class="align-middle text-right text-info">S/ ${(p.estimatedPrice || 0).toFixed(2)}</td>
                <td class="align-middle text-right font-weight-bold">S/ ${subtotal}</td>
                <td class="align-middle text-center">
                    <button class="btn btn-sm btn-outline-danger py-0 px-2" onclick="handleDeleteProduct('${p.id}')">
                        <i class="fas fa-times"></i>
                    </button>
                </td>
            </tr>
        `;
    });

    const metrics = getSummaryMetrics();
    html += `
                </tbody>
                <tfoot>
                    <tr class="font-weight-bold text-white" style="background: #2a2a2a;">
                        <td colspan="3" class="text-right">Total Presupuestado:</td>
                        <td class="text-right text-teal">S/ ${metrics.estimatedBudget.toFixed(2)}</td>
                        <td></td>
                    </tr>
                </tfoot>
            </table>
        </div>
    `;

    container.innerHTML = html;
}

/**
 * Renderiza la Vista de Resumen y Exportación
 */
function renderSummaryView() {
    const container = document.getElementById('summaryViewContainer');
    if (!container) return;

    const metrics = getSummaryMetrics();
    const items = getProducts();
    const inCartItems = items.filter(p => p.inCart);

    let html = `
        <div class="card bg-dark border-secondary mb-3">
            <div class="card-body">
                <h5 class="card-title text-teal mb-3"><i class="fas fa-receipt"></i> Estado de la Cuenta</h5>
                <ul class="list-group list-group-flush bg-transparent">
                    <li class="list-group-item bg-transparent text-light d-flex justify-content-between px-0">
                        <span>Total de artículos en lista:</span>
                        <b>${metrics.totalItems} ítems</b>
                    </li>
                    <li class="list-group-item bg-transparent text-light d-flex justify-content-between px-0">
                        <span>Artículos en el carrito:</span>
                        <b class="text-teal">${metrics.inCartItems} ítems</b>
                    </li>
                    <li class="list-group-item bg-transparent text-light d-flex justify-content-between px-0">
                        <span>Presupuesto planeado:</span>
                        <b>S/ ${metrics.estimatedBudget.toFixed(2)}</b>
                    </li>
                    <li class="list-group-item bg-transparent text-light d-flex justify-content-between px-0 font-weight-bold" style="font-size: 1.15rem;">
                        <span>Total a pagar en caja (Carrito):</span>
                        <span class="text-teal">S/ ${metrics.currentCartTotal.toFixed(2)}</span>
                    </li>
                    <li class="list-group-item bg-transparent text-light d-flex justify-content-between px-0">
                        <span>Variación sobre lo planeado:</span>
                        <b class="${metrics.diff <= 0 ? 'text-success' : 'text-warning'}">
                            ${metrics.diff <= 0 ? 'Ahorro de S/ ' + Math.abs(metrics.diff).toFixed(2) : '+S/ ' + metrics.diff.toFixed(2) + ' extra'}
                        </b>
                    </li>
                </ul>
            </div>
        </div>

        <div class="d-flex flex-column gap-2">
            <button class="btn btn-outline-info btn-block mb-2" onclick="shareSummaryWhatsApp()">
                <i class="fab fa-whatsapp"></i> Compartir lista / Resumen por WhatsApp
            </button>
            <button class="btn btn-outline-warning btn-block mb-2" onclick="handleClearPurchased()">
                <i class="fas fa-check-double"></i> Limpiar solo los comprados (Guardar pendientes)
            </button>
            <button class="btn btn-outline-danger btn-block" onclick="handleClearAll()">
                <i class="fas fa-trash"></i> Vaciar toda la lista
            </button>
        </div>
    `;

    container.innerHTML = html;
}

// ==========================================
// INTERACCIONES Y ACCIONES DEL USUARIO
// ==========================================

function handleToggleCart(id) {
    toggleProductInCart(id);
    renderApp();
}

function handleChangeQty(id, delta) {
    changeQuantity(id, delta);
    renderApp();
}

function handleDeleteProduct(id) {
    deleteProductById(id);
    renderApp();
}

/**
 * Abre el modal para ajustar el precio real en góndola
 */
function openPriceOverrideModal(id) {
    const product = getProductById(id);
    if (!product) return;

    activePriceEditId = id;
    document.getElementById('modalOverrideProductName').textContent = product.name;
    document.getElementById('modalOverrideEstPrice').textContent = `S/ ${product.estimatedPrice.toFixed(2)}`;
    
    // Si ya tenía un precio real, sugerirlo; de lo contrario el estimado
    const currentPrice = product.priceOverridden ? product.realPrice : product.estimatedPrice;
    document.getElementById('modalOverrideRealPriceInput').value = currentPrice > 0 ? currentPrice.toFixed(2) : '';

    $('#priceOverrideModal').modal('show');
    setTimeout(() => {
        const input = document.getElementById('modalOverrideRealPriceInput');
        if (input) {
            input.focus();
            input.select();
        }
    }, 400);
}

function keepEstimatedPriceInModal() {
    if (!activePriceEditId) return;
    const product = getProductById(activePriceEditId);
    if (product) {
        toggleProductInCart(activePriceEditId, product.estimatedPrice);
        product.priceOverridden = false;
        saveProducts();
    }
    $('#priceOverrideModal').modal('hide');
    renderApp();
}

function savePriceOverrideFromModal() {
    if (!activePriceEditId) return;
    const inputVal = parseFloat(document.getElementById('modalOverrideRealPriceInput').value);
    if (isNaN(inputVal) || inputVal < 0) {
        alert('Por favor ingresa un precio válido.');
        return;
    }

    setProductRealPrice(activePriceEditId, inputVal);
    $('#priceOverrideModal').modal('hide');
    renderApp();
}

function handleClearPurchased() {
    if (confirm('¿Deseas quitar de la lista todos los productos que ya metiste al carrito? Los pendientes se conservarán.')) {
        clearPurchasedProducts();
        renderApp();
    }
}

function handleClearAll() {
    if (confirm('¿Estás seguro de vaciar toda la lista de compras?')) {
        clearAllProducts();
        renderApp();
    }
}

// ==========================================
// MÉTODOS DE ENTRADA RÁPIDA (OCR, VOZ, MANUAL)
// ==========================================

// ==========================================
// MÉTODOS DE ENTRADA RÁPIDA (OCR, VOZ, MANUAL, MASIVO)
// ==========================================

let lastParsedBulk = { items: [], totalCount: 0, totalEstimatedBudget: 0 };

/**
 * Abre el modal para pegar una lista en masa
 */
function openBulkImportModal() {
    $('#bulkImportModal').modal('show');
    setTimeout(() => {
        const textarea = document.getElementById('bulkImportTextarea');
        if (textarea) {
            textarea.focus();
            updateBulkImportPreview();
        }
    }, 400);
}

/**
 * Actualiza la previsualización en vivo mientras el usuario escribe o pega
 */
function updateBulkImportPreview() {
    const textarea = document.getElementById('bulkImportTextarea');
    if (!textarea) return;

    const rawText = textarea.value;
    const isLineTotal = document.getElementById('bulkPriceIsTotal') ? document.getElementById('bulkPriceIsTotal').checked : true;
    
    lastParsedBulk = parseBulkProductText(rawText, { priceIsLineTotal: isLineTotal });

    const statsBadge = document.getElementById('bulkPreviewStats');
    const previewContainer = document.getElementById('bulkPreviewContainer');
    const btnSubmit = document.getElementById('btnSubmitBulkImport');

    if (lastParsedBulk.totalCount === 0) {
        if (statsBadge) statsBadge.innerHTML = `<span class="text-muted"><i class="fas fa-info-circle"></i> Pega tu lista arriba para previsualizar</span>`;
        if (previewContainer) previewContainer.innerHTML = `<div class="text-center text-muted py-3 small">Esperando texto de la lista...</div>`;
        if (btnSubmit) btnSubmit.disabled = true;
        return;
    }

    if (btnSubmit) btnSubmit.disabled = false;

    if (statsBadge) {
        statsBadge.innerHTML = `
            <span class="badge badge-success px-2 py-1 mr-2"><i class="fas fa-check"></i> ${lastParsedBulk.totalCount} productos detectados</span>
            <span class="badge badge-info px-2 py-1"><i class="fas fa-coins"></i> Total Estimado: S/ ${lastParsedBulk.totalEstimatedBudget.toFixed(2)}</span>
        `;
    }

    if (previewContainer) {
        const itemsToShow = lastParsedBulk.items.slice(0, 6);
        let previewHtml = `
            <div class="table-responsive" style="max-height: 220px; overflow-y: auto;">
                <table class="table table-sm table-dark table-striped mb-0 small">
                    <thead>
                        <tr>
                            <th>Cant.</th>
                            <th>Producto</th>
                            <th class="text-right">Unitario</th>
                            <th class="text-right">Subtotal</th>
                        </tr>
                    </thead>
                    <tbody>
        `;

        itemsToShow.forEach(it => {
            previewHtml += `
                <tr>
                    <td class="font-weight-bold text-teal">${it.quantity}x</td>
                    <td class="text-truncate" style="max-width: 190px;" title="${escapeHtml(it.name)}">${escapeHtml(it.name)}</td>
                    <td class="text-right text-muted">S/ ${it.price.toFixed(2)}</td>
                    <td class="text-right font-weight-bold text-info">S/ ${it.lineTotal.toFixed(2)}</td>
                </tr>
            `;
        });

        previewHtml += `</tbody></table></div>`;

        if (lastParsedBulk.items.length > 6) {
            previewHtml += `<div class="text-center text-muted small mt-1 font-italic">... y ${lastParsedBulk.items.length - 6} productos más en la lista.</div>`;
        }

        previewContainer.innerHTML = previewHtml;
    }
}

/**
 * Intenta leer directamente del portapapeles del dispositivo si el navegador lo permite
 */
async function pasteFromClipboard() {
    try {
        if (navigator.clipboard && navigator.clipboard.readText) {
            const text = await navigator.clipboard.readText();
            if (text && text.trim()) {
                const textarea = document.getElementById('bulkImportTextarea');
                if (textarea) {
                    textarea.value = text;
                    updateBulkImportPreview();
                }
                return;
            }
        }
    } catch (e) {
        console.warn('Clipboard no disponible o sin permiso:', e);
    }
    alert('Mantén presionado el recuadro de texto para pegar tu lista copiada.');
}

/**
 * Carga la lista de ejemplo en el textarea
 */
function loadBulkExample() {
    const example = `* 3x Leche Parcialmente Descremada UHT VIGOR 800ml - S/ 14.40
* 3x Leche Parcialmente Deslactosada UHT VIGOR 800ml - S/ 14.70
* 3x Lavavajilla líquido BOREAL Manzana 500Ml - S/ 11.70
* 2x Sacagrasa SAPOLIO Limón 500ml - S/ 12.20
* 1x Aceite Vegetal PRIMOR Clásico 1.8L - S/ 15.20
* 1x Detergente BOLIVAR Cuidado Total 4Kg - S/ 41.90
* 2x Arroz Superior PAISANA 5Kg - S/ 37.00
* 8x Atún en Aceite Vegetal CAMPOMAR 150g - S/ 38.40
* 1x Mayonesa ALACENA 475g - S/ 12.30`;

    const textarea = document.getElementById('bulkImportTextarea');
    if (textarea) {
        textarea.value = example;
        updateBulkImportPreview();
    }
}

/**
 * Ejecuta la importación masiva a la lista
 */
function executeBulkImport() {
    const textarea = document.getElementById('bulkImportTextarea');
    
    // Si lastParsedBulk está vacío, intentar analizar directamente el contenido actual del textarea
    if (!lastParsedBulk || lastParsedBulk.items.length === 0) {
        if (textarea && textarea.value.trim()) {
            const isLineTotal = document.getElementById('bulkPriceIsTotal') ? document.getElementById('bulkPriceIsTotal').checked : true;
            lastParsedBulk = parseBulkProductText(textarea.value, { priceIsLineTotal: isLineTotal });
        }
    }

    if (!lastParsedBulk || lastParsedBulk.items.length === 0) {
        alert('Por favor pega una lista con productos antes de importar.');
        return;
    }

    const replaceExisting = document.getElementById('bulkReplaceExisting') ? document.getElementById('bulkReplaceExisting').checked : false;

    addMultipleProducts(lastParsedBulk.items, replaceExisting);
    $('#bulkImportModal').modal('hide');

    // Cambiar a la pestaña de compras para ver los productos listos para meter al carrito
    switchTab('shopping');
    renderApp();

    alert(`¡Éxito! Se importaron ${lastParsedBulk.items.length} productos a tu lista (Presupuesto Total: S/ ${lastParsedBulk.totalEstimatedBudget.toFixed(2)}).`);
}

function openAddModal(prefill = {}) {
    document.getElementById('quickAddName').value = prefill.name || '';
    document.getElementById('quickAddQuantity').value = prefill.quantity || 1;
    document.getElementById('quickAddPrice').value = prefill.price !== undefined ? prefill.price : '';
    document.getElementById('quickAddInCart').checked = Boolean(prefill.inCart);

    // Sugerencias táctiles si el OCR detectó alternativas
    const badgeContainer = document.getElementById('ocrSuggestionsBox');
    if (badgeContainer) {
        let badgeHtml = '';
        if (prefill.candidatePrices && prefill.candidatePrices.length > 1) {
            badgeHtml += `<div class="mb-2"><small class="text-muted d-block">Precios detectados en la imagen (toca para elegir):</small>`;
            prefill.candidatePrices.forEach(p => {
                badgeHtml += `<button type="button" class="btn btn-xs btn-outline-info mr-1 mb-1 py-0 px-2" onclick="document.getElementById('quickAddPrice').value='${p.toFixed(2)}'">S/ ${p.toFixed(2)}</button>`;
            });
            badgeHtml += `</div>`;
        }

        if (prefill.candidateNames && prefill.candidateNames.length > 1) {
            badgeHtml += `<div><small class="text-muted d-block">Líneas de texto detectadas (toca para elegir):</small>`;
            prefill.candidateNames.slice(0, 3).forEach(n => {
                badgeHtml += `<button type="button" class="btn btn-xs btn-outline-secondary mr-1 mb-1 py-0 px-2 text-left text-truncate d-inline-block" style="max-width: 280px;" onclick="document.getElementById('quickAddName').value='${escapeHtml(n)}'">${escapeHtml(n)}</button>`;
            });
            badgeHtml += `</div>`;
        }
        badgeContainer.innerHTML = badgeHtml;
    }

    $('#quickAddModal').modal('show');
}

function submitQuickAdd() {
    const name = document.getElementById('quickAddName').value.trim();
    const qty = parseInt(document.getElementById('quickAddQuantity').value, 10) || 1;
    const price = parseFloat(document.getElementById('quickAddPrice').value) || 0;
    const inCart = document.getElementById('quickAddInCart').checked;

    if (!name) {
        alert('Por favor ingresa el nombre del producto.');
        return;
    }

    addProduct(name, qty, price, {
        inCart: inCart,
        realPrice: inCart ? price : undefined,
        priceOverridden: false
    });

    $('#quickAddModal').modal('hide');
    populateCatalogDatalist();
    renderApp();
}

/**
 * Procesa la foto de la etiqueta tomada con la cámara usando ShelfTagOCR
 */
async function processTagImage(imageFile) {
    const progressModal = $('#ocrProgressModal');
    const progressBar = document.getElementById('ocrProgressBar');
    const progressStatus = document.getElementById('ocrProgressStatus');

    progressModal.modal({ backdrop: 'static', keyboard: false });
    if (progressBar) progressBar.style.width = '10%';
    if (progressStatus) progressStatus.textContent = 'Analizando etiqueta de precio...';

    try {
        const result = await ShelfTagOCR.recognizeTag(imageFile, (percent) => {
            if (progressBar) progressBar.style.width = `${Math.max(10, percent)}%`;
            if (progressStatus) progressStatus.textContent = `Reconociendo texto de góndola: ${percent}%`;
        });

        progressModal.modal('hide');

        // Abrir modal de confirmación con los datos extraídos por el OCR
        openAddModal({
            name: result.name || 'Producto escaneado',
            price: result.price || 0,
            quantity: 1,
            candidatePrices: result.allPricesFound,
            candidateNames: result.candidateNames,
            inCart: true // Si lo escaneó en el estante, al carrito
        });

    } catch (err) {
        progressModal.modal('hide');
        console.error('Error en OCR:', err);
        alert('No se pudo leer la etiqueta claramente. Si es una captura de pantalla, te recomendamos recortarla o usar la opción "📋 Pegar Lista Masiva".');
    }
}

/**
 * Inicia la captura por voz usando VoiceInput con diagnóstico de seguridad file://
 */
function startVoiceRecognition() {
    if (window.location.protocol === 'file:') {
        alert(
            '⚠️ AVISO IMPORTANTE:\n\n' +
            'Estás abriendo la aplicación desde un archivo local (file:///).\n\n' +
            'Los navegadores (Chrome, Edge y Safari) bloquean el reconocimiento de voz en archivos locales por seguridad.\n\n' +
            '🚀 Cuando lo abras en tu enlace de GitHub Pages (https://...) funcionará de inmediato con el micrófono en tu celular.'
        );
        return;
    }

    if (!VoiceInput.isSupported()) {
        alert('Tu navegador no soporta reconocimiento de voz nativo. Por favor usa Chrome en Android o Safari en iPhone.');
        return;
    }

    const voiceModal = $('#voiceListeningModal');
    const voiceStatus = document.getElementById('voiceListeningStatus');
    const voiceTranscript = document.getElementById('voiceLiveTranscript');

    voiceModal.modal('show');
    if (voiceStatus) voiceStatus.textContent = 'Escuchando... Di: "Nombre del producto y su precio"';
    if (voiceTranscript) voiceTranscript.textContent = 'Ej: "Leche Gloria cuatro soles cincuenta"';

    VoiceInput.startListening({
        onStart: () => {
            if (voiceStatus) voiceStatus.textContent = '🎙️ Escuchando... Habla ahora';
        },
        onResult: (res) => {
            voiceModal.modal('hide');
            // Abrir modal con los datos analizados
            openAddModal({
                name: res.name || res.rawText,
                quantity: res.quantity || 1,
                price: res.price || 0,
                inCart: currentTab === 'shopping'
            });
        },
        onError: (errMsg) => {
            voiceModal.modal('hide');
            alert(errMsg);
        },
        onEnd: () => {
            voiceModal.modal('hide');
        }
    });
}

function populateCatalogDatalist() {
    const datalist = document.getElementById('productCatalogSuggestions');
    if (!datalist) return;

    const catalog = getCatalog();
    let optionsHtml = '';
    catalog.forEach(item => {
        optionsHtml += `<option value="${escapeHtml(item.name)}">S/ ${(item.lastPrice || 0).toFixed(2)}</option>`;
    });
    datalist.innerHTML = optionsHtml;
}

// Al seleccionar sugerencia del catálogo, auto-rellenar último precio
function handleCatalogSelect(input) {
    const val = input.value.trim().toLowerCase();
    const catalog = getCatalog();
    const found = catalog.find(item => item.name.toLowerCase() === val);
    if (found && found.lastPrice) {
        const priceField = document.getElementById('quickAddPrice');
        if (priceField && (!priceField.value || priceField.value === '0')) {
            priceField.value = found.lastPrice.toFixed(2);
        }
    }
}

function shareSummaryWhatsApp() {
    const metrics = getSummaryMetrics();
    const items = getProducts();

    let msg = `🛒 *Resumen de Compras - ListExpress*\n`;
    msg += `Total a pagar: *S/ ${metrics.currentCartTotal.toFixed(2)}*\n`;
    msg += `Presupuesto: S/ ${metrics.estimatedBudget.toFixed(2)} (${metrics.diff <= 0 ? 'Ahorro' : 'Extra'}: S/ ${Math.abs(metrics.diff).toFixed(2)})\n\n`;
    msg += `*Productos en Carrito:*\n`;

    const inCart = items.filter(p => p.inCart);
    if (inCart.length === 0) {
        msg += `(Ninguno marcado todavía)\n`;
    } else {
        inCart.forEach(p => {
            const price = p.realPrice || p.estimatedPrice;
            msg += `• ${p.quantity}x ${p.name} - S/ ${(price * p.quantity).toFixed(2)}\n`;
        });
    }

    const pending = items.filter(p => !p.inCart);
    if (pending.length > 0) {
        msg += `\n*Pendientes por comprar:*\n`;
        pending.forEach(p => {
            msg += `⏳ ${p.quantity}x ${p.name} (Est. S/ ${(p.estimatedPrice * p.quantity).toFixed(2)})\n`;
        });
    }

    const url = `https://wa.me/?text=${encodeURIComponent(msg)}`;
    window.open(url, '_blank');
}

function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/[&<>'"]/g, tag => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        "'": '&#39;',
        '"': '&quot;'
    }[tag] || tag));
}