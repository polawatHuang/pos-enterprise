'use strict';

// POS: discount codes (store + AI-issued) at checkout, and partial returns / refunds with restock and books.
process.env.NODE_ENV = 'test';

const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { createApp } = require('../src/app');
const db = require('../src/db/pool');
const { lotsFor } = require('../src/modules/pos/returns');

const app = createApp();
const RUN = Date.now().toString(36);
const CODE = `T${RUN}`.toUpperCase().slice(0, 12);
const state = { productId: 0, orderIds: [], codeIds: [], customerIds: [], shiftIds: [] };
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
  del: (url) => request(app).delete(url).set('Cookie', c),
});
const stock = async () =>
  Number((await db.one('SELECT quantity FROM stock_levels WHERE warehouse_id = 2 AND product_id = :p AND variant_id = 0', { p: state.productId }))?.quantity ?? 0);
const sell = async (body) => {
  const res = await cashier.post('/api/pos/checkout', { payments: [{ method: 'cash', amount: 100000 }], ...body });
  if (res.status === 201) state.orderIds.push(res.body.data.id);
  return res;
};
const journalFor = (refType, refId) =>
  db.query(
    `SELECT a.code, l.debit, l.credit FROM journal_entries e JOIN journal_lines l ON l.entry_id = e.id JOIN chart_of_accounts a ON a.id = l.account_id
      WHERE e.ref_type = :refType AND e.ref_id = :refId ORDER BY l.id`,
    { refType, refId },
  );

before(async () => {
  manager = as(await cookie('manager@example.com'));
  cashier = as(await cookie('cashier@example.com')); // branch 2 -> warehouse 2
  // the test needs the manager without an open shift (cash refunds) and a fresh cashier shift
  await db.query('UPDATE pos_shifts SET closed_at = UTC_TIMESTAMP() WHERE user_id IN (2, 4) AND closed_at IS NULL');
  await db.query("DELETE FROM settings WHERE org_id = 1 AND setting_key LIKE 'pos.%'");
  const p = await manager.post('/api/products', { sku: `TR-${RUN}`, barcode: `886${RUN}`, name: 'สบู่ทดสอบคืน', price: 100, cost: 40 });
  assert.equal(p.status, 201, JSON.stringify(p.body));
  state.productId = p.body.data.id;
  await manager.post('/api/inventory/receive', { warehouseId: 2, items: [{ productId: state.productId, quantity: 50, unitCost: 40 }] });
  assert.equal((await cashier.post('/api/pos/shift/open', { openingCash: 1000 })).status, 201);
});

after(async () => {
  if (state.orderIds.length) await db.query('DELETE FROM sales_orders WHERE id IN (:ids)', { ids: state.orderIds });
  await db.query('DELETE FROM pos_shifts WHERE user_id = 4 AND opened_at > UTC_TIMESTAMP() - INTERVAL 1 HOUR');
  if (state.shiftIds.length) await db.query('DELETE FROM pos_shifts WHERE id IN (:ids)', { ids: state.shiftIds });
  if (state.codeIds.length) await db.query('DELETE FROM discount_codes WHERE id IN (:ids)', { ids: state.codeIds });
  if (state.customerIds.length) await db.query('DELETE FROM customers WHERE id IN (:ids)', { ids: state.customerIds });
  await db.query("DELETE FROM stock_lots WHERE product_id IN (SELECT id FROM products WHERE sku LIKE 'TR-%')");
  await db.query("DELETE FROM products WHERE sku LIKE 'TR-%'");
  await db.pool.end();
});

describe('discount codes', () => {
  test('create (manager only), check against the cart, redeem once at checkout; void gives the use back', async () => {
    const body = { code: CODE.toLowerCase(), type: 'percent', value: 10, minSpend: 150, maxUses: 1, description: 'ลด 10% ทดสอบ' };
    assert.equal((await cashier.post('/api/pos/discount-codes', body)).status, 403);
    const c = await manager.post('/api/pos/discount-codes', body);
    assert.equal(c.status, 201, JSON.stringify(c.body));
    state.codeIds.push(c.body.data.id);
    assert.equal(c.body.data.code, CODE); // stored upper-case
    assert.equal((await manager.post('/api/pos/discount-codes', body)).status, 409);
    assert.equal((await manager.post('/api/pos/discount-codes', { ...body, code: 'X', value: 5 })).status, 400);

    const low = await cashier.get(`/api/pos/discount-codes/check?code=${CODE.toLowerCase()}&subtotal=100`);
    assert.equal(low.body.data.valid, false);
    assert.match(low.body.data.reason, /ซื้อครบ 150/);
    const ok = await cashier.get(`/api/pos/discount-codes/check?code=${CODE}&subtotal=200`);
    assert.deepEqual([ok.body.data.valid, ok.body.data.amount], [true, 20]);
    assert.equal((await cashier.get('/api/pos/discount-codes/check?code=NOPE123&subtotal=200')).body.data.reason, 'ไม่พบโค้ดส่วนลดนี้');

    // A 10% code is the shop's offer: allowed even past the cashier's own discount limit
    const sale = await sell({ items: [{ productId: state.productId, quantity: 2 }], discountCode: ` ${CODE.toLowerCase()} ` });
    assert.equal(sale.status, 201, JSON.stringify(sale.body));
    assert.deepEqual([sale.body.data.total, sale.body.data.codeDiscount, sale.body.data.discountCode], [180, 20, CODE]);
    const again = await sell({ items: [{ productId: state.productId, quantity: 2 }], discountCode: CODE });
    assert.equal(again.status, 400);
    assert.match(again.body.error.message, /ใช้ครบแล้ว/);

    assert.equal((await manager.post(`/api/pos/orders/${sale.body.data.id}/void`, { reason: 'ทดสอบ' })).status, 200);
    const used = await db.one('SELECT used_count FROM discount_codes WHERE id = :id', { id: state.codeIds[0] });
    assert.equal(Number(used.used_count), 0);

    // Disabled codes stop working; the list hides them unless asked for all
    await manager.patch(`/api/pos/discount-codes/${state.codeIds[0]}`, { isActive: false });
    assert.equal((await cashier.get(`/api/pos/discount-codes/check?code=${CODE}&subtotal=200`)).body.data.reason, 'โค้ดนี้ถูกปิดใช้งาน');
    const active = await cashier.get(`/api/pos/discount-codes?q=${CODE}`);
    assert.equal(active.body.data.length, 0);
    const all = await cashier.get(`/api/pos/discount-codes?status=all&q=${CODE}`);
    assert.equal(all.body.data[0].isActive, false);
  });

  test('a code issued to one customer (AI chat) is refused for a different member', async () => {
    const [a] = await Promise.all([db.query("INSERT INTO customers (org_id, name) VALUES (1, 'ลูกค้าโค้ด A')")]);
    const b = await db.query("INSERT INTO customers (org_id, name) VALUES (1, 'ลูกค้าโค้ด B')");
    state.customerIds.push(a.insertId, b.insertId);
    const r = await db.query(
      `INSERT INTO discount_codes (org_id, code, type, value, max_uses, customer_id, issued_by, expires_at)
       VALUES (1, :code, 'fixed', 30, 1, :cust, 'ai_agent', UTC_TIMESTAMP() + INTERVAL 1 DAY)`,
      { code: `AI${RUN}`.toUpperCase().slice(0, 12), cust: a.insertId },
    );
    state.codeIds.push(r.insertId);
    const code = `AI${RUN}`.toUpperCase().slice(0, 12);
    const wrong = await sell({ items: [{ productId: state.productId, quantity: 1 }], discountCode: code, customerId: b.insertId });
    assert.equal(wrong.status, 400);
    assert.match(wrong.body.error.message, /ลูกค้าคนอื่น/);
    const right = await sell({ items: [{ productId: state.productId, quantity: 1 }], discountCode: code, customerId: a.insertId });
    assert.equal(right.status, 201, JSON.stringify(right.body));
    assert.equal(right.body.data.total, 70);
  });
});

describe('returns and refunds', () => {
  test('lot allocations for a partial return follow the sale, skipping what was already returned', () => {
    const alloc = [
      { lotId: 1, qty: 2 },
      { lotId: 2, qty: 3 },
    ];
    assert.deepEqual(lotsFor(alloc, 0, 1), [{ lotId: 1, qty: 1 }]);
    assert.deepEqual(lotsFor(alloc, 1, 3), [
      { lotId: 1, qty: 1 },
      { lotId: 2, qty: 2 },
    ]);
    assert.deepEqual(lotsFor(alloc, 5, 1), []);
  });

  test('partial return restocks, refunds the paid share, posts the reversal; the last return takes the remainder', async () => {
    // 3 x 100 with a 30 baht bill discount: the customer paid 270, i.e. 90 per piece
    const sale = await sell({ items: [{ productId: state.productId, quantity: 3 }], discount: 30 });
    assert.equal(sale.status, 201, JSON.stringify(sale.body));
    const id = sale.body.data.id;
    const itemId = sale.body.data.items[0].id;
    const before = await stock();

    assert.equal((await cashier.post(`/api/pos/orders/${id}/returns`, { items: [{ orderItemId: itemId, quantity: 1 }], reason: 'x', refundMethod: 'cash' })).status, 403);
    const tooMany = await manager.post(`/api/pos/orders/${id}/returns`, { items: [{ orderItemId: itemId, quantity: 4 }], reason: 'ชำรุด', refundMethod: 'cash' });
    assert.equal(tooMany.status, 400);

    // Manager has no open shift: a cash refund needs one, a transfer does not
    const noShift = await manager.post(`/api/pos/orders/${id}/returns`, { items: [{ orderItemId: itemId, quantity: 1 }], reason: 'ชำรุด', refundMethod: 'cash' });
    assert.equal(noShift.status, 409);
    const r1 = await manager.post(`/api/pos/orders/${id}/returns`, { items: [{ orderItemId: itemId, quantity: 1 }], reason: 'ลูกค้าเปลี่ยนใจ', refundMethod: 'transfer' });
    assert.equal(r1.status, 201, JSON.stringify(r1.body));
    assert.equal(r1.body.data.refund, 90);
    assert.match(r1.body.data.returnNo, /^RT\d{6}-\d{4}$/);
    assert.equal(r1.body.data.order.status, 'completed');
    assert.equal(r1.body.data.order.refundedAmount, 90);
    assert.equal(r1.body.data.order.items[0].returnedQty, 1);
    assert.equal(r1.body.data.order.returns.length, 1);
    assert.equal(await stock(), before + 1);

    const lines = await journalFor('sales_return', r1.body.data.id);
    const sum = (code, side) => lines.filter((l) => l.code === code).reduce((s, l) => s + Number(l[side]), 0);
    assert.equal(sum('1110', 'credit'), 90); // bank
    assert.equal(Math.round((sum('4100', 'debit') + sum('2200', 'debit')) * 100) / 100, 90);
    assert.equal(sum('1300', 'debit'), 40); // inventory back at cost
    assert.equal(sum('5100', 'credit'), 40);

    // A bill with a return cannot be voided (that would restock twice)
    assert.equal((await manager.post(`/api/pos/orders/${id}/void`, { reason: 'x' })).status, 409);

    // Damaged goods: refunded but not put back on the shelf; the last return refunds exactly what is left
    const r2 = await manager.post(`/api/pos/orders/${id}/returns`, {
      items: [{ orderItemId: itemId, quantity: 2 }],
      reason: 'สินค้าเสียหาย',
      refundMethod: 'transfer',
      restock: false,
    });
    assert.equal(r2.status, 201, JSON.stringify(r2.body));
    assert.equal(r2.body.data.refund, 180);
    assert.equal(r2.body.data.fullyReturned, true);
    assert.equal(r2.body.data.order.status, 'refunded');
    assert.equal(r2.body.data.order.refundedAmount, 270);
    assert.equal(await stock(), before + 1);
    const pays = await db.query('SELECT SUM(amount) AS net FROM payments WHERE order_id = :id', { id });
    assert.equal(Number(pays[0].net), 0);
    assert.equal((await manager.post(`/api/pos/orders/${id}/returns`, { items: [{ orderItemId: itemId, quantity: 1 }], reason: 'x', refundMethod: 'transfer' })).status, 409);
  });
});

describe('voiding a return', () => {
  const journalNetsToZero = async (refId) => {
    const lines = await journalFor('sales_return', refId);
    const by = {};
    for (const l of lines) by[l.code] = Math.round(((by[l.code] ?? 0) + Number(l.debit) - Number(l.credit)) * 100) / 100;
    return lines.length > 0 && Object.values(by).every((v) => v === 0);
  };

  test('void puts back stock, lots, refunded amount, status, customer and the books; double void 409; manager only', async () => {
    const p = await manager.post('/api/products', { sku: `TR-L${RUN}`, barcode: `887${RUN}`, name: 'นมทดสอบล็อต', price: 50, cost: 20, trackExpiry: true });
    assert.equal(p.status, 201, JSON.stringify(p.body));
    const pid = p.body.data.id;
    const rec = await manager.post('/api/inventory/receive', { warehouseId: 2, items: [{ productId: pid, quantity: 10, unitCost: 20, expiryDate: '2099-12-31' }] });
    assert.equal(rec.status, 201, JSON.stringify(rec.body));
    const lotId = rec.body.data[0].lotId;
    const lotQty = async () => Number((await db.one('SELECT quantity FROM stock_lots WHERE id = :id', { id: lotId })).quantity);
    const level = async () =>
      Number((await db.one('SELECT quantity FROM stock_levels WHERE warehouse_id = 2 AND product_id = :p AND variant_id = 0', { p: pid })).quantity);
    const cust = await db.query("INSERT INTO customers (org_id, name) VALUES (1, 'ลูกค้ายกเลิกคืน')");
    state.customerIds.push(cust.insertId);
    const customer = () => db.one('SELECT total_spent, order_count, points FROM customers WHERE id = :id', { id: cust.insertId });

    const sale = await sell({ items: [{ productId: pid, quantity: 2 }], customerId: cust.insertId });
    assert.equal(sale.status, 201, JSON.stringify(sale.body));
    const id = sale.body.data.id;
    const itemId = sale.body.data.items[0].id;
    const afterSale = { lot: await lotQty(), level: await level(), customer: await customer() };
    assert.equal(afterSale.lot, 8);

    const r = await manager.post(`/api/pos/orders/${id}/returns`, { items: [{ orderItemId: itemId, quantity: 2 }], reason: 'ผิดรายการ', refundMethod: 'transfer' });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.equal(r.body.data.order.status, 'refunded');
    assert.equal(await lotQty(), 10);
    const stored = await db.one('SELECT lot_allocations FROM sales_return_items WHERE return_id = :id', { id: r.body.data.id });
    const alloc = typeof stored.lot_allocations === 'string' ? JSON.parse(stored.lot_allocations) : stored.lot_allocations;
    assert.deepEqual(alloc, [{ lotId, qty: 2 }]);
    assert.notDeepEqual(await customer(), afterSale.customer);

    const url = `/api/pos/orders/${id}/returns/${r.body.data.id}/void`;
    assert.equal((await cashier.post(url, { reason: 'x' })).status, 403);
    assert.equal((await manager.post(url, {})).status, 400);
    const v = await manager.post(url, { reason: 'คืนผิดบิล' });
    assert.equal(v.status, 200, JSON.stringify(v.body));
    const o = v.body.data.order;
    assert.deepEqual([o.status, o.refundedAmount, o.items[0].returnedQty], ['completed', 0, 0]);
    assert.deepEqual([o.returns[0].voided, o.returns[0].voidReason], [true, 'คืนผิดบิล']);
    assert.equal(await lotQty(), afterSale.lot);
    assert.equal(await level(), afterSale.level);
    assert.deepEqual(await customer(), afterSale.customer);
    const net = await db.one('SELECT SUM(amount) AS net FROM payments WHERE order_id = :id', { id });
    assert.equal(Number(net.net), sale.body.data.total);
    assert.ok(await db.one('SELECT id FROM payments WHERE order_id = :id AND reference = :ref AND amount > 0', { id, ref: `VOID-RETURN ${r.body.data.returnNo}` }));
    assert.ok(await journalNetsToZero(r.body.data.id), 'journal mirrored');
    const mv = await db.one("SELECT quantity, type FROM stock_movements WHERE ref_type = 'sales_return' AND ref_id = :id AND quantity < 0", { id: r.body.data.id });
    assert.deepEqual([Number(mv.quantity), mv.type], [-2, 'sale']);

    assert.equal((await manager.post(url, { reason: 'อีกครั้ง' })).status, 409);

    // The bill can be returned again, then voided normally once nothing is refunded
    const again = await manager.post(`/api/pos/orders/${id}/returns`, { items: [{ orderItemId: itemId, quantity: 1 }], reason: 'คืนจริง', refundMethod: 'transfer' });
    assert.equal(again.status, 201, JSON.stringify(again.body));
    assert.equal(again.body.data.refund, 50);
    assert.equal((await manager.post(`/api/pos/orders/${id}/returns/${again.body.data.id}/void`, { reason: 'ผิด' })).status, 200);
    assert.equal((await manager.post(`/api/pos/orders/${id}/void`, { reason: 'ยกเลิกบิล' })).status, 200);
    assert.equal(await lotQty(), 10);
    assert.equal(await level(), 10);
  });

  test('a cash refund paid from another shift: its pay-out is removed on void and cannot be deleted by hand', async () => {
    const shift = await manager.post('/api/pos/shift/open', { branchId: 2, openingCash: 500 });
    assert.equal(shift.status, 201, JSON.stringify(shift.body));
    state.shiftIds.push(shift.body.data.id);
    try {
      const sale = await sell({ items: [{ productId: state.productId, quantity: 1 }] });
      const id = sale.body.data.id;
      const r = await manager.post(`/api/pos/orders/${id}/returns`, { items: [{ orderItemId: sale.body.data.items[0].id, quantity: 1 }], reason: 'x', refundMethod: 'cash' });
      assert.equal(r.status, 201, JSON.stringify(r.body));
      const payout = await db.one("SELECT id FROM cash_movements WHERE shift_id = :s AND type = 'pay_out'", { s: shift.body.data.id });
      assert.ok(payout);
      const del = await manager.del(`/api/pos/shift/cash/${payout.id}`);
      assert.equal(del.status, 409);
      assert.match(del.body.error.message, /คืนสินค้า/);
      const report = await manager.get('/api/pos/shift/report');
      assert.equal(report.body.data.cashMovements.find((m) => m.id === payout.id).auto, true);
      assert.equal(report.body.data.expectedCash, 400);

      assert.equal((await manager.post(`/api/pos/orders/${id}/returns/${r.body.data.id}/void`, { reason: 'ผิด' })).status, 200);
      assert.equal(await db.one('SELECT id FROM cash_movements WHERE id = :id', { id: payout.id }), null);
      assert.equal((await manager.get('/api/pos/shift')).body.data.expectedCash, 500);
    } finally {
      await db.query('UPDATE pos_shifts SET closed_at = UTC_TIMESTAMP() WHERE id = :id', { id: shift.body.data.id });
    }
  });
});

describe('deleting mistaken entries', () => {
  test('cash movements: own open shift (or pos:manage), never a closed shift; the drawer follows', async () => {
    const before = (await cashier.get('/api/pos/shift')).body.data.expectedCash;
    const add = await cashier.post('/api/pos/shift/cash', { type: 'pay_in', amount: 123, reason: 'ทอนผิด' });
    assert.equal(add.status, 201, JSON.stringify(add.body));
    assert.equal(add.body.data.expectedCash, before + 123);
    const row = (await cashier.get('/api/pos/shift/report')).body.data.cashMovements.find((m) => m.reason === 'ทอนผิด');
    assert.equal(row.auto, false);
    const del = await cashier.del(`/api/pos/shift/cash/${row.id}`);
    assert.equal(del.status, 200, JSON.stringify(del.body));
    assert.equal(del.body.data.expectedCash, before);
    assert.equal((await cashier.del(`/api/pos/shift/cash/${row.id}`)).status, 404);

    // A manager may remove a cashier's row; nobody may touch a closed shift's
    await cashier.post('/api/pos/shift/cash', { type: 'pay_in', amount: 10, reason: 'ทดสอบ 2' });
    const r2 = (await cashier.get('/api/pos/shift/report')).body.data.cashMovements.find((m) => m.reason === 'ทดสอบ 2');
    assert.equal((await manager.del(`/api/pos/shift/cash/${r2.id}`)).status, 200);
    const old = await db.query('INSERT INTO pos_shifts (org_id, branch_id, user_id, opening_cash, opened_at, closed_at) VALUES (1, 2, 4, 0, UTC_TIMESTAMP(), UTC_TIMESTAMP())');
    state.shiftIds.push(old.insertId);
    const m = await db.query("INSERT INTO cash_movements (shift_id, type, amount, reason, created_by) VALUES (:s, 'pay_in', 5, 'เก่า', 4)", { s: old.insertId });
    assert.equal((await cashier.del(`/api/pos/shift/cash/${m.insertId}`)).status, 409);
  });

  test('discount codes: an unused code can be deleted (manager only); one with history must be switched off', async () => {
    const mk = async (code) => {
      const c = await manager.post('/api/pos/discount-codes', { code, type: 'fixed', value: 5 });
      assert.equal(c.status, 201, JSON.stringify(c.body));
      state.codeIds.push(c.body.data.id);
      return c.body.data.id;
    };
    const fresh = await mk(`D${RUN}`.toUpperCase().slice(0, 12));
    assert.equal((await cashier.del(`/api/pos/discount-codes/${fresh}`)).status, 403);
    assert.equal((await manager.del(`/api/pos/discount-codes/${fresh}`)).status, 200);
    assert.equal(await db.one('SELECT id FROM discount_codes WHERE id = :id', { id: fresh }), null);
    assert.equal((await manager.del(`/api/pos/discount-codes/${fresh}`)).status, 404);

    // The first test's code was used on a bill (then voided: used_count is back to 0, the bill still points at it)
    const used = await manager.del(`/api/pos/discount-codes/${state.codeIds[0]}`);
    assert.equal(used.status, 409);
    assert.match(used.body.error.message, /ปิดใช้งาน/);
    const counted = await mk(`U${RUN}`.toUpperCase().slice(0, 12));
    await db.query('UPDATE discount_codes SET used_count = 1 WHERE id = :id', { id: counted });
    assert.equal((await manager.del(`/api/pos/discount-codes/${counted}`)).status, 409);
  });
});
