'use strict';

const express = require('express');
const { z } = require('zod');
const db = require('../../db/pool');
const { validate } = require('../../core/http');
const { authenticate, requirePermission } = require('../../core/auth');
const { audit } = require('../../core/audit');
const { badRequest } = require('../../core/errors');
const { applyMovement, getWarehouse, getProductForUpdate, updateAverageCost } = require('./inventory.service');
const { salesStats, stockStatus, daysCover, EMPTY } = require('./analytics');
const { receiveLot } = require('./lots');

const router = express.Router();
router.use(authenticate);

const qty = z.coerce.number().refine((n) => Number.isFinite(n) && Math.abs(n) <= 1_000_000, 'จำนวนไม่ถูกต้อง');

router.get('/warehouses', requirePermission('inventory:read'), async (req, res) => {
  const rows = await db.query(
    `SELECT w.id, w.code, w.name, w.branch_id AS branchId, b.name AS branchName,
            COALESCE(SUM(sl.quantity), 0) AS totalUnits,
            COALESCE(SUM(sl.quantity * p.cost), 0) AS stockValue
       FROM warehouses w
       LEFT JOIN branches b ON b.id = w.branch_id
       LEFT JOIN stock_levels sl ON sl.warehouse_id = w.id
       LEFT JOIN products p ON p.id = sl.product_id
      WHERE w.org_id = :orgId
      GROUP BY w.id, w.code, w.name, w.branch_id, b.name
      ORDER BY w.id`,
    { orgId: req.user.orgId },
  );
  res.json({ data: rows.map((r) => ({ ...r, totalUnits: Number(r.totalUnits), stockValue: Number(r.stockValue) })) });
});

/**
 * Stock per product × warehouse (or summed across all warehouses) with selling velocity,
 * days of cover and a 14-day sales sparkline — the "single item management" view.
 */
router.get(
  '/levels',
  requirePermission('inventory:read'),
  validate({
    query: z.object({
      warehouseId: z.coerce.number().int().positive().optional(),
      q: z.string().trim().max(100).optional(),
      lowStock: z.enum(['true', 'false']).optional(),
      status: z.enum(['out', 'low', 'attention']).optional(),
      page: z.coerce.number().int().min(1).default(1),
      pageSize: z.coerce.number().int().min(1).max(200).default(50),
    }),
  }),
  async (req, res) => {
    const f = req.valid.query;
    const params = {
      orgId: req.user.orgId,
      warehouseId: f.warehouseId ?? null,
      q: f.q ? `%${f.q}%` : null,
      limit: f.pageSize,
      offset: (f.page - 1) * f.pageSize,
    };
    // A warehouse view uses that warehouse's own reorder point when set
    const reorder = f.warehouseId ? 'COALESCE(MAX(sl.reorder_point), p.reorder_point)' : 'p.reorder_point';
    const base = `
      SELECT p.id, p.sku, p.name, p.unit, p.cost, p.price, ${reorder} AS reorder_point, p.reorder_point AS product_reorder,
             MAX(sl.max_qty) AS max_qty, COALESCE(SUM(sl.quantity), 0) AS quantity
        FROM products p
        LEFT JOIN stock_levels sl ON sl.product_id = p.id AND (:warehouseId IS NULL OR sl.warehouse_id = :warehouseId)
       WHERE p.org_id = :orgId AND p.status <> 'archived'
         AND (:q IS NULL OR p.name LIKE :q OR p.sku LIKE :q OR p.barcode LIKE :q)
       GROUP BY p.id, p.sku, p.name, p.unit, p.cost, p.price, p.reorder_point`;
    const filter =
      f.status === 'out'
        ? 'WHERE x.quantity <= 0'
        : f.lowStock === 'true' || f.status === 'low' || f.status === 'attention'
          ? 'WHERE x.quantity <= x.reorder_point'
          : '';
    const rows = await db.query(`SELECT * FROM (${base}) x ${filter} ORDER BY x.quantity <= x.reorder_point DESC, x.name LIMIT :limit OFFSET :offset`, params);
    const total = await db.one(`SELECT COUNT(*) AS n FROM (${base}) x ${filter}`, params);
    const stats = await salesStats({ orgId: req.user.orgId, warehouseId: f.warehouseId ?? null, productIds: rows.map((r) => r.id) });
    res.json({
      data: rows.map((r) => {
        const st = stats.get(r.id) ?? EMPTY;
        const quantity = Number(r.quantity);
        const reorderPoint = Number(r.reorder_point);
        return {
          productId: r.id,
          sku: r.sku,
          name: r.name,
          unit: r.unit,
          cost: Number(r.cost),
          price: Number(r.price),
          reorderPoint,
          reorderOverride: f.warehouseId ? reorderPoint !== Number(r.product_reorder) : false,
          maxQty: r.max_qty == null ? null : Number(r.max_qty),
          quantity,
          value: quantity * Number(r.cost),
          avgDaily: st.avgDaily,
          sold7: st.sold7,
          daysCover: daysCover(quantity, st.avgDaily),
          lastSoldAt: st.lastSoldAt,
          spark: st.daily.length ? st.daily : Array(14).fill(0),
          status: stockStatus({ quantity, reorderPoint, avgDaily: st.avgDaily, lastSoldAt: st.lastSoldAt }),
        };
      }),
      meta: { page: f.page, pageSize: f.pageSize, total: Number(total.n) },
    });
  },
);

/** Per-warehouse reorder point / order-up-to level (null = use the product default). */
router.patch(
  '/levels',
  requirePermission('inventory:write'),
  validate({
    body: z.object({
      warehouseId: z.number().int().positive(),
      productId: z.number().int().positive(),
      reorderPoint: z.coerce.number().min(0).max(1_000_000).nullable().optional(),
      maxQty: z.coerce.number().min(0).max(1_000_000).nullable().optional(),
    }),
  }),
  async (req, res) => {
    const b = req.valid.body;
    await getWarehouse(db.pool, req.user.orgId, b.warehouseId);
    const p = await db.one('SELECT id FROM products WHERE id = :id AND org_id = :orgId', { id: b.productId, orgId: req.user.orgId });
    if (!p) throw badRequest('ไม่พบสินค้า');
    await db.query(
      `INSERT INTO stock_levels (warehouse_id, product_id, variant_id, quantity, reorder_point, max_qty)
       VALUES (:warehouseId, :productId, 0, 0, :reorderPoint, :maxQty)
       ON DUPLICATE KEY UPDATE reorder_point = IF(:setReorder = 1, VALUES(reorder_point), reorder_point),
                               max_qty = IF(:setMax = 1, VALUES(max_qty), max_qty)`,
      {
        warehouseId: b.warehouseId,
        productId: b.productId,
        reorderPoint: b.reorderPoint ?? null,
        maxQty: b.maxQty ?? null,
        setReorder: b.reorderPoint === undefined ? 0 : 1,
        setMax: b.maxQty === undefined ? 0 : 1,
      },
    );
    audit(req, 'inventory.levels', 'product', b.productId, { warehouseId: b.warehouseId, reorderPoint: b.reorderPoint, maxQty: b.maxQty });
    res.json({ data: { ok: true } });
  },
);

router.get(
  '/movements',
  requirePermission('inventory:read'),
  validate({
    query: z.object({
      productId: z.coerce.number().int().positive().optional(),
      warehouseId: z.coerce.number().int().positive().optional(),
      type: z.enum(['purchase', 'sale', 'return', 'adjustment', 'transfer_in', 'transfer_out', 'opening', 'count', 'waste', 'welfare']).optional(),
      limit: z.coerce.number().int().min(1).max(200).default(50),
    }),
  }),
  async (req, res) => {
    const f = req.valid.query;
    const rows = await db.query(
      `SELECT m.id, m.type, m.quantity, m.unit_cost, m.ref_type, m.ref_id, m.note, m.created_at,
              p.id AS product_id, p.sku, p.name AS product_name, w.name AS warehouse_name, u.full_name AS user_name
         FROM stock_movements m
         JOIN products p ON p.id = m.product_id
         JOIN warehouses w ON w.id = m.warehouse_id
         LEFT JOIN users u ON u.id = m.created_by
        WHERE m.org_id = :orgId
          AND (:productId IS NULL OR m.product_id = :productId)
          AND (:warehouseId IS NULL OR m.warehouse_id = :warehouseId)
          AND (:type IS NULL OR m.type = :type)
        ORDER BY m.created_at DESC, m.id DESC
        LIMIT :limit`,
      { orgId: req.user.orgId, productId: f.productId ?? null, warehouseId: f.warehouseId ?? null, type: f.type ?? null, limit: f.limit },
    );
    res.json({
      data: rows.map((r) => ({
        id: r.id,
        type: r.type,
        quantity: Number(r.quantity),
        unitCost: r.unit_cost == null ? null : Number(r.unit_cost),
        refType: r.ref_type,
        refId: r.ref_id,
        note: r.note,
        createdAt: r.created_at,
        productId: r.product_id,
        sku: r.sku,
        productName: r.product_name,
        warehouseName: r.warehouse_name,
        userName: r.user_name,
      })),
    });
  },
);

/** Stock count / correction: either set the counted quantity or apply a +/- delta. */
router.post(
  '/adjust',
  requirePermission('inventory:write'),
  validate({
    body: z
      .object({
        warehouseId: z.number().int().positive(),
        productId: z.number().int().positive(),
        countedQuantity: qty.refine((n) => n >= 0, 'ต้องไม่ติดลบ').optional(),
        delta: qty.optional(),
        reason: z.string().trim().min(1, 'กรุณาระบุเหตุผล').max(255),
      })
      .refine((b) => (b.countedQuantity === undefined) !== (b.delta === undefined), 'ระบุ countedQuantity หรือ delta อย่างใดอย่างหนึ่ง'),
  }),
  async (req, res) => {
    const b = req.valid.body;
    const { orgId, id: userId } = req.user;
    const result = await db.tx(async (conn) => {
      await getWarehouse(conn, orgId, b.warehouseId);
      await getProductForUpdate(conn, orgId, b.productId);
      let delta = b.delta;
      if (b.countedQuantity !== undefined) {
        const [[row]] = await conn.query(
          'SELECT quantity FROM stock_levels WHERE warehouse_id = :w AND product_id = :p AND variant_id = 0 FOR UPDATE',
          { w: b.warehouseId, p: b.productId },
        );
        delta = b.countedQuantity - Number(row?.quantity ?? 0);
      }
      if (!delta) return { unchanged: true };
      return applyMovement(conn, {
        orgId,
        warehouseId: b.warehouseId,
        productId: b.productId,
        quantity: delta,
        type: 'adjustment',
        note: b.reason,
        userId,
        // a correction may legitimately bring stock to zero but never below
      });
    });
    audit(req, 'inventory.adjust', 'product', b.productId, { warehouseId: b.warehouseId, ...result });
    res.json({ data: result });
  },
);

/** Goods receipt (without a PO): increases stock and updates the moving-average cost. */
router.post(
  '/receive',
  requirePermission('inventory:write'),
  validate({
    body: z.object({
      warehouseId: z.number().int().positive(),
      supplierId: z.number().int().positive().nullable().optional(),
      reference: z.string().trim().max(100).optional(),
      items: z
        .array(
          z.object({
            productId: z.number().int().positive(),
            quantity: qty.refine((n) => n > 0, 'จำนวนต้องมากกว่า 0'),
            unitCost: z.coerce.number().min(0).max(99_999_999).optional(),
            expiryDate: z.iso.date().optional(),
            lotNo: z.string().trim().max(40).optional(),
          }),
        )
        .min(1)
        .max(200),
    }),
  }),
  async (req, res) => {
    const b = req.valid.body;
    const { orgId, id: userId } = req.user;
    const results = await db.tx(async (conn) => {
      await getWarehouse(conn, orgId, b.warehouseId);
      const out = [];
      for (const item of b.items) {
        const product = await getProductForUpdate(conn, orgId, item.productId);
        const r = await applyMovement(conn, {
          orgId,
          warehouseId: b.warehouseId,
          productId: item.productId,
          quantity: item.quantity,
          type: 'purchase',
          unitCost: item.unitCost ?? null,
          refType: b.supplierId ? 'supplier' : null,
          refId: b.supplierId ?? null,
          note: b.reference || 'รับสินค้าเข้า',
          userId,
        });
        if (item.unitCost !== undefined) await updateAverageCost(conn, product, item.quantity, item.unitCost);
        const lotId = await receiveLot(conn, {
          orgId,
          warehouseId: b.warehouseId,
          productId: item.productId,
          qty: item.quantity,
          expiryDate: item.expiryDate,
          lotNo: item.lotNo,
          unitCost: item.unitCost ?? Number(product.cost),
        });
        out.push({ productId: item.productId, ...r, lotId });
      }
      return out;
    });
    audit(req, 'inventory.receive', 'warehouse', b.warehouseId, { items: b.items.length, reference: b.reference });
    res.status(201).json({ data: results });
  },
);

router.post(
  '/transfer',
  requirePermission('inventory:write'),
  validate({
    body: z.object({
      fromWarehouseId: z.number().int().positive(),
      toWarehouseId: z.number().int().positive(),
      note: z.string().trim().max(255).optional(),
      items: z
        .array(z.object({ productId: z.number().int().positive(), quantity: qty.refine((n) => n > 0, 'จำนวนต้องมากกว่า 0') }))
        .min(1)
        .max(200),
    }),
  }),
  async (req, res) => {
    const b = req.valid.body;
    if (b.fromWarehouseId === b.toWarehouseId) throw badRequest('คลังต้นทางและปลายทางต้องต่างกัน');
    const { orgId, id: userId } = req.user;
    await db.tx(async (conn) => {
      const from = await getWarehouse(conn, orgId, b.fromWarehouseId);
      const to = await getWarehouse(conn, orgId, b.toWarehouseId);
      for (const item of b.items) {
        await getProductForUpdate(conn, orgId, item.productId);
        const common = { orgId, productId: item.productId, userId, refType: 'transfer' };
        await applyMovement(conn, { ...common, warehouseId: from.id, quantity: -item.quantity, type: 'transfer_out', note: b.note || `โอนไป ${to.name}` });
        await applyMovement(conn, { ...common, warehouseId: to.id, quantity: item.quantity, type: 'transfer_in', note: b.note || `รับโอนจาก ${from.name}` });
      }
    });
    audit(req, 'inventory.transfer', 'warehouse', b.fromWarehouseId, { to: b.toWarehouseId, items: b.items.length });
    res.status(201).json({ data: { ok: true } });
  },
);

router.get('/suppliers', requirePermission('inventory:read'), async (req, res) => {
  const rows = await db.query('SELECT id, name, tax_id AS taxId, phone FROM suppliers WHERE org_id = :orgId ORDER BY name', {
    orgId: req.user.orgId,
  });
  res.json({ data: rows });
});

module.exports = { router };
