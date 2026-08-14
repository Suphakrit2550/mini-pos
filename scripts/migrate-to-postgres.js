// One-off migration: copies every row out of the old SQLite database
// (server/data/pos.db) into the new Supabase Postgres database, preserving
// ids so foreign keys (sale_items -> sales/products, etc.) stay intact.
// Run once with: node --env-file=.env scripts/migrate-to-postgres.js

const path = require('path');
const Database = require('better-sqlite3');
const { pool, initSchema } = require('../server/db');

const sqlitePath = path.join(__dirname, '..', 'server', 'data', 'pos.db');
const sqlite = new Database(sqlitePath, { readonly: true });

async function resetSequence(client, table) {
  await client.query(
    `SELECT setval(pg_get_serial_sequence($1, 'id'), COALESCE((SELECT MAX(id) FROM ${table}), 1), (SELECT MAX(id) FROM ${table}) IS NOT NULL)`,
    [table]
  );
}

async function main() {
  await initSchema();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const users = sqlite.prepare('SELECT * FROM users').all();
    for (const u of users) {
      await client.query(
        `INSERT INTO users (id, username, password_hash, role, active, failed_attempts, locked_until, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (id) DO NOTHING`,
        [u.id, u.username, u.password_hash, u.role, !!u.active, u.failed_attempts, u.locked_until, u.created_at]
      );
    }
    await resetSequence(client, 'users');
    console.log(`users: ${users.length}`);

    const products = sqlite.prepare('SELECT * FROM products').all();
    for (const p of products) {
      await client.query(
        `INSERT INTO products (id, owner_id, name, name_en, sku, category, barcode, price_satang, cost_satang, stock, low_stock_threshold, image, active, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
         ON CONFLICT (id) DO NOTHING`,
        [p.id, p.owner_id, p.name, p.name_en, p.sku, p.category, p.barcode, p.price_satang, p.cost_satang, p.stock, p.low_stock_threshold, p.image, !!p.active, p.created_at, p.updated_at]
      );
    }
    await resetSequence(client, 'products');
    console.log(`products: ${products.length}`);

    const sales = sqlite.prepare('SELECT * FROM sales').all();
    for (const s of sales) {
      await client.query(
        `INSERT INTO sales (id, user_id, customer_name, total_satang, payment_method, received_amount_satang, change_amount_satang, status, created_at, voided_at, voided_reason, voided_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
         ON CONFLICT (id) DO NOTHING`,
        [s.id, s.user_id, s.customer_name, s.total_satang, s.payment_method, s.received_amount_satang, s.change_amount_satang, s.status, s.created_at, s.voided_at, s.voided_reason, s.voided_by]
      );
    }
    await resetSequence(client, 'sales');
    console.log(`sales: ${sales.length}`);

    const saleItems = sqlite.prepare('SELECT * FROM sale_items').all();
    for (const si of saleItems) {
      await client.query(
        `INSERT INTO sale_items (id, sale_id, product_id, name, price_satang, cost_satang, quantity, subtotal_satang)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         ON CONFLICT (id) DO NOTHING`,
        [si.id, si.sale_id, si.product_id, si.name, si.price_satang, si.cost_satang, si.quantity, si.subtotal_satang]
      );
    }
    await resetSequence(client, 'sale_items');
    console.log(`sale_items: ${saleItems.length}`);

    const stockMovements = sqlite.prepare('SELECT * FROM stock_movements').all();
    for (const m of stockMovements) {
      await client.query(
        `INSERT INTO stock_movements (id, product_id, change, reason, created_at)
         VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (id) DO NOTHING`,
        [m.id, m.product_id, m.change, m.reason, m.created_at]
      );
    }
    await resetSequence(client, 'stock_movements');
    console.log(`stock_movements: ${stockMovements.length}`);

    const auditLog = sqlite.prepare('SELECT * FROM audit_log').all();
    for (const a of auditLog) {
      await client.query(
        `INSERT INTO audit_log (id, entity_type, entity_id, action, actor, reason, detail, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         ON CONFLICT (id) DO NOTHING`,
        [a.id, a.entity_type, a.entity_id, a.action, a.actor, a.reason, a.detail, a.created_at]
      );
    }
    await resetSequence(client, 'audit_log');
    console.log(`audit_log: ${auditLog.length}`);

    const settings = sqlite.prepare('SELECT * FROM settings WHERE id = 1').get();
    if (settings) {
      await client.query(
        `UPDATE settings SET shop_name = $1, address = $2, phone = $3, receipt_footer = $4 WHERE id = 1`,
        [settings.shop_name, settings.address, settings.phone, settings.receipt_footer]
      );
      console.log('settings: migrated');
    }

    await client.query('COMMIT');
    console.log('MIGRATION COMPLETE');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('MIGRATION FAILED, rolled back:', err);
    process.exitCode = 1;
  } finally {
    client.release();
    sqlite.close();
    await pool.end();
  }
}

main();
