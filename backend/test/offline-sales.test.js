'use strict';

// Selling cash while the internet is down: the till sends the bill later with its own id.
process.env.NODE_ENV = 'test';

const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const request = require('supertest');
const { createApp } = require('../src/app');
const db = require('../src/db/pool');

const app = createApp();
const RUN = Date.now().toString(36);
const state = { productId: 0, orderIds: [] };
let manager;
let admin;
let cashier;

async function cookie(email) {
  const res = await request(app).post('/api/auth/login').send({ email, password: 'Admin@1234' });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  return res.headers['set-cookie'].map((c) => c.split(';')[0]).join('; ');
}
const as = (c) => ({
  get: (url) => request(app).get(url).set('Cookie', c),
  post: (url, body) => request(app).post(url).set('Cookie', c).send(body),
});
const stockNow = async () => Number((await db.one('SELECT quantity FROM stock_levels WHERE warehouse_id = 2 AND product_id = :p AND variant_id = 0', { p: state.productId }))?.quantity ?? 0);
const offlineSale = (over = {}) =>
  cashier.post('/api/pos/checkout', {
    clientRef: crypto.randomUUID(),
    soldAt: new Date(Date.now() - 3600_000).toISOString(),
    items: [{ productId: state.productId, quantity: 2 }],
    payments: [{ method: 'cash', amount: 500 }],
    ...over,
  });

before(async () => {
  manager = as(await cookie('manager@example.com'));
  admin = as(await cookie('admin@example.com'));
  cashier = as(await cookie('cashier@example.com'));
  await db.query('UPDATE pos_shifts SET closed_at = UTC_TIMESTAMP() WHERE user_id = 4 AND closed_at IS NULL');
  await db.query("DELETE FROM settings WHERE org_id = 1 AND setting_key LIKE 'pos.%'");
  const p = await manager.post('/api/products', { name: `ของทดสอบออฟไลน์ ${RUN}`, price: 100, cost: 40 });
  assert.equal(p.status, 201, JSON.stringify(p.body));
  state.productId = p.body.data.id;
  await manager.post('/api/inventory/receive', { warehouseId: 2, items: [{ productId: state.productId, quantity: 3, unitCost: 40 }] });
  assert.equal((await cashier.post('/api/pos/shift/open', { openingCash: 1000 })).status, 201);
});

after(async () => {
  if (state.orderIds.length) await db.query('DELETE FROM sales_orders WHERE id IN (:ids)', { ids: state.orderIds });
  await db.query('DELETE FROM pos_promotions WHERE name LIKE :n', { n: `ทดสอบออฟไลน์%` });
  await db.query('DELETE FROM pos_shifts WHERE user_id = 4 AND opened_at > UTC_TIMESTAMP() - INTERVAL 1 HOUR');
  await db.query('DELETE FROM stock_lots WHERE product_id = :id', { id: state.productId });
  await db.query('DELETE FROM products WHERE id = :id', { id: state.productId });
  await db.pool.end();
});

describe('offline bills', () => {
  test('sent once, sent again = the same sale; sold-at time and stock follow the bill', async () => {
    const ref = crypto.randomUUID();
    const soldAt = new Date(Date.now() - 2 * 3600_000).toISOString();
    const first = await offlineSale({ clientRef: ref, soldAt, expectedTotal: 200 });
    assert.equal(first.status, 201, JSON.stringify(first.body));
    state.orderIds.push(first.body.data.id);
    assert.equal(first.body.data.total, 200);
    assert.equal(first.body.data.change, 300);
    assert.equal(first.body.data.duplicate, false);
    assert.equal(first.body.data.mismatch, null);
    assert.equal(await stockNow(), 1);
    const row = await db.one('SELECT ordered_at FROM sales_orders WHERE id = :id', { id: first.body.data.id });
    assert.ok(Math.abs(new Date(`${new Date(row.ordered_at).toISOString().slice(0, 19)}Z`).getTime() - new Date(soldAt).getTime()) < 120_000 || Math.abs(new Date(row.ordered_at).getTime() - new Date(soldAt).getTime()) < 120_000, String(row.ordered_at));

    const again = await offlineSale({ clientRef: ref, soldAt });
    assert.equal(again.status, 200, JSON.stringify(again.body));
    assert.equal(again.body.data.id, first.body.data.id);
    assert.equal(again.body.data.duplicate, true);
    assert.equal(await stockNow(), 1); // not taken twice
    // two sends at the same moment still make one sale
    const ref2 = crypto.randomUUID();
    const [a, b] = await Promise.all([offlineSale({ clientRef: ref2, items: [{ productId: state.productId, quantity: 1 }] }), offlineSale({ clientRef: ref2, items: [{ productId: state.productId, quantity: 1 }] })]);
    assert.deepEqual([a.status, b.status].sort(), [200, 201]);
    state.orderIds.push(a.body.data.id);
    assert.equal(Number((await db.one('SELECT COUNT(*) AS n FROM sales_orders WHERE client_ref = :r', { r: ref2 })).n), 1);
  });

  test('goods already left: stock may go negative; a changed price is reported, not refused', async () => {
    const before = await stockNow();
    const sale = await offlineSale({ items: [{ productId: state.productId, quantity: before + 4 }], payments: [{ method: 'cash', amount: 100000 }], expectedTotal: 1 });
    assert.equal(sale.status, 201, JSON.stringify(sale.body));
    state.orderIds.push(sale.body.data.id);
    assert.equal(await stockNow(), -4);
    assert.deepEqual(sale.body.data.mismatch, { charged: 1, recorded: sale.body.data.total });
  });

  test('plain list prices: promotions do not apply to an offline bill, but they do online', async () => {
    const promo = await admin.post('/api/pos/promotions', {
      name: `ทดสอบออฟไลน์ ${RUN}`, kind: 'time_discount', discountType: 'percent', value: 50, startsOn: null, endsOn: null, daysMask: 127, timeFrom: null, timeTo: null, branchIds: [2],
      slots: [{ qty: 1, productIds: [state.productId], categoryIds: [] }], isActive: true,
    });
    assert.equal(promo.status, 201, JSON.stringify(promo.body));
    const off = await offlineSale({ items: [{ productId: state.productId, quantity: 1 }] });
    assert.equal(off.status, 201, JSON.stringify(off.body));
    state.orderIds.push(off.body.data.id);
    assert.equal(off.body.data.total, 100);
    await manager.post('/api/inventory/receive', { warehouseId: 2, items: [{ productId: state.productId, quantity: 20, unitCost: 40 }] });
    const on = await cashier.post('/api/pos/checkout', { items: [{ productId: state.productId, quantity: 1 }], payments: [{ method: 'cash', amount: 500 }] });
    assert.equal(on.status, 201, JSON.stringify(on.body));
    state.orderIds.push(on.body.data.id);
    assert.equal(on.body.data.total, 50);
  });

  test('cash only, no codes/members, and not older than 3 days', async () => {
    assert.equal((await offlineSale({ payments: [{ method: 'promptpay', amount: 200 }] })).status, 400);
    assert.equal((await offlineSale({ discountCode: 'ABC' })).status, 400);
    assert.equal((await offlineSale({ soldAt: new Date(Date.now() - 4 * 86_400_000).toISOString() })).status, 400);
    assert.equal((await offlineSale({ soldAt: new Date(Date.now() + 3600_000).toISOString() })).status, 400);
    assert.equal((await offlineSale({ clientRef: 'not-a-uuid' })).status, 400);
  });

  test('the offline catalog lists scannable items', async () => {
    const r = await cashier.get('/api/pos/catalog/offline');
    assert.equal(r.status, 200);
    const item = r.body.data.find((i) => i.id === state.productId);
    assert.ok(item && item.price === 100 && 'barcode' in item && 'stock' in item);
    assert.equal(r.body.data.some((i) => i.openPrice), false);
  });
});
