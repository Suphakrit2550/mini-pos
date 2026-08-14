// Terminal-based password recovery. There is no email/SMS in this app to
// verify identity for a "forgot password" flow, so recovery instead relies
// on physical access to this Mac (running this script IS the proof of
// ownership) — same trust boundary the rest of the local-only app relies on.

// reset-password.js = กันตัวเองล็อกอินไม่ได้ครับ
// reset-password.js — กู้รหัสผ่านผ่าน Terminal
// สั่งด้วย npm run reset-password -- <ชื่อผู้ใช้> ใช้ตอนลืมรหัสผ่านและไม่มีใครช่วยรีเซ็ตให้ผ่านหน้าเว็บได้
// (เช่น เป็น admin คนเดียวแล้วลืมรหัสตัวเอง) — ถามรหัสใหม่แล้วอัปเดตให้ทันที พร้อม sign out
// ทุก session เก่าของบัญชีนั้นเพื่อความปลอดภัย หลักการคือ การเข้าถึงเครื่อง Mac นี้ได้ = ยืนยันตัวตนแล้ว เพราะแอปนี้ไม่มีระบบอีเมลให้ verify

const readline = require('readline');
const db = require('../server/db');
const { hashPassword } = require('../server/lib/auth');

const username = process.argv[2];

async function main() {
  if (!username) {
    console.error('Usage: npm run reset-password -- <username>');
    const { rows: users } = await db.query('SELECT username FROM users');
    if (users.length) {
      console.error('Existing accounts: ' + users.map((u) => u.username).join(', '));
    }
    process.exitCode = 1;
    return;
  }

  const { rows: [user] } = await db.query('SELECT * FROM users WHERE username = $1', [username]);
  if (!user) {
    console.error(`No account named "${username}".`);
    process.exitCode = 1;
    return;
  }

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const password = await new Promise((resolve) => rl.question('New password (at least 6 characters): ', resolve));
  rl.close();

  if (!password || password.length < 6) {
    console.error('Password must be at least 6 characters.');
    process.exitCode = 1;
    return;
  }
  await db.query('UPDATE users SET password_hash = $1 WHERE id = $2', [hashPassword(password), user.id]);
  await db.query('DELETE FROM sessions WHERE user_id = $1', [user.id]);
  console.log(`Password for "${username}" has been reset. All existing sessions were signed out.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => db.pool.end());
