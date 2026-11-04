// StockFlow backend: serves the static frontend (public/) and a JSON API (/api).
const path = require('node:path');
const express = require('express');
const cookieSession = require('cookie-session');
const bcrypt = require('bcryptjs');
const db = require('./db');
const validate = require('./validate');

const app = express();
const isProd = process.env.NODE_ENV === 'production';
const PUBLIC_DIR = path.join(__dirname, '..', 'public');

if (isProd) app.set('trust proxy', 1);
app.disable('x-powered-by');

app.use(express.json({ limit: '20kb' }));
app.use(
  cookieSession({
    name: 'stockflow_session',
    secret: process.env.SESSION_SECRET || 'dev-only-secret-change-me',
    httpOnly: true,
    sameSite: 'lax',
    secure: isProd,
    maxAge: 7 * 24 * 60 * 60 * 1000,
  })
);

// --- queries --------------------------------------------------------------

const q = {
  orgById: db.prepare('SELECT * FROM organizations WHERE id = ?'),
  userByEmail: db.prepare('SELECT * FROM users WHERE email = ?'),
  insertOrg: db.prepare('INSERT INTO organizations (name) VALUES (?)'),
  insertUser: db.prepare('INSERT INTO users (organization_id, email, password_hash) VALUES (?, ?, ?)'),
  productById: db.prepare('SELECT * FROM products WHERE id = ? AND organization_id = ?'),
  productBySku: db.prepare('SELECT id FROM products WHERE organization_id = ? AND sku = ?'),
  listProducts: db.prepare('SELECT * FROM products WHERE organization_id = ? ORDER BY name COLLATE NOCASE'),
  searchProducts: db.prepare(
    `SELECT * FROM products WHERE organization_id = ? AND (name LIKE ? ESCAPE '\\' OR sku LIKE ? ESCAPE '\\')
     ORDER BY name COLLATE NOCASE`
  ),
  insertProduct: db.prepare(
    `INSERT INTO products (organization_id, name, sku, description, quantity_on_hand, cost_price, selling_price,
       low_stock_threshold, last_updated_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ),
  updateProduct: db.prepare(
    `UPDATE products SET name = ?, sku = ?, description = ?, quantity_on_hand = ?, cost_price = ?, selling_price = ?,
       low_stock_threshold = ?, last_updated_by = ?, updated_at = datetime('now')
     WHERE id = ? AND organization_id = ?`
  ),
  adjustStock: db.prepare(
    `UPDATE products SET quantity_on_hand = quantity_on_hand + ?, last_updated_by = ?, last_stock_note = ?,
       updated_at = datetime('now')
     WHERE id = ? AND organization_id = ? AND quantity_on_hand + ? >= 0`
  ),
  deleteProduct: db.prepare('DELETE FROM products WHERE id = ? AND organization_id = ?'),
  summary: db.prepare(
    'SELECT COUNT(*) AS total_products, COALESCE(SUM(quantity_on_hand), 0) AS total_quantity FROM products WHERE organization_id = ?'
  ),
  lowStock: db.prepare(
    `SELECT p.*, COALESCE(p.low_stock_threshold, o.default_low_stock_threshold) AS effective_threshold
     FROM products p JOIN organizations o ON o.id = p.organization_id
     WHERE p.organization_id = ? AND p.quantity_on_hand <= COALESCE(p.low_stock_threshold, o.default_low_stock_threshold)
     ORDER BY p.quantity_on_hand ASC, p.name COLLATE NOCASE`
  ),
  updateSettings: db.prepare('UPDATE organizations SET default_low_stock_threshold = ? WHERE id = ?'),
};

// --- shaping --------------------------------------------------------------

function toProduct(p, org) {
  const threshold = p.low_stock_threshold ?? org.default_low_stock_threshold;
  return {
    id: p.id,
    name: p.name,
    sku: p.sku,
    description: p.description,
    quantityOnHand: p.quantity_on_hand,
    costPrice: p.cost_price,
    sellingPrice: p.selling_price,
    lowStockThreshold: p.low_stock_threshold,
    effectiveThreshold: threshold,
    isLowStock: p.quantity_on_hand <= threshold,
    lastStockNote: p.last_stock_note,
    createdAt: p.created_at,
    updatedAt: p.updated_at,
  };
}

function toOrg(org) {
  return { id: org.id, name: org.name, defaultLowStockThreshold: org.default_low_stock_threshold };
}

// --- middleware -----------------------------------------------------------

const api = express.Router();

// CSRF guard: browsers can't send a custom header cross-site without CORS approval,
// so requiring it on every write blocks forged requests from other sites.
api.use((req, res, next) => {
  if (req.method !== 'GET' && req.get('X-Requested-With') !== 'StockFlow') {
    return res.status(403).json({ error: 'Missing request header.' });
  }
  next();
});

api.use((req, res, next) => {
  if (req.session.userId && req.session.orgId) {
    const org = q.orgById.get(req.session.orgId);
    if (org) {
      req.org = org;
      req.user = { id: req.session.userId, email: req.session.email };
    } else {
      req.session = null;
    }
  }
  next();
});

function requireAuth(req, res, next) {
  if (!req.org) return res.status(401).json({ error: 'Please log in.' });
  next();
}

function loadProduct(req, res, next) {
  const id = Number(req.params.id);
  const product = Number.isInteger(id) ? q.productById.get(id, req.org.id) : null;
  if (!product) return res.status(404).json({ error: 'Product not found.' });
  req.product = product;
  next();
}

function invalid(res, errors) {
  return res.status(422).json({ error: 'Please fix the highlighted fields.', errors });
}

function startSession(req, user, orgId) {
  req.session.userId = user.id;
  req.session.orgId = orgId;
  req.session.email = user.email;
}

// --- auth -----------------------------------------------------------------

api.post('/auth/signup', (req, res) => {
  const { values, errors } = validate.signup(req.body || {});
  if (!errors.email && q.userByEmail.get(values.email)) errors.email = 'An account with this email already exists.';
  if (Object.keys(errors).length) return invalid(res, errors);

  const hash = bcrypt.hashSync(values.password, 10);
  let userId;
  let orgId;
  db.exec('BEGIN');
  try {
    orgId = Number(q.insertOrg.run(values.organizationName).lastInsertRowid);
    userId = Number(q.insertUser.run(orgId, values.email, hash).lastInsertRowid);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  startSession(req, { id: userId, email: values.email }, orgId);
  res.status(201).json({ user: { id: userId, email: values.email }, organization: toOrg(q.orgById.get(orgId)) });
});

api.post('/auth/login', (req, res) => {
  const { values, errors } = validate.login(req.body || {});
  if (Object.keys(errors).length) return invalid(res, errors);
  const user = q.userByEmail.get(values.email);
  if (!user || !bcrypt.compareSync(values.password, user.password_hash)) {
    return res.status(401).json({ error: 'Incorrect email or password.' });
  }
  startSession(req, user, user.organization_id);
  res.json({ user: { id: user.id, email: user.email }, organization: toOrg(q.orgById.get(user.organization_id)) });
});

api.post('/auth/logout', (req, res) => {
  req.session = null;
  res.json({ ok: true });
});

api.get('/me', requireAuth, (req, res) => {
  res.json({ user: req.user, organization: toOrg(req.org) });
});

// --- dashboard ------------------------------------------------------------

api.get('/dashboard', requireAuth, (req, res) => {
  const s = q.summary.get(req.org.id);
  const lowStock = q.lowStock.all(req.org.id).map((p) => toProduct(p, req.org));
  res.json({
    totalProducts: s.total_products,
    totalQuantity: s.total_quantity,
    lowStockCount: lowStock.length,
    lowStock,
    defaultLowStockThreshold: req.org.default_low_stock_threshold,
  });
});

// --- products -------------------------------------------------------------

api.get('/products', requireAuth, (req, res) => {
  const search = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  let rows;
  if (search) {
    const like = `%${search.replace(/[\\%_]/g, (c) => '\\' + c)}%`;
    rows = q.searchProducts.all(req.org.id, like, like);
  } else {
    rows = q.listProducts.all(req.org.id);
  }
  res.json({ products: rows.map((p) => toProduct(p, req.org)) });
});

api.post('/products', requireAuth, (req, res) => {
  const { values, errors } = validate.product(req.body || {});
  if (!errors.sku && q.productBySku.get(req.org.id, values.sku)) errors.sku = 'This SKU is already used in your organization.';
  if (Object.keys(errors).length) return invalid(res, errors);
  const id = Number(
    q.insertProduct.run(
      req.org.id, values.name, values.sku, values.description, values.quantityOnHand,
      values.costPrice, values.sellingPrice, values.lowStockThreshold, req.user.id
    ).lastInsertRowid
  );
  res.status(201).json({ product: toProduct(q.productById.get(id, req.org.id), req.org) });
});

api.get('/products/:id', requireAuth, loadProduct, (req, res) => {
  res.json({ product: toProduct(req.product, req.org) });
});

api.put('/products/:id', requireAuth, loadProduct, (req, res) => {
  const { values, errors } = validate.product(req.body || {});
  if (!errors.sku) {
    const clash = q.productBySku.get(req.org.id, values.sku);
    if (clash && clash.id !== req.product.id) errors.sku = 'This SKU is already used in your organization.';
  }
  if (Object.keys(errors).length) return invalid(res, errors);
  q.updateProduct.run(
    values.name, values.sku, values.description, values.quantityOnHand, values.costPrice, values.sellingPrice,
    values.lowStockThreshold, req.user.id, req.product.id, req.org.id
  );
  res.json({ product: toProduct(q.productById.get(req.product.id, req.org.id), req.org) });
});

api.post('/products/:id/adjust', requireAuth, loadProduct, (req, res) => {
  const { values, errors } = validate.adjustment(req.body || {});
  if (Object.keys(errors).length) return invalid(res, errors);
  const result = q.adjustStock.run(values.delta, req.user.id, values.note, req.product.id, req.org.id, values.delta);
  if (result.changes === 0) {
    return res.status(409).json({ error: `Stock for "${req.product.name}" cannot go below zero.` });
  }
  res.json({ product: toProduct(q.productById.get(req.product.id, req.org.id), req.org) });
});

api.delete('/products/:id', requireAuth, loadProduct, (req, res) => {
  q.deleteProduct.run(req.product.id, req.org.id);
  res.json({ ok: true });
});

// --- settings -------------------------------------------------------------

api.get('/settings', requireAuth, (req, res) => {
  res.json({ defaultLowStockThreshold: req.org.default_low_stock_threshold });
});

api.put('/settings', requireAuth, (req, res) => {
  const { values, errors } = validate.settings(req.body || {});
  if (Object.keys(errors).length) return invalid(res, errors);
  q.updateSettings.run(values.defaultLowStockThreshold, req.org.id);
  res.json({ defaultLowStockThreshold: values.defaultLowStockThreshold });
});

api.use((req, res) => res.status(404).json({ error: 'Not found.' }));

// --- wiring ---------------------------------------------------------------

app.get('/health', (req, res) => res.json({ ok: true }));
app.use('/api', api);
app.use(express.static(PUBLIC_DIR, { extensions: ['html'] }));
app.use((req, res) => res.status(404).sendFile(path.join(PUBLIC_DIR, '404.html')));

app.use((err, req, res, _next) => {
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON.' });
  console.error(err);
  if (req.path.startsWith('/api')) return res.status(500).json({ error: 'Something went wrong. Please try again.' });
  res.status(500).send('Something went wrong.');
});

module.exports = app;
