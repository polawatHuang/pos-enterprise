'use strict';

const db = require('../../db/pool');
const { badRequest } = require('../../core/errors');

const r2 = (n) => Math.round(n * 100) / 100;

/** Codes are typed by customers and staff: compare without case or surrounding spaces. */
const normalizeCode = (code) =>
  String(code ?? '')
    .trim()
    .toUpperCase();

function mapCode(c) {
  const maxUses = c.max_uses == null ? null : Number(c.max_uses);
  return {
    id: c.id,
    code: c.code,
    description: c.description ?? null,
    type: c.type,
    value: Number(c.value),
    minSpend: Number(c.min_spend),
    maxUses,
    usedCount: Number(c.used_count),
    remaining: maxUses == null ? null : Math.max(maxUses - Number(c.used_count), 0),
    customerId: c.customer_id ?? null,
    customerName: c.customer_name ?? null,
    issuedBy: c.issued_by,
    expiresAt: c.expires_at,
    isActive: Boolean(c.is_active ?? 1),
    createdAt: c.created_at,
  };
}

/** Baht off `subtotal` for this code (never more than the subtotal). */
const discountFor = (c, subtotal) => r2(Math.min(subtotal, c.type === 'percent' ? (subtotal * Number(c.value)) / 100 : Number(c.value)));

/**
 * Why a code cannot be used on this bill, or null when it can. `subtotal` is after line discounts.
 * A code issued to one customer (e.g. by the AI chat) only works when no other member is on the bill.
 */
function rejectReason(c, { subtotal, customerId, now = new Date() }) {
  if (!c) return 'ไม่พบโค้ดส่วนลดนี้';
  if (!(c.is_active ?? 1)) return 'โค้ดนี้ถูกปิดใช้งาน';
  if (c.expires_at && new Date(c.expires_at) < now) return 'โค้ดนี้หมดอายุแล้ว';
  if (c.max_uses != null && Number(c.used_count) >= Number(c.max_uses)) return 'โค้ดนี้ถูกใช้ครบแล้ว';
  if (subtotal + 1e-9 < Number(c.min_spend)) return `ใช้ได้เมื่อซื้อครบ ${Number(c.min_spend).toLocaleString('th-TH')} บาท`;
  if (c.customer_id && customerId && Number(c.customer_id) !== Number(customerId)) return 'โค้ดนี้เป็นของลูกค้าคนอื่น';
  return null;
}

/** Lock and validate a code inside the checkout transaction; returns { code, amount }. */
async function redeemInTx(conn, orgId, rawCode, ctx) {
  const [[c]] = await conn.query('SELECT * FROM discount_codes WHERE org_id = :orgId AND code = :code FOR UPDATE', { orgId, code: normalizeCode(rawCode) });
  const why = rejectReason(c, ctx);
  if (why) throw badRequest(why);
  await conn.query('UPDATE discount_codes SET used_count = used_count + 1 WHERE id = :id', { id: c.id });
  return { code: c, amount: discountFor(c, ctx.subtotal) };
}

/** Preview for the till before paying. */
async function check(orgId, rawCode, { subtotal, customerId }) {
  const c = await db.one(
    `SELECT d.*, cu.name AS customer_name FROM discount_codes d LEFT JOIN customers cu ON cu.id = d.customer_id
      WHERE d.org_id = :orgId AND d.code = :code`,
    { orgId, code: normalizeCode(rawCode) },
  );
  const why = rejectReason(c, { subtotal, customerId });
  return { valid: !why, reason: why, amount: c && !why ? discountFor(c, subtotal) : 0, code: c ? mapCode(c) : null };
}

module.exports = { normalizeCode, mapCode, discountFor, rejectReason, redeemInTx, check };
