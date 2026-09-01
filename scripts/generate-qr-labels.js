// สร้าง QR code ให้สินค้าทุกชิ้นของบัญชีที่ระบุ (สินค้าที่ยังไม่มีบาร์โค้ดจะถูกสร้างรหัสใหม่
// ให้อัตโนมัติแล้วบันทึกกลับเข้าฐานข้อมูล เพื่อให้สแกน QR แล้วจับคู่กับสินค้าใน POS ได้เลย —
// ใช้ระบบเดียวกับช่องบาร์โค้ดที่มีอยู่แล้ว ไม่ต้องแก้โค้ดฝั่งเว็บเพิ่ม) แล้วจัดวางเป็นป้าย
// รูปสินค้า + QR code ลงกระดาษ A4 แยกไฟล์ PDF ตามหมวดหมู่ บันทึกลง ~/Downloads
//
// วิธีใช้: node --env-file=.env scripts/generate-qr-labels.js "<username>"

const fs = require('fs');
const path = require('path');
const os = require('os');
const QRCode = require('qrcode');
const PDFDocument = require('pdfkit');
const { pool } = require('../server/db');

const OUTPUT_DIR = path.join(os.homedir(), 'Downloads');
const NO_CATEGORY_LABEL = 'ไม่ระบุหมวดหมู่';

// เลย์เอาต์หน้า A4 — 3 คอลัมน์ x 4 แถว = 12 ป้ายต่อหน้า
const PAGE_MARGIN = 30;
const COLS = 3;
const ROWS = 4;

function imageIdFromPath(imagePath) {
  if (!imagePath) return null;
  const match = /\/uploads\/(\d+)$/.exec(imagePath);
  return match ? Number(match[1]) : null;
}

function sanitizeFilename(name) {
  return name.replace(/[/\\:*?"<>|]/g, '-').trim();
}

async function main() {
  const username = process.argv[2];
  if (!username) {
    console.error('ใช้งาน: node scripts/generate-qr-labels.js "<username>"');
    process.exitCode = 1;
    return;
  }

  const { rows: [user] } = await pool.query('SELECT id, username FROM users WHERE username = $1', [username]);
  if (!user) {
    console.error(`ไม่พบผู้ใช้ชื่อ "${username}"`);
    process.exitCode = 1;
    return;
  }

  const { rows: products } = await pool.query(
    'SELECT id, name, category, barcode, image FROM products WHERE owner_id = $1 AND active = TRUE ORDER BY category, name',
    [user.id]
  );
  console.log(`บัญชี "${user.username}" มีสินค้าเปิดขายอยู่ ${products.length} รายการ`);

  // สินค้าที่ยังไม่มีบาร์โค้ด — สร้างรหัสใหม่ (รูปแบบ P<id> ชัวร์ว่าไม่ซ้ำใครแน่นอน เพราะ id
  // เป็นเลขเรียงของระบบเอง) แล้วบันทึกกลับเข้าฐานข้อมูลทันที
  let assigned = 0;
  for (const product of products) {
    if (!product.barcode) {
      product.barcode = `P${product.id}`;
      await pool.query('UPDATE products SET barcode = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2', [product.barcode, product.id]);
      assigned++;
    }
  }
  if (assigned > 0) console.log(`สร้างบาร์โค้ดใหม่ให้สินค้าที่ยังไม่มี: ${assigned} รายการ`);

  // ดึงรูปสินค้าทั้งหมดมาเก็บไว้ล่วงหน้า (คำต่อคำสำหรับสินค้าที่มีรูป)
  const imageIds = products.map((p) => imageIdFromPath(p.image)).filter(Boolean);
  const imageMap = new Map();
  if (imageIds.length > 0) {
    const { rows: images } = await pool.query('SELECT id, data FROM product_images WHERE id = ANY($1)', [imageIds]);
    for (const img of images) imageMap.set(img.id, img.data);
  }

  // สร้าง QR code (PNG buffer) ให้ทุกสินค้า
  for (const product of products) {
    product.qrBuffer = await QRCode.toBuffer(product.barcode, { type: 'png', width: 300, margin: 1 });
    const imgId = imageIdFromPath(product.image);
    product.imageBuffer = imgId ? imageMap.get(imgId) || null : null;
  }

  // จัดกลุ่มตามหมวดหมู่
  const byCategory = new Map();
  for (const product of products) {
    const key = product.category || NO_CATEGORY_LABEL;
    if (!byCategory.has(key)) byCategory.set(key, []);
    byCategory.get(key).push(product);
  }

  await fs.promises.mkdir(OUTPUT_DIR, { recursive: true });

  for (const [category, items] of byCategory) {
    const filePath = path.join(OUTPUT_DIR, `qr-labels-${sanitizeFilename(category)}.pdf`);
    await buildLabelPdf(items, category, filePath);
    console.log(`สร้างแล้ว: ${filePath} (${items.length} ป้าย)`);
  }

  await pool.end();
  console.log('เสร็จสิ้น');
}

function buildLabelPdf(products, category, filePath) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: PAGE_MARGIN });
    // ฟอนต์ในตัว PDFKit (Helvetica) ไม่รองรับภาษาไทยเลย ตัวอักษรจะออกมาเป็นสัญลักษณ์มั่ว —
    // ต้องฝังฟอนต์ที่รองรับไทยเข้าไปตรงๆ ใช้ Prompt ตัวเดียวกับที่เว็บใช้แสดงผลอยู่แล้ว
    doc.registerFont('Thai', path.join(__dirname, 'assets/Prompt-Regular.ttf'));
    doc.font('Thai');
    const stream = fs.createWriteStream(filePath);
    doc.pipe(stream);

    const usableWidth = doc.page.width - PAGE_MARGIN * 2;
    const usableHeight = doc.page.height - PAGE_MARGIN * 2;
    const cellW = usableWidth / COLS;
    const cellH = usableHeight / ROWS;
    const perPage = COLS * ROWS;

    products.forEach((product, i) => {
      const posInPage = i % perPage;
      if (i > 0 && posInPage === 0) doc.addPage();

      const col = posInPage % COLS;
      const row = Math.floor(posInPage / COLS);
      const cellX = PAGE_MARGIN + col * cellW;
      const cellY = PAGE_MARGIN + row * cellH;
      const pad = 8;
      const innerW = cellW - pad * 2;

      doc.rect(cellX + 2, cellY + 2, cellW - 4, cellH - 4).stroke('#cccccc');

      const imgSize = Math.min(innerW * 0.5, 70);
      let cursorY = cellY + pad;
      if (product.imageBuffer) {
        try {
          doc.image(product.imageBuffer, cellX + (cellW - imgSize) / 2, cursorY, { fit: [imgSize, imgSize], align: 'center' });
        } catch {
          // รูปเสีย/อ่านไม่ได้ ข้ามไป ไม่ให้ทั้งไฟล์พัง
        }
      }
      cursorY += imgSize + 6;

      const qrSize = Math.min(innerW * 0.55, 80);
      doc.image(product.qrBuffer, cellX + (cellW - qrSize) / 2, cursorY, { fit: [qrSize, qrSize] });
      cursorY += qrSize + 4;

      doc.fontSize(8).fillColor('#000000').text(product.name, cellX + pad, cursorY, {
        width: innerW,
        align: 'center',
        height: 24,
        ellipsis: true,
      });
      doc.fontSize(6.5).fillColor('#666666').text(product.barcode, cellX + pad, cellY + cellH - pad - 10, {
        width: innerW,
        align: 'center',
      });
    });

    doc.end();
    stream.on('finish', resolve);
    stream.on('error', reject);
  });
}

main().catch((err) => {
  console.error('สร้างป้าย QR ล้มเหลว:', err);
  process.exitCode = 1;
});
