const express = require('express');
const db = require('../db');
const {
  COOKIE_NAME,
  SESSION_DAYS,
  hashPassword,
  verifyPassword,
  createSession,
  getSessionUser,
  deleteSession,
  parseCookies,
} = require('../lib/auth');

const router = express.Router();

const MAX_LOGIN_ATTEMPTS = 5;
const LOCKOUT_MINUTES = 15;

function setSessionCookie(req, res, token) {
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: req.protocol === 'https',
    maxAge: SESSION_DAYS * 24 * 60 * 60 * 1000,
  });
}

router.get('/status', (req, res) => {
  const userCount = db.prepare('SELECT COUNT(*) AS c FROM users').get().c;
  const user = getSessionUser(parseCookies(req)[COOKIE_NAME]);
  res.json({
    hasUsers: userCount > 0,
    authenticated: !!user,
    id: user ? user.id : null,
    username: user ? user.username : null,
    role: user ? user.role : null,
  });
});

router.post('/setup', (req, res) => {
  const userCount = db.prepare('SELECT COUNT(*) AS c FROM users').get().c;
  if (userCount > 0) {
    return res.status(400).json({ error: 'ตั้งค่าบัญชีแรกไปแล้ว กรุณาเข้าสู่ระบบ' });
  }
  const username = (req.body.username || '').trim();
  const password = req.body.password || '';
  if (!username) return res.status(400).json({ error: 'กรุณากรอกชื่อผู้ใช้' });
  if (password.length < 6) return res.status(400).json({ error: 'รหัสผ่านต้องมีอย่างน้อย 6 ตัวอักษร' });

  // The very first account is always the shop owner, so it's always admin.
  const info = db.prepare("INSERT INTO users (username, password_hash, role) VALUES (?, ?, 'admin')")
    .run(username, hashPassword(password));
  setSessionCookie(req, res, createSession(info.lastInsertRowid));
  res.json({ username, role: 'admin' });
});

router.post('/login', (req, res) => {
  const username = (req.body.username || '').trim();
  const password = req.body.password || '';
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);

  if (user && user.locked_until && new Date(user.locked_until) > new Date()) {
    const minutesLeft = Math.ceil((new Date(user.locked_until) - new Date()) / 60000);
    return res.status(429).json({
      error: `บัญชีนี้ถูกล็อกชั่วคราวเนื่องจากใส่รหัสผ่านผิดหลายครั้ง ลองใหม่ได้ในอีก ${minutesLeft} นาที หรือให้แอดมินปลดล็อกให้`,
    });
  }

  if (!user || !verifyPassword(password, user.password_hash)) {
    if (user) {
      const attempts = user.failed_attempts + 1;
      const remaining = MAX_LOGIN_ATTEMPTS - attempts;
      if (remaining <= 0) {
        const lockedUntil = new Date(Date.now() + LOCKOUT_MINUTES * 60 * 1000).toISOString();
        db.prepare('UPDATE users SET failed_attempts = ?, locked_until = ? WHERE id = ?').run(attempts, lockedUntil, user.id);
        return res.status(429).json({
          error: `ใส่รหัสผ่านผิดครบ ${MAX_LOGIN_ATTEMPTS} ครั้ง บัญชีถูกล็อกชั่วคราว ${LOCKOUT_MINUTES} นาที หรือให้แอดมินปลดล็อกให้`,
        });
      }
      db.prepare('UPDATE users SET failed_attempts = ? WHERE id = ?').run(attempts, user.id);
      return res.status(401).json({
        error: `ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง — เหลือโอกาสอีก ${remaining} ครั้งก่อนบัญชีจะถูกล็อกชั่วคราว`,
      });
    }
    return res.status(401).json({ error: 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง' });
  }

  if (!user.active) {
    return res.status(403).json({ error: 'บัญชีนี้ถูกปิดใช้งาน กรุณาติดต่อแอดมิน' });
  }

  db.prepare('UPDATE users SET failed_attempts = 0, locked_until = NULL WHERE id = ?').run(user.id);
  setSessionCookie(req, res, createSession(user.id));
  res.json({ username: user.username, role: user.role });
});

router.post('/logout', (req, res) => {
  const token = parseCookies(req)[COOKIE_NAME];
  if (token) deleteSession(token);
  res.clearCookie(COOKIE_NAME);
  res.status(204).end();
});

router.put('/password', (req, res) => {
  const user = getSessionUser(parseCookies(req)[COOKIE_NAME]);
  if (!user) return res.status(401).json({ error: 'ไม่ได้เข้าสู่ระบบ' });

  const currentPassword = req.body.currentPassword || '';
  const newPassword = req.body.newPassword || '';
  const row = db.prepare('SELECT * FROM users WHERE id = ?').get(user.id);
  if (!verifyPassword(currentPassword, row.password_hash)) {
    return res.status(400).json({ error: 'รหัสผ่านปัจจุบันไม่ถูกต้อง' });
  }
  if (newPassword.length < 6) {
    return res.status(400).json({ error: 'รหัสผ่านใหม่ต้องมีอย่างน้อย 6 ตัวอักษร' });
  }
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(newPassword), user.id);
  res.status(204).end();
});

module.exports = router;
