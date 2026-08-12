const errorBox = document.getElementById('authError');

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
});
