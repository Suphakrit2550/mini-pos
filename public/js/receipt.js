// ไฟล์นี้ทำหน้าที่: หน้าแสดงใบเสร็จ (receipt.html) สำหรับพิมพ์หรือดูย้อนหลัง
// - อ่านเลขที่บิล (id) จาก URL แล้วดึงข้อมูลบิลและข้อมูลร้านมาแสดงผลเป็นใบเสร็จ
// - แสดงป้ายแจ้งเตือนถ้าบิลถูกยกเลิก/คืนเงินแล้ว และมีปุ่มพิมพ์/ย้อนกลับ

const receiptRoot = document.getElementById('receiptRoot');

const PAYMENT_LABELS = { cash: 'เงินสด' };

let currentSale = null;
let currentSettings = null;

function formatDateTime(datetimeStr) {
  return `${datetimeStr.slice(0, 10)} ${datetimeStr.slice(11, 16)} น.`;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

async function loadReceipt() {
  const id = new URLSearchParams(location.search).get('id');
  if (!id) {
    receiptRoot.innerHTML = '<p class="loading">ไม่พบเลขที่บิล</p>';
    return;
  }

  try {
    const sale = await api.getSale(id);
    renderReceipt(sale, sale.shop || {});
  } catch (err) {
    receiptRoot.innerHTML = `<p class="loading">${escapeHtml(err.message)}</p>`;
  }
}

function renderReceipt(sale, settings) {
  currentSale = sale;
  currentSettings = settings;

  const voidBanner = sale.status === 'cancelled'
    ? `<div class="receipt-void-banner">** ใบเสร็จนี้ถูกยกเลิก **<br>โดย ${escapeHtml(sale.voided_by || '-')} เมื่อ ${sale.voided_at ? formatDateTime(sale.voided_at) : '-'}<br>เหตุผล: ${escapeHtml(sale.voided_reason || '-')}</div>`
    : sale.status === 'refunded'
    ? `<div class="receipt-void-banner">** ใบเสร็จนี้คืนเงินแล้ว **<br>โดย ${escapeHtml(sale.voided_by || '-')} เมื่อ ${sale.voided_at ? formatDateTime(sale.voided_at) : '-'}<br>เหตุผล: ${escapeHtml(sale.voided_reason || '-')}</div>`
    : '';

  receiptRoot.innerHTML = `
    <div class="receipt">
      <div class="receipt-header">
        <div class="receipt-shop-name">${escapeHtml(settings.shop_name || 'Mini POS')}</div>
        ${settings.address ? `<div class="receipt-shop-meta">${escapeHtml(settings.address)}</div>` : ''}
        ${settings.phone ? `<div class="receipt-shop-meta">โทร. ${escapeHtml(settings.phone)}</div>` : ''}
      </div>

      <div class="receipt-title">ใบเสร็จรับเงิน / RECEIPT</div>

      <div class="receipt-meta-line"><span>เลขที่บิล</span><span>#${sale.id}</span></div>
      <div class="receipt-meta-line"><span>วันที่</span><span>${formatDateTime(sale.created_at)}</span></div>
      ${sale.customer_name ? `<div class="receipt-meta-line"><span>ลูกค้า</span><span>${escapeHtml(sale.customer_name)}</span></div>` : ''}

      <div class="receipt-divider"></div>

      ${sale.items.map(item => `
        <div class="receipt-item">
          <div class="receipt-item-name"><span>${escapeHtml(item.name)}</span><span>฿${formatCurrency(item.subtotal)}</span></div>
          <div class="receipt-item-sub"><span>${formatCurrency(item.price)} × ${item.quantity}</span></div>
        </div>
      `).join('')}

      <div class="receipt-divider"></div>

      <div class="receipt-total-row"><span>ยอดรวม</span><span>฿${formatCurrency(sale.total)}</span></div>

      <div class="receipt-divider"></div>

      <div class="receipt-pay-line"><span>ชำระโดย</span><span>${PAYMENT_LABELS[sale.payment_method] || sale.payment_method}</span></div>
      ${sale.received_amount != null ? `<div class="receipt-pay-line"><span>รับเงิน</span><span>฿${formatCurrency(sale.received_amount)}</span></div>` : ''}
      ${sale.change_amount != null ? `<div class="receipt-pay-line"><span>เงินทอน</span><span>฿${formatCurrency(sale.change_amount)}</span></div>` : ''}

      ${voidBanner}

      ${settings.receipt_footer ? `<div class="receipt-footer">${escapeHtml(settings.receipt_footer)}</div>` : ''}
    </div>
  `;
}

document.getElementById('printBtn').addEventListener('click', () => {
  window.print();
});

document.getElementById('backBtn').addEventListener('click', () => {
  const from = new URLSearchParams(location.search).get('from');
  window.location.href = from === 'orders' ? 'orders.html' : 'index.html';
});

// วาดใบเสร็จลงบน canvas ขาว-ดำ เพื่อส่งเป็นภาพให้เครื่องพิมพ์ Bluetooth (ดู btprint.js)
// ใช้วิธีวาดภาพแทนส่งตัวอักษรตรงๆ เพราะเครื่องพิมพ์ ESC/POS ราคาประหยัดส่วนใหญ่ไม่รองรับ
// ชุดรหัสภาษาไทย การส่งเป็นภาพจึงพิมพ์ภาษาไทยได้แน่นอนไม่ว่าเครื่องพิมพ์รุ่นไหน
async function renderReceiptToCanvas(sale, settings, widthPx) {
  await document.fonts.ready;
  const scale = widthPx / 384;
  const pad = Math.round(16 * scale);
  const baseSize = Math.round(20 * scale);
  const smallSize = Math.round(16 * scale);
  const lineH = (size) => Math.round(size * 1.4);
  const dividerH = () => Math.round(6 * scale) + Math.round(10 * scale);

  // ความสูงคำนวณตรงตามขั้นตอนวาดจริงด้านล่างทีละบรรทัด กันพลาดกรณีมีฟิลด์เสริม
  // ครบทุกอย่าง (ที่อยู่+เบอร์+ชื่อลูกค้า+รับเงิน+เงินทอน) แล้วเนื้อหาล้นออกนอก canvas
  let estHeight = Math.round(14 * scale); // padding บน
  estHeight += lineH(Math.round(24 * scale)); // ชื่อร้าน
  if (settings.address) estHeight += lineH(smallSize);
  if (settings.phone) estHeight += lineH(smallSize);
  estHeight += Math.round(6 * scale) + lineH(baseSize) + Math.round(4 * scale); // หัวใบเสร็จ
  estHeight += lineH(smallSize) * 2; // เลขที่บิล, วันที่
  if (sale.customer_name) estHeight += lineH(smallSize);
  estHeight += dividerH();
  estHeight += sale.items.length * (lineH(baseSize) + lineH(smallSize) + Math.round(4 * scale));
  estHeight += dividerH() + lineH(Math.round(22 * scale)) + dividerH();
  estHeight += lineH(smallSize); // ชำระโดย
  if (sale.received_amount != null) estHeight += lineH(smallSize);
  if (sale.change_amount != null) estHeight += lineH(smallSize);
  if (sale.status === 'cancelled' || sale.status === 'refunded') {
    estHeight += Math.round(10 * scale) + lineH(smallSize) * 3;
  }
  if (settings.receipt_footer) estHeight += Math.round(10 * scale) + lineH(smallSize);
  estHeight += Math.round(10 * scale) + Math.round(20 * scale); // margin ล่าง + กันเผื่อ

  const canvas = document.createElement('canvas');
  canvas.width = widthPx;
  canvas.height = estHeight;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, widthPx, estHeight);
  ctx.fillStyle = '#000';
  ctx.textBaseline = 'top';

  let y = Math.round(14 * scale);

  function center(text, size, bold) {
    ctx.font = `${bold ? '700' : '400'} ${size}px Prompt, sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillText(text, widthPx / 2, y);
    y += Math.round(size * 1.4);
  }

  function row(left, right, size, bold) {
    ctx.font = `${bold ? '700' : '400'} ${size}px Prompt, sans-serif`;
    ctx.textAlign = 'left';
    ctx.fillText(left, pad, y);
    if (right) {
      ctx.textAlign = 'right';
      ctx.fillText(right, widthPx - pad, y);
    }
    y += Math.round(size * 1.4);
  }

  function divider() {
    y += Math.round(6 * scale);
    ctx.beginPath();
    ctx.setLineDash([Math.round(4 * scale), Math.round(4 * scale)]);
    ctx.moveTo(pad, y);
    ctx.lineTo(widthPx - pad, y);
    ctx.strokeStyle = '#000';
    ctx.stroke();
    ctx.setLineDash([]);
    y += Math.round(10 * scale);
  }

  center(settings.shop_name || 'Mini POS', Math.round(24 * scale), true);
  if (settings.address) center(settings.address, smallSize, false);
  if (settings.phone) center(`โทร. ${settings.phone}`, smallSize, false);
  y += Math.round(6 * scale);
  center('ใบเสร็จรับเงิน / RECEIPT', baseSize, true);
  y += Math.round(4 * scale);

  row('เลขที่บิล', `#${sale.id}`, smallSize, false);
  row('วันที่', formatDateTime(sale.created_at), smallSize, false);
  if (sale.customer_name) row('ลูกค้า', sale.customer_name, smallSize, false);

  divider();

  for (const item of sale.items) {
    row(item.name, `฿${formatCurrency(item.subtotal)}`, baseSize, true);
    row(`${formatCurrency(item.price)} × ${item.quantity}`, '', smallSize, false);
    y += Math.round(4 * scale);
  }

  divider();
  row('ยอดรวม', `฿${formatCurrency(sale.total)}`, Math.round(22 * scale), true);
  divider();

  row('ชำระโดย', PAYMENT_LABELS[sale.payment_method] || sale.payment_method, smallSize, false);
  if (sale.received_amount != null) row('รับเงิน', `฿${formatCurrency(sale.received_amount)}`, smallSize, false);
  if (sale.change_amount != null) row('เงินทอน', `฿${formatCurrency(sale.change_amount)}`, smallSize, false);

  if (sale.status === 'cancelled' || sale.status === 'refunded') {
    y += Math.round(10 * scale);
    center(sale.status === 'cancelled' ? '** ใบเสร็จนี้ถูกยกเลิก **' : '** ใบเสร็จนี้คืนเงินแล้ว **', smallSize, true);
    center(`โดย ${sale.voided_by || '-'}`, smallSize, false);
    center(`เหตุผล: ${sale.voided_reason || '-'}`, smallSize, false);
  }

  if (settings.receipt_footer) {
    y += Math.round(10 * scale);
    center(settings.receipt_footer, smallSize, false);
  }

  y += Math.round(10 * scale);

  const finalHeight = Math.min(estHeight, Math.ceil(y / 8) * 8 + 8);
  if (finalHeight === estHeight) return canvas;
  const cropped = document.createElement('canvas');
  cropped.width = widthPx;
  cropped.height = finalHeight;
  cropped.getContext('2d').drawImage(canvas, 0, 0);
  return cropped;
}

const printBluetoothBtn = document.getElementById('printBluetoothBtn');
const printBluetoothLabel = document.getElementById('printBluetoothLabel');
const printerWidthSelect = document.getElementById('printerWidthSelect');

printerWidthSelect.value = localStorage.getItem('pos-printer-width') || '384';
printerWidthSelect.addEventListener('change', () => {
  localStorage.setItem('pos-printer-width', printerWidthSelect.value);
});

printBluetoothBtn.addEventListener('click', async () => {
  if (!currentSale) return;
  printBluetoothBtn.disabled = true;
  printBluetoothLabel.textContent = 'กำลังเชื่อมต่อ...';
  try {
    await btPrinter.ensureConnected();
    printBluetoothLabel.textContent = 'กำลังพิมพ์...';
    const widthPx = Number(printerWidthSelect.value);
    const canvas = await renderReceiptToCanvas(currentSale, currentSettings, widthPx);
    await btPrinter.printCanvas(canvas);
    showToast('พิมพ์สำเร็จ');
  } catch (err) {
    showToast(err.message);
  } finally {
    printBluetoothBtn.disabled = false;
    printBluetoothLabel.textContent = 'พิมพ์ผ่านเครื่องพิมพ์';
  }
});

loadReceipt();
