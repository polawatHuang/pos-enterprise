'use strict';

// Automatic PromptPay: a provider-made QR (intent) is paid, the sale claims it once, for its amount.
// Uses the built-in mock provider (never available in production).
process.env.NODE_ENV = 'test';
process.env.APP_ENCRYPTION_KEY = process.env.APP_ENCRYPTION_KEY || Buffer.alloc(32, 7).toString('base64');

const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { createApp } = require('../src/app');
const db = require('../src/db/pool');

const app = createApp();
const RUN = Date.now().toString(36);
const state = { productId: 0, orderIds: [] };
let manager;
let cashier;
let webhookKey;

async function cookie(email) {
  const res = await request(app).post('/api/auth/login').send({ email, password: 'Admin@1234' });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  return res.headers['set-cookie'].map((c) => c.split(';')[0]).join('; ');
}
const as = (c) => ({
  get: (url) => request(app).get(url).set('Cookie', c),
  post: (url, body) => request(app).post(url).set('Cookie', c).send(body),
  put: (url, body) => request(app).put(url).set('Cookie', c).send(body),
});
const pay = (key, body) => request(app).post(`/api/public/payments/mock/${key}`).send(body);
const sell = (body) => cashier.post('/api/pos/checkout', body);

before(async () => {
  manager = as(await cookie('manager@example.com'));
  cashier = as(await cookie('cashier@example.com'));
  await db.query('UPDATE pos_shifts SET closed_at = UTC_TIMESTAMP() WHERE user_id = 4 AND closed_at IS NULL');
  await db.query("DELETE FROM settings WHERE org_id = 1 AND setting_key LIKE 'pos.%'");
  const p = await manager.post('/api/products', { name: `ของทดสอบชำระ ${RUN}`, price: 100, cost: 40 });
  assert.equal(p.status, 201, JSON.stringify(p.body));
  state.productId = p.body.data.id;
  await manager.post('/api/inventory/receive', { warehouseId: 2, items: [{ productId: state.productId, quantity: 50, unitCost: 40 }] });
  assert.equal((await cashier.post('/api/pos/shift/open', { openingCash: 1000 })).status, 201);
});

after(async () => {
  await db.query("DELETE FROM settings WHERE org_id = 1 AND setting_key = 'pos.payment_gateway'");
  await db.query("DELETE FROM integration_credentials WHERE provider LIKE 'payment:%'");
  if (state.orderIds.length) await db.query('DELETE FROM sales_orders WHERE id IN (:ids)', { ids: state.orderIds });
  await db.query('DELETE FROM payment_intents WHERE org_id = 1');
  await db.query('DELETE FROM pos_shifts WHERE user_id = 4 AND opened_at > UTC_TIMESTAMP() - INTERVAL 1 HOUR');
  await db.query('DELETE FROM stock_lots WHERE product_id = :id', { id: state.productId });
  await db.query('DELETE FROM products WHERE id = :id', { id: state.productId });
  await db.pool.end();
});

describe('connecting a provider', () => {
  test('off until a manager turns it on; keys never come back; Opn keys are checked for shape', async () => {
    assert.equal((await cashier.get('/api/pos/payment-gateway')).status, 403);
    assert.equal((await cashier.post('/api/pos/payment-intents', { amount: 100 })).status, 409);
    assert.equal((await cashier.get('/api/pos/settings')).body.data.paymentGateway.enabled, false);
    const bad = await manager.put('/api/pos/payment-gateway', { provider: 'opn', enabled: true, credentials: { secretKey: 'nope' } });
    assert.equal(bad.status, 400);
    assert.equal((await manager.put('/api/pos/payment-gateway', { provider: 'opn', enabled: true })).status, 400); // no key yet
    const ok = await manager.put('/api/pos/payment-gateway', { provider: 'opn', enabled: false, credentials: { secretKey: 'skey_test_abcdef123456' } });
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    assert.equal(ok.body.data.hasKey, true);
    assert.equal(ok.body.data.mode, 'test');
    assert.equal(JSON.stringify(ok.body).includes('abcdef123456'), false);
    const raw = await db.one("SELECT data_encrypted FROM integration_credentials WHERE provider = 'payment:opn'");
    assert.equal(raw.data_encrypted.includes('abcdef123456'), false); // encrypted at rest
    const mock = await manager.put('/api/pos/payment-gateway', { provider: 'mock', enabled: true });
    assert.equal(mock.status, 200, JSON.stringify(mock.body));
    webhookKey = mock.body.data.webhookKey;
    // the mock has no keys, so it has no webhook key until credentials are saved once
    if (!webhookKey) {
      const withKey = await manager.put('/api/pos/payment-gateway', { provider: 'mock', enabled: true, credentials: { k: 'v' } });
      webhookKey = withKey.body.data.webhookKey;
    }
    assert.match(webhookKey, /^wh_/);
    assert.equal((await cashier.get('/api/pos/settings')).body.data.paymentGateway.enabled, true);
  });
});

describe('paying with an intent', () => {
  test('pending -> paid by webhook -> the sale claims it once; reference is the provider id', async () => {
    const made = await cashier.post('/api/pos/payment-intents', { amount: 100 });
    assert.equal(made.status, 201, JSON.stringify(made.body));
    const intent = made.body.data;
    assert.equal(intent.status, 'pending');
    assert.ok(intent.qrPayload);
    const ref = (await db.one('SELECT provider_ref FROM payment_intents WHERE id = :id', { id: intent.id })).provider_ref;

    // not paid yet: the sale is refused
    const early = await sell({ items: [{ productId: state.productId, quantity: 1 }], payments: [{ method: 'promptpay', amount: 100, intentId: intent.id }] });
    assert.equal(early.status, 409, JSON.stringify(early.body));

    // wrong key / unknown charge do nothing
    assert.equal((await pay('wh_wrong', { providerRef: ref })).status, 404);
    assert.equal((await pay(webhookKey, { providerRef: 'mock_unknown' })).body.handled, false);
    assert.equal((await cashier.get(`/api/pos/payment-intents/${intent.id}`)).body.data.status, 'pending');

    const hit = await pay(webhookKey, { providerRef: ref });
    assert.equal(hit.status, 200);
    assert.equal(hit.body.status, 'paid');
    assert.equal((await cashier.get(`/api/pos/payment-intents/${intent.id}`)).body.data.status, 'paid');
    // a repeated webhook changes nothing
    assert.equal((await pay(webhookKey, { providerRef: ref })).status, 200);

    // wrong amount is refused; the right one is accepted
    const wrong = await sell({ items: [{ productId: state.productId, quantity: 2 }], payments: [{ method: 'promptpay', amount: 200, intentId: intent.id }] });
    assert.equal(wrong.status, 409);
    const good = await sell({ items: [{ productId: state.productId, quantity: 1 }], payments: [{ method: 'promptpay', amount: 100, intentId: intent.id }] });
    assert.equal(good.status, 201, JSON.stringify(good.body));
    state.orderIds.push(good.body.data.id);
    assert.equal(good.body.data.payments[0].reference, ref);
    assert.equal(good.body.data.change, 0);

    // the same payment cannot buy a second bill
    const again = await sell({ items: [{ productId: state.productId, quantity: 1 }], payments: [{ method: 'promptpay', amount: 100, intentId: intent.id }] });
    assert.equal(again.status, 409);
    assert.match(again.body.error.message, /ถูกใช้/);
    const row = await db.one('SELECT status, order_id FROM payment_intents WHERE id = :id', { id: intent.id });
    assert.equal(row.status, 'used');
    assert.equal(Number(row.order_id), good.body.data.id);
  });

  test('cancelled / unknown intents and cash tenders cannot claim', async () => {
    const made = (await cashier.post('/api/pos/payment-intents', { amount: 50 })).body.data;
    assert.equal((await cashier.post(`/api/pos/payment-intents/${made.id}/cancel`, {})).body.data.status, 'cancelled');
    const ref = (await db.one('SELECT provider_ref FROM payment_intents WHERE id = :id', { id: made.id })).provider_ref;
    await pay(webhookKey, { providerRef: ref }); // too late: not pending any more
    assert.equal((await cashier.get(`/api/pos/payment-intents/${made.id}`)).body.data.status, 'cancelled');
    const s = await sell({ items: [{ productId: state.productId, quantity: 1 }], payments: [{ method: 'promptpay', amount: 100, intentId: 999999 }] });
    assert.equal(s.status, 400);
    const m = (await cashier.post('/api/pos/payment-intents', { amount: 100 })).body.data;
    const ref2 = (await db.one('SELECT provider_ref FROM payment_intents WHERE id = :id', { id: m.id })).provider_ref;
    await pay(webhookKey, { providerRef: ref2 });
    const cash = await sell({ items: [{ productId: state.productId, quantity: 1 }], payments: [{ method: 'cash', amount: 100, intentId: m.id }] });
    assert.equal(cash.status, 400);
  });

  test('an intent from another shift cannot be claimed', async () => {
    const m = (await cashier.post('/api/pos/payment-intents', { amount: 100 })).body.data;
    const ref = (await db.one('SELECT provider_ref FROM payment_intents WHERE id = :id', { id: m.id })).provider_ref;
    await pay(webhookKey, { providerRef: ref });
    await db.query('UPDATE payment_intents SET shift_id = shift_id + 100000 WHERE id = :id', { id: m.id }).catch(() => {});
    const s = await sell({ items: [{ productId: state.productId, quantity: 1 }], payments: [{ method: 'promptpay', amount: 100, intentId: m.id }] });
    assert.ok([409, 400].includes(s.status), String(s.status));
  });
});

describe('GB Prime Pay', () => {
  const realFetch = global.fetch;
  const calls = [];
  const txns = new Map(); // referenceNo -> enquiry answer
  let gbKey;

  before(() => {
    global.fetch = async (url, init = {}) => {
      const u = new URL(url);
      calls.push({ host: u.host, path: u.pathname, init });
      const json = (b, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'Content-Type': 'application/json' } });
      if (u.pathname === '/v3/qrcode/text') return json({ resultCode: '00', referenceNo: new URLSearchParams(init.body).get('referenceNo'), qrcode: '00020101021230830016A0000006770101120115010556' });
      if (u.pathname === '/v1/check_status_txn') {
        const ref = JSON.parse(init.body).referenceNo;
        return json(txns.get(ref) ?? { resultCode: '02', resultMessage: 'not found' });
      }
      if (u.pathname === '/checkCustomerKey') return json({ resultCode: '00', merchantName: 'ร้านทดสอบ' });
      if (u.pathname === '/checkPrivateKey') return json({ resultCode: '00' });
      return json({ message: 'unexpected' }, 404);
    };
  });
  after(() => {
    global.fetch = realFetch;
  });

  test('keys are checked, saved one at a time, and the sandbox switch picks the test server', async () => {
    assert.equal((await manager.put('/api/pos/payment-gateway', { provider: 'gbprimepay', enabled: true, credentials: { token: 'short' } })).status, 400);
    const token = 'tok_' + 'a'.repeat(40);
    const secret = 'sec_' + 'b'.repeat(28);
    const saved = await manager.put('/api/pos/payment-gateway', { provider: 'gbprimepay', enabled: true, credentials: { token, secretKey: secret, sandbox: '1' } });
    assert.equal(saved.status, 200, JSON.stringify(saved.body));
    assert.equal(saved.body.data.mode, 'test');
    assert.equal(saved.body.data.flags.sandbox, true);
    assert.equal(JSON.stringify(saved.body).includes('aaaaaaaa'), false);
    gbKey = saved.body.data.webhookKey;
    // changing only the switch keeps both keys
    const live = await manager.put('/api/pos/payment-gateway', { provider: 'gbprimepay', enabled: true, credentials: { sandbox: '' } });
    assert.equal(live.body.data.mode, 'live');
    assert.equal((await manager.put('/api/pos/payment-gateway', { provider: 'gbprimepay', enabled: true, credentials: { sandbox: '1' } })).body.data.mode, 'test');

    const t = await manager.post('/api/pos/payment-gateway/test', {});
    assert.equal(t.status, 200, JSON.stringify(t.body));
    assert.equal(t.body.data.account, 'ร้านทดสอบ');
    const priv = calls.find((c) => c.path === '/checkPrivateKey');
    assert.equal(priv.host, 'api.globalprimepay.com');
    assert.equal(priv.init.headers.Authorization, `Basic ${Buffer.from(`${secret}:`).toString('base64')}`);
  });

  test('QR from the token; paid only when the enquiry says so; then the sale claims it', async () => {
    const made = await cashier.post('/api/pos/payment-intents', { amount: 100 });
    assert.equal(made.status, 201, JSON.stringify(made.body));
    assert.match(made.body.data.qrPayload, /^000201/);
    const qrCall = calls.filter((c) => c.path === '/v3/qrcode/text').at(-1);
    const form = new URLSearchParams(qrCall.init.body);
    assert.equal(form.get('amount'), '100.00');
    assert.match(form.get('referenceNo'), /^\d{15}$/);
    assert.ok(form.get('token').startsWith('tok_'));
    const ref = form.get('referenceNo');

    // the webhook body is not believed: the enquiry has nothing yet
    const early = await request(app).post(`/api/public/payments/gbprimepay/${gbKey}`).send({ referenceNo: ref, resultCode: '00', amount: 100 });
    assert.equal(early.body.status, 'pending');
    // an enquiry for another reference or an unclear status is not a payment either
    txns.set(ref, { resultCode: '00', txn: { referenceNo: 'other', status: 'S', amount: 100 } });
    assert.equal((await request(app).post(`/api/public/payments/gbprimepay/${gbKey}`).send({ referenceNo: ref })).body.status, 'pending');
    txns.set(ref, { resultCode: '00', txn: { referenceNo: ref, status: 'P', amount: 100 } });
    assert.equal((await request(app).post(`/api/public/payments/gbprimepay/${gbKey}`).send({ referenceNo: ref })).body.status, 'pending');

    // form-encoded webhooks work too
    txns.set(ref, { resultCode: '00', txn: { referenceNo: ref, resultCode: '00', status: 'S', amount: '100.00', gbpReferenceNo: 'gbp1' } });
    const paid = await request(app).post(`/api/public/payments/gbprimepay/${gbKey}`).type('form').send({ referenceNo: ref, resultCode: '00' });
    assert.equal(paid.status, 200);
    assert.equal(paid.body.status, 'paid');
    const sale = await sell({ items: [{ productId: state.productId, quantity: 1 }], payments: [{ method: 'promptpay', amount: 100, intentId: made.body.data.id }] });
    assert.equal(sale.status, 201, JSON.stringify(sale.body));
    state.orderIds.push(sale.body.data.id);
    assert.equal(sale.body.data.payments[0].reference, ref);
  });

  test('a paid amount that differs from the bill is not accepted', async () => {
    const made = (await cashier.post('/api/pos/payment-intents', { amount: 100 })).body.data;
    const ref = new URLSearchParams(calls.filter((c) => c.path === '/v3/qrcode/text').at(-1).init.body).get('referenceNo');
    txns.set(ref, { resultCode: '00', txn: { referenceNo: ref, status: 'S', amount: 1 } });
    const r = await request(app).post(`/api/public/payments/gbprimepay/${gbKey}`).send({ referenceNo: ref });
    assert.equal(r.body.status, 'failed');
    assert.equal((await cashier.get(`/api/pos/payment-intents/${made.id}`)).body.data.status, 'failed');
  });
});
