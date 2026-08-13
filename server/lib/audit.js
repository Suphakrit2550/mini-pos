//   // บันทึกประวัติการกระทำ
// เก็บ log ว่า "ใคร ทำอะไร กับอะไร เมื่อไหร่ เพราะอะไร" ลงตาราง audit_log ใช้ตอนแก้ไข/ลบสินค้า, ปรับสต็อก, ยกเลิก/คืนเงิน, จัดการบัญชีผู้ใช้
// - logAudit() — บันทึก 1 เหตุการณ์
// - getAuditLog() — ดึงประวัติของสินค้า/รายการขายชิ้นใดชิ้นหนึ่งมาแสดง (เช่น หน้า "ประวัติการแก้ไข" ในหน้าจัดการสินค้า)

const db = require('../db');

const insertStmt = db.prepare(`
  INSERT INTO audit_log (entity_type, entity_id, action, actor, reason, detail)
  VALUES (@entity_type, @entity_id, @action, @actor, @reason, @detail)
`);

function logAudit({ entityType, entityId, action, actor, reason, detail }) {
  insertStmt.run({
    entity_type: entityType,
    entity_id: entityId,
    action,
    actor,
    reason: reason || null,
    detail: detail ? JSON.stringify(detail) : null,
  });
}

function getAuditLog(entityType, entityId) {
  return db.prepare(`
    SELECT * FROM audit_log
    WHERE entity_type = ? AND entity_id = ?
    ORDER BY created_at DESC, id DESC
  `).all(entityType, entityId).map(row => ({
    ...row,
    detail: row.detail ? JSON.parse(row.detail) : null,
  }));
}

module.exports = { logAudit, getAuditLog };
