'use strict';

// ใบขอซื้อ (purchase requests): staff ask for goods, a manager approves — which turns the request
// into a purchase order draft — or rejects it with a reason.

const express = require('express');
const { z } = require('zod');
const db = require('../../db/pool');
const { validate } = require('../../core/http');
const { authenticate, requirePermission } = require('../../core/auth');
const { audit } = require('../../core/audit');
const { badRequest, conflict, forbidden, notFound } = require('../../core/errors');
const { nextNumber } = require('../accounting/ledger.service');
const { localDate } = require('../../utils/dates');
const { createPurchaseOrder } = require('./purchasing.routes');

const router = express.Router();
router.use(authenticate);

const idParam = z.object({ id: z.coerce.number().int().positive() });
const canRequest = (req, res, next) =>
  ['inventory:read', 'inventory:write', 'purchasing:write'].some((p) => req.user.permissions.includes(p)) ? next() : next(forbidden('ต้องมีสิทธิ์ดูสต๊อก'));

const SELECT = `SELECT r.*, DATE_FORMAT(r.needed_by, '%Y-%m-%d') AS needed_by_str, w.name AS warehouse_name, s.name AS supplier_name,
                       ru.full_name AS requested_by_name, du.full_name AS decided_by_name, po.po_no,
                       (SELECT COALESCE(SUM(i.quantity * COALESCE(i.est_unit_cost, p.cost)), 0) FROM purchase_request_items i
                          JOIN products p ON p.id = i.product_id WHERE i.request_id = r.id) AS est_total,
                       (SELECT COUNT(*) FROM purchase_request_items i WHERE i.request_id = r.id) AS item_count
                  FROM purchase_requests r
                  JOIN warehouses w ON w.id = r.warehouse_id
                  LEFT JOIN suppliers s ON s.id = r.supplier_id
                  LEFT JOIN users ru ON ru.id = r.requested_by
                  LEFT JOIN users du ON du.id = r.decided_by
                  LEFT JOIN purchase_orders po ON po.id = r.purchase_order_id`;

const map = (r, items) => ({
  id: r.id,
  prNo: r.pr_no,
  status: r.status,
  warehouseId: r.warehouse_id,
  warehouseName: r.warehouse_name,
  supplierId: r.supplier_id,
  supplierName: r.supplier_name,
  neededBy: r.needed_by_str,
  reason: r.reason,
  requestedBy: r.requested_by_name,
  requestedById: r.requested_by,
  requestedAt: r.requested_at,
  decidedBy: r.decided_by_name,
  decidedAt: r.decided_at,
  rejectReason: r.reject_reason,
  purchaseOrderId: r.purchase_order_id,
  poNo: r.po_no ?? null,
  estTotal: Number(r.est_total),
  itemCount: Number(r.item_count),
  ...(items
    ? {
        items: items.map((i) => ({
          productId: i.product_id,
          sku: i.sku,
          name: i.name,
          unit: i.unit,
          quantity: Number(i.quantity),
          estUnitCost: i.est_unit_cost == null ? Number(i.cost) : Number(i.est_unit_cost),
          onHand: Number(i.on_hand ?? 0),
        })),
      }
    : {}),
});

async function load(orgId, id) {
  const r = await db.one(`${SELECT} WHERE r.id = :id AND r.org_id = :orgId`, { id, orgId });
  if (!r) throw notFound('ไม่พบใบขอซื้อ');
  const items = await db.query(
    `SELECT i.*, p.sku, p.name, p.unit, p.cost,
            (SELECT quantity FROM stock_levels sl WHERE sl.warehouse_id = :wh AND sl.product_id = i.product_id AND sl.variant_id = 0) AS on_hand
       FROM purchase_request_items i JOIN products p ON p.id = i.product_id WHERE i.request_id = :id ORDER BY i.id`,
    { id, wh: r.warehouse_id },
  );
  return map(r, items);
}

router.get(
  '/',
  canRequest,
  validate({ query: z.object({ status: z.enum(['pending', 'approved', 'rejected', 'cancelled']).optional(), limit: z.coerce.number().int().min(1).max(200).default(100) }) }),
  async (req, res) => {
    const rows = await db.query(`${SELECT} WHERE r.org_id = :orgId AND (:status IS NULL OR r.status = :status) ORDER BY r.id DESC LIMIT :limit`, {
      orgId: req.user.orgId,
      status: req.valid.query.status ?? null,
      limit: req.valid.query.limit,
    });
    res.json({ data: rows.map((r) => map(r)) });
  },
);

router.get('/:id', canRequest, validate({ params: idParam }), async (req, res) => {
  res.json({ data: await load(req.user.orgId, req.valid.params.id) });
});

router.post(
  '/',
  canRequest,
  validate({
    body: z.object({
      warehouseId: z.number().int().positive(),
      supplierId: z.number().int().positive().nullable().optional(),
      neededBy: z.iso.date().nullable().optional(),
      reason: z.string().trim().max(255).nullable().optional(),
      items: z
        .array(
          z.object({
            productId: z.number().int().positive(),
            quantity: z.coerce.number().positive().max(1_000_000),
            estUnitCost: z.coerce.number().min(0).max(99_999_999).nullable().optional(),
          }),
        )
        .min(1, 'ต้องมีอย่างน้อย 1 รายการ')
        .max(200),
    }),
  }),
  async (req, res) => {
    const b = req.valid.body;
    const { orgId, id: userId } = req.user;
    const id = await db.tx(async (conn) => {
      const [[wh]] = await conn.query('SELECT id FROM warehouses WHERE id = :id AND org_id = :orgId', { id: b.warehouseId, orgId });
      if (!wh) throw notFound('ไม่พบคลังสินค้า');
      if (b.supplierId) {
        const [[s]] = await conn.query('SELECT id FROM suppliers WHERE id = :id AND org_id = :orgId', { id: b.supplierId, orgId });
        if (!s) throw notFound('ไม่พบผู้ขาย');
      }
      const ids = [...new Set(b.items.map((i) => i.productId))];
      const [found] = await conn.query('SELECT id FROM products WHERE org_id = :orgId AND id IN (:ids)', { orgId, ids });
      if (found.length !== ids.length) throw badRequest('มีสินค้าที่ไม่พบในระบบ');
      const prNo = await nextNumber(conn, orgId, 'purchase_request', localDate());
      const [ins] = await conn.query(
        `INSERT INTO purchase_requests (org_id, pr_no, warehouse_id, supplier_id, needed_by, reason, requested_by)
         VALUES (:orgId, :prNo, :warehouseId, :supplierId, :neededBy, :reason, :userId)`,
        { orgId, prNo, warehouseId: b.warehouseId, supplierId: b.supplierId ?? null, neededBy: b.neededBy ?? null, reason: b.reason ?? null, userId },
      );
      for (const i of b.items) {
        await conn.query('INSERT INTO purchase_request_items (request_id, product_id, quantity, est_unit_cost) VALUES (:r, :p, :q, :c)', {
          r: ins.insertId,
          p: i.productId,
          q: i.quantity,
          c: i.estUnitCost ?? null,
        });
      }
      return ins.insertId;
    });
    audit(req, 'pr.create', 'purchase_request', id, { items: b.items.length });
    res.status(201).json({ data: await load(orgId, id) });
  },
);

/** Approve: a purchase order draft is made from the request (supplier and quantities can be adjusted first). */
router.post(
  '/:id/approve',
  requirePermission('purchasing:write'),
  validate({
    params: idParam,
    body: z.object({
      supplierId: z.number().int().positive().nullable().optional(),
      send: z.boolean().default(false),
      items: z
        .array(z.object({ productId: z.number().int().positive(), quantity: z.coerce.number().positive().max(1_000_000), unitCost: z.coerce.number().min(0).optional() }))
        .max(200)
        .optional(),
    }),
  }),
  async (req, res) => {
    const { id } = req.valid.params;
    const b = req.valid.body;
    const orgId = req.user.orgId;
    const poId = await db.tx(async (conn) => {
      const [[r]] = await conn.query('SELECT * FROM purchase_requests WHERE id = :id AND org_id = :orgId FOR UPDATE', { id, orgId });
      if (!r) throw notFound('ไม่พบใบขอซื้อ');
      if (r.status !== 'pending') throw conflict('ใบขอซื้อนี้ดำเนินการไปแล้ว');
      const [lines] = await conn.query('SELECT product_id, quantity, est_unit_cost FROM purchase_request_items WHERE request_id = :id', { id });
      const items = b.items?.length
        ? b.items
        : lines.map((l) => ({ productId: l.product_id, quantity: Number(l.quantity), ...(l.est_unit_cost != null ? { unitCost: Number(l.est_unit_cost) } : {}) }));
      const [[pr]] = await conn.query('SELECT pr_no FROM purchase_requests WHERE id = :id', { id });
      const po = await createPurchaseOrder(conn, req.user, {
        supplierId: b.supplierId === undefined ? r.supplier_id : b.supplierId,
        warehouseId: r.warehouse_id,
        expectedDate: r.needed_by ? localDate(r.needed_by) : undefined,
        note: `จากใบขอซื้อ ${pr.pr_no}${r.reason ? `: ${r.reason}` : ''}`.slice(0, 1000),
        source: 'manual',
        send: b.send,
        items,
      });
      await conn.query(
        `UPDATE purchase_requests SET status = 'approved', decided_by = :userId, decided_at = UTC_TIMESTAMP(), purchase_order_id = :po WHERE id = :id`,
        { userId: req.user.id, po, id },
      );
      return po;
    });
    audit(req, 'pr.approve', 'purchase_request', id, { purchaseOrderId: poId });
    res.json({ data: await load(orgId, id) });
  },
);

router.post(
  '/:id/reject',
  requirePermission('purchasing:write'),
  validate({ params: idParam, body: z.object({ reason: z.string().trim().min(1, 'ระบุเหตุผล').max(255) }) }),
  async (req, res) => {
    const { id } = req.valid.params;
    const r = await db.query(
      `UPDATE purchase_requests SET status = 'rejected', decided_by = :userId, decided_at = UTC_TIMESTAMP(), reject_reason = :reason
        WHERE id = :id AND org_id = :orgId AND status = 'pending'`,
      { id, orgId: req.user.orgId, userId: req.user.id, reason: req.valid.body.reason },
    );
    if (!r.affectedRows) throw conflict('ใบขอซื้อนี้ดำเนินการไปแล้ว หรือไม่พบ');
    audit(req, 'pr.reject', 'purchase_request', id, { reason: req.valid.body.reason });
    res.json({ data: await load(req.user.orgId, id) });
  },
);

/** The requester (or a manager) withdraws a request that is still waiting. */
router.post('/:id/cancel', canRequest, validate({ params: idParam }), async (req, res) => {
  const { id } = req.valid.params;
  const r = await db.one('SELECT requested_by, status FROM purchase_requests WHERE id = :id AND org_id = :orgId', { id, orgId: req.user.orgId });
  if (!r) throw notFound('ไม่พบใบขอซื้อ');
  if (Number(r.requested_by) !== req.user.id && !req.user.permissions.includes('purchasing:write')) throw forbidden('ยกเลิกได้เฉพาะใบขอซื้อของตัวเอง');
  if (r.status !== 'pending') throw conflict('ใบขอซื้อนี้ดำเนินการไปแล้ว');
  await db.query("UPDATE purchase_requests SET status = 'cancelled' WHERE id = :id AND status = 'pending'", { id });
  audit(req, 'pr.cancel', 'purchase_request', id);
  res.json({ data: await load(req.user.orgId, id) });
});

module.exports = { router };
