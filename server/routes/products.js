// API สินค้า แยกคลังตามบัญชี

const express = require('express');
const multer = require('multer');
const sharp = require('sharp');
const db = require('../db');
const asyncHandler = require('../lib/asyncHandler');
const { toSatang, toBaht } = require('../lib/money');
const { logAudit, getAuditLog } = require('../lib/audit');
const { buildCategoryLabelPdf } = require('../lib/barcodeLabels');

const router = express.Router();

const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

// Product photos only ever render as small grid-card thumbnails, but phone
// cameras routinely produce multi-MB originals — serving those uncompressed
// is what was burning through the host's monthly bandwidth quota. Every
// upload is normalized down to one predictable, small JPEG regardless of
// what came in, instead of trusting whatever size the client happened to send.
const PRODUCT_IMAGE_MAX_DIMENSION = 800;
const PRODUCT_IMAGE_JPEG_QUALITY = 80;

// Images are stored as rows in the product_images table (see server/db.js),
// not as files on disk — memoryStorage just buffers the upload in RAM long
// enough to write it into the database.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!ALLOWED_TYPES.includes(file.mimetype)) {
      return cb(new Error('Only JPEG, PNG, or WEBP images are allowed'));
    }
    cb(null, true);
  },
});

// products.image stores a path like "/uploads/42" where 42 is the
// product_images.id — this pulls that id back out to delete the old row
// when an image is replaced or the product is deleted.
function imageIdFromPath(imagePath) {
  if (!imagePath) return null;
  const match = /\/uploads\/(\d+)$/.exec(imagePath);
  return match ? Number(match[1]) : null;
}

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
  return err && err.code === '23505';
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

router.get('/', asyncHandler(async (req, res) => {
  const ownerId = resolveOwnerId(req);
  const { active } = req.query;
  const { rows } = active === '1'
    ? await db.query('SELECT * FROM products WHERE owner_id = $1 AND active = TRUE ORDER BY name', [ownerId])
    : await db.query('SELECT * FROM products WHERE owner_id = $1 ORDER BY name', [ownerId]);
  res.json(rows.map(serializeProduct));
}));

// รายชื่อหมวดหมู่ที่มีอยู่จริงในคลังของบัญชีนี้ — ให้หน้าพิมพ์ป้ายบาร์โค้ดรู้ว่ามีหมวดไหน
// ให้เลือกบ้าง ก่อนขอ PDF ของหมวดนั้นจริงจาก /barcode-labels ด้านล่าง
router.get('/categories', asyncHandler(async (req, res) => {
  const ownerId = resolveOwnerId(req);
  const { rows } = await db.query(
    'SELECT DISTINCT category FROM products WHERE owner_id = $1 AND active = TRUE AND category IS NOT NULL ORDER BY category',
    [ownerId]
  );
  res.json(rows.map((r) => r.category));
}));

// สร้าง PDF ป้ายบาร์โค้ด (รูปสินค้า + บาร์โค้ด + ชื่อ) ของสินค้าทั้งหมดในหมวดหมู่เดียว ให้
// ดาวน์โหลดตรงจากเบราว์เซอร์ — ไม่ระบุ ?category= จะหมายถึงสินค้าที่ไม่มีหมวดหมู่
router.get('/barcode-labels', asyncHandler(async (req, res) => {
  const ownerId = resolveOwnerId(req);
  const category = req.query.category || null;
  const pdfBuffer = await buildCategoryLabelPdf(db, ownerId, category);
  if (!pdfBuffer) return res.status(404).json({ error: 'ไม่พบสินค้าในหมวดหมู่นี้' });
  const filename = `barcode-labels-${category || 'ไม่ระบุหมวดหมู่'}.pdf`;
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`);
  res.send(pdfBuffer);
}));

router.get('/:id', asyncHandler(async (req, res) => {
  const { rows: [row] } = await db.query('SELECT * FROM products WHERE id = $1', [req.params.id]);
  if (!row) return res.status(404).json({ error: 'Product not found' });
  if (!ownsProduct(req, row)) return res.status(403).json({ error: 'ไม่มีสิทธิ์เข้าถึงสินค้านี้' });
  res.json(serializeProduct(row));
}));

router.get('/:id/history', asyncHandler(async (req, res) => {
  const { rows: [existing] } = await db.query('SELECT * FROM products WHERE id = $1', [req.params.id]);
  if (!existing) return res.status(404).json({ error: 'Product not found' });
  if (!ownsProduct(req, existing)) return res.status(403).json({ error: 'ไม่มีสิทธิ์เข้าถึงสินค้านี้' });
  res.json(await getAuditLog('product', Number(req.params.id)));
}));

router.get('/barcode/:code', asyncHandler(async (req, res) => {
  const ownerId = resolveOwnerId(req);
  const { rows: [row] } = await db.query(
    'SELECT * FROM products WHERE barcode = $1 AND owner_id = $2 AND active = TRUE',
    [req.params.code, ownerId]
  );
  if (!row) return res.status(404).json({ error: 'ไม่พบสินค้าที่มีบาร์โค้ดนี้' });
  res.json(serializeProduct(row));
}));

router.post('/', asyncHandler(async (req, res) => {
  const { name, name_en, sku, category, barcode, price, cost, stock, low_stock_threshold, image } = req.body;
  if (!name || price === undefined) {
    return res.status(400).json({ error: 'name and price are required' });
  }
  try {
    const { rows: [row] } = await db.query(
      `INSERT INTO products (owner_id, name, name_en, sku, category, barcode, price_satang, cost_satang, stock, low_stock_threshold, image)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING *`,
      [
        resolveOwnerId(req),
        name,
        name_en || null,
        sku || null,
        category || null,
        barcode || null,
        toSatang(price),
        toSatang(cost || 0),
        stock === null ? null : (stock || 0),
        low_stock_threshold ?? 5,
        image || null,
      ]
    );
    res.status(201).json(serializeProduct(row));
  } catch (err) {
    if (isUniqueConstraintError(err)) {
      return res.status(400).json({ error: 'บาร์โค้ดนี้ถูกใช้กับสินค้าอื่นแล้ว' });
    }
    throw err;
  }
}));

router.put('/:id', asyncHandler(async (req, res) => {
  const { rows: [existing] } = await db.query('SELECT * FROM products WHERE id = $1', [req.params.id]);
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
    await db.query(
      `UPDATE products SET
        name = $1, name_en = $2, sku = $3, category = $4, barcode = $5,
        price_satang = $6, cost_satang = $7, stock = $8, low_stock_threshold = $9,
        image = $10, active = $11, updated_at = CURRENT_TIMESTAMP
       WHERE id = $12`,
      [
        merged.name, merged.name_en, merged.sku, merged.category, merged.barcode,
        merged.price_satang, merged.cost_satang, merged.stock, merged.low_stock_threshold,
        merged.image, merged.active, merged.id,
      ]
    );
  } catch (err) {
    if (isUniqueConstraintError(err)) {
      return res.status(400).json({ error: 'บาร์โค้ดนี้ถูกใช้กับสินค้าอื่นแล้ว' });
    }
    throw err;
  }

  if (Object.keys(changes).length > 0) {
    await logAudit({
      entityType: 'product',
      entityId: existing.id,
      action: 'update',
      actor,
      reason: req.body.reason || null,
      detail: changes,
    });
  }

  const { rows: [row] } = await db.query('SELECT * FROM products WHERE id = $1', [req.params.id]);
  res.json(serializeProduct(row));
}));

router.delete('/:id', asyncHandler(async (req, res) => {
  const { rows: [existing] } = await db.query('SELECT * FROM products WHERE id = $1', [req.params.id]);
  if (!existing) return res.status(404).json({ error: 'Product not found' });
  if (!ownsProduct(req, existing)) return res.status(403).json({ error: 'ไม่มีสิทธิ์ลบสินค้านี้' });

  const actor = (req.body.actor || '').trim();
  if (!actor) return res.status(400).json({ error: 'actor is required' });

  await logAudit({
    entityType: 'product',
    entityId: existing.id,
    action: 'delete',
    actor,
    reason: req.body.reason || null,
    detail: { name: existing.name, price: toBaht(existing.price_satang) },
  });

  await db.query('DELETE FROM products WHERE id = $1', [req.params.id]);
  const oldImageId = imageIdFromPath(existing.image);
  if (oldImageId) {
    await db.query('DELETE FROM product_images WHERE id = $1', [oldImageId]);
  }
  res.status(204).end();
}));

router.post('/:id/image', asyncHandler(async (req, res) => {
  const { rows: [existing] } = await db.query('SELECT * FROM products WHERE id = $1', [req.params.id]);
  if (!existing) return res.status(404).json({ error: 'Product not found' });
  if (!ownsProduct(req, existing)) return res.status(403).json({ error: 'ไม่มีสิทธิ์แก้ไขสินค้านี้' });

  upload.single('image')(req, res, async (err) => {
    try {
      if (err) return res.status(400).json({ error: err.message });
      if (!req.file) return res.status(400).json({ error: 'No image file provided' });

      const resized = await sharp(req.file.buffer)
        .rotate() // apply EXIF orientation before it gets stripped, so sideways photos stay upright
        .resize(PRODUCT_IMAGE_MAX_DIMENSION, PRODUCT_IMAGE_MAX_DIMENSION, { fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: PRODUCT_IMAGE_JPEG_QUALITY })
        .toBuffer();

      const { rows: [imageRow] } = await db.query(
        'INSERT INTO product_images (filename, content_type, data) VALUES ($1, $2, $3) RETURNING id',
        [req.file.originalname, 'image/jpeg', resized]
      );
      const imagePath = `/uploads/${imageRow.id}`;
      await db.query('UPDATE products SET image = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2', [imagePath, req.params.id]);

      const oldImageId = imageIdFromPath(existing.image);
      if (oldImageId) {
        await db.query('DELETE FROM product_images WHERE id = $1', [oldImageId]);
      }

      const { rows: [row] } = await db.query('SELECT * FROM products WHERE id = $1', [req.params.id]);
      res.json(serializeProduct(row));
    } catch (dbErr) {
      res.status(500).json({ error: dbErr.message });
    }
  });
}));

router.post('/:id/stock', asyncHandler(async (req, res) => {
  const { change, reason, actor } = req.body;
  if (!Number.isInteger(change)) {
    return res.status(400).json({ error: 'change must be an integer' });
  }
  const actorName = (actor || '').trim();
  if (!actorName) return res.status(400).json({ error: 'actor is required' });

  const { rows: [existing] } = await db.query('SELECT * FROM products WHERE id = $1', [req.params.id]);
  if (!existing) return res.status(404).json({ error: 'Product not found' });
  if (!ownsProduct(req, existing)) return res.status(403).json({ error: 'ไม่มีสิทธิ์แก้ไขสินค้านี้' });
  if (existing.stock === null) {
    return res.status(400).json({ error: 'สินค้านี้ไม่ได้ระบุจำนวนคงเหลือ กรุณาแก้ไขสินค้าเพื่อระบุจำนวนก่อน' });
  }

  const newStock = existing.stock + change;
  if (newStock < 0) {
    return res.status(400).json({ error: 'Stock cannot go below zero' });
  }

  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('UPDATE products SET stock = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2', [newStock, req.params.id]);
    await client.query('INSERT INTO stock_movements (product_id, change, reason) VALUES ($1, $2, $3)', [req.params.id, change, reason || null]);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  await logAudit({
    entityType: 'product',
    entityId: existing.id,
    action: 'stock_adjust',
    actor: actorName,
    reason: reason || null,
    detail: { change, from_stock: existing.stock, to_stock: newStock },
  });

  const { rows: [row] } = await db.query('SELECT * FROM products WHERE id = $1', [req.params.id]);
  res.json(serializeProduct(row));
}));

module.exports = router;
