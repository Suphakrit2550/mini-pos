// ไฟล์นี้ทำหน้าที่: หน้าเข้าสู่ระบบ (login.html)
// - เช็คก่อนว่ายังไม่มีผู้ใช้ในระบบไหม (ถ้าไม่มีให้ไปหน้า setup) หรือ login ค้างอยู่แล้ว (ให้เด้งเข้าหน้าแรก)
// - รับ username/password จากฟอร์ม แล้วส่งไปยัง API /api/auth/login เพื่อเข้าสู่ระบบ
// - ถ้า login ไม่สำเร็จ จะโชว์ข้อความ error สีแดงใต้ฟอร์ม

const errorBox = document.getElementById('authError');
const submitBtn = document.getElementById('submitBtn');

function showAuthError(message) {
  errorBox.textContent = message;
  errorBox.classList.add('show');
}

(async function redirectIfNotNeeded() {
  const data = await fetch('/api/auth/status').then((r) => r.json());
  if (!data.hasUsers) return location.replace('setup.html');
  if (data.authenticated) return location.replace('index.html');
})();

document.getElementById('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  errorBox.classList.remove('show');
  const username = document.getElementById('fieldUsername').value;
  const password = document.getElementById('fieldPassword').value;
  submitBtn.disabled = true;
  submitBtn.textContent = 'กำลังเข้าสู่ระบบ...';
  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      showAuthError(data.error || 'เข้าสู่ระบบไม่สำเร็จ');
      return;
    }
    location.href = 'index.html';
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = 'เข้าสู่ระบบ';
  }
});
