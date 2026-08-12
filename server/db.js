const path = require('path');
const Database = require('better-sqlite3');

const dbPath = path.join(__dirname, 'data', 'pos.db');
const db = new Database(dbPath);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Money is stored as INTEGER satang (1 บาท = 100 สตางค์) everywhere.
// Never store money as REAL — integer arithmetic avoids float rounding drift.
db.exec(`
  CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
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
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
  );

  -- Sales rows are append-only: a bill's id is its bill number, and rows are
  -- NEVER deleted, so bill numbers stay strictly sequential with no gaps or
  -- reuse. Cancel/refund is a status change (voided_*), not a delete.
  CREATE TABLE IF NOT EXISTS sales (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER REFERENCES users(id),
    customer_name TEXT,
    total_satang INTEGER NOT NULL,
    payment_method TEXT NOT NULL DEFAULT 'cash',
    received_amount_satang INTEGER,
    change_amount_satang INTEGER,
    status TEXT NOT NULL DEFAULT 'completed',
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    voided_at TEXT,
    voided_reason TEXT,
    voided_by TEXT
  );

  CREATE TABLE IF NOT EXISTS sale_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sale_id INTEGER NOT NULL REFERENCES sales(id),
    product_id INTEGER REFERENCES products(id) ON DELETE SET NULL,
    name TEXT NOT NULL,
    price_satang INTEGER NOT NULL,
    cost_satang INTEGER NOT NULL DEFAULT 0,
    quantity INTEGER NOT NULL,
    subtotal_satang INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS stock_movements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    change INTEGER NOT NULL,
    reason TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
  );

  -- Records who did what, when, and why for sensitive actions
  -- (cancel / refund / product edit / product delete / stock adjust).
  CREATE TABLE IF NOT EXISTS audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    entity_type TEXT NOT NULL,
    entity_id INTEGER NOT NULL,
    action TEXT NOT NULL,
    actor TEXT NOT NULL,
    reason TEXT,
    detail TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
  );

  -- Single-row table with shop info shown on printed receipts.
  CREATE TABLE IF NOT EXISTS settings (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    shop_name TEXT NOT NULL DEFAULT 'Mini POS',
    address TEXT,
    phone TEXT,
    receipt_footer TEXT
  );

  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'staff',
    active INTEGER NOT NULL DEFAULT 1,
    failed_attempts INTEGER NOT NULL DEFAULT 0,
    locked_until TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
  );
`);

const productColumns = db.prepare("PRAGMA table_info(products)").all().map(c => c.name);
if (!productColumns.includes('barcode')) {
  db.exec('ALTER TABLE products ADD COLUMN barcode TEXT');
}
if (!productColumns.includes('owner_id')) {
  db.exec('ALTER TABLE products ADD COLUMN owner_id INTEGER REFERENCES users(id)');
}

const salesColumns = db.prepare("PRAGMA table_info(sales)").all().map(c => c.name);
if (!salesColumns.includes('user_id')) {
  db.exec('ALTER TABLE sales ADD COLUMN user_id INTEGER REFERENCES users(id)');
}

const userColumns = db.prepare("PRAGMA table_info(users)").all().map(c => c.name);
if (!userColumns.includes('role')) {
  db.exec("ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'staff'");
  // Accounts created before roles existed were, by definition, the shop
  // owner's original single account — promote them so nobody gets locked
  // out of the admin screen after this upgrade.
  db.exec("UPDATE users SET role = 'admin'");
}
if (!userColumns.includes('active')) {
  db.exec('ALTER TABLE users ADD COLUMN active INTEGER NOT NULL DEFAULT 1');
}
if (!userColumns.includes('failed_attempts')) {
  db.exec('ALTER TABLE users ADD COLUMN failed_attempts INTEGER NOT NULL DEFAULT 0');
}
if (!userColumns.includes('locked_until')) {
  db.exec('ALTER TABLE users ADD COLUMN locked_until TEXT');
}

// Products/sales created before per-account inventories existed belonged to
// whichever account was around at the time — the earliest admin account is
// the closest honest owner for that history. No-op once already backfilled.
const legacyOwner = db.prepare("SELECT id FROM users WHERE role = 'admin' ORDER BY id LIMIT 1").get();
if (legacyOwner) {
  db.prepare('UPDATE products SET owner_id = ? WHERE owner_id IS NULL').run(legacyOwner.id);
  db.prepare('UPDATE sales SET user_id = ? WHERE user_id IS NULL').run(legacyOwner.id);
}

// Barcodes are unique per owner, not shop-wide — two separate accounts can
// each stock an item with the same barcode. Unique among non-null values
// only, since SQLite unique indexes treat NULL as distinct from every value.
db.exec('DROP INDEX IF EXISTS idx_products_barcode');
db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_products_owner_barcode ON products(owner_id, barcode) WHERE barcode IS NOT NULL');

db.prepare('INSERT OR IGNORE INTO settings (id, shop_name) VALUES (1, ?)').run('Mini POS');

module.exports = db;
