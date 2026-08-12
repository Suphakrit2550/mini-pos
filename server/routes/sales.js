const express = require('express');
const db = require('../db');
const { toSatang, toBaht } = require('../lib/money');
const { logAudit, getAuditLog } = require('../lib/audit');

const router = express.Router();

function serializeSale(row) {
  if (!row) return row;
  const { total_satang, received_amount_satang, change_amount_satang, ...rest } = row;
  return {
    ...rest,
    total: toBaht(total_satang),
    received_amount: toBaht(received_amount_satang),
    change_amount: toBaht(change_amount_satang),
  };
}

function serializeItem(row) {
  const { price_satang, cost_satang, subtotal_satang, ...rest } = row;
  return {
    ...rest,
    price: toBaht(price_satang),
    cost: toBaht(cost_satang),
    subtotal: toBaht(subtotal_satang),
  };
}

// Staff only ever see their own sales. Admins see every account's sales by
// default (a shop-wide view), or one account's via ?user_id=.
function salesScopeFilter(req) {
  if (req.user.role === 'admin') {
    return req.query.user_id ? { clause: 'user_id = ?', params: [Number(req.query.user_id)] } : null;
  }
  return { clause: 'user_id = ?', params: [req.user.id] };
}

function ownsSale(req, sale) {
  return req.user.role === 'admin' || sale.user_id === req.user.id;
}

router.get('/', (req, res) => {
  const { from, to } = req.query;
  const itemCount = `(SELECT COUNT(*) FROM sale_items WHERE sale_items.sale_id = sales.id) AS item_count`;
  const scope = salesScopeFilter(req);

  const conditions = [];
  const params = [];
  if (from && to) {
    conditions.push('date(created_at) BETWEEN date(?) AND date(?)');
    params.push(from, to);
  }
  if (scope) {
    conditions.push(scope.clause);
    params.push(...scope.params);
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const limit = from && to ? '' : 'LIMIT 200';

  const rows = db.prepare(`
    SELECT sales.*, ${itemCount} FROM sales
    ${where}
    ORDER BY created_at DESC ${limit}
  `).all(...params);
  res.json(rows.map(serializeSale));
});

router.get('/:id', (req, res) => {
  const sale = db.prepare('SELECT * FROM sales WHERE id = ?').get(req.params.id);
  if (!sale) return res.status(404).json({ error: 'Sale not found' });
  if (!ownsSale(req, sale)) return res.status(403).json({ error: 'ไม่มีสิทธิ์เข้าถึงรายการนี้' });
  const items = db.prepare('SELECT * FROM sale_items WHERE sale_id = ?').all(req.params.id);
  const audit = getAuditLog('sale', Number(req.params.id));
  res.json({ ...serializeSale(sale), items: items.map(serializeItem), audit });
});

router.post('/', (req, res) => {
  const { items, received_amount, customer_name } = req.body;
  const payment_method = req.body.payment_method || 'cash';
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'items are required' });
  }

  const tx = db.transaction(() => {
    let totalSatang = 0;
    const resolvedItems = [];

    for (const item of items) {
      // Scoped to the seller's own catalog — a sale can only ring up items
      // that account actually stocks, even if another account's product id
      // is guessed.
      const product = db.prepare('SELECT * FROM products WHERE id = ? AND owner_id = ?').get(item.product_id, req.user.id);
      if (!product) throw new Error(`Product ${item.product_id} not found`);
      if (product.stock < item.quantity) {
        throw new Error(`Insufficient stock for ${product.name}`);
      }
      const subtotalSatang = product.price_satang * item.quantity;
      totalSatang += subtotalSatang;
      resolvedItems.push({
        product_id: product.id,
        name: product.name,
        price_satang: product.price_satang,
        cost_satang: product.cost_satang || 0,
        quantity: item.quantity,
        subtotal_satang: subtotalSatang,
      });
    }

    const receivedSatang = payment_method === 'cash' && received_amount != null
      ? toSatang(received_amount)
      : null;
    const changeSatang = receivedSatang != null ? receivedSatang - totalSatang : null;

    const saleInfo = db.prepare(`
      INSERT INTO sales (user_id, customer_name, total_satang, payment_method, received_amount_satang, change_amount_satang)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(req.user.id, customer_name || null, totalSatang, payment_method || 'cash', receivedSatang, changeSatang);

    const saleId = saleInfo.lastInsertRowid;

    const insertItem = db.prepare(`
      INSERT INTO sale_items (sale_id, product_id, name, price_satang, cost_satang, quantity, subtotal_satang)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    const updateStock = db.prepare("UPDATE products SET stock = stock - ?, updated_at = datetime('now', 'localtime') WHERE id = ?");
    const logMovement = db.prepare("INSERT INTO stock_movements (product_id, change, reason) VALUES (?, ?, 'sale')");

    for (const item of resolvedItems) {
      insertItem.run(saleId, item.product_id, item.name, item.price_satang, item.cost_satang, item.quantity, item.subtotal_satang);
      updateStock.run(item.quantity, item.product_id);
      logMovement.run(item.product_id, -item.quantity);
    }

    return saleId;
  });

  try {
    const saleId = tx();
    const sale = db.prepare('SELECT * FROM sales WHERE id = ?').get(saleId);
    const savedItems = db.prepare('SELECT * FROM sale_items WHERE sale_id = ?').all(saleId);
    res.status(201).json({ ...serializeSale(sale), items: savedItems.map(serializeItem) });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/:id/void', (req, res) => {
  const { action, actor, reason } = req.body;
  if (!['cancel', 'refund'].includes(action)) {
    return res.status(400).json({ error: 'action must be "cancel" or "refund"' });
  }
  const actorName = (actor || '').trim();
  const reasonText = (reason || '').trim();
  if (!actorName) return res.status(400).json({ error: 'actor is required' });
  if (!reasonText) return res.status(400).json({ error: 'reason is required' });

  const sale = db.prepare('SELECT * FROM sales WHERE id = ?').get(req.params.id);
  if (!sale) return res.status(404).json({ error: 'Sale not found' });
  if (!ownsSale(req, sale)) return res.status(403).json({ error: 'ไม่มีสิทธิ์เข้าถึงรายการนี้' });
  if (sale.status !== 'completed') {
    return res.status(400).json({ error: 'This order has already been cancelled or refunded' });
  }

  const newStatus = action === 'cancel' ? 'cancelled' : 'refunded';

  const tx = db.transaction(() => {
    const items = db.prepare('SELECT * FROM sale_items WHERE sale_id = ?').all(sale.id);
    const restoreStock = db.prepare("UPDATE products SET stock = stock + ?, updated_at = datetime('now', 'localtime') WHERE id = ?");
    const logMovement = db.prepare('INSERT INTO stock_movements (product_id, change, reason) VALUES (?, ?, ?)');

    for (const item of items) {
      if (item.product_id) {
        restoreStock.run(item.quantity, item.product_id);
        logMovement.run(item.product_id, item.quantity, `${action}:${reasonText}`);
      }
    }

    db.prepare(`
      UPDATE sales SET status = ?, voided_at = datetime('now', 'localtime'), voided_reason = ?, voided_by = ?
      WHERE id = ?
    `).run(newStatus, reasonText, actorName, sale.id);

    logAudit({
      entityType: 'sale',
      entityId: sale.id,
      action,
      actor: actorName,
      reason: reasonText,
      detail: { total: toBaht(sale.total_satang), items: items.map(i => ({ name: i.name, quantity: i.quantity })) },
    });
  });
  tx();

  const updated = db.prepare('SELECT * FROM sales WHERE id = ?').get(sale.id);
  const items = db.prepare('SELECT * FROM sale_items WHERE sale_id = ?').all(sale.id);
  const audit = getAuditLog('sale', sale.id);
  res.json({ ...serializeSale(updated), items: items.map(serializeItem), audit });
});

module.exports = router;
