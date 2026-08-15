// ไฟล์นี้ทำหน้าที่: หน้าตั้งค่าร้านค้า (settings.html)
// - โหลด/บันทึกข้อมูลร้าน (ชื่อร้าน, ที่อยู่, เบอร์โทร, ข้อความท้ายใบเสร็จ) ผ่าน API /api/settings
//   (แอดมินเลือกตั้งค่าร้านของพนักงานคนอื่นได้ผ่าน ownerSelect)
// - ฟอร์มเปลี่ยนรหัสผ่านของผู้ใช้ที่ล็อกอินอยู่ ผ่าน API changePassword (ไม่ผูกกับ ownerSelect เพราะเป็นรหัสผ่านของบัญชีตัวเอง)

const fields = {
  shopName: document.getElementById('fieldShopName'),
  address: document.getElementById('fieldAddress'),
  phone: document.getElementById('fieldPhone'),
  footer: document.getElementById('fieldFooter'),
};
const ownerSelect = document.getElementById('ownerSelect');
const ownerSelectWrap = document.getElementById('ownerSelectWrap');

function selectedOwnerId() {
  return ownerSelect.value ? Number(ownerSelect.value) : window.currentUserId;
}

async function setupOwnerSelect() {
  if (window.currentUserRole !== 'admin') return;
  const users = await api.getUsers();
  ownerSelect.innerHTML = users.map((u) => `
    <option value="${u.id}">${escapeHtml(u.username)}${u.username === window.currentUsername ? ' (คุณ)' : ''}${u.active ? '' : ' (ปิดใช้งาน)'}</option>
  `).join('');
  ownerSelect.value = window.currentUserId;
  ownerSelectWrap.classList.remove('hidden');
  ownerSelect.addEventListener('change', loadSettings);
}

async function loadSettings() {
  const s = await api.getSettings(selectedOwnerId());
  fields.shopName.value = s.shop_name || '';
  fields.address.value = s.address || '';
  fields.phone.value = s.phone || '';
  fields.footer.value = s.receipt_footer || '';
}

async function init() {
  await setupOwnerSelect();
  await loadSettings();
}

document.getElementById('settingsForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    await api.updateSettings({
      shop_name: fields.shopName.value.trim(),
      address: fields.address.value.trim(),
      phone: fields.phone.value.trim(),
      receipt_footer: fields.footer.value.trim(),
    }, selectedOwnerId());
    showToast('บันทึกข้อมูลร้านแล้ว');
  } catch (err) {
    showToast(err.message);
  }
});

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

document.getElementById('passwordForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const currentPassword = document.getElementById('fieldCurrentPassword').value;
  const newPassword = document.getElementById('fieldNewPassword').value;
  try {
    await api.changePassword(currentPassword, newPassword);
    e.target.reset();
    showToast('เปลี่ยนรหัสผ่านแล้ว');
  } catch (err) {
    showToast(err.message);
  }
});

if (window.currentUserId) {
  init();
} else {
  window.addEventListener('pos-auth-ready', init, { once: true });
}
