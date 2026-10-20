'use strict';

const express = require('express');
const { z } = require('zod');
const db = require('../../db/pool');
const { validate } = require('../../core/http');
const { authenticate, requirePermission } = require('../../core/auth');
const { audit } = require('../../core/audit');
const { badRequest, notFound } = require('../../core/errors');
const { promptPayPayload, isValidPromptPayId } = require('../../utils/promptpay');
const ai = require('../../integrations/ai');
const service = require('./pos.service');
const { SLIP_SCHEMA, SLIP_SYSTEM } = require('./slip');

const router = express.Router();
router.use(authenticate, requirePermission('pos:sell'));

const positiveQty = z.coerce.number().positive().max(100_000);
const money = z.coerce.number().min(0).max(99_999_999);

/* ---------------------------------------------------------------- catalog */

const CATALOG_SELECT = `
  SELECT p.id, p.sku, p.barcode, p.name, p.price, p.unit, p.image_url, p.category_id, p.vat_type,
         COALESCE(sl.quantity, 0) AS stock, c.age_restricted, c.sale_block
    FROM products p
    LEFT JOIN product_categories c ON c.id = p.category_id
    LEFT JOIN stock_levels sl ON sl.product_id = p.id AND sl.variant_id = 0 AND sl.warehouse_id = :warehouseId`;

const parseJson = (v) => {
  if (typeof v !== 'string') return v ?? null;
  try {
    return JSON.parse(v);
  } catch {
    return null;
  }
};

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
  ageRestricted: Boolean(r.age_restricted),
  saleBlock: parseJson(r.sale_block),
  units: [],
});

const mapUnit = (u, basePrice) => ({
  id: u.id,
  name: u.name,
  factor: Number(u.factor),
  barcode: u.barcode,
  price: u.price == null ? Math.round(basePrice * Number(u.factor) * 100) / 100 : Number(u.price),
});

/** Attach pack/carton units to catalog rows (one query for the whole page). */
async function withUnits(items) {
  if (!items.length) return items;
  const units = await db.query('SELECT * FROM product_units WHERE product_id IN (:ids) ORDER BY factor', { ids: items.map((i) => i.id) });
  for (const i of items) i.units = units.filter((u) => u.product_id === i.id).map((u) => mapUnit(u, i.price));
  return items;
}

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
      /** comma-separated product ids (recalling a held bill, favourites) */
      ids: z
        .string()
        .regex(/^\d+(,\d+){0,199}$/)
        .optional(),
      limit: z.coerce.number().int().min(1).max(200).default(60),
    }),
  }),
  async (req, res) => {
    const f = req.valid.query;
    const ids = f.ids ? f.ids.split(',').map(Number) : null;
    const rows = await db.query(
      `${CATALOG_SELECT}
        WHERE p.org_id = :orgId AND p.status = 'active'
          AND (:q IS NULL OR p.name LIKE :q OR p.sku LIKE :q OR p.barcode = :exact)
          AND (:categoryId IS NULL OR p.category_id = :categoryId)
          ${ids ? 'AND p.id IN (:ids)' : ''}
        ORDER BY p.name LIMIT :limit`,
      {
        ids,
        orgId: req.user.orgId,
        warehouseId: await sellingWarehouse(req),
        q: f.q ? `%${f.q}%` : null,
        exact: f.q ?? null,
        categoryId: f.categoryId ?? null,
        limit: f.limit,
      },
    );
    res.json({ data: await withUnits(rows.map(mapCatalog)) });
  },
);

/** Exact barcode / SKU lookup for scanners (scanner types the code + Enter). */
router.get('/lookup', validate({ query: z.object({ code: z.string().trim().min(1).max(64) }) }), async (req, res) => {
  const { code } = req.valid.query;
  const warehouseId = await sellingWarehouse(req);
  let row = await db.one(`${CATALOG_SELECT} WHERE p.org_id = :orgId AND p.status = 'active' AND (p.barcode = :code OR p.sku = :code) LIMIT 1`, {
    orgId: req.user.orgId,
    warehouseId,
    code,
  });
  let unitId = null;
  if (!row) {
    // A pack/carton barcode sells that unit of the product
    const unit = await db.one('SELECT id, product_id FROM product_units WHERE org_id = :orgId AND barcode = :code', { orgId: req.user.orgId, code });
    if (unit) {
      unitId = unit.id;
      row = await db.one(`${CATALOG_SELECT} WHERE p.org_id = :orgId AND p.status = 'active' AND p.id = :id`, {
        orgId: req.user.orgId,
        warehouseId,
        id: unit.product_id,
      });
    }
  }
  if (!row) throw notFound(`ไม่พบสินค้ารหัส ${code}`);
  const [item] = await withUnits([mapCatalog(row)]);
  res.json({ data: { ...item, matchedUnitId: unitId } });
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
      bankAccount: { ...settings.bankAccount, display: service.formatAccountNo(settings.bankAccount?.number) },
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
      pointsEarnBaht: z.coerce.number().min(0).max(100_000).optional(),
      pointValue: z.coerce.number().min(0).max(1000).optional(),
      cashLimit: money.optional(),
      bankAccount: z
        .object({
          bank: z.string().trim().min(1).max(60),
          type: z.string().trim().max(30).default('ออมทรัพย์'),
          number: z
            .string()
            .trim()
            .transform((v) => v.replace(/[\s-]/g, ''))
            .refine((v) => /^\d{10,15}$/.test(v), 'เลขที่บัญชีต้องเป็นตัวเลข 10-15 หลัก'),
          name: z.string().trim().min(1).max(100),
        })
        .optional(),
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

const denominations = z
  .partialRecord(z.enum(service.DENOMINATIONS.map(String)), z.coerce.number().int().min(0).max(100_000))
  .optional();

router.post(
  '/shift/close',
  validate({ body: z.object({ closingCash: money.optional(), denominations, note: z.string().trim().max(255).optional() }) }),
  async (req, res) => {
    const report = await service.closeShift(req.user, req.valid.body);
    audit(req, 'pos.shift.close', 'pos_shift', report.id, { difference: report.difference });
    res.json({ data: report });
  },
);

/** Pay-in / pay-out / move cash to the safe during a shift. */
router.post(
  '/shift/cash',
  validate({
    body: z.object({
      type: z.enum(['pay_in', 'pay_out', 'pickup']),
      amount: z.coerce.number().positive().max(10_000_000),
      reason: z.string().trim().min(1, 'กรุณาระบุเหตุผล').max(200),
    }),
  }),
  async (req, res) => {
    const out = await service.addCashMovement(req.user, req.valid.body);
    audit(req, `pos.cash.${req.valid.body.type}`, 'pos_shift', out.shift.id, { amount: req.valid.body.amount });
    res.status(201).json({ data: out.shift });
  },
);

/** X report of the open shift (or Z report of a closed shift the user may see). */
router.get('/shift/report', validate({ query: z.object({ shiftId: z.coerce.number().int().positive().optional() }) }), async (req, res) => {
  let shiftId = req.valid.query.shiftId;
  if (!shiftId) {
    const s = await service.currentShift(req.user.id);
    if (!s) throw notFound('ไม่มีกะที่เปิดอยู่');
    shiftId = s.id;
  }
  const owner = await db.one('SELECT user_id FROM pos_shifts WHERE id = :shiftId AND org_id = :orgId', { shiftId, orgId: req.user.orgId });
  if (!owner) throw notFound('ไม่พบกะ');
  if (owner.user_id !== req.user.id && !req.user.permissions.includes('pos:manage')) throw notFound('ไม่พบกะ');
  res.json({ data: await service.shiftReport(shiftId) });
});

/* ------------------------------------------------------------ held bills */

const cartItem = z.object({
  productId: z.number().int().positive(),
  unitId: z.number().int().positive().nullable().optional(),
  quantity: positiveQty,
  discount: money.optional(),
});

async function shiftBranch(req) {
  const s = await service.currentShift(req.user.id);
  if (!s) throw badRequest('กรุณาเปิดกะก่อน');
  return s.branch_id;
}

router.get('/held', async (req, res) => {
  const s = await service.currentShift(req.user.id);
  if (!s) return res.json({ data: [] });
  const rows = await db.query(
    `SELECT h.id, h.label, h.cart, h.customer_id, h.total, h.created_at, u.full_name AS user_name, c.name AS customer_name
       FROM held_bills h JOIN users u ON u.id = h.user_id LEFT JOIN customers c ON c.id = h.customer_id
      WHERE h.org_id = :orgId AND h.branch_id = :branchId ORDER BY h.id`,
    { orgId: req.user.orgId, branchId: s.branch_id },
  );
  return res.json({
    data: rows.map((r) => ({
      id: r.id,
      label: r.label,
      cart: parseJson(r.cart),
      customerId: r.customer_id,
      customerName: r.customer_name,
      total: Number(r.total),
      userName: r.user_name,
      createdAt: r.created_at,
    })),
  });
});

router.post(
  '/held',
  validate({
    body: z.object({
      label: z.string().trim().max(100).optional(),
      cart: z.object({ items: z.array(cartItem).min(1, 'ตะกร้าว่าง').max(300), discount: money.optional() }),
      customerId: z.number().int().positive().nullable().optional(),
      total: money.default(0),
    }),
  }),
  async (req, res) => {
    const b = req.valid.body;
    const branchId = await shiftBranch(req);
    const r = await db.query(
      `INSERT INTO held_bills (org_id, branch_id, user_id, label, cart, customer_id, total)
       VALUES (:orgId, :branchId, :userId, :label, :cart, :customerId, :total)`,
      {
        orgId: req.user.orgId,
        branchId,
        userId: req.user.id,
        label: b.label || null,
        cart: JSON.stringify(b.cart),
        customerId: b.customerId ?? null,
        total: b.total,
      },
    );
    res.status(201).json({ data: { id: r.insertId } });
  },
);

/** Recalling a held bill removes it (any cashier of the same branch may recall it). */
router.delete('/held/:id', validate({ params: z.object({ id: z.coerce.number().int().positive() }) }), async (req, res) => {
  const branchId = await shiftBranch(req);
  const r = await db.query('DELETE FROM held_bills WHERE id = :id AND org_id = :orgId AND branch_id = :branchId', {
    id: req.valid.params.id,
    orgId: req.user.orgId,
    branchId,
  });
  if (!r.affectedRows) throw notFound('ไม่พบบิลที่พักไว้');
  res.json({ data: { ok: true } });
});

/* -------------------------------------------------------------- members */

const mapCustomer = (c) => ({ id: c.id, name: c.name, memberNo: c.member_no, phone: c.phone, points: Number(c.points), totalSpent: Number(c.total_spent) });

router.get('/customers', validate({ query: z.object({ q: z.string().trim().min(1).max(50) }) }), async (req, res) => {
  const q = req.valid.query.q;
  const digits = q.replace(/\D/g, '');
  const rows = await db.query(
    `SELECT id, name, member_no, phone, points, total_spent FROM customers
      WHERE org_id = :orgId AND (member_no = :q OR (:digits <> '' AND REPLACE(REPLACE(phone, '-', ''), ' ', '') LIKE :phone) OR name LIKE :name)
      ORDER BY (member_no = :q) DESC, order_count DESC LIMIT 8`,
    { orgId: req.user.orgId, q, digits, phone: `%${digits}%`, name: `%${q}%` },
  );
  res.json({ data: rows.map(mapCustomer) });
});

router.post(
  '/customers',
  validate({
    body: z.object({
      name: z.string().trim().min(1, 'กรุณาใส่ชื่อ').max(191),
      phone: z
        .string()
        .trim()
        .regex(/^0\d{8,9}$/, 'เบอร์โทรไม่ถูกต้อง'),
      consentMarketing: z.boolean().default(false),
    }),
  }),
  async (req, res) => {
    const b = req.valid.body;
    const dup = await db.one('SELECT id FROM customers WHERE org_id = :orgId AND phone = :phone', { orgId: req.user.orgId, phone: b.phone });
    if (dup) throw badRequest('เบอร์นี้เป็นสมาชิกอยู่แล้ว');
    const r = await db.query(
      'INSERT INTO customers (org_id, name, phone, consent_marketing) VALUES (:orgId, :name, :phone, :consent)',
      { orgId: req.user.orgId, name: b.name, phone: b.phone, consent: b.consentMarketing ? 1 : 0 },
    );
    await db.query('UPDATE customers SET member_no = :no WHERE id = :id', { no: `M${String(r.insertId).padStart(6, '0')}`, id: r.insertId });
    audit(req, 'pos.member.create', 'customer', r.insertId);
    const c = await db.one('SELECT id, name, member_no, phone, points, total_spent FROM customers WHERE id = :id', { id: r.insertId });
    res.status(201).json({ data: mapCustomer(c) });
  },
);

/* -------------------------------------------------------------- slip check */

const SLIP_MAX_BYTES = 4 * 1024 * 1024;

/**
 * Reads a transfer/PromptPay slip photo with the AI (MiniMax by default) and checks it against the
 * bill: amount, recency and that the bank reference was never used before. Nothing is stored here;
 * the reference is claimed at checkout (unique per org) so a slip can pay only one bill.
 */
router.post(
  '/slip/verify',
  validate({
    body: z.object({
      mediaType: z.enum(['image/jpeg', 'image/png', 'image/webp']),
      data: z.string().min(100).max(Math.ceil((SLIP_MAX_BYTES * 4) / 3) + 16, 'รูปใหญ่เกิน 4 MB'),
      amount: z.coerce.number().positive().max(10_000_000),
    }),
  }),
  async (req, res) => {
    ai.requireConfig();
    const { mediaType, data, amount } = req.valid.body;
    if (!/^[A-Za-z0-9+/]+=*$/.test(data)) throw badRequest('ไฟล์ไม่ถูกต้อง (ต้องเป็น base64)');
    const { data: slip } = await ai.extractStructured({
      system: SLIP_SYSTEM,
      schema: SLIP_SCHEMA,
      toolName: 'submit_slip',
      toolDescription: 'ส่งข้อมูลที่อ่านได้จากสลิปโอนเงิน',
      content: [
        { type: 'image', source: { type: 'base64', media_type: mediaType, data } },
        { type: 'text', text: 'อ่านสลิปนี้' },
      ],
    });
    const transRef = slip.transRef ? String(slip.transRef).replace(/\s+/g, '').slice(0, 64) : null;
    const used = transRef ? await db.one('SELECT order_id FROM payment_slips WHERE org_id = :orgId AND trans_ref = :ref', { orgId: req.user.orgId, ref: transRef }) : null;
    const { promptpayId, bankAccount } = await service.getSettings(req.user.orgId);
    // Slips mask most digits (e.g. xxx-x-x5427-x): the visible digits must appear in one of the shop's numbers
    const ours = [String(promptpayId || '').replace(/\D/g, ''), String(bankAccount?.number ?? '').replace(/\D/g, '')].filter(Boolean);
    const receiverDigits = String(slip.receiverAccount ?? '').replace(/\D/g, '');
    const firstName = String(bankAccount?.name ?? '').trim().split(/\s+/)[0];
    const nameOk = firstName && slip.receiverName ? String(slip.receiverName).includes(firstName) : null;
    const digitsOk = ours.length && receiverDigits.length >= 3 ? ours.some((n) => n.includes(receiverDigits)) : null;
    const checks = {
      isSlip: slip.isSlip,
      amount: slip.amount != null && Math.abs(Number(slip.amount) - amount) < 0.01,
      reference: Boolean(transRef),
      unused: !used,
      receiver: digitsOk === true || nameOk === true ? true : digitsOk === false || nameOk === false ? false : null,
    };
    const ok = checks.isSlip && checks.amount && checks.reference && checks.unused && checks.receiver !== false;
    audit(req, 'pos.slip.verify', 'payment_slip', null, { ok, amount });
    res.json({ data: { ok, checks, transRef, amount: slip.amount, paidAt: slip.paidAt, bank: slip.bank, receiverName: slip.receiverName, confidence: slip.confidence } });
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
            unitId: z.number().int().positive().nullable().optional(),
            quantity: positiveQty,
            unitPrice: money.optional(),
            discount: money.optional(),
          }),
        )
        .min(1, 'ตะกร้าว่าง')
        .max(300),
      discount: money.optional(),
      customerId: z.number().int().positive().nullable().optional(),
      pointsUsed: z.number().int().min(0).max(10_000_000).optional(),
      ageConfirmed: z.boolean().optional(),
      payment: z
        .object({
          method: z.enum(['cash', 'promptpay', 'card', 'transfer', 'ewallet']),
          amountReceived: money.optional(),
          reference: z.string().trim().max(100).optional(),
        })
        .optional(),
      payments: z
        .array(
          z.object({
            method: z.enum(['cash', 'promptpay', 'card', 'transfer', 'ewallet']),
            amount: money,
            reference: z.string().trim().max(100).optional(),
            slipRef: z.string().trim().min(4).max(64).optional(),
          }),
        )
        .max(6)
        .optional(),
    }),
  }),
  async (req, res) => {
    const result = await service.checkout(req.user, req.valid.body);
    const methods = req.valid.body.payments?.map((p) => p.method) ?? [req.valid.body.payment?.method];
    audit(req, 'pos.checkout', 'sales_order', result.orderId, { total: result.total, methods });
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
              (SELECT CASE WHEN COUNT(DISTINCT p.method) > 1 THEN 'split' ELSE MIN(p.method) END FROM payments p WHERE p.order_id = so.id AND p.amount > 0) AS method,
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
