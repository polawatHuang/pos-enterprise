'use strict';

/** Manage POS promotions (mounted under /api/pos/promotions, behind pos:sell). */
const express = require('express');
const { z } = require('zod');
const db = require('../../db/pool');
const { validate } = require('../../core/http');
const { requirePermission } = require('../../core/auth');
const { audit } = require('../../core/audit');
const { badRequest, conflict, forbidden, notFound } = require('../../core/errors');
const promotions = require('./promotions');

const router = express.Router();

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'เวลาต้องเป็น HH:MM');
const slot = z.object({
  qty: z.number().int().min(1).max(99).default(1),
  productIds: z.array(z.number().int().positive()).max(500).default([]),
  categoryIds: z.array(z.number().int().positive()).max(100).default([]),
});
const body = z
  .object({
    name: z.string().trim().min(1, 'ใส่ชื่อโปรโมชั่น').max(191),
    kind: z.enum(['time_discount', 'bundle', 'multi_buy']),
    discountType: z.enum(['percent', 'amount_off', 'set_price']),
    value: z.number().positive('ใส่มูลค่าส่วนลด').max(1_000_000),
    startsOn: z.iso.date().nullable().default(null),
    endsOn: z.iso.date().nullable().default(null),
    daysMask: z.number().int().min(1, 'เลือกอย่างน้อย 1 วัน').max(127).default(127),
    timeFrom: hhmm.nullable().default(null),
    timeTo: hhmm.nullable().default(null),
    branchIds: z.array(z.number().int().positive()).max(200).default([]),
    slots: z.array(slot).min(1).max(2),
    isActive: z.boolean().default(true),
  })
  .superRefine((b, ctx) => {
    const issue = (message, path) => ctx.addIssue({ code: 'custom', message, path });
    if (b.discountType === 'percent' && b.value > 100) issue('ส่วนลดเปอร์เซ็นต์ต้องไม่เกิน 100', ['value']);
    if (b.startsOn && b.endsOn && b.endsOn < b.startsOn) issue('วันสิ้นสุดต้องไม่ก่อนวันเริ่ม', ['endsOn']);
    if (!b.timeFrom !== !b.timeTo) issue('ใส่เวลาเริ่มและเวลาสิ้นสุดให้ครบ', ['timeTo']);
    if (b.timeFrom && b.timeFrom === b.timeTo) issue('เวลาเริ่มและสิ้นสุดต้องไม่เท่ากัน', ['timeTo']);
    const need = b.kind === 'bundle' ? 2 : 1;
    if (b.slots.length !== need) issue(b.kind === 'bundle' ? 'ซื้อคู่ต้องมีสินค้า 2 ฝั่ง (A และ B)' : 'ระบุกลุ่มสินค้า 1 กลุ่ม', ['slots']);
    b.slots.forEach((s, i) => {
      if (!s.productIds.length && !s.categoryIds.length) issue('เลือกสินค้าหรือหมวดอย่างน้อย 1 รายการ', ['slots', i]);
    });
    if (b.kind === 'multi_buy' && (b.slots[0]?.qty ?? 0) < 2) issue('ซื้อหลายชิ้นต้องกำหนดอย่างน้อย 2 ชิ้น', ['slots', 0, 'qty']);
    if (b.kind === 'time_discount' && b.slots[0]) b.slots[0].qty = 1;
  });

/**
 * Branch managers (a user tied to a branch, without settings:manage) run promotions for their own
 * branch only; owners/admins choose any branches, or none = every branch.
 */
function allowedBranches(user, branchIds) {
  if (user.permissions.includes('settings:manage') || !user.branchId) return branchIds;
  if (!branchIds.length) return [user.branchId];
  if (branchIds.some((id) => id !== user.branchId)) throw forbidden('สร้าง/แก้โปรโมชั่นได้เฉพาะสาขาของคุณ');
  return branchIds;
}
function canEdit(user, promo) {
  if (user.permissions.includes('settings:manage') || !user.branchId) return true;
  return promo.branches.length > 0 && promo.branches.every((id) => id === user.branchId);
}

async function validateRefs(conn, orgId, b) {
  const pids = [...new Set(b.slots.flatMap((s) => s.productIds))];
  const cids = [...new Set(b.slots.flatMap((s) => s.categoryIds))];
  if (pids.length) {
    const [[r]] = await conn.query('SELECT COUNT(*) AS n FROM products WHERE org_id = :orgId AND id IN (:pids)', { orgId, pids });
    if (Number(r.n) !== pids.length) throw badRequest('มีสินค้าที่ไม่พบในระบบ');
  }
  if (cids.length) {
    const [[r]] = await conn.query('SELECT COUNT(*) AS n FROM product_categories WHERE org_id = :orgId AND id IN (:cids)', { orgId, cids });
    if (Number(r.n) !== cids.length) throw badRequest('มีหมวดสินค้าที่ไม่พบในระบบ');
  }
  if (b.branchIds.length) {
    const [[r]] = await conn.query('SELECT COUNT(*) AS n FROM branches WHERE org_id = :orgId AND id IN (:ids)', { orgId, ids: b.branchIds });
    if (Number(r.n) !== b.branchIds.length) throw badRequest('มีสาขาที่ไม่พบในระบบ');
  }
}

async function writeChildren(conn, id, b) {
  await conn.query('DELETE FROM pos_promotion_items WHERE promotion_id = :id', { id });
  await conn.query('DELETE FROM pos_promotion_branches WHERE promotion_id = :id', { id });
  for (const [i, s] of b.slots.entries()) {
    for (const pid of s.productIds) await conn.query('INSERT INTO pos_promotion_items (promotion_id, slot, product_id, qty) VALUES (:id, :slot, :pid, :qty)', { id, slot: i + 1, pid, qty: s.qty });
    for (const cid of s.categoryIds) await conn.query('INSERT INTO pos_promotion_items (promotion_id, slot, category_id, qty) VALUES (:id, :slot, :cid, :qty)', { id, slot: i + 1, cid, qty: s.qty });
  }
  for (const bid of b.branchIds) await conn.query('INSERT INTO pos_promotion_branches (promotion_id, branch_id) VALUES (:id, :bid)', { id, bid });
}

const COLS = (b) => ({
  name: b.name,
  kind: b.kind,
  discountType: b.discountType,
  value: b.value,
  startsOn: b.startsOn,
  endsOn: b.endsOn,
  daysMask: b.daysMask,
  timeFrom: b.timeFrom,
  timeTo: b.timeTo,
  isActive: b.isActive ? 1 : 0,
});

/** Status for the list: running now, scheduled (later today / future dates), ended, or switched off. */
function statusOf(p, clock) {
  if (!p.isActive) return 'off';
  if (p.endsOn && clock.date > p.endsOn) return 'ended';
  return promotions.isRunning(p, clock) ? 'running' : 'scheduled';
}

router.get('/', validate({ query: z.object({ branchId: z.coerce.number().int().positive().optional() }) }), async (req, res) => {
  const list = await promotions.loadPromotions(req.user.orgId);
  const { branchId } = req.valid.query;
  const shown = branchId ? list.filter((p) => !p.branches.length || p.branches.includes(branchId)) : list;
  const stats = shown.length
    ? await db.query(
        `SELECT i.promotion_id, COUNT(DISTINCT i.order_id) AS orders, SUM(i.promo_discount) AS discount
           FROM sales_order_items i JOIN sales_orders o ON o.id = i.order_id
          WHERE o.org_id = :orgId AND o.status <> 'cancelled' AND i.promotion_id IN (:ids)
          GROUP BY i.promotion_id`,
        { orgId: req.user.orgId, ids: shown.map((p) => p.id) },
      )
    : [];
  // names for the products/categories in each slot
  const pids = [...new Set(shown.flatMap((p) => p.slots.flatMap((s) => s.productIds)))];
  const cids = [...new Set(shown.flatMap((p) => p.slots.flatMap((s) => s.categoryIds)))];
  const [prods, cats] = await Promise.all([
    pids.length ? db.query('SELECT id, name, price, cost FROM products WHERE id IN (:pids)', { pids }) : [],
    cids.length ? db.query('SELECT id, name FROM product_categories WHERE id IN (:cids)', { cids }) : [],
  ]);
  const clock = promotions.localClock();
  res.json({
    data: shown.map((p) => {
      const st = stats.find((s) => s.promotion_id === p.id);
      return {
        ...p,
        label: promotions.promoLabel(p),
        status: statusOf(p, clock),
        editable: canEdit(req.user, p),
        orders: Number(st?.orders ?? 0),
        discountTotal: Number(st?.discount ?? 0),
        slots: p.slots.map((s) => ({
          ...s,
          products: s.productIds.map((id) => prods.find((x) => x.id === id)).filter(Boolean).map((x) => ({ id: x.id, name: x.name, price: Number(x.price), cost: Number(x.cost) })),
          categories: s.categoryIds.map((id) => cats.find((x) => x.id === id)).filter(Boolean).map((x) => ({ id: x.id, name: x.name })),
        })),
      };
    }),
  });
});

router.post('/', requirePermission('pos:manage'), validate({ body }), async (req, res) => {
  const b = { ...req.valid.body, branchIds: allowedBranches(req.user, req.valid.body.branchIds) };
  const id = await db.tx(async (conn) => {
    await validateRefs(conn, req.user.orgId, b);
    const [r] = await conn.query(
      `INSERT INTO pos_promotions (org_id, name, kind, discount_type, value, starts_on, ends_on, days_mask, time_from, time_to, is_active, created_by)
       VALUES (:orgId, :name, :kind, :discountType, :value, :startsOn, :endsOn, :daysMask, :timeFrom, :timeTo, :isActive, :userId)`,
      { orgId: req.user.orgId, userId: req.user.id, ...COLS(b) },
    );
    await writeChildren(conn, r.insertId, b);
    return r.insertId;
  });
  promotions.clearCache(req.user.orgId);
  audit(req, 'pos.promotion.create', 'pos_promotion', id, { name: b.name, kind: b.kind, branches: b.branchIds });
  res.status(201).json({ data: { id } });
});

const idParam = z.object({ id: z.coerce.number().int().positive() });

async function editable(req) {
  const [p] = await promotions.loadPromotions(req.user.orgId, { ids: [req.valid.params.id] });
  if (!p) throw notFound('ไม่พบโปรโมชั่น');
  if (!canEdit(req.user, p)) throw forbidden('โปรโมชั่นนี้ใช้หลายสาขา — ให้เจ้าของร้านหรือแอดมินแก้');
  return p;
}

router.put('/:id', requirePermission('pos:manage'), validate({ params: idParam, body }), async (req, res) => {
  await editable(req);
  const id = req.valid.params.id;
  const b = { ...req.valid.body, branchIds: allowedBranches(req.user, req.valid.body.branchIds) };
  await db.tx(async (conn) => {
    await validateRefs(conn, req.user.orgId, b);
    await conn.query(
      `UPDATE pos_promotions SET name = :name, kind = :kind, discount_type = :discountType, value = :value, starts_on = :startsOn, ends_on = :endsOn,
              days_mask = :daysMask, time_from = :timeFrom, time_to = :timeTo, is_active = :isActive
        WHERE id = :id AND org_id = :orgId`,
      { id, orgId: req.user.orgId, ...COLS(b) },
    );
    await writeChildren(conn, id, b);
  });
  promotions.clearCache(req.user.orgId);
  audit(req, 'pos.promotion.update', 'pos_promotion', id, { name: b.name });
  res.json({ data: { id } });
});

router.patch('/:id', requirePermission('pos:manage'), validate({ params: idParam, body: z.object({ isActive: z.boolean() }) }), async (req, res) => {
  await editable(req);
  await db.query('UPDATE pos_promotions SET is_active = :a WHERE id = :id AND org_id = :orgId', { a: req.valid.body.isActive ? 1 : 0, id: req.valid.params.id, orgId: req.user.orgId });
  promotions.clearCache(req.user.orgId);
  audit(req, req.valid.body.isActive ? 'pos.promotion.enable' : 'pos.promotion.disable', 'pos_promotion', req.valid.params.id);
  res.json({ data: { id: req.valid.params.id } });
});

router.delete('/:id', requirePermission('pos:manage'), validate({ params: idParam }), async (req, res) => {
  const p = await editable(req);
  // A promotion that was used stays for the receipts and reports: switch it off instead
  const used = await db.one('SELECT 1 AS used FROM sales_order_items WHERE promotion_id = :id LIMIT 1', { id: p.id });
  if (used) throw conflict('โปรโมชั่นนี้มีการขายไปแล้ว — ปิดใช้งานแทนการลบ เพื่อให้ใบเสร็จและรายงานยังแสดงชื่อโปรได้');
  await db.query('DELETE FROM pos_promotions WHERE id = :id AND org_id = :orgId', { id: p.id, orgId: req.user.orgId });
  promotions.clearCache(req.user.orgId);
  audit(req, 'pos.promotion.delete', 'pos_promotion', p.id, { name: p.name });
  res.json({ data: { id: p.id } });
});

module.exports = { router };
