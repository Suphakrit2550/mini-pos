// API รายงานยอดขาย/สต็อกใกล้หมด

const express = require('express');
const db = require('../db');
const asyncHandler = require('../lib/asyncHandler');
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

router.get('/summary', asyncHandler(async (req, res) => {
  const { from, to } = req.query;
  const scopeUserId = resolveScopeUserId(req);

  // Build the two WHERE clauses (bare `sales` alias vs `s` alias for the
  // sale_items join) with matching positional params.
  const params = [];
  const paramsS = [];
  let dateCond;
  let dateCondS;
  if (from && to) {
    params.push(from, to);
    paramsS.push(from, to);
    dateCond = `created_at::date BETWEEN $1::date AND $2::date`;
    dateCondS = `s.created_at::date BETWEEN $1::date AND $2::date`;
  } else {
    dateCond = `created_at::date = CURRENT_DATE`;
    dateCondS = `s.created_at::date = CURRENT_DATE`;
  }
  let scopeCond = '';
  let scopeCondS = '';
  if (scopeUserId !== null) {
    params.push(scopeUserId);
    scopeCond = ` AND user_id = $${params.length}`;
    paramsS.push(scopeUserId);
    scopeCondS = ` AND s.user_id = $${paramsS.length}`;
  }
  const dateFilter = `WHERE status = 'completed' AND ${dateCond}${scopeCond}`;
  const profitFilter = `WHERE s.status = 'completed' AND ${dateCondS}${scopeCondS}`;

  const { rows: [totals] } = await db.query(
    `SELECT COUNT(*) AS order_count, COALESCE(SUM(total_satang), 0) AS revenue_satang FROM sales ${dateFilter}`,
    params
  );

  const { rows: [profitTotals] } = await db.query(
    `SELECT COALESCE(SUM(si.subtotal_satang - si.cost_satang * si.quantity), 0) AS profit_satang
     FROM sale_items si JOIN sales s ON s.id = si.sale_id ${profitFilter}`,
    paramsS
  );

  const { rows: byDayRevenue } = await db.query(
    `SELECT created_at::date AS day, COUNT(*) AS order_count, SUM(total_satang) AS revenue_satang
     FROM sales ${dateFilter} GROUP BY day ORDER BY day`,
    params
  );

  const { rows: byDayProfit } = await db.query(
    `SELECT s.created_at::date AS day, COALESCE(SUM(si.subtotal_satang - si.cost_satang * si.quantity), 0) AS profit_satang
     FROM sale_items si JOIN sales s ON s.id = si.sale_id ${profitFilter} GROUP BY day`,
    paramsS
  );
  const profitByDay = Object.fromEntries(byDayProfit.map((r) => [String(r.day), r.profit_satang]));
  const byDay = byDayRevenue.map((r) => ({
    day: r.day,
    order_count: Number(r.order_count),
    revenue: toBaht(r.revenue_satang),
    profit: toBaht(profitByDay[String(r.day)] || 0),
  }));

  const { rows: topProductsRaw } = await db.query(
    `SELECT si.name, SUM(si.quantity) AS quantity, SUM(si.subtotal_satang) AS revenue_satang
     FROM sale_items si JOIN sales s ON s.id = si.sale_id ${profitFilter}
     GROUP BY si.name ORDER BY quantity DESC LIMIT 10`,
    paramsS
  );
  const topProducts = topProductsRaw.map((p) => ({ name: p.name, quantity: Number(p.quantity), revenue: toBaht(p.revenue_satang) }));

  res.json({
    order_count: Number(totals.order_count),
    revenue: toBaht(totals.revenue_satang),
    profit: toBaht(profitTotals.profit_satang),
    byDay,
    topProducts,
  });
}));

router.get('/low-stock', asyncHandler(async (req, res) => {
  const scopeUserId = resolveScopeUserId(req);
  const params = [];
  let clause = '';
  if (scopeUserId !== null) {
    params.push(scopeUserId);
    clause = ` AND owner_id = $${params.length}`;
  }
  const { rows } = await db.query(
    `SELECT * FROM products WHERE active = TRUE AND stock <= low_stock_threshold${clause} ORDER BY stock ASC`,
    params
  );
  res.json(rows.map(({ price_satang, cost_satang, ...rest }) => ({
    ...rest,
    price: toBaht(price_satang),
    cost: toBaht(cost_satang),
  })));
}));

module.exports = router;
