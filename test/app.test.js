// End-to-end tests: run the real app (JSON API + static pages) against an in-memory database.
process.env.DATABASE_FILE = ':memory:';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const app = require('../src/app');

let server;
let base;

before(async () => {
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

// Minimal browser: keeps the session cookie and talks JSON like the frontend does.
function client() {
  let cookie = '';
  return async function call(method, path, body, { header = true } = {}) {
    const headers = { cookie, Accept: 'application/json' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (method !== 'GET' && header) headers['X-Requested-With'] = 'StockFlow';
    const res = await fetch(base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    for (const c of res.headers.getSetCookie()) {
      const [kv] = c.split(';');
      const [k, v] = kv.split(/=(.*)/s);
      const jar = Object.fromEntries(cookie.split('; ').filter(Boolean).map((x) => x.split(/=(.*)/s).slice(0, 2)));
      jar[k] = v;
      cookie = Object.entries(jar).filter(([, val]) => val).map(([key, val]) => `${key}=${val}`).join('; ');
    }
    const type = res.headers.get('content-type') || '';
    return { status: res.status, body: type.includes('json') ? await res.json() : await res.text() };
  };
}

function signup(c, email, org) {
  return c('POST', '/api/auth/signup', { email, password: 'password123', confirmPassword: 'password123', organizationName: org });
}

test('serves the HTML pages and assets', async () => {
  const c = client();
  for (const page of ['/', '/login.html', '/signup.html', '/products.html', '/product.html', '/settings.html', '/css/styles.css', '/js/app.js']) {
    const r = await c('GET', page);
    assert.equal(r.status, 200, page);
  }
  assert.equal((await c('GET', '/login')).status, 200); // extension-less URL works too
  assert.equal((await c('GET', '/nope')).status, 404);
});

test('signup, me, logout and login', async () => {
  const c = client();
  assert.equal((await c('GET', '/api/me')).status, 401);

  const r = await signup(c, 'owner@a.com', 'Store A');
  assert.equal(r.status, 201);
  assert.equal(r.body.organization.name, 'Store A');

  const me = await c('GET', '/api/me');
  assert.equal(me.status, 200);
  assert.equal(me.body.user.email, 'owner@a.com');

  await c('POST', '/api/auth/logout');
  assert.equal((await c('GET', '/api/me')).status, 401);

  const bad = await c('POST', '/api/auth/login', { email: 'owner@a.com', password: 'wrong-pass' });
  assert.equal(bad.status, 401);
  const ok = await c('POST', '/api/auth/login', { email: 'OWNER@a.com', password: 'password123' });
  assert.equal(ok.status, 200);
});

test('signup validation and duplicate email', async () => {
  const c = client();
  const r = await c('POST', '/api/auth/signup', { email: 'nope', password: 'short', confirmPassword: 'x', organizationName: '' });
  assert.equal(r.status, 422);
  assert.ok(r.body.errors.email && r.body.errors.password && r.body.errors.confirmPassword && r.body.errors.organizationName);
  const dup = await signup(client(), 'owner@a.com', 'Again');
  assert.equal(dup.status, 422);
  assert.match(dup.body.errors.email, /already exists/);
});

test('rejects writes without the CSRF header', async () => {
  const c = client();
  const r = await c('POST', '/api/auth/signup', { email: 'x@y.com' }, { header: false });
  assert.equal(r.status, 403);
});

test('product CRUD, stock adjust, low stock dashboard and settings', async () => {
  const c = client();
  await signup(c, 'owner@b.com', 'Store B');

  let r = await c('POST', '/api/products', { name: 'Blue Mug', sku: 'MUG-1', quantityOnHand: 3, sellingPrice: '199', lowStockThreshold: '' });
  assert.equal(r.status, 201);
  assert.equal(r.body.product.isLowStock, true);
  r = await c('POST', '/api/products', { name: 'Red Pen', sku: 'PEN-1', quantityOnHand: '50', lowStockThreshold: '10' });
  assert.equal(r.status, 201);
  const penId = r.body.product.id;

  // duplicate SKU in same org is rejected (case-insensitive)
  r = await c('POST', '/api/products', { name: 'Dup', sku: 'mug-1', quantityOnHand: 1 });
  assert.equal(r.status, 422);
  assert.match(r.body.errors.sku, /already used/);

  // bad numbers rejected
  r = await c('POST', '/api/products', { name: 'Bad', sku: 'BAD-1', quantityOnHand: '-2' });
  assert.equal(r.status, 422);

  let dash = (await c('GET', '/api/dashboard')).body;
  assert.equal(dash.totalProducts, 2);
  assert.equal(dash.totalQuantity, 53);
  assert.deepEqual(dash.lowStock.map((p) => p.name), ['Blue Mug']); // 3 <= default 5

  // lower the default: Blue Mug is no longer low, Red Pen keeps its own threshold
  await c('PUT', '/api/settings', { defaultLowStockThreshold: 2 });
  assert.equal((await c('GET', '/api/settings')).body.defaultLowStockThreshold, 2);
  dash = (await c('GET', '/api/dashboard')).body;
  assert.equal(dash.lowStockCount, 0);

  const list = (await c('GET', '/api/products?q=pen')).body.products;
  assert.deepEqual(list.map((p) => p.name), ['Red Pen']);

  // adjust stock down below threshold
  r = await c('POST', `/api/products/${penId}/adjust`, { delta: -45, note: 'sold' });
  assert.equal(r.status, 200);
  assert.equal(r.body.product.quantityOnHand, 5);
  assert.equal(r.body.product.lastStockNote, 'sold');
  dash = (await c('GET', '/api/dashboard')).body;
  assert.deepEqual(dash.lowStock.map((p) => p.name), ['Red Pen']);

  // cannot go below zero, and zero delta is invalid
  assert.equal((await c('POST', `/api/products/${penId}/adjust`, { delta: -100 })).status, 409);
  assert.equal((await c('POST', `/api/products/${penId}/adjust`, { delta: 0 })).status, 422);

  // read + edit
  assert.equal((await c('GET', `/api/products/${penId}`)).body.product.sku, 'PEN-1');
  r = await c('PUT', `/api/products/${penId}`, { name: 'Red Pen XL', sku: 'PEN-1', quantityOnHand: 20, lowStockThreshold: 10 });
  assert.equal(r.status, 200);
  assert.equal(r.body.product.name, 'Red Pen XL');

  // delete
  assert.equal((await c('DELETE', `/api/products/${penId}`)).status, 200);
  assert.equal((await c('GET', `/api/products/${penId}`)).status, 404);
  assert.equal((await c('GET', '/api/products')).body.products.length, 1);
});

test("organizations cannot see or change each other's products", async () => {
  const a = client();
  await signup(a, 'owner@c.com', 'Store C');
  const id = (await a('POST', '/api/products', { name: 'Secret Widget', sku: 'SW-1', quantityOnHand: 7 })).body.product.id;

  const b = client();
  await signup(b, 'owner@d.com', 'Store D');
  assert.equal((await b('GET', '/api/products')).body.products.length, 0);
  assert.equal((await b('GET', `/api/products/${id}`)).status, 404);
  assert.equal((await b('PUT', `/api/products/${id}`, { name: 'Hacked', sku: 'SW-1', quantityOnHand: 0 })).status, 404);
  assert.equal((await b('POST', `/api/products/${id}/adjust`, { delta: 5 })).status, 404);
  assert.equal((await b('DELETE', `/api/products/${id}`)).status, 404);

  // same SKU is allowed in a different org
  assert.equal((await b('POST', '/api/products', { name: 'My Widget', sku: 'SW-1', quantityOnHand: 1 })).status, 201);
  assert.equal((await a('GET', `/api/products/${id}`)).body.product.name, 'Secret Widget');
});
