'use strict';

// Till helpers for a new cashier: manager PIN approval, open-price items, products without a typed code,
// and finding a bill by amount / product instead of its number.
process.env.NODE_ENV = 'test';

const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { createApp } = require('../src/app');
const db = require('../src/db/pool');
const approvals = require('../src/modules/pos/approvals');

const app = createApp();
const RUN = Date.now().toString(36);
const state = { productIds: [], orderIds: [] };
let manager;
let cashier;

async function cookie(email) {
  const res = await request(app).post('/api/auth/login').send({ email, password: 'Admin@1234' });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  return res.headers['set-cookie'].map((c) => c.split(';')[0]).join('; ');
}
const as = (c) => ({
  get: (url) => request(app).get(url).set('Cookie', c),
  post: (url, body, headers = {}) => request(app).post(url).set('Cookie', c).set(headers).send(body),
  put: (url, body) => request(app).put(url).set('Cookie', c).send(body),
});
const sell = async (body, headers) => {
  const res = await cashier.post('/api/pos/checkout', { payments: [{ method: 'cash', amount: 100000 }], ...body }, headers);
  if (res.status === 201) state.orderIds.push(res.body.data.id);
  return res;
};

before(async () => {
  manager = as(await cookie('manager@example.com'));
  cashier = as(await cookie('cashier@example.com')); // branch 2 -> warehouse 2
  await db.query('UPDATE pos_shifts SET closed_at = UTC_TIMESTAMP() WHERE user_id = 4 AND closed_at IS NULL');
  await db.query("DELETE FROM settings WHERE org_id = 1 AND setting_key LIKE 'pos.%'");
  const p = await manager.post('/api/products', { sku: `TA-${RUN}`, name: `น้ำดื่มทดสอบ ${RUN}`, price: 100, cost: 40 });
  assert.equal(p.status, 201, JSON.stringify(p.body));
  state.productIds.push(p.body.data.id);
  state.productId = p.body.data.id;
  await manager.post('/api/inventory/receive', { warehouseId: 2, items: [{ productId: state.productId, quantity: 20, unitCost: 40 }] });
  assert.equal((await cashier.post('/api/pos/shift/open', { openingCash: 1000 })).status, 201);
});

after(async () => {
  if (state.orderIds.length) await db.query('DELETE FROM sales_orders WHERE id IN (:ids)', { ids: state.orderIds });
  await db.query('DELETE FROM pos_shifts WHERE user_id = 4 AND opened_at > UTC_TIMESTAMP() - INTERVAL 1 HOUR');
  await db.query("UPDATE users SET pos_pin_hash = NULL WHERE email = 'manager@example.com'");
  await db.query('DELETE FROM stock_lots WHERE product_id IN (:ids)', { ids: state.productIds });
  await db.query('DELETE FROM products WHERE id IN (:ids)', { ids: state.productIds });
  await db.pool.end();
});

describe('manager PIN approval', () => {
  test('a manager sets a PIN; a cashier voids a bill and sells past the discount limit with it', async () => {
    assert.equal((await cashier.put('/api/auth/pin', { currentPassword: 'Admin@1234', pin: '2468' })).status, 403);
    assert.equal((await manager.put('/api/auth/pin', { currentPassword: 'wrong', pin: '2468' })).status, 400);
    assert.equal((await manager.put('/api/auth/pin', { currentPassword: 'Admin@1234', pin: '12' })).status, 400);
    assert.equal((await manager.put('/api/auth/pin', { currentPassword: 'Admin@1234', pin: '2468' })).status, 200);
    assert.equal((await manager.get('/api/auth/me')).body.data.user.hasPosPin, true);

    const sale = await sell({ items: [{ productId: state.productId, quantity: 1 }] });
    assert.equal(sale.status, 201, JSON.stringify(sale.body));
    const id = sale.body.data.id;
    const denied = await cashier.post(`/api/pos/orders/${id}/void`, { reason: 'ลูกค้าเปลี่ยนใจ' });
    assert.equal(denied.status, 403);
    assert.equal(denied.body.error.code, 'MANAGER_APPROVAL');

    approvals._fails.clear();
    assert.equal((await cashier.post('/api/pos/approvals', { pin: '1111', action: 'void' })).status, 400);
    const okVoid = await cashier.post('/api/pos/approvals', { pin: '2468', action: 'void' });
    assert.equal(okVoid.status, 200, JSON.stringify(okVoid.body));
    assert.ok(okVoid.body.data.managerName);
    // a ticket is for one kind of action only
    const refundTicket = (await cashier.post('/api/pos/approvals', { pin: '2468', action: 'refund' })).body.data.token;
    assert.equal((await cashier.post(`/api/pos/orders/${id}/void`, { reason: 'x' }, { 'x-manager-approval': refundTicket })).status, 403);
    const voided = await cashier.post(`/api/pos/orders/${id}/void`, { reason: 'ลูกค้าเปลี่ยนใจ' }, { 'x-manager-approval': okVoid.body.data.token });
    assert.equal(voided.status, 200, JSON.stringify(voided.body));
    assert.equal(voided.body.data.status, 'cancelled');

    // 50% off is past the cashier's 20% limit
    const big = { items: [{ productId: state.productId, quantity: 1, discount: 50 }] };
    assert.equal((await sell(big)).status, 403);
    const override = (await cashier.post('/api/pos/approvals', { pin: '2468', action: 'override' })).body.data.token;
    assert.equal((await sell(big, { 'x-manager-approval': override })).status, 201);
  });

  test('five wrong PINs lock the till out for a while', async () => {
    approvals._fails.clear();
    for (let i = 0; i < 5; i++) await cashier.post('/api/pos/approvals', { pin: '0000', action: 'refund' });
    const locked = await cashier.post('/api/pos/approvals', { pin: '2468', action: 'refund' });
    assert.equal(locked.status, 400);
    assert.match(locked.body.error.message, /5 นาที/);
    approvals._fails.clear();
  });
});

describe('open-price items and quick product create', () => {
  test('no code typed -> one is made; an open-price item sells at the typed price and keeps no stock', async () => {
    const p = await manager.post('/api/products', { name: `ถ่ายเอกสาร ${RUN}`, price: 0, openPrice: true });
    assert.equal(p.status, 201, JSON.stringify(p.body));
    state.productIds.push(p.body.data.id);
    assert.match(p.body.data.sku, /^P\d{6}-[A-Z0-9]{4}$/);
    assert.equal(p.body.data.openPrice, true);
    assert.equal((await manager.post('/api/products', { name: 'x', price: 1, openPrice: true, openingStock: { warehouseId: 2, quantity: 5 } })).status, 400);

    assert.equal((await sell({ items: [{ productId: p.body.data.id, quantity: 1 }] })).status, 400);
    const s = await sell({ items: [{ productId: p.body.data.id, quantity: 2, unitPrice: 15, name: 'ถ่ายเอกสาร A4' }] });
    assert.equal(s.status, 201, JSON.stringify(s.body));
    assert.equal(s.body.data.total, 30);
    assert.equal(s.body.data.items[0].name, 'ถ่ายเอกสาร A4');
    const level = await db.one('SELECT quantity FROM stock_levels WHERE product_id = :id', { id: p.body.data.id });
    assert.equal(level, null);

    // a refund puts nothing back on a shelf it never left
    const approval = (await cashier.post('/api/pos/approvals', { pin: '2468', action: 'refund' })).body.data.token;
    const line = s.body.data.items[0];
    const r = await cashier.post(
      `/api/pos/orders/${s.body.data.id}/returns`,
      { items: [{ orderItemId: line.id, quantity: 2 }], reason: 'พิมพ์ผิด', refundMethod: 'cash' },
      { 'x-manager-approval': approval },
    );
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.equal(await db.one('SELECT quantity FROM stock_levels WHERE product_id = :id', { id: p.body.data.id }), null);
  });
});

describe('finding a bill without its number', () => {
  test('by the amount paid or a product on it', async () => {
    const s = await sell({ items: [{ productId: state.productId, quantity: 3 }] });
    assert.equal(s.status, 201);
    const byAmount = await cashier.get('/api/pos/orders?q=300');
    assert.ok(byAmount.body.data.some((o) => o.id === s.body.data.id), JSON.stringify(byAmount.body));
    const byItem = await cashier.get(`/api/pos/orders?q=${encodeURIComponent(`ทดสอบ ${RUN}`)}`);
    assert.ok(byItem.body.data.some((o) => o.id === s.body.data.id));
    assert.ok(!(await cashier.get('/api/pos/orders?q=987654')).body.data.some((o) => o.id === s.body.data.id));
  });
});
