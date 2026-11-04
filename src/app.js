// StockFlow backend: a JSON API under /api plus the static frontend in public/.
// Locally Express serves public/; on Vercel the CDN serves public/ and only /api hits this app.
const path = require('node:path');
const express = require('express');
const cookieSession = require('cookie-session');
const bcrypt = require('bcryptjs');
const db = require('./db');
const validate = require('./validate');

const app = express();
const isProd = process.env.NODE_ENV === 'production';
const PUBLIC_DIR = path.join(__dirname, '..', 'public');

if (isProd && !process.env.SESSION_SECRET) {
  throw new Error('SESSION_SECRET must be set in production.');
}

app.set('trust proxy', 1);
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

// Express 4 doesn't catch rejected promises; route async errors to the error handler.
const h = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// --- queries --------------------------------------------------------------

const PRODUCT_COLS = `id, organization_id, name, sku, description, quantity_on_hand, cost_price, selling_price,
  low_stock_threshold, last_updated_by, last_stock_note, created_at, updated_at`;

const q = {
  orgById: (id) => db.one('SELECT * FROM organizations WHERE id = $1', [id]),
  userByEmail: (email) => db.one('SELECT * FROM users WHERE lower(email) = lower($1)', [email]),
  productById: (id, orgId) =>
    db.one(`SELECT ${PRODUCT_COLS} FROM products WHERE id = $1 AND organization_id = $2`, [id, orgId]),
  productBySku: (orgId, sku) =>
    db.one('SELECT id FROM products WHERE organization_id = $1 AND lower(sku) = lower($2)', [orgId, sku]),
  listProducts: (orgId) =>
    db.many(`SELECT ${PRODUCT_COLS} FROM products WHERE organization_id = $1 ORDER BY lower(name), id`, [orgId]),
  searchProducts: (orgId, like) =>
    db.many(
      `SELECT ${PRODUCT_COLS} FROM products
       WHERE organization_id = $1 AND (name ILIKE $2 OR sku ILIKE $2)
       ORDER BY lower(name), id`,
      [orgId, like]
    ),
  insertProduct: (orgId, v, userId) =>
    db.one(
      `INSERT INTO products (organization_id, name, sku, description, quantity_on_hand, cost_price, selling_price,
         low_stock_threshold, last_updated_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING ${PRODUCT_COLS}`,
      [orgId, v.name, v.sku, v.description, v.quantityOnHand, v.costPrice, v.sellingPrice, v.lowStockThreshold, userId]
    ),
  updateProduct: (id, orgId, v, userId) =>
    db.one(
      `UPDATE products SET name = $1, sku = $2, description = $3, quantity_on_hand = $4, cost_price = $5,
         selling_price = $6, low_stock_threshold = $7, last_updated_by = $8, updated_at = now()
       WHERE id = $9 AND organization_id = $10 RETURNING ${PRODUCT_COLS}`,
      [v.name, v.sku, v.description, v.quantityOnHand, v.costPrice, v.sellingPrice, v.lowStockThreshold, userId, id, orgId]
    ),
  adjustStock: (id, orgId, delta, note, userId) =>
    db.one(
      `UPDATE products SET quantity_on_hand = quantity_on_hand + $1, last_updated_by = $2, last_stock_note = $3,
         updated_at = now()
       WHERE id = $4 AND organization_id = $5 AND quantity_on_hand + $1 >= 0 RETURNING ${PRODUCT_COLS}`,
      [delta, userId, note, id, orgId]
    ),
  deleteProduct: (id, orgId) => db.query('DELETE FROM products WHERE id = $1 AND organization_id = $2', [id, orgId]),
  summary: (orgId) =>
    db.one(
      `SELECT COUNT(*)::int AS total_products, COALESCE(SUM(quantity_on_hand), 0)::int AS total_quantity
       FROM products WHERE organization_id = $1`,
      [orgId]
    ),
  lowStock: (orgId) =>
    db.many(
      `SELECT ${PRODUCT_COLS.split(',').map((c) => 'p.' + c.trim()).join(', ')}
       FROM products p JOIN organizations o ON o.id = p.organization_id
       WHERE p.organization_id = $1
         AND p.quantity_on_hand <= COALESCE(p.low_stock_threshold, o.default_low_stock_threshold)
       ORDER BY p.quantity_on_hand ASC, lower(p.name), p.id`,
      [orgId]
    ),
  updateSettings: (orgId, threshold) =>
    db.query('UPDATE organizations SET default_low_stock_threshold = $1 WHERE id = $2', [threshold, orgId]),
};

// --- shaping --------------------------------------------------------------

function iso(d) {
  return d instanceof Date ? d.toISOString() : d;
}

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
    createdAt: iso(p.created_at),
    updatedAt: iso(p.updated_at),
  };
}

function toOrg(org) {
  return { id: org.id, name: org.name, defaultLowStockThreshold: org.default_low_stock_threshold };
}

function isUniqueViolation(err) {
  return err && err.code === '23505';
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

api.use(
  h(async (req, res, next) => {
    if (req.session.userId && req.session.orgId) {
      const org = await q.orgById(req.session.orgId);
      if (org) {
        req.org = org;
        req.user = { id: req.session.userId, email: req.session.email };
      } else {
        req.session = null;
      }
    }
    next();
  })
);

function requireAuth(req, res, next) {
  if (!req.org) return res.status(401).json({ error: 'Please log in.' });
  next();
}

const loadProduct = h(async (req, res, next) => {
  const id = Number(req.params.id);
  const product = Number.isInteger(id) && id > 0 && id < 2 ** 31 ? await q.productById(id, req.org.id) : null;
  if (!product) return res.status(404).json({ error: 'Product not found.' });
  req.product = product;
  next();
});

function invalid(res, errors) {
  return res.status(422).json({ error: 'Please fix the highlighted fields.', errors });
}

function startSession(req, user, orgId) {
  req.session.userId = user.id;
  req.session.orgId = orgId;
  req.session.email = user.email;
}

const SKU_TAKEN = 'This SKU is already used in your organization.';

// --- auth -----------------------------------------------------------------

api.post(
  '/auth/signup',
  h(async (req, res) => {
    const { values, errors } = validate.signup(req.body || {});
    if (!errors.email && (await q.userByEmail(values.email))) errors.email = 'An account with this email already exists.';
    if (Object.keys(errors).length) return invalid(res, errors);

    const hash = await bcrypt.hash(values.password, 10);
    let result;
    try {
      result = await db.tx(async (t) => {
        const org = (await t.query('INSERT INTO organizations (name) VALUES ($1) RETURNING *', [values.organizationName])).rows[0];
        const user = (
          await t.query('INSERT INTO users (organization_id, email, password_hash) VALUES ($1, $2, $3) RETURNING id, email', [
            org.id, values.email, hash,
          ])
        ).rows[0];
        return { org, user };
      });
    } catch (err) {
      if (isUniqueViolation(err)) return invalid(res, { email: 'An account with this email already exists.' });
      throw err;
    }
    startSession(req, result.user, result.org.id);
    res.status(201).json({ user: result.user, organization: toOrg(result.org) });
  })
);

api.post(
  '/auth/login',
  h(async (req, res) => {
    const { values, errors } = validate.login(req.body || {});
    if (Object.keys(errors).length) return invalid(res, errors);
    const user = await q.userByEmail(values.email);
    if (!user || !(await bcrypt.compare(values.password, user.password_hash))) {
      return res.status(401).json({ error: 'Incorrect email or password.' });
    }
    startSession(req, user, user.organization_id);
    res.json({ user: { id: user.id, email: user.email }, organization: toOrg(await q.orgById(user.organization_id)) });
  })
);

api.post('/auth/logout', (req, res) => {
  req.session = null;
  res.json({ ok: true });
});

api.get('/me', requireAuth, (req, res) => {
  res.json({ user: req.user, organization: toOrg(req.org) });
});

// --- dashboard ------------------------------------------------------------

api.get(
  '/dashboard',
  requireAuth,
  h(async (req, res) => {
    const [s, rows] = await Promise.all([q.summary(req.org.id), q.lowStock(req.org.id)]);
    const lowStock = rows.map((p) => toProduct(p, req.org));
    res.json({
      totalProducts: s.total_products,
      totalQuantity: s.total_quantity,
      lowStockCount: lowStock.length,
      lowStock,
      defaultLowStockThreshold: req.org.default_low_stock_threshold,
    });
  })
);

// --- products -------------------------------------------------------------

api.get(
  '/products',
  requireAuth,
  h(async (req, res) => {
    const search = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 100) : '';
    const rows = search
      ? await q.searchProducts(req.org.id, `%${search.replace(/[\\%_]/g, (c) => '\\' + c)}%`)
      : await q.listProducts(req.org.id);
    res.json({ products: rows.map((p) => toProduct(p, req.org)) });
  })
);

api.post(
  '/products',
  requireAuth,
  h(async (req, res) => {
    const { values, errors } = validate.product(req.body || {});
    if (!errors.sku && (await q.productBySku(req.org.id, values.sku))) errors.sku = SKU_TAKEN;
    if (Object.keys(errors).length) return invalid(res, errors);
    try {
      const p = await q.insertProduct(req.org.id, values, req.user.id);
      res.status(201).json({ product: toProduct(p, req.org) });
    } catch (err) {
      if (isUniqueViolation(err)) return invalid(res, { sku: SKU_TAKEN });
      throw err;
    }
  })
);

api.get('/products/:id', requireAuth, loadProduct, (req, res) => {
  res.json({ product: toProduct(req.product, req.org) });
});

api.put(
  '/products/:id',
  requireAuth,
  loadProduct,
  h(async (req, res) => {
    const { values, errors } = validate.product(req.body || {});
    if (!errors.sku) {
      const clash = await q.productBySku(req.org.id, values.sku);
      if (clash && clash.id !== req.product.id) errors.sku = SKU_TAKEN;
    }
    if (Object.keys(errors).length) return invalid(res, errors);
    try {
      const p = await q.updateProduct(req.product.id, req.org.id, values, req.user.id);
      res.json({ product: toProduct(p, req.org) });
    } catch (err) {
      if (isUniqueViolation(err)) return invalid(res, { sku: SKU_TAKEN });
      throw err;
    }
  })
);

api.post(
  '/products/:id/adjust',
  requireAuth,
  loadProduct,
  h(async (req, res) => {
    const { values, errors } = validate.adjustment(req.body || {});
    if (Object.keys(errors).length) return invalid(res, errors);
    const p = await q.adjustStock(req.product.id, req.org.id, values.delta, values.note, req.user.id);
    if (!p) return res.status(409).json({ error: `Stock for "${req.product.name}" cannot go below zero.` });
    res.json({ product: toProduct(p, req.org) });
  })
);

api.delete(
  '/products/:id',
  requireAuth,
  loadProduct,
  h(async (req, res) => {
    await q.deleteProduct(req.product.id, req.org.id);
    res.json({ ok: true });
  })
);

// --- settings -------------------------------------------------------------

api.get('/settings', requireAuth, (req, res) => {
  res.json({ defaultLowStockThreshold: req.org.default_low_stock_threshold });
});

api.put(
  '/settings',
  requireAuth,
  h(async (req, res) => {
    const { values, errors } = validate.settings(req.body || {});
    if (Object.keys(errors).length) return invalid(res, errors);
    await q.updateSettings(req.org.id, values.defaultLowStockThreshold);
    res.json({ defaultLowStockThreshold: values.defaultLowStockThreshold });
  })
);

api.use((req, res) => res.status(404).json({ error: 'Not found.' }));

// --- wiring ---------------------------------------------------------------

app.get(
  '/api/health',
  h(async (req, res) => {
    await db.query('SELECT 1');
    res.json({ ok: true, db: db.kind });
  })
);
app.get('/health', (req, res) => res.redirect(307, '/api/health'));
app.use('/api', api);
app.use(express.static(PUBLIC_DIR, { extensions: ['html'] }));
app.use((req, res) => {
  res.status(404).sendFile(path.join(PUBLIC_DIR, '404.html'), (err) => {
    if (err && !res.headersSent) res.type('text').send('Page not found.');
  });
});

app.use((err, req, res, _next) => {
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON.' });
  console.error(err);
  if (res.headersSent) return;
  if (req.path.startsWith('/api')) return res.status(500).json({ error: 'Something went wrong. Please try again.' });
  res.status(500).type('text').send('Something went wrong.');
});

module.exports = app;
