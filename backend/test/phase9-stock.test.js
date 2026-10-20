'use strict';

// Phase 9 stock ops: blind stocktake with variance approval, days-of-cover levels, stock alerts (in-app + LINE).
process.env.NODE_ENV = 'test';

const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { createApp } = require('../src/app');
const db = require('../src/db/pool');
const line = require('../src/integrations/line');
const { checkOrg } = require('../src/modules/inventory/alerts');

const app = createApp();
const RUN = Date.now().toString(36);
const originalPush = line.push;
const savedToken = process.env.LINE_CHANNEL_ACCESS_TOKEN;
const state = { productId: 0, outId: 0, categoryId: 0, countId: 0 };
const pushes = [];
let manager;
let cashier;
let marketer;

async function cookie(email) {
  const res = await request(app).post('/api/auth/login').send({ email, password: 'Admin@1234' });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  return res.headers['set-cookie'].map((c) => c.split(';')[0]).join('; ');
}
const as = (c) => ({
  get: (url) => request(app).get(url).set('Cookie', c),
  post: (url, body) => request(app).post(url).set('Cookie', c).send(body),
  put: (url, body) => request(app).put(url).set('Cookie', c).send(body),
  patch: (url, body) => request(app).patch(url).set('Cookie', c).send(body),
});
const stock = async (productId = state.productId) => {
  const row = await db.one('SELECT quantity FROM stock_levels WHERE warehouse_id = 2 AND product_id = :p AND variant_id = 0', { p: productId });
  return Number(row?.quantity ?? 0);
};

before(async () => {
  line.push = async (token, to, text) => {
    pushes.push({ token, to, text });
  };
  manager = as(await cookie('manager@example.com'));
  cashier = as(await cookie('cashier@example.com'));
  marketer = as(await cookie('marketer@example.com'));
  const cat = await manager.post('/api/products/categories', { name: `นับสต๊อก ${RUN}` });
  state.categoryId = cat.body.data.id;
  const p = await manager.post('/api/products', {
    sku: `T9S-${RUN}`,
    barcode: `77${RUN}`,
    name: 'สบู่ทดสอบนับ',
    price: 20,
    cost: 10,
    categoryId: state.categoryId,
  });
  state.productId = p.body.data.id;
  await manager.put(`/api/products/${state.productId}/units`, { units: [{ name: 'แพ็ก', factor: 4, barcode: `PK4-${RUN}` }] });
  await manager.post('/api/inventory/receive', { warehouseId: 2, items: [{ productId: state.productId, quantity: 20, unitCost: 10 }] });
  const o = await manager.post('/api/products', {
    sku: `T9S-OUT-${RUN}`,
    name: 'ของหมดทดสอบ',
    price: 5,
    cost: 2,
    reorderPoint: 5,
    categoryId: state.categoryId,
  });
  state.outId = o.body.data.id;
});

after(async () => {
  line.push = originalPush;
  if (savedToken === undefined) delete process.env.LINE_CHANNEL_ACCESS_TOKEN;
  else process.env.LINE_CHANNEL_ACCESS_TOKEN = savedToken;
  await db.query("DELETE FROM journal_entries WHERE ref_type = 'stock_count' AND ref_id = :id", { id: state.countId });
  await db.query('DELETE FROM stock_counts WHERE category_id = :c', { c: state.categoryId });
  await db.query("DELETE FROM notifications WHERE org_id = 1 AND (title LIKE '%ทดสอบ%' OR type = 'stock.low')");
  await db.query("DELETE FROM settings WHERE org_id = 1 AND setting_key LIKE 'notify.%'");
  await db.query("DELETE FROM products WHERE sku LIKE 'T9S-%'");
  await db.query('DELETE FROM product_categories WHERE id = :id', { id: state.categoryId });
  await db.pool.end();
});

describe('stocktake', () => {
  test('cashier counts blind; sales during the count are netted out; manager approves the variance', async () => {
    const create = await cashier.post('/api/inventory/counts', { warehouseId: 2, scope: 'category', categoryId: state.categoryId, blind: true });
    assert.equal(create.status, 201, JSON.stringify(create.body));
    state.countId = create.body.data.id;
    assert.match(create.body.data.countNo, /^SC\d{6}$/);
    const dup = await manager.post('/api/inventory/counts', { warehouseId: 2, scope: 'full' });
    assert.equal(dup.status, 409, 'one open count per warehouse scope');

    const view = await cashier.get(`/api/inventory/counts/${state.countId}`);
    const mine = view.body.data.items.find((i) => i.productId === state.productId);
    assert.equal(mine.snapshot, null, 'blind count hides the system quantity from counters');
    assert.equal(view.body.data.total, 2);

    // pack barcode counts 4 pieces each; product barcode adds 1
    let scan = await cashier.post(`/api/inventory/counts/${state.countId}/scan`, { code: `PK4-${RUN}`, qty: 4 });
    assert.equal(scan.status, 200, JSON.stringify(scan.body));
    assert.equal(scan.body.data.item.counted, 16);
    assert.equal(scan.body.data.added, 16);
    scan = await cashier.post(`/api/inventory/counts/${state.countId}/scan`, { code: `77${RUN}` });
    assert.equal(scan.body.data.item.counted, 17);
    assert.equal((await cashier.post(`/api/inventory/counts/${state.countId}/scan`, { code: 'NOPE' })).status, 404);

    // 3 more arrive while counting: expected becomes 23, counted 17 -> variance -6 (needs a reason: > 10%)
    await manager.post('/api/inventory/receive', { warehouseId: 2, items: [{ productId: state.productId, quantity: 3, unitCost: 10 }] });
    assert.equal((await cashier.post(`/api/inventory/counts/${state.countId}/submit`)).status, 200);
    assert.equal((await cashier.post(`/api/inventory/counts/${state.countId}/scan`, { code: `77${RUN}` })).status, 409);

    const review = await manager.get(`/api/inventory/counts/${state.countId}`);
    const row = review.body.data.items.find((i) => i.productId === state.productId);
    assert.equal(row.snapshot, 20);
    assert.equal(row.movedDuringCount, 3);
    assert.equal(row.expected, 23);
    assert.equal(row.variance, -6);
    assert.equal(row.value, -60);
    assert.equal(row.needsReason, true);

    assert.equal((await cashier.post(`/api/inventory/counts/${state.countId}/approve`)).status, 403);
    const noReason = await manager.post(`/api/inventory/counts/${state.countId}/approve`);
    assert.equal(noReason.status, 400);
    await manager.patch(`/api/inventory/counts/${state.countId}/items/${state.productId}`, { reason: 'ชำรุด' });
    const ok = await manager.post(`/api/inventory/counts/${state.countId}/approve`);
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    assert.deepEqual([ok.body.data.adjusted, ok.body.data.loss, ok.body.data.gain], [1, 60, 0]);
    assert.equal(await stock(), 17);
    const m = await db.one("SELECT quantity, note FROM stock_movements WHERE ref_type = 'stock_count' AND ref_id = :id", { id: state.countId });
    assert.equal(Number(m.quantity), -6);
    assert.match(m.note, /ชำรุด/);
    const j = await db.query(
      `SELECT a.code, l.debit, l.credit FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id JOIN chart_of_accounts a ON a.id = l.account_id
        WHERE e.ref_type = 'stock_count' AND e.ref_id = :id`,
      { id: state.countId },
    );
    assert.equal(Number(j.find((r) => r.code === '1300').credit), 60);
    assert.equal(Number(j.find((r) => r.code === '5900').debit), 60);
  });
});

describe('levels and alerts', () => {
  test('levels report velocity, days of cover and status; per-warehouse reorder point overrides', async () => {
    const set = await manager.patch('/api/inventory/levels', { warehouseId: 2, productId: state.productId, reorderPoint: 30 });
    assert.equal(set.status, 200, JSON.stringify(set.body));
    const res = await manager.get(`/api/inventory/levels?warehouseId=2&q=${RUN}`);
    const row = res.body.data.find((r) => r.productId === state.productId);
    assert.equal(row.reorderPoint, 30);
    assert.equal(row.reorderOverride, true);
    assert.equal(row.status, 'low');
    assert.equal(row.spark.length, 14);
    const out = res.body.data.find((r) => r.productId === state.outId);
    assert.equal(out.status, 'out');
    assert.equal((await cashier.patch('/api/inventory/levels', { warehouseId: 2, productId: state.productId, reorderPoint: 1 })).status, 403);
  });

  test('stock check notifies once per day, pushes LINE urgently and sends one digest', async () => {
    process.env.LINE_CHANNEL_ACCESS_TOKEN = 'test-token';
    const lineSettings = await manager.put('/api/notifications/settings', { line: { enabled: true, to: [`U${'a'.repeat(32)}`], digestTime: '00:00' } });
    assert.equal(lineSettings.status, 200, JSON.stringify(lineSettings.body));
    assert.equal((await manager.put('/api/notifications/settings', { line: { enabled: true, to: ['bad'], digestTime: '08:00' } })).status, 400);

    pushes.length = 0;
    const first = await checkOrg(1);
    assert.ok(first.newUrgent >= 1, JSON.stringify(first));
    assert.equal(first.lineError, null);
    const urgent = pushes.find((p) => p.text.includes('สินค้าหมดสต๊อก'));
    assert.ok(urgent && urgent.text.includes('ของหมดทดสอบ'));
    assert.ok(pushes.some((p) => p.text.includes('สรุปสต๊อกเช้านี้')));
    assert.equal(urgent.token, 'test-token');

    pushes.length = 0;
    const second = await checkOrg(1);
    assert.equal(second.newUrgent, 0, 'no duplicate alert on the same day');
    assert.equal(pushes.length, 0, 'digest goes out once a day');

    const list = await manager.get('/api/notifications');
    assert.ok(list.body.data.some((n) => n.type === 'stock.out' && n.title.includes('ของหมดทดสอบ')));
    const unread = await manager.get('/api/notifications/unread-count');
    assert.ok(unread.body.data.count >= 1);
    await manager.post('/api/notifications/read-all');
    assert.equal((await manager.get('/api/notifications/unread-count')).body.data.count, 0);
    // marketers have no inventory:read, so stock alerts are not theirs
    const mk = await marketer.get('/api/notifications');
    assert.ok(!mk.body.data.some((n) => n.type === 'stock.out'));
    assert.equal((await manager.post('/api/notifications/test-line')).status, 200);
  });
});
