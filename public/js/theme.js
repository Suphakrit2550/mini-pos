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
