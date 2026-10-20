'use strict';

// Phase 9 POS: pack units, split tender, members & points, held bills, cash in/out, sale-hour rules, slip check.
process.env.NODE_ENV = 'test';

const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { createApp } = require('../src/app');
const db = require('../src/db/pool');
const minimax = require('../src/integrations/minimax');
const { inWindow, settlePayments } = require('../src/modules/pos/pos.service');

const app = createApp();
const RUN = Date.now().toString(36);
const originalCreate = minimax.createMessage;
const savedKey = process.env.MINIMAX_API_KEY;
const savedProvider = process.env.AI_PROVIDER;
const state = { productId: 0, categoryId: 0, unitId: 0, memberId: 0, orderIds: [], slip: null };
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
  delete: (url) => request(app).delete(url).set('Cookie', c),
});
const stock = async () => {
  const row = await db.one('SELECT quantity FROM stock_levels WHERE warehouse_id = 2 AND product_id = :p AND variant_id = 0', { p: state.productId });
  return Number(row?.quantity ?? 0);
};
const sell = async (body) => {
  const res = await cashier.post('/api/pos/checkout', body);
  if (res.status === 201) state.orderIds.push(res.body.data.id);
  return res;
};

before(async () => {
  delete process.env.AI_PROVIDER;
  process.env.MINIMAX_API_KEY = 'test-key';
  minimax.createMessage = async () => ({
    model: 'MiniMax-M3',
    stop_reason: 'tool_use',
    content: [{ type: 'tool_use', id: 't1', name: 'submit_slip', input: state.slip }],
  });
  manager = as(await cookie('manager@example.com'));
  cashier = as(await cookie('cashier@example.com')); // branch 2 -> warehouse 2
  await db.query('UPDATE pos_shifts SET closed_at = UTC_TIMESTAMP() WHERE user_id = 4 AND closed_at IS NULL');
  await db.query("DELETE FROM settings WHERE org_id = 1 AND setting_key LIKE 'pos.%'");

  const cat = await manager.post('/api/products/categories', { name: `เครื่องดื่ม ${RUN}` });
  state.categoryId = cat.body.data.id;
  const p = await manager.post('/api/products', {
    sku: `T9-${RUN}`,
    barcode: `885${RUN}`,
    name: 'น้ำดื่มทดสอบ',
    price: 10,
    cost: 6,
    categoryId: state.categoryId,
  });
  assert.equal(p.status, 201, JSON.stringify(p.body));
  state.productId = p.body.data.id;
  await manager.post('/api/inventory/receive', { warehouseId: 2, items: [{ productId: state.productId, quantity: 100, unitCost: 6 }] });
});

after(async () => {
  minimax.createMessage = originalCreate;
  if (savedKey === undefined) delete process.env.MINIMAX_API_KEY;
  else process.env.MINIMAX_API_KEY = savedKey;
  if (savedProvider !== undefined) process.env.AI_PROVIDER = savedProvider;
  if (state.orderIds.length) await db.query('DELETE FROM sales_orders WHERE id IN (:ids)', { ids: state.orderIds });
  await db.query('DELETE FROM pos_shifts WHERE user_id = 4 AND opened_at > UTC_TIMESTAMP() - INTERVAL 1 HOUR');
  await db.query('DELETE FROM held_bills WHERE user_id = 4');
  await db.query('DELETE FROM customers WHERE phone = :phone', { phone: `09${RUN.slice(-8).replace(/\D/g, '1').padStart(8, '1')}` });
  await db.query("DELETE FROM products WHERE sku LIKE 'T9-%'");
  await db.query('DELETE FROM product_categories WHERE id = :id', { id: state.categoryId });
  await db.query("DELETE FROM settings WHERE org_id = 1 AND setting_key LIKE 'pos.%'");
  await db.pool.end();
});

describe('pure helpers', () => {
  test('sale windows, including ones that wrap midnight', () => {
    assert.equal(inWindow('10:59', '00:00', '11:00'), true);
    assert.equal(inWindow('11:00', '00:00', '11:00'), false);
    assert.equal(inWindow('23:30', '22:00', '06:00'), true);
    assert.equal(inWindow('05:59', '22:00', '06:00'), true);
    assert.equal(inWindow('12:00', '22:00', '06:00'), false);
  });

  test('split tender: cash covers the rest and is the only change giver', () => {
    const r = settlePayments(
      [
        { method: 'promptpay', amount: 60 },
        { method: 'cash', amount: 100 },
      ],
      100,
    );
    assert.deepEqual(
      r.rows.map((p) => [p.method, p.amount]),
      [
        ['promptpay', 60],
        ['cash', 40],
      ],
    );
    assert.equal(r.change, 60);
    assert.throws(() => settlePayments([{ method: 'card', amount: 120 }], 100), /เกินยอดบิล/);
    assert.throws(() => settlePayments([{ method: 'card', amount: 50 }], 100), /รับเงินไม่ครบ/);
  });
});

describe('units and catalog', () => {
  test('manager sets a pack unit; its barcode sells the pack', async () => {
    assert.equal((await cashier.put(`/api/products/${state.productId}/units`, { units: [] })).status, 403);
    const res = await manager.put(`/api/products/${state.productId}/units`, {
      units: [
        { name: 'แพ็ก', factor: 6, barcode: `P6-${RUN}`, price: 55 },
        { name: 'ลัง', factor: 24, barcode: `C24-${RUN}` },
      ],
    });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    state.unitId = res.body.data.find((u) => u.name === 'แพ็ก').id;
    const clash = await manager.put(`/api/products/${state.productId}/units`, { units: [{ name: 'x', factor: 2, barcode: `885${RUN}` }] });
    assert.equal(clash.status, 409, 'cannot reuse another product barcode');

    await cashier.post('/api/pos/shift/open', { openingCash: 1000 });
    const look = await cashier.get(`/api/pos/lookup?code=P6-${RUN}`);
    assert.equal(look.status, 200, JSON.stringify(look.body));
    assert.equal(look.body.data.matchedUnitId, state.unitId);
    const carton = look.body.data.units.find((u) => u.name === 'ลัง');
    assert.equal(carton.price, 240, 'unpriced unit = factor x base price');
  });

  test('selling 2 packs deducts 12 pieces; void returns them', async () => {
    const before = await stock();
    const res = await sell({ items: [{ productId: state.productId, unitId: state.unitId, quantity: 2 }], payments: [{ method: 'cash', amount: 200 }] });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(res.body.data.total, 110);
    assert.equal(res.body.data.change, 90);
    assert.equal(res.body.data.items[0].unitName, 'แพ็ก');
    assert.equal(await stock(), before - 12);
    const v = await manager.post(`/api/pos/orders/${res.body.data.id}/void`, { reason: 'ทดสอบ' });
    assert.equal(v.status, 200);
    assert.equal(await stock(), before);
  });
});

describe('split payment, members and points', () => {
  test('quick member signup and lookup by phone', async () => {
    const phone = `09${RUN.slice(-8).replace(/\D/g, '1').padStart(8, '1')}`;
    const res = await cashier.post('/api/pos/customers', { name: 'คุณทดสอบ', phone });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.match(res.body.data.memberNo, /^M\d{6}$/);
    state.memberId = res.body.data.id;
    assert.equal((await cashier.post('/api/pos/customers', { name: 'ซ้ำ', phone })).status, 400);
    const found = await cashier.get(`/api/pos/customers?q=${phone.slice(-4)}`);
    assert.ok(found.body.data.some((c) => c.id === state.memberId));
  });

  test('PromptPay + cash split earns points; redeeming points lowers the bill; void restores them', async () => {
    const sale = await sell({
      items: [{ productId: state.productId, quantity: 10 }],
      customerId: state.memberId,
      payments: [
        { method: 'promptpay', amount: 60, reference: 'QR' },
        { method: 'cash', amount: 50 },
      ],
    });
    assert.equal(sale.status, 201, JSON.stringify(sale.body));
    assert.deepEqual(
      sale.body.data.payments.map((p) => [p.method, p.amount]),
      [
        ['promptpay', 60],
        ['cash', 40],
      ],
    );
    assert.equal(sale.body.data.change, 10);
    assert.equal(sale.body.data.pointsEarned, 4); // 100 / 25
    const j = await db.query(
      `SELECT a.code, l.debit FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id JOIN chart_of_accounts a ON a.id = l.account_id
        WHERE e.ref_type = 'sales_order' AND e.ref_id = :id AND l.debit > 0`,
      { id: sale.body.data.id },
    );
    assert.equal(Number(j.find((r) => r.code === '1100').debit), 40, 'cash part to the drawer');
    assert.equal(Number(j.find((r) => r.code === '1110').debit), 60, 'PromptPay part to the bank');

    const tooMany = await sell({
      items: [{ productId: state.productId, quantity: 1 }],
      customerId: state.memberId,
      pointsUsed: 99,
      payments: [{ method: 'cash', amount: 10 }],
    });
    assert.equal(tooMany.status, 400);
    const redeem = await sell({
      items: [{ productId: state.productId, quantity: 1 }],
      customerId: state.memberId,
      pointsUsed: 4,
      payments: [{ method: 'cash', amount: 9 }],
    });
    assert.equal(redeem.status, 201, JSON.stringify(redeem.body));
    assert.equal(redeem.body.data.total, 9); // 10 - 4 x 0.25
    assert.equal(redeem.body.data.pointsUsed, 4);
    let c = await db.one('SELECT points FROM customers WHERE id = :id', { id: state.memberId });
    assert.equal(c.points, 0);
    await manager.post(`/api/pos/orders/${redeem.body.data.id}/void`, { reason: 'ทดสอบ' });
    c = await db.one('SELECT points FROM customers WHERE id = :id', { id: state.memberId });
    assert.equal(c.points, 4);
  });
});

describe('held bills and sale rules', () => {
  test('park a bill and recall it (recall removes it)', async () => {
    const hold = await cashier.post('/api/pos/held', { label: 'โต๊ะ 1', cart: { items: [{ productId: state.productId, quantity: 3 }] }, total: 30 });
    assert.equal(hold.status, 201, JSON.stringify(hold.body));
    const list = await cashier.get('/api/pos/held');
    const held = list.body.data.find((h) => h.id === hold.body.data.id);
    assert.equal(held.cart.items[0].quantity, 3);
    assert.equal((await cashier.delete(`/api/pos/held/${held.id}`)).status, 200);
    assert.equal((await cashier.delete(`/api/pos/held/${held.id}`)).status, 404);
  });

  test('category no-sale window and age confirmation are enforced at checkout', async () => {
    await manager.patch(`/api/products/categories/${state.categoryId}`, { saleBlock: { from: '00:00', to: '23:59', label: 'ทดสอบ' } });
    const blocked = await sell({ items: [{ productId: state.productId, quantity: 1 }], payments: [{ method: 'cash', amount: 10 }] });
    assert.equal(blocked.status, 409);
    assert.match(blocked.body.error.message, /ขาย .* ไม่ได้ในช่วง/);
    await manager.patch(`/api/products/categories/${state.categoryId}`, { saleBlock: null, ageRestricted: true });
    const noAge = await sell({ items: [{ productId: state.productId, quantity: 1 }], payments: [{ method: 'cash', amount: 10 }] });
    assert.equal(noAge.status, 400);
    const ok = await sell({ items: [{ productId: state.productId, quantity: 1 }], ageConfirmed: true, payments: [{ method: 'cash', amount: 10 }] });
    assert.equal(ok.status, 201, JSON.stringify(ok.body));
    await manager.patch(`/api/products/categories/${state.categoryId}`, { ageRestricted: false });
  });
});

describe('bank account', () => {
  test('the shop transfer account defaults to the owner account and appears on documents', async () => {
    const s = await cashier.get('/api/pos/settings');
    assert.equal(s.body.data.bankAccount.number, '0621554271');
    assert.equal(s.body.data.bankAccount.display, '062-1-55427-1');
    assert.equal(s.body.data.bankAccount.bank, 'ธนาคารกสิกรไทย');
    const bad = await manager.put('/api/pos/settings', { bankAccount: { bank: 'x', number: '12', name: 'y' } });
    assert.equal(bad.status, 400);
  });
});

describe('slip check', () => {
  test('a slip reference pays only one bill', async () => {
    await manager.put('/api/pos/settings', { promptpayId: '0812345678' });
    state.slip = {
      isSlip: true,
      transRef: `REF${RUN}`,
      amount: 20,
      paidAt: '2026-10-20 10:00',
      bank: 'KBank',
      receiverName: 'ร้านทดสอบ',
      receiverAccount: 'xxx-xxx-5678',
      confidence: 'high',
    };
    const img = Buffer.alloc(200, 1).toString('base64');
    const v = await cashier.post('/api/pos/slip/verify', { mediaType: 'image/png', data: img, amount: 20 });
    assert.equal(v.status, 200, JSON.stringify(v.body));
    assert.equal(v.body.data.ok, true);
    const wrong = await cashier.post('/api/pos/slip/verify', { mediaType: 'image/png', data: img, amount: 25 });
    assert.equal(wrong.body.data.checks.amount, false);

    const first = await sell({
      items: [{ productId: state.productId, quantity: 2 }],
      payments: [{ method: 'promptpay', amount: 20, slipRef: v.body.data.transRef }],
    });
    assert.equal(first.status, 201, JSON.stringify(first.body));
    const again = await sell({
      items: [{ productId: state.productId, quantity: 2 }],
      payments: [{ method: 'promptpay', amount: 20, slipRef: v.body.data.transRef }],
    });
    assert.equal(again.status, 409);
    const reused = await cashier.post('/api/pos/slip/verify', { mediaType: 'image/png', data: img, amount: 20 });
    assert.equal(reused.body.data.checks.unused, false);
    assert.equal(reused.body.data.ok, false);
  });
});

describe('shift cash', () => {
  test('pay-in, pay-out and safe drop feed the expected cash; denominations close the shift', async () => {
    assert.equal((await cashier.post('/api/pos/shift/cash', { type: 'pay_out', amount: 999_999, reason: 'เกิน' })).status, 400);
    assert.equal((await cashier.post('/api/pos/shift/cash', { type: 'pay_in', amount: 100, reason: 'เงินทอนเพิ่ม' })).status, 201);
    assert.equal((await cashier.post('/api/pos/shift/cash', { type: 'pay_out', amount: 50, reason: 'ค่าน้ำแข็ง' })).status, 201);
    assert.equal((await cashier.post('/api/pos/shift/cash', { type: 'pickup', amount: 500, reason: 'เข้าตู้เซฟ' })).status, 201);
    const x = await cashier.get('/api/pos/shift/report');
    assert.equal(x.status, 200, JSON.stringify(x.body));
    assert.equal(x.body.data.kind, 'X');
    // 1000 float + 40 cash (split bill) + 10 cash (age bill) + 100 - 50 - 500 ; voided bills net to zero
    assert.equal(x.body.data.expectedCash, 600);
    assert.ok(x.body.data.topItems.length >= 1);

    const z = await cashier.post('/api/pos/shift/close', { denominations: { 500: 1, 100: 1 } });
    assert.equal(z.status, 200, JSON.stringify(z.body));
    assert.equal(z.body.data.kind, 'Z');
    assert.equal(z.body.data.closingCash, 600);
    assert.equal(z.body.data.difference, 0);
    assert.equal(z.body.data.cashMovements.length, 3);
  });
});
