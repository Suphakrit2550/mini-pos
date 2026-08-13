// auth.js — ระบบยืนยันตัวตน (หัวใจของระบบ login)
// - hashPassword() / verifyPassword() — เข้ารหัสรหัสผ่านแบบ scrypt+salt (ไม่เก็บ plain text) และเทียบรหัสตอนล็อกอิน
// - createSession() / getSessionUser() / deleteSession() — สร้าง/ตรวจสอบ/ลบ session ตอนล็อกอิน-เอาต์ (เก็บเป็น token ในคุกกี้)
// - parseCookies() — แกะคุกกี้จาก request เอง (ไม่ได้ใช้ library เสริมอย่าง cookie-parser)

const crypto = require('crypto');
const db = require('../db');

const SESSION_DAYS = 30;
const COOKIE_NAME = 'pos_session';

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  const [salt, hash] = stored.split(':');
  const check = crypto.scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, 'hex');
  return check.length === expected.length && crypto.timingSafeEqual(check, expected);
}

function createSession(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000).toISOString();
  db.prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)').run(token, userId, expiresAt);
  return token;
}

function getSessionUser(token) {
  if (!token) return null;
  // Deactivated accounts lose access immediately even if a session row
  // survives (deactivation also deletes their sessions directly, but this
  // is the backstop that matters if that step is ever skipped).
  return db.prepare(`
    SELECT users.id, users.username, users.role FROM sessions
    JOIN users ON users.id = sessions.user_id
    WHERE sessions.token = ? AND sessions.expires_at > datetime('now') AND users.active = 1
  `).get(token) || null;
}

function deleteSession(token) {
  db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
}

function parseCookies(req) {
  const header = req.headers.cookie;
  const cookies = {};
  if (!header) return cookies;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    cookies[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
  }
  return cookies;
}

module.exports = {
  SESSION_DAYS,
  COOKIE_NAME,
  hashPassword,
  verifyPassword,
  createSession,
  getSessionUser,
  deleteSession,
  parseCookies,
};
