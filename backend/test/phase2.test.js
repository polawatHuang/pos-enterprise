'use strict';

// Phase 2 integration tests: products, inventory, POS. Requires schema.sql + seed.sql imported.
process.env.NODE_ENV = 'test';

const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { createApp } = require('../src/app');
const db = require('../src/db/pool');

const app = createApp();
const SKU = `TEST-${Date.now()}`;
const state = { productId: 0, orderIds: [], shiftIds: [] };
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
  patch: (url, body) => request(app).patch(url).set('Cookie', c).send(body),
  put: (url, body) => request(app).put(url).set('Cookie', c).send(body),
});
const stockIn = async (warehouseId) => {
  const row = await db.one('SELECT quantity FROM stock_levels WHERE warehouse_id = :w AND product_id = :p AND variant_id = 0', {
    w: warehouseId,
    p: state.productId,
  });
  return Number(row?.quantity ?? 0);
};

before(async () => {
  manager = as(await cookie('manager@example.com'));
  cashier = as(await cookie('cashier@example.com')); // branch 2 -> warehouse 2
  // A previous aborted run may have left the cashier's shift open
  await db.query("UPDATE pos_shifts SET closed_at = UTC_TIMESTAMP() WHERE user_id = 4 AND closed_at IS NULL");
  await db.query("DELETE FROM settings WHERE org_id = 1 AND setting_key = 'pos.promptpay_id'");
});

after(async () => {
  if (state.orderIds.length) await db.query('DELETE FROM sales_orders WHERE id IN (:ids)', { ids: state.orderIds });
  if (state.shiftIds.length) await db.query('DELETE FROM pos_shifts WHERE id IN (:ids)', { ids: state.shiftIds });
  await db.query("DELETE FROM products WHERE sku LIKE 'TEST-%'");
  await db.query("DELETE FROM settings WHERE org_id = 1 AND setting_key = 'pos.promptpay_id'");
  await db.pool.end();
});

describe('products', () => {
  test('manager creates a product; duplicates are rejected', async () => {
    const res = await manager.post('/api/products', {
      sku: SKU,
      barcode: `99${Date.now()}`,
      name: 'สินค้าทดสอบ',
      price: 107,
      cost: 50,
      categoryId: 1,
      reorderPoint: 3,
    });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    state.productId = res.body.data.id;
    assert.equal(res.body.data.onHand, 0);

    const dup = await manager.post('/api/products', { sku: SKU, name: 'ซ้ำ', price: 1 });
    assert.equal(dup.status, 409);
  });

  test('search, update, and permission checks', async () => {
    const list = await manager.get(`/api/products?q=${SKU}`);
    assert.equal(list.body.meta.total, 1);
    const upd = await manager.patch(`/api/products/${state.productId}`, { price: 214 });
    assert.equal(upd.body.data.price, 214);
    await manager.patch(`/api/products/${state.productId}`, { price: 107 });
    assert.equal((await cashier.post('/api/products', { sku: 'X', name: 'X', price: 1 })).status, 403);
  });

  test('AI knowledge entries can be added and listed', async () => {
    const add = await manager.post(`/api/products/${state.productId}/knowledge`, { question: 'ใช้ยังไง', answer: 'ทาวันละครั้ง' });
    assert.equal(add.status, 201);
    const list = await manager.get(`/api/products/${state.productId}/knowledge`);
    assert.equal(list.body.data.length, 1);
  });
});

describe('inventory', () => {
  test('receive updates stock and moving-average cost', async () => {
    const res = await manager.post('/api/inventory/receive', {
      warehouseId: 2,
      items: [{ productId: state.productId, quantity: 10, unitCost: 70 }],
    });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(await stockIn(2), 10);
    const p = await manager.get(`/api/products/${state.productId}`);
    assert.equal(p.body.data.cost, 70); // was 50 with zero stock -> resets to incoming cost
  });

  test('adjust to a counted quantity and transfer between warehouses', async () => {
    const adj = await manager.post('/api/inventory/adjust', { warehouseId: 2, productId: state.productId, countedQuantity: 12, reason: 'นับสต๊อก' });
    assert.equal(adj.status, 200, JSON.stringify(adj.body));
    assert.equal(await stockIn(2), 12);

    const tr = await manager.post('/api/inventory/transfer', { fromWarehouseId: 2, toWarehouseId: 1, items: [{ productId: state.productId, quantity: 2 }] });
    assert.equal(tr.status, 201);
    assert.equal(await stockIn(2), 10);
    assert.equal(await stockIn(1), 2);

    const tooMuch = await manager.post('/api/inventory/transfer', { fromWarehouseId: 1, toWarehouseId: 2, items: [{ productId: state.productId, quantity: 5 }] });
    assert.equal(tooMuch.status, 409);
    assert.equal(await stockIn(1), 2, 'failed transfer must not change stock');

    const moves = await manager.get(`/api/inventory/movements?productId=${state.productId}`);
    assert.equal(moves.body.data.length, 4);
  });

  test('cashier cannot adjust stock', async () => {
    const res = await cashier.post('/api/inventory/adjust', { warehouseId: 2, productId: state.productId, delta: 1, reason: 'x' });
    assert.equal(res.status, 403);
  });
});

describe('POS', () => {
  test('selling requires an open shift', async () => {
    const res = await cashier.post('/api/pos/checkout', { items: [{ productId: state.productId, quantity: 1 }], payment: { method: 'cash' } });
    assert.equal(res.status, 409);
  });

  test('open shift, then cash checkout computes VAT, change and deducts stock', async () => {
    const open = await cashier.post('/api/pos/shift/open', { openingCash: 500 });
    assert.equal(open.status, 201, JSON.stringify(open.body));
    assert.equal(open.body.data.branchId, 2);
    state.shiftIds.push(open.body.data.id);

    const res = await cashier.post('/api/pos/checkout', {
      items: [{ productId: state.productId, quantity: 2 }],
      payment: { method: 'cash', amountReceived: 300 },
    });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    state.orderIds.push(res.body.data.id);
    assert.equal(res.body.data.total, 214);
    assert.equal(res.body.data.vatAmount, 14);
    assert.equal(res.body.data.change, 86);
    assert.match(res.body.data.orderNo, /^POS02-\d{7}$/);
    assert.equal(await stockIn(2), 8);
  });

  test('cashier limits: price override and large discounts need a manager', async () => {
    const override = await cashier.post('/api/pos/checkout', {
      items: [{ productId: state.productId, quantity: 1, unitPrice: 1 }],
      payment: { method: 'card' },
    });
    assert.equal(override.status, 403);
    const discount = await cashier.post('/api/pos/checkout', {
      items: [{ productId: state.productId, quantity: 1 }],
      discount: 50,
      payment: { method: 'card' },
    });
    assert.equal(discount.status, 403);
  });

  test('insufficient stock rolls back the whole bill', async () => {
    const res = await cashier.post('/api/pos/checkout', {
      items: [{ productId: state.productId, quantity: 100 }],
      payment: { method: 'transfer' },
    });
    assert.equal(res.status, 409);
    assert.equal(await stockIn(2), 8);
  });

  test('short cash payment is rejected', async () => {
    const res = await cashier.post('/api/pos/checkout', {
      items: [{ productId: state.productId, quantity: 1 }],
      payment: { method: 'cash', amountReceived: 10 },
    });
    assert.equal(res.status, 400);
  });

  test('only managers may void; void restocks and reverses cash', async () => {
    const orderId = state.orderIds[0];
    assert.equal((await cashier.post(`/api/pos/orders/${orderId}/void`, { reason: 'ลูกค้าเปลี่ยนใจ' })).status, 403);
    const res = await manager.post(`/api/pos/orders/${orderId}/void`, { reason: 'ลูกค้าเปลี่ยนใจ' });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.data.status, 'cancelled');
    assert.equal(await stockIn(2), 10);
    assert.equal((await manager.post(`/api/pos/orders/${orderId}/void`, { reason: 'ซ้ำ' })).status, 409);
  });

  test('closing the shift reconciles expected cash', async () => {
    const sale = await cashier.post('/api/pos/checkout', {
      items: [{ productId: state.productId, quantity: 1 }],
      payment: { method: 'cash', amountReceived: 107 },
    });
    state.orderIds.push(sale.body.data.id);
    const close = await cashier.post('/api/pos/shift/close', { closingCash: 600 });
    assert.equal(close.status, 200, JSON.stringify(close.body));
    // 500 opening + 214 sale - 214 void + 107 sale = 607
    assert.equal(close.body.data.expectedCash, 607);
    assert.equal(close.body.data.difference, -7);
    assert.equal((await cashier.get('/api/pos/shift')).body.data, null);
  });

  test('PromptPay QR requires a configured ID', async () => {
    assert.equal((await cashier.get('/api/pos/promptpay?amount=100')).status, 400);
    assert.equal((await cashier.put('/api/pos/settings', { promptpayId: '0812345678' })).status, 403);
    assert.equal((await manager.put('/api/pos/settings', { promptpayId: '12345' })).status, 400);
    assert.equal((await manager.put('/api/pos/settings', { promptpayId: '0812345678' })).status, 200);
    const qr = await cashier.get('/api/pos/promptpay?amount=100');
    assert.equal(qr.status, 200);
    assert.match(qr.body.data.payload, /^000201010212.*5406100\.00.*6304[0-9A-F]{4}$/);
  });
});
