'use strict';

// Opn Payments (formerly Omise): PromptPay QR through a charge.
// Flow (docs.omise.co/promptpay): create a charge with source type "promptpay" using the SECRET key,
// show the QR, the customer pays in their banking app, Opn sends a "charge.complete" webhook, and
// the charge is retrieved to confirm its status. We never trust a webhook body: it only tells us
// which charge to look up.
//
// Written from Opn's public documentation. Not yet run against a live account — the QR image is read
// from source.scannable_code.image.download_uri, which should be checked on the first test charge.

const BASE = 'https://api.omise.co';
const VERSION = '2019-05-29';

const STATUS = { successful: 'paid', pending: 'pending', expired: 'expired', failed: 'failed', reversed: 'failed' };

async function call(creds, method, path, form) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      Authorization: `Basic ${Buffer.from(`${creds.secretKey}:`).toString('base64')}`,
      'Omise-Version': VERSION,
      ...(form ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
    },
    body: form ? new URLSearchParams(form).toString() : undefined,
    signal: AbortSignal.timeout(15_000),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.object === 'error') {
    const err = new Error(body.message || `Opn ตอบกลับผิดปกติ (${res.status})`);
    err.status = res.status;
    err.code = body.code;
    throw err;
  }
  return body;
}

const toSatang = (baht) => Math.round(baht * 100);
const expiry = (v) => (v ? new Date(v) : null);

module.exports = {
  id: 'opn',
  label: 'Opn Payments (Omise)',
  fields: [{ key: 'secretKey', label: 'Secret key (skey_…)', secret: true }],
  webhookHint: 'นำไปใส่ใน Dashboard ของ Opn (Webhooks) — ระบบใช้เหตุการณ์ charge.complete',
  /** A key that cannot be right is refused before it is saved. */
  validateCredentials(creds) {
    if (!/^skey_(test_)?[A-Za-z0-9]+$/.test(creds.secretKey ?? '')) return 'Secret key ของ Opn ขึ้นต้นด้วย skey_ (หรือ skey_test_ สำหรับโหมดทดสอบ)';
    return null;
  },
  mode: (creds) => (String(creds.secretKey).startsWith('skey_test_') ? 'test' : 'live'),

  async createQr(creds, { amount, ref }) {
    const c = await call(creds, 'POST', '/charges', {
      amount: String(toSatang(amount)),
      currency: 'thb',
      description: ref,
      'source[type]': 'promptpay',
    });
    const image = c.source?.scannable_code?.image?.download_uri ?? null;
    if (!image) throw new Error('Opn ไม่ส่ง QR กลับมา — ตรวจว่าบัญชี Opn เปิดใช้ PromptPay แล้ว');
    return { providerRef: c.id, qrImage: image, qrPayload: null, expiresAt: expiry(c.expires_at) };
  },

  /** Cheap call that proves the key works (no money moves). */
  async test(creds) {
    const a = await call(creds, 'GET', '/account');
    return { account: a.email ?? a.id, currency: a.currency };
  },

  async fetchStatus(creds, providerRef) {
    const c = await call(creds, 'GET', `/charges/${encodeURIComponent(providerRef)}`);
    // paid = the charge succeeded and was actually paid in full
    const status = STATUS[c.status] ?? 'pending';
    return { status: status === 'paid' && c.paid === false ? 'pending' : status, amount: Number(c.amount) / 100, raw: { status: c.status, paid: c.paid, failure: c.failure_code } };
  },

  /** The charge id a webhook is about, or null (the body is only a pointer; the charge is re-read). */
  chargeIdFromWebhook(body) {
    if (body?.object === 'event' && /^charge\./.test(body.key ?? '')) return body.data?.id ?? null;
    return null;
  },
};
