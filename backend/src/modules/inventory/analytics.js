'use strict';

const db = require('../../db/pool');
const env = require('../../config/env');

/** Business-day bucketing in the shop's time zone (sales at 23:30 Bangkok belong to that day). */
const LOCAL = (col) => `CONVERT_TZ(${col}, '+00:00', '${env.APP_TZ_OFFSET}')`;
const LOCAL_TODAY = `DATE(CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', '${env.APP_TZ_OFFSET}'))`;

/**
 * Units sold per product from the stock ledger (sales net of voided-bill returns), so pack sales
 * already count in base units. Weighted velocity favours the last week but keeps a month of memory,
 * the way 7-Eleven's order suggestions react quickly without chasing one odd day.
 *
 * @returns {Promise<Map<number, {sold7:number, sold28:number, avgDaily:number, lastSoldAt:string|null, daily:number[]}>>}
 */
async function salesStats({ orgId, warehouseId = null, productIds = null, sparkDays = 14 }) {
  if (productIds && !productIds.length) return new Map();
  const where = `m.org_id = :orgId AND m.type IN ('sale','return') AND (:warehouseId IS NULL OR m.warehouse_id = :warehouseId)
                 ${productIds ? 'AND m.product_id IN (:productIds)' : ''}`;
  const params = { orgId, warehouseId, productIds, sparkDays: sparkDays - 1 };
  const totals = await db.query(
    `SELECT m.product_id,
            -SUM(CASE WHEN ${LOCAL('m.created_at')} >= ${LOCAL_TODAY} - INTERVAL 6 DAY THEN m.quantity ELSE 0 END) AS sold7,
            -SUM(m.quantity) AS sold28,
            MAX(CASE WHEN m.type = 'sale' THEN m.created_at END) AS last_sold
       FROM stock_movements m
      WHERE ${where} AND ${LOCAL('m.created_at')} >= ${LOCAL_TODAY} - INTERVAL 27 DAY
      GROUP BY m.product_id`,
    params,
  );
  const days = sparkDays
    ? await db.query(
        `SELECT m.product_id, DATEDIFF(${LOCAL_TODAY}, DATE(${LOCAL('m.created_at')})) AS ago, -SUM(m.quantity) AS sold
           FROM stock_movements m
          WHERE ${where} AND ${LOCAL('m.created_at')} >= ${LOCAL_TODAY} - INTERVAL :sparkDays DAY
          GROUP BY m.product_id, ago`,
        params,
      )
    : [];
  const out = new Map();
  for (const t of totals) {
    const sold7 = Math.max(Number(t.sold7), 0);
    const sold28 = Math.max(Number(t.sold28), 0);
    out.set(t.product_id, {
      sold7,
      sold28,
      avgDaily: Math.round(((0.6 * sold7) / 7 + (0.4 * sold28) / 28) * 1000) / 1000,
      lastSoldAt: t.last_sold,
      daily: Array(sparkDays).fill(0),
    });
  }
  for (const d of days) {
    const s = out.get(d.product_id);
    if (s && d.ago < sparkDays) s.daily[sparkDays - 1 - d.ago] = Math.max(Number(d.sold), 0);
  }
  return out;
}

const EMPTY = { sold7: 0, sold28: 0, avgDaily: 0, lastSoldAt: null, daily: [] };

/** Stock status the way a store manager reads it. */
function stockStatus({ quantity, reorderPoint, avgDaily, lastSoldAt }) {
  if (quantity <= 0) return 'out';
  if (reorderPoint > 0 && quantity <= reorderPoint) return 'low';
  if (avgDaily > 0 && quantity / avgDaily < 3) return 'low';
  if (!lastSoldAt) return 'slow';
  return 'ok';
}

const daysCover = (quantity, avgDaily) => (avgDaily > 0 ? Math.round((quantity / avgDaily) * 10) / 10 : null);

module.exports = { salesStats, stockStatus, daysCover, EMPTY, LOCAL, LOCAL_TODAY };
