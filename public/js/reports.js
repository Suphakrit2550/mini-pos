// ไฟล์นี้ทำหน้าที่: หน้ารายงานยอดขาย (reports.html)
// - เลือกช่วงวันที่ แล้วดึงสรุปยอดขาย/กำไร/จำนวนออเดอร์ ยอดขายรายวัน และสินค้าขายดี จาก API /api/reports/summary
// - แสดงรายการสินค้าที่ใกล้หมดสต็อกจาก /api/reports/low-stock
// - แอดมินดูรวมทุกบัญชี (ค่าเริ่มต้น) หรือกรองดูของพนักงานคนใดคนหนึ่งได้ผ่าน ownerSelect

const fromDateInput = document.getElementById('fromDate');
const toDateInput = document.getElementById('toDate');
const ownerSelect = document.getElementById('ownerSelect');
const ownerSelectWrap = document.getElementById('ownerSelectWrap');

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

fromDateInput.value = todayStr();
toDateInput.value = todayStr();

async function setupOwnerSelect() {
  if (window.currentUserRole !== 'admin') return;
  const users = await api.getUsers();
  ownerSelect.innerHTML = '<option value="">ทุกคน (รวมทั้งร้าน)</option>' + users.map((u) => `
    <option value="${u.id}">${escapeHtml(u.username)}${u.username === window.currentUsername ? ' (คุณ)' : ''}${u.active ? '' : ' (ปิดใช้งาน)'}</option>
  `).join('');
  ownerSelectWrap.classList.remove('hidden');
  ownerSelect.addEventListener('change', loadReports);
}

async function loadReports() {
  const from = fromDateInput.value;
  const to = toDateInput.value;
  const userId = ownerSelect.value ? Number(ownerSelect.value) : null;

  const [summary, lowStock] = await Promise.all([
    api.getSummary(from, to, userId),
    api.getLowStock(userId),
  ]);

  document.getElementById('totalRevenue').textContent = `฿${formatCurrency(summary.revenue || 0)}`;
  document.getElementById('totalProfit').textContent = `฿${formatCurrency(summary.profit || 0)}`;
  document.getElementById('totalOrders').textContent = summary.order_count || 0;

  const dailyBody = document.getElementById('dailyBody');
  const dailyEmpty = document.getElementById('dailyEmpty');
  if (!summary.byDay || summary.byDay.length === 0) {
    dailyBody.innerHTML = '';
    dailyEmpty.classList.remove('hidden');
  } else {
    dailyEmpty.classList.add('hidden');
    dailyBody.innerHTML = summary.byDay.map(d => `
      <tr>
        <td>${escapeHtml(d.day)}</td>
        <td class="text-right">${d.order_count}</td>
        <td class="text-right">฿${formatCurrency(d.revenue)}</td>
        <td class="text-right">฿${formatCurrency(d.profit)}</td>
      </tr>
    `).join('');
  }

  const topBody = document.getElementById('topProductsBody');
  const topEmpty = document.getElementById('topEmpty');
  if (!summary.topProducts || summary.topProducts.length === 0) {
    topBody.innerHTML = '';
    topEmpty.classList.remove('hidden');
  } else {
    topEmpty.classList.add('hidden');
    topBody.innerHTML = summary.topProducts.map(p => `
      <tr>
        <td>${escapeHtml(p.name)}</td>
        <td class="text-right">${p.quantity}</td>
        <td class="text-right">฿${formatCurrency(p.revenue)}</td>
      </tr>
    `).join('');
  }

  const lowBody = document.getElementById('lowStockBody');
  const lowEmpty = document.getElementById('lowStockEmpty');
  if (!lowStock || lowStock.length === 0) {
    lowBody.innerHTML = '';
    lowEmpty.classList.remove('hidden');
  } else {
    lowEmpty.classList.add('hidden');
    lowBody.innerHTML = lowStock.map(p => `
      <tr>
        <td>${escapeHtml(p.name)}</td>
        <td class="text-right"><span class="badge badge-low">${p.stock}</span></td>
      </tr>
    `).join('');
  }
}

document.getElementById('applyFilter').addEventListener('click', loadReports);
document.getElementById('todayFilter').addEventListener('click', () => {
  fromDateInput.value = todayStr();
  toDateInput.value = todayStr();
  loadReports();
});

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

async function init() {
  await setupOwnerSelect();
  await loadReports();
}

if (window.currentUserId) {
  init();
} else {
  window.addEventListener('pos-auth-ready', init, { once: true });
}
