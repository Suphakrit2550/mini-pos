// จัดการบัญชีผู้ใช้ (admin เท่านั้น)

const express = require('express');
const db = require('../db');
const asyncHandler = require('../lib/asyncHandler');
const { hashPassword, verifyPassword } = require('../lib/auth');
const { logAudit } = require('../lib/audit');

const router = express.Router();

// Only active admins count towards "at least one admin must remain" — a
// deactivated admin can't log in to do anything, so they don't count as
// coverage.
async function activeAdminCount() {
  const { rows: [{ c }] } = await db.query("SELECT COUNT(*) AS c FROM users WHERE role = 'admin' AND active = TRUE");
  return Number(c);
}

router.get('/', asyncHandler(async (req, res) => {
  const { rows } = await db.query(
    'SELECT id, username, role, active, failed_attempts, locked_until, created_at FROM users ORDER BY created_at'
  );
  res.json(rows);
}));

router.post('/', asyncHandler(async (req, res) => {
  const username = (req.body.username || '').trim();
  const password = req.body.password || '';
  const role = req.body.role === 'admin' ? 'admin' : 'staff';
  if (!username) return res.status(400).json({ error: 'กรุณากรอกชื่อผู้ใช้' });
  if (password.length < 6) return res.status(400).json({ error: 'รหัสผ่านต้องมีอย่างน้อย 6 ตัวอักษร' });

  let created;
  try {
    ({ rows: [created] } = await db.query(
      'INSERT INTO users (username, password_hash, role) VALUES ($1, $2, $3) RETURNING id',
      [username, hashPassword(password), role]
    ));
  } catch (err) {
    if (err.code === '23505') {
      return res.status(400).json({ error: 'มีชื่อผู้ใช้นี้อยู่แล้ว' });
    }
    throw err;
  }

  await logAudit({ entityType: 'user', entityId: created.id, action: 'create', actor: req.user.username, detail: { username, role } });
  res.status(201).json({ id: created.id, username, role });
}));

router.put('/:id', asyncHandler(async (req, res) => {
  const { rows: [target] } = await db.query('SELECT * FROM users WHERE id = $1', [req.params.id]);
  if (!target) return res.status(404).json({ error: 'ไม่พบผู้ใช้' });

  const { role, newPassword, active, unlock, username } = req.body;

  if (typeof username === 'string' && username.trim() && username.trim() !== target.username) {
    const newUsername = username.trim();
    try {
      await db.query('UPDATE users SET username = $1 WHERE id = $2', [newUsername, target.id]);
    } catch (err) {
      if (err.code === '23505') {
        return res.status(400).json({ error: 'มีชื่อผู้ใช้นี้อยู่แล้ว' });
      }
      throw err;
    }
    await logAudit({ entityType: 'user', entityId: target.id, action: 'rename', actor: req.user.username, detail: { from: target.username, to: newUsername } });
    target.username = newUsername;
  }

  if (role && role !== target.role) {
    if (target.role === 'admin' && role !== 'admin' && (await activeAdminCount()) <= 1) {
      return res.status(400).json({ error: 'ต้องมีแอดมินอย่างน้อย 1 คนเสมอ' });
    }
    await db.query('UPDATE users SET role = $1 WHERE id = $2', [role === 'admin' ? 'admin' : 'staff', target.id]);
    await logAudit({ entityType: 'user', entityId: target.id, action: 'role_change', actor: req.user.username, detail: { from: target.role, to: role } });
  }

  if (typeof active === 'boolean' && active !== target.active) {
    if (!active) {
      if (target.id === req.user.id) {
        return res.status(400).json({ error: 'ไม่สามารถปิดใช้งานบัญชีของตัวเองได้' });
      }
      if (target.role === 'admin' && (await activeAdminCount()) <= 1) {
        return res.status(400).json({ error: 'ต้องมีแอดมินที่เปิดใช้งานอยู่อย่างน้อย 1 คนเสมอ' });
      }
    }
    await db.query('UPDATE users SET active = $1 WHERE id = $2', [active, target.id]);
    if (!active) {
      // Deactivating logs the account out everywhere immediately, not just
      // on their next request.
      await db.query('DELETE FROM sessions WHERE user_id = $1', [target.id]);
    }
    await logAudit({ entityType: 'user', entityId: target.id, action: active ? 'activate' : 'deactivate', actor: req.user.username });
  }

  if (newPassword) {
    if (newPassword.length < 6) return res.status(400).json({ error: 'รหัสผ่านใหม่ต้องมีอย่างน้อย 6 ตัวอักษร' });
    await db.query('UPDATE users SET password_hash = $1, failed_attempts = 0, locked_until = NULL WHERE id = $2', [hashPassword(newPassword), target.id]);
    await db.query('DELETE FROM sessions WHERE user_id = $1', [target.id]);
    await logAudit({ entityType: 'user', entityId: target.id, action: 'password_reset', actor: req.user.username });
  }

  if (unlock && (target.failed_attempts > 0 || target.locked_until)) {
    await db.query('UPDATE users SET failed_attempts = 0, locked_until = NULL WHERE id = $1', [target.id]);
    await logAudit({ entityType: 'user', entityId: target.id, action: 'unlock', actor: req.user.username });
  }

  const { rows: [updated] } = await db.query(
    'SELECT id, username, role, active, failed_attempts, locked_until, created_at FROM users WHERE id = $1',
    [target.id]
  );
  res.json(updated);
}));

router.delete('/:id', asyncHandler(async (req, res) => {
  const { rows: [target] } = await db.query('SELECT * FROM users WHERE id = $1', [req.params.id]);
  if (!target) return res.status(404).json({ error: 'ไม่พบผู้ใช้' });
  if (target.id === req.user.id) {
    return res.status(400).json({ error: 'ไม่สามารถลบบัญชีของตัวเองได้' });
  }

  // Destructive action — require the acting admin to re-confirm with their
  // own current password, not just whatever session happens to be open.
  const confirmPassword = req.body.confirmPassword || '';
  const { rows: [actingAdmin] } = await db.query('SELECT * FROM users WHERE id = $1', [req.user.id]);
  if (!verifyPassword(confirmPassword, actingAdmin.password_hash)) {
    return res.status(400).json({ error: 'กรุณายืนยันรหัสผ่านของคุณให้ถูกต้อง' });
  }

  if (target.role === 'admin' && target.active && (await activeAdminCount()) <= 1) {
    return res.status(400).json({ error: 'ต้องมีแอดมินอย่างน้อย 1 คนเสมอ' });
  }

  // Deleting the account cascades its own product catalog (owner_id ON
  // DELETE CASCADE — see server/db.js) — grab those products' image ids
  // first so the matching product_images rows (not covered by the
  // cascade, since products.image is just a path string, not a real FK)
  // don't get left behind as orphaned blobs once the products are gone.
  // Sales stay on the books as history (user_id ON DELETE SET NULL).
  const { rows: images } = await db.query(
    `SELECT (regexp_match(image, '^/uploads/(\\d+)$'))[1]::int AS image_id
     FROM products WHERE owner_id = $1 AND image LIKE '/uploads/%'`,
    [target.id]
  );

  await db.query('DELETE FROM users WHERE id = $1', [target.id]);

  if (images.length > 0) {
    await db.query('DELETE FROM product_images WHERE id = ANY($1)', [images.map((r) => r.image_id)]);
  }

  await logAudit({ entityType: 'user', entityId: target.id, action: 'delete', actor: req.user.username, detail: { username: target.username } });
  res.status(204).end();
}));

module.exports = router;
