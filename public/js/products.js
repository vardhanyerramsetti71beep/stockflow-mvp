SF.initPage(async function () {
  const list = document.getElementById('product-list');
  const count = document.getElementById('product-count');
  const searchForm = document.getElementById('search-form');
  const searchInput = document.getElementById('search');
  const clearBtn = document.getElementById('clear-search');

  let products = [];
  let query = new URLSearchParams(location.search).get('q') || '';
  searchInput.value = query;

  async function load() {
    const res = await SF.api('/products' + (query ? '?q=' + encodeURIComponent(query) : ''));
    products = res.products;
    clearBtn.hidden = !query;
    render();
  }

  function render() {
    count.textContent = products.length + (products.length === 1 ? ' product' : ' products') + (query ? ' found' : '');

    if (!products.length) {
      list.innerHTML = query
        ? '<div class="empty"><span class="empty-icon">' + SF.icon('search', 22) + '</span>' +
          '<p><b>No matches for "' + SF.esc(query) + '".</b><br><span class="muted">Try a different name or SKU.</span></p></div>'
        : '<div class="empty"><span class="empty-icon">' + SF.icon('box', 22) + '</span>' +
          '<p><b>No products yet.</b><br><span class="muted">Create your first product to start tracking stock.</span></p>' +
          '<a class="btn btn-primary btn-sm" href="/product.html">' + SF.icon('plus', 14) + ' Add product</a></div>';
      return;
    }

    const rows = products.map(function (p) {
      return '<tr data-id="' + p.id + '" data-row="' + SF.esc((p.name + ' ' + p.sku).toLowerCase()) + '">' +
        '<td><a class="product-name" href="/product.html?id=' + p.id + '">' + SF.esc(p.name) + '</a><code>' + SF.esc(p.sku) + '</code></td>' +
        '<td class="num strong">' + SF.num(p.quantityOnHand) + '</td>' +
        '<td>' + (p.isLowStock
          ? '<span class="badge badge-low"><i class="dot"></i>Low stock</span>'
          : '<span class="badge badge-ok"><i class="dot"></i>In stock</span>') + '</td>' +
        '<td class="num">' + SF.money(p.sellingPrice) + '</td>' +
        '<td><form class="adjust" data-adjust="' + p.id + '">' +
          '<input name="delta" type="number" step="1" placeholder="±N" aria-label="Units to add or remove" required>' +
          '<input name="note" type="text" placeholder="Note" aria-label="Note" maxlength="200">' +
          '<button class="btn btn-sm" type="submit">Apply</button></form></td>' +
        '<td class="actions">' +
          '<a class="icon-btn" href="/product.html?id=' + p.id + '" title="Edit" aria-label="Edit ' + SF.esc(p.name) + '">' + SF.icon('edit', 16) + '</a>' +
          '<button class="icon-btn danger" type="button" data-delete="' + p.id + '" title="Delete" aria-label="Delete ' + SF.esc(p.name) + '">' + SF.icon('trash', 16) + '</button>' +
        '</td></tr>';
    }).join('');

    list.innerHTML =
      '<div class="table-wrap"><table class="products">' +
      '<thead><tr><th>Product</th><th class="num">Quantity</th><th>Status</th><th class="num">Price</th><th>Adjust stock</th><th class="actions">Actions</th></tr></thead>' +
      '<tbody>' + rows + '</tbody></table>' +
      '<p class="empty small" id="no-match" hidden>No products match that filter.</p></div>';
    filterRows();
  }

  // Instant filter while typing; the Search button asks the server.
  function filterRows() {
    const term = searchInput.value.trim().toLowerCase();
    let shown = 0;
    list.querySelectorAll('tr[data-row]').forEach(function (row) {
      const hide = term && row.dataset.row.indexOf(term) === -1;
      row.hidden = hide;
      if (!hide) shown++;
    });
    const none = document.getElementById('no-match');
    if (none) none.hidden = shown !== 0;
  }

  function findProduct(id) {
    return products.find(function (p) { return p.id === Number(id); });
  }

  searchInput.addEventListener('input', filterRows);

  searchForm.addEventListener('submit', function (e) {
    e.preventDefault();
    query = searchInput.value.trim();
    history.replaceState(null, '', query ? '?q=' + encodeURIComponent(query) : location.pathname);
    load();
  });

  clearBtn.addEventListener('click', function () {
    searchInput.value = '';
    query = '';
    history.replaceState(null, '', location.pathname);
    load();
  });

  // Stock adjustment (+/- N).
  list.addEventListener('submit', async function (e) {
    const form = e.target.closest('form[data-adjust]');
    if (!form) return;
    e.preventDefault();
    const product = findProduct(form.dataset.adjust);
    const delta = Number(form.elements.delta.value);
    if (!Number.isInteger(delta) || delta === 0) {
      SF.toast('Enter a non-zero whole number, e.g. 5 or -3.', 'error');
      form.elements.delta.focus();
      return;
    }
    const btn = form.querySelector('button');
    btn.disabled = true;
    try {
      const res = await SF.api('/products/' + product.id + '/adjust', {
        method: 'POST',
        body: { delta: delta, note: form.elements.note.value.trim() },
      });
      Object.assign(product, res.product);
      SF.toast('Adjusted "' + product.name + '" by ' + (delta > 0 ? '+' : '') + delta + '.');
      render();
    } catch (err) {
      SF.toast(err.message, 'error');
      btn.disabled = false;
    }
  });

  // Delete with confirmation.
  list.addEventListener('click', async function (e) {
    const btn = e.target.closest('[data-delete]');
    if (!btn) return;
    const product = findProduct(btn.dataset.delete);
    if (!confirm('Delete "' + product.name + '"? This cannot be undone.')) return;
    btn.disabled = true;
    try {
      await SF.api('/products/' + product.id, { method: 'DELETE' });
      products = products.filter(function (p) { return p.id !== product.id; });
      SF.toast('Product "' + product.name + '" deleted.');
      render();
    } catch (err) {
      SF.toast(err.message, 'error');
      btn.disabled = false;
    }
  });

  await load();
});
