let products = JSON.parse(localStorage.getItem('products')) || [];

function saveProducts() {
    localStorage.setItem('products', JSON.stringify(products));
}

function addProduct(name, quantity, price) {
    products.push({ name, quantity: parseInt(quantity), price: parseFloat(price) });
    saveProducts();
}

function getProducts() {
    return products;
}

function updateProduct(index, name, quantity, price) {
    products[index] = { name, quantity: parseInt(quantity), price: parseFloat(price) };
    saveProducts();
}

function deleteProduct(index) {
    products.splice(index, 1);
    saveProducts();
}
