'use strict';

const express = require('express');
const { z } = require('zod');
const db = require('../../db/pool');
const ai = require('../../integrations/ai');
const { validate } = require('../../core/http');
const { authenticate, requirePermission } = require('../../core/auth');
const { audit } = require('../../core/audit');
const { badRequest, conflict, forbidden, notFound } = require('../../core/errors');
const { applyMovement, getWarehouse, getProductForUpdate, updateAverageCost } = require('../inventory/inventory.service');
const { localDate } = require('../../utils/dates');
const { suggestions } = require('./suggest');

/**
 * Ordering, receiving and branch transfers.
 * Purchase orders only move stock (and the moving-average cost) when goods arrive; the supplier's
 * invoice is still recorded in Accounting, where VAT and payables live.
 */
const router = express.Router();
router.use(authenticate);

const idParam = z.object({ id: z.coerce.number().int().positive() });
const qty = z.coerce.number().positive().max(1_000_000);
const r2 = (n) => Math.round(n * 100) / 100;
const r3 = (n) => Math.round(n * 1000) / 1000;

/* -------------------------------------------------------------- suppliers */

const supplierBody = z.object({
  name: z.string().trim().min(1).max(191),
  taxId: z.string().trim().max(20).nullable().optional(),
  contact: z.string().trim().max(191).nullable().optional(),
  phone: z.string().trim().max(50).nullable().optional(),
  email: z
    .email()
    .max(191)
    .nullable()
    .optional()
    .or(z.literal('').transform(() => null)),
  address: z.string().trim().max(1000).nullable().optional(),
  leadTimeDays: z.coerce.number().int().min(0).max(90).default(2),
  note: z.string().trim().max(255).nullable().optional(),
  isActive: z.boolean().default(true),
});

const mapSupplier = (s) => ({
  id: s.id,
  name: s.name,
  taxId: s.tax_id,
  contact: s.contact,
  phone: s.phone,
  email: s.email,
  address: s.address,
  leadTimeDays: Number(s.lead_time_days),
  note: s.note,
  isActive: Boolean(s.is_active),
  productCount: Number(s.product_count ?? 0),
  openOrders: Number(s.open_orders ?? 0),
});

router.get('/suppliers', requirePermission('inventory:read'), async (req, res) => {
  const rows = await db.query(
    `SELECT s.*, (SELECT COUNT(*) FROM products p WHERE p.supplier_id = s.id AND p.status = 'active') AS product_count,
            (SELECT COUNT(*) FROM purchase_orders po WHERE po.supplier_id = s.id AND po.status IN ('ordered','partial')) AS open_orders
       FROM suppliers s WHERE s.org_id = :orgId ORDER BY s.is_active DESC, s.name`,
    { orgId: req.user.orgId },
  );
  res.json({ data: rows.map(mapSupplier) });
});

router.post('/suppliers', requirePermission('purchasing:write'), validate({ body: supplierBody }), async (req, res) => {
  const b = req.valid.body;
  const r = await db.query(
    `INSERT INTO suppliers (org_id, name, tax_id, contact, phone, email, address, lead_time_days, note, is_active)
     VALUES (:orgId, :name, :taxId, :contact, :phone, :email, :address, :leadTimeDays, :note, :isActive)`,
    {
      orgId: req.user.orgId,
      name: b.name,
      taxId: b.taxId || null,
      contact: b.contact || null,
      phone: b.phone || null,
      email: b.email || null,
      address: b.address || null,
      leadTimeDays: b.leadTimeDays,
      note: b.note || null,
      isActive: b.isActive ? 1 : 0,
    },
  );
  audit(req, 'supplier.create', 'supplier', r.insertId);
  res.status(201).json({ data: mapSupplier(await db.one('SELECT * FROM suppliers WHERE id = :id', { id: r.insertId })) });
});

router.patch('/suppliers/:id', requirePermission('purchasing:write'), validate({ params: idParam, body: supplierBody.partial() }), async (req, res) => {
  const s = await db.one('SELECT * FROM suppliers WHERE id = :id AND org_id = :orgId', { id: req.valid.params.id, orgId: req.user.orgId });
  if (!s) throw notFound('ไม่พบผู้ขาย');
  const sent = Object.fromEntries(Object.entries(req.valid.body).filter(([k]) => Object.hasOwn(req.body ?? {}, k)));
  const m = { ...mapSupplier(s), ...sent };
  await db.query(
    `UPDATE suppliers SET name = :name, tax_id = :taxId, contact = :contact, phone = :phone, email = :email, address = :address,
            lead_time_days = :leadTimeDays, note = :note, is_active = :isActive WHERE id = :id`,
    {
      id: s.id,
      name: m.name,
      taxId: m.taxId || null,
      contact: m.contact || null,
      phone: m.phone || null,
      email: m.email || null,
      address: m.address || null,
      leadTimeDays: m.leadTimeDays,
      note: m.note || null,
      isActive: m.isActive ? 1 : 0,
    },
  );
  audit(req, 'supplier.update', 'supplier', s.id, { fields: Object.keys(sent) });
  res.json({ data: mapSupplier(await db.one('SELECT * FROM suppliers WHERE id = :id', { id: s.id })) });
});

/* ------------------------------------------------------------ suggestions */

router.get(
  '/suggestions',
  requirePermission('inventory:read'),
  validate({
    query: z.object({
      warehouseId: z.coerce.number().int().positive(),
      supplierId: z.coerce.number().int().min(0).optional(),
      all: z.enum(['true', 'false']).optional(),
    }),
  }),
  async (req, res) => {
    const q = req.valid.query;
    await getWarehouse(db.pool, req.user.orgId, q.warehouseId);
    const rows = await suggestions({ orgId: req.user.orgId, warehouseId: q.warehouseId, supplierId: q.supplierId ?? null, onlyNeeded: q.all !== 'true' });
    res.json({ data: rows });
  },
);

const AI_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['summary', 'items'],
  properties: {
    summary: { type: 'string', description: 'ภาษาไทย 1-2 ประโยค: ช่วงนี้มีปัจจัยอะไรที่ทำให้ยอดขายเปลี่ยน' },
    items: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['productId', 'factor', 'reason'],
        properties: {
          productId: { type: 'integer' },
          factor: { type: 'number', description: 'ตัวคูณยอดสั่ง 0.5 ถึง 2.0 (1 = ไม่ปรับ)' },
          reason: { type: 'string', description: 'เหตุผลสั้นๆ ภาษาไทย ไม่เกิน 60 ตัวอักษร' },
        },
      },
    },
  },
};

/**
 * "ให้ AI ปรับตามเทศกาล": the AI (MiniMax by default) looks at the date, Thai holidays/paydays
 * and each item's category and velocity, and returns a multiplier per item. Suggestions only;
 * the order screen keeps +/- buttons and nothing is saved here.
 */
router.post(
  '/suggestions/ai',
  requirePermission('purchasing:write'),
  validate({
    body: z.object({
      warehouseId: z.number().int().positive(),
      items: z
        .array(z.object({ productId: z.number().int().positive(), suggested: z.coerce.number().min(0) }))
        .min(1)
        .max(80),
    }),
  }),
  async (req, res) => {
    ai.requireConfig();
    const b = req.valid.body;
    const wh = await getWarehouse(db.pool, req.user.orgId, b.warehouseId);
    const rows = await suggestions({ orgId: req.user.orgId, warehouseId: b.warehouseId, onlyNeeded: false });
    const byId = new Map(rows.map((r) => [r.productId, r]));
    const lines = b.items
      .map((i) => byId.get(i.productId) && { ...byId.get(i.productId), suggested: i.suggested })
      .filter(Boolean)
      .map(
        (r) =>
          `${r.productId} | ${r.name} | หมวด ${r.categoryName ?? '-'} | ขาย/วัน ${r.avgDaily} | ขาย 7 วัน ${r.sold7} | คงเหลือ ${r.onHand} | แนะนำ ${r.suggested}`,
      );
    const today = localDate();
    const { data } = await ai.extractStructured({
      system: `คุณเป็นผู้ช่วยสั่งสินค้าของร้านค้าปลีกในไทยแบบ 7-Eleven
- พิจารณาวันที่ วันหยุดนักขัตฤกษ์/เทศกาลไทย (เช่น สงกรานต์ ลอยกระทง ปีใหม่ ตรุษจีน) วันเงินเดือนออก (25-1 ของเดือน) ฤดูกาล (ร้อน ฝน หนาว) และช่วงเปิด-ปิดเทอม ในช่วง 7-10 วันข้างหน้า
- ปรับเฉพาะสินค้าที่ได้รับผลจริง สินค้าทั่วไปให้ factor = 1
- ห้ามเกิน 0.5-2.0 และเหตุผลต้องสั้น อ่านง่าย`,
      schema: AI_SCHEMA,
      toolName: 'submit_order_adjustments',
      toolDescription: 'ส่งตัวคูณยอดสั่งรายสินค้า',
      content: [{ type: 'text', text: `วันนี้ ${today} · ร้าน/คลัง: ${wh.name}\nสินค้า (id | ชื่อ | หมวด | สถิติ):\n${lines.join('\n')}` }],
    });
    const items = data.items
      .filter((i) => byId.has(i.productId))
      .map((i) => {
        const r = byId.get(i.productId);
        const factor = Math.min(Math.max(Number(i.factor) || 1, 0.5), 2);
        const asked = b.items.find((x) => x.productId === i.productId)?.suggested ?? r.suggested;
        const pack = r.packSize || 1;
        return { productId: i.productId, factor, reason: String(i.reason).slice(0, 80), quantity: Math.ceil((asked * factor) / pack - 1e-9) * pack };
      });
    audit(req, 'purchasing.ai_adjust', 'warehouse', b.warehouseId, { items: items.length });
    res.json({ data: { summary: data.summary, items } });
  },
);

/* --------------------------------------------------------- purchase orders */

async function loadPo(orgId, id, conn = null) {
  const q = conn ? (sql, p) => conn.query(sql, p).then(([rows]) => rows[0]) : db.one;
  const po = await q(
    `SELECT po.*, s.name AS supplier_name, s.phone AS supplier_phone, s.lead_time_days, w.name AS warehouse_name, u.full_name AS created_by_name
       FROM purchase_orders po
       LEFT JOIN suppliers s ON s.id = po.supplier_id
       LEFT JOIN warehouses w ON w.id = po.warehouse_id
       LEFT JOIN users u ON u.id = po.created_by
      WHERE po.id = :id AND po.org_id = :orgId ${conn ? 'FOR UPDATE' : ''}`,
    { id, orgId },
  );
  if (!po) throw notFound('ไม่พบใบสั่งซื้อ');
  return po;
}

async function poItems(poId) {
  const rows = await db.query(
    `SELECT i.product_id, i.quantity, i.received_qty, i.unit_cost, p.sku, p.barcode, p.name, p.unit
       FROM purchase_order_items i JOIN products p ON p.id = i.product_id WHERE i.po_id = :poId ORDER BY i.id`,
    { poId },
  );
  return rows.map((r) => ({
    productId: r.product_id,
    sku: r.sku,
    barcode: r.barcode,
    name: r.name,
    unit: r.unit,
    quantity: Number(r.quantity),
    receivedQty: Number(r.received_qty),
    unitCost: Number(r.unit_cost),
    lineTotal: r2(Number(r.quantity) * Number(r.unit_cost)),
  }));
}

const mapPo = (po, items = undefined) => ({
  id: po.id,
  poNo: po.po_no,
  status: po.status,
  source: po.source,
  supplierId: po.supplier_id,
  supplierName: po.supplier_name,
  supplierPhone: po.supplier_phone ?? null,
  warehouseId: po.warehouse_id,
  warehouseName: po.warehouse_name,
  orderDate: po.order_date instanceof Date ? po.order_date.toISOString().slice(0, 10) : po.order_date,
  expectedDate: po.expected_date instanceof Date ? po.expected_date.toISOString().slice(0, 10) : po.expected_date,
  total: Number(po.total),
  note: po.note,
  sentAt: po.sent_at,
  receivedAt: po.received_at,
  createdBy: po.created_by_name ?? null,
  createdAt: po.created_at,
  ...(po.item_count !== undefined ? { itemCount: Number(po.item_count), receivedPct: Number(po.received_pct ?? 0) } : {}),
  ...(items ? { items } : {}),
});

router.get(
  '/orders',
  requirePermission('inventory:read'),
  validate({ query: z.object({ status: z.enum(['draft', 'ordered', 'partial', 'received', 'cancelled', 'open']).optional() }) }),
  async (req, res) => {
    const st = req.valid.query.status;
    const rows = await db.query(
      `SELECT po.*, s.name AS supplier_name, w.name AS warehouse_name, u.full_name AS created_by_name,
              (SELECT COUNT(*) FROM purchase_order_items i WHERE i.po_id = po.id) AS item_count,
              (SELECT ROUND(100 * SUM(LEAST(i.received_qty, i.quantity)) / NULLIF(SUM(i.quantity), 0)) FROM purchase_order_items i WHERE i.po_id = po.id) AS received_pct
         FROM purchase_orders po
         LEFT JOIN suppliers s ON s.id = po.supplier_id
         LEFT JOIN warehouses w ON w.id = po.warehouse_id
         LEFT JOIN users u ON u.id = po.created_by
        WHERE po.org_id = :orgId
          AND (${st === 'open' ? "po.status IN ('draft','ordered','partial')" : ':status IS NULL OR po.status = :status'})
        ORDER BY FIELD(po.status, 'ordered', 'partial', 'draft', 'received', 'cancelled'), po.id DESC LIMIT 100`,
      { orgId: req.user.orgId, status: st && st !== 'open' ? st : null },
    );
    res.json({ data: rows.map((r) => mapPo(r)) });
  },
);

router.get('/orders/:id', requirePermission('inventory:read'), validate({ params: idParam }), async (req, res) => {
  const po = await loadPo(req.user.orgId, req.valid.params.id);
  res.json({ data: mapPo(po, await poItems(po.id)) });
});

const poLine = z.object({ productId: z.number().int().positive(), quantity: qty, unitCost: z.coerce.number().min(0).max(99_999_999).optional() });

async function writeLines(conn, orgId, poId, lines) {
  await conn.query('DELETE FROM purchase_order_items WHERE po_id = :poId', { poId });
  let total = 0;
  for (const l of lines) {
    const p = await getProductForUpdate(conn, orgId, l.productId);
    const cost = l.unitCost ?? Number(p.cost);
    total += l.quantity * cost;
    await conn.query('INSERT INTO purchase_order_items (po_id, product_id, quantity, unit_cost) VALUES (:poId, :productId, :quantity, :cost)', {
      poId,
      productId: l.productId,
      quantity: l.quantity,
      cost,
    });
  }
  await conn.query('UPDATE purchase_orders SET subtotal = :t, total = :t WHERE id = :poId', { t: r2(total), poId });
}

router.post(
  '/orders',
  requirePermission('purchasing:write'),
  validate({
    body: z.object({
      supplierId: z.number().int().positive().nullable().optional(),
      warehouseId: z.number().int().positive(),
      expectedDate: z.iso.date().optional(),
      note: z.string().trim().max(1000).optional(),
      source: z.enum(['manual', 'suggestion']).default('manual'),
      send: z.boolean().default(false),
      items: z.array(poLine).min(1, 'ยังไม่มีรายการสั่ง').max(300),
    }),
  }),
  async (req, res) => {
    const b = req.valid.body;
    const orgId = req.user.orgId;
    const id = await db.tx(async (conn) => {
      await getWarehouse(conn, orgId, b.warehouseId);
      let lead = 2;
      if (b.supplierId) {
        const [[s]] = await conn.query('SELECT lead_time_days FROM suppliers WHERE id = :id AND org_id = :orgId', { id: b.supplierId, orgId });
        if (!s) throw badRequest('ไม่พบผู้ขาย');
        lead = Number(s.lead_time_days);
      }
      const today = localDate();
      const expected = b.expectedDate ?? localDate(new Date(Date.now() + lead * 86_400_000));
      const [ins] = await conn.query(
        `INSERT INTO purchase_orders (org_id, supplier_id, warehouse_id, po_no, status, source, order_date, expected_date, note, sent_at, created_by)
         VALUES (:orgId, :supplierId, :warehouseId, :tmp, :status, :source, :today, :expected, :note, IF(:send = 1, UTC_TIMESTAMP(), NULL), :userId)`,
        {
          orgId,
          supplierId: b.supplierId ?? null,
          warehouseId: b.warehouseId,
          tmp: `TMP-${Date.now()}-${req.user.id}`,
          status: b.send ? 'ordered' : 'draft',
          source: b.source,
          today,
          expected,
          note: b.note ?? null,
          send: b.send ? 1 : 0,
          userId: req.user.id,
        },
      );
      await conn.query('UPDATE purchase_orders SET po_no = :no WHERE id = :id', { no: `PO${String(ins.insertId).padStart(6, '0')}`, id: ins.insertId });
      await writeLines(conn, orgId, ins.insertId, b.items);
      return ins.insertId;
    });
    audit(req, 'po.create', 'purchase_order', id, { items: b.items.length, source: b.source, sent: b.send });
    const po = await loadPo(orgId, id);
    res.status(201).json({ data: mapPo(po, await poItems(id)) });
  },
);

/** Edit a draft (lines, dates, note). */
router.patch(
  '/orders/:id',
  requirePermission('purchasing:write'),
  validate({
    params: idParam,
    body: z.object({
      expectedDate: z.iso.date().optional(),
      note: z.string().trim().max(1000).nullable().optional(),
      items: z.array(poLine).min(1).max(300).optional(),
    }),
  }),
  async (req, res) => {
    const orgId = req.user.orgId;
    await db.tx(async (conn) => {
      const po = await loadPo(orgId, req.valid.params.id, conn);
      if (po.status !== 'draft') throw conflict('แก้ได้เฉพาะใบสั่งซื้อที่ยังไม่ส่ง');
      const b = req.valid.body;
      await conn.query('UPDATE purchase_orders SET expected_date = COALESCE(:expected, expected_date), note = IF(:setNote = 1, :note, note) WHERE id = :id', {
        id: po.id,
        expected: b.expectedDate ?? null,
        setNote: b.note === undefined ? 0 : 1,
        note: b.note ?? null,
      });
      if (b.items) await writeLines(conn, orgId, po.id, b.items);
    });
    const po = await loadPo(orgId, req.valid.params.id);
    res.json({ data: mapPo(po, await poItems(po.id)) });
  },
);

router.post('/orders/:id/send', requirePermission('purchasing:write'), validate({ params: idParam }), async (req, res) => {
  const po = await loadPo(req.user.orgId, req.valid.params.id);
  if (po.status !== 'draft') throw conflict('ใบสั่งซื้อนี้ส่งไปแล้ว');
  await db.query("UPDATE purchase_orders SET status = 'ordered', sent_at = UTC_TIMESTAMP() WHERE id = :id", { id: po.id });
  audit(req, 'po.send', 'purchase_order', po.id);
  res.json({ data: mapPo({ ...po, status: 'ordered' }) });
});

router.post('/orders/:id/cancel', requirePermission('purchasing:write'), validate({ params: idParam }), async (req, res) => {
  const po = await loadPo(req.user.orgId, req.valid.params.id);
  if (po.status !== 'draft' && po.status !== 'ordered') throw conflict('ยกเลิกได้เฉพาะใบที่ยังไม่รับของ');
  await db.query("UPDATE purchase_orders SET status = 'cancelled' WHERE id = :id", { id: po.id });
  audit(req, 'po.cancel', 'purchase_order', po.id);
  res.json({ data: { ok: true } });
});

/**
 * Receive goods against the PO (scan or type quantities). Partial deliveries keep the PO open;
 * receiving more than ordered needs inventory:approve. Cost follows the PO line price.
 */
router.post(
  '/orders/:id/receive',
  requirePermission('purchasing:write'),
  validate({
    params: idParam,
    body: z.object({
      items: z
        .array(
          z.object({
            productId: z.number().int().positive(),
            quantity: z.coerce.number().min(0).max(1_000_000),
            unitCost: z.coerce.number().min(0).optional(),
          }),
        )
        .min(1)
        .max(300),
      note: z.string().trim().max(200).optional(),
      close: z.boolean().default(false),
    }),
  }),
  async (req, res) => {
    const orgId = req.user.orgId;
    const b = req.valid.body;
    const result = await db.tx(async (conn) => {
      const po = await loadPo(orgId, req.valid.params.id, conn);
      if (po.status !== 'ordered' && po.status !== 'partial') throw conflict(po.status === 'draft' ? 'ต้องส่งใบสั่งซื้อก่อนรับของ' : 'ใบสั่งซื้อนี้ปิดแล้ว');
      const [lines] = await conn.query('SELECT * FROM purchase_order_items WHERE po_id = :id FOR UPDATE', { id: po.id });
      let received = 0;
      for (const item of b.items) {
        if (!item.quantity) continue;
        const line = lines.find((l) => l.product_id === item.productId);
        if (!line) throw badRequest(`สินค้า #${item.productId} ไม่อยู่ในใบสั่งซื้อนี้`);
        const after = Number(line.received_qty) + item.quantity;
        if (after > Number(line.quantity) + 1e-9 && !req.user.permissions.includes('inventory:approve')) {
          throw forbidden('รับเกินจำนวนที่สั่ง ต้องให้ผู้จัดการอนุมัติ');
        }
        const cost = item.unitCost ?? Number(line.unit_cost);
        const product = await getProductForUpdate(conn, orgId, item.productId);
        await applyMovement(conn, {
          orgId,
          warehouseId: po.warehouse_id,
          productId: item.productId,
          quantity: item.quantity,
          type: 'purchase',
          unitCost: cost,
          refType: 'purchase_order',
          refId: po.id,
          note: `รับของ ${po.po_no}${b.note ? `: ${b.note}` : ''}`.slice(0, 255),
          userId: req.user.id,
        });
        await updateAverageCost(conn, product, item.quantity, cost);
        await conn.query('UPDATE purchase_order_items SET received_qty = :after WHERE id = :id', { after: r3(after), id: line.id });
        line.received_qty = after;
        received += 1;
      }
      if (!received && !b.close) throw badRequest('ยังไม่ได้ใส่จำนวนที่รับ');
      const complete = lines.every((l) => Number(l.received_qty) + 1e-9 >= Number(l.quantity));
      const status = complete || b.close ? 'received' : 'partial';
      await conn.query(`UPDATE purchase_orders SET status = :status, received_at = IF(:status = 'received', UTC_TIMESTAMP(), received_at) WHERE id = :id`, {
        status,
        id: po.id,
      });
      return { id: po.id, status, received };
    });
    audit(req, 'po.receive', 'purchase_order', result.id, result);
    const po = await loadPo(orgId, result.id);
    res.json({ data: mapPo(po, await poItems(po.id)) });
  },
);

/* --------------------------------------------------------------- transfers */

async function loadTransfer(orgId, id, conn = null) {
  const q = conn ? (sql, p) => conn.query(sql, p).then(([rows]) => rows[0]) : db.one;
  const t = await q(
    `SELECT t.*, f.name AS from_name, w.name AS to_name, u.full_name AS created_by_name, r.full_name AS received_by_name
       FROM stock_transfers t JOIN warehouses f ON f.id = t.from_warehouse_id JOIN warehouses w ON w.id = t.to_warehouse_id
       JOIN users u ON u.id = t.created_by LEFT JOIN users r ON r.id = t.received_by
      WHERE t.id = :id AND t.org_id = :orgId ${conn ? 'FOR UPDATE' : ''}`,
    { id, orgId },
  );
  if (!t) throw notFound('ไม่พบใบโอน');
  return t;
}

async function transferItems(id) {
  const rows = await db.query(
    `SELECT i.product_id, i.qty_sent, i.qty_received, p.sku, p.barcode, p.name, p.unit
       FROM stock_transfer_items i JOIN products p ON p.id = i.product_id WHERE i.transfer_id = :id ORDER BY p.name`,
    { id },
  );
  return rows.map((r) => ({
    productId: r.product_id,
    sku: r.sku,
    barcode: r.barcode,
    name: r.name,
    unit: r.unit,
    qtySent: Number(r.qty_sent),
    qtyReceived: r.qty_received == null ? null : Number(r.qty_received),
  }));
}

const mapTransfer = (t, items = undefined) => ({
  id: t.id,
  transferNo: t.transfer_no,
  status: t.status,
  fromWarehouseId: t.from_warehouse_id,
  fromName: t.from_name,
  toWarehouseId: t.to_warehouse_id,
  toName: t.to_name,
  note: t.note,
  createdBy: t.created_by_name,
  receivedBy: t.received_by_name ?? null,
  shippedAt: t.shipped_at,
  receivedAt: t.received_at,
  ...(t.item_count !== undefined ? { itemCount: Number(t.item_count), shortage: Number(t.shortage ?? 0) } : {}),
  ...(items ? { items } : {}),
});

router.get('/transfers', requirePermission('inventory:read'), async (req, res) => {
  const rows = await db.query(
    `SELECT t.*, f.name AS from_name, w.name AS to_name, u.full_name AS created_by_name, r.full_name AS received_by_name,
            (SELECT COUNT(*) FROM stock_transfer_items i WHERE i.transfer_id = t.id) AS item_count,
            (SELECT COALESCE(SUM(i.qty_sent - i.qty_received), 0) FROM stock_transfer_items i WHERE i.transfer_id = t.id AND i.qty_received IS NOT NULL) AS shortage
       FROM stock_transfers t JOIN warehouses f ON f.id = t.from_warehouse_id JOIN warehouses w ON w.id = t.to_warehouse_id
       JOIN users u ON u.id = t.created_by LEFT JOIN users r ON r.id = t.received_by
      WHERE t.org_id = :orgId ORDER BY FIELD(t.status, 'in_transit', 'received', 'cancelled'), t.id DESC LIMIT 100`,
    { orgId: req.user.orgId },
  );
  res.json({ data: rows.map((r) => mapTransfer(r)) });
});

router.get('/transfers/:id', requirePermission('inventory:read'), validate({ params: idParam }), async (req, res) => {
  const t = await loadTransfer(req.user.orgId, req.valid.params.id);
  res.json({ data: mapTransfer(t, await transferItems(t.id)) });
});

/** Ship: stock leaves the source now and is "in transit" until the destination scans it in. */
router.post(
  '/transfers',
  requirePermission('purchasing:write'),
  validate({
    body: z.object({
      fromWarehouseId: z.number().int().positive(),
      toWarehouseId: z.number().int().positive(),
      note: z.string().trim().max(255).optional(),
      items: z
        .array(z.object({ productId: z.number().int().positive(), quantity: qty }))
        .min(1)
        .max(300),
    }),
  }),
  async (req, res) => {
    const b = req.valid.body;
    const orgId = req.user.orgId;
    if (b.fromWarehouseId === b.toWarehouseId) throw badRequest('คลังต้นทางและปลายทางต้องต่างกัน');
    const id = await db.tx(async (conn) => {
      const from = await getWarehouse(conn, orgId, b.fromWarehouseId);
      const to = await getWarehouse(conn, orgId, b.toWarehouseId);
      const [ins] = await conn.query(
        `INSERT INTO stock_transfers (org_id, transfer_no, from_warehouse_id, to_warehouse_id, note, created_by, shipped_at)
         VALUES (:orgId, :tmp, :from, :to, :note, :userId, UTC_TIMESTAMP())`,
        { orgId, tmp: `TMP-${Date.now()}-${req.user.id}`, from: from.id, to: to.id, note: b.note ?? null, userId: req.user.id },
      );
      const no = `TR${String(ins.insertId).padStart(6, '0')}`;
      await conn.query('UPDATE stock_transfers SET transfer_no = :no WHERE id = :id', { no, id: ins.insertId });
      for (const item of b.items) {
        await getProductForUpdate(conn, orgId, item.productId);
        await applyMovement(conn, {
          orgId,
          warehouseId: from.id,
          productId: item.productId,
          quantity: -item.quantity,
          type: 'transfer_out',
          refType: 'stock_transfer',
          refId: ins.insertId,
          note: `${no} ส่งไป ${to.name}`,
          userId: req.user.id,
        });
        await conn.query('INSERT INTO stock_transfer_items (transfer_id, product_id, qty_sent) VALUES (:id, :productId, :q)', {
          id: ins.insertId,
          productId: item.productId,
          q: item.quantity,
        });
      }
      return ins.insertId;
    });
    audit(req, 'transfer.ship', 'stock_transfer', id, { items: b.items.length });
    const t = await loadTransfer(orgId, id);
    res.status(201).json({ data: mapTransfer(t, await transferItems(id)) });
  },
);

/** Destination receives what actually arrived; any shortage stays recorded on the transfer. */
router.post(
  '/transfers/:id/receive',
  requirePermission('inventory:write'),
  validate({
    params: idParam,
    body: z.object({ items: z.array(z.object({ productId: z.number().int().positive(), quantity: z.coerce.number().min(0).max(1_000_000) })).max(300) }),
  }),
  async (req, res) => {
    const orgId = req.user.orgId;
    await db.tx(async (conn) => {
      const t = await loadTransfer(orgId, req.valid.params.id, conn);
      if (t.status !== 'in_transit') throw conflict('ใบโอนนี้ปิดแล้ว');
      const [lines] = await conn.query('SELECT * FROM stock_transfer_items WHERE transfer_id = :id FOR UPDATE', { id: t.id });
      for (const line of lines) {
        const got = req.valid.body.items.find((i) => i.productId === line.product_id);
        const quantity = got ? got.quantity : Number(line.qty_sent); // not listed = arrived complete
        if (quantity > Number(line.qty_sent) + 1e-9) throw badRequest('รับเกินจำนวนที่ส่งมา');
        if (quantity > 0) {
          await applyMovement(conn, {
            orgId,
            warehouseId: t.to_warehouse_id,
            productId: line.product_id,
            quantity,
            type: 'transfer_in',
            refType: 'stock_transfer',
            refId: t.id,
            note: `${t.transfer_no} รับจาก ${t.from_name}${quantity < Number(line.qty_sent) ? ` (ขาด ${r3(Number(line.qty_sent) - quantity)})` : ''}`,
            userId: req.user.id,
          });
        }
        await conn.query('UPDATE stock_transfer_items SET qty_received = :q WHERE transfer_id = :id AND product_id = :p', {
          q: quantity,
          id: t.id,
          p: line.product_id,
        });
      }
      await conn.query("UPDATE stock_transfers SET status = 'received', received_by = :userId, received_at = UTC_TIMESTAMP() WHERE id = :id", {
        userId: req.user.id,
        id: t.id,
      });
    });
    audit(req, 'transfer.receive', 'stock_transfer', req.valid.params.id);
    const t = await loadTransfer(orgId, req.valid.params.id);
    res.json({ data: mapTransfer(t, await transferItems(t.id)) });
  },
);

/** Cancel while in transit: the goods go back to the source warehouse. */
router.post('/transfers/:id/cancel', requirePermission('purchasing:write'), validate({ params: idParam }), async (req, res) => {
  const orgId = req.user.orgId;
  await db.tx(async (conn) => {
    const t = await loadTransfer(orgId, req.valid.params.id, conn);
    if (t.status !== 'in_transit') throw conflict('ใบโอนนี้ปิดแล้ว');
    const [lines] = await conn.query('SELECT * FROM stock_transfer_items WHERE transfer_id = :id', { id: t.id });
    for (const line of lines) {
      await applyMovement(conn, {
        orgId,
        warehouseId: t.from_warehouse_id,
        productId: line.product_id,
        quantity: Number(line.qty_sent),
        type: 'transfer_in',
        refType: 'stock_transfer',
        refId: t.id,
        note: `${t.transfer_no} ยกเลิก คืนเข้าคลัง`,
        userId: req.user.id,
      });
    }
    await conn.query("UPDATE stock_transfers SET status = 'cancelled' WHERE id = :id", { id: t.id });
  });
  audit(req, 'transfer.cancel', 'stock_transfer', req.valid.params.id);
  res.json({ data: { ok: true } });
});

module.exports = { router };
