'use strict';

// Phase 9 lots: expiry dates on receipt, FEFO at the till with near-expiry markdowns, expired lots blocked,
// void restores lots, waste write-off with journal, expiry board, transfers carry lots, alerts.
process.env.NODE_ENV = 'test';

const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { createApp } = require('../src/app');
const db = require('../src/db/pool');
const { localDate } = require('../src/utils/dates');
const { checkOrg } = require('../src/modules/inventory/alerts');

const app = createApp();
const RUN = Date.now().toString(36);
const day = (n) => localDate(new Date(Date.now() + n * 86_400_000));
const state = { milk: 0, bread: 0, lotSoon: 0, lotLater: 0, orderIds: [] };
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
const lots = (productId, warehouseId = 2) =>
  db.query('SELECT id, quantity, expiry_date FROM stock_lots WHERE product_id = :p AND warehouse_id = :w ORDER BY expiry_date', {
    p: productId,
    w: warehouseId,
  });

before(async () => {
  manager = as(await cookie('manager@example.com'));
  cashier = as(await cookie('cashier@example.com'));
  await db.query('UPDATE pos_shifts SET closed_at = UTC_TIMESTAMP() WHERE user_id = 4 AND closed_at IS NULL');
  await db.query("DELETE FROM settings WHERE org_id = 1 AND setting_key LIKE 'pos.%'");
  const m = await manager.post('/api/products', { sku: `T9L-M-${RUN}`, barcode: `33${RUN}`, name: 'นมสดทดสอบล็อต', price: 10, cost: 6, trackExpiry: true });
  state.milk = m.body.data.id;
  assert.equal(m.body.data.trackExpiry, true);
  const b = await manager.post('/api/products', { sku: `T9L-B-${RUN}`, name: 'ขนมปังทดสอบล็อต', price: 20, cost: 12, trackExpiry: true, shelfLifeDays: 3 });
  state.bread = b.body.data.id;
});

after(async () => {
  if (state.orderIds.length) await db.query('DELETE FROM sales_orders WHERE id IN (:ids)', { ids: state.orderIds });
  await db.query('DELETE FROM pos_shifts WHERE user_id = 4 AND opened_at > UTC_TIMESTAMP() - INTERVAL 1 HOUR');
  await db.query(
    "DELETE FROM stock_transfers WHERE id IN (SELECT transfer_id FROM stock_transfer_items i JOIN products p ON p.id = i.product_id WHERE p.sku LIKE 'T9L-%')",
  );
  await db.query("DELETE FROM notifications WHERE org_id = 1 AND type = 'stock.expiry'");
  await db.query("DELETE FROM products WHERE sku LIKE 'T9L-%'");
  await db.pool.end();
});

describe('receiving lots', () => {
  test('tracked items need an expiry (or a shelf life to default it)', async () => {
    const missing = await manager.post('/api/inventory/receive', { warehouseId: 2, items: [{ productId: state.milk, quantity: 5 }] });
    assert.equal(missing.status, 400);
    const ok = await manager.post('/api/inventory/receive', {
      warehouseId: 2,
      items: [
        { productId: state.milk, quantity: 5, expiryDate: day(1), lotNo: 'A' },
        { productId: state.milk, quantity: 5, expiryDate: day(10), lotNo: 'B' },
        { productId: state.bread, quantity: 4 },
      ],
    });
    assert.equal(ok.status, 201, JSON.stringify(ok.body));
    const milk = await lots(state.milk);
    assert.equal(milk.length, 2);
    [state.lotSoon, state.lotLater] = milk.map((l) => l.id);
    const bread = await lots(state.bread);
    assert.equal(bread[0].expiry_date.toISOString().slice(0, 10), day(3), 'shelf life fills the date');
  });
});

describe('selling FEFO with markdowns', () => {
  test('near-expiry markdown shows in the catalog and is applied automatically, outside the cashier discount limit', async () => {
    assert.equal((await cashier.post(`/api/inventory/expiry/lots/${state.lotSoon}/markdown`, { pct: 30 })).status, 403);
    assert.equal((await manager.post(`/api/inventory/expiry/lots/${state.lotSoon}/markdown`, { pct: 30 })).status, 200);
    await cashier.post('/api/pos/shift/open', { openingCash: 0 });
    const cat = await cashier.get(`/api/pos/catalog?q=${RUN}`);
    const milk = cat.body.data.find((p) => p.id === state.milk);
    assert.deepEqual(milk.markdown, { pct: 30, qty: 5, expiry: day(1) });

    const sale = await cashier.post('/api/pos/checkout', { items: [{ productId: state.milk, quantity: 7 }], payments: [{ method: 'cash', amount: 100 }] });
    assert.equal(sale.status, 201, JSON.stringify(sale.body));
    state.orderIds.push(sale.body.data.id);
    assert.equal(sale.body.data.total, 55); // 70 - 30% of the 5 near-expiry units
    const after = await lots(state.milk);
    assert.deepEqual(
      after.map((l) => Number(l.quantity)),
      [0, 3],
      'soonest lot leaves first',
    );

    const v = await manager.post(`/api/pos/orders/${sale.body.data.id}/void`, { reason: 'ทดสอบ' });
    assert.equal(v.status, 200);
    assert.deepEqual(
      (await lots(state.milk)).map((l) => Number(l.quantity)),
      [5, 5],
      'void puts units back on their lots',
    );
  });

  test('expired lots cannot be sold', async () => {
    await manager.post('/api/inventory/receive', { warehouseId: 2, items: [{ productId: state.bread, quantity: 2, expiryDate: day(-1) }] });
    // 4 good (shelf life) + 2 expired: selling 5 needs one expired unit
    const sale = await cashier.post('/api/pos/checkout', { items: [{ productId: state.bread, quantity: 5 }], payments: [{ method: 'cash', amount: 100 }] });
    assert.equal(sale.status, 409, JSON.stringify(sale.body));
    assert.match(sale.body.error.message, /หมดอายุ/);
  });
});

describe('expiry board and waste', () => {
  test('board lists expired and soon-expiring lots; waste posts a loss and shows in the monthly report', async () => {
    const board = await manager.get('/api/inventory/expiry?warehouseId=2&days=3');
    const mine = board.body.data.filter((l) => l.productId === state.milk || l.productId === state.bread);
    assert.ok(mine.some((l) => l.daysLeft === -1));
    assert.ok(mine.some((l) => l.lotId === state.lotSoon && l.daysLeft === 1 && l.markdownPct === 30));
    const expired = mine.find((l) => l.daysLeft === -1);

    const w = await manager.post(`/api/inventory/expiry/lots/${expired.lotId}/waste`, { reason: 'expired' });
    assert.equal(w.status, 200, JSON.stringify(w.body));
    assert.equal(w.body.data.qty, 2);
    assert.equal(w.body.data.value, 24);
    const level = await db.one('SELECT quantity FROM stock_levels WHERE warehouse_id = 2 AND product_id = :p', { p: state.bread });
    assert.equal(Number(level.quantity), 4);
    const j = await db.one(
      `SELECT l.debit FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id JOIN chart_of_accounts a ON a.id = l.account_id
        WHERE e.ref_type = 'stock_lot' AND e.ref_id = :id AND a.code = '5900'`,
      { id: expired.lotId },
    );
    assert.equal(Number(j.debit), 24);
    const report = await manager.get('/api/inventory/expiry/waste');
    const row = report.body.data.items.find((i) => i.productId === state.bread);
    assert.deepEqual([row.reason, row.qty, row.value], ['expired', 2, 24]);
    // now the good units sell again
    const sale = await cashier.post('/api/pos/checkout', { items: [{ productId: state.bread, quantity: 1 }], payments: [{ method: 'cash', amount: 20 }] });
    assert.equal(sale.status, 201, JSON.stringify(sale.body));
    state.orderIds.push(sale.body.data.id);
  });

  test('expiry alert raised once a day', async () => {
    await checkOrg(1);
    const n = await db.query("SELECT title FROM notifications WHERE org_id = 1 AND type = 'stock.expiry'");
    assert.ok(n.length >= 1);
    await checkOrg(1);
    assert.equal((await db.query("SELECT id FROM notifications WHERE org_id = 1 AND type = 'stock.expiry'")).length, n.length);
  });
});

describe('transfers carry lots', () => {
  test('units leave the soonest lot and arrive with the same expiry', async () => {
    const ship = await manager.post('/api/purchasing/transfers', { fromWarehouseId: 2, toWarehouseId: 1, items: [{ productId: state.milk, quantity: 6 }] });
    assert.equal(ship.status, 201, JSON.stringify(ship.body));
    assert.deepEqual(
      (await lots(state.milk)).map((l) => Number(l.quantity)),
      [0, 4],
    );
    await manager.post(`/api/purchasing/transfers/${ship.body.data.id}/receive`, { items: [] });
    const dest = await lots(state.milk, 1);
    assert.deepEqual(
      dest.map((l) => [l.expiry_date.toISOString().slice(0, 10), Number(l.quantity)]),
      [
        [day(1), 5],
        [day(10), 1],
      ],
    );
  });
});
