'use strict';

const express = require('express');
const { z } = require('zod');
const db = require('../../db/pool');
const { validate } = require('../../core/http');
const { authenticate, requirePermission } = require('../../core/auth');
const { audit } = require('../../core/audit');
const { badRequest, conflict, notFound } = require('../../core/errors');
const { applyMovement, getWarehouse } = require('./inventory.service');
const { postJournal, ACC } = require('../accounting/ledger.service');
const { localDate } = require('../../utils/dates');

/**
 * Stocktake / cycle count (Loyverse + Lightspeed pattern):
 *   create (snapshot system qty) -> staff scan-count on phones (blind by default)
 *   -> submit -> manager reviews variance (counted - (snapshot + movements since)) -> approve posts
 *   one 'count' movement per differing item and the gain/loss journal.
 * Sales keep running during the count; movements after the snapshot are netted out per item.
 */
const router = express.Router();
router.use(authenticate);

const idParam = z.object({ id: z.coerce.number().int().positive() });
const r3 = (n) => Math.round(n * 1000) / 1000;
const r2 = (n) => Math.round(n * 100) / 100;
/** Variances above this % of the expected quantity need a reason before approval. */
const REASON_PCT = 10;

async function loadCount(orgId, id, conn = null) {
  const q = conn ? (sql, p) => conn.query(sql, p).then(([rows]) => rows[0]) : db.one;
  const c = await q(
    `SELECT sc.*, w.name AS warehouse_name, u.full_name AS created_by_name, a.full_name AS approved_by_name, cat.name AS category_name
       FROM stock_counts sc
       JOIN warehouses w ON w.id = sc.warehouse_id
       JOIN users u ON u.id = sc.created_by
       LEFT JOIN users a ON a.id = sc.approved_by
       LEFT JOIN product_categories cat ON cat.id = sc.category_id
      WHERE sc.id = :id AND sc.org_id = :orgId ${conn ? 'FOR UPDATE' : ''}`,
    { id, orgId },
  );
  if (!c) throw notFound('ไม่พบรอบตรวจนับ');
  return c;
}

const mapCount = (c, progress = null) => ({
  id: c.id,
  countNo: c.count_no,
  warehouseId: c.warehouse_id,
  warehouseName: c.warehouse_name,
  scope: c.scope,
  categoryId: c.category_id,
  categoryName: c.category_name ?? null,
  blind: Boolean(c.blind),
  status: c.status,
  note: c.note,
  createdBy: c.created_by_name,
  approvedBy: c.approved_by_name ?? null,
  approvedAt: c.approved_at,
  createdAt: c.created_at,
  ...(progress ?? {}),
});

/**
 * Per item: expected = snapshot + net movements since the count started (sales, receipts...),
 * variance = counted - expected. Uncounted items are left untouched on approval.
 */
async function varianceRows(count, conn = null) {
  const run = conn ? (sql, p) => conn.query(sql, p).then(([rows]) => rows) : db.query;
  const rows = await run(
    `SELECT i.product_id, i.snapshot_qty, i.unit_cost, i.counted_qty, i.counted_at, i.reason,
            p.sku, p.barcode, p.name, p.unit, cu.full_name AS counted_by_name,
            COALESCE((SELECT SUM(m.quantity) FROM stock_movements m
                       WHERE m.warehouse_id = :warehouseId AND m.product_id = i.product_id
                         AND m.id > :startId AND m.type <> 'count'), 0) AS since
       FROM stock_count_items i
       JOIN products p ON p.id = i.product_id
       LEFT JOIN users cu ON cu.id = i.counted_by
      WHERE i.count_id = :countId
      ORDER BY i.counted_at IS NULL, i.counted_at DESC, p.name`,
    { countId: count.id, warehouseId: count.warehouse_id, startId: count.start_movement_id },
  );
  return rows.map((r) => {
    const snapshot = Number(r.snapshot_qty);
    const since = Number(r.since);
    const expected = r3(snapshot + since);
    const counted = r.counted_qty == null ? null : Number(r.counted_qty);
    const variance = counted == null ? null : r3(counted - expected);
    return {
      productId: r.product_id,
      sku: r.sku,
      barcode: r.barcode,
      name: r.name,
      unit: r.unit,
      snapshot,
      movedDuringCount: since,
      expected,
      counted,
      variance,
      value: variance == null ? null : r2(variance * Number(r.unit_cost)),
      unitCost: Number(r.unit_cost),
      reason: r.reason,
      countedBy: r.counted_by_name,
      countedAt: r.counted_at,
      needsReason: variance != null && variance !== 0 && Math.abs(variance) > Math.max(expected, 1) * (REASON_PCT / 100) && !r.reason,
    };
  });
}

/** Counters on a blind count never see what the system expects. */
const hideForCounter = (row) => ({ ...row, snapshot: null, expected: null, movedDuringCount: null, variance: null, value: null, needsReason: false });

function summarize(items) {
  const counted = items.filter((i) => i.counted != null);
  return {
    total: items.length,
    counted: counted.length,
    diffItems: counted.filter((i) => i.variance).length,
    gainValue: r2(counted.filter((i) => i.value > 0).reduce((s, i) => s + i.value, 0)),
    lossValue: r2(counted.filter((i) => i.value < 0).reduce((s, i) => s + i.value, 0)),
  };
}

router.get(
  '/',
  requirePermission('inventory:count'),
  validate({ query: z.object({ status: z.enum(['counting', 'review', 'approved', 'cancelled']).optional() }) }),
  async (req, res) => {
    const rows = await db.query(
      `SELECT sc.*, w.name AS warehouse_name, u.full_name AS created_by_name, a.full_name AS approved_by_name, cat.name AS category_name,
              (SELECT COUNT(*) FROM stock_count_items i WHERE i.count_id = sc.id) AS total_items,
              (SELECT COUNT(*) FROM stock_count_items i WHERE i.count_id = sc.id AND i.counted_qty IS NOT NULL) AS counted_items
         FROM stock_counts sc
         JOIN warehouses w ON w.id = sc.warehouse_id
         JOIN users u ON u.id = sc.created_by
         LEFT JOIN users a ON a.id = sc.approved_by
         LEFT JOIN product_categories cat ON cat.id = sc.category_id
        WHERE sc.org_id = :orgId AND (:status IS NULL OR sc.status = :status)
        ORDER BY FIELD(sc.status, 'counting', 'review', 'approved', 'cancelled'), sc.id DESC
        LIMIT 100`,
      { orgId: req.user.orgId, status: req.valid.query.status ?? null },
    );
    res.json({ data: rows.map((c) => mapCount(c, { totalItems: Number(c.total_items), countedItems: Number(c.counted_items) })) });
  },
);

router.post(
  '/',
  requirePermission('inventory:count'),
  validate({
    body: z.object({
      warehouseId: z.number().int().positive(),
      scope: z.enum(['full', 'category']).default('full'),
      categoryId: z.number().int().positive().optional(),
      blind: z.boolean().default(true),
      note: z.string().trim().max(255).optional(),
    }),
  }),
  async (req, res) => {
    const b = req.valid.body;
    const orgId = req.user.orgId;
    if (b.scope === 'category' && !b.categoryId) throw badRequest('กรุณาเลือกหมวดสินค้า');
    const id = await db.tx(async (conn) => {
      await getWarehouse(conn, orgId, b.warehouseId);
      const [[open]] = await conn.query(
        `SELECT count_no FROM stock_counts WHERE org_id = :orgId AND warehouse_id = :warehouseId AND status IN ('counting','review')
           AND (scope = 'full' OR :scope = 'full' OR category_id = :categoryId) LIMIT 1`,
        { orgId, warehouseId: b.warehouseId, scope: b.scope, categoryId: b.categoryId ?? null },
      );
      if (open) throw conflict(`มีรอบตรวจนับ ${open.count_no} ที่ยังไม่ปิดในคลังนี้`);
      const [ins] = await conn.query(
        `INSERT INTO stock_counts (org_id, warehouse_id, count_no, scope, category_id, blind, note, created_by, created_at)
         VALUES (:orgId, :warehouseId, :tmp, :scope, :categoryId, :blind, :note, :userId, UTC_TIMESTAMP())`,
        {
          orgId,
          warehouseId: b.warehouseId,
          tmp: `TMP-${Date.now()}-${req.user.id}`,
          scope: b.scope,
          categoryId: b.scope === 'category' ? b.categoryId : null,
          blind: b.blind ? 1 : 0,
          note: b.note ?? null,
          userId: req.user.id,
        },
      );
      await conn.query('UPDATE stock_counts SET count_no = :no WHERE id = :id', { no: `SC${String(ins.insertId).padStart(6, '0')}`, id: ins.insertId });
      // Movements after this id happened during the count and are netted out per item.
      // The snapshot rows are locked so a sale cannot slip between the id and the quantities.
      await conn.query('SELECT product_id FROM stock_levels WHERE warehouse_id = :warehouseId FOR UPDATE', { warehouseId: b.warehouseId });
      const [[last]] = await conn.query('SELECT COALESCE(MAX(id), 0) AS id FROM stock_movements');
      await conn.query('UPDATE stock_counts SET start_movement_id = :mid WHERE id = :id', { mid: last.id, id: ins.insertId });
      // Snapshot every active product in scope (zero-stock ones too: finding them on the shelf is the point)
      await conn.query(
        `INSERT INTO stock_count_items (count_id, product_id, snapshot_qty, unit_cost)
         SELECT :countId, p.id, COALESCE(sl.quantity, 0), p.cost
           FROM products p
           LEFT JOIN stock_levels sl ON sl.product_id = p.id AND sl.variant_id = 0 AND sl.warehouse_id = :warehouseId
          WHERE p.org_id = :orgId AND p.status = 'active' AND (:categoryId IS NULL OR p.category_id = :categoryId)`,
        { countId: ins.insertId, warehouseId: b.warehouseId, orgId, categoryId: b.scope === 'category' ? b.categoryId : null },
      );
      return ins.insertId;
    });
    audit(req, 'stock_count.create', 'stock_count', id, { warehouseId: b.warehouseId, scope: b.scope });
    res.status(201).json({ data: mapCount(await loadCount(orgId, id)) });
  },
);

router.get('/:id', requirePermission('inventory:count'), validate({ params: idParam }), async (req, res) => {
  const c = await loadCount(req.user.orgId, req.valid.params.id);
  const items = await varianceRows(c);
  const manager = req.user.permissions.includes('inventory:approve');
  const hidden = c.blind && !manager && c.status === 'counting';
  res.json({
    data: {
      ...mapCount(c, summarize(items)),
      canApprove: manager,
      items: hidden ? items.map(hideForCounter) : items,
      ...(hidden ? { diffItems: null, gainValue: null, lossValue: null } : {}),
    },
  });
});

/**
 * Scan-count: a product or pack barcode (pack scans multiply by the pack size).
 * mode=add accumulates (scan every piece / enter per shelf), mode=set overwrites.
 */
router.post(
  '/:id/scan',
  requirePermission('inventory:count'),
  validate({
    params: idParam,
    body: z.object({
      code: z.string().trim().min(1).max(64).optional(),
      productId: z.number().int().positive().optional(),
      qty: z.coerce.number().min(0).max(1_000_000).default(1),
      mode: z.enum(['add', 'set']).default('add'),
    }),
  }),
  async (req, res) => {
    const b = req.valid.body;
    const orgId = req.user.orgId;
    const c = await loadCount(orgId, req.valid.params.id);
    if (c.status !== 'counting') throw conflict('รอบนี้ปิดการนับแล้ว');
    let productId = b.productId;
    let factor = 1;
    let unitName = null;
    if (!productId) {
      if (!b.code) throw badRequest('กรุณาสแกนบาร์โค้ด');
      const p = await db.one('SELECT id FROM products WHERE org_id = :orgId AND (barcode = :code OR sku = :code) LIMIT 1', { orgId, code: b.code });
      if (p) productId = p.id;
      else {
        const u = await db.one('SELECT product_id, factor, name FROM product_units WHERE org_id = :orgId AND barcode = :code', { orgId, code: b.code });
        if (!u) throw notFound(`ไม่พบสินค้ารหัส ${b.code}`);
        productId = u.product_id;
        factor = Number(u.factor);
        unitName = u.name;
      }
    }
    const item = await db.one('SELECT product_id FROM stock_count_items WHERE count_id = :countId AND product_id = :productId', {
      countId: c.id,
      productId,
    });
    if (!item) throw notFound('สินค้านี้ไม่อยู่ในรอบตรวจนับนี้');
    const qty = r3(b.qty * factor);
    await db.query(
      `UPDATE stock_count_items
          SET counted_qty = ${b.mode === 'add' ? 'COALESCE(counted_qty, 0) + :qty' : ':qty'}, counted_by = :userId, counted_at = UTC_TIMESTAMP()
        WHERE count_id = :countId AND product_id = :productId`,
      { qty, userId: req.user.id, countId: c.id, productId },
    );
    const rows = await varianceRows(c);
    const row = rows.find((r) => r.productId === productId);
    const manager = req.user.permissions.includes('inventory:approve');
    res.json({
      data: {
        item: c.blind && !manager ? hideForCounter(row) : row,
        added: qty,
        unitName,
        progress: { total: rows.length, counted: rows.filter((r) => r.counted != null).length },
      },
    });
  },
);

/** Correct a count or add the variance reason (managers, during review). */
router.patch(
  '/:id/items/:productId',
  requirePermission('inventory:count'),
  validate({
    params: z.object({ id: z.coerce.number().int().positive(), productId: z.coerce.number().int().positive() }),
    body: z.object({
      countedQty: z.coerce.number().min(0).max(1_000_000).nullable().optional(),
      reason: z.string().trim().max(200).nullable().optional(),
    }),
  }),
  async (req, res) => {
    const c = await loadCount(req.user.orgId, req.valid.params.id);
    const b = req.valid.body;
    if (c.status === 'approved' || c.status === 'cancelled') throw conflict('รอบนี้ปิดแล้ว');
    if (c.status === 'review' && !req.user.permissions.includes('inventory:approve')) throw conflict('รอบนี้ส่งตรวจแล้ว');
    const r = await db.query(
      `UPDATE stock_count_items
          SET counted_qty = IF(:setQty = 1, :qty, counted_qty),
              counted_by = IF(:setQty = 1, :userId, counted_by),
              counted_at = IF(:setQty = 1, IF(:qty IS NULL, NULL, UTC_TIMESTAMP()), counted_at),
              reason = IF(:setReason = 1, :reason, reason)
        WHERE count_id = :countId AND product_id = :productId`,
      {
        setQty: b.countedQty === undefined ? 0 : 1,
        qty: b.countedQty ?? null,
        userId: req.user.id,
        setReason: b.reason === undefined ? 0 : 1,
        reason: b.reason || null,
        countId: c.id,
        productId: req.valid.params.productId,
      },
    );
    if (!r.affectedRows) throw notFound('ไม่พบรายการ');
    res.json({ data: { ok: true } });
  },
);

router.post('/:id/submit', requirePermission('inventory:count'), validate({ params: idParam }), async (req, res) => {
  const c = await loadCount(req.user.orgId, req.valid.params.id);
  if (c.status !== 'counting') throw conflict('รอบนี้ส่งตรวจแล้ว');
  const counted = await db.one('SELECT COUNT(*) AS n FROM stock_count_items WHERE count_id = :id AND counted_qty IS NOT NULL', { id: c.id });
  if (!Number(counted.n)) throw badRequest('ยังไม่ได้นับสินค้าเลย');
  await db.query("UPDATE stock_counts SET status = 'review' WHERE id = :id", { id: c.id });
  audit(req, 'stock_count.submit', 'stock_count', c.id);
  res.json({ data: mapCount({ ...c, status: 'review' }) });
});

/** Post the variance: one 'count' movement per differing item + the stock gain/loss journal. */
router.post('/:id/approve', requirePermission('inventory:approve'), validate({ params: idParam }), async (req, res) => {
  const orgId = req.user.orgId;
  const result = await db.tx(async (conn) => {
    const c = await loadCount(orgId, req.valid.params.id, conn);
    if (c.status !== 'review' && c.status !== 'counting') throw conflict('รอบนี้ปิดแล้ว');
    const items = await varianceRows(c, conn);
    const missing = items.filter((i) => i.needsReason);
    if (missing.length)
      throw badRequest(
        `กรุณาใส่เหตุผลของส่วนต่างที่เกิน ${REASON_PCT}%: ${missing
          .slice(0, 5)
          .map((i) => i.name)
          .join(', ')}`,
      );
    let gain = 0;
    let loss = 0;
    for (const i of items) {
      if (!i.variance) continue;
      await applyMovement(conn, {
        orgId,
        warehouseId: c.warehouse_id,
        productId: i.productId,
        quantity: i.variance,
        type: 'count',
        unitCost: i.unitCost,
        refType: 'stock_count',
        refId: c.id,
        note: `ตรวจนับ ${c.count_no}${i.reason ? `: ${i.reason}` : ''}`.slice(0, 255),
        userId: req.user.id,
        allowNegative: true,
      });
      if (i.value > 0) gain += i.value;
      else loss -= i.value;
    }
    gain = r2(gain);
    loss = r2(loss);
    await postJournal(conn, {
      orgId,
      date: localDate(),
      description: `ปรับปรุงสต๊อกจากการตรวจนับ ${c.count_no}`,
      refType: 'stock_count',
      refId: c.id,
      userId: req.user.id,
      lines: [
        { account: ACC.OTHER_EXPENSE, debit: loss, memo: 'สินค้าขาดจากการตรวจนับ' },
        { account: ACC.INVENTORY, credit: loss },
        { account: ACC.INVENTORY, debit: gain },
        { account: ACC.OTHER_INCOME, credit: gain, memo: 'สินค้าเกินจากการตรวจนับ' },
      ],
    });
    await conn.query("UPDATE stock_counts SET status = 'approved', approved_by = :userId, approved_at = UTC_TIMESTAMP() WHERE id = :id", {
      userId: req.user.id,
      id: c.id,
    });
    return { id: c.id, adjusted: items.filter((i) => i.variance).length, gain, loss };
  });
  audit(req, 'stock_count.approve', 'stock_count', result.id, result);
  res.json({ data: result });
});

router.post('/:id/cancel', requirePermission('inventory:count'), validate({ params: idParam }), async (req, res) => {
  const c = await loadCount(req.user.orgId, req.valid.params.id);
  if (c.status === 'approved' || c.status === 'cancelled') throw conflict('รอบนี้ปิดแล้ว');
  if (c.status === 'review' && !req.user.permissions.includes('inventory:approve')) throw conflict('ต้องให้ผู้จัดการยกเลิก');
  await db.query("UPDATE stock_counts SET status = 'cancelled' WHERE id = :id", { id: c.id });
  audit(req, 'stock_count.cancel', 'stock_count', c.id);
  res.json({ data: { ok: true } });
});

module.exports = { router, varianceRows, REASON_PCT };
