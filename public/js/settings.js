const fields = {
  shopName: document.getElementById('fieldShopName'),
  address: document.getElementById('fieldAddress'),
  phone: document.getElementById('fieldPhone'),
  footer: document.getElementById('fieldFooter'),
};

async function loadSettings() {
  const s = await api.getSettings();
  fields.shopName.value = s.shop_name || '';
  fields.address.value = s.address || '';
  fields.phone.value = s.phone || '';
  fields.footer.value = s.receipt_footer || '';
}

document.getElementById('settingsForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    await api.updateSettings({
      shop_name: fields.shopName.value.trim(),
      address: fields.address.value.trim(),
      phone: fields.phone.value.trim(),
      receipt_footer: fields.footer.value.trim(),
    });
    showToast('บันทึกข้อมูลร้านแล้ว');
  } catch (err) {
    showToast(err.message);
  }
});

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

loadSettings();
