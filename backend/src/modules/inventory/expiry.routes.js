'use strict';

const express = require('express');
const { z } = require('zod');
const db = require('../../db/pool');
const { validate } = require('../../core/http');
const { authenticate, requirePermission } = require('../../core/auth');
const { audit } = require('../../core/audit');
const { badRequest, notFound } = require('../../core/errors');
const { applyMovement } = require('./inventory.service');
const { postJournal, ACC } = require('../accounting/ledger.service');
const { localDate } = require('../../utils/dates');
const { LOCAL_TODAY } = require('./analytics');
const { ymd } = require('./lots');
const { openStockDocument, closeStockDocument } = require('./stock-documents');

/**
 * Near-expiry board (7-Eleven fresh-food routine): see what expires soon, mark it down at the till
 * with one tap, or write it off as waste with a reason. Waste posts a stock loss to the books.
 */
const router = express.Router();
router.use(authenticate);

const r2 = (n) => Math.round(n * 100) / 100;
const WASTE_REASONS = { expired: 'หมดอายุ', damaged: 'ชำรุด/เสียหาย', lost: 'สูญหาย', other: 'อื่นๆ' };

router.get(
  '/',
  requirePermission('inventory:read'),
  validate({
    query: z.object({ warehouseId: z.coerce.number().int().positive().optional(), days: z.coerce.number().int().min(0).max(90).default(7) }),
  }),
  async (req, res) => {
    const q = req.valid.query;
    const rows = await db.query(
      `SELECT l.id, l.lot_no, l.expiry_date, l.quantity, l.unit_cost, l.markdown_pct, l.received_at, l.warehouse_id,
              DATEDIFF(l.expiry_date, ${LOCAL_TODAY}) AS days_left,
              p.id AS product_id, p.sku, p.name, p.unit, p.price, w.name AS warehouse_name
         FROM stock_lots l JOIN products p ON p.id = l.product_id JOIN warehouses w ON w.id = l.warehouse_id
        WHERE l.org_id = :orgId AND l.quantity > 0 AND l.expiry_date IS NOT NULL
          AND l.expiry_date <= ${LOCAL_TODAY} + INTERVAL :days DAY
          AND (:warehouseId IS NULL OR l.warehouse_id = :warehouseId)
        ORDER BY l.expiry_date, p.name LIMIT 500`,
      { orgId: req.user.orgId, warehouseId: q.warehouseId ?? null, days: q.days },
    );
    res.json({
      data: rows.map((r) => ({
        lotId: r.id,
        lotNo: r.lot_no,
        expiryDate: ymd(r.expiry_date),
        daysLeft: Number(r.days_left),
        quantity: Number(r.quantity),
        unitCost: Number(r.unit_cost),
        value: r2(Number(r.quantity) * Number(r.unit_cost)),
        markdownPct: Number(r.markdown_pct),
        receivedAt: r.received_at,
        warehouseId: r.warehouse_id,
        warehouseName: r.warehouse_name,
        productId: r.product_id,
        sku: r.sku,
        name: r.name,
        unit: r.unit,
        price: Number(r.price),
      })),
    });
  },
);

async function loadLot(orgId, id) {
  const lot = await db.one('SELECT l.*, p.name, p.cost FROM stock_lots l JOIN products p ON p.id = l.product_id WHERE l.id = :id AND l.org_id = :orgId', {
    id,
    orgId,
  });
  if (!lot) throw notFound('ไม่พบล็อต');
  return lot;
}

/** The till applies this % automatically while the lot is the next one to sell. 0 removes it. */
router.post(
  '/lots/:id/markdown',
  requirePermission('inventory:write'),
  validate({ params: z.object({ id: z.coerce.number().int().positive() }), body: z.object({ pct: z.coerce.number().min(0).max(90) }) }),
  async (req, res) => {
    const lot = await loadLot(req.user.orgId, req.valid.params.id);
    await db.query('UPDATE stock_lots SET markdown_pct = :pct WHERE id = :id', { pct: req.valid.body.pct, id: lot.id });
    audit(req, 'lot.markdown', 'stock_lot', lot.id, { pct: req.valid.body.pct });
    res.json({ data: { ok: true } });
  },
);

/** Write off units of a lot: 'waste' movement + Dr other expense / Cr inventory at average cost. */
router.post(
  '/lots/:id/waste',
  requirePermission('inventory:write'),
  validate({
    params: z.object({ id: z.coerce.number().int().positive() }),
    body: z.object({
      qty: z.coerce.number().positive().max(1_000_000).optional(),
      reason: z.enum(Object.keys(WASTE_REASONS)).default('expired'),
      note: z.string().trim().max(150).optional(),
    }),
  }),
  async (req, res) => {
    const orgId = req.user.orgId;
    const b = req.valid.body;
    const result = await db.tx(async (conn) => {
      const [[lot]] = await conn.query(
        'SELECT l.*, p.name, p.cost FROM stock_lots l JOIN products p ON p.id = l.product_id WHERE l.id = :id AND l.org_id = :orgId FOR UPDATE',
        { id: req.valid.params.id, orgId },
      );
      if (!lot) throw notFound('ไม่พบล็อต');
      const qty = b.qty ?? Number(lot.quantity);
      if (qty > Number(lot.quantity) + 1e-9) throw badRequest(`ล็อตนี้เหลือ ${Number(lot.quantity)}`);
      const label = WASTE_REASONS[b.reason];
      const doc = await openStockDocument(conn, {
        orgId,
        type: 'waste',
        warehouseId: lot.warehouse_id,
        reason: label,
        note: b.note ?? null,
        userId: req.user.id,
      });
      await applyMovement(conn, {
        orgId,
        warehouseId: lot.warehouse_id,
        productId: lot.product_id,
        quantity: -qty,
        type: 'waste',
        unitCost: Number(lot.cost),
        refType: `waste:${b.reason}`,
        refId: lot.id,
        stockDocumentId: doc.id,
        note: `ของเสีย: ${label}${b.note ? ` · ${b.note}` : ''}`.slice(0, 255),
        userId: req.user.id,
        allowNegative: true,
      });
      await conn.query('UPDATE stock_lots SET quantity = GREATEST(quantity - :qty, 0) WHERE id = :id', { qty, id: lot.id });
      await closeStockDocument(conn, doc.id);
      const value = r2(qty * Number(lot.cost));
      await postJournal(conn, {
        orgId,
        date: localDate(),
        description: `ตัดของเสีย (${label}) ${lot.name}`,
        refType: 'stock_lot',
        refId: lot.id,
        userId: req.user.id,
        lines: [
          { account: ACC.OTHER_EXPENSE, debit: value, memo: `ของเสีย ${label}` },
          { account: ACC.INVENTORY, credit: value },
        ],
      });
      return { lotId: lot.id, qty, value, reason: b.reason, document: doc };
    });
    audit(req, 'lot.waste', 'stock_lot', result.lotId, result);
    res.json({ data: result });
  },
);

/** Monthly waste by product and reason (feeds the ordering suggestions too). */
router.get(
  '/waste',
  requirePermission('inventory:read'),
  validate({
    query: z.object({
      month: z
        .string()
        .regex(/^\d{4}-\d{2}$/)
        .optional(),
    }),
  }),
  async (req, res) => {
    const month = req.valid.query.month ?? localDate().slice(0, 7);
    const rows = await db.query(
      `SELECT p.id, p.name, p.unit, SUBSTRING(m.ref_type, 7) AS reason, -SUM(m.quantity) AS qty, -SUM(m.quantity * COALESCE(m.unit_cost, p.cost)) AS value
         FROM stock_movements m JOIN products p ON p.id = m.product_id
        WHERE m.org_id = :orgId AND m.type = 'waste' AND DATE_FORMAT(CONVERT_TZ(m.created_at, '+00:00', :tz), '%Y-%m') = :month
        GROUP BY p.id, p.name, p.unit, reason ORDER BY value DESC`,
      { orgId: req.user.orgId, month, tz: require('../../config/env').APP_TZ_OFFSET },
    );
    const items = rows.map((r) => ({
      productId: r.id,
      name: r.name,
      unit: r.unit,
      reason: r.reason || 'other',
      reasonLabel: WASTE_REASONS[r.reason] ?? 'อื่นๆ',
      qty: Number(r.qty),
      value: r2(Number(r.value)),
    }));
    res.json({ data: { month, total: r2(items.reduce((s, i) => s + i.value, 0)), items } });
  },
);

module.exports = { router, WASTE_REASONS };
