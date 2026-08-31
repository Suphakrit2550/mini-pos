// ลบประวัติการขาย (sales + sale_items) ของบัญชีเดียว เพื่อ "เริ่มต้นใหม่" — ไม่แตะสินค้า/สต็อก
// ที่มีอยู่เลย ไม่กระทบบัญชีอื่น
//
// ปลอดภัยไว้ก่อน: รันเฉยๆ (ไม่ใส่ --confirm) จะแค่ "แสดงตัวอย่าง" ว่าจะลบอะไรบ้าง ยังไม่ลบจริง
// ต้องใส่ --confirm ต่อท้ายเท่านั้นถึงจะลบจริง — กันการลบพลาดโดยไม่ได้ตั้งใจ
//
// วิธีใช้:
//   node scripts/reset-sales-history.js "ยายเพ็ญ"              (ดูตัวอย่างก่อน)
//   node scripts/reset-sales-history.js "ยายเพ็ญ" --confirm    (ลบจริง)

const { pool } = require('../server/db');

async function main() {
  const username = process.argv[2];
  const confirmed = process.argv.includes('--confirm');

  if (!username) {
    console.error('ใช้งาน: node scripts/reset-sales-history.js "<username>" [--confirm]');
    process.exitCode = 1;
    return;
  }

  const { rows: [user] } = await pool.query('SELECT id, username FROM users WHERE username = $1', [username]);
  if (!user) {
    console.error(`ไม่พบผู้ใช้ชื่อ "${username}"`);
    process.exitCode = 1;
    return;
  }

  const { rows: [{ count }] } = await pool.query('SELECT COUNT(*) FROM sales WHERE user_id = $1', [user.id]);
  console.log(`บัญชี "${user.username}" (id=${user.id}) มีประวัติการขาย ${count} บิล`);

  if (Number(count) === 0) {
    console.log('ไม่มีอะไรให้ลบ');
    await pool.end();
    return;
  }

  if (!confirmed) {
    const { rows: sample } = await pool.query(
      'SELECT id, created_at, total_satang FROM sales WHERE user_id = $1 ORDER BY created_at DESC LIMIT 5',
      [user.id]
    );
    console.log('ตัวอย่างบิลล่าสุดที่จะถูกลบ:');
    for (const s of sample) {
      console.log(`  #${s.id}  ${s.created_at}  ${(s.total_satang / 100).toFixed(2)} บาท`);
    }
    console.log('');
    console.log('*** นี่แค่ตัวอย่าง ยังไม่ลบจริง *** ต้องการลบจริง รันคำสั่งนี้อีกครั้งพร้อม --confirm ต่อท้าย:');
    console.log(`  node scripts/reset-sales-history.js "${username}" --confirm`);
    await pool.end();
    return;
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rowCount: itemsDeleted } = await client.query(
      'DELETE FROM sale_items WHERE sale_id IN (SELECT id FROM sales WHERE user_id = $1)',
      [user.id]
    );
    const { rowCount: salesDeleted } = await client.query('DELETE FROM sales WHERE user_id = $1', [user.id]);
    await client.query('COMMIT');
    console.log(`ลบสำเร็จ — ${salesDeleted} บิล (${itemsDeleted} รายการสินค้าในบิล) ของ "${user.username}"`);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('ลบไม่สำเร็จ:', err.message);
    process.exitCode = 1;
  } finally {
    client.release();
  }

  await pool.end();
}

main().catch((err) => {
  console.error('เกิดข้อผิดพลาด:', err);
  process.exitCode = 1;
});
