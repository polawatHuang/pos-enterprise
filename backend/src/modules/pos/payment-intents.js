'use strict';

// PromptPay QR that closes the bill by itself. The till asks the shop's payment provider for a QR
// (a "payment intent"), the customer pays in their banking app, the provider tells us (webhook) or we
// ask it (status check), and the sale then claims the paid intent as its PromptPay tender. An intent
// can be claimed once, by the shift that made it, for exactly its amount.

const db = require('../../db/pool');
const payments = require('../../integrations/payments');
const { badRequest, conflict, notFound } = require('../../core/errors');
const { r2 } = require('../accounting/ledger.service');

const SETTING = 'pos.payment_gateway';
/** Ask the provider at most this often for one intent (the till polls every 2s). */
const RECHECK_MS = 3000;

async function config(orgId) {
  const row = await db.one('SELECT value FROM settings WHERE org_id = :orgId AND setting_key = :k', { orgId, k: SETTING });
  let v = row?.value;
  if (typeof v === 'string') {
    try {
      v = JSON.parse(v);
    } catch {
      v = null;
    }
  }
  return { provider: v?.provider ?? null, enabled: Boolean(v?.enabled) };
}

async function saveConfig(orgId, cfg) {
  await db.query(
    `INSERT INTO settings (org_id, setting_key, value) VALUES (:orgId, :k, :v) ON DUPLICATE KEY UPDATE value = VALUES(value)`,
    { orgId, k: SETTING, v: JSON.stringify(cfg) },
  );
}

/** What the admin screen shows: never the key itself. */
async function adminView(orgId) {
  const cfg = await config(orgId);
  const creds = cfg.provider ? await payments.credentials(orgId, cfg.provider) : null;
  const p = cfg.provider ? payments.provider(cfg.provider) : null;
  return {
    ...cfg,
    providers: payments.available().map((x) => ({ id: x.id, label: x.label, fields: x.fields, devOnly: Boolean(x.devOnly) })),
    hasKey: Boolean(creds),
    mode: creds && p ? p.mode(creds) : null,
    webhookKey: creds?.webhookKey ?? null,
  };
}

async function saveAdmin(orgId, { provider: id, enabled, credentials: input }) {
  const p = payments.provider(id);
  let creds = await payments.credentials(orgId, id);
  if (input && Object.values(input).some(Boolean)) {
    const bad = p.validateCredentials(input);
    if (bad) throw badRequest(bad);
    await payments.saveCredentials(orgId, id, input);
    creds = await payments.credentials(orgId, id);
  }
  if (enabled && p.fields.length && !creds) throw badRequest('ใส่คีย์ของผู้ให้บริการก่อนเปิดใช้งาน');
  await saveConfig(orgId, { provider: id, enabled: Boolean(enabled) });
  return adminView(orgId);
}

async function testConnection(orgId) {
  const cfg = await config(orgId);
  if (!cfg.provider) throw badRequest('ยังไม่ได้เลือกผู้ให้บริการ');
  const p = payments.provider(cfg.provider);
  const creds = await payments.credentials(orgId, cfg.provider);
  if (p.fields.length && !creds) throw badRequest('ยังไม่ได้บันทึกคีย์');
  if (!p.test) return { ok: true };
  try {
    return { ok: true, ...(await p.test(creds ?? {})) };
  } catch (err) {
    throw badRequest(`เชื่อมต่อไม่สำเร็จ: ${err.message}`);
  }
}

/** Whether the till should offer the automatic QR (no secrets). */
async function tillView(orgId) {
  const cfg = await config(orgId);
  if (!cfg.enabled || !cfg.provider) return { enabled: false, provider: null };
  try {
    payments.provider(cfg.provider);
  } catch {
    return { enabled: false, provider: null };
  }
  return { enabled: true, provider: cfg.provider };
}

const mapIntent = (i) => ({
  id: i.id,
  status: i.status,
  amount: Number(i.amount),
  qrPayload: i.qr_payload,
  qrImage: i.qr_image,
  expiresAt: i.expires_at,
  paidAt: i.paid_at,
});

async function createIntent(user, shift, amount) {
  const cfg = await config(user.orgId);
  if (!cfg.enabled || !cfg.provider) throw conflict('ยังไม่ได้เปิดรับชำระ PromptPay อัตโนมัติ');
  if (!(amount > 0)) throw badRequest('ยอดต้องมากกว่า 0');
  const p = payments.provider(cfg.provider);
  const creds = (await payments.credentials(user.orgId, cfg.provider)) ?? {};
  let qr;
  try {
    qr = await p.createQr(creds, { amount: r2(amount), ref: `POS shift ${shift.id}` });
  } catch (err) {
    const e = badRequest(`สร้าง QR ไม่สำเร็จ: ${err.message}`);
    e.status = 502;
    throw e;
  }
  const r = await db.query(
    `INSERT INTO payment_intents (org_id, branch_id, shift_id, user_id, provider, provider_ref, amount, qr_payload, qr_image, expires_at)
     VALUES (:orgId, :branchId, :shiftId, :userId, :provider, :ref, :amount, :payload, :image, :expires)`,
    {
      orgId: user.orgId,
      branchId: shift.branch_id,
      shiftId: shift.id,
      userId: user.id,
      provider: cfg.provider,
      ref: qr.providerRef,
      amount: r2(amount),
      payload: qr.qrPayload,
      image: qr.qrImage,
      expires: qr.expiresAt ? new Date(qr.expiresAt) : null,
    },
  );
  return mapIntent(await db.one('SELECT * FROM payment_intents WHERE id = :id', { id: r.insertId }));
}

/** Re-reads a pending intent from its provider and records paid / expired / failed. */
async function refresh(intent, { force = false } = {}) {
  if (intent.status !== 'pending') return intent;
  if (intent.expires_at && new Date(intent.expires_at) < new Date()) {
    // a QR that expired a moment ago can still have been paid: ask once more before giving up
    force = true;
  }
  if (!force && intent.checked_at && Date.now() - new Date(intent.checked_at).getTime() < RECHECK_MS) return intent;
  const p = payments.provider(intent.provider);
  const creds = (await payments.credentials(intent.org_id, intent.provider)) ?? {};
  let result;
  try {
    result = await p.fetchStatus(creds, intent.provider_ref);
  } catch {
    await db.query('UPDATE payment_intents SET checked_at = UTC_TIMESTAMP() WHERE id = :id', { id: intent.id });
    return intent; // provider hiccup: the next poll tries again
  }
  let status = result.status;
  if (status === 'paid' && result.amount != null && Math.abs(Number(result.amount) - Number(intent.amount)) > 0.009) status = 'failed';
  if (status === 'pending' && intent.expires_at && new Date(intent.expires_at) < new Date()) status = 'expired';
  await db.query(
    `UPDATE payment_intents SET status = :status, checked_at = UTC_TIMESTAMP(), paid_at = IF(:status = 'paid', UTC_TIMESTAMP(), paid_at), raw = :raw
      WHERE id = :id AND status = 'pending'`,
    { id: intent.id, status, raw: JSON.stringify(result.raw ?? null) },
  );
  return db.one('SELECT * FROM payment_intents WHERE id = :id', { id: intent.id });
}

async function loadIntent(orgId, id) {
  const i = await db.one('SELECT * FROM payment_intents WHERE id = :id AND org_id = :orgId', { id, orgId });
  if (!i) throw notFound('ไม่พบรายการชำระเงิน');
  return i;
}

async function getIntent(orgId, id) {
  return mapIntent(await refresh(await loadIntent(orgId, id)));
}

async function cancelIntent(orgId, id) {
  const i = await loadIntent(orgId, id);
  if (i.status === 'pending') await db.query("UPDATE payment_intents SET status = 'cancelled' WHERE id = :id AND status = 'pending'", { id });
  return mapIntent(await loadIntent(orgId, id));
}

/**
 * The sale takes a paid intent as its PromptPay tender (inside the sale's transaction): it must be the
 * shop's, paid, unused, from this shift, and for exactly this amount. Returns the provider's reference.
 */
async function claimInTx(conn, user, shift, orderId, tender) {
  const [[i]] = await conn.query('SELECT * FROM payment_intents WHERE id = :id AND org_id = :orgId FOR UPDATE', { id: tender.intentId, orgId: user.orgId });
  if (!i) throw badRequest('ไม่พบรายการชำระเงินอัตโนมัติ');
  if (tender.method !== 'promptpay') throw badRequest('รายการชำระอัตโนมัติใช้ได้กับ PromptPay เท่านั้น');
  if (i.status === 'used') throw conflict('การชำระเงินนี้ถูกใช้กับบิลอื่นไปแล้ว');
  if (i.status !== 'paid') throw conflict('ยังไม่ได้รับเงินจากผู้ให้บริการ — รอให้ลูกค้าชำระก่อน');
  if (Number(i.shift_id) !== Number(shift.id)) throw conflict('การชำระเงินนี้เป็นของกะอื่น');
  if (Math.abs(Number(i.amount) - r2(tender.amount)) > 0.009) throw conflict(`ยอดที่ลูกค้าชำระ ${Number(i.amount).toFixed(2)} ไม่ตรงกับยอดบิล`);
  await conn.query("UPDATE payment_intents SET status = 'used', order_id = :orderId WHERE id = :id", { orderId, id: i.id });
  return i.provider_ref;
}

/** A provider's webhook: it names a charge; the charge is re-read from the provider, never believed. */
async function handleWebhook(providerId, key, body) {
  const p = payments.provider(providerId);
  const orgId = await payments.orgForWebhookKey(providerId, key);
  if (!orgId) throw notFound('ไม่พบปลายทาง');
  const ref = p.chargeIdFromWebhook(body);
  if (!ref) return { handled: false };
  const intent = await db.one('SELECT * FROM payment_intents WHERE org_id = :orgId AND provider = :p AND provider_ref = :ref', { orgId, p: providerId, ref });
  if (!intent) return { handled: false };
  if (p.beforeRefresh) await p.beforeRefresh(body, intent);
  const after = await refresh(intent, { force: true });
  return { handled: true, status: after.status };
}

module.exports = { config, adminView, saveAdmin, testConnection, tillView, createIntent, getIntent, cancelIntent, claimInTx, handleWebhook };
