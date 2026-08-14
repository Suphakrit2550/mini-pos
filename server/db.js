// ฐานข้อมูล PostgreSQL (Supabase) — ตารางสินค้า, ยอดขาย, ผู้ใช้, session ฯลฯ

const { Pool, types } = require('pg');

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is not set — start the server with `node --env-file=.env server/index.js`');
}

// created_at/updated_at/voided_at are "local wall-clock display strings" —
// every route and frontend page slices them as plain YYYY-MM-DD HH:MM:SS
// text (e.g. .slice(0, 10) for the date part). Returning them as JS Date
// objects here would let Node's own timezone interpretation collide with
// Postgres's, so the raw wire-format string is passed through untouched
// instead (oid 1114 = timestamp without time zone).
types.setTypeParser(1114, (val) => val.slice(0, 19));
// Same reasoning for plain DATE columns/casts (oid 1082, e.g. created_at::date
// used for report grouping) — keep the plain "YYYY-MM-DD" string Postgres
// sends on the wire instead of a Date object.
types.setTypeParser(1082, (val) => val);

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

// Match the shop's local time so CURRENT_TIMESTAMP lines up with what
// SQLite's datetime('now', 'localtime') used to produce. The `options`
// startup parameter doesn't reliably reach Postgres through Supabase's
// pooler, so this is set explicitly on every new connection instead.
pool.on('connect', (client) => {
  client.query("SET TIME ZONE 'Asia/Bangkok'");
});

function query(text, params) {
  return pool.query(text, params);
}

// Money is stored as INTEGER satang (1 บาท = 100 สตางค์) everywhere.
// Never store money as REAL/NUMERIC-with-decimals — integer arithmetic
// avoids float rounding drift.
const SCHEMA = `
  CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'staff',
    active BOOLEAN NOT NULL DEFAULT TRUE,
    failed_attempts INTEGER NOT NULL DEFAULT 0,
    locked_until TIMESTAMPTZ,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS products (
    id SERIAL PRIMARY KEY,
    owner_id INTEGER REFERENCES users(id),
    name TEXT NOT NULL,
    name_en TEXT,
    sku TEXT,
    category TEXT,
    barcode TEXT,
    price_satang INTEGER NOT NULL,
    cost_satang INTEGER NOT NULL DEFAULT 0,
    stock INTEGER NOT NULL DEFAULT 0,
    low_stock_threshold INTEGER NOT NULL DEFAULT 5,
    image TEXT,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  -- Barcodes are unique per owner, not shop-wide — two separate accounts
  -- can each stock an item with the same barcode. Unique among non-null
  -- values only, since a NULL barcode means "no barcode set".
  CREATE UNIQUE INDEX IF NOT EXISTS idx_products_owner_barcode
    ON products(owner_id, barcode) WHERE barcode IS NOT NULL;

  -- Sales rows are append-only: a bill's id is its bill number, and rows
  -- are NEVER deleted, so bill numbers stay strictly sequential with no
  -- gaps or reuse. Cancel/refund is a status change (voided_*), not a delete.
  CREATE TABLE IF NOT EXISTS sales (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id),
    customer_name TEXT,
    total_satang INTEGER NOT NULL,
    payment_method TEXT NOT NULL DEFAULT 'cash',
    received_amount_satang INTEGER,
    change_amount_satang INTEGER,
    status TEXT NOT NULL DEFAULT 'completed',
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    voided_at TIMESTAMP,
    voided_reason TEXT,
    voided_by TEXT
  );

  CREATE TABLE IF NOT EXISTS sale_items (
    id SERIAL PRIMARY KEY,
    sale_id INTEGER NOT NULL REFERENCES sales(id),
    product_id INTEGER REFERENCES products(id) ON DELETE SET NULL,
    name TEXT NOT NULL,
    price_satang INTEGER NOT NULL,
    cost_satang INTEGER NOT NULL DEFAULT 0,
    quantity INTEGER NOT NULL,
    subtotal_satang INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS stock_movements (
    id SERIAL PRIMARY KEY,
    product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    change INTEGER NOT NULL,
    reason TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  -- Records who did what, when, and why for sensitive actions
  -- (cancel / refund / product edit / product delete / stock adjust /
  -- user management).
  CREATE TABLE IF NOT EXISTS audit_log (
    id SERIAL PRIMARY KEY,
    entity_type TEXT NOT NULL,
    entity_id INTEGER NOT NULL,
    action TEXT NOT NULL,
    actor TEXT NOT NULL,
    reason TEXT,
    detail TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  -- Single-row table with shop info shown on printed receipts.
  CREATE TABLE IF NOT EXISTS settings (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    shop_name TEXT NOT NULL DEFAULT 'Mini POS',
    address TEXT,
    phone TEXT,
    receipt_footer TEXT
  );
`;

async function initSchema() {
  await pool.query(SCHEMA);
  await pool.query(
    `INSERT INTO settings (id, shop_name) VALUES (1, 'Mini POS') ON CONFLICT (id) DO NOTHING`
  );
}

module.exports = { pool, query, initSchema };
