// ไฟล์นี้ทำหน้าที่: หน้าบันทึกการใช้งานกลาง (audit.html) — เข้าถึงได้เฉพาะแอดมิน
// - รวมประวัติการแก้ไข/ลบสินค้า, ปรับสต็อก, ยกเลิก/คืนเงินบิล, และจัดการบัญชีผู้ใช้ ของทุกบัญชีมาแสดงในตารางเดียว
// - กรองได้ตามประเภทและช่วงวันที่ ผ่าน API /api/audit

const fromDateInput = document.getElementById('fromDate');
const toDateInput = document.getElementById('toDate');
const entityTypeFilter = document.getElementById('entityTypeFilter');
const tableBody = document.getElementById('auditTableBody');
const emptyState = document.getElementById('emptyState');

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

fromDateInput.value = todayStr();
toDateInput.value = todayStr();

function formatTime(datetimeStr) {
  return datetimeStr.slice(11, 16) + ' น. · ' + datetimeStr.slice(0, 10);
}

const ENTITY_LABELS = { product: 'สินค้า', sale: 'บิลขาย', user: 'ผู้ใช้งาน' };

const ACTION_LABELS = {
  update: 'แก้ไขข้อมูล',
  delete: 'ลบ',
  stock_adjust: 'ปรับสต็อก',
  cancel: 'ยกเลิกออเดอร์',
  refund: 'คืนเงิน',
  create: 'สร้าง',
  rename: 'เปลี่ยนชื่อผู้ใช้',
  role_change: 'เปลี่ยนสิทธิ์',
  activate: 'เปิดใช้งาน',
  deactivate: 'ปิดใช้งาน',
  password_reset: 'รีเซ็ตรหัสผ่าน',
  unlock: 'ปลดล็อกบัญชี',
};

// The detail JSON shape differs per entity_type/action (see logAudit() calls
// in products.js/sales.js/users.js) — this renders each shape into one
// readable line instead of raw JSON.
function renderDetail(entry) {
  const d = entry.detail;
  if (!d) return '';

  if (entry.action === 'stock_adjust') {
    const sign = d.change > 0 ? '+' : '';
    return `ปรับ ${sign}${d.change} (${d.from_stock} → ${d.to_stock})`;
  }
  if (entry.action === 'cancel' || entry.action === 'refund') {
    const items = (d.items || []).map((i) => `${i.name} ×${i.quantity}`).join(', ');
    return `฿${d.total}${items ? ` — ${items}` : ''}`;
  }
  if (entry.action === 'delete' && entry.entity_type === 'product') {
    return d.price !== undefined ? `${d.name} (฿${d.price})` : (d.name || '');
  }
  if (entry.action === 'delete' && entry.entity_type === 'user') {
    return d.username || '';
  }
  if (entry.action === 'create' && entry.entity_type === 'user') {
    return `${d.username || ''}${d.role ? ' · ' + d.role : ''}`;
  }
  if ('from' in d && 'to' in d) {
    return `${d.from} → ${d.to}`;
  }
  if (entry.action === 'update' && entry.entity_type === 'product') {
    return Object.entries(d).map(([field, v]) => `${field}: ${v.from} → ${v.to}`).join(', ');
  }
  return Object.entries(d).map(([k, v]) => `${k}: ${JSON.stringify(v)}`).join(', ');
}

async function loadAuditLog() {
  const entries = await api.getAuditLog(fromDateInput.value, toDateInput.value, entityTypeFilter.value || null);

  emptyState.classList.toggle('hidden', entries.length > 0);

  tableBody.innerHTML = entries.map((entry) => `
    <tr>
      <td>${formatTime(entry.created_at)}</td>
      <td><span class="audit-entity-badge">${ENTITY_LABELS[entry.entity_type] || entry.entity_type}</span></td>
      <td>#${entry.entity_id}</td>
      <td>${ACTION_LABELS[entry.action] || entry.action}</td>
      <td>${escapeHtml(entry.actor)}</td>
      <td>${entry.reason ? escapeHtml(entry.reason) : '-'}</td>
      <td class="audit-detail-cell">${escapeHtml(renderDetail(entry))}</td>
    </tr>
  `).join('');
}

document.getElementById('applyFilter').addEventListener('click', loadAuditLog);
entityTypeFilter.addEventListener('change', loadAuditLog);
document.getElementById('todayFilter').addEventListener('click', () => {
  fromDateInput.value = todayStr();
  toDateInput.value = todayStr();
  loadAuditLog();
});

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

if (window.currentUsername) {
  loadAuditLog();
} else {
  window.addEventListener('pos-auth-ready', loadAuditLog, { once: true });
}
