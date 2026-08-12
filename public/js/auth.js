document.documentElement.style.visibility = 'hidden';

(async function () {
  let data;
  try {
    data = await fetch('/api/auth/status').then((r) => r.json());
  } catch (e) {
    document.documentElement.style.visibility = 'visible';
    return;
  }

  if (!data.hasUsers) {
    location.replace('setup.html');
    return;
  }
  if (!data.authenticated) {
    location.replace('login.html');
    return;
  }
  if (window.REQUIRE_ADMIN && data.role !== 'admin') {
    location.replace('index.html');
    return;
  }

  document.documentElement.style.visibility = 'visible';
  window.currentUserId = data.id;
  window.currentUsername = data.username;
  window.currentUserRole = data.role;
  window.dispatchEvent(new CustomEvent('pos-auth-ready', { detail: data }));

  function injectTopbar() {
    if (data.role === 'admin') {
      const nav = document.querySelector('.nav');
      if (nav) {
        const link = document.createElement('a');
        link.href = 'users.html';
        link.textContent = 'จัดการผู้ใช้งาน';
        if (location.pathname.endsWith('users.html')) link.className = 'active';
        nav.appendChild(link);
      }
    }

    const topbarRight = document.querySelector('.topbar-right');
    if (!topbarRight) return;

    const wrap = document.createElement('div');
    wrap.className = 'auth-user';

    const nameEl = document.createElement('span');
    nameEl.className = 'muted auth-username';
    nameEl.textContent = data.username;

    const logoutBtn = document.createElement('button');
    logoutBtn.className = 'btn btn-ghost';
    logoutBtn.textContent = 'ออกจากระบบ';
    logoutBtn.addEventListener('click', async () => {
      await fetch('/api/auth/logout', { method: 'POST' });
      location.href = 'login.html';
    });

    wrap.append(nameEl, logoutBtn);
    topbarRight.appendChild(wrap);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', injectTopbar);
  } else {
    injectTopbar();
  }
})();
