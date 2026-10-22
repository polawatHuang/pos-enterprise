'use strict';

// Employee welfare withdrawal: request -> manager approval -> FEFO stock out at cost ('welfare' movement,
// Dr 5250 / Cr 1300), monthly limit at request and approval, no self-approval, reject and cancel leave stock alone.
process.env.NODE_ENV = 'test';

const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { createApp } = require('../src/app');
const db = require('../src/db/pool');
const { localDate } = require('../src/utils/dates');

const app = createApp();
const RUN = Date.now().toString(36);
const WH = 2;
const MANAGER_ID = 2;
const CASHIER_ID = 4;
const day = (n) => localDate(new Date(Date.now() + n * 86_400_000));
const state = { milk: 0, soap: 0, ids: [], savedLimits: [], savedDefault: null };
let manager;
let cashier;
let owner;
let viewer;

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
const stock = async (productId) => {
  const row = await db.one('SELECT quantity FROM stock_levels WHERE warehouse_id = :w AND product_id = :p AND variant_id = 0', { w: WH, p: productId });
  return Number(row?.quantity ?? 0);
};
const lots = async (productId) =>
  (await db.query('SELECT quantity FROM stock_lots WHERE product_id = :p AND warehouse_id = :w ORDER BY expiry_date', { p: productId, w: WH })).map((l) =>
    Number(l.quantity),
  );
/** Creates a request and remembers it for cleanup. */
async function ask(who, body) {
  const res = await who.post('/api/inventory/welfare', { warehouseId: WH, ...body });
  if (res.status === 201) state.ids.push(res.body.data.id);
  return res;
}

before(async () => {
  manager = as(await cookie('manager@example.com'));
  cashier = as(await cookie('cashier@example.com'));
  owner = as(await cookie('admin@example.com'));
  viewer = as(await cookie('viewer@example.com'));
  state.savedLimits = await db.query('SELECT id, welfare_monthly_limit FROM users WHERE id IN (:ids)', { ids: [MANAGER_ID, CASHIER_ID] });
  state.savedDefault = await db.one("SELECT value FROM settings WHERE org_id = 1 AND setting_key = 'welfare.monthly_limit'");
  // Earlier runs this month must not eat into the limits used below
  await db.query("UPDATE welfare_requests SET status = 'cancelled' WHERE org_id = 1 AND employee_id IN (:ids) AND status = 'pending'", {
    ids: [MANAGER_ID, CASHIER_ID],
  });

  const m = await manager.post('/api/products', { sku: `TWF-M-${RUN}`, name: 'นมสวัสดิการทดสอบ', price: 15, cost: 10, trackExpiry: true });
  assert.equal(m.status, 201, JSON.stringify(m.body));
  state.milk = m.body.data.id;
  const s = await manager.post('/api/products', { sku: `TWF-S-${RUN}`, name: 'สบู่สวัสดิการทดสอบ', price: 40, cost: 25 });
  state.soap = s.body.data.id;
  const rcv = await manager.post('/api/inventory/receive', {
    warehouseId: WH,
    items: [
      { productId: state.milk, quantity: 5, unitCost: 10, expiryDate: day(2), lotNo: 'W1' },
      { productId: state.milk, quantity: 5, unitCost: 10, expiryDate: day(20), lotNo: 'W2' },
      { productId: state.soap, quantity: 10, unitCost: 25 },
    ],
  });
  assert.equal(rcv.status, 201, JSON.stringify(rcv.body));
});

after(async () => {
  if (state.ids.length) {
    await db.query("DELETE FROM journal_entries WHERE ref_type = 'welfare_request' AND ref_id IN (:ids)", { ids: state.ids });
    await db.query('DELETE FROM welfare_requests WHERE id IN (:ids)', { ids: state.ids });
  }
  await db.query("DELETE FROM products WHERE sku LIKE 'TWF-%'");
  for (const u of state.savedLimits) await db.query('UPDATE users SET welfare_monthly_limit = :l WHERE id = :id', { l: u.welfare_monthly_limit, id: u.id });
  if (state.savedDefault) await db.query("UPDATE settings SET value = :v WHERE org_id = 1 AND setting_key = 'welfare.monthly_limit'", { v: state.savedDefault.value });
  else await db.query("DELETE FROM settings WHERE org_id = 1 AND setting_key = 'welfare.monthly_limit'");
  await db.pool.end();
});

describe('limits and access', () => {
  test('only settings:manage edits limits; requesters see only themselves', async () => {
    assert.equal((await manager.get('/api/inventory/welfare/settings')).status, 403);
    assert.equal((await manager.put('/api/inventory/welfare/limits', { defaultLimit: 1 })).status, 403);
    const put = await owner.put('/api/inventory/welfare/limits', {
      defaultLimit: 0,
      users: [
        { userId: CASHIER_ID, limit: 200 },
        { userId: MANAGER_ID, limit: null },
      ],
    });
    assert.equal(put.status, 200, JSON.stringify(put.body));
    const settings = await owner.get('/api/inventory/welfare/settings');
    assert.equal(settings.body.data.defaultLimit, 0);
    assert.equal(settings.body.data.users.find((u) => u.userId === CASHIER_ID).limit, 200);

    assert.equal((await viewer.get('/api/inventory/welfare/employees')).status, 403, 'viewer has no welfare:request');
    const mine = await cashier.get('/api/inventory/welfare/employees');
    assert.equal(mine.status, 200, JSON.stringify(mine.body));
    assert.deepEqual(
      mine.body.data.map((e) => e.id),
      [CASHIER_ID],
    );
    assert.equal(mine.body.data[0].limit, 200);
    assert.equal(mine.body.data[0].remaining, 200);
    const all = await manager.get('/api/inventory/welfare/employees');
    assert.ok(all.body.data.length >= 5);
    assert.equal(all.body.data.find((e) => e.id === MANAGER_ID).remaining, null, 'default 0 = unlimited');
    assert.ok((await cashier.get('/api/inventory/welfare/warehouses')).body.data.some((w) => w.id === WH));
  });
});

describe('request and approval', () => {
  test('a request leaves stock alone until a manager approves; approval takes lots FEFO and books 5250/1300', async () => {
    assert.equal((await ask(cashier, { employeeId: MANAGER_ID, items: [{ productId: state.soap, quantity: 1 }] })).status, 403, 'only for yourself');
    const tooMuch = await ask(cashier, { employeeId: CASHIER_ID, items: [{ productId: state.soap, quantity: 11 }] });
    assert.equal(tooMuch.status, 409, 'stock must cover the request');

    const res = await ask(cashier, {
      employeeId: CASHIER_ID,
      note: 'ของใช้ประจำเดือน',
      items: [
        { productId: state.milk, quantity: 4 },
        { productId: state.soap, quantity: 2 },
        { productId: state.milk, quantity: 3 },
      ],
    });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    const r = res.body.data;
    assert.match(r.requestNo, /^WF\d{6}$/);
    assert.equal(r.status, 'pending');
    assert.equal(r.totalCost, 120, '7 x 10 + 2 x 25');
    assert.equal(r.items.length, 2, 'the same product is merged into one line');
    assert.ok(r.requestedAt);
    assert.equal(r.approvedAt, null);
    assert.deepEqual([await stock(state.milk), await stock(state.soap)], [10, 10], 'nothing moves while pending');

    const used = await cashier.get('/api/inventory/welfare/employees');
    assert.equal(used.body.data[0].usedThisMonth, 120, 'pending counts toward the limit');
    assert.equal(used.body.data[0].remaining, 80);

    const over = await ask(cashier, { employeeId: CASHIER_ID, items: [{ productId: state.soap, quantity: 4 }] });
    assert.equal(over.status, 400);
    assert.match(over.body.error.message, /เกินวงเงินสวัสดิการ/);

    assert.equal((await cashier.post(`/api/inventory/welfare/${r.id}/approve`)).status, 403, 'cashier cannot approve');
    const ok = await manager.post(`/api/inventory/welfare/${r.id}/approve`);
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    assert.equal(ok.body.data.status, 'approved');
    assert.ok(ok.body.data.approvedAt);
    assert.equal(ok.body.data.approvedByName, 'สมชาย ผู้จัดการ');
    assert.deepEqual([await stock(state.milk), await stock(state.soap)], [3, 8]);
    assert.deepEqual(await lots(state.milk), [0, 3], 'earliest expiry first');
    const milkLine = ok.body.data.items.find((i) => i.productId === state.milk);
    assert.deepEqual(
      milkLine.lots.map((l) => l.qty),
      [5, 2],
    );

    const moves = await db.query(
      "SELECT product_id, type, quantity, unit_cost FROM stock_movements WHERE ref_type = 'welfare_request' AND ref_id = :id ORDER BY product_id",
      { id: r.id },
    );
    assert.equal(moves.length, 2);
    assert.ok(moves.every((m) => m.type === 'welfare'));
    assert.deepEqual(
      moves.map((m) => [Number(m.quantity), Number(m.unit_cost)]),
      [
        [-7, 10],
        [-2, 25],
      ],
    );
    const j = await db.query(
      `SELECT a.code, l.debit, l.credit FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id JOIN chart_of_accounts a ON a.id = l.account_id
        WHERE e.ref_type = 'welfare_request' AND e.ref_id = :id`,
      { id: r.id },
    );
    assert.equal(Number(j.find((x) => x.code === '5250').debit), 120);
    assert.equal(Number(j.find((x) => x.code === '1300').credit), 120);
    assert.equal(
      j.reduce((s, x) => s + Number(x.debit) - Number(x.credit), 0),
      0,
      'balanced',
    );

    assert.equal((await manager.post(`/api/inventory/welfare/${r.id}/approve`)).status, 409, 'approve once');
    assert.equal((await cashier.post(`/api/inventory/welfare/${r.id}/cancel`)).status, 409, 'approved requests cannot be cancelled');

    const mv = await manager.get('/api/inventory/movements?type=welfare&limit=200');
    assert.equal(mv.status, 200);
    assert.ok(mv.body.data.some((m) => m.refId === r.id && m.type === 'welfare'));

    const summary = await manager.get(`/api/inventory/welfare/summary?month=${localDate().slice(0, 7)}`);
    const me = summary.body.data.employees.find((e) => e.employeeId === CASHIER_ID);
    assert.deepEqual([me.approved, me.pending, me.limit, me.remaining], [120, 0, 200, 80]);
    const hist = await cashier.get('/api/inventory/welfare?status=approved');
    assert.ok(hist.body.data.some((x) => x.id === r.id));
    const logs = await db.query("SELECT action FROM audit_logs WHERE entity_type = 'welfare_request' AND entity_id = :id", { id: String(r.id) });
    assert.deepEqual(logs.map((l) => l.action).sort(), ['welfare.approve', 'welfare.request']);
  });

  test('the limit is checked again on approval', async () => {
    const res = await ask(cashier, { employeeId: CASHIER_ID, items: [{ productId: state.soap, quantity: 2 }] });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    await owner.put('/api/inventory/welfare/limits', { users: [{ userId: CASHIER_ID, limit: 150 }] });
    const denied = await manager.post(`/api/inventory/welfare/${res.body.data.id}/approve`);
    assert.equal(denied.status, 400);
    assert.match(denied.body.error.message, /เกินวงเงิน/);
    assert.equal(await stock(state.soap), 8);
    assert.equal((await cashier.post(`/api/inventory/welfare/${res.body.data.id}/cancel`)).status, 200);
    await owner.put('/api/inventory/welfare/limits', { users: [{ userId: CASHIER_ID, limit: 200 }] });
  });

  test('nobody approves their own request unless they manage settings', async () => {
    const res = await ask(manager, { employeeId: MANAGER_ID, items: [{ productId: state.soap, quantity: 1 }] });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    const self = await manager.post(`/api/inventory/welfare/${res.body.data.id}/approve`);
    assert.equal(self.status, 403);
    assert.equal(await stock(state.soap), 8);
    // a manager may request for someone else (inventory:write), and still cannot approve it
    const forStaff = await ask(manager, { employeeId: CASHIER_ID, items: [{ productId: state.soap, quantity: 1 }] });
    assert.equal(forStaff.status, 201, JSON.stringify(forStaff.body));
    assert.equal((await manager.post(`/api/inventory/welfare/${forStaff.body.data.id}/approve`)).status, 403);
    const byOwner = await owner.post(`/api/inventory/welfare/${res.body.data.id}/approve`);
    assert.equal(byOwner.status, 200, 'another approver');
    assert.equal(await stock(state.soap), 7);
    assert.equal((await manager.post(`/api/inventory/welfare/${forStaff.body.data.id}/cancel`)).status, 200, 'the requester cancels');
  });

  test('reject needs a reason and leaves stock; cancel is for the requester while pending', async () => {
    const res = await ask(cashier, { employeeId: CASHIER_ID, items: [{ productId: state.soap, quantity: 1 }] });
    const id = res.body.data.id;
    assert.equal((await manager.post(`/api/inventory/welfare/${id}/reject`, {})).status, 400);
    assert.equal((await cashier.post(`/api/inventory/welfare/${id}/reject`, { reason: 'x' })).status, 403);
    const rej = await manager.post(`/api/inventory/welfare/${id}/reject`, { reason: 'เกินสิทธิ์ประจำเดือน' });
    assert.equal(rej.status, 200, JSON.stringify(rej.body));
    assert.equal(rej.body.data.status, 'rejected');
    assert.equal(rej.body.data.rejectReason, 'เกินสิทธิ์ประจำเดือน');
    assert.equal(await stock(state.soap), 7);
    assert.equal((await cashier.post(`/api/inventory/welfare/${id}/cancel`)).status, 409);

    const c = await ask(cashier, { employeeId: CASHIER_ID, items: [{ productId: state.soap, quantity: 1 }] });
    assert.equal((await owner.post(`/api/inventory/welfare/${c.body.data.id}/cancel`)).status, 403, 'only the requester cancels');
    const done = await cashier.post(`/api/inventory/welfare/${c.body.data.id}/cancel`);
    assert.equal(done.status, 200);
    assert.equal(done.body.data.status, 'cancelled');
    assert.equal(await stock(state.soap), 7);
    const j = await db.one("SELECT COUNT(*) AS n FROM journal_entries WHERE ref_type = 'welfare_request' AND ref_id IN (:ids)", { ids: [id, c.body.data.id] });
    assert.equal(Number(j.n), 0);
    const left = await cashier.get('/api/inventory/welfare/employees');
    assert.equal(left.body.data[0].usedThisMonth, 120, 'rejected and cancelled requests free the limit');
  });
});
