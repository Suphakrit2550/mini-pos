// ไฟล์นี้ทำหน้าที่: ศูนย์รวมฟังก์ชันเรียก API ทั้งหมดของฝั่งหน้าเว็บ (ต้องโหลดก่อนไฟล์อื่นๆ)
// - object `api` มีเมธอดครบทุกอย่าง เช่น สินค้า, การขาย, รายงาน, ตั้งค่า, ผู้ใช้ ที่ยิง fetch ไปยัง server
// - มีฟังก์ชันช่วยเหลือทั่วไปที่หน้าอื่นเรียกใช้ได้: formatCurrency (จัดรูปแบบตัวเลขเงิน),
//   getDefaultActor/setDefaultActor (จำชื่อพนักงานล่าสุดไว้ใน localStorage), showToast (ข้อความแจ้งเตือนเด้งล่าง)

const api = {
  async request(method, url, body) {
    const res = await fetch(url, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || `Request failed (${res.status})`);
    }
    if (res.status === 204) return null;
    return res.json();
  },

  getProducts(activeOnly = false, ownerId = null) {
    const params = new URLSearchParams();
    if (activeOnly) params.set('active', '1');
    if (ownerId) params.set('owner_id', ownerId);
    const qs = params.toString();
    return this.request('GET', `/api/products${qs ? `?${qs}` : ''}`);
  },
  createProduct(data) {
    return this.request('POST', '/api/products', data);
  },
  updateProduct(id, data) {
    return this.request('PUT', `/api/products/${id}`, data);
  },
  deleteProduct(id, actor, reason) {
    return this.request('DELETE', `/api/products/${id}`, { actor, reason });
  },
  adjustStock(id, change, actor, reason) {
    return this.request('POST', `/api/products/${id}/stock`, { change, actor, reason });
  },
  getProductHistory(id) {
    return this.request('GET', `/api/products/${id}/history`);
  },
  getProductByBarcode(code) {
    return this.request('GET', `/api/products/barcode/${encodeURIComponent(code)}`);
  },
  async uploadProductImage(id, file) {
    const formData = new FormData();
    formData.append('image', file);
    const res = await fetch(`/api/products/${id}/image`, { method: 'POST', body: formData });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || `Request failed (${res.status})`);
    }
    return res.json();
  },

  createSale(payload) {
    return this.request('POST', '/api/sales', payload);
  },
  getSales(from, to, userId = null) {
    const params = new URLSearchParams();
    if (from && to) { params.set('from', from); params.set('to', to); }
    if (userId) params.set('user_id', userId);
    const qs = params.toString();
    return this.request('GET', `/api/sales${qs ? `?${qs}` : ''}`);
  },
  getSale(id) {
    return this.request('GET', `/api/sales/${id}`);
  },
  voidSale(id, action, actor, reason) {
    return this.request('POST', `/api/sales/${id}/void`, { action, actor, reason });
  },

  getSummary(from, to, userId = null) {
    const params = new URLSearchParams();
    if (from && to) { params.set('from', from); params.set('to', to); }
    if (userId) params.set('user_id', userId);
    const qs = params.toString();
    return this.request('GET', `/api/reports/summary${qs ? `?${qs}` : ''}`);
  },
  getLowStock(userId = null) {
    const q = userId ? `?user_id=${userId}` : '';
    return this.request('GET', `/api/reports/low-stock${q}`);
  },

  getSettings(userId = null) {
    const q = userId ? `?user_id=${userId}` : '';
    return this.request('GET', `/api/settings${q}`);
  },
  updateSettings(data, userId = null) {
    return this.request('PUT', '/api/settings', userId ? { ...data, user_id: userId } : data);
  },

  changePassword(currentPassword, newPassword) {
    return this.request('PUT', '/api/auth/password', { currentPassword, newPassword });
  },

  getAuditLog(from, to, entityType = null) {
    const params = new URLSearchParams();
    if (from && to) { params.set('from', from); params.set('to', to); }
    if (entityType) params.set('entity_type', entityType);
    const qs = params.toString();
    return this.request('GET', `/api/audit${qs ? `?${qs}` : ''}`);
  },

  getUsers() {
    return this.request('GET', '/api/users');
  },
  createUser(data) {
    return this.request('POST', '/api/users', data);
  },
  updateUser(id, data) {
    return this.request('PUT', `/api/users/${id}`, data);
  },
  deleteUser(id, confirmPassword) {
    return this.request('DELETE', `/api/users/${id}`, { confirmPassword });
  },
};

function formatCurrency(n) {
  return new Intl.NumberFormat('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
}

function getDefaultActor() {
  return localStorage.getItem('pos-staff-name') || '';
}

function setDefaultActor(name) {
  if (name) localStorage.setItem('pos-staff-name', name);
}

function showToast(message) {
  let toast = document.querySelector('.toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.className = 'toast';
    document.body.appendChild(toast);
  }
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => toast.classList.remove('show'), 2200);
}
