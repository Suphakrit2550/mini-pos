// ไฟล์นี้ทำหน้าที่: หน้าตั้งค่าเริ่มต้นระบบ (setup.html) สำหรับสร้างบัญชีแอดมินคนแรก
// - ถ้าระบบมีผู้ใช้อยู่แล้ว จะเด้งไปหน้า login หรือหน้าแรกทันที (ไม่ให้ setup ซ้ำ)
// - ตรวจสอบว่ารหัสผ่านที่กรอกสองช่องตรงกัน ก่อนส่งไปสร้างบัญชีผ่าน API /api/auth/setup

const errorBox = document.getElementById('authError');

function showAuthError(message) {
  errorBox.textContent = message;
  errorBox.classList.add('show');
}

(async function redirectIfNotNeeded() {
  const data = await fetch('/api/auth/status').then((r) => r.json());
  if (data.hasUsers) return location.replace(data.authenticated ? 'index.html' : 'login.html');
})();

document.getElementById('setupForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  errorBox.classList.remove('show');
  const username = document.getElementById('fieldUsername').value;
  const password = document.getElementById('fieldPassword').value;
  const confirm = document.getElementById('fieldPasswordConfirm').value;
  if (password !== confirm) {
    showAuthError('รหัสผ่านทั้งสองช่องไม่ตรงกัน');
    return;
  }
  const res = await fetch('/api/auth/setup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    showAuthError(data.error || 'สร้างบัญชีไม่สำเร็จ');
    return;
  }
  location.href = 'index.html';
});
