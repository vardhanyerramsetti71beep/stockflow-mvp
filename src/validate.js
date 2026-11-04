// Small form validators. Each returns { values, errors }.

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function str(v) {
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  return typeof v === 'string' ? v.trim() : '';
}

function optionalNumber(raw, label, errors, { integer = false, min = 0 } = {}) {
  const v = str(raw);
  if (v === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n) || (integer && !Number.isInteger(n))) {
    errors[label.key] = `${label.name} must be ${integer ? 'a whole number' : 'a number'}.`;
    return null;
  }
  if (n < min) {
    errors[label.key] = `${label.name} cannot be less than ${min}.`;
    return null;
  }
  return n;
}

function signup(body) {
  const errors = {};
  const values = {
    email: str(body.email).toLowerCase(),
    organizationName: str(body.organizationName),
  };
  const password = typeof body.password === 'string' ? body.password : '';
  const confirm = typeof body.confirmPassword === 'string' ? body.confirmPassword : '';

  if (!EMAIL_RE.test(values.email)) errors.email = 'Enter a valid email address.';
  if (password.length < 8) errors.password = 'Password must be at least 8 characters.';
  if (password !== confirm) errors.confirmPassword = 'Passwords do not match.';
  if (!values.organizationName) errors.organizationName = 'Organization name is required.';
  else if (values.organizationName.length > 100) errors.organizationName = 'Keep it under 100 characters.';

  return { values: { ...values, password }, errors };
}

function login(body) {
  const errors = {};
  const values = { email: str(body.email).toLowerCase(), password: typeof body.password === 'string' ? body.password : '' };
  if (!EMAIL_RE.test(values.email)) errors.email = 'Enter a valid email address.';
  if (!values.password) errors.password = 'Password is required.';
  return { values, errors };
}

function product(body) {
  const errors = {};
  const values = {
    name: str(body.name),
    sku: str(body.sku),
    description: str(body.description) || null,
  };
  if (!values.name) errors.name = 'Name is required.';
  else if (values.name.length > 200) errors.name = 'Keep the name under 200 characters.';
  if (!values.sku) errors.sku = 'SKU is required.';
  else if (!/^[A-Za-z0-9._\-\/]{1,64}$/.test(values.sku)) errors.sku = 'SKU may use letters, numbers, . _ - / (max 64).';

  const qty = optionalNumber(body.quantityOnHand, { key: 'quantityOnHand', name: 'Quantity on hand' }, errors, { integer: true });
  values.quantityOnHand = qty ?? 0;
  values.costPrice = optionalNumber(body.costPrice, { key: 'costPrice', name: 'Cost price' }, errors);
  values.sellingPrice = optionalNumber(body.sellingPrice, { key: 'sellingPrice', name: 'Selling price' }, errors);
  values.lowStockThreshold = optionalNumber(body.lowStockThreshold, { key: 'lowStockThreshold', name: 'Low stock threshold' }, errors, { integer: true });
  return { values, errors };
}

function adjustment(body) {
  const errors = {};
  const raw = str(body.delta);
  const delta = Number(raw);
  if (raw === '' || !Number.isInteger(delta) || delta === 0) errors.delta = 'Enter a non-zero whole number, e.g. +5 or -3.';
  const note = str(body.note).slice(0, 200) || null;
  return { values: { delta, note }, errors };
}

function settings(body) {
  const errors = {};
  const v = optionalNumber(body.defaultLowStockThreshold, { key: 'defaultLowStockThreshold', name: 'Default threshold' }, errors, { integer: true });
  if (v === null && !errors.defaultLowStockThreshold) errors.defaultLowStockThreshold = 'Default threshold is required.';
  return { values: { defaultLowStockThreshold: v }, errors };
}

module.exports = { signup, login, product, adjustment, settings };
