// จัดการบัญชีผู้ใช้ (admin เท่านั้น)

const express = require('express');
const db = require('../db');
const { hashPassword, verifyPassword } = require('../lib/auth');
const { logAudit } = require('../lib/audit');

const router = express.Router();

// Only active admins count towards "at least one admin must remain" — a
// deactivated admin can't log in to do anything, so they don't count as
// coverage.
function activeAdminCount() {
  return db.prepare("SELECT COUNT(*) AS c FROM users WHERE role = 'admin' AND active = 1").get().c;
}

router.get('/', (req, res) => {
  const rows = db.prepare('SELECT id, username, role, active, failed_attempts, locked_until, created_at FROM users ORDER BY created_at').all();
  res.json(rows);
});

router.post('/', (req, res) => {
  const username = (req.body.username || '').trim();
  const password = req.body.password || '';
  const role = req.body.role === 'admin' ? 'admin' : 'staff';
  if (!username) return res.status(400).json({ error: 'กรุณากรอกชื่อผู้ใช้' });
  if (password.length < 6) return res.status(400).json({ error: 'รหัสผ่านต้องมีอย่างน้อย 6 ตัวอักษร' });

  let info;
  try {
    info = db.prepare('INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)')
      .run(username, hashPassword(password), role);
  } catch (err) {
    if (err.code === 'SQLITE_CONSTRAINT_UNIQUE' || err.code === 'SQLITE_CONSTRAINT') {
      return res.status(400).json({ error: 'มีชื่อผู้ใช้นี้อยู่แล้ว' });
    }
    throw err;
  }

  logAudit({ entityType: 'user', entityId: info.lastInsertRowid, action: 'create', actor: req.user.username, detail: { username, role } });
  res.status(201).json({ id: info.lastInsertRowid, username, role });
});

router.put('/:id', (req, res) => {
  const target = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!target) return res.status(404).json({ error: 'ไม่พบผู้ใช้' });

  const { role, newPassword, active, unlock } = req.body;

  if (role && role !== target.role) {
    if (target.role === 'admin' && role !== 'admin' && activeAdminCount() <= 1) {
      return res.status(400).json({ error: 'ต้องมีแอดมินอย่างน้อย 1 คนเสมอ' });
    }
    db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role === 'admin' ? 'admin' : 'staff', target.id);
    logAudit({ entityType: 'user', entityId: target.id, action: 'role_change', actor: req.user.username, detail: { from: target.role, to: role } });
  }

  if (typeof active === 'boolean' && active !== !!target.active) {
    if (!active) {
      if (target.id === req.user.id) {
        return res.status(400).json({ error: 'ไม่สามารถปิดใช้งานบัญชีของตัวเองได้' });
      }
      if (target.role === 'admin' && activeAdminCount() <= 1) {
        return res.status(400).json({ error: 'ต้องมีแอดมินที่เปิดใช้งานอยู่อย่างน้อย 1 คนเสมอ' });
      }
    }
    db.prepare('UPDATE users SET active = ? WHERE id = ?').run(active ? 1 : 0, target.id);
    if (!active) {
      // Deactivating logs the account out everywhere immediately, not just
      // on their next request.
      db.prepare('DELETE FROM sessions WHERE user_id = ?').run(target.id);
    }
    logAudit({ entityType: 'user', entityId: target.id, action: active ? 'activate' : 'deactivate', actor: req.user.username });
  }

  if (newPassword) {
    if (newPassword.length < 6) return res.status(400).json({ error: 'รหัสผ่านใหม่ต้องมีอย่างน้อย 6 ตัวอักษร' });
    db.prepare('UPDATE users SET password_hash = ?, failed_attempts = 0, locked_until = NULL WHERE id = ?').run(hashPassword(newPassword), target.id);
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(target.id);
    logAudit({ entityType: 'user', entityId: target.id, action: 'password_reset', actor: req.user.username });
  }

  if (unlock && (target.failed_attempts > 0 || target.locked_until)) {
    db.prepare('UPDATE users SET failed_attempts = 0, locked_until = NULL WHERE id = ?').run(target.id);
    logAudit({ entityType: 'user', entityId: target.id, action: 'unlock', actor: req.user.username });
  }

  const updated = db.prepare('SELECT id, username, role, active, failed_attempts, locked_until, created_at FROM users WHERE id = ?').get(target.id);
  res.json(updated);
});

router.delete('/:id', (req, res) => {
  const target = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!target) return res.status(404).json({ error: 'ไม่พบผู้ใช้' });
  if (target.id === req.user.id) {
    return res.status(400).json({ error: 'ไม่สามารถลบบัญชีของตัวเองได้' });
  }

  // Destructive action — require the acting admin to re-confirm with their
  // own current password, not just whatever session happens to be open.
  const confirmPassword = req.body.confirmPassword || '';
  const actingAdmin = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!verifyPassword(confirmPassword, actingAdmin.password_hash)) {
    return res.status(400).json({ error: 'กรุณายืนยันรหัสผ่านของคุณให้ถูกต้อง' });
  }

  if (target.role === 'admin' && activeAdminCount() <= 1 && target.active) {
    return res.status(400).json({ error: 'ต้องมีแอดมินอย่างน้อย 1 คนเสมอ' });
  }

  const productCount = db.prepare('SELECT COUNT(*) AS c FROM products WHERE owner_id = ?').get(target.id).c;
  const saleCount = db.prepare('SELECT COUNT(*) AS c FROM sales WHERE user_id = ?').get(target.id).c;
  if (productCount > 0 || saleCount > 0) {
    return res.status(400).json({
      error: `ลบไม่ได้ เพราะบัญชีนี้ยังมีสินค้า ${productCount} รายการ และประวัติการขาย ${saleCount} รายการอยู่ — ลบสินค้าออกให้หมดก่อน (ประวัติการขายจะไม่ถูกลบเองไม่ว่ากรณีใด) หากต้องการแค่ปิดกั้นการเข้าใช้งาน ใช้ "ปิดใช้งาน" แทนได้`,
    });
  }

  db.prepare('DELETE FROM users WHERE id = ?').run(target.id);
  logAudit({ entityType: 'user', entityId: target.id, action: 'delete', actor: req.user.username, detail: { username: target.username } });
  res.status(204).end();
});

module.exports = router;
