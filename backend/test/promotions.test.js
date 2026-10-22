'use strict';

/** POS promotions: time discounts, bundles, multi-buy, per branch, best price, up-sell hints. */
process.env.NODE_ENV = 'test';
const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { createApp } = require('../src/app');
const db = require('../src/db/pool');
const { priceCart, isRunning } = require('../src/modules/pos/promotions');
const { localTime } = require('../src/utils/dates');

const app = createApp();
const RUN = Date.now().toString(36).slice(-6);
const state = { p: {}, categoryId: 0, promoIds: [], orderIds: [] };
let admin;
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
  patch: (url, body) => request(app).patch(url).set('Cookie', c).send(body),
  del: (url) => request(app).delete(url).set('Cookie', c),
});
const promo = async (body, who = admin) => {
  const r = await who.post('/api/pos/promotions', body);
  if (r.status === 201) state.promoIds.push(r.body.data.id);
  return r;
};
const sell = async (items) => {
  const r = await cashier.post('/api/pos/checkout', { items, payments: [{ method: 'cash', amount: 10000 }] });
  if (r.status === 201) state.orderIds.push(r.body.data.id);
  return r;
};
const hhmm = (minutes) => {
  const [h, m] = localTime().split(':').map(Number);
  const t = (((h * 60 + m + minutes) % 1440) + 1440) % 1440;
  return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
};

describe('priceCart (pure)', () => {
  const P = (o) => ({ isActive: true, daysMask: 127, branches: [], ...o });
  const L = (productId, price, quantity, categoryId = null, markdown = 0) => ({ productId, price, quantity, categoryId, markdown });
  const twoFor39 = P({ id: 1, name: '2 ชิ้น 39', kind: 'multi_buy', discountType: 'set_price', value: 39, slots: [{ qty: 2, productIds: [10, 11], categoryIds: [] }] });
  const tenPct = P({ id: 2, name: 'ลด 10%', kind: 'time_discount', discountType: 'percent', value: 10, slots: [{ qty: 1, productIds: [], categoryIds: [5] }] });
  const pair = P({ id: 3, name: 'คู่ 50', kind: 'bundle', discountType: 'set_price', value: 50, slots: [{ qty: 1, productIds: [20], categoryIds: [] }, { qty: 1, productIds: [21], categoryIds: [] }] });

  test('mix and match takes the most expensive pieces, repeats per set', () => {
    assert.equal(priceCart([L(10, 25, 1), L(11, 22, 1)], [twoFor39]).total, 8);
    assert.equal(priceCart([L(10, 25, 3)], [twoFor39]).total, 11); // one set, the third piece full price
    assert.equal(priceCart([L(10, 25, 4)], [twoFor39]).total, 22);
  });
  test('stacks in layers: time discount, then the set is priced from the lowered prices', () => {
    // 2 x 100, 10% off now (-20) -> 180; "2 pieces 10% off" on 180 (-18): customer pays 162
    const pctDeal = { ...twoFor39, discountType: 'percent', value: 10 };
    const r = priceCart([L(10, 100, 2, 5)], [pctDeal, tenPct]);
    assert.equal(r.total, 38);
    assert.equal(r.applied.length, 2);
    assert.match(r.lines[0].promotionName, /\+/);
    // a set price never charges more than the already-lowered pieces
    assert.equal(priceCart([L(10, 100, 2, 5)], [{ ...twoFor39, value: 190 }, tenPct]).total, 20);
    assert.equal(priceCart([L(10, 25, 2, 5)], [twoFor39, tenPct]).total, 11); // 45 after 10% -> set 39
  });
  test('bundle A+B stacks on a near-expiry markdown', () => {
    const r = priceCart([L(20, 35, 1), L(21, 30, 1)], [pair]);
    assert.equal(r.total, 15);
    assert.equal(r.lines[0].promoDiscount + r.lines[1].promoDiscount, 15);
    // A carries a 10% markdown (3.50): 31.50 + 30 = 61.50 -> set 50 takes 11.50 more
    const md = priceCart([L(20, 35, 1, null, 3.5), L(21, 30, 1)], [pair]);
    assert.deepEqual([md.total, md.lines[0].markdownKept], [11.5, 3.5]);
    // a big markdown already below the set price: the set adds nothing
    const big = priceCart([L(20, 35, 1, null, 20), L(21, 30, 1)], [pair]);
    assert.deepEqual([big.total, big.lines[0].markdownKept], [0, 20]);
  });
  test('pack lines stay out of promotions', () => {
    assert.equal(priceCart([{ ...L(10, 25, 2), eligible: false }], [twoFor39]).total, 0);
  });
  test('schedule: dates, weekdays and windows across midnight', () => {
    const at = { date: '2026-10-22', weekday: 4, time: '23:30' };
    assert.equal(isRunning(P({ timeFrom: '22:00', timeTo: '02:00' }), at), true);
    assert.equal(isRunning(P({ timeFrom: '22:00', timeTo: '02:00' }), { ...at, time: '12:00' }), false);
    assert.equal(isRunning(P({ daysMask: 0b0000001 }), at), false); // Sundays only
    assert.equal(isRunning(P({ startsOn: '2026-10-23' }), at), false);
    assert.equal(isRunning(P({ endsOn: '2026-10-21' }), at), false);
    assert.equal(isRunning(P({ isActive: false }), at), false);
  });
});

describe('promotions at the till', () => {
  before(async () => {
    admin = as(await cookie('admin@example.com'));
    manager = as(await cookie('manager@example.com')); // branch 1, no settings:manage
    cashier = as(await cookie('cashier@example.com')); // branch 2 -> warehouse 2
    await db.query('UPDATE pos_shifts SET closed_at = UTC_TIMESTAMP() WHERE user_id IN (2, 4) AND closed_at IS NULL');
    const c = await manager.post('/api/products/categories', { name: `ขนมโปร ${RUN}` });
    assert.equal(c.status, 201, JSON.stringify(c.body));
    state.categoryId = c.body.data.id;
    const mk = async (key, name, price, categoryId = null) => {
      const r = await manager.post('/api/products', { sku: `PR-${RUN}-${key}`, name, price, cost: 10, categoryId });
      assert.equal(r.status, 201, JSON.stringify(r.body));
      state.p[key] = r.body.data.id;
      await manager.post('/api/inventory/receive', { warehouseId: 2, items: [{ productId: r.body.data.id, quantity: 30, unitCost: 10 }] });
    };
    await mk('A', 'ขนม A', 25, state.categoryId);
    await mk('B', 'ขนม B', 22, state.categoryId);
    await mk('C', 'กาแฟเย็น', 35);
    await mk('D', 'ครัวซองต์', 30);
    assert.equal((await cashier.post('/api/pos/shift/open', { openingCash: 1000 })).status, 201);
  });

  after(async () => {
    if (state.orderIds.length) await db.query('DELETE FROM sales_orders WHERE id IN (:ids)', { ids: state.orderIds });
    await db.query('DELETE FROM pos_shifts WHERE user_id IN (2, 4) AND opened_at > UTC_TIMESTAMP() - INTERVAL 1 HOUR');
    if (state.promoIds.length) await db.query('DELETE FROM pos_promotions WHERE id IN (:ids)', { ids: state.promoIds });
    await db.query("DELETE FROM products WHERE sku LIKE 'PR-%'");
    if (state.categoryId) await db.query('DELETE FROM product_categories WHERE id = :id', { id: state.categoryId });
    require('../src/modules/pos/promotions').clearCache(1);
    await db.pool.end();
  });

  test('create: validation, permissions and branch scope', async () => {
    const base = { name: '2 ชิ้น 39', kind: 'multi_buy', discountType: 'set_price', value: 39, branchIds: [2], slots: [{ qty: 2, categoryIds: [state.categoryId] }] };
    assert.equal((await promo(base, cashier)).status, 403);
    assert.equal((await promo({ ...base, slots: [{ qty: 1, categoryIds: [state.categoryId] }] })).status, 400); // multi-buy needs 2+
    assert.equal((await promo({ ...base, kind: 'bundle' })).status, 400); // bundle needs A and B
    assert.equal((await promo({ ...base, discountType: 'percent', value: 120 })).status, 400);
    // a branch manager runs promotions for their own branch only
    assert.equal((await promo(base, manager)).status, 403);
    const own = await promo({ ...base, name: 'โปรสาขาหลัก', branchIds: [] }, manager);
    assert.equal(own.status, 201, JSON.stringify(own.body));
    const list = (await manager.get('/api/pos/promotions')).body.data;
    assert.deepEqual(list.find((p) => p.id === own.body.data.id).branches, [1]);

    const r = await promo(base);
    assert.equal(r.status, 201, JSON.stringify(r.body));
    state.multi = r.body.data.id;
    const b = await promo({ name: 'กาแฟ+ครัวซองต์ 50', kind: 'bundle', discountType: 'set_price', value: 50, branchIds: [2], slots: [{ qty: 1, productIds: [state.p.C] }, { qty: 1, productIds: [state.p.D] }] });
    assert.equal(b.status, 201, JSON.stringify(b.body));
    // a 10% coffee hour running right now
    const t = await promo({ name: 'กาแฟลด 10%', kind: 'time_discount', discountType: 'percent', value: 10, branchIds: [2], timeFrom: hhmm(-60), timeTo: hhmm(60), slots: [{ productIds: [state.p.C] }] });
    assert.equal(t.status, 201, JSON.stringify(t.body));
    state.timed = t.body.data.id;
    assert.equal((await admin.get('/api/pos/promotions')).body.data.find((p) => p.id === state.timed).status, 'running');
  });

  test('catalog tags and an up-sell hint for an unfinished deal', async () => {
    const cat = (await cashier.get(`/api/pos/catalog?ids=${state.p.A},${state.p.C}`)).body.data;
    const a = cat.find((i) => i.id === state.p.A);
    const c = cat.find((i) => i.id === state.p.C);
    assert.ok(a.promos.some((t) => t.label === '2 ชิ้น ฿39'), JSON.stringify(a.promos));
    assert.equal(c.promoPrice, 31.5);

    const q = (await cashier.post('/api/pos/quote', { items: [{ productId: state.p.A, quantity: 1 }] })).body.data;
    assert.equal(q.total, 0);
    const hint = q.suggestions.find((s) => s.promotionId === state.multi);
    assert.ok(hint, JSON.stringify(q.suggestions));
    assert.equal(hint.need, 1);
    assert.ok(hint.items.some((i) => i.id === state.p.A || i.id === state.p.B));
    assert.ok(hint.saving > 0);
  });

  test('checkout charges the quoted price; the receipt names the deal', async () => {
    const items = [{ productId: state.p.A, quantity: 1 }, { productId: state.p.B, quantity: 1 }];
    const q = (await cashier.post('/api/pos/quote', { items })).body.data;
    assert.equal(q.total, 8);
    const r = await sell(items);
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.equal(r.body.data.total, 39);
    assert.equal(r.body.data.promoDiscount, 8);
    assert.ok(r.body.data.items.every((i) => i.promotionName === '2 ชิ้น 39'));
    state.order1 = r.body.data;

    // coffee: 10% now (35 -> 31.50) stacks with the pair deal priced from it (61.50 -> 50)
    const pair = await sell([{ productId: state.p.C, quantity: 1 }, { productId: state.p.D, quantity: 1 }]);
    assert.equal(pair.status, 201, JSON.stringify(pair.body));
    assert.equal(pair.body.data.total, 50);
    assert.equal(pair.body.data.promoDiscount, 15);
    assert.match(pair.body.data.items.find((i) => i.productId === state.p.C).promotionName, /กาแฟ/);
    const coffee = await sell([{ productId: state.p.C, quantity: 2 }]);
    assert.equal(coffee.body.data.total, 63);
  });

  test('a branch-2 promotion does not apply at branch 1', async () => {
    assert.equal((await manager.post('/api/pos/shift/open', { branchId: 1, openingCash: 0 })).status, 201);
    const q = (await manager.post('/api/pos/quote', { items: [{ productId: state.p.C, quantity: 1 }, { productId: state.p.D, quantity: 1 }] })).body.data;
    assert.equal(q.total, 0);
    await db.query('UPDATE pos_shifts SET closed_at = UTC_TIMESTAMP() WHERE user_id = 2 AND closed_at IS NULL');
  });

  test('a return refunds the promotional price; switching off stops it; a used deal cannot be deleted', async () => {
    const item = state.order1.items.find((i) => i.productId === state.p.A);
    const ret = await manager.post(`/api/pos/orders/${state.order1.id}/returns`, { items: [{ orderItemId: item.id, quantity: 1 }], reason: 'x', refundMethod: 'transfer' });
    assert.equal(ret.status, 201, JSON.stringify(ret.body));
    assert.equal(ret.body.data.refund, item.lineTotal);

    assert.equal((await admin.patch(`/api/pos/promotions/${state.multi}`, { isActive: false })).status, 200);
    const q = (await cashier.post('/api/pos/quote', { items: [{ productId: state.p.A, quantity: 2 }] })).body.data;
    assert.equal(q.total, 0);
    assert.equal((await admin.del(`/api/pos/promotions/${state.multi}`)).status, 409);
    assert.equal((await manager.patch(`/api/pos/promotions/${state.timed}`, { isActive: false })).status, 403); // branch 2's
  });
});
