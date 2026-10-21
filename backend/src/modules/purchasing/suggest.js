'use strict';

const db = require('../../db/pool');
const { salesStats, daysCover } = require('../inventory/analytics');

/** Days between two orders (the shop orders weekly) and the safety margin on top of expected sales. */
const REVIEW_DAYS = 7;
const SAFETY = 1.2;

/**
 * Order suggestion per item (7-Eleven "tanpin kanri"): enough to sell until the delivery after next.
 *   target  = avgDaily x (leadTime + REVIEW_DAYS) x SAFETY, at least reorderPoint + avgDaily x leadTime
 *   suggest = target - onHand - onOrder, capped by max_qty, rounded up to the order multiple (pack size)
 */
function suggestQty({ avgDaily, leadTime, onHand, onOrder, reorderPoint, maxQty, packSize, wasteRate = 0 }) {
  // Items that keep expiring on the shelf are ordered leaner (at most halved)
  const lean = 1 - Math.min(Math.max(wasteRate, 0), 0.5);
  const target = Math.max(avgDaily * (leadTime + REVIEW_DAYS) * SAFETY * lean, reorderPoint > 0 ? reorderPoint + avgDaily * leadTime * lean : 0);
  let need = target - onHand - onOrder;
  if (maxQty != null && maxQty > 0) need = Math.min(need, maxQty - onHand - onOrder);
  if (need <= 0) return 0;
  const pack = packSize > 0 ? packSize : 1;
  return Math.ceil(need / pack - 1e-9) * pack;
}

/**
 * Rows for the ordering screen: every active product of the supplier (or all suppliers) with its
 * sales sparkline, stock, quantity already on order and the suggestion. Sorted most urgent first.
 */
async function suggestions({ orgId, warehouseId, supplierId = null, onlyNeeded = true }) {
  const rows = await db.query(
    `SELECT p.id, p.sku, p.name, p.unit, p.cost, p.price, p.pack_size, p.supplier_id, s.name AS supplier_name,
            COALESCE(s.lead_time_days, 2) AS lead_time, c.name AS category_name,
            COALESCE(sl.quantity, 0) AS qty, COALESCE(sl.reorder_point, p.reorder_point) AS reorder_point, sl.max_qty,
            COALESCE((SELECT SUM(i.quantity - i.received_qty) FROM purchase_order_items i JOIN purchase_orders po ON po.id = i.po_id
                       WHERE i.product_id = p.id AND po.warehouse_id = :warehouseId AND po.status IN ('ordered','partial')), 0) AS on_order,
            COALESCE((SELECT SUM(x.quantity) FROM stock_levels x JOIN warehouses w ON w.id = x.warehouse_id
                       WHERE x.product_id = p.id AND x.variant_id = 0 AND w.org_id = :orgId AND x.warehouse_id <> :warehouseId), 0) AS other_qty
       FROM products p
       LEFT JOIN suppliers s ON s.id = p.supplier_id
       LEFT JOIN product_categories c ON c.id = p.category_id
       LEFT JOIN stock_levels sl ON sl.product_id = p.id AND sl.variant_id = 0 AND sl.warehouse_id = :warehouseId
      WHERE p.org_id = :orgId AND p.status = 'active'
        AND (:supplierId IS NULL OR p.supplier_id = :supplierId OR (:supplierId = 0 AND p.supplier_id IS NULL))`,
    { orgId, warehouseId, supplierId },
  );
  const stats = await salesStats({ orgId, warehouseId, productIds: rows.map((r) => r.id) });
  const wasteRows = rows.length
    ? await db.query(
        `SELECT product_id, -SUM(quantity) AS qty FROM stock_movements
          WHERE warehouse_id = :warehouseId AND type = 'waste' AND created_at >= UTC_TIMESTAMP() - INTERVAL 28 DAY AND product_id IN (:ids)
          GROUP BY product_id`,
        { warehouseId, ids: rows.map((r) => r.id) },
      )
    : [];
  const waste = new Map(wasteRows.map((w) => [w.product_id, Number(w.qty)]));
  const out = rows.map((r) => {
    const st = stats.get(r.id);
    const avgDaily = st?.avgDaily ?? 0;
    const onHand = Number(r.qty);
    const onOrder = Math.max(Number(r.on_order), 0);
    const reorderPoint = Number(r.reorder_point);
    const leadTime = Number(r.lead_time);
    const packSize = Number(r.pack_size) || 1;
    const wasted = waste.get(r.id) ?? 0;
    const sold28 = st?.sold28 ?? 0;
    const wasteRate = wasted > 0 ? wasted / (sold28 + wasted) : 0;
    const suggested = suggestQty({ avgDaily, leadTime, onHand, onOrder, reorderPoint, maxQty: r.max_qty == null ? null : Number(r.max_qty), packSize, wasteRate });
    return {
      productId: r.id,
      sku: r.sku,
      name: r.name,
      unit: r.unit,
      categoryName: r.category_name,
      supplierId: r.supplier_id,
      supplierName: r.supplier_name,
      cost: Number(r.cost),
      price: Number(r.price),
      packSize,
      leadTime,
      onHand,
      onOrder,
      // Stock in the org's other warehouses: a transfer may be better than a purchase
      otherStock: Math.max(Number(r.other_qty), 0),
      reorderPoint,
      avgDaily,
      sold7: st?.sold7 ?? 0,
      spark: st?.daily ?? Array(14).fill(0),
      daysCover: daysCover(onHand + onOrder, avgDaily),
      suggested,
      wasted28: wasted,
      reason:
        (onHand <= 0 && Number(r.other_qty) > 0 ? `คลังอื่นมี ${Number(r.other_qty)} — โอนย้ายแทนการสั่งซื้อได้ · ` : '') +
        (wasted > 0 ? `ทิ้ง ${wasted} ใน 28 วัน สั่งลดลง ${Math.round(Math.min(wasteRate, 0.5) * 100)}% · ` : '') +
        (avgDaily > 0
          ? `ขายเฉลี่ย ${avgDaily.toFixed(1)}/วัน × (ส่งของ ${leadTime} + รอบสั่ง ${REVIEW_DAYS} วัน) − มี ${onHand}${onOrder ? ` − กำลังมา ${onOrder}` : ''}`
          : reorderPoint > 0
            ? `ยังไม่มียอดขาย · เติมให้ถึงจุดสั่งซื้อ ${reorderPoint}`
            : 'ยังไม่มียอดขาย'),
    };
  });
  const urgent = (x) => (x.onHand <= 0 ? -1 : (x.daysCover ?? 999));
  return out
    .filter((x) => !onlyNeeded || x.suggested > 0 || x.onHand <= 0)
    .sort((a, b) => urgent(a) - urgent(b) || b.suggested * b.cost - a.suggested * a.cost);
}

module.exports = { suggestQty, suggestions, REVIEW_DAYS, SAFETY };
