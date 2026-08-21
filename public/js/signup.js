// ไฟล์นี้ทำหน้าที่: หน้าสมัครสมาชิกแบบเปิดสาธารณะ (signup.html) สร้างบัญชีร้านค้าใหม่
// - ถ้า login ค้างอยู่แล้ว จะเด้งไปหน้าแรกทันที (ไม่ให้สมัครซ้ำ)
// - ตรวจสอบว่ารหัสผ่านที่กรอกสองช่องตรงกัน ก่อนส่งไปสร้างบัญชีผ่าน API /api/auth/register

const errorBox = document.getElementById('authError');
const submitBtn = document.getElementById('submitBtn');

function showAuthError(message) {
  errorBox.textContent = message;
  errorBox.classList.add('show');
}

(async function redirectIfNotNeeded() {
  const data = await fetch('/api/auth/status').then((r) => r.json());
  if (data.authenticated) location.replace('index.html');
})();

document.getElementById('signupForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  errorBox.classList.remove('show');
  const username = document.getElementById('fieldUsername').value;
  const password = document.getElementById('fieldPassword').value;
  const confirm = document.getElementById('fieldPasswordConfirm').value;
  if (password !== confirm) {
    showAuthError('รหัสผ่านทั้งสองช่องไม่ตรงกัน');
    return;
  }
  submitBtn.disabled = true;
  submitBtn.textContent = 'กำลังสมัครสมาชิก...';
  try {
    const res = await fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      showAuthError(data.error || 'สมัครสมาชิกไม่สำเร็จ');
      return;
    }
    location.href = 'index.html';
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = 'สมัครสมาชิก';
  }
});
