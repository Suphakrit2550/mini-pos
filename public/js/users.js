function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

let users = [];
const tableBody = document.getElementById('userTableBody');

const ROLE_LABELS = { admin: 'แอดมิน', staff: 'พนักงาน' };

function formatDate(datetimeStr) {
  return datetimeStr.slice(0, 10);
}

function isLocked(u) {
  return !!u.locked_until && new Date(u.locked_until) > new Date();
}

async function loadUsers() {
  users = await api.getUsers();
  renderTable();
}

function renderTable() {
  tableBody.innerHTML = users.map((u) => {
    const isSelf = u.username === window.currentUsername;
    const locked = isLocked(u);
    return `
    <tr data-id="${u.id}">
      <td>${escapeHtml(u.username)}${isSelf ? ' <span class="muted">(คุณ)</span>' : ''}</td>
      <td><span class="role-badge role-badge-${u.role}">${ROLE_LABELS[u.role] || u.role}</span></td>
      <td>
        <span class="status-badge status-badge-${u.active ? 'active' : 'inactive'}">${u.active ? 'เปิดใช้งาน' : 'ปิดใช้งาน'}</span>
        ${locked ? '<span class="status-badge status-badge-locked">🔒 ล็อกชั่วคราว</span>' : ''}
      </td>
      <td>${formatDate(u.created_at)}</td>
      <td>
        <div class="row-actions">
          <button class="btn btn-ghost role-btn">${u.role === 'admin' ? 'ลดเป็นพนักงาน' : 'เลื่อนเป็นแอดมิน'}</button>
          <button class="btn btn-ghost reset-btn">รีเซ็ตรหัสผ่าน</button>
          ${locked ? '<button class="btn btn-ghost unlock-btn">ปลดล็อก</button>' : ''}
          <button class="btn btn-ghost toggle-active-btn" ${isSelf ? 'disabled' : ''}>${u.active ? 'ปิดใช้งาน' : 'เปิดใช้งาน'}</button>
          <button class="btn btn-danger delete-btn" ${isSelf ? 'disabled' : ''}>ลบ</button>
        </div>
      </td>
    </tr>
  `;
  }).join('');

  tableBody.querySelectorAll('tr').forEach((row) => {
    const id = Number(row.dataset.id);
    row.querySelector('.role-btn').addEventListener('click', () => toggleRole(id));
    row.querySelector('.reset-btn').addEventListener('click', () => openResetPassword(id));
    const unlockBtn = row.querySelector('.unlock-btn');
    if (unlockBtn) unlockBtn.addEventListener('click', () => unlockUser(id));
    row.querySelector('.toggle-active-btn').addEventListener('click', () => toggleActive(id));
    row.querySelector('.delete-btn').addEventListener('click', () => openDeleteUser(id));
  });
}

async function unlockUser(id) {
  try {
    await api.updateUser(id, { unlock: true });
    showToast('ปลดล็อกบัญชีแล้ว');
    await loadUsers();
  } catch (err) {
    showToast(err.message);
  }
}

async function toggleRole(id) {
  const u = users.find((x) => x.id === id);
  if (!u) return;
  const nextRole = u.role === 'admin' ? 'staff' : 'admin';
  try {
    await api.updateUser(id, { role: nextRole });
    showToast('เปลี่ยนสิทธิ์แล้ว');
    await loadUsers();
  } catch (err) {
    showToast(err.message);
  }
}

async function toggleActive(id) {
  const u = users.find((x) => x.id === id);
  if (!u) return;
  try {
    await api.updateUser(id, { active: !u.active });
    showToast(u.active ? 'ปิดใช้งานบัญชีแล้ว' : 'เปิดใช้งานบัญชีแล้ว');
    await loadUsers();
  } catch (err) {
    showToast(err.message);
  }
}

// Add user modal
const userModal = document.getElementById('userModal');
const userForm = document.getElementById('userForm');
const fields = {
  username: document.getElementById('fieldUsername'),
  password: document.getElementById('fieldPassword'),
  role: document.getElementById('fieldRole'),
};

document.getElementById('addUserBtn').addEventListener('click', () => {
  userForm.reset();
  userModal.classList.remove('hidden');
  fields.username.focus();
});

document.getElementById('cancelUser').addEventListener('click', () => {
  userModal.classList.add('hidden');
});

userForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    await api.createUser({
      username: fields.username.value.trim(),
      password: fields.password.value,
      role: fields.role.value,
    });
    showToast('เพิ่มผู้ใช้แล้ว');
    userModal.classList.add('hidden');
    await loadUsers();
  } catch (err) {
    showToast(err.message);
  }
});

// Reset password modal
const resetPasswordModal = document.getElementById('resetPasswordModal');
const resetPasswordUsername = document.getElementById('resetPasswordUsername');
const fieldResetPassword = document.getElementById('fieldResetPassword');
let resetTargetId = null;

function openResetPassword(id) {
  const u = users.find((x) => x.id === id);
  if (!u) return;
  resetTargetId = id;
  resetPasswordUsername.textContent = `ผู้ใช้: ${u.username}`;
  fieldResetPassword.value = '';
  resetPasswordModal.classList.remove('hidden');
}

document.getElementById('cancelResetPassword').addEventListener('click', () => {
  resetPasswordModal.classList.add('hidden');
});

document.getElementById('confirmResetPassword').addEventListener('click', async () => {
  const newPassword = fieldResetPassword.value;
  if (newPassword.length < 6) {
    showToast('รหัสผ่านใหม่ต้องมีอย่างน้อย 6 ตัวอักษร');
    return;
  }
  try {
    await api.updateUser(resetTargetId, { newPassword });
    showToast('รีเซ็ตรหัสผ่านแล้ว');
    resetPasswordModal.classList.add('hidden');
  } catch (err) {
    showToast(err.message);
  }
});

// Delete user modal
const deleteUserModal = document.getElementById('deleteUserModal');
const deleteUserName = document.getElementById('deleteUserName');
const fieldDeleteConfirmPassword = document.getElementById('fieldDeleteConfirmPassword');
let deleteTargetId = null;

function openDeleteUser(id) {
  const u = users.find((x) => x.id === id);
  if (!u) return;
  deleteTargetId = id;
  deleteUserName.textContent = `ผู้ใช้: ${u.username}`;
  fieldDeleteConfirmPassword.value = '';
  deleteUserModal.classList.remove('hidden');
}

document.getElementById('cancelDeleteUser').addEventListener('click', () => {
  deleteUserModal.classList.add('hidden');
});

document.getElementById('confirmDeleteUser').addEventListener('click', async () => {
  if (!fieldDeleteConfirmPassword.value) {
    showToast('กรุณาใส่รหัสผ่านของคุณเพื่อยืนยัน');
    return;
  }
  try {
    await api.deleteUser(deleteTargetId, fieldDeleteConfirmPassword.value);
    deleteUserModal.classList.add('hidden');
    showToast('ลบผู้ใช้แล้ว');
    await loadUsers();
  } catch (err) {
    showToast(err.message);
  }
});

if (window.currentUsername) {
  loadUsers();
} else {
  window.addEventListener('pos-auth-ready', loadUsers, { once: true });
}
