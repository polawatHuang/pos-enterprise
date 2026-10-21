'use strict';

const db = require('../../db/pool');
const env = require('../../config/env');
const { getTaxSettings } = require('../org/tax');

// All timestamps are UTC; shift into the business timezone for day/month buckets.
// CONVERT_TZ with numeric offsets works without MySQL timezone tables (shared hosting).
const TZ = env.APP_TZ_OFFSET;
const local = (col) => `CONVERT_TZ(${col}, '+00:00', '${TZ}')`;
const LOCAL_NOW = `CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', '${TZ}')`;
const VALID_ORDER = `so.status NOT IN ('cancelled','refunded')`;
const branchFilter = (alias) => `(:branchId IS NULL OR ${alias}.branch_id = :branchId)`;

/** Revenue for a local-date window [from, to) expressed as SQL expressions. */
function salesWindowSql(fromExpr, toExpr) {
  return `
    SELECT COALESCE(SUM(so.total), 0) AS revenue,
           COUNT(*) AS orders,
           COALESCE(SUM(so.total - so.shipping_fee - so.vat_amount - so.cost_total - so.platform_fee), 0) AS gross_profit
      FROM sales_orders so
     WHERE so.org_id = :orgId AND ${branchFilter('so')} AND ${VALID_ORDER}
       AND ${local('so.ordered_at')} >= ${fromExpr} AND ${local('so.ordered_at')} < ${toExpr}`;
}

async function summary({ orgId, branchId }) {
  const p = { orgId, branchId };
  const today = `DATE(${LOCAL_NOW})`;
  const monthStart = `DATE_FORMAT(${LOCAL_NOW}, '%Y-%m-01')`;
  const prevMonthStart = `(${monthStart} - INTERVAL 1 MONTH)`;
  // Same elapsed span of the previous month, for a fair month-to-date comparison
  const prevMonthSamePoint = `(${LOCAL_NOW} - INTERVAL 1 MONTH)`;

  const [todayRow, yesterdayRow, mtdRow, prevMtdRow, money, inbox, stock, social, video] = await Promise.all([
    db.one(salesWindowSql(today, `${today} + INTERVAL 1 DAY`), p),
    // Yesterday up to the same time of day
    db.one(salesWindowSql(`${today} - INTERVAL 1 DAY`, `${LOCAL_NOW} - INTERVAL 1 DAY`), p),
    db.one(salesWindowSql(monthStart, `${today} + INTERVAL 1 DAY`), p),
    db.one(salesWindowSql(prevMonthStart, prevMonthSamePoint), p),
    db.one(
      `SELECT COALESCE(SUM(CASE WHEN t.type='income' THEN t.amount END), 0) AS other_income,
              COALESCE(SUM(CASE WHEN t.type='expense' THEN t.amount END), 0) AS expenses
         FROM transactions t
        WHERE t.org_id = :orgId AND ${branchFilter('t')} AND t.txn_date >= ${monthStart}`,
      p,
    ),
    db.one(
      `SELECT SUM(c.status IN ('open','pending')) AS open_conversations,
              SUM(c.status IN ('open','pending') AND c.mode = 'human') AS needs_human,
              COALESCE(SUM(c.unread_count), 0) AS unread
         FROM conversations c WHERE c.org_id = :orgId`,
      p,
    ),
    db.one(
      `SELECT COUNT(*) AS low_stock FROM (
         SELECT p.id FROM products p
           LEFT JOIN stock_levels sl ON sl.product_id = p.id
          WHERE p.org_id = :orgId AND p.status = 'active'
          GROUP BY p.id, p.reorder_point
         HAVING COALESCE(SUM(sl.quantity), 0) <= p.reorder_point) x`,
      p,
    ),
    db.one(
      `SELECT SUM(status = 'scheduled' AND scheduled_at >= UTC_TIMESTAMP()) AS scheduled,
              SUM(status = 'published' AND scheduled_at >= UTC_TIMESTAMP() - INTERVAL 7 DAY) AS published_7d,
              SUM(status = 'failed') AS failed
         FROM scheduled_posts WHERE org_id = :orgId`,
      p,
    ),
    db.one(
      `SELECT SUM(status IN ('scripting','voicing','generating_clips','rendering_avatar','compositing')) AS in_progress,
              SUM(status IN ('ready','parts_ready')) AS ready
         FROM video_projects WHERE org_id = :orgId`,
      p,
    ),
  ]);

  const n = (v) => Number(v || 0);
  return {
    today: { revenue: n(todayRow.revenue), orders: n(todayRow.orders), grossProfit: n(todayRow.gross_profit) },
    yesterdaySamePeriod: { revenue: n(yesterdayRow.revenue), orders: n(yesterdayRow.orders) },
    monthToDate: {
      revenue: n(mtdRow.revenue),
      orders: n(mtdRow.orders),
      grossProfit: n(mtdRow.gross_profit),
      otherIncome: n(money.other_income),
      expenses: n(money.expenses),
      netProfit: n(mtdRow.gross_profit) + n(money.other_income) - n(money.expenses),
      avgOrderValue: n(mtdRow.orders) ? n(mtdRow.revenue) / n(mtdRow.orders) : 0,
    },
    previousMonthToDate: { revenue: n(prevMtdRow.revenue), orders: n(prevMtdRow.orders), grossProfit: n(prevMtdRow.gross_profit) },
    inbox: { open: n(inbox.open_conversations), needsHuman: n(inbox.needs_human), unread: n(inbox.unread) },
    inventory: { lowStock: n(stock.low_stock) },
    social: { scheduled: n(social.scheduled), published7d: n(social.published_7d), failed: n(social.failed) },
    video: { inProgress: n(video.in_progress), ready: n(video.ready) },
  };
}

async function salesTrend({ orgId, branchId, days }) {
  const rows = await db.query(
    `SELECT DATE_FORMAT(${local('so.ordered_at')}, '%Y-%m-%d') AS day,
            SUM(so.total) AS revenue, COUNT(*) AS orders,
            SUM(so.total - so.shipping_fee - so.vat_amount - so.cost_total - so.platform_fee) AS gross_profit
       FROM sales_orders so
      WHERE so.org_id = :orgId AND ${branchFilter('so')} AND ${VALID_ORDER}
        AND ${local('so.ordered_at')} >= DATE(${LOCAL_NOW}) - INTERVAL :span DAY
      GROUP BY day ORDER BY day`,
    { orgId, branchId, span: days - 1 },
  );
  const today = await db.one(`SELECT DATE_FORMAT(${LOCAL_NOW}, '%Y-%m-%d') AS d`);
  return fillDays(rows, today.d, days);
}

function fillDays(rows, todayStr, days) {
  const byDay = new Map(rows.map((r) => [r.day, r]));
  const out = [];
  const end = new Date(`${todayStr}T00:00:00Z`);
  for (let i = days - 1; i >= 0; i -= 1) {
    const d = new Date(end.getTime() - i * 86400000).toISOString().slice(0, 10);
    const r = byDay.get(d);
    out.push({
      date: d,
      revenue: Number(r?.revenue || 0),
      orders: Number(r?.orders || 0),
      grossProfit: Number(r?.gross_profit || 0),
    });
  }
  return out;
}

async function channelMix({ orgId, branchId, days }) {
  const rows = await db.query(
    `SELECT so.channel, SUM(so.total) AS revenue, COUNT(*) AS orders
       FROM sales_orders so
      WHERE so.org_id = :orgId AND ${branchFilter('so')} AND ${VALID_ORDER}
        AND ${local('so.ordered_at')} >= DATE(${LOCAL_NOW}) - INTERVAL :span DAY
      GROUP BY so.channel ORDER BY revenue DESC`,
    { orgId, branchId, span: days - 1 },
  );
  return rows.map((r) => ({ channel: r.channel, revenue: Number(r.revenue), orders: Number(r.orders) }));
}

async function topProducts({ orgId, branchId, days, limit }) {
  // Profit before VAT: take VAT out of standard-rate products only, at the shop's rate
  const tax = await getTaxSettings(orgId);
  const vatRate = tax.vatRegistered ? tax.vatRate : 0;
  const rows = await db.query(
    `SELECT p.id, p.sku, p.name, p.image_url,
            SUM(i.quantity) AS qty, SUM(i.line_total) AS revenue,
            SUM(CASE WHEN p.vat_type = 'vat7' THEN i.line_total * 100 / (100 + :vatRate) ELSE i.line_total END - i.unit_cost * i.quantity) AS profit
       FROM sales_order_items i
       JOIN sales_orders so ON so.id = i.order_id
       JOIN products p ON p.id = i.product_id
      WHERE so.org_id = :orgId AND ${branchFilter('so')} AND ${VALID_ORDER}
        AND ${local('so.ordered_at')} >= DATE(${LOCAL_NOW}) - INTERVAL :span DAY
      GROUP BY p.id, p.sku, p.name, p.image_url
      ORDER BY revenue DESC
      LIMIT :limit`,
    { orgId, branchId, span: days - 1, limit, vatRate },
  );
  return rows.map((r) => ({
    id: r.id,
    sku: r.sku,
    name: r.name,
    imageUrl: r.image_url,
    quantity: Number(r.qty),
    revenue: Number(r.revenue),
    profit: Number(r.profit),
  }));
}

async function cashflow({ orgId, branchId, months }) {
  const p = { orgId, branchId, span: months - 1 };
  const start = `DATE_FORMAT(${LOCAL_NOW} - INTERVAL :span MONTH, '%Y-%m-01')`;
  const [sales, txns, cur] = await Promise.all([
    db.query(
      `SELECT DATE_FORMAT(${local('so.ordered_at')}, '%Y-%m') AS month, SUM(so.total - so.vat_amount) AS amount
         FROM sales_orders so
        WHERE so.org_id = :orgId AND ${branchFilter('so')} AND ${VALID_ORDER} AND ${local('so.ordered_at')} >= ${start}
        GROUP BY month`,
      p,
    ),
    db.query(
      `SELECT DATE_FORMAT(t.txn_date, '%Y-%m') AS month, t.type, SUM(t.amount) AS amount
         FROM transactions t
        WHERE t.org_id = :orgId AND ${branchFilter('t')} AND t.txn_date >= ${start}
        GROUP BY month, t.type`,
      p,
    ),
    db.one(`SELECT DATE_FORMAT(${LOCAL_NOW}, '%Y-%m-01') AS m`),
  ]);
  const out = [];
  const [y, m] = cur.m.split('-').map(Number);
  for (let i = months - 1; i >= 0; i -= 1) {
    const d = new Date(Date.UTC(y, m - 1 - i, 1));
    const key = d.toISOString().slice(0, 7);
    const income =
      Number(sales.find((s) => s.month === key)?.amount || 0) +
      Number(txns.find((t) => t.month === key && t.type === 'income')?.amount || 0);
    const expense = Number(txns.find((t) => t.month === key && t.type === 'expense')?.amount || 0);
    out.push({ month: key, income, expense, net: income - expense });
  }
  return out;
}

async function lowStock({ orgId, limit }) {
  const rows = await db.query(
    `SELECT p.id, p.sku, p.name, p.unit, p.reorder_point, COALESCE(SUM(sl.quantity), 0) AS on_hand
       FROM products p
       LEFT JOIN stock_levels sl ON sl.product_id = p.id
      WHERE p.org_id = :orgId AND p.status = 'active'
      GROUP BY p.id, p.sku, p.name, p.unit, p.reorder_point
     HAVING COALESCE(SUM(sl.quantity), 0) <= p.reorder_point
      ORDER BY COALESCE(SUM(sl.quantity), 0) / GREATEST(p.reorder_point, 1) ASC
      LIMIT :limit`,
    { orgId, limit },
  );
  return rows.map((r) => ({
    id: r.id,
    sku: r.sku,
    name: r.name,
    unit: r.unit,
    onHand: Number(r.on_hand),
    reorderPoint: Number(r.reorder_point),
  }));
}

async function inboxByChannel({ orgId }) {
  const rows = await db.query(
    `SELECT ch.platform, COUNT(*) AS open_count, COALESCE(SUM(c.unread_count), 0) AS unread
       FROM conversations c JOIN channels ch ON ch.id = c.channel_id
      WHERE c.org_id = :orgId AND c.status IN ('open','pending')
      GROUP BY ch.platform ORDER BY open_count DESC`,
    { orgId },
  );
  return rows.map((r) => ({ platform: r.platform, open: Number(r.open_count), unread: Number(r.unread) }));
}

async function trending({ orgId, limit }) {
  const rows = await db.query(
    `SELECT id, platform, title, url, image_url, price, sold_count, commission_rate, trend_score
       FROM trending_products WHERE org_id = :orgId
      ORDER BY trend_score DESC LIMIT :limit`,
    { orgId, limit },
  );
  return rows.map((r) => ({
    id: r.id,
    platform: r.platform,
    title: r.title,
    url: r.url,
    imageUrl: r.image_url,
    price: r.price == null ? null : Number(r.price),
    soldCount: r.sold_count == null ? null : Number(r.sold_count),
    commissionRate: r.commission_rate == null ? null : Number(r.commission_rate),
    trendScore: r.trend_score == null ? null : Number(r.trend_score),
  }));
}

/** Unified activity feed across modules. */
async function activity({ orgId, limit }) {
  const rows = await db.query(
    `(SELECT 'order' AS kind, so.id AS ref_id, so.order_no AS title, so.channel AS detail, so.total AS amount, so.ordered_at AS at
        FROM sales_orders so WHERE so.org_id = :orgId ORDER BY so.ordered_at DESC LIMIT :limit)
     UNION ALL
     (SELECT 'conversation', c.id, COALESCE(c.customer_name, 'ลูกค้า'), ch.platform, NULL, c.last_message_at
        FROM conversations c JOIN channels ch ON ch.id = c.channel_id
       WHERE c.org_id = :orgId AND c.last_message_at IS NOT NULL ORDER BY c.last_message_at DESC LIMIT :limit)
     UNION ALL
     (SELECT 'post', sp.id, LEFT(COALESCE(sp.caption, ''), 80), sp.status, NULL, sp.scheduled_at
        FROM scheduled_posts sp WHERE sp.org_id = :orgId AND sp.scheduled_at <= UTC_TIMESTAMP()
       ORDER BY sp.scheduled_at DESC LIMIT :limit)
     UNION ALL
     (SELECT 'expense', t.id, t.description, t.category, t.amount, t.created_at
        FROM transactions t WHERE t.org_id = :orgId AND t.type = 'expense' ORDER BY t.created_at DESC LIMIT :limit)
     ORDER BY at DESC LIMIT :limit`,
    { orgId, limit },
  );
  return rows.map((r) => ({
    kind: r.kind,
    refId: r.ref_id,
    title: r.title,
    detail: r.detail,
    amount: r.amount == null ? null : Number(r.amount),
    at: r.at,
  }));
}

module.exports = { summary, salesTrend, channelMix, topProducts, cashflow, lowStock, inboxByChannel, trending, activity };
