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

function createDriver() {
  if (url) {
    const { Pool } = require('pg');
    const pool = new Pool({ connectionString: url, max: Number(process.env.PG_POOL_MAX) || 3 });
    return {
      kind: 'postgres',
      query: (sql, params) => pool.query(sql, params),
      async tx(fn) {
        const client = await pool.connect();
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
      exec: (sql) => pool.query(sql),
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
// Two serverless instances starting at once can race on CREATE ... IF NOT EXISTS; retry once.
const RACE_CODES = new Set(['23505', '42P07', '42710']);
const ready = driver.exec(SCHEMA).catch((err) => {
  if (RACE_CODES.has(err.code)) return driver.exec(SCHEMA);
  throw err;
});

async function query(sql, params = []) {
  await ready;
  return driver.query(sql, params);
}

async function one(sql, params) {
  return (await query(sql, params)).rows[0] || null;
}

async function many(sql, params) {
  return (await query(sql, params)).rows;
}

async function tx(fn) {
  await ready;
  return driver.tx(fn);
}

module.exports = { query, one, many, tx, ready, kind: driver.kind };
