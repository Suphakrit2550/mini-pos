// ไฟล์นี้ทำหน้าที่: สลับโหมดธีมสว่าง/มืด (light/dark) ของหน้าเว็บ
// เมื่อกดปุ่ม จะสลับ attribute data-theme บน <html> และจำค่าไว้ใน localStorage
// เพื่อให้เปิดหน้าเว็บครั้งต่อไปแล้วยังใช้ธีมเดิม พร้อมเปลี่ยนไอคอนปุ่ม (SVG พระอาทิตย์/พระจันทร์) ตามธีม

const themeToggleBtn = document.getElementById('themeToggle');

const SUN_ICON = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><line x1="12" y1="2" x2="12" y2="4"/><line x1="12" y1="20" x2="12" y2="22"/><line x1="4" y1="12" x2="2" y2="12"/><line x1="22" y1="12" x2="20" y2="12"/><line x1="19.07" y1="4.93" x2="17.66" y2="6.34"/><line x1="6.34" y1="17.66" x2="4.93" y2="19.07"/><line x1="19.07" y1="19.07" x2="17.66" y2="17.66"/><line x1="6.34" y1="6.34" x2="4.93" y2="4.93"/></svg>';
const MOON_ICON = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 14.5A8.5 8.5 0 1 1 9.5 4a7 7 0 0 0 10.5 10.5z"/></svg>';

function applyThemeIcon() {
  const theme = document.documentElement.getAttribute('data-theme') || 'light';
  themeToggleBtn.innerHTML = theme === 'dark' ? SUN_ICON : MOON_ICON;
}

themeToggleBtn.addEventListener('click', () => {
  const current = document.documentElement.getAttribute('data-theme') || 'light';
  const next = current === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  localStorage.setItem('pos-theme', next);
  applyThemeIcon();
});

applyThemeIcon();
