'use strict';

const express = require('express');
const { z } = require('zod');
const db = require('../../db/pool');
const { validate } = require('../../core/http');
const { authenticate, requirePermission } = require('../../core/auth');
const { audit } = require('../../core/audit');
const { badRequest, notFound } = require('../../core/errors');
const { promptPayPayload, isValidPromptPayId } = require('../../utils/promptpay');
const service = require('./pos.service');

const router = express.Router();
router.use(authenticate, requirePermission('pos:sell'));

const positiveQty = z.coerce.number().positive().max(100_000);
const money = z.coerce.number().min(0).max(99_999_999);

/* ---------------------------------------------------------------- catalog */

const CATALOG_SELECT = `
  SELECT p.id, p.sku, p.barcode, p.name, p.price, p.unit, p.image_url, p.category_id, p.vat_type,
         COALESCE(sl.quantity, 0) AS stock
    FROM products p
    LEFT JOIN stock_levels sl ON sl.product_id = p.id AND sl.variant_id = 0 AND sl.warehouse_id = :warehouseId`;

const mapCatalog = (r) => ({
  id: r.id,
  sku: r.sku,
  barcode: r.barcode,
  name: r.name,
  price: Number(r.price),
  unit: r.unit,
  imageUrl: r.image_url,
  categoryId: r.category_id,
  vatType: r.vat_type,
  stock: Number(r.stock),
});

async function sellingWarehouse(req) {
  const shift = await service.currentShift(req.user.id);
  const branchId = shift?.branch_id ?? req.user.branchId ?? null;
  const wh = await db.one(
    `SELECT id FROM warehouses WHERE org_id = :orgId ORDER BY (branch_id <=> :branchId) DESC, id LIMIT 1`,
    { orgId: req.user.orgId, branchId },
  );
  return wh?.id ?? 0;
}

router.get(
  '/catalog',
  validate({
    query: z.object({
      q: z.string().trim().max(100).optional(),
      categoryId: z.coerce.number().int().positive().optional(),
      limit: z.coerce.number().int().min(1).max(200).default(60),
    }),
  }),
  async (req, res) => {
    const f = req.valid.query;
    const rows = await db.query(
      `${CATALOG_SELECT}
        WHERE p.org_id = :orgId AND p.status = 'active'
          AND (:q IS NULL OR p.name LIKE :q OR p.sku LIKE :q OR p.barcode = :exact)
          AND (:categoryId IS NULL OR p.category_id = :categoryId)
        ORDER BY p.name LIMIT :limit`,
      {
        orgId: req.user.orgId,
        warehouseId: await sellingWarehouse(req),
        q: f.q ? `%${f.q}%` : null,
        exact: f.q ?? null,
        categoryId: f.categoryId ?? null,
        limit: f.limit,
      },
    );
    res.json({ data: rows.map(mapCatalog) });
  },
);

/** Exact barcode / SKU lookup for scanners (scanner types the code + Enter). */
router.get('/lookup', validate({ query: z.object({ code: z.string().trim().min(1).max(64) }) }), async (req, res) => {
  const row = await db.one(
    `${CATALOG_SELECT} WHERE p.org_id = :orgId AND p.status = 'active' AND (p.barcode = :code OR p.sku = :code) LIMIT 1`,
    { orgId: req.user.orgId, warehouseId: await sellingWarehouse(req), code: req.valid.query.code },
  );
  if (!row) throw notFound(`ไม่พบสินค้ารหัส ${req.valid.query.code}`);
  res.json({ data: mapCatalog(row) });
});

/* --------------------------------------------------------------- settings */

router.get('/settings', async (req, res) => {
  const [settings, org] = await Promise.all([
    service.getSettings(req.user.orgId),
    db.one('SELECT name, legal_name, tax_id, address, phone, vat_registered FROM organizations WHERE id = :orgId', { orgId: req.user.orgId }),
  ]);
  res.json({
    data: {
      ...settings,
      promptpayEnabled: isValidPromptPayId(settings.promptpayId),
      org: {
        name: org.name,
        legalName: org.legal_name,
        taxId: org.tax_id,
        address: org.address,
        phone: org.phone,
        vatRegistered: Boolean(org.vat_registered),
      },
    },
  });
});

router.put(
  '/settings',
  requirePermission('pos:manage'),
  validate({
    body: z.object({
      promptpayId: z
        .string()
        .trim()
        .max(20)
        .refine((v) => v === '' || isValidPromptPayId(v), 'PromptPay ต้องเป็นเบอร์มือถือ 10 หลัก หรือเลขผู้เสียภาษี 13 หลัก')
        .optional(),
      receiptFooter: z.string().trim().max(200).optional(),
      maxDiscountPct: z.coerce.number().min(0).max(100).optional(),
    }),
  }),
  async (req, res) => {
    const settings = await service.saveSettings(req.user.orgId, req.valid.body);
    audit(req, 'pos.settings.update', 'settings', 'pos', { fields: Object.keys(req.valid.body) });
    res.json({ data: settings });
  },
);

router.get('/promptpay', validate({ query: z.object({ amount: z.coerce.number().positive().max(10_000_000) }) }), async (req, res) => {
  const { promptpayId } = await service.getSettings(req.user.orgId);
  if (!isValidPromptPayId(promptpayId)) throw badRequest('ยังไม่ได้ตั้งค่าหมายเลข PromptPay ของร้าน');
  res.json({ data: { payload: promptPayPayload(promptpayId, req.valid.query.amount), amount: req.valid.query.amount } });
});

/* ----------------------------------------------------------------- shifts */

router.get('/shift', async (req, res) => {
  const s = await service.currentShift(req.user.id);
  res.json({ data: s ? service.mapShift(s, await service.shiftStats(s.id)) : null });
});

router.post(
  '/shift/open',
  validate({ body: z.object({ branchId: z.number().int().positive().optional(), openingCash: money.default(0) }) }),
  async (req, res) => {
    const branchId = req.valid.body.branchId ?? req.user.branchId;
    if (!branchId) throw badRequest('กรุณาเลือกสาขา');
    const shift = await service.openShift(req.user, branchId, req.valid.body.openingCash);
    audit(req, 'pos.shift.open', 'pos_shift', shift.id, { openingCash: req.valid.body.openingCash });
    res.status(201).json({ data: shift });
  },
);

router.post(
  '/shift/close',
  validate({ body: z.object({ closingCash: money, note: z.string().trim().max(255).optional() }) }),
  async (req, res) => {
    const shift = await service.closeShift(req.user, req.valid.body.closingCash, req.valid.body.note);
    audit(req, 'pos.shift.close', 'pos_shift', shift.id, { difference: shift.difference });
    res.json({ data: shift });
  },
);

/* ------------------------------------------------------------------ sales */

router.post(
  '/checkout',
  validate({
    body: z.object({
      items: z
        .array(
          z.object({
            productId: z.number().int().positive(),
            quantity: positiveQty,
            unitPrice: money.optional(),
            discount: money.optional(),
          }),
        )
        .min(1, 'ตะกร้าว่าง')
        .max(300),
      discount: money.optional(),
      customerId: z.number().int().positive().nullable().optional(),
      payment: z.object({
        method: z.enum(['cash', 'promptpay', 'card', 'transfer']),
        amountReceived: money.optional(),
        reference: z.string().trim().max(100).optional(),
      }),
    }),
  }),
  async (req, res) => {
    const result = await service.checkout(req.user, req.valid.body);
    audit(req, 'pos.checkout', 'sales_order', result.orderId, { total: result.total, method: req.valid.body.payment.method });
    res.status(201).json({ data: { ...(await service.getOrder(req.user.orgId, result.orderId)), change: result.change } });
  },
);

router.get(
  '/orders',
  validate({ query: z.object({ scope: z.enum(['shift', 'today']).default('shift'), limit: z.coerce.number().int().min(1).max(100).default(30) }) }),
  async (req, res) => {
    const { scope, limit } = req.valid.query;
    const shift = await service.currentShift(req.user.id);
    if (scope === 'shift' && !shift) return res.json({ data: [] });
    const rows = await db.query(
      `SELECT so.id, so.order_no, so.status, so.total, so.ordered_at, u.full_name AS cashier_name,
              (SELECT p.method FROM payments p WHERE p.order_id = so.id ORDER BY p.id LIMIT 1) AS method,
              (SELECT COALESCE(SUM(i.quantity), 0) FROM sales_order_items i WHERE i.order_id = so.id) AS items
         FROM sales_orders so LEFT JOIN users u ON u.id = so.created_by
        WHERE so.org_id = :orgId AND so.channel = 'pos'
          AND (${scope === 'shift' ? 'so.shift_id = :shiftId' : 'so.ordered_at >= UTC_TIMESTAMP() - INTERVAL 1 DAY'})
        ORDER BY so.id DESC LIMIT :limit`,
      { orgId: req.user.orgId, shiftId: shift?.id ?? 0, limit },
    );
    return res.json({
      data: rows.map((r) => ({
        id: r.id,
        orderNo: r.order_no,
        status: r.status,
        total: Number(r.total),
        orderedAt: r.ordered_at,
        cashierName: r.cashier_name,
        method: r.method,
        items: Number(r.items),
      })),
    });
  },
);

router.get('/orders/:id', validate({ params: z.object({ id: z.coerce.number().int().positive() }) }), async (req, res) => {
  res.json({ data: await service.getOrder(req.user.orgId, req.valid.params.id) });
});

router.post(
  '/orders/:id/void',
  requirePermission('pos:manage'),
  validate({ params: z.object({ id: z.coerce.number().int().positive() }), body: z.object({ reason: z.string().trim().min(1, 'กรุณาระบุเหตุผล').max(200) }) }),
  async (req, res) => {
    const order = await service.voidOrder(req.user, req.valid.params.id, req.valid.body.reason);
    audit(req, 'pos.void', 'sales_order', order.id, { reason: req.valid.body.reason, total: order.total });
    res.json({ data: order });
  },
);

module.exports = { router };
