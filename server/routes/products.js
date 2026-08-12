// API สินค้า แยกคลังตามบัญชี

const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const db = require('../db');
const { toSatang, toBaht } = require('../lib/money');
const { logAudit, getAuditLog } = require('../lib/audit');

const router = express.Router();

const uploadsDir = path.join(__dirname, '..', '..', 'public', 'uploads');
const ALLOWED_TYPES = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
};

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) => {
    const ext = ALLOWED_TYPES[file.mimetype];
    cb(null, `${crypto.randomUUID()}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!ALLOWED_TYPES[file.mimetype]) {
      return cb(new Error('Only JPEG, PNG, or WEBP images are allowed'));
    }
    cb(null, true);
  },
});

function serializeProduct(row) {
  if (!row) return row;
  const { price_satang, cost_satang, ...rest } = row;
  return { ...rest, price: toBaht(price_satang), cost: toBaht(cost_satang) };
}

const EDITABLE_FIELDS = ['name', 'name_en', 'sku', 'category', 'barcode', 'stock', 'low_stock_threshold', 'active'];
const FIELD_LABELS = {
  name: 'ชื่อสินค้า',
  name_en: 'ชื่อภาษาอังกฤษ',
  sku: 'รหัสสินค้า',
  category: 'หมวดหมู่',
  barcode: 'บาร์โค้ด',
  stock: 'จำนวนคงเหลือ',
  low_stock_threshold: 'แจ้งเตือนเมื่อเหลือ',
  active: 'สถานะเปิดขาย',
  price: 'ราคาขาย',
  cost: 'ต้นทุน',
};

function isUniqueConstraintError(err) {
  return err && err.code === 'SQLITE_CONSTRAINT_UNIQUE';
}

// Staff always act on their own catalog. Admins act on their own catalog by
// default too, but may pass ?owner_id= (or an owner_id in the body) to view
// or add to a specific staff member's catalog instead.
function resolveOwnerId(req) {
  const requested = req.query.owner_id || req.body.owner_id;
  if (req.user.role === 'admin' && requested) return Number(requested);
  return req.user.id;
}

function ownsProduct(req, product) {
  return req.user.role === 'admin' || product.owner_id === req.user.id;
}

router.get('/', (req, res) => {
  const ownerId = resolveOwnerId(req);
  const { active } = req.query;
  let rows;
  if (active === '1') {
    rows = db.prepare('SELECT * FROM products WHERE owner_id = ? AND active = 1 ORDER BY name').all(ownerId);
  } else {
    rows = db.prepare('SELECT * FROM products WHERE owner_id = ? ORDER BY name').all(ownerId);
  }
  res.json(rows.map(serializeProduct));
});

router.get('/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Product not found' });
  if (!ownsProduct(req, row)) return res.status(403).json({ error: 'ไม่มีสิทธิ์เข้าถึงสินค้านี้' });
  res.json(serializeProduct(row));
});

router.get('/:id/history', (req, res) => {
  const existing = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Product not found' });
  if (!ownsProduct(req, existing)) return res.status(403).json({ error: 'ไม่มีสิทธิ์เข้าถึงสินค้านี้' });
  res.json(getAuditLog('product', Number(req.params.id)));
});

router.get('/barcode/:code', (req, res) => {
  const ownerId = resolveOwnerId(req);
  const row = db.prepare('SELECT * FROM products WHERE barcode = ? AND owner_id = ? AND active = 1').get(req.params.code, ownerId);
  if (!row) return res.status(404).json({ error: 'ไม่พบสินค้าที่มีบาร์โค้ดนี้' });
  res.json(serializeProduct(row));
});

router.post('/', (req, res) => {
  const { name, name_en, sku, category, barcode, price, cost, stock, low_stock_threshold, image } = req.body;
  if (!name || price === undefined) {
    return res.status(400).json({ error: 'name and price are required' });
  }
  const stmt = db.prepare(`
    INSERT INTO products (owner_id, name, name_en, sku, category, barcode, price_satang, cost_satang, stock, low_stock_threshold, image)
    VALUES (@owner_id, @name, @name_en, @sku, @category, @barcode, @price_satang, @cost_satang, @stock, @low_stock_threshold, @image)
  `);
  try {
    const info = stmt.run({
      owner_id: resolveOwnerId(req),
      name,
      name_en: name_en || null,
      sku: sku || null,
      category: category || null,
      barcode: barcode || null,
      price_satang: toSatang(price),
      cost_satang: toSatang(cost || 0),
      stock: stock || 0,
      low_stock_threshold: low_stock_threshold ?? 5,
      image: image || null,
    });
    const row = db.prepare('SELECT * FROM products WHERE id = ?').get(info.lastInsertRowid);
    res.status(201).json(serializeProduct(row));
  } catch (err) {
    if (isUniqueConstraintError(err)) {
      return res.status(400).json({ error: 'บาร์โค้ดนี้ถูกใช้กับสินค้าอื่นแล้ว' });
    }
    throw err;
  }
});

router.put('/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Product not found' });
  if (!ownsProduct(req, existing)) return res.status(403).json({ error: 'ไม่มีสิทธิ์แก้ไขสินค้านี้' });

  const actor = (req.body.actor || '').trim();
  if (!actor) return res.status(400).json({ error: 'actor is required' });

  const priceSatang = req.body.price !== undefined ? toSatang(req.body.price) : existing.price_satang;
  const costSatang = req.body.cost !== undefined ? toSatang(req.body.cost) : existing.cost_satang;

  const merged = {
    ...existing,
    ...req.body,
    id: existing.id,
    price_satang: priceSatang,
    cost_satang: costSatang,
    barcode: req.body.barcode !== undefined ? (req.body.barcode.trim() || null) : existing.barcode,
  };

  const normalize = (v) => (v === null || v === undefined || v === '' ? null : v);

  const changes = {};
  for (const field of EDITABLE_FIELDS) {
    if (normalize(merged[field]) != normalize(existing[field])) {
      changes[FIELD_LABELS[field] || field] = { from: existing[field], to: merged[field] };
    }
  }
  if (priceSatang !== existing.price_satang) {
    changes[FIELD_LABELS.price] = { from: toBaht(existing.price_satang), to: toBaht(priceSatang) };
  }
  if (costSatang !== existing.cost_satang) {
    changes[FIELD_LABELS.cost] = { from: toBaht(existing.cost_satang), to: toBaht(costSatang) };
  }

  try {
    db.prepare(`
      UPDATE products SET
        name = @name,
        name_en = @name_en,
        sku = @sku,
        category = @category,
        barcode = @barcode,
        price_satang = @price_satang,
        cost_satang = @cost_satang,
        stock = @stock,
        low_stock_threshold = @low_stock_threshold,
        image = @image,
        active = @active,
        updated_at = datetime('now', 'localtime')
      WHERE id = @id
    `).run(merged);
  } catch (err) {
    if (isUniqueConstraintError(err)) {
      return res.status(400).json({ error: 'บาร์โค้ดนี้ถูกใช้กับสินค้าอื่นแล้ว' });
    }
    throw err;
  }

  if (Object.keys(changes).length > 0) {
    logAudit({
      entityType: 'product',
      entityId: existing.id,
      action: 'update',
      actor,
      reason: req.body.reason || null,
      detail: changes,
    });
  }

  const row = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id);
  res.json(serializeProduct(row));
});

router.delete('/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Product not found' });
  if (!ownsProduct(req, existing)) return res.status(403).json({ error: 'ไม่มีสิทธิ์ลบสินค้านี้' });

  const actor = (req.body.actor || '').trim();
  if (!actor) return res.status(400).json({ error: 'actor is required' });

  logAudit({
    entityType: 'product',
    entityId: existing.id,
    action: 'delete',
    actor,
    reason: req.body.reason || null,
    detail: { name: existing.name, price: toBaht(existing.price_satang) },
  });

  db.prepare('DELETE FROM products WHERE id = ?').run(req.params.id);
  if (existing.image) {
    fs.unlink(path.join(uploadsDir, path.basename(existing.image)), () => {});
  }
  res.status(204).end();
});

router.post('/:id/image', (req, res) => {
  const existing = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Product not found' });
  if (!ownsProduct(req, existing)) return res.status(403).json({ error: 'ไม่มีสิทธิ์แก้ไขสินค้านี้' });

  upload.single('image')(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message });
    if (!req.file) return res.status(400).json({ error: 'No image file provided' });

    const imagePath = `/uploads/${req.file.filename}`;
    db.prepare("UPDATE products SET image = ?, updated_at = datetime('now', 'localtime') WHERE id = ?")
      .run(imagePath, req.params.id);

    if (existing.image) {
      const oldFile = path.join(uploadsDir, path.basename(existing.image));
      fs.unlink(oldFile, () => {});
    }

    const row = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id);
    res.json(serializeProduct(row));
  });
});

router.post('/:id/stock', (req, res) => {
  const { change, reason, actor } = req.body;
  if (!Number.isInteger(change)) {
    return res.status(400).json({ error: 'change must be an integer' });
  }
  const actorName = (actor || '').trim();
  if (!actorName) return res.status(400).json({ error: 'actor is required' });

  const existing = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Product not found' });
  if (!ownsProduct(req, existing)) return res.status(403).json({ error: 'ไม่มีสิทธิ์แก้ไขสินค้านี้' });

  const newStock = existing.stock + change;
  if (newStock < 0) {
    return res.status(400).json({ error: 'Stock cannot go below zero' });
  }

  const tx = db.transaction(() => {
    db.prepare("UPDATE products SET stock = ?, updated_at = datetime('now', 'localtime') WHERE id = ?")
      .run(newStock, req.params.id);
    db.prepare('INSERT INTO stock_movements (product_id, change, reason) VALUES (?, ?, ?)')
      .run(req.params.id, change, reason || null);
    logAudit({
      entityType: 'product',
      entityId: existing.id,
      action: 'stock_adjust',
      actor: actorName,
      reason: reason || null,
      detail: { change, from_stock: existing.stock, to_stock: newStock },
    });
  });
  tx();

  const row = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id);
  res.json(serializeProduct(row));
});

module.exports = router;
