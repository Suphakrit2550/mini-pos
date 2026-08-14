//  ระบบล็อกอิน/ล็อกเอาต์/ล็อกอิน 5 ครั้งผิดแล้วล็อก

const express = require('express');
const db = require('../db');
const asyncHandler = require('../lib/asyncHandler');
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

router.get('/status', asyncHandler(async (req, res) => {
  const { rows: [{ c }] } = await db.query('SELECT COUNT(*) AS c FROM users');
  const user = await getSessionUser(parseCookies(req)[COOKIE_NAME]);
  res.json({
    hasUsers: Number(c) > 0,
    authenticated: !!user,
    id: user ? user.id : null,
    username: user ? user.username : null,
    role: user ? user.role : null,
  });
}));

router.post('/setup', asyncHandler(async (req, res) => {
  const { rows: [{ c }] } = await db.query('SELECT COUNT(*) AS c FROM users');
  if (Number(c) > 0) {
    return res.status(400).json({ error: 'ตั้งค่าบัญชีแรกไปแล้ว กรุณาเข้าสู่ระบบ' });
  }
  const username = (req.body.username || '').trim();
  const password = req.body.password || '';
  if (!username) return res.status(400).json({ error: 'กรุณากรอกชื่อผู้ใช้' });
  if (password.length < 6) return res.status(400).json({ error: 'รหัสผ่านต้องมีอย่างน้อย 6 ตัวอักษร' });

  // The very first account is always the shop owner, so it's always admin.
  const { rows: [created] } = await db.query(
    "INSERT INTO users (username, password_hash, role) VALUES ($1, $2, 'admin') RETURNING id",
    [username, hashPassword(password)]
  );
  setSessionCookie(req, res, await createSession(created.id));
  res.json({ username, role: 'admin' });
}));

router.post('/login', asyncHandler(async (req, res) => {
  const username = (req.body.username || '').trim();
  const password = req.body.password || '';
  const { rows: [user] } = await db.query('SELECT * FROM users WHERE username = $1', [username]);

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
        const lockedUntil = new Date(Date.now() + LOCKOUT_MINUTES * 60 * 1000);
        await db.query('UPDATE users SET failed_attempts = $1, locked_until = $2 WHERE id = $3', [attempts, lockedUntil, user.id]);
        return res.status(429).json({
          error: `ใส่รหัสผ่านผิดครบ ${MAX_LOGIN_ATTEMPTS} ครั้ง บัญชีถูกล็อกชั่วคราว ${LOCKOUT_MINUTES} นาที หรือให้แอดมินปลดล็อกให้`,
        });
      }
      await db.query('UPDATE users SET failed_attempts = $1 WHERE id = $2', [attempts, user.id]);
      return res.status(401).json({
        error: `ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง — เหลือโอกาสอีก ${remaining} ครั้งก่อนบัญชีจะถูกล็อกชั่วคราว`,
      });
    }
    return res.status(401).json({ error: 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง' });
  }

  if (!user.active) {
    return res.status(403).json({ error: 'บัญชีนี้ถูกปิดใช้งาน กรุณาติดต่อแอดมิน' });
  }

  await db.query('UPDATE users SET failed_attempts = 0, locked_until = NULL WHERE id = $1', [user.id]);
  setSessionCookie(req, res, await createSession(user.id));
  res.json({ username: user.username, role: user.role });
}));

router.post('/logout', asyncHandler(async (req, res) => {
  const token = parseCookies(req)[COOKIE_NAME];
  if (token) await deleteSession(token);
  res.clearCookie(COOKIE_NAME);
  res.status(204).end();
}));

router.put('/password', asyncHandler(async (req, res) => {
  const user = await getSessionUser(parseCookies(req)[COOKIE_NAME]);
  if (!user) return res.status(401).json({ error: 'ไม่ได้เข้าสู่ระบบ' });

  const currentPassword = req.body.currentPassword || '';
  const newPassword = req.body.newPassword || '';
  const { rows: [row] } = await db.query('SELECT * FROM users WHERE id = $1', [user.id]);
  if (!verifyPassword(currentPassword, row.password_hash)) {
    return res.status(400).json({ error: 'รหัสผ่านปัจจุบันไม่ถูกต้อง' });
  }
  if (newPassword.length < 6) {
    return res.status(400).json({ error: 'รหัสผ่านใหม่ต้องมีอย่างน้อย 6 ตัวอักษร' });
  }
  await db.query('UPDATE users SET password_hash = $1 WHERE id = $2', [hashPassword(newPassword), user.id]);
  res.status(204).end();
}));

module.exports = router;
