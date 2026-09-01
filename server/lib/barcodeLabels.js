// สร้าง PDF ป้ายบาร์โค้ด (รูปสินค้า + บาร์โค้ด Code128 + ชื่อ) สำหรับสินค้าในหมวดหมู่เดียว —
// ใช้ร่วมกันทั้งจาก API route (server/routes/products.js) และสคริปต์ฝั่งเครื่อง
// (scripts/generate-barcode-labels.js เดิมมีโค้ดชุดนี้อยู่ในตัวเอง ยังคงไว้แยกกันเพราะสคริปต์
// รันได้อิสระโดยไม่ต้องมีเซิร์ฟเวอร์ทำงานอยู่)

const path = require('path');
const bwipjs = require('bwip-js');
const PDFDocument = require('pdfkit');

const PAGE_MARGIN = 30;
const COLS = 3;
const ROWS = 4;
const FONT_PATH = path.join(__dirname, 'Prompt-Regular.ttf');

function imageIdFromPath(imagePath) {
  if (!imagePath) return null;
  const match = /\/uploads\/(\d+)$/.exec(imagePath);
  return match ? Number(match[1]) : null;
}

// เติมบาร์โค้ดให้สินค้าที่ยังไม่มี (รูปแบบ P<id> ไม่ซ้ำแน่นอนเพราะอิง id ของระบบเอง) แล้ว
// บันทึกกลับเข้าฐานข้อมูลทันที — เรียกก่อนสร้าง PDF เสมอ เพื่อให้ทุกสินค้าที่จะพิมพ์ป้ายมี
// บาร์โค้ดครบ
async function ensureBarcodes(db, products) {
  for (const product of products) {
    if (!product.barcode) {
      product.barcode = `P${product.id}`;
      await db.query('UPDATE products SET barcode = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2', [product.barcode, product.id]);
    }
  }
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
    product.barcodeBuffer = await bwipjs.toBuffer({
      bcid: 'code128',
      text: product.barcode,
      scale: 3,
      height: 12,
      includetext: true,
      textxalign: 'center',
    });
    const imgId = imageIdFromPath(product.image);
    product.imageBuffer = imgId ? imageMap.get(imgId) || null : null;
  }

  return renderPdfBuffer(products);
}

function renderPdfBuffer(products) {
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

      const barcodeW = innerW;
      const barcodeH = Math.min(barcodeW * 0.35, 48);
      doc.image(product.barcodeBuffer, cellX + pad, cursorY, { fit: [barcodeW, barcodeH], align: 'center' });
      cursorY += barcodeH + 6;

      doc.fontSize(8).fillColor('#000000').text(product.name, cellX + pad, cursorY, {
        width: innerW,
        align: 'center',
        height: 24,
        ellipsis: true,
      });
    });

    doc.end();
  });
}

module.exports = { buildCategoryLabelPdf };
