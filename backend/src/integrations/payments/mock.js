'use strict';

// A pretend provider for development and tests: "pays" when told to. Never available in production.

const crypto = require('node:crypto');
const { promptPayPayload } = require('../../utils/promptpay');

const paid = new Map(); // providerRef -> amount, set by the test webhook

module.exports = {
  id: 'mock',
  label: 'จำลอง (ทดสอบเท่านั้น)',
  fields: [],
  devOnly: true,
  validateCredentials: () => null,
  mode: () => 'test',

  async createQr(_creds, { amount }) {
    return { providerRef: `mock_${crypto.randomBytes(8).toString('hex')}`, qrPayload: promptPayPayload('0812345678', amount), qrImage: null, expiresAt: new Date(Date.now() + 10 * 60_000) };
  },
  async fetchStatus(_creds, providerRef) {
    return paid.has(providerRef) ? { status: 'paid', amount: paid.get(providerRef), raw: { mock: true } } : { status: 'pending', amount: null, raw: { mock: true } };
  },
  chargeIdFromWebhook: (body) => body?.providerRef ?? null,
  /** the test "webhook" is what pays */
  async beforeRefresh(body, intent) {
    paid.set(body.providerRef, Number(body.amount ?? intent.amount));
  },
};
