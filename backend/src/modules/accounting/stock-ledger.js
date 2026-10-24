'use strict';

// รายงานสินค้าและวัตถุดิบ (Revenue Code s.87(3)): for each product in one warehouse (place of
// business), the balance brought forward, every receipt and issue in the month with the document it
// came from, and the balance carried forward. Till sales are summed per product per day (retail
// sales may be entered as daily totals); everything else is one line per movement.

const db = require('../../db/pool');
const env = require('../../config/env');
const { notFound } = require('../../core/errors');

const TZ = env.APP_TZ_OFFSET;
const LOCAL = (col) => `CONVERT_TZ(${col}, '+00:00', '${TZ}')`;

const TYPE_LABEL = {
  purchase: 'รับสินค้า',
  sale: 'ขาย',
  return: 'รับคืนจากลูกค้า',
  adjustment: 'ปรับปรุงยอด',
  transfer_in: 'รับโอน',
  transfer_out: 'โอนออก',
  opening: 'ยอดตั้งต้น',
  count: 'ปรับตามการตรวจนับ',
  waste: 'ตัดของเสีย',
  welfare: 'เบิกสวัสดิการพนักงาน',
};

/** The month as local [from, next) dates. */
function monthBounds(month) {
  const [y, m] = month.split('-').map(Number);
  const next = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`;
  return { from: `${month}-01`, next };
}

async function stockLedger(orgId, { month, warehouseId, productId = null }) {
  const wh = await db.one(
    `SELECT w.id, w.name, b.name AS branch_name, b.branch_no FROM warehouses w LEFT JOIN branches b ON b.id = w.branch_id
      WHERE w.id = :warehouseId AND w.org_id = :orgId`,
    { warehouseId, orgId },
  );
  if (!wh) throw notFound('ไม่พบคลังสินค้า');
  const { from, next } = monthBounds(month);
  const params = { orgId, warehouseId, productId, from, next };
  const productFilter = productId ? 'AND m.product_id = :productId' : '';

  const [opening, moves] = await Promise.all([
    db.query(
      `SELECT m.product_id, SUM(m.quantity) AS qty FROM stock_movements m
        WHERE m.org_id = :orgId AND m.warehouse_id = :warehouseId ${productFilter} AND ${LOCAL('m.created_at')} < :from
        GROUP BY m.product_id`,
      params,
    ),
    // till sales: one line per product per day; other movements: one line each, with their document number
    db.query(
      `SELECT * FROM (
         SELECT m.product_id, DATE(${LOCAL('m.created_at')}) AS day, MIN(m.created_at) AS at, 'sale' AS type, SUM(m.quantity) AS qty,
                NULL AS unit_cost, CONCAT('ขายหน้าร้าน ', COUNT(DISTINCT m.ref_id), ' บิล') AS doc_no, MIN(m.id) AS mid
           FROM stock_movements m
          WHERE m.org_id = :orgId AND m.warehouse_id = :warehouseId ${productFilter} AND m.type = 'sale'
            AND ${LOCAL('m.created_at')} >= :from AND ${LOCAL('m.created_at')} < :next
          GROUP BY m.product_id, DATE(${LOCAL('m.created_at')})
         UNION ALL
         SELECT m.product_id, DATE(${LOCAL('m.created_at')}) AS day, m.created_at AS at, m.type, m.quantity AS qty, m.unit_cost,
                COALESCE(sd.doc_no, po.po_no, t.transfer_no, sc.count_no, wr.request_no, sr.return_no, so.order_no,
                         CONCAT('#', m.id)) AS doc_no, m.id AS mid
           FROM stock_movements m
           LEFT JOIN stock_documents sd ON sd.id = m.stock_document_id
           LEFT JOIN purchase_orders po ON m.ref_type = 'purchase_order' AND po.id = m.ref_id
           LEFT JOIN stock_transfers t ON m.ref_type IN ('transfer','stock_transfer') AND t.id = m.ref_id
           LEFT JOIN stock_counts sc ON m.ref_type = 'stock_count' AND sc.id = m.ref_id
           LEFT JOIN welfare_requests wr ON m.ref_type = 'welfare_request' AND wr.id = m.ref_id
           LEFT JOIN sales_returns sr ON m.ref_type = 'sales_return' AND sr.id = m.ref_id
           LEFT JOIN sales_orders so ON m.ref_type = 'sales_order' AND so.id = m.ref_id
          WHERE m.org_id = :orgId AND m.warehouse_id = :warehouseId ${productFilter} AND m.type <> 'sale'
            AND ${LOCAL('m.created_at')} >= :from AND ${LOCAL('m.created_at')} < :next
       ) x ORDER BY x.product_id, x.at, x.mid`,
      params,
    ),
  ]);

  const ids = [...new Set([...opening.filter((o) => Number(o.qty) !== 0).map((o) => o.product_id), ...moves.map((m) => m.product_id)])];
  const products = ids.length
    ? await db.query('SELECT id, sku, name, unit FROM products WHERE id IN (:ids) ORDER BY name', { ids })
    : [];
  const openingOf = new Map(opening.map((o) => [o.product_id, Number(o.qty)]));
  const movesOf = new Map();
  for (const m of moves) {
    if (!movesOf.has(m.product_id)) movesOf.set(m.product_id, []);
    movesOf.get(m.product_id).push(m);
  }
  const round = (n) => Math.round(n * 1000) / 1000;

  return {
    month,
    warehouse: { id: wh.id, name: wh.name, branchName: wh.branch_name, branchNo: wh.branch_no },
    products: products.map((p) => {
      const open = round(openingOf.get(p.id) ?? 0);
      let balance = open;
      let totalIn = 0;
      let totalOut = 0;
      const lines = (movesOf.get(p.id) ?? []).map((m) => {
        const q = Number(m.qty);
        balance = round(balance + q);
        if (q > 0) totalIn += q;
        else totalOut -= q;
        return {
          date: m.day instanceof Date ? m.day.toISOString().slice(0, 10) : String(m.day).slice(0, 10),
          docNo: m.doc_no,
          type: m.type,
          description: TYPE_LABEL[m.type] ?? m.type,
          qtyIn: q > 0 ? round(q) : 0,
          qtyOut: q < 0 ? round(-q) : 0,
          unitCost: m.unit_cost == null ? null : Number(m.unit_cost),
          balance,
        };
      });
      return { productId: p.id, sku: p.sku, name: p.name, unit: p.unit, opening: open, totalIn: round(totalIn), totalOut: round(totalOut), closing: balance, lines };
    }),
  };
}

module.exports = { stockLedger, monthBounds };
