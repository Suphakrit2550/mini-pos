// API ขายของ/ยกเลิก/คืนเงิน

const express = require('express');
const db = require('../db');
const asyncHandler = require('../lib/asyncHandler');
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
    return req.query.user_id ? { clause: 'user_id = ', value: Number(req.query.user_id) } : null;
  }
  return { clause: 'user_id = ', value: req.user.id };
}

function ownsSale(req, sale) {
  return req.user.role === 'admin' || sale.user_id === req.user.id;
}

// Staff always sell out of their own catalog. Admins sell out of their own
// by default too, but may pass owner_id in the body to ring up a sale
// against a specific staff member's catalog/stock instead — the sale is
// recorded under that staff member's account, same as if they'd rung it up
// themselves (same pattern as products.js/settings.js).
function resolveOwnerId(req) {
  const requested = req.body.owner_id;
  if (req.user.role === 'admin' && requested) return Number(requested);
  return req.user.id;
}

router.get('/', asyncHandler(async (req, res) => {
  const { from, to } = req.query;
  const itemCount = `(SELECT COUNT(*) FROM sale_items WHERE sale_items.sale_id = sales.id) AS item_count`;
  const scope = salesScopeFilter(req);

  const conditions = [];
  const params = [];
  if (from && to) {
    params.push(from, to);
    conditions.push(`created_at::date BETWEEN $${params.length - 1}::date AND $${params.length}::date`);
  }
  if (scope) {
    params.push(scope.value);
    conditions.push(`${scope.clause}$${params.length}`);
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const limit = from && to ? '' : 'LIMIT 200';

  const { rows } = await db.query(
    `SELECT sales.*, ${itemCount} FROM sales ${where} ORDER BY created_at DESC ${limit}`,
    params
  );
  res.json(rows.map(serializeSale));
}));

router.get('/:id', asyncHandler(async (req, res) => {
  const { rows: [sale] } = await db.query('SELECT * FROM sales WHERE id = $1', [req.params.id]);
  if (!sale) return res.status(404).json({ error: 'Sale not found' });
  if (!ownsSale(req, sale)) return res.status(403).json({ error: 'ไม่มีสิทธิ์เข้าถึงรายการนี้' });
  const { rows: items } = await db.query('SELECT * FROM sale_items WHERE sale_id = $1', [req.params.id]);
  const audit = await getAuditLog('sale', Number(req.params.id));
  // Receipts always show the selling account's own shop info — not the
  // viewer's — since each account is its own separate shop. Relevant when
  // an admin looks up a receipt for a sale a staff account made.
  const { rows: [shop] } = await db.query(
    'SELECT shop_name, address, phone, receipt_footer FROM settings WHERE user_id = $1',
    [sale.user_id]
  );
  res.json({ ...serializeSale(sale), items: items.map(serializeItem), audit, shop });
}));

router.post('/', asyncHandler(async (req, res) => {
  const { items, received_amount, customer_name } = req.body;
  const payment_method = req.body.payment_method || 'cash';
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'items are required' });
  }

  const ownerId = resolveOwnerId(req);

  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');

    let totalSatang = 0;
    const resolvedItems = [];

    for (const item of items) {
      // Scoped to the selling account's own catalog — a sale can only ring
      // up items that account actually stocks, even if another account's
      // product id is guessed.
      const { rows: [product] } = await client.query(
        'SELECT * FROM products WHERE id = $1 AND owner_id = $2',
        [item.product_id, ownerId]
      );
      if (!product) throw new Error(`Product ${item.product_id} not found`);
      // NULL stock means the item isn't tracked ("ไม่ระบุจำนวน") — treat it
      // as always available instead of coercing NULL to 0 and blocking every sale.
      if (product.stock !== null && product.stock < item.quantity) {
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

    const { rows: [saleRow] } = await client.query(
      `INSERT INTO sales (user_id, customer_name, total_satang, payment_method, received_amount_satang, change_amount_satang)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [ownerId, customer_name || null, totalSatang, payment_method || 'cash', receivedSatang, changeSatang]
    );
    const saleId = saleRow.id;

    for (const item of resolvedItems) {
      await client.query(
        `INSERT INTO sale_items (sale_id, product_id, name, price_satang, cost_satang, quantity, subtotal_satang)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [saleId, item.product_id, item.name, item.price_satang, item.cost_satang, item.quantity, item.subtotal_satang]
      );
      await client.query(
        "UPDATE products SET stock = stock - $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2",
        [item.quantity, item.product_id]
      );
      await client.query(
        "INSERT INTO stock_movements (product_id, change, reason) VALUES ($1, $2, 'sale')",
        [item.product_id, -item.quantity]
      );
    }

    await client.query('COMMIT');

    const { rows: [sale] } = await client.query('SELECT * FROM sales WHERE id = $1', [saleId]);
    const { rows: savedItems } = await client.query('SELECT * FROM sale_items WHERE sale_id = $1', [saleId]);
    res.status(201).json({ ...serializeSale(sale), items: savedItems.map(serializeItem) });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(400).json({ error: err.message });
  } finally {
    client.release();
  }
}));

router.post('/:id/void', asyncHandler(async (req, res) => {
  const { action, actor, reason } = req.body;
  if (!['cancel', 'refund'].includes(action)) {
    return res.status(400).json({ error: 'action must be "cancel" or "refund"' });
  }
  const actorName = (actor || '').trim();
  const reasonText = (reason || '').trim();
  if (!actorName) return res.status(400).json({ error: 'actor is required' });
  if (!reasonText) return res.status(400).json({ error: 'reason is required' });

  const { rows: [sale] } = await db.query('SELECT * FROM sales WHERE id = $1', [req.params.id]);
  if (!sale) return res.status(404).json({ error: 'Sale not found' });
  if (!ownsSale(req, sale)) return res.status(403).json({ error: 'ไม่มีสิทธิ์เข้าถึงรายการนี้' });
  if (sale.status !== 'completed') {
    return res.status(400).json({ error: 'This order has already been cancelled or refunded' });
  }

  const newStatus = action === 'cancel' ? 'cancelled' : 'refunded';

  const client = await db.pool.connect();
  let voidedItems;
  try {
    await client.query('BEGIN');
    const { rows: items } = await client.query('SELECT * FROM sale_items WHERE sale_id = $1', [sale.id]);
    voidedItems = items;

    for (const item of items) {
      if (item.product_id) {
        await client.query(
          'UPDATE products SET stock = stock + $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
          [item.quantity, item.product_id]
        );
        await client.query(
          'INSERT INTO stock_movements (product_id, change, reason) VALUES ($1, $2, $3)',
          [item.product_id, item.quantity, `${action}:${reasonText}`]
        );
      }
    }

    await client.query(
      `UPDATE sales SET status = $1, voided_at = CURRENT_TIMESTAMP, voided_reason = $2, voided_by = $3
       WHERE id = $4`,
      [newStatus, reasonText, actorName, sale.id]
    );
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  await logAudit({
    entityType: 'sale',
    entityId: sale.id,
    action,
    actor: actorName,
    reason: reasonText,
    detail: { total: toBaht(sale.total_satang), items: voidedItems.map((i) => ({ name: i.name, quantity: i.quantity })) },
  });

  const { rows: [updated] } = await db.query('SELECT * FROM sales WHERE id = $1', [sale.id]);
  const { rows: items } = await db.query('SELECT * FROM sale_items WHERE sale_id = $1', [sale.id]);
  const audit = await getAuditLog('sale', sale.id);
  res.json({ ...serializeSale(updated), items: items.map(serializeItem), audit });
}));

module.exports = router;
