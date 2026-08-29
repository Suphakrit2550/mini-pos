// รูปสินค้าที่อัปโหลดไว้ก่อนหน้านี้ (ก่อนแก้ server/routes/products.js ให้ย่อรูปอัตโนมัติ
// ตอนอัปโหลด) ยังเป็นไฟล์ขนาดเต็มอยู่ในฐานข้อมูล ยังกิน bandwidth เท่าเดิมทุกครั้งที่โหลด —
// สคริปต์นี้ไล่บีบอัดรูปเก่าทั้งหมดให้เป็นมาตรฐานเดียวกับรูปที่อัปโหลดใหม่ครั้งเดียวจบ
// รันซ้ำได้ปลอดภัย (ข้ามรูปที่เล็กพออยู่แล้ว ไม่ประมวลผลซ้ำ)

const sharp = require('sharp');
const { pool } = require('../server/db');

const MAX_DIMENSION = 800;
const JPEG_QUALITY = 80;
// รูปที่เล็กกว่านี้อยู่แล้วถือว่าผ่านเกณฑ์ (รูปใหม่ที่ผ่านการย่อไปแล้วจะเล็กกว่านี้มาก)
const SKIP_IF_UNDER_BYTES = 200 * 1024;

async function main() {
  const { rows } = await pool.query('SELECT id, filename, length(data) AS size FROM product_images');
  console.log(`พบรูปทั้งหมด ${rows.length} รูป`);

  let compressed = 0;
  let skipped = 0;
  let savedBytes = 0;

  for (const row of rows) {
    if (row.size < SKIP_IF_UNDER_BYTES) {
      skipped++;
      continue;
    }

    const { rows: [full] } = await pool.query('SELECT data FROM product_images WHERE id = $1', [row.id]);
    const original = full.data;

    const resized = await sharp(original)
      .rotate()
      .resize(MAX_DIMENSION, MAX_DIMENSION, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: JPEG_QUALITY })
      .toBuffer();

    if (resized.length >= original.length) {
      skipped++;
      continue;
    }

    await pool.query(
      'UPDATE product_images SET content_type = $1, data = $2 WHERE id = $3',
      ['image/jpeg', resized, row.id]
    );

    savedBytes += original.length - resized.length;
    compressed++;
    console.log(`  #${row.id} ${row.filename}: ${(original.length / 1024).toFixed(0)}KB -> ${(resized.length / 1024).toFixed(0)}KB`);
  }

  console.log(`เสร็จแล้ว — บีบอัด ${compressed} รูป, ข้าม ${skipped} รูป, ประหยัดไปทั้งหมด ${(savedBytes / 1024 / 1024).toFixed(2)} MB`);
  await pool.end();
}

main().catch((err) => {
  console.error('บีบอัดรูปล้มเหลว:', err);
  process.exitCode = 1;
});
