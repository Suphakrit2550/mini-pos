// ไฟล์นี้ทำหน้าที่: หน้ารายงานยอดขาย (reports.html)
// - เลือกช่วงวันที่ แล้วดึงสรุปยอดขาย/กำไร/จำนวนออเดอร์ ยอดขายรายวัน และสินค้าขายดี จาก API /api/reports/summary
// - แสดงรายการสินค้าที่ใกล้หมดสต็อกจาก /api/reports/low-stock

const fromDateInput = document.getElementById('fromDate');
const toDateInput = document.getElementById('toDate');

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

fromDateInput.value = todayStr();
toDateInput.value = todayStr();

async function loadReports() {
  const from = fromDateInput.value;
  const to = toDateInput.value;

  const [summary, lowStock] = await Promise.all([
    api.getSummary(from, to),
    api.getLowStock(),
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

loadReports();
