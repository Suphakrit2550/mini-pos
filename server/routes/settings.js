// API ตั้งค่าร้าน

const express = require('express');
const db = require('../db');
const asyncHandler = require('../lib/asyncHandler');

const router = express.Router();

router.get('/', asyncHandler(async (req, res) => {
  const { rows: [row] } = await db.query('SELECT * FROM settings WHERE id = 1');
  res.json(row);
}));

router.put('/', asyncHandler(async (req, res) => {
  const { shop_name, address, phone, receipt_footer } = req.body;
  if (!shop_name || !shop_name.trim()) {
    return res.status(400).json({ error: 'shop_name is required' });
  }
  await db.query(
    `UPDATE settings SET shop_name = $1, address = $2, phone = $3, receipt_footer = $4 WHERE id = 1`,
    [shop_name.trim(), address || null, phone || null, receipt_footer || null]
  );
  const { rows: [row] } = await db.query('SELECT * FROM settings WHERE id = 1');
  res.json(row);
}));

module.exports = router;
