'use strict';

// Undo a mistaken quick stock adjustment ("ปรับยอด"): an opposite 'adjustment' movement referencing the
// original (ref_type 'movement_reversal'), once only, never for a reversal itself or other movement types,
// and never below zero stock.
process.env.NODE_ENV = 'test';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { createApp } = require('../src/app');
const db = require('../src/db/pool');

const app = createApp();
const RUN = Date.now().toString(36);
const WH = 2;
const state = { product: 0 };
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
});
const stock = async () => {
  const row = await db.one('SELECT quantity FROM stock_levels WHERE warehouse_id = :w AND product_id = :p AND variant_id = 0', { w: WH, p: state.product });
  return Number(row?.quantity ?? 0);
};
const lastMovement = async () =>
  db.one('SELECT id, type, quantity, ref_type, ref_id, note FROM stock_movements WHERE product_id = :p ORDER BY id DESC LIMIT 1', { p: state.product });
const adjust = async (body) => {
  const res = await manager.post('/api/inventory/adjust', { warehouseId: WH, productId: state.product, reason: 'ทดสอบ', ...body });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  return lastMovement();
};

before(async () => {
  manager = as(await cookie('manager@example.com'));
  cashier = as(await cookie('cashier@example.com'));
  const p = await manager.post('/api/products', { sku: `TMR-${RUN}`, name: 'สินค้าทดสอบกลับรายการปรับยอด', price: 20, cost: 10 });
  assert.equal(p.status, 201, JSON.stringify(p.body));
  state.product = p.body.data.id;
  const rcv = await manager.post('/api/inventory/receive', { warehouseId: WH, items: [{ productId: state.product, quantity: 5, unitCost: 10 }] });
  assert.equal(rcv.status, 201, JSON.stringify(rcv.body));
});

after(async () => {
  await db.query("DELETE FROM products WHERE sku LIKE 'TMR-%'"); // movements, levels and lots cascade
  await db.pool.end();
});

test('a quick adjustment is reversed once with the opposite quantity, keeping both rows', async () => {
  const adj = await adjust({ delta: 3 });
  assert.equal(await stock(), 8);
  assert.equal((await cashier.post(`/api/inventory/movements/${adj.id}/reverse`, { reason: 'x' })).status, 403, 'needs inventory:write');
  assert.equal((await manager.post(`/api/inventory/movements/${adj.id}/reverse`, {})).status, 400, 'reason required');

  const res = await manager.post(`/api/inventory/movements/${adj.id}/reverse`, { reason: 'กรอกผิด' });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.data.quantity, -3);
  assert.equal(await stock(), 5);
  const rev = await lastMovement();
  assert.equal(rev.type, 'adjustment');
  assert.equal(Number(rev.quantity), -3);
  assert.equal(rev.ref_type, 'movement_reversal');
  assert.equal(Number(rev.ref_id), adj.id);
  assert.equal(rev.note, 'กลับรายการ: กรอกผิด');
  assert.ok(await db.one('SELECT id FROM stock_movements WHERE id = :id', { id: adj.id }), 'the original stays');

  assert.equal((await manager.post(`/api/inventory/movements/${adj.id}/reverse`, { reason: 'อีกครั้ง' })).status, 409, 'reverse once');
  assert.equal((await manager.post(`/api/inventory/movements/${rev.id}/reverse`, { reason: 'กลับของกลับ' })).status, 409, 'not a reversal');
  assert.equal(await stock(), 5);

  const list = await manager.get(`/api/inventory/movements?productId=${state.product}`);
  assert.equal(list.status, 200);
  const byId = new Map(list.body.data.map((m) => [m.id, m]));
  assert.equal(byId.get(adj.id).reversed, true);
  assert.equal(byId.get(adj.id).reversible, false);
  assert.equal(byId.get(rev.id).reversible, false);
  assert.equal(byId.get(rev.id).reversed, false);

  const logs = await db.query("SELECT action FROM audit_logs WHERE entity_type = 'stock_movement' AND entity_id = :id", { id: String(adj.id) });
  assert.ok(logs.some((l) => l.action === 'inventory.adjust.reverse'));
});

test('only quick adjustments can be reversed, and never below zero stock', async () => {
  const receipt = await db.one("SELECT id FROM stock_movements WHERE product_id = :p AND type <> 'adjustment' ORDER BY id LIMIT 1", { p: state.product });
  assert.equal((await manager.post(`/api/inventory/movements/${receipt.id}/reverse`, { reason: 'x' })).status, 400, 'receipts are not reversed here');
  assert.equal((await manager.post('/api/inventory/movements/999999999/reverse', { reason: 'x' })).status, 404);

  const plus = await adjust({ delta: 4 });
  assert.equal(await stock(), 9);
  const fresh = await manager.get(`/api/inventory/movements?productId=${state.product}`);
  assert.equal(fresh.body.data.find((m) => m.id === plus.id).reversible, true);
  await adjust({ countedQuantity: 0 });
  assert.equal(await stock(), 0);
  const neg = await manager.post(`/api/inventory/movements/${plus.id}/reverse`, { reason: 'x' });
  assert.equal(neg.status, 409, 'stock would go negative');
  assert.match(neg.body.error.message, /ไม่พอ/);
  assert.equal(await stock(), 0);
  const none = await db.one("SELECT COUNT(*) AS n FROM stock_movements WHERE ref_type = 'movement_reversal' AND ref_id = :id", { id: plus.id });
  assert.equal(Number(none.n), 0);
});
