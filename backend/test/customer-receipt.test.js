'use strict';

// The customer's receipt page (QR on the receipt): view by token, ask for a full tax invoice,
// claim the bill's points by phone; and staff issuing the tax invoice from a bill.
process.env.NODE_ENV = 'test';

const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { createApp } = require('../src/app');
const db = require('../src/db/pool');
const { isValidTaxId } = require('../src/modules/pos/tax-invoice');
const { normalizePhone } = require('../src/modules/public/receipt.routes');

const app = createApp();
const RUN = Date.now().toString(36);
const PHONE = `08${String(Date.now()).slice(-8)}`;
const state = { productId: 0, orderIds: [], customerIds: [], docIds: [] };
let manager;
let cashier;

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
const pub = { get: (u) => request(app).get(u), post: (u, b) => request(app).post(u).send(b) };
const sell = async (qty = 2) => {
  const res = await cashier.post('/api/pos/checkout', { items: [{ productId: state.productId, quantity: qty }], payments: [{ method: 'cash', amount: 100000 }] });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  state.orderIds.push(res.body.data.id);
  return res.body.data;
};

before(async () => {
  manager = as(await cookie('manager@example.com'));
  cashier = as(await cookie('cashier@example.com'));
  await db.query('UPDATE pos_shifts SET closed_at = UTC_TIMESTAMP() WHERE user_id = 4 AND closed_at IS NULL');
  await db.query("DELETE FROM settings WHERE org_id = 1 AND setting_key LIKE 'pos.%'");
  await db.query('UPDATE organizations SET vat_registered = 1 WHERE id = 1');
  const p = await manager.post('/api/products', { name: `ของทดสอบใบเสร็จ ${RUN}`, price: 107, cost: 40, vatType: 'vat7' });
  assert.equal(p.status, 201, JSON.stringify(p.body));
  state.productId = p.body.data.id;
  await manager.post('/api/inventory/receive', { warehouseId: 2, items: [{ productId: state.productId, quantity: 50, unitCost: 40 }] });
  assert.equal((await cashier.post('/api/pos/shift/open', { openingCash: 1000 })).status, 201);
});

after(async () => {
  if (state.orderIds.length) {
    await db.query('DELETE FROM documents WHERE order_id IN (:ids)', { ids: state.orderIds });
    await db.query('DELETE FROM sales_orders WHERE id IN (:ids)', { ids: state.orderIds });
  }
  await db.query('DELETE FROM customers WHERE phone = :phone', { phone: PHONE });
  await db.query('DELETE FROM pos_shifts WHERE user_id = 4 AND opened_at > UTC_TIMESTAMP() - INTERVAL 1 HOUR');
  await db.query('DELETE FROM stock_lots WHERE product_id = :id', { id: state.productId });
  await db.query('DELETE FROM products WHERE id = :id', { id: state.productId });
  await db.pool.end();
});

test('tax id check digit and phone normalising', () => {
  assert.equal(isValidTaxId('1101700230708'), true);
  assert.equal(isValidTaxId('1101700230709'), false);
  assert.equal(isValidTaxId('12345'), false);
  assert.equal(normalizePhone('081-234-5678'), '0812345678');
  assert.equal(normalizePhone('+66 81 234 5678'), '0812345678');
  assert.equal(normalizePhone('12345'), null);
});

describe('public receipt', () => {
  test('a bill has a token and the public page shows it without login; a wrong token is 404', async () => {
    const order = await sell();
    assert.match(order.receiptToken, /^[A-Za-z0-9_-]{22}$/);
    const v = await pub.get(`/api/public/r/${order.receiptToken}`);
    assert.equal(v.status, 200, JSON.stringify(v.body));
    assert.equal(v.body.data.orderNo, order.orderNo);
    assert.equal(v.body.data.total, 214);
    assert.equal(v.body.data.taxInvoice.canRequest, true);
    assert.equal(v.body.data.points.canClaim, true);
    assert.equal(v.body.data.points.wouldEarn, Math.floor(214 / 25));
    assert.equal(JSON.stringify(v.body).includes('cashier'), false); // staff identities stay private
    assert.equal((await pub.get('/api/public/r/AAAAAAAAAAAAAAAAAAAAAA')).status, 404);
    assert.equal((await pub.get('/api/public/r/short')).status, 400);
  });

  test('claim points by phone: member made, points added once, bill locked', async () => {
    const order = await sell(1);
    const url = `/api/public/r/${order.receiptToken}/member`;
    assert.equal((await pub.post(url, { phone: '123' })).status, 400);
    const r = await pub.post(url, { phone: `${PHONE.slice(0, 3)}-${PHONE.slice(3)}`, name: 'ลูกค้าทดสอบ' });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.equal(r.body.data.earned, Math.floor(107 / 25));
    assert.equal(r.body.data.created, true);
    assert.equal((await pub.post(url, { phone: PHONE })).status, 409);
    const c = await db.one('SELECT points, order_count, total_spent FROM customers WHERE phone = :phone', { phone: PHONE });
    assert.equal(Number(c.points), 4);
    assert.equal(Number(c.order_count), 1);
    assert.equal(Number(c.total_spent), 107);
    // a second bill by the same phone adds to the same member
    const again = await sell(1);
    const r2 = await pub.post(`/api/public/r/${again.receiptToken}/member`, { phone: PHONE });
    assert.equal(r2.status, 201);
    assert.equal(r2.body.data.created, false);
    assert.equal(r2.body.data.balance, 8);
    // voiding the bill takes the points back (existing rule)
    const voided = await manager.post(`/api/pos/orders/${again.id}/void`, { reason: 'ทดสอบ' });
    assert.equal(voided.status, 200, JSON.stringify(voided.body));
    assert.equal(Number((await db.one('SELECT points FROM customers WHERE phone = :phone', { phone: PHONE })).points), 4);
  });
});

describe('full tax invoice', () => {
  test('customer request -> staff issue: numbered, adds up to the bill, posts no second journal, PP.30 not doubled', async () => {
    const order = await sell(2);
    const url = `/api/public/r/${order.receiptToken}/tax-invoice`;
    const form = { name: 'บริษัท ทดสอบ จำกัด', taxId: '1101700230708', branchNo: '00000', address: '99 ถนนสุขุมวิท กรุงเทพฯ 10110' };
    assert.equal((await pub.post(url, { ...form, taxId: '1101700230709' })).status, 400);
    const req1 = await pub.post(url, form);
    assert.equal(req1.status, 201, JSON.stringify(req1.body));
    assert.equal(req1.body.data.status, 'pending');
    // the customer can fix a typo while it is still pending
    assert.equal((await pub.post(url, { ...form, name: 'บริษัท ทดสอบ 2 จำกัด' })).status, 201);
    const row = await cashier.get('/api/pos/orders?q=214');
    assert.equal(row.body.data.find((o) => o.id === order.id).taxRequest, 'pending');

    const journalsBefore = Number((await db.one("SELECT COUNT(*) AS n FROM journal_entries WHERE ref_type = 'document'")).n);
    const issued = await cashier.post(`/api/pos/orders/${order.id}/tax-invoice`, {});
    assert.equal(issued.status, 201, JSON.stringify(issued.body));
    assert.match(issued.body.data.docNo, /\d/);
    const doc = await db.one('SELECT * FROM documents WHERE order_id = :id', { id: order.id });
    state.docIds.push(doc.id);
    assert.equal(doc.party_name, 'บริษัท ทดสอบ 2 จำกัด');
    assert.equal(doc.status, 'paid');
    assert.equal(Number(doc.total), 214);
    assert.equal(Number(doc.vat_amount), 14);
    assert.equal(Number(doc.subtotal), 200);
    const lines = await db.query('SELECT line_total FROM document_items WHERE document_id = :id', { id: doc.id });
    assert.equal(lines.reduce((s, l) => s + Number(l.line_total), 0), 200);
    assert.equal(Number((await db.one("SELECT COUNT(*) AS n FROM journal_entries WHERE ref_type = 'document'")).n), journalsBefore);

    const v = await pub.get(`/api/public/r/${order.receiptToken}`);
    assert.equal(v.body.data.taxInvoice.status, 'issued');
    assert.equal(v.body.data.taxInvoice.invoice.total, 214);
    assert.equal(v.body.data.taxInvoice.canRequest, false);
    assert.equal((await pub.post(url, form)).status, 409);
    assert.equal((await cashier.post(`/api/pos/orders/${order.id}/tax-invoice`, {})).status, 409);
  });

  test('typed at the counter; refunded / unregistered shop refuse', async () => {
    const order = await sell(1);
    assert.equal((await cashier.post(`/api/pos/orders/${order.id}/tax-invoice`, { name: 'x' })).status, 400); // no tax id
    const ok = await cashier.post(`/api/pos/orders/${order.id}/tax-invoice`, { name: 'ร้านค้า ก', taxId: '1101700230708', address: '1 ถนนทดสอบ เชียงใหม่' });
    assert.equal(ok.status, 201, JSON.stringify(ok.body));
    const partial = await sell(2);
    const item = partial.items[0];
    const ret = await manager.post(`/api/pos/orders/${partial.id}/returns`, { items: [{ orderItemId: item.id, quantity: 1 }], reason: 'ทดสอบ', refundMethod: 'transfer' });
    assert.equal(ret.status, 201, JSON.stringify(ret.body));
    const refused = await cashier.post(`/api/pos/orders/${partial.id}/tax-invoice`, { name: 'ก', taxId: '1101700230708', address: 'ที่อยู่ทดสอบ 1' });
    assert.equal(refused.status, 409);
    await db.query('UPDATE organizations SET vat_registered = 0 WHERE id = 1');
    try {
      const fresh = await sell(1);
      assert.equal((await pub.get(`/api/public/r/${fresh.receiptToken}`)).body.data.taxInvoice.canRequest, false);
      assert.equal((await cashier.post(`/api/pos/orders/${fresh.id}/tax-invoice`, { name: 'ก', taxId: '1101700230708', address: 'ที่อยู่ทดสอบ 1' })).status, 409);
    } finally {
      await db.query('UPDATE organizations SET vat_registered = 1 WHERE id = 1');
    }
  });

  test('auto-issue when the shop turns it on', async () => {
    assert.equal((await manager.put('/api/pos/settings', { taxInvoiceAuto: true, lineOaId: '@myshop' })).status, 200);
    try {
      const order = await sell(1);
      const r = await pub.post(`/api/public/r/${order.receiptToken}/tax-invoice`, { name: 'บริษัท อัตโนมัติ จำกัด', taxId: '1101700230708', address: '5 ถนนทดสอบ ภูเก็ต 83000' });
      assert.equal(r.status, 201, JSON.stringify(r.body));
      assert.equal(r.body.data.status, 'issued');
      assert.equal((await pub.get(`/api/public/r/${order.receiptToken}`)).body.data.lineOaId, '@myshop');
    } finally {
      await manager.put('/api/pos/settings', { taxInvoiceAuto: false, lineOaId: '' });
    }
  });
});
