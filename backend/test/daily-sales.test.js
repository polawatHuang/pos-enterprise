'use strict';

/** Daily sales summary to LINE OA: the numbers, the Flex card, once-a-day sending, settings routes. */
process.env.NODE_ENV = 'test';
const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { createApp } = require('../src/app');
const db = require('../src/db/pool');
const ds = require('../src/modules/reports/daily-sales');
const { localDate } = require('../src/utils/dates');

const app = createApp();
const RUN = Date.now().toString(36);
const TARGET = `U${'a'.repeat(32)}`;
const state = { orderIds: [], txnIds: [] };
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
});

/** Every text node of a Flex tree (LINE rejects empty texts). */
const texts = (node, out = []) => {
  if (!node || typeof node !== 'object') return out;
  if (node.type === 'text') out.push(node.text);
  for (const v of Object.values(node)) if (Array.isArray(v)) v.forEach((x) => texts(x, out));
  for (const k of ['header', 'body', 'footer', 'contents']) if (node[k] && !Array.isArray(node[k])) texts(node[k], out);
  return out;
};

before(async () => {
  admin = as(await cookie('admin@example.com'));
  manager = as(await cookie('manager@example.com'));
  cashier = as(await cookie('cashier@example.com')); // branch 2
  state.savedSettings = await db.query("SELECT setting_key, value FROM settings WHERE org_id = 1 AND setting_key IN ('notify.sales_daily', 'notify.sales_daily_on')");
  await db.query("DELETE FROM settings WHERE org_id = 1 AND setting_key IN ('notify.sales_daily', 'notify.sales_daily_on')");
  await db.query('UPDATE pos_shifts SET closed_at = UTC_TIMESTAMP() WHERE user_id = 4 AND closed_at IS NULL');
  const p = await manager.post('/api/products', { sku: `DS-${RUN}`, name: 'สินค้ารายงานรายวัน', price: 120, cost: 50 });
  assert.equal(p.status, 201, JSON.stringify(p.body));
  state.productId = p.body.data.id;
  await manager.post('/api/inventory/receive', { warehouseId: 2, items: [{ productId: state.productId, quantity: 20, unitCost: 50 }] });
  assert.equal((await cashier.post('/api/pos/shift/open', { openingCash: 500 })).status, 201);
});

after(async () => {
  if (state.orderIds.length) await db.query('DELETE FROM sales_orders WHERE id IN (:ids)', { ids: state.orderIds });
  if (state.txnIds.length) await db.query('DELETE FROM transactions WHERE id IN (:ids)', { ids: state.txnIds });
  await db.query('DELETE FROM pos_shifts WHERE user_id = 4 AND opened_at > UTC_TIMESTAMP() - INTERVAL 1 HOUR');
  await db.query("DELETE FROM products WHERE sku LIKE 'DS-%'");
  await db.query("DELETE FROM settings WHERE org_id = 1 AND setting_key IN ('notify.sales_daily', 'notify.sales_daily_on')");
  for (const s of state.savedSettings) await db.query('INSERT INTO settings (org_id, setting_key, value) VALUES (1, :k, :v)', { k: s.setting_key, v: typeof s.value === 'string' ? s.value : JSON.stringify(s.value) });
  await db.pool.end();
});

describe('the report', () => {
  test('counts today at the branch: net sales, bills, methods, voids and expenses', async () => {
    const date = localDate();
    const before0 = await ds.buildDailyReport(1, { date, branchId: 2 });
    const sell = async (payments, qty = 1) => {
      const r = await cashier.post('/api/pos/checkout', { items: [{ productId: state.productId, quantity: qty }], payments });
      assert.equal(r.status, 201, JSON.stringify(r.body));
      state.orderIds.push(r.body.data.id);
      return r.body.data;
    };
    await sell([{ method: 'cash', amount: 1000 }], 2); // 240
    await sell([{ method: 'promptpay', amount: 120, reference: 'x' }]); // 120
    const voided = await sell([{ method: 'cash', amount: 120 }]);
    assert.equal((await manager.post(`/api/pos/orders/${voided.id}/void`, { reason: 'ทดสอบ' })).status, 200);
    const t = await admin.post('/api/accounting/transactions', { type: 'expense', category: 'ค่าใช้จ่ายอื่น', amount: 55, txnDate: date, description: `ค่าน้ำแข็ง ${RUN}`, branchId: 2 });
    assert.equal(t.status, 201, JSON.stringify(t.body));
    state.txnIds.push(t.body.data.id);

    const r = await ds.buildDailyReport(1, { date, branchId: 2 });
    assert.equal(r.net - before0.net, 360);
    assert.equal(r.bills - before0.bills, 2);
    assert.equal(r.cancelled.count - before0.cancelled.count, 1);
    const m = (rep, k) => rep.methods.find((x) => x.method === k)?.amount ?? 0;
    assert.equal(r2(m(r, 'cash') - m(before0, 'cash')), 240);
    assert.equal(r2(m(r, 'promptpay') - m(before0, 'promptpay')), 120);
    assert.equal(r2(r.expense - before0.expense), 55);
    assert.equal(r.balance, r2(r.net + r.income - r.expense));
    assert.ok(r.topProducts.some((p) => p.name === 'สินค้ารายงานรายวัน' && p.qty >= 3));
    assert.ok(r.hours.length >= 1);
    assert.equal(r.branchName, (await db.one('SELECT name FROM branches WHERE id = 2')).name);
    state.report = r;
  });

  test('the Flex card: a valid bubble, no empty texts, small enough for LINE', () => {
    const msg = ds.renderFlex(state.report, { appUrl: 'https://app.example.com', scheduleTime: '18:00' });
    assert.equal(msg.type, 'flex');
    assert.equal(msg.contents.type, 'bubble');
    assert.ok(msg.altText.startsWith('สรุปยอดขาย') && msg.altText.length <= 400);
    const all = texts(msg.contents);
    assert.ok(all.length > 10);
    assert.ok(all.every((t) => typeof t === 'string' && t.length > 0), 'LINE rejects empty text');
    assert.ok(JSON.stringify(msg).length < 25_000, 'bubble under 30 KB');
    assert.ok(all.some((t) => t.includes('ยอดขายสุทธิ')));
    const btn = msg.contents.footer.contents.find((c) => c.type === 'button');
    assert.equal(btn.action.uri, 'https://app.example.com/dashboard');
    // an empty day still renders
    const empty = ds.renderFlex({ ...state.report, net: 0, bills: 0, methods: [], hours: [], branches: [], topProducts: [], vsYesterday: { net: 0, pct: null }, vsLastWeek: { net: 0, pct: null } });
    assert.ok(texts(empty.contents).includes('วันนี้ไม่มียอดขาย'));
  });
});

describe('sending', () => {
  test('sends once a day after the set time, only when switched on', async () => {
    const pushes = [];
    const push = async (to, msgs) => pushes.push({ to, msgs });
    // LINE token: the test DB may have none; give the job one
    process.env.LINE_CHANNEL_ACCESS_TOKEN ||= 'test-token';
    const evening = new Date(`${localDate()}T11:30:00Z`); // 18:30 in +07:00
    await ds.saveSetting(1, ds.SETTINGS_KEY, { enabled: false, time: '18:00', to: [TARGET], branchId: 2 });
    await ds.runDue({ now: evening, push });
    assert.equal(pushes.length, 0, 'off: nothing sent');

    await ds.saveSetting(1, ds.SETTINGS_KEY, { enabled: true, time: '18:00', to: [TARGET], branchId: 2 });
    await ds.runDue({ now: new Date(`${localDate()}T10:00:00Z`), push }); // 17:00
    assert.equal(pushes.length, 0, 'before the time');
    const out = await ds.runDue({ now: evening, push });
    assert.equal(out[1], 1);
    assert.equal(pushes.length, 1);
    assert.equal(pushes[0].to, TARGET);
    assert.equal(pushes[0].msgs[0].type, 'flex');
    await ds.runDue({ now: new Date(evening.getTime() + 10 * 60_000), push });
    assert.equal(pushes.length, 1, 'once a day');
    assert.equal(await ds.lastSentOn(1), localDate(evening));
  });
});

describe('settings routes', () => {
  test('owner/admin only; validation; preview', async () => {
    assert.equal((await cashier.get('/api/notifications/sales-report')).status, 403);
    assert.equal((await manager.get('/api/notifications/sales-report')).status, 403);
    const g = await admin.get('/api/notifications/sales-report');
    assert.equal(g.status, 200, JSON.stringify(g.body));
    assert.ok(Array.isArray(g.body.data.lineTargets));
    assert.equal((await admin.put('/api/notifications/sales-report', { enabled: true, time: '18:00', to: [] })).status, 400);
    assert.equal((await admin.put('/api/notifications/sales-report', { enabled: true, time: '25:00', to: [TARGET] })).status, 400);
    assert.equal((await admin.put('/api/notifications/sales-report', { enabled: true, time: '18:00', to: ['bad'] })).status, 400);
    const ok = await admin.put('/api/notifications/sales-report', { enabled: true, time: '18:30', to: [TARGET], branchId: null });
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    assert.deepEqual([ok.body.data.settings.enabled, ok.body.data.settings.time], [true, '18:30']);
    const pv = await admin.get('/api/notifications/sales-report/preview');
    assert.equal(pv.status, 200);
    assert.equal(pv.body.data.date, localDate());
    assert.ok(pv.body.data.until);
  });
});

const r2 = (n) => Math.round(n * 100) / 100;
