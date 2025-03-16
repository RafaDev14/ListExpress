function loadProducts() {
    const productTableBody = document.getElementById('productTableBody');
    productTableBody.innerHTML = '';
    getProducts().forEach((product, index) => {
        const row = `<tr>
            <td>${product.name}</td>
            <td>${product.quantity}</td>
            <td>${product.price.toFixed(2)}</td>
            <td>
                <button class="btn btn-warning btn-sm" onclick="showEditModal(${index})">Editar</button>
                <button class="btn btn-danger btn-sm" onclick="deleteProductAndReload(${index})">Eliminar</button>
            </td>
        </tr>`;
        productTableBody.innerHTML += row;
    });
    updateSummary();
}

function showEditModal(index) {
    const product = getProducts()[index];
    document.getElementById('editProductName').value = product.name;
    document.getElementById('editProductQuantity').value = product.quantity;
    document.getElementById('editProductPrice').value = product.price;
    $('#editProductModal').modal('show');

    const form = document.getElementById('editProductForm');
    form.onsubmit = function (e) {
        e.preventDefault();
        updateProduct(
            index,
            document.getElementById('editProductName').value,
            parseInt(document.getElementById('editProductQuantity').value),
            parseFloat(document.getElementById('editProductPrice').value)
        );
        $('#editProductModal').modal('hide');
        loadProducts();
    };
}

function deleteProductAndReload(index) {
    deleteProduct(index);
    loadProducts();
}

function updateSummary() {
    const totalProducts = products.length;
    const totalQuantity = products.reduce((acc, product) => acc + product.quantity, 0);
    const totalAmount = products.reduce((acc, product) => acc + (product.quantity * product.price), 0).toFixed(2);
    if (document.getElementById('totalProducts')) {
        document.getElementById('totalProducts').textContent = totalProducts;
    }
    if (document.getElementById('totalQuantity')) {
        document.getElementById('totalQuantity').textContent = totalQuantity;
    }
    if (document.getElementById('totalAmount')) {
        document.getElementById('totalAmount').textContent = totalAmount;
    }
}