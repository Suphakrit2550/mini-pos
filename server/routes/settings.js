// API ตั้งค่าร้าน — แยกต่างหากต่อบัญชี (ร้านใครร้านมัน)

const express = require('express');
const db = require('../db');
const asyncHandler = require('../lib/asyncHandler');

const router = express.Router();

// Staff always act on their own shop settings. Admins act on their own by
// default too, but may pass ?user_id= to view or edit a specific staff
// member's shop settings instead (same pattern as products.js/sales.js).
function resolveScopeUserId(req) {
  const requested = req.query.user_id || req.body.user_id;
  if (req.user.role === 'admin' && requested) return Number(requested);
  return req.user.id;
}

router.get('/', asyncHandler(async (req, res) => {
  const userId = resolveScopeUserId(req);
  // Auto-create a default row on first read, so a brand-new account (or one
  // that predates this table) doesn't 404 — same self-healing pattern as
  // the rest of the app.
  await db.query(
    `INSERT INTO settings (user_id, shop_name) VALUES ($1, 'Mini POS') ON CONFLICT (user_id) DO NOTHING`,
    [userId]
  );
  const { rows: [row] } = await db.query('SELECT * FROM settings WHERE user_id = $1', [userId]);
  res.json(row);
}));

router.put('/', asyncHandler(async (req, res) => {
  const userId = resolveScopeUserId(req);
  const { shop_name, address, phone, receipt_footer } = req.body;
  if (!shop_name || !shop_name.trim()) {
    return res.status(400).json({ error: 'shop_name is required' });
  }
  await db.query(
    `INSERT INTO settings (user_id, shop_name, address, phone, receipt_footer)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (user_id) DO UPDATE SET shop_name = $2, address = $3, phone = $4, receipt_footer = $5`,
    [userId, shop_name.trim(), address || null, phone || null, receipt_footer || null]
  );
  const { rows: [row] } = await db.query('SELECT * FROM settings WHERE user_id = $1', [userId]);
  res.json(row);
}));

module.exports = router;
