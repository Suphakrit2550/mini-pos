// ไฟล์นี้ทำหน้าที่: หน้าแสดงใบเสร็จ (receipt.html) สำหรับพิมพ์หรือดูย้อนหลัง
// - อ่านเลขที่บิล (id) จาก URL แล้วดึงข้อมูลบิลและข้อมูลร้านมาแสดงผลเป็นใบเสร็จ
// - แสดงป้ายแจ้งเตือนถ้าบิลถูกยกเลิก/คืนเงินแล้ว และมีปุ่มพิมพ์/ย้อนกลับ

const receiptRoot = document.getElementById('receiptRoot');

const PAYMENT_LABELS = { cash: 'เงินสด' };

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

loadReceipt();
