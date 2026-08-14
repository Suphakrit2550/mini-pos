// audit.js — บันทึกประวัติการกระทำ
// เก็บ log ว่า "ใคร ทำอะไร กับอะไร เมื่อไหร่ เพราะอะไร" ลงตาราง audit_log ใช้ตอนแก้ไข/ลบสินค้า, ปรับสต็อก, ยกเลิก/คืนเงิน, จัดการบัญชีผู้ใช้
// - logAudit() — บันทึก 1 เหตุการณ์
// - getAuditLog() — ดึงประวัติของสินค้า/รายการขายชิ้นใดชิ้นหนึ่งมาแสดง (เช่น หน้า "ประวัติการแก้ไข" ในหน้าจัดการสินค้า)

const db = require('../db');

async function logAudit({ entityType, entityId, action, actor, reason, detail }) {
  await db.query(
    `INSERT INTO audit_log (entity_type, entity_id, action, actor, reason, detail)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [entityType, entityId, action, actor, reason || null, detail ? JSON.stringify(detail) : null]
  );
}

async function getAuditLog(entityType, entityId) {
  const { rows } = await db.query(
    `SELECT * FROM audit_log
     WHERE entity_type = $1 AND entity_id = $2
     ORDER BY created_at DESC, id DESC`,
    [entityType, entityId]
  );
  return rows.map((row) => ({
    ...row,
    detail: row.detail ? JSON.parse(row.detail) : null,
  }));
}

module.exports = { logAudit, getAuditLog };
