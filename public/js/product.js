// Add product (product.html) or edit one (product.html?id=12).
SF.initPage(async function (me) {
  const form = document.getElementById('product-form');
  const id = new URLSearchParams(location.search).get('id');
  document.getElementById('default-threshold').textContent = me.organization.defaultLowStockThreshold;

  if (id) {
    let product;
    try {
      product = (await SF.api('/products/' + encodeURIComponent(id))).product;
    } catch (err) {
      SF.flashNext(err.message, 'error');
      location.replace('/products.html');
      return;
    }
    document.title = 'Edit ' + product.name + ' · StockFlow';
    document.getElementById('eyebrow').textContent = product.sku;
    document.getElementById('heading').textContent = 'Edit product';
    document.getElementById('save-btn').textContent = 'Save changes';
    ['name', 'sku', 'description', 'quantityOnHand', 'lowStockThreshold', 'costPrice', 'sellingPrice'].forEach(function (k) {
      form.elements[k].value = product[k] ?? '';
    });
    document.getElementById('meta').textContent =
      'Last updated ' + product.updatedAt + ' UTC' + (product.lastStockNote ? ' · Note: "' + product.lastStockNote + '"' : '');
  }

  form.elements.name.focus();

  SF.onSubmit(form, async function (values) {
    const res = id
      ? await SF.api('/products/' + encodeURIComponent(id), { method: 'PUT', body: values })
      : await SF.api('/products', { method: 'POST', body: values });
    SF.flashNext('Product "' + res.product.name + '" ' + (id ? 'updated' : 'created') + '.');
    location.href = '/products.html';
  });
});
