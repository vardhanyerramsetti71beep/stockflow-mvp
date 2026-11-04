SF.initPage(async function () {
  const data = await SF.api('/dashboard');

  document.getElementById('stat-products').textContent = SF.num(data.totalProducts);
  document.getElementById('stat-units').textContent = SF.num(data.totalQuantity);
  document.getElementById('stat-low').textContent = SF.num(data.lowStockCount);
  document.getElementById('stat-low-card').classList.toggle('stat-warn', data.lowStockCount > 0);
  document.getElementById('default-threshold').textContent = data.defaultLowStockThreshold;

  const box = document.getElementById('low-stock');

  if (!data.lowStock.length) {
    box.innerHTML = data.totalProducts
      ? '<div class="empty"><span class="empty-icon">' + SF.icon('check', 22) + '</span>' +
        '<p><b>All stocked up.</b><br><span class="muted">No product is at or below its threshold.</span></p></div>'
      : '<div class="empty"><span class="empty-icon">' + SF.icon('box', 22) + '</span>' +
        '<p><b>No products yet.</b><br><span class="muted">Add your first product to see it here.</span></p>' +
        '<a class="btn btn-primary btn-sm" href="/product.html">' + SF.icon('plus', 14) + ' Add product</a></div>';
    return;
  }

  const rows = data.lowStock.map(function (p) {
    const pct = p.effectiveThreshold > 0 ? Math.min(100, Math.round((p.quantityOnHand / p.effectiveThreshold) * 100)) : 0;
    return '<tr>' +
      '<td class="strong">' + SF.esc(p.name) + '</td>' +
      '<td><code>' + SF.esc(p.sku) + '</code></td>' +
      '<td class="num"><span class="badge badge-low">' + p.quantityOnHand + '</span></td>' +
      '<td class="num">' + p.effectiveThreshold + (p.lowStockThreshold === null ? ' <small class="muted">(default)</small>' : '') + '</td>' +
      '<td><span class="meter' + (p.quantityOnHand === 0 ? ' empty-stock' : '') + '"><span style="width:' + pct + '%"></span></span></td>' +
      '<td class="actions"><a class="btn btn-ghost btn-sm" href="/product.html?id=' + p.id + '">Restock</a></td>' +
      '</tr>';
  }).join('');

  box.innerHTML =
    '<div class="table-wrap"><table>' +
    '<thead><tr><th>Name</th><th>SKU</th><th class="num">Quantity on hand</th><th class="num">Low stock threshold</th><th>Level</th><th></th></tr></thead>' +
    '<tbody>' + rows + '</tbody></table></div>';
});
