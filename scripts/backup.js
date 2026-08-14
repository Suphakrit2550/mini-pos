// Snapshots every table from Supabase Postgres into a timestamped JSON file
// (no pg_dump/psql needed — those aren't installed on this Mac, and Node's
// own `pg` driver already speaks the wire protocol directly). Product photos
// live in the product_images table now (not on local disk), so this one
// snapshot covers everything, data and images alike. Supabase's free tier
// has zero backup retention of its own, so this local copy is the only
// backup that exists.

const fs = require('fs');
const path = require('path');
const { pool } = require('../server/db');

const BACKUP_DIR = path.join(require('os').homedir(), 'mini-pos-backups');
const KEEP = 30;

const TABLES = ['users', 'products', 'product_images', 'sales', 'sale_items', 'stock_movements', 'audit_log', 'settings'];

function timestamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

async function main() {
  const dest = path.join(BACKUP_DIR, timestamp());
  await fs.promises.mkdir(dest, { recursive: true });

  const snapshot = {};
  for (const table of TABLES) {
    const { rows } = await pool.query(`SELECT * FROM ${table}`);
    snapshot[table] = rows;
  }
  await fs.promises.writeFile(path.join(dest, 'pos.json'), JSON.stringify(snapshot, null, 2));

  console.log(`${new Date().toISOString()} backup completed: ${dest}`);

  // Keep only the most recent KEEP backups.
  const entries = (await fs.promises.readdir(BACKUP_DIR, { withFileTypes: true }))
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort()
    .reverse();
  for (const old of entries.slice(KEEP)) {
    console.log(`${new Date().toISOString()} pruning old backup: ${old}`);
    await fs.promises.rm(path.join(BACKUP_DIR, old), { recursive: true, force: true });
  }

  await pool.end();
}

main().catch((err) => {
  console.error(`${new Date().toISOString()} backup FAILED:`, err);
  process.exitCode = 1;
});
