'use strict';

// Phase 9 purchasing: order suggestions (velocity + lead time + pack size), AI adjust, PO -> partial receipt, in-transit transfers.
process.env.NODE_ENV = 'test';

const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { createApp } = require('../src/app');
const db = require('../src/db/pool');
const minimax = require('../src/integrations/minimax');
const { suggestQty } = require('../src/modules/purchasing/suggest');

const app = createApp();
const RUN = Date.now().toString(36);
const originalCreate = minimax.createMessage;
const savedKey = process.env.MINIMAX_API_KEY;
const savedProvider = process.env.AI_PROVIDER;
const state = { supplierId: 0, productId: 0, poId: 0 };
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
});
const stock = async (warehouseId) => {
  const row = await db.one('SELECT quantity FROM stock_levels WHERE warehouse_id = :w AND product_id = :p AND variant_id = 0', {
    w: warehouseId,
    p: state.productId,
  });
  return Number(row?.quantity ?? 0);
};

before(async () => {
  delete process.env.AI_PROVIDER;
  process.env.MINIMAX_API_KEY = 'test-key';
  minimax.createMessage = async () => ({
    model: 'MiniMax-M3',
    stop_reason: 'tool_use',
    content: [
      {
        type: 'tool_use',
        id: 't1',
        name: 'submit_order_adjustments',
        input: { summary: 'ใกล้วันเงินเดือนออก', items: [{ productId: state.productId, factor: 1.5, reason: 'เงินเดือนออก คนซื้อมากขึ้น' }] },
      },
    ],
  });
  manager = as(await cookie('manager@example.com'));
  cashier = as(await cookie('cashier@example.com'));
});

after(async () => {
  minimax.createMessage = originalCreate;
  if (savedKey === undefined) delete process.env.MINIMAX_API_KEY;
  else process.env.MINIMAX_API_KEY = savedKey;
  if (savedProvider !== undefined) process.env.AI_PROVIDER = savedProvider;
  await db.query('DELETE FROM purchase_orders WHERE supplier_id = :s', { s: state.supplierId });
  await db.query('DELETE FROM stock_transfers WHERE id IN (SELECT transfer_id FROM stock_transfer_items WHERE product_id = :p)', { p: state.productId });
  await db.query("DELETE FROM products WHERE sku LIKE 'T9P-%'");
  await db.query('DELETE FROM suppliers WHERE id = :s', { s: state.supplierId });
  await db.pool.end();
});

describe('suggestion math', () => {
  test('covers lead time + a week with 20% safety, minus stock and orders, rounded to the pack', () => {
    assert.equal(suggestQty({ avgDaily: 2, leadTime: 2, onHand: 5, onOrder: 0, reorderPoint: 0, maxQty: null, packSize: 6 }), 18);
    assert.equal(suggestQty({ avgDaily: 2, leadTime: 2, onHand: 5, onOrder: 18, reorderPoint: 0, maxQty: null, packSize: 6 }), 0);
    assert.equal(suggestQty({ avgDaily: 0, leadTime: 2, onHand: 1, onOrder: 0, reorderPoint: 10, maxQty: null, packSize: 1 }), 9);
    assert.equal(suggestQty({ avgDaily: 5, leadTime: 3, onHand: 0, onOrder: 0, reorderPoint: 0, maxQty: 20, packSize: 1 }), 20, 'capped at max');
  });
});

describe('ordering', () => {
  test('supplier + product with sales history gets a suggestion with a sparkline', async () => {
    assert.equal((await cashier.post('/api/purchasing/suppliers', { name: 'x' })).status, 403);
    const s = await manager.post('/api/purchasing/suppliers', { name: `ผู้ขายทดสอบ ${RUN}`, leadTimeDays: 2, phone: '021234567' });
    assert.equal(s.status, 201, JSON.stringify(s.body));
    state.supplierId = s.body.data.id;
    const p = await manager.post('/api/products', {
      sku: `T9P-${RUN}`,
      barcode: `55${RUN}`,
      name: 'น้ำแร่ทดสอบสั่ง',
      price: 12,
      cost: 7,
      supplierId: state.supplierId,
      packSize: 6,
    });
    assert.equal(p.status, 201, JSON.stringify(p.body));
    assert.equal(p.body.data.packSize, 6);
    state.productId = p.body.data.id;
    // patching one field must not reset the others (cost, pack size) to defaults
    await manager.patch(`/api/products/${state.productId}`, { price: 13 });
    const again = await manager.get(`/api/products/${state.productId}`);
    assert.deepEqual([again.body.data.price, again.body.data.cost, again.body.data.packSize, again.body.data.supplierId], [13, 7, 6, state.supplierId]);

    await manager.post('/api/inventory/receive', { warehouseId: 2, items: [{ productId: state.productId, quantity: 33 }] });
    // 2 sold per day for the last 14 days -> 28 sold, 5 left
    for (let d = 0; d < 14; d += 1) {
      await db.query(
        `INSERT INTO stock_movements (org_id, warehouse_id, product_id, variant_id, type, quantity, created_at)
         VALUES (1, 2, :p, 0, 'sale', -2, UTC_TIMESTAMP() - INTERVAL :d DAY)`,
        { p: state.productId, d },
      );
    }
    await db.query('UPDATE stock_levels SET quantity = 5 WHERE warehouse_id = 2 AND product_id = :p', { p: state.productId });

    const res = await manager.get(`/api/purchasing/suggestions?warehouseId=2&supplierId=${state.supplierId}`);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const row = res.body.data.find((r) => r.productId === state.productId);
    assert.equal(row.avgDaily, 1.6); // 0.6 x 14/7 + 0.4 x 28/28
    assert.equal(row.suggested, 18); // 1.6 x 9 x 1.2 = 17.3 - 5 -> 12.3 -> pack of 6
    assert.equal(row.spark.length, 14);
    assert.equal(row.spark[13], 2);
    assert.match(row.reason, /ขายเฉลี่ย 1\.6/);
    // the same product's stock in the org's other warehouses, so a transfer can be chosen instead
    const other = await db.one(
      'SELECT COALESCE(SUM(quantity), 0) AS q FROM stock_levels sl JOIN warehouses w ON w.id = sl.warehouse_id WHERE sl.product_id = :p AND w.org_id = 1 AND w.id <> 2',
      { p: state.productId },
    );
    assert.equal(row.otherStock, Math.max(Number(other.q), 0));
  });

  test('AI adjusts by season within limits and keeps the pack size', async () => {
    const res = await manager.post('/api/purchasing/suggestions/ai', { warehouseId: 2, items: [{ productId: state.productId, suggested: 18 }] });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.data.items[0].quantity, 30); // 18 x 1.5 = 27 -> 30
    assert.match(res.body.data.summary, /เงินเดือน/);
  });

  test('PO from the suggestion: sent, counted as on order, received in two deliveries', async () => {
    const create = await manager.post('/api/purchasing/orders', {
      supplierId: state.supplierId,
      warehouseId: 2,
      source: 'suggestion',
      send: true,
      items: [{ productId: state.productId, quantity: 18, unitCost: 8 }],
    });
    assert.equal(create.status, 201, JSON.stringify(create.body));
    state.poId = create.body.data.id;
    assert.equal(create.body.data.status, 'ordered');
    assert.match(create.body.data.poNo, /^PO\d{6}$/);
    assert.equal(create.body.data.total, 144);

    const sug = await manager.get(`/api/purchasing/suggestions?warehouseId=2&supplierId=${state.supplierId}&all=true`);
    const row = sug.body.data.find((r) => r.productId === state.productId);
    assert.equal(row.onOrder, 18);
    assert.equal(row.suggested, 0);

    const part = await manager.post(`/api/purchasing/orders/${state.poId}/receive`, { items: [{ productId: state.productId, quantity: 10 }] });
    assert.equal(part.status, 200, JSON.stringify(part.body));
    assert.equal(part.body.data.status, 'partial');
    assert.equal(await stock(2), 15);
    const cost = await db.one('SELECT cost FROM products WHERE id = :id', { id: state.productId });
    assert.equal(Number(cost.cost), 7.67); // (5 x 7 + 10 x 8) / 15
    const rest = await manager.post(`/api/purchasing/orders/${state.poId}/receive`, { items: [{ productId: state.productId, quantity: 8 }] });
    assert.equal(rest.body.data.status, 'received');
    assert.equal(await stock(2), 23);
    assert.equal((await manager.post(`/api/purchasing/orders/${state.poId}/receive`, { items: [{ productId: state.productId, quantity: 1 }] })).status, 409);
  });
});

describe('transfers', () => {
  test('ship -> in transit -> receive with a shortage; cancelling returns stock', async () => {
    const before1 = await stock(1);
    const ship = await manager.post('/api/purchasing/transfers', {
      fromWarehouseId: 2,
      toWarehouseId: 1,
      items: [{ productId: state.productId, quantity: 3 }],
    });
    assert.equal(ship.status, 201, JSON.stringify(ship.body));
    assert.equal(ship.body.data.status, 'in_transit');
    assert.equal(await stock(2), 20);
    assert.equal(await stock(1), before1, 'not at the destination until received');
    const rec = await manager.post(`/api/purchasing/transfers/${ship.body.data.id}/receive`, { items: [{ productId: state.productId, quantity: 2 }] });
    assert.equal(rec.status, 200, JSON.stringify(rec.body));
    assert.equal(rec.body.data.items[0].qtyReceived, 2);
    assert.equal(await stock(1), before1 + 2);

    const ship2 = await manager.post('/api/purchasing/transfers', {
      fromWarehouseId: 2,
      toWarehouseId: 1,
      items: [{ productId: state.productId, quantity: 5 }],
    });
    assert.equal(await stock(2), 15);
    assert.equal((await manager.post(`/api/purchasing/transfers/${ship2.body.data.id}/cancel`)).status, 200);
    assert.equal(await stock(2), 20);
    const list = await manager.get('/api/purchasing/transfers');
    assert.equal(list.body.data.find((t) => t.id === ship.body.data.id).shortage, 1);
  });
});
