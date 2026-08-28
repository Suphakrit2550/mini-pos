// ไฟล์นี้ทำหน้าที่: หน้าขายหน้าร้าน (pos.html) — ส่วนหลักของระบบขาย
// - แสดงกริดสินค้า ค้นหา/สแกนบาร์โค้ดเพื่อเพิ่มลงตะกร้า ปรับจำนวนในตะกร้าได้
// - กรองสินค้าตามหมวดหมู่ผ่านแท็บด้านบนกริด (สร้างจากหมวดหมู่ที่มีอยู่จริงในร้านนั้นๆ)
// - เปิดหน้าต่างชำระเงิน คำนวณเงินทอน แล้วยืนยันการขายผ่าน API /api/sales
// - หลังขายสำเร็จ แสดงใบเสร็จในหน้าต่างและมีปุ่มพิมพ์ใบเสร็จ
// - แอดมินเลือกขายแทนพนักงานคนอื่นได้ผ่าน ownerSelect (สินค้า/สต็อก/ยอดขายจะอยู่ในบัญชีของคนนั้น)

let products = [];
let cart = []; // { product_id, name, price, quantity, stock }
let selectedCategory = null; // null = ทุกหมวดหมู่

const productGrid = document.getElementById('productGrid');
const searchInput = document.getElementById('search');
const categoryTabsEl = document.getElementById('categoryTabs');
const cartItemsEl = document.getElementById('cartItems');
const cartTotalEl = document.getElementById('cartTotal');
const checkoutBtn = document.getElementById('checkoutBtn');
const clearCartBtn = document.getElementById('clearCart');
const cartHandle = document.getElementById('cartHandle');
const cartHandleSummary = document.getElementById('cartHandleSummary');
const posCart = document.querySelector('.pos-cart');
const ownerSelect = document.getElementById('ownerSelect');
const ownerSelectWrap = document.getElementById('ownerSelectWrap');

// Mobile only (see .cart-handle in pos.css) — tap the handle bar to expand
// the cart up over most of the screen, or collapse it back down.
cartHandle.addEventListener('click', () => {
  posCart.classList.toggle('expanded');
});

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
  ownerSelect.addEventListener('change', () => {
    // The cart holds product ids from the previous owner's catalog — keeping
    // it around after switching would let a checkout mix items across two
    // different accounts' stock, so it's cleared instead.
    cart = [];
    renderCart();
    loadProducts();
  });
}

// Builds the category filter chips from whatever category values actually
// appear in the current catalog — a shop with no categorized products never
// gets an empty "ทั้งหมด"-only bar.
function setupCategoryTabs() {
  const categories = [...new Set(products.map(p => p.category).filter(Boolean))].sort();
  if (categories.length === 0) {
    categoryTabsEl.classList.add('hidden');
    categoryTabsEl.innerHTML = '';
    selectedCategory = null;
    return;
  }
  if (selectedCategory && !categories.includes(selectedCategory)) {
    selectedCategory = null;
  }
  categoryTabsEl.classList.remove('hidden');
  categoryTabsEl.innerHTML = '';

  // Built via DOM APIs (not an innerHTML template) so a category name typed
  // in by a shop owner — free text, could contain quotes/HTML — can never
  // break out of a markup attribute; textContent/dataset are never parsed
  // as HTML.
  const tabValues = [null, ...categories];
  const fragment = document.createDocumentFragment();
  tabValues.forEach((value) => {
    const tab = document.createElement('button');
    tab.type = 'button';
    tab.className = 'category-tab' + (value === selectedCategory ? ' active' : '');
    tab.textContent = value === null ? 'ทั้งหมด' : value;
    tab.addEventListener('click', () => {
      selectedCategory = value;
      categoryTabsEl.querySelectorAll('.category-tab').forEach((t) => t.classList.remove('active'));
      tab.classList.add('active');
      renderProducts();
    });
    fragment.appendChild(tab);
  });
  categoryTabsEl.appendChild(fragment);
}

async function loadProducts() {
  products = await api.getProducts(true, selectedOwnerId());
  setupCategoryTabs();
  renderProducts();
}

async function init() {
  await setupOwnerSelect();
  await loadProducts();
  // โฟกัสช่องค้นหาไว้ล่วงหน้า เผื่อพนักงานยิงบาร์โค้ดทันทีโดยยังไม่ได้แตะหน้าจอ
  searchInput.focus();
}

function renderProducts() {
  const term = searchInput.value.trim().toLowerCase();
  const filtered = products.filter(p => {
    if (selectedCategory && p.category !== selectedCategory) return false;
    if (!term) return true;
    return p.name.toLowerCase().includes(term) || (p.name_en || '').toLowerCase().includes(term);
  });

  if (filtered.length === 0) {
    productGrid.innerHTML = '<p class="empty-state">ไม่พบสินค้า</p>';
    return;
  }

  productGrid.innerHTML = filtered.map(p => `
    <div class="product-card ${p.stock !== null && p.stock <= 0 ? 'out-of-stock' : ''}" data-id="${p.id}">
      ${p.image
        ? `<img class="p-image" src="${escapeHtml(p.image)}" alt="">`
        : '<div class="p-image p-image-placeholder"></div>'}
      <div class="p-name">${escapeHtml(p.name)}</div>
      ${p.name_en ? `<div class="p-name-en">${escapeHtml(p.name_en)}</div>` : ''}
      <div class="p-price">฿${formatCurrency(p.price)}</div>
      <div class="p-stock">${p.stock === null ? 'ไม่ระบุจำนวน' : `คงเหลือ ${p.stock}`}</div>
    </div>
  `).join('');

  productGrid.querySelectorAll('.product-card').forEach(card => {
    card.addEventListener('click', () => addToCart(Number(card.dataset.id)));
  });
}

function addToCart(productId) {
  const product = products.find(p => p.id === productId);
  if (!product || (product.stock !== null && product.stock <= 0)) return;

  const existing = cart.find(c => c.product_id === productId);
  if (existing) {
    if (product.stock !== null && existing.quantity >= product.stock) {
      showToast('สินค้าคงเหลือไม่พอ');
      return;
    }
    existing.quantity += 1;
  } else {
    cart.push({ product_id: product.id, name: product.name, price: product.price, image: product.image, quantity: 1, stock: product.stock });
  }
  renderCart();
}

function changeQty(productId, delta) {
  const item = cart.find(c => c.product_id === productId);
  if (!item) return;
  const newQty = item.quantity + delta;
  if (newQty <= 0) {
    cart = cart.filter(c => c.product_id !== productId);
  } else if (item.stock !== null && newQty > item.stock) {
    showToast('สินค้าคงเหลือไม่พอ');
    return;
  } else {
    item.quantity = newQty;
  }
  renderCart();
}

function cartTotal() {
  return cart.reduce((sum, item) => sum + item.price * item.quantity, 0);
}

function renderCart() {
  if (cart.length === 0) {
    cartItemsEl.innerHTML = '<p class="empty-state">ยังไม่มีสินค้าในตะกร้า</p>';
    checkoutBtn.disabled = true;
  } else {
    cartItemsEl.innerHTML = cart.map(item => `
      <div class="cart-item" data-id="${item.product_id}">
        ${item.image
          ? `<img class="ci-image" src="${escapeHtml(item.image)}" alt="">`
          : '<div class="ci-image ci-image-placeholder"></div>'}
        <div class="flex-1">
          <div class="ci-name">${escapeHtml(item.name)}</div>
          <div class="ci-price">฿${formatCurrency(item.price)}</div>
        </div>
        <div class="qty-control">
          <button class="qty-btn minus">−</button>
          <span class="qty-value">${item.quantity}</span>
          <button class="qty-btn plus">+</button>
        </div>
        <div class="ci-subtotal">฿${formatCurrency(item.price * item.quantity)}</div>
      </div>
    `).join('');

    cartItemsEl.querySelectorAll('.cart-item').forEach(row => {
      const id = Number(row.dataset.id);
      row.querySelector('.minus').addEventListener('click', () => changeQty(id, -1));
      row.querySelector('.plus').addEventListener('click', () => changeQty(id, 1));
    });

    checkoutBtn.disabled = false;
  }
  cartTotalEl.textContent = `฿${formatCurrency(cartTotal())}`;

  const itemCount = cart.reduce((sum, item) => sum + item.quantity, 0);
  cartHandleSummary.textContent = itemCount === 0
    ? 'ยังไม่มีสินค้าในตะกร้า'
    : `${itemCount} รายการ · ฿${formatCurrency(cartTotal())}`;
}

clearCartBtn.addEventListener('click', () => {
  cart = [];
  renderCart();
});

searchInput.addEventListener('input', renderProducts);

// เครื่องยิงบาร์โค้ด Bluetooth ส่วนใหญ่ทำงานแบบ "คีย์บอร์ดปลอม" (HID) — ยิงแล้วจะพิมพ์
// เลขบาร์โค้ดใส่ช่องที่ focus อยู่แล้วกด Enter ให้เอง จึงดักจับได้จากช่องค้นหานี้เลย
// โดยไม่ต้องเชื่อมต่อ Bluetooth เพิ่มเติมใดๆ — ต่างจากเครื่องพิมพ์ใบเสร็จที่ทำแบบนี้ไม่ได้
searchInput.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  e.preventDefault();
  const code = searchInput.value.trim();
  if (!code) return;

  const product = products.find(p => p.barcode === code);
  if (!product) {
    showToast(`ไม่พบสินค้าบาร์โค้ด ${code}`);
    return;
  }
  addToCart(product.id);
  showToast(`เพิ่ม ${product.name} แล้ว`);
  searchInput.value = '';
  renderProducts();
});

document.getElementById('scanCartBtn').addEventListener('click', () => {
  Scanner.open({
    continuous: true,
    onScan: (code) => {
      const product = products.find(p => p.barcode === code);
      if (!product) {
        showToast(`ไม่พบสินค้าบาร์โค้ด ${code}`);
        return;
      }
      addToCart(product.id);
      showToast(`เพิ่ม ${product.name} แล้ว`);
    },
  });
});

// Checkout modal
const checkoutModal = document.getElementById('checkoutModal');
const modalTotal = document.getElementById('modalTotal');
const customerNameInput = document.getElementById('customerNameInput');
const receivedInput = document.getElementById('receivedInput');
const changeAmountEl = document.getElementById('changeAmount');
const confirmCheckoutBtn = document.getElementById('confirmCheckout');

checkoutBtn.addEventListener('click', () => {
  modalTotal.textContent = `฿${formatCurrency(cartTotal())}`;
  customerNameInput.value = '';
  receivedInput.value = '';
  changeAmountEl.textContent = '฿0.00';
  checkoutModal.classList.remove('hidden');
});

document.getElementById('cancelCheckout').addEventListener('click', () => {
  checkoutModal.classList.add('hidden');
});

document.querySelectorAll('.quick-cash-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const amount = btn.dataset.amount;
    receivedInput.value = amount === 'exact' ? cartTotal().toFixed(2) : amount;
    updateChange();
  });
});

// On-screen numpad for "รับเงินมา" — receivedInput is readonly (see
// index.html) so the iPad/iPhone's own keyboard never pops up; every digit
// comes from tapping these buttons instead, same math either way.
document.querySelectorAll('.numpad-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const key = btn.dataset.key;
    if (key === 'back') {
      receivedInput.value = receivedInput.value.slice(0, -1);
    } else if (key === '.') {
      if (!receivedInput.value.includes('.')) receivedInput.value += '.';
    } else {
      const decimals = receivedInput.value.split('.')[1];
      if (decimals && decimals.length >= 2) return; // สตางค์มีแค่ 2 หลัก
      receivedInput.value += key;
    }
    updateChange();
  });
});

function updateChange() {
  const received = parseFloat(receivedInput.value) || 0;
  const change = received - cartTotal();
  changeAmountEl.textContent = `฿${formatCurrency(change)}`;
}

confirmCheckoutBtn.addEventListener('click', async () => {
  const received = parseFloat(receivedInput.value) || 0;
  if (received < cartTotal()) {
    showToast('รับเงินไม่พอ');
    return;
  }
  confirmCheckoutBtn.disabled = true;
  confirmCheckoutBtn.textContent = 'กำลังชำระเงิน...';
  try {
    const payload = {
      items: cart.map(c => ({ product_id: c.product_id, quantity: c.quantity })),
      payment_method: 'cash',
      received_amount: received,
      customer_name: customerNameInput.value.trim() || null,
      owner_id: selectedOwnerId(),
    };
    const sale = await api.createSale(payload);
    checkoutModal.classList.add('hidden');
    showReceipt(sale);
    cart = [];
    renderCart();
    await loadProducts();
  } catch (err) {
    showToast(err.message);
  } finally {
    confirmCheckoutBtn.disabled = false;
    confirmCheckoutBtn.textContent = 'ยืนยันชำระเงิน';
  }
});

const receiptModal = document.getElementById('receiptModal');
const receiptBody = document.getElementById('receiptBody');
let lastSaleId = null;

function showReceipt(sale) {
  lastSaleId = sale.id;
  receiptBody.innerHTML = `
    ${sale.customer_name ? `
      <div class="receipt-line">
        <span>ลูกค้า</span>
        <span>${escapeHtml(sale.customer_name)}</span>
      </div>
    ` : ''}
    ${sale.items.map(item => `
      <div class="receipt-line">
        <span>${escapeHtml(item.name)} × ${item.quantity}</span>
        <span>฿${formatCurrency(item.subtotal)}</span>
      </div>
    `).join('')}
    <div class="receipt-line" style="font-weight:700; margin-top:8px;">
      <span>ยอดรวม</span>
      <span>฿${formatCurrency(sale.total)}</span>
    </div>
    <div class="receipt-line">
      <span>รับเงิน</span>
      <span>฿${formatCurrency(sale.received_amount)}</span>
    </div>
    <div class="receipt-line">
      <span>เงินทอน</span>
      <span>฿${formatCurrency(sale.change_amount)}</span>
    </div>
  `;
  receiptModal.classList.remove('hidden');
}

document.getElementById('closeReceipt').addEventListener('click', () => {
  receiptModal.classList.add('hidden');
});

document.getElementById('printReceipt').addEventListener('click', () => {
  window.open(`receipt.html?id=${lastSaleId}&from=pos`, '_blank');
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
