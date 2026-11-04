// Postgres database access.
// - Production (Vercel): set DATABASE_URL (or POSTGRES_URL) to a hosted Postgres such as Neon.
// - Local dev / tests: no URL needed; an embedded Postgres (PGlite) is used instead.
//   PGLITE_DIR controls where it stores data (default ./data/pgdata, "memory://" for in-memory).
const path = require('node:path');

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS organizations (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    default_low_stock_threshold INTEGER NOT NULL DEFAULT 5,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );

  CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    email TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE UNIQUE INDEX IF NOT EXISTS users_email_unique ON users (lower(email));

  CREATE TABLE IF NOT EXISTS products (
    id SERIAL PRIMARY KEY,
    organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    sku TEXT NOT NULL,
    description TEXT,
    quantity_on_hand INTEGER NOT NULL DEFAULT 0,
    cost_price DOUBLE PRECISION,
    selling_price DOUBLE PRECISION,
    low_stock_threshold INTEGER,
    last_updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    last_stock_note TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE UNIQUE INDEX IF NOT EXISTS products_org_sku_unique ON products (organization_id, lower(sku));
  CREATE INDEX IF NOT EXISTS products_org_idx ON products (organization_id);
`;

const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;

// Errors raised while *opening* a connection (nothing was sent yet), so retrying is safe.
// Neon's free tier sleeps when idle and the first connection after waking can be reset.
function isConnectError(err) {
  if (!err) return false;
  if (['ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'ENOTFOUND', 'EAI_AGAIN'].includes(err.code)) return true;
  return /before secure TLS connection|timeout exceeded when trying to connect|Connection terminated due to connection timeout/i.test(
    err.message || ''
  );
}

async function withRetry(fn, attempts = 4) {
  for (let i = 1; ; i++) {
    try {
      return await fn();
    } catch (err) {
      if (i >= attempts || !isConnectError(err)) throw err;
      await new Promise((r) => setTimeout(r, 250 * i * i));
    }
  }
}

function createDriver() {
  if (url) {
    const { Pool } = require('pg');
    // Neon URLs use sslmode=require; pg already treats it as verify-full, so say so explicitly.
    const connectionString = url.replace(/sslmode=(require|prefer|verify-ca)/, 'sslmode=verify-full');
    const pool = new Pool({
      connectionString,
      max: Number(process.env.PG_POOL_MAX) || 3,
      connectionTimeoutMillis: 10000,
      idleTimeoutMillis: 10000,
    });
    // An idle connection dropped by the server must not crash the process.
    pool.on('error', (err) => console.error('Postgres idle client error:', err.message));
    return {
      kind: 'postgres',
      query: (sql, params) => withRetry(() => pool.connect()).then(async (client) => {
        try {
          return await client.query(sql, params);
        } finally {
          client.release();
        }
      }),
      async tx(fn) {
        const client = await withRetry(() => pool.connect());
        try {
          await client.query('BEGIN');
          const result = await fn({ query: (sql, params) => client.query(sql, params) });
          await client.query('COMMIT');
          return result;
        } catch (err) {
          await client.query('ROLLBACK').catch(() => {});
          throw err;
        } finally {
          client.release();
        }
      },
      exec: (sql) => withRetry(() => pool.query(sql)),
    };
  }

  if (process.env.VERCEL) {
    throw new Error('DATABASE_URL is not set. Connect a Postgres database (e.g. Neon) to this Vercel project.');
  }

  const { PGlite } = require('@electric-sql/pglite');
  const dir = process.env.PGLITE_DIR || path.join(__dirname, '..', 'data', 'pgdata');
  const pg = dir === 'memory://' ? new PGlite() : new PGlite(dir);
  return {
    kind: 'pglite',
    query: (sql, params) => pg.query(sql, params),
    tx: (fn) => pg.transaction((t) => fn({ query: (sql, params) => t.query(sql, params) })),
    exec: (sql) => pg.exec(sql),
  };
}

const driver = createDriver();
// Create tables lazily on first use. If that fails (e.g. database waking up), forget the
// failure so the next request tries again instead of the instance staying broken.
// Two serverless instances starting at once can race on CREATE ... IF NOT EXISTS; retry once.
const RACE_CODES = new Set(['23505', '42P07', '42710']);
let schemaPromise = null;
function ready() {
  if (!schemaPromise) {
    schemaPromise = driver
      .exec(SCHEMA)
      .catch((err) => {
        if (RACE_CODES.has(err.code)) return driver.exec(SCHEMA);
        throw err;
      })
      .catch((err) => {
        schemaPromise = null;
        throw err;
      });
  }
  return schemaPromise;
}

async function query(sql, params = []) {
  await ready();
  return driver.query(sql, params);
}

async function one(sql, params) {
  return (await query(sql, params)).rows[0] || null;
}

async function many(sql, params) {
  return (await query(sql, params)).rows;
}

async function tx(fn) {
  await ready();
  return driver.tx(fn);
}

module.exports = { query, one, many, tx, ready, kind: driver.kind };
