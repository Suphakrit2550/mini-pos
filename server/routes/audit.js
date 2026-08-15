// API บันทึกการใช้งานกลาง (เฉพาะแอดมิน) — รวมประวัติการแก้ไข/ลบสินค้า, ปรับสต็อก,
// ยกเลิก/คืนเงินบิล, และจัดการบัญชีผู้ใช้ ของทุกบัญชีไว้ในที่เดียว ไม่ต้องไล่ดูทีละสินค้า/บิล

const express = require('express');
const db = require('../db');
const asyncHandler = require('../lib/asyncHandler');

const router = express.Router();

router.get('/', asyncHandler(async (req, res) => {
  const { from, to, entity_type } = req.query;
  const conditions = [];
  const params = [];

  if (from && to) {
    params.push(from, to);
    conditions.push(`created_at::date BETWEEN $${params.length - 1}::date AND $${params.length}::date`);
  }
  if (entity_type) {
    params.push(entity_type);
    conditions.push(`entity_type = $${params.length}`);
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const { rows } = await db.query(
    `SELECT * FROM audit_log ${where} ORDER BY created_at DESC, id DESC LIMIT 500`,
    params
  );
  res.json(rows.map((row) => ({
    ...row,
    detail: row.detail ? JSON.parse(row.detail) : null,
  })));
}));

module.exports = router;
