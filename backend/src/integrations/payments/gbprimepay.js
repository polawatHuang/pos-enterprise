'use strict';

// GB Prime Pay: QR Cash (Thai QR / PromptPay) with the shop's customer key ("token").
// Flow: POST /v3/qrcode/text gives the QR text for our own referenceNo, the customer pays, GB Prime
// Pay POSTs to the backgroundUrl, and the transaction is looked up (POST /v1/check_status_txn with the
// secret key) to confirm it. The webhook body is only a pointer to the referenceNo, never believed.
//
// Written from the public API (paths and fields as used by the npm "gbprimepay" client) because the
// official docs could not be reached while writing it. Not yet run against a live account — check the
// QR field (qrcode) and the enquiry's status letters on the first sandbox payment.

const crypto = require('node:crypto');

const BASE = { live: 'https://api.gbprimepay.com', test: 'https://api.globalprimepay.com' };
/** QR Cash has no expiry of its own; the till gives up on a QR after this long. */
const QR_TTL_MS = 15 * 60_000;
/** Enquiry status letters: S = settled (paid), A = authorized; V = voided, R = refunded. */
const PAID = new Set(['S', 'A']);
const FAILED = new Set(['V', 'R']);

const base = (creds) => (isSandbox(creds) ? BASE.test : BASE.live);
const isSandbox = (creds) => creds.sandbox === '1' || creds.sandbox === true;
const basic = (creds) => `Basic ${Buffer.from(`${creds.secretKey}:`).toString('base64')}`;

async function call(creds, method, path, { form, json, auth } = {}) {
  const res = await fetch(`${base(creds)}${path}`, {
    method,
    headers: {
      ...(auth ? { Authorization: basic(creds) } : {}),
      ...(form ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
      ...(json ? { 'Content-Type': 'application/json' } : {}),
    },
    body: form ? new URLSearchParams(form).toString() : json ? JSON.stringify(json) : undefined,
    signal: AbortSignal.timeout(15_000),
  });
  const text = await res.text();
  let body;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { raw: text.slice(0, 200) };
  }
  if (!res.ok) {
    const err = new Error(body.resultMessage || body.message || `GB Prime Pay ตอบกลับผิดปกติ (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return body;
}

/** 15 digits, unique enough per shop: time in ms + 2 random digits. */
const newReferenceNo = () => `${Date.now()}${crypto.randomInt(0, 100).toString().padStart(2, '0')}`.slice(-15);

const failed = (body) => body.resultCode !== undefined && String(body.resultCode) !== '00';

module.exports = {
  id: 'gbprimepay',
  label: 'GB Prime Pay',
  fields: [
    { key: 'token', label: 'Token (Customer key)', secret: true },
    { key: 'secretKey', label: 'Secret key', secret: true },
    { key: 'sandbox', label: 'โหมดทดสอบ (Sandbox — คีย์จากบัญชีทดสอบ ไม่มีเงินจริง)', secret: false, type: 'boolean' },
  ],
  webhookHint: 'ระบบส่ง URL นี้ให้ GB Prime Pay เองทุกครั้งที่สร้าง QR (ต้องตั้ง PUBLIC_API_URL หรือ APP_PUBLIC_URL บนเซิร์ฟเวอร์) ไม่ต้องนำไปใส่ที่ไหน',
  /** Both keys are needed: the token makes QRs, the secret key reads payments back. */
  validateCredentials(creds) {
    if (!creds.token || creds.token.length < 20 || /\s/.test(creds.token)) return 'ใส่ Token (Customer key) ของ GB Prime Pay ให้ครบ';
    if (!creds.secretKey || creds.secretKey.length < 16 || /\s/.test(creds.secretKey)) return 'ใส่ Secret key ของ GB Prime Pay ให้ครบ';
    return null;
  },
  mode: (creds) => (isSandbox(creds) ? 'test' : 'live'),

  async createQr(creds, { amount, ref, webhookUrl }) {
    const referenceNo = newReferenceNo();
    const form = { token: creds.token, amount: Number(amount).toFixed(2), referenceNo, detail: String(ref).slice(0, 250) };
    if (webhookUrl && webhookUrl.length <= 250) form.backgroundUrl = webhookUrl;
    const r = await call(creds, 'POST', '/v3/qrcode/text', { form });
    if (failed(r)) throw new Error(r.resultMessage || `GB Prime Pay ปฏิเสธ (รหัส ${r.resultCode})`);
    const payload = r.qrcode ?? r.qrCode ?? null;
    if (!payload || typeof payload !== 'string') throw new Error('GB Prime Pay ไม่ส่ง QR กลับมา — ตรวจว่าบัญชีเปิดใช้ QR Cash แล้ว');
    return { providerRef: referenceNo, qrPayload: payload, qrImage: null, expiresAt: new Date(Date.now() + QR_TTL_MS) };
  },

  /** Proves both keys (no money moves). */
  async test(creds) {
    const c = await call(creds, 'POST', '/checkCustomerKey', { form: { token: creds.token } });
    if (failed(c)) throw new Error(`Token ไม่ถูกต้อง (รหัส ${c.resultCode})`);
    const s = await call(creds, 'GET', '/checkPrivateKey', { auth: true });
    if (failed(s)) throw new Error(`Secret key ไม่ถูกต้อง (รหัส ${s.resultCode})`);
    const name = c.merchantName ?? c.merchant_name ?? s.merchantName ?? c.merchantId ?? s.merchantId;
    return name ? { account: String(name) } : {};
  },

  async fetchStatus(creds, referenceNo) {
    const r = await call(creds, 'POST', '/v1/check_status_txn', { json: { referenceNo }, auth: true });
    const t = (Array.isArray(r.txn) ? r.txn[0] : r.txn) ?? r;
    const letter = String(t.status ?? '').toUpperCase();
    const raw = { resultCode: r.resultCode, txnResultCode: t.resultCode, status: t.status, gbpReferenceNo: t.gbpReferenceNo };
    // anything we cannot read as a clear, matching success stays pending (the till keeps waiting)
    if (failed(r) || (t.referenceNo !== undefined && String(t.referenceNo) !== String(referenceNo))) return { status: 'pending', amount: null, raw };
    if (FAILED.has(letter)) return { status: 'failed', amount: null, raw };
    if (PAID.has(letter) && (t.resultCode === undefined || String(t.resultCode) === '00')) {
      const amount = Number(t.amount ?? t.totalAmount ?? t.thbAmount);
      return { status: 'paid', amount: Number.isFinite(amount) ? amount : null, raw };
    }
    return { status: 'pending', amount: null, raw };
  },

  /** Our referenceNo from the background POST (JSON or form). */
  chargeIdFromWebhook(body) {
    const ref = body?.referenceNo;
    return typeof ref === 'string' || typeof ref === 'number' ? String(ref) : null;
  },
};
