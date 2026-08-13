// ไฟล์นี้ทำหน้าที่: สลับโหมดธีมสว่าง/มืด (light/dark) ของหน้าเว็บ
// เมื่อกดปุ่ม จะสลับ attribute data-theme บน <html> และจำค่าไว้ใน localStorage
// เพื่อให้เปิดหน้าเว็บครั้งต่อไปแล้วยังใช้ธีมเดิม พร้อมเปลี่ยนไอคอนปุ่ม (🌙/☀️) ตามธีม

const themeToggleBtn = document.getElementById('themeToggle');

function applyThemeIcon() {
  const theme = document.documentElement.getAttribute('data-theme') || 'light';
  themeToggleBtn.textContent = theme === 'dark' ? '☀️' : '🌙';
}

themeToggleBtn.addEventListener('click', () => {
  const current = document.documentElement.getAttribute('data-theme') || 'light';
  const next = current === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  localStorage.setItem('pos-theme', next);
  applyThemeIcon();
});

applyThemeIcon();
