// สร้างบาร์โค้ด EAN-13 (มาตรฐานเดียวกับสินค้าตามร้านค้าทั่วไป อ่านได้กับเครื่องยิงบาร์โค้ด
// แทบทุกรุ่นเพราะเป็นค่าเริ่มต้นจากโรงงาน ต่างจาก Code128 ที่บางเครื่องต้องตั้งค่าเพิ่มก่อนถึง
// จะอ่านได้) ให้สินค้าทุกชิ้นของบัญชีที่ระบุ แล้วจัดวางเป็นป้ายรูปสินค้า + บาร์โค้ด ลงกระดาษ A4
// แยกไฟล์ PDF ตามหมวดหมู่ บันทึกลงโฟลเดอร์ ~/Downloads/คิวอาร้านยายเพ็ญ
//
// ใช้ตรรกะเดียวกับ GET /api/products/barcode-labels (server/lib/barcodeLabels.js) — ตัวนี้
// มีไว้สำหรับรันจากเครื่องโดยตรงโดยไม่ต้องพึ่งเว็บเซิร์ฟเวอร์ทำงานอยู่
//
// วิธีใช้: node --env-file=.env scripts/generate-barcode-labels.js "<username>"

const fs = require('fs');
const path = require('path');
const os = require('os');
const { pool } = require('../server/db');
const { buildCategoryLabelPdf } = require('../server/lib/barcodeLabels');

const OUTPUT_DIR = path.join(os.homedir(), 'Downloads', 'คิวอาร้านยายเพ็ญ');
const NO_CATEGORY_LABEL = 'ไม่ระบุหมวดหมู่';

function sanitizeFilename(name) {
  return name.replace(/[/\\:*?"<>|]/g, '-').trim();
}

async function main() {
  const username = process.argv[2];
  if (!username) {
    console.error('ใช้งาน: node scripts/generate-barcode-labels.js "<username>"');
    process.exitCode = 1;
    return;
  }

  const { rows: [user] } = await pool.query('SELECT id, username FROM users WHERE username = $1', [username]);
  if (!user) {
    console.error(`ไม่พบผู้ใช้ชื่อ "${username}"`);
    process.exitCode = 1;
    return;
  }

  const { rows: categoryRows } = await pool.query(
    'SELECT DISTINCT category FROM products WHERE owner_id = $1 AND active = TRUE ORDER BY category',
    [user.id]
  );
  const categories = categoryRows.map((r) => r.category); // null รวมอยู่ในนี้ด้วยถ้ามีสินค้าไม่มีหมวดหมู่
  console.log(`บัญชี "${user.username}" มี ${categories.length} หมวดหมู่ (รวมสินค้าที่ไม่มีหมวดหมู่ถ้ามี)`);

  await fs.promises.mkdir(OUTPUT_DIR, { recursive: true });

  for (const category of categories) {
    const pdfBuffer = await buildCategoryLabelPdf(pool, user.id, category);
    if (!pdfBuffer) continue;
    const label = category || NO_CATEGORY_LABEL;
    const filePath = path.join(OUTPUT_DIR, `barcode-labels-${sanitizeFilename(label)}.pdf`);
    await fs.promises.writeFile(filePath, pdfBuffer);
    console.log(`สร้างแล้ว: ${filePath}`);
  }

  await pool.end();
  console.log('เสร็จสิ้น');
}

main().catch((err) => {
  console.error('สร้างป้ายบาร์โค้ดล้มเหลว:', err);
  process.exitCode = 1;
});
