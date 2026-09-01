// สร้าง PDF ป้ายบาร์โค้ด (รูปสินค้า + บาร์โค้ด EAN-13 + ชื่อ) สำหรับสินค้าในหมวดหมู่เดียว —
// ใช้ร่วมกันทั้งจาก API route (server/routes/products.js) และสคริปต์ฝั่งเครื่อง
// (scripts/generate-barcode-labels.js เดิมมีโค้ดชุดนี้อยู่ในตัวเอง ยังคงไว้แยกกันเพราะสคริปต์
// รันได้อิสระโดยไม่ต้องมีเซิร์ฟเวอร์ทำงานอยู่)
//
// ใช้ EAN-13 (ไม่ใช่ Code128) เพราะเครื่องยิงบาร์โค้ดราคาประหยัดหลายรุ่นเปิดใช้งานเฉพาะ
// บาร์โค้ดมาตรฐานร้านค้า (EAN/UPC) เป็นค่าเริ่มต้นจากโรงงาน ไม่เปิด Code128 ให้อัตโนมัติ —
// ยืนยันจากการทดสอบจริงว่าเครื่องอ่าน EAN-13 ได้แต่ Code128 อ่านไม่ได้

const path = require('path');
const bwipjs = require('bwip-js');
const PDFDocument = require('pdfkit');

const PAGE_MARGIN = 30;
const COLS = 3;
const ROWS = 3; // ลดจาก 4 เหลือ 3 แถวต่อหน้า เพื่อให้แต่ละป้ายมีพื้นที่เหลือมากขึ้นสำหรับขยายรูป
const HEADER_HEIGHT = 34; // พื้นที่หัวกระดาษสำหรับเขียนชื่อหมวดหมู่ ซ้ำทุกหน้า
const FONT_PATH = path.join(__dirname, 'Prompt-Regular.ttf');
const NO_CATEGORY_LABEL = 'ไม่ระบุหมวดหมู่';

// รหัสขึ้นต้น "20" อยู่ในช่วง 20-29 ที่ GS1 (หน่วยงานมาตรฐานบาร์โค้ดสากล) สงวนไว้สำหรับ
// "ใช้ภายในร้าน/องค์กรเท่านั้น" โดยเฉพาะ ไม่ชนกับบาร์โค้ดสินค้าจริงจากผู้ผลิตทั่วโลกแน่นอน
const EAN13_PREFIX = '20';

// บาร์โค้ดที่เคยสร้างด้วยระบบเก่า — ใช้เช็คว่าค่านี้เป็นโค้ดที่ระบบสร้างเองมาก่อน (สร้างใหม่ทับ
// ได้เลย) ไม่ใช่บาร์โค้ดจริงจากผู้ผลิตที่ห้ามแตะ: รูปแบบ P<id> (ตอนยังใช้ Code128) หรือ 12 หลัก
// ขึ้นต้นด้วย EAN13_PREFIX แบบไม่มีหลักตรวจสอบ (บั๊กของเวอร์ชันก่อนหน้า — เก็บแค่ 12 หลักแทนที่
// จะเป็น 13 หลักเต็ม ทำให้ค่าที่ยิงได้จากป้ายจริง (13 หลัก) ไม่ตรงกับที่บันทึกไว้เลย)
const OLD_AUTO_BARCODE_PATTERN = /^P\d+$/;
const INCOMPLETE_EAN13_PATTERN = new RegExp(`^${EAN13_PREFIX}\\d{10}$`);

function imageIdFromPath(imagePath) {
  if (!imagePath) return null;
  const match = /\/uploads\/(\d+)$/.exec(imagePath);
  return match ? Number(match[1]) : null;
}

// อัลกอริทึมมาตรฐานของ EAN-13: จากซ้ายไปขวา คูณหลักที่ตำแหน่งคี่ (1-indexed) ด้วย 1 และ
// ตำแหน่งคู่ด้วย 3 แล้วรวมกัน หลักตรวจสอบ = เลขที่บวกเข้าไปแล้วหารด้วย 10 ลงตัวพอดี
function ean13CheckDigit(digits12) {
  let sum = 0;
  for (let i = 0; i < 12; i++) {
    sum += Number(digits12[i]) * (i % 2 === 0 ? 1 : 3);
  }
  return (10 - (sum % 10)) % 10;
}

function generateEan13Digits(productId) {
  const body = `${EAN13_PREFIX}${String(productId).padStart(10, '0')}`; // 12 หลัก
  return body + ean13CheckDigit(body); // 13 หลักเต็ม รวมหลักตรวจสอบ — ต้องตรงกับที่เครื่องยิงอ่านได้จริง
}

// เติมบาร์โค้ดให้สินค้าที่ยังไม่มี หรือมีแต่เป็นโค้ดที่ระบบเคยสร้างเองแบบเก่า/ไม่สมบูรณ์ แล้ว
// บันทึกกลับเข้าฐานข้อมูลทันที — บาร์โค้ดจริงจากผู้ผลิตที่มีอยู่แล้วจะไม่ถูกแตะต้องเลย
// เรียกก่อนสร้าง PDF เสมอ เพื่อให้ทุกสินค้าที่จะพิมพ์ป้ายมีบาร์โค้ดครบ
async function ensureBarcodes(db, products) {
  for (const product of products) {
    if (!product.barcode || OLD_AUTO_BARCODE_PATTERN.test(product.barcode) || INCOMPLETE_EAN13_PATTERN.test(product.barcode)) {
      product.barcode = generateEan13Digits(product.id);
      await db.query('UPDATE products SET barcode = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2', [product.barcode, product.id]);
    }
  }
}

// สินค้าที่มีบาร์โค้ดจริงจากผู้ผลิตอยู่แล้ว (ไม่ถูกแตะโดย ensureBarcodes) อาจไม่ใช่รูปแบบ
// ตัวเลข 12-13 หลักแบบ EAN-13 เป๊ะๆ ก็ได้ (เช่น พิมพ์เป็นรหัสสินค้าของร้านเอง) — EAN-13 บังคับ
// รูปแบบตายตัว ถ้าค่าไม่ตรงสเปกจะสร้างภาพไม่ได้เลย จึงต้องมีทางสำรองเป็น Code128 ที่รับข้อความ
// แบบไหนก็ได้ ให้ทุกสินค้ามีบาร์โค้ดให้พิมพ์เสมอ ไม่ว่าค่าที่บันทึกไว้จะอยู่ในรูปแบบใด
async function renderBarcodeBuffer(value) {
  const isValidEan13 = /^\d{12,13}$/.test(value);
  if (isValidEan13) {
    try {
      return await bwipjs.toBuffer({ bcid: 'ean13', text: value, scale: 3, height: 12, includetext: true, textxalign: 'center' });
    } catch {
      // ตกไปใช้ Code128 ด้านล่างแทน
    }
  }
  return bwipjs.toBuffer({ bcid: 'code128', text: value, scale: 3, height: 12, includetext: true, textxalign: 'center' });
}

async function buildCategoryLabelPdf(db, ownerId, category) {
  const { rows: products } = category
    ? await db.query(
        'SELECT id, name, category, barcode, image FROM products WHERE owner_id = $1 AND active = TRUE AND category = $2 ORDER BY name',
        [ownerId, category]
      )
    : await db.query(
        'SELECT id, name, category, barcode, image FROM products WHERE owner_id = $1 AND active = TRUE AND category IS NULL ORDER BY name',
        [ownerId]
      );

  if (products.length === 0) return null;

  await ensureBarcodes(db, products);

  const imageIds = products.map((p) => imageIdFromPath(p.image)).filter(Boolean);
  const imageMap = new Map();
  if (imageIds.length > 0) {
    const { rows: images } = await db.query('SELECT id, data FROM product_images WHERE id = ANY($1)', [imageIds]);
    for (const img of images) imageMap.set(img.id, img.data);
  }

  for (const product of products) {
    product.barcodeBuffer = await renderBarcodeBuffer(product.barcode);
    const imgId = imageIdFromPath(product.image);
    product.imageBuffer = imgId ? imageMap.get(imgId) || null : null;
  }

  return renderPdfBuffer(products, category || NO_CATEGORY_LABEL);
}

function drawPageHeader(doc, categoryLabel) {
  const usableWidth = doc.page.width - PAGE_MARGIN * 2;
  doc.fontSize(16).fillColor('#000000').text(categoryLabel, PAGE_MARGIN, PAGE_MARGIN - 4, {
    width: usableWidth,
    align: 'center',
  });
  doc.moveTo(PAGE_MARGIN, PAGE_MARGIN + HEADER_HEIGHT - 8)
    .lineTo(doc.page.width - PAGE_MARGIN, PAGE_MARGIN + HEADER_HEIGHT - 8)
    .strokeColor('#999999')
    .stroke();
}

function renderPdfBuffer(products, categoryLabel) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: PAGE_MARGIN });
    // ฟอนต์ในตัว PDFKit (Helvetica) ไม่รองรับภาษาไทยเลย ต้องฝังฟอนต์ที่รองรับไทยเข้าไปตรงๆ
    doc.registerFont('Thai', FONT_PATH);
    doc.font('Thai');

    const chunks = [];
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const usableWidth = doc.page.width - PAGE_MARGIN * 2;
    const gridHeight = doc.page.height - PAGE_MARGIN * 2 - HEADER_HEIGHT;
    const cellW = usableWidth / COLS;
    const cellH = gridHeight / ROWS;
    const gridTop = PAGE_MARGIN + HEADER_HEIGHT;
    const perPage = COLS * ROWS;

    drawPageHeader(doc, categoryLabel);

    products.forEach((product, i) => {
      const posInPage = i % perPage;
      if (i > 0 && posInPage === 0) {
        doc.addPage();
        drawPageHeader(doc, categoryLabel);
      }

      const col = posInPage % COLS;
      const row = Math.floor(posInPage / COLS);
      const cellX = PAGE_MARGIN + col * cellW;
      const cellY = gridTop + row * cellH;
      const pad = 10;
      const innerW = cellW - pad * 2;

      doc.rect(cellX + 2, cellY + 2, cellW - 4, cellH - 4).stroke('#cccccc');

      // รูปสินค้าใช้พื้นที่ที่เหลือในกรอบให้เต็มที่มากขึ้น (เดิมกำหนดเพดานตายตัวไว้เล็กเกินไป
      // เมื่อเทียบกับพื้นที่ในกรอบจริง ทำให้ดูเล็กและมีที่ว่างเหลือโดยไม่จำเป็น)
      const imgSize = Math.min(innerW * 0.85, cellH * 0.5);
      let cursorY = cellY + pad;
      if (product.imageBuffer) {
        try {
          doc.image(product.imageBuffer, cellX + (cellW - imgSize) / 2, cursorY, { fit: [imgSize, imgSize], align: 'center' });
        } catch {
          // รูปเสีย/อ่านไม่ได้ ข้ามไป ไม่ให้ทั้งไฟล์พัง
        }
      }
      cursorY += imgSize + 8;

      const barcodeW = innerW;
      const barcodeH = Math.min(barcodeW * 0.4, 65);
      doc.image(product.barcodeBuffer, cellX + pad, cursorY, { fit: [barcodeW, barcodeH], align: 'center' });
      cursorY += barcodeH + 6;

      doc.fontSize(9).fillColor('#000000').text(product.name, cellX + pad, cursorY, {
        width: innerW,
        align: 'center',
        height: 26,
        ellipsis: true,
      });
    });

    doc.end();
  });
}

module.exports = { buildCategoryLabelPdf };
