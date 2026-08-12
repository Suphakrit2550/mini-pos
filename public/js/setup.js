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
