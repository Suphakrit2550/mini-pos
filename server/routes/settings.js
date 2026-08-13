// API ตั้งค่าร้าน

const express = require('express');
const db = require('../db');

const router = express.Router();

router.get('/', (req, res) => {
  const row = db.prepare('SELECT * FROM settings WHERE id = 1').get();
  res.json(row);
});

router.put('/', (req, res) => {
  const { shop_name, address, phone, receipt_footer } = req.body;
  if (!shop_name || !shop_name.trim()) {
    return res.status(400).json({ error: 'shop_name is required' });
  }
  db.prepare(`
    UPDATE settings SET shop_name = ?, address = ?, phone = ?, receipt_footer = ?
    WHERE id = 1
  `).run(shop_name.trim(), address || null, phone || null, receipt_footer || null);
  const row = db.prepare('SELECT * FROM settings WHERE id = 1').get();
  res.json(row);
});

module.exports = router;
