// ไฟล์นี้ทำหน้าที่: เปิด/ปิดเมนูแบบ hamburger บนหน้าจอมือถือ (ปุ่มไอคอนเมนูในแถบเมนูบนสุด)
// ใช้ร่วมกับ CSS ใน style.css (.nav-toggle / .nav.nav-open)

document.addEventListener('DOMContentLoaded', () => {
  const toggle = document.getElementById('navToggle');
  const nav = document.querySelector('.nav');
  if (!toggle || !nav) return;

  toggle.addEventListener('click', () => {
    nav.classList.toggle('nav-open');
  });

  // Close the menu once a link is picked, and when tapping outside it.
  nav.querySelectorAll('a').forEach((link) => {
    link.addEventListener('click', () => nav.classList.remove('nav-open'));
  });

  document.addEventListener('click', (e) => {
    if (!nav.classList.contains('nav-open')) return;
    if (nav.contains(e.target) || toggle.contains(e.target)) return;
    nav.classList.remove('nav-open');
  });
});
