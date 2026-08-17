// ไฟล์นี้ทำหน้าที่: หน้าจัดการสินค้า (products.html)
// - แสดงตารางสินค้า ค้นหาได้ (แอดมินเลือกดูสินค้าของพนักงานคนอื่นได้ผ่าน ownerSelect)
// - เพิ่ม/แก้ไขสินค้า (พร้อมอัปโหลดรูปและสแกนบาร์โค้ด), ปรับสต็อก, ลบสินค้า — ทุกการแก้ไข/ลบ/ปรับสต็อกต้องระบุผู้ดำเนินการและเหตุผล
// - แสดงประวัติการแก้ไขสินค้าแต่ละชิ้นในหน้าต่างแก้ไข

let products = [];

const tableBody = document.getElementById('productTableBody');
const emptyState = document.getElementById('emptyState');
const searchInput = document.getElementById('search');
const ownerSelect = document.getElementById('ownerSelect');
const ownerSelectWrap = document.getElementById('ownerSelectWrap');

function selectedOwnerId() {
  return ownerSelect.value ? Number(ownerSelect.value) : window.currentUserId;
}

async function setupOwnerSelect() {
  if (window.currentUserRole !== 'admin') return;
  const users = await api.getUsers();
  ownerSelect.innerHTML = users.map((u) => `
    <option value="${u.id}">${escapeHtml(u.username)}${u.username === window.currentUsername ? ' (คุณ)' : ''}${u.active ? '' : ' (ปิดใช้งาน)'}</option>
  `).join('');
  ownerSelect.value = window.currentUserId;
  ownerSelectWrap.classList.remove('hidden');
  ownerSelect.addEventListener('change', loadProducts);
}

async function loadProducts() {
  products = await api.getProducts(false, selectedOwnerId());
  renderTable();
}

async function init() {
  await setupOwnerSelect();
  await loadProducts();
}

function renderTable() {
  const term = searchInput.value.trim().toLowerCase();
  const filtered = products.filter(p => {
    if (!term) return true;
    return p.name.toLowerCase().includes(term) || (p.name_en || '').toLowerCase().includes(term);
  });

  emptyState.classList.toggle('hidden', filtered.length > 0);

  tableBody.innerHTML = filtered.map(p => `
    <tr data-id="${p.id}">
      <td>
        ${p.image
          ? `<img class="row-thumb" src="${escapeHtml(p.image)}" alt="">`
          : '<div class="row-thumb-placeholder"></div>'}
      </td>
      <td>
        <div class="row-name">${escapeHtml(p.name)}</div>
        ${p.name_en ? `<div class="row-name-en">${escapeHtml(p.name_en)}</div>` : ''}
      </td>
      <td>${escapeHtml(p.category || '-')}</td>
      <td class="text-right">฿${formatCurrency(p.price)}</td>
      <td class="text-right">
        ${p.stock}
        ${p.stock <= p.low_stock_threshold ? '<span class="badge badge-low">ใกล้หมด</span>' : ''}
      </td>
      <td>
        <div class="row-actions">
          <button class="btn btn-ghost stock-btn">สต็อก</button>
          <button class="btn btn-ghost edit-btn">แก้ไข</button>
          <button class="btn btn-danger delete-btn">ลบ</button>
        </div>
      </td>
    </tr>
  `).join('');

  tableBody.querySelectorAll('tr').forEach(row => {
    const id = Number(row.dataset.id);
    row.querySelector('.edit-btn').addEventListener('click', () => openEditModal(id));
    row.querySelector('.delete-btn').addEventListener('click', () => deleteProduct(id));
    row.querySelector('.stock-btn').addEventListener('click', () => openStockModal(id));
  });
}

searchInput.addEventListener('input', renderTable);

// Add/Edit modal
const productModal = document.getElementById('productModal');
const productForm = document.getElementById('productForm');
const modalTitle = document.getElementById('modalTitle');
const fields = {
  id: document.getElementById('productId'),
  name: document.getElementById('fieldName'),
  nameEn: document.getElementById('fieldNameEn'),
  price: document.getElementById('fieldPrice'),
  cost: document.getElementById('fieldCost'),
  stock: document.getElementById('fieldStock'),
  threshold: document.getElementById('fieldThreshold'),
  category: document.getElementById('fieldCategory'),
  barcode: document.getElementById('fieldBarcode'),
  image: document.getElementById('fieldImage'),
  actor: document.getElementById('fieldActor'),
  reason: document.getElementById('fieldReason'),
};
const imagePreview = document.getElementById('imagePreview');
const imagePlaceholder = document.getElementById('imagePlaceholder');
const editAuditFields = document.getElementById('editAuditFields');
const productHistory = document.getElementById('productHistory');

function formatTime(datetimeStr) {
  return datetimeStr.slice(11, 16) + ' น. · ' + datetimeStr.slice(0, 10);
}

const HISTORY_ACTION_LABELS = {
  update: 'แก้ไขข้อมูล',
  delete: 'ลบสินค้า',
  stock_adjust: 'ปรับสต็อก',
};

function renderHistoryDetail(entry) {
  if (entry.action === 'stock_adjust' && entry.detail) {
    const sign = entry.detail.change > 0 ? '+' : '';
    return `ปรับ ${sign}${entry.detail.change} (${entry.detail.from_stock} → ${entry.detail.to_stock})`;
  }
  if (entry.action === 'update' && entry.detail) {
    return Object.entries(entry.detail).map(([field, { from, to }]) => `${field}: ${from} → ${to}`).join(', ');
  }
  return '';
}

async function loadProductHistory(id) {
  try {
    const history = await api.getProductHistory(id);
    if (history.length === 0) {
      productHistory.innerHTML = '<div class="history-empty">ยังไม่มีประวัติการแก้ไข</div>';
      return;
    }
    productHistory.innerHTML = history.map(entry => `
      <div class="history-entry">
        ${formatTime(entry.created_at)} · ${escapeHtml(entry.actor)} · ${HISTORY_ACTION_LABELS[entry.action] || entry.action}
        ${entry.reason ? ` — ${escapeHtml(entry.reason)}` : ''}
        <div class="muted">${escapeHtml(renderHistoryDetail(entry))}</div>
      </div>
    `).join('');
  } catch (err) {
    productHistory.innerHTML = '<div class="history-empty">โหลดประวัติไม่สำเร็จ</div>';
  }
}

function setImagePreview(src) {
  if (src) {
    imagePreview.src = src;
    imagePreview.classList.remove('hidden');
    imagePlaceholder.classList.add('hidden');
  } else {
    imagePreview.src = '';
    imagePreview.classList.add('hidden');
    imagePlaceholder.classList.remove('hidden');
  }
}

fields.image.addEventListener('change', () => {
  const file = fields.image.files[0];
  if (!file) return;
  setImagePreview(URL.createObjectURL(file));
});

document.getElementById('scanBarcodeBtn').addEventListener('click', () => {
  Scanner.open({
    onScan: (code) => {
      fields.barcode.value = code;
      showToast(`สแกนได้: ${code}`);
    },
    continuous: false,
  });
});

document.getElementById('addProductBtn').addEventListener('click', () => {
  modalTitle.textContent = 'เพิ่มสินค้า';
  productForm.reset();
  fields.id.value = '';
  fields.threshold.value = 5;
  setImagePreview(null);
  editAuditFields.classList.add('hidden');
  productModal.classList.remove('hidden');
  fields.name.focus();
});

function openEditModal(id) {
  const p = products.find(x => x.id === id);
  if (!p) return;
  modalTitle.textContent = 'แก้ไขสินค้า';
  fields.id.value = p.id;
  fields.name.value = p.name;
  fields.nameEn.value = p.name_en || '';
  fields.price.value = p.price;
  fields.cost.value = p.cost;
  fields.stock.value = p.stock;
  fields.threshold.value = p.low_stock_threshold;
  fields.category.value = p.category || '';
  fields.barcode.value = p.barcode || '';
  fields.image.value = '';
  fields.actor.value = getDefaultActor();
  fields.reason.value = '';
  setImagePreview(p.image || null);
  editAuditFields.classList.remove('hidden');
  productHistory.innerHTML = '<div class="history-empty">กำลังโหลด...</div>';
  loadProductHistory(id);
  productModal.classList.remove('hidden');
}

document.getElementById('cancelProduct').addEventListener('click', () => {
  productModal.classList.add('hidden');
});

const submitProductBtn = document.getElementById('submitProduct');

productForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const isEdit = !!fields.id.value;

  if (isEdit && !fields.actor.value.trim()) {
    showToast('กรุณาระบุชื่อผู้แก้ไข');
    return;
  }

  const payload = {
    name: fields.name.value.trim(),
    name_en: fields.nameEn.value.trim(),
    price: parseFloat(fields.price.value),
    cost: parseFloat(fields.cost.value) || 0,
    stock: parseInt(fields.stock.value, 10),
    low_stock_threshold: parseInt(fields.threshold.value, 10) || 0,
    category: fields.category.value.trim(),
    barcode: fields.barcode.value.trim(),
  };
  if (isEdit) {
    payload.actor = fields.actor.value.trim();
    payload.reason = fields.reason.value.trim();
  } else {
    payload.owner_id = selectedOwnerId();
  }

  submitProductBtn.disabled = true;
  submitProductBtn.textContent = 'กำลังบันทึก...';
  try {
    let productId = fields.id.value;
    if (productId) {
      await api.updateProduct(productId, payload);
      setDefaultActor(payload.actor);
    } else {
      const created = await api.createProduct(payload);
      productId = created.id;
    }

    const file = fields.image.files[0];
    if (file) {
      await api.uploadProductImage(productId, file);
    }

    showToast(isEdit ? 'บันทึกการแก้ไขแล้ว' : 'เพิ่มสินค้าแล้ว');
    productModal.classList.add('hidden');
    await loadProducts();
  } catch (err) {
    showToast(err.message);
  } finally {
    submitProductBtn.disabled = false;
    submitProductBtn.textContent = 'บันทึก';
  }
});

// Delete modal
const deleteModal = document.getElementById('deleteModal');
const deleteProductName = document.getElementById('deleteProductName');
const deleteActorInput = document.getElementById('deleteActor');
const deleteReasonInput = document.getElementById('deleteReason');
let deleteTargetId = null;

function deleteProduct(id) {
  const p = products.find(x => x.id === id);
  if (!p) return;
  deleteTargetId = id;
  deleteProductName.textContent = `สินค้า: ${p.name}`;
  deleteActorInput.value = getDefaultActor();
  deleteReasonInput.value = '';
  deleteModal.classList.remove('hidden');
}

document.getElementById('cancelDelete').addEventListener('click', () => {
  deleteModal.classList.add('hidden');
});

const confirmDeleteBtn = document.getElementById('confirmDelete');

confirmDeleteBtn.addEventListener('click', async () => {
  const actor = deleteActorInput.value.trim();
  const reason = deleteReasonInput.value.trim();
  if (!actor) return showToast('กรุณาระบุชื่อผู้ดำเนินการ');
  if (!reason) return showToast('กรุณาระบุเหตุผล');

  confirmDeleteBtn.disabled = true;
  confirmDeleteBtn.textContent = 'กำลังลบ...';
  try {
    await api.deleteProduct(deleteTargetId, actor, reason);
    setDefaultActor(actor);
    deleteModal.classList.add('hidden');
    showToast('ลบสินค้าแล้ว');
    await loadProducts();
  } catch (err) {
    showToast(err.message);
  } finally {
    confirmDeleteBtn.disabled = false;
    confirmDeleteBtn.textContent = 'ยืนยันลบ';
  }
});

// Stock modal
const stockModal = document.getElementById('stockModal');
const stockProductName = document.getElementById('stockProductName');
const stockChangeInput = document.getElementById('stockChange');
const stockActorInput = document.getElementById('stockActor');
const stockReasonInput = document.getElementById('stockReason');
let stockTargetId = null;

function openStockModal(id) {
  const p = products.find(x => x.id === id);
  if (!p) return;
  stockTargetId = id;
  stockProductName.textContent = `${p.name} — คงเหลือปัจจุบัน ${p.stock}`;
  stockChangeInput.value = '';
  stockActorInput.value = getDefaultActor();
  stockReasonInput.value = '';
  stockModal.classList.remove('hidden');
}

document.getElementById('cancelStock').addEventListener('click', () => {
  stockModal.classList.add('hidden');
});

const confirmStockBtn = document.getElementById('confirmStock');

confirmStockBtn.addEventListener('click', async () => {
  const change = parseInt(stockChangeInput.value, 10);
  if (!Number.isInteger(change) || change === 0) {
    showToast('กรุณาระบุจำนวนที่ต้องการปรับ');
    return;
  }
  const actor = stockActorInput.value.trim();
  if (!actor) {
    showToast('กรุณาระบุชื่อผู้ดำเนินการ');
    return;
  }
  confirmStockBtn.disabled = true;
  confirmStockBtn.textContent = 'กำลังบันทึก...';
  try {
    await api.adjustStock(stockTargetId, change, actor, stockReasonInput.value.trim());
    setDefaultActor(actor);
    stockModal.classList.add('hidden');
    showToast('ปรับสต็อกแล้ว');
    await loadProducts();
  } catch (err) {
    showToast(err.message);
  } finally {
    confirmStockBtn.disabled = false;
    confirmStockBtn.textContent = 'บันทึก';
  }
});

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

if (window.currentUserId) {
  init();
} else {
  window.addEventListener('pos-auth-ready', init, { once: true });
}
