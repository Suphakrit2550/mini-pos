// API รายงานยอดขาย/สต็อกใกล้หมด

const express = require('express');
const db = require('../db');
const { toBaht } = require('../lib/money');

const router = express.Router();

// Staff only ever see their own sales in reports. Admins see every
// account's sales combined by default (a whole-shop view), or one
// account's via ?user_id=.
function resolveScopeUserId(req) {
  if (req.user.role === 'admin') {
    return req.query.user_id ? Number(req.query.user_id) : null;
  }
  return req.user.id;
}

router.get('/summary', (req, res) => {
  const { from, to } = req.query;
  const scopeUserId = resolveScopeUserId(req);
  const scopeClause = scopeUserId !== null ? 'AND user_id = @user_id' : '';
  const scopeClauseS = scopeUserId !== null ? 'AND s.user_id = @user_id' : '';
  const dateFilter = (from && to
    ? "WHERE status = 'completed' AND date(created_at) BETWEEN date(@from) AND date(@to)"
    : "WHERE status = 'completed' AND date(created_at) = date('now', 'localtime')") + ` ${scopeClause}`;
  const profitFilter = (from && to
    ? "WHERE s.status = 'completed' AND date(s.created_at) BETWEEN date(@from) AND date(@to)"
    : "WHERE s.status = 'completed' AND date(s.created_at) = date('now', 'localtime')") + ` ${scopeClauseS}`;
  const params = { ...(from && to ? { from, to } : {}), user_id: scopeUserId };

  const totals = db.prepare(`
    SELECT COUNT(*) AS order_count, COALESCE(SUM(total_satang), 0) AS revenue_satang
    FROM sales ${dateFilter}
  `).get(params);

  const profitTotals = db.prepare(`
    SELECT COALESCE(SUM(si.subtotal_satang - si.cost_satang * si.quantity), 0) AS profit_satang
    FROM sale_items si
    JOIN sales s ON s.id = si.sale_id
    ${profitFilter}
  `).get(params);

  const byDayRevenue = db.prepare(`
    SELECT date(created_at) AS day, COUNT(*) AS order_count, SUM(total_satang) AS revenue_satang
    FROM sales ${dateFilter}
    GROUP BY day
    ORDER BY day
  `).all(params);

  const byDayProfit = db.prepare(`
    SELECT date(s.created_at) AS day, COALESCE(SUM(si.subtotal_satang - si.cost_satang * si.quantity), 0) AS profit_satang
    FROM sale_items si
    JOIN sales s ON s.id = si.sale_id
    ${profitFilter}
    GROUP BY day
  `).all(params);
  const profitByDay = Object.fromEntries(byDayProfit.map(r => [r.day, r.profit_satang]));
  const byDay = byDayRevenue.map(r => ({
    day: r.day,
    order_count: r.order_count,
    revenue: toBaht(r.revenue_satang),
    profit: toBaht(profitByDay[r.day] || 0),
  }));

  const topProducts = db.prepare(`
    SELECT si.name, SUM(si.quantity) AS quantity, SUM(si.subtotal_satang) AS revenue_satang
    FROM sale_items si
    JOIN sales s ON s.id = si.sale_id
    ${profitFilter}
    GROUP BY si.name
    ORDER BY quantity DESC
    LIMIT 10
  `).all(params).map(p => ({ name: p.name, quantity: p.quantity, revenue: toBaht(p.revenue_satang) }));

  res.json({
    order_count: totals.order_count,
    revenue: toBaht(totals.revenue_satang),
    profit: toBaht(profitTotals.profit_satang),
    byDay,
    topProducts,
  });
});

router.get('/low-stock', (req, res) => {
  const scopeUserId = resolveScopeUserId(req);
  const clause = scopeUserId !== null ? 'AND owner_id = @owner_id' : '';
  const rows = db.prepare(`
    SELECT * FROM products
    WHERE active = 1 AND stock <= low_stock_threshold ${clause}
    ORDER BY stock ASC
  `).all({ owner_id: scopeUserId });
  res.json(rows.map(({ price_satang, cost_satang, ...rest }) => ({
    ...rest,
    price: toBaht(price_satang),
    cost: toBaht(cost_satang),
  })));
});

module.exports = router;
