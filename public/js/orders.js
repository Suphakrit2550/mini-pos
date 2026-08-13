// ไฟล์นี้ทำหน้าที่: หน้ารายการออเดอร์/บิลขาย (orders.html)
// - แสดงรายการบิลตามช่วงวันที่ที่เลือก พร้อมสถานะ (สำเร็จ/ยกเลิก/คืนเงิน)
// - เปิดหน้าต่างดูรายละเอียดบิล พร้อมประวัติการแก้ไข (audit log)
// - มีปุ่มยกเลิกออเดอร์และคืนเงิน ที่ต้องกรอกชื่อผู้ดำเนินการและเหตุผลก่อนยืนยัน

const fromDateInput = document.getElementById('fromDate');
const toDateInput = document.getElementById('toDate');
const tableBody = document.getElementById('ordersTableBody');
const emptyState = document.getElementById('emptyState');

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

fromDateInput.value = todayStr();
toDateInput.value = todayStr();

function formatTime(datetimeStr) {
  return datetimeStr.slice(11, 16) + ' น. · ' + datetimeStr.slice(0, 10);
}

const STATUS_LABELS = {
  completed: { text: 'สำเร็จ', badge: 'badge-ok' },
  cancelled: { text: 'ยกเลิกแล้ว', badge: 'badge-cancelled' },
  refunded: { text: 'คืนเงินแล้ว', badge: 'badge-refunded' },
};

function statusBadge(status) {
  const s = STATUS_LABELS[status] || { text: status, badge: '' };
  return `<span class="badge ${s.badge}">${s.text}</span>`;
}

async function loadOrders() {
  const orders = await api.getSales(fromDateInput.value, toDateInput.value);

  emptyState.classList.toggle('hidden', orders.length > 0);

  tableBody.innerHTML = orders.map(o => `
    <tr data-id="${o.id}">
      <td>#${o.id}</td>
      <td>${formatTime(o.created_at)}</td>
      <td class="order-customer">${o.customer_name ? escapeHtml(o.customer_name) : '-'}</td>
      <td class="text-right">${o.item_count}</td>
      <td class="text-right">฿${formatCurrency(o.total)}</td>
      <td>${statusBadge(o.status)}</td>
      <td class="text-right"><button class="btn btn-ghost view-btn">ดูรายการ</button></td>
    </tr>
  `).join('');

  tableBody.querySelectorAll('tr').forEach(row => {
    const id = Number(row.dataset.id);
    row.querySelector('.view-btn').addEventListener('click', () => openDetail(id));
  });
}

document.getElementById('applyFilter').addEventListener('click', loadOrders);
document.getElementById('todayFilter').addEventListener('click', () => {
  fromDateInput.value = todayStr();
  toDateInput.value = todayStr();
  loadOrders();
});

const orderDetailModal = document.getElementById('orderDetailModal');
const detailOrderId = document.getElementById('detailOrderId');
const detailMeta = document.getElementById('detailMeta');
const detailStatus = document.getElementById('detailStatus');
const detailItems = document.getElementById('detailItems');
const detailVoidInfo = document.getElementById('detailVoidInfo');
const detailAudit = document.getElementById('detailAudit');
const detailVoidActions = document.getElementById('detailVoidActions');

let currentSaleId = null;

async function openDetail(id) {
  try {
    const sale = await api.getSale(id);
    currentSaleId = sale.id;
    detailOrderId.textContent = sale.id;
    detailMeta.textContent = sale.customer_name
      ? `ลูกค้า: ${sale.customer_name} · ${formatTime(sale.created_at)}`
      : formatTime(sale.created_at);
    detailStatus.innerHTML = statusBadge(sale.status);

    detailItems.innerHTML = sale.items.map(item => `
      <div class="detail-line">
        <span>${escapeHtml(item.name)} × ${item.quantity}</span>
        <span>฿${formatCurrency(item.subtotal)}</span>
      </div>
    `).join('') + `
      <div class="detail-line" style="font-weight:700; margin-top:8px;">
        <span>ยอดรวม</span>
        <span>฿${formatCurrency(sale.total)}</span>
      </div>
    `;

    if (sale.status !== 'completed') {
      detailVoidInfo.classList.remove('hidden');
      const actionLabel = sale.status === 'cancelled' ? 'ยกเลิกโดย' : 'คืนเงินโดย';
      detailVoidInfo.innerHTML = `
        ${actionLabel}: ${escapeHtml(sale.voided_by || '-')}<br>
        เมื่อ: ${sale.voided_at ? formatTime(sale.voided_at) : '-'}<br>
        เหตุผล: ${escapeHtml(sale.voided_reason || '-')}
      `;
      detailVoidActions.classList.add('hidden');
    } else {
      detailVoidInfo.classList.add('hidden');
      detailVoidActions.classList.remove('hidden');
    }

    detailAudit.innerHTML = (sale.audit || []).map(a => `
      <div class="audit-entry">
        ${formatTime(a.created_at)} · ${escapeHtml(a.actor)} · ${actionText(a.action)}
        ${a.reason ? ` — ${escapeHtml(a.reason)}` : ''}
      </div>
    `).join('');

    orderDetailModal.classList.remove('hidden');
  } catch (err) {
    showToast(err.message);
  }
}

function actionText(action) {
  return { cancel: 'ยกเลิกออเดอร์', refund: 'คืนเงิน' }[action] || action;
}

document.getElementById('closeDetail').addEventListener('click', () => {
  orderDetailModal.classList.add('hidden');
});

document.getElementById('printOrderBtn').addEventListener('click', () => {
  window.open(`receipt.html?id=${currentSaleId}&from=orders`, '_blank');
});

// Void modal (cancel / refund)
const voidModal = document.getElementById('voidModal');
const voidModalTitle = document.getElementById('voidModalTitle');
const voidActorInput = document.getElementById('voidActorInput');
const voidReasonInput = document.getElementById('voidReasonInput');
let pendingVoidAction = null;

function openVoidModal(action) {
  pendingVoidAction = action;
  voidModalTitle.textContent = action === 'cancel' ? 'ยกเลิกออเดอร์' : 'คืนเงิน';
  voidActorInput.value = getDefaultActor();
  voidReasonInput.value = '';
  voidModal.classList.remove('hidden');
}

document.getElementById('cancelOrderBtn').addEventListener('click', () => openVoidModal('cancel'));
document.getElementById('refundOrderBtn').addEventListener('click', () => openVoidModal('refund'));

document.getElementById('cancelVoid').addEventListener('click', () => {
  voidModal.classList.add('hidden');
});

document.getElementById('confirmVoid').addEventListener('click', async () => {
  const actor = voidActorInput.value.trim();
  const reason = voidReasonInput.value.trim();
  if (!actor) return showToast('กรุณาระบุชื่อผู้ดำเนินการ');
  if (!reason) return showToast('กรุณาระบุเหตุผล');

  try {
    await api.voidSale(currentSaleId, pendingVoidAction, actor, reason);
    setDefaultActor(actor);
    voidModal.classList.add('hidden');
    showToast(pendingVoidAction === 'cancel' ? 'ยกเลิกออเดอร์แล้ว' : 'คืนเงินแล้ว');
    await openDetail(currentSaleId);
    await loadOrders();
  } catch (err) {
    showToast(err.message);
  }
});

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

loadOrders();
