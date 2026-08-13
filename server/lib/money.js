// Money crosses the API boundary as decimal บาท (for humans and the UI) but
// is stored and summed internally as integer สตางค์ (1 บาท = 100 สตางค์).
// The float→integer rounding happens exactly once here, at the boundary —
// every internal calculation after that is exact integer arithmetic.

// money.js — จัดการเรื่องเงิน
// เก็บราคา/ยอดขายในฐานข้อมูลเป็นสตางค์แบบจำนวนเต็ม (ไม่ใช่บาททศนิยม) เพื่อไม่ให้เกิดปัญหาปัดเศษเพี้ยนจากการบวกลบเลขทศนิยมซ้ำๆ
// - toSatang(45.50) → แปลงบาทที่ผู้ใช้กรอก เป็นสตางค์เก็บลง DB (เช่น 45.50 → 4550)
// - toBaht(4550) → แปลงกลับเป็นบาทตอนส่งให้หน้าเว็บแสดงผล

function toSatang(baht) {
  if (baht === null || baht === undefined || baht === '') return 0;
  const n = Number(baht);
  if (!Number.isFinite(n)) throw new Error('Invalid amount');
  return Math.round(n * 100);
}

function toBaht(satang) {
  if (satang === null || satang === undefined) return null;
  return satang / 100;
}

module.exports = { toSatang, toBaht };
