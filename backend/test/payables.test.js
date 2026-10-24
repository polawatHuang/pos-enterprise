'use strict';

// The buying side: purchase request -> PO, supplier bills and credit notes (AP), payment vouchers
// with withholding tax (and 50 ทวิ, ภ.ง.ด.53), petty cash and the substitute receipt.
process.env.NODE_ENV = 'test';

const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { createApp } = require('../src/app');
const db = require('../src/db/pool');

const app = createApp();
const RUN = Date.now().toString(36);
const D = '2019-07-'; // a month no other test uses
const state = { supplierId: 0, productId: 0, prIds: [], poIds: [] };
let accountant;
let manager;
let cashier;

async function as(email) {
  const res = await request(app).post('/api/auth/login').send({ email, password: 'Admin@1234' });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const cookie = res.headers['set-cookie'].map((c) => c.split(';')[0]).join('; ');
  return {
    get: (url) => request(app).get(url).set('Cookie', cookie),
    post: (url, body) => request(app).post(url).set('Cookie', cookie).send(body),
  };
}

async function ledgerFor(refType, refId) {
  const rows = await db.query(
    `SELECT a.code, SUM(l.debit) AS dr, SUM(l.credit) AS cr FROM journal_entries e
       JOIN journal_lines l ON l.entry_id = e.id JOIN chart_of_accounts a ON a.id = l.account_id
      WHERE e.ref_type = :refType AND e.ref_id = :refId GROUP BY a.code`,
    { refType, refId },
  );
  return Object.fromEntries(rows.map((r) => [r.code, { dr: Number(r.dr), cr: Number(r.cr) }]));
}

async function cleanup() {
  await db.query("DELETE FROM journal_entries WHERE org_id = 1 AND entry_date >= '2019-07-01' AND entry_date < '2019-08-01'");
  await db.query("DELETE FROM documents WHERE org_id = 1 AND doc_date >= '2019-07-01' AND doc_date < '2019-08-01'");
  await db.query("DELETE FROM transactions WHERE org_id = 1 AND txn_date >= '2019-07-01' AND txn_date < '2019-08-01'");
  await db.query("DELETE FROM payment_vouchers WHERE org_id = 1 AND pay_date >= '2019-07-01' AND pay_date < '2019-08-01'");
  await db.query("DELETE FROM supplier_bills WHERE org_id = 1 AND bill_date >= '2019-07-01' AND bill_date < '2019-08-01'");
  await db.query("DELETE FROM petty_cash_topups WHERE org_id = 1 AND topup_date >= '2019-07-01' AND topup_date < '2019-08-01'");
  await db.query("DELETE FROM document_sequences WHERE org_id = 1 AND period = '201907'");
}

before(async () => {
  await cleanup();
  accountant = await as('accountant@example.com');
  manager = await as('manager@example.com');
  cashier = await as('cashier@example.com');
  const s = await manager.post('/api/purchasing/suppliers', { name: `ผู้ขายทดสอบเจ้าหนี้ ${RUN}`, taxId: '0105500000002' });
  assert.equal(s.status, 201, JSON.stringify(s.body));
  state.supplierId = s.body.data.id;
  const p = await manager.post('/api/products', { name: `สินค้าขอซื้อ ${RUN}`, price: 30, cost: 12 });
  state.productId = p.body.data.id;
});

after(async () => {
  await cleanup();
  if (state.prIds.length) await db.query('DELETE FROM purchase_requests WHERE id IN (:ids)', { ids: state.prIds });
  if (state.poIds.length) await db.query('DELETE FROM purchase_orders WHERE id IN (:ids)', { ids: state.poIds });
  await db.query('DELETE FROM supplier_bills WHERE supplier_id = :s', { s: state.supplierId });
  await db.query('DELETE FROM payment_vouchers WHERE supplier_id = :s', { s: state.supplierId });
  await db.query('DELETE FROM suppliers WHERE id = :s', { s: state.supplierId });
  await db.query('DELETE FROM products WHERE id = :p', { p: state.productId });
  await db.pool.end();
});

describe('purchase requests (ใบขอซื้อ)', () => {
  test('staff ask, a manager approves into a PO draft or rejects; only the requester or a manager can cancel', async () => {
    const pr = await cashier.post('/api/purchasing/requests', {
      warehouseId: 2,
      supplierId: state.supplierId,
      reason: 'ของใกล้หมด',
      items: [{ productId: state.productId, quantity: 24 }],
    });
    assert.equal(pr.status, 201, JSON.stringify(pr.body));
    state.prIds.push(pr.body.data.id);
    assert.match(pr.body.data.prNo, /^PR\d{6}-\d{4}$/);
    assert.equal(pr.body.data.estTotal, 288);
    assert.equal((await cashier.post(`/api/purchasing/requests/${pr.body.data.id}/approve`, {})).status, 403);

    const ok = await manager.post(`/api/purchasing/requests/${pr.body.data.id}/approve`, {});
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    assert.equal(ok.body.data.status, 'approved');
    assert.ok(ok.body.data.purchaseOrderId);
    state.poIds.push(ok.body.data.purchaseOrderId);
    const po = await manager.get(`/api/purchasing/orders/${ok.body.data.purchaseOrderId}`);
    assert.equal(po.body.data.status, 'draft');
    assert.equal(po.body.data.supplierId, state.supplierId);
    assert.equal(po.body.data.items[0].quantity, 24);
    assert.match(po.body.data.note, new RegExp(pr.body.data.prNo));
    assert.equal((await manager.post(`/api/purchasing/requests/${pr.body.data.id}/approve`, {})).status, 409);

    const pr2 = await cashier.post('/api/purchasing/requests', { warehouseId: 2, items: [{ productId: state.productId, quantity: 1 }] });
    state.prIds.push(pr2.body.data.id);
    const no = await manager.post(`/api/purchasing/requests/${pr2.body.data.id}/reject`, { reason: 'ยังมีของ' });
    assert.equal(no.body.data.status, 'rejected');
    assert.equal(no.body.data.rejectReason, 'ยังมีของ');

    const pr3 = await manager.post('/api/purchasing/requests', { warehouseId: 2, items: [{ productId: state.productId, quantity: 1 }] });
    state.prIds.push(pr3.body.data.id);
    assert.equal((await cashier.post(`/api/purchasing/requests/${pr3.body.data.id}/cancel`, {})).status, 403);
    assert.equal((await manager.post(`/api/purchasing/requests/${pr3.body.data.id}/cancel`, {})).body.data.status, 'cancelled');
  });
});

describe('supplier bills and payment vouchers', () => {
  test('bill and credit note post AP; a voucher pays them net of WHT, shows on PND53, gets a 50 ทวิ, and can be undone', async () => {
    const bill = await accountant.post('/api/accounting/payables/bills', {
      supplierId: state.supplierId,
      supplierDocNo: `INV-${RUN}`,
      billDate: `${D}05`,
      dueDate: `${D}30`,
      accountCode: '5900',
      amount: 1000,
      vatMode: 'exclusive',
    });
    assert.equal(bill.status, 201, JSON.stringify(bill.body));
    assert.match(bill.body.data.billNo, /^AP201907-\d{4}$/);
    assert.equal(bill.body.data.total, 1070);
    assert.deepEqual(await ledgerFor('supplier_bill', bill.body.data.id), { 1400: { dr: 70, cr: 0 }, 2100: { dr: 0, cr: 1070 }, 5900: { dr: 1000, cr: 0 } });
    // the same supplier invoice cannot be booked twice
    const dup = await accountant.post('/api/accounting/payables/bills', { supplierId: state.supplierId, supplierDocNo: `INV-${RUN}`, billDate: `${D}06`, amount: 5 });
    assert.equal(dup.status, 409);

    const cn = await accountant.post('/api/accounting/payables/bills', {
      kind: 'credit_note',
      supplierId: state.supplierId,
      supplierDocNo: `CN-${RUN}`,
      billDate: `${D}08`,
      accountCode: '5900',
      amount: 107,
      vatMode: 'inclusive',
    });
    assert.equal(cn.status, 201, JSON.stringify(cn.body));
    assert.equal(cn.body.data.amount, 100);
    assert.equal(cn.body.data.signedTotal, -107);
    assert.deepEqual(await ledgerFor('supplier_bill', cn.body.data.id), { 1400: { dr: 0, cr: 7 }, 2100: { dr: 107, cr: 0 }, 5900: { dr: 0, cr: 100 } });

    const owed = (await accountant.get('/api/accounting/payables/bills/owed')).body.data.find((o) => o.supplierId === state.supplierId);
    assert.equal(owed.amount, 963);
    assert.equal(owed.count, 2);

    const pv = await accountant.post('/api/accounting/payables/vouchers', {
      supplierId: state.supplierId,
      payDate: `${D}20`,
      paymentMethod: 'transfer',
      billIds: [bill.body.data.id, cn.body.data.id],
      payeeType: 'company',
      whtRate: 3,
      whtIncomeType: '40(8)-service',
    });
    assert.equal(pv.status, 201, JSON.stringify(pv.body));
    assert.match(pv.body.data.pvNo, /^PV201907-\d{4}$/);
    assert.equal(pv.body.data.gross, 963);
    assert.equal(pv.body.data.whtBase, 900);
    assert.equal(pv.body.data.whtAmount, 27);
    assert.equal(pv.body.data.netPaid, 936);
    assert.equal(pv.body.data.bills.length, 2);
    assert.ok(pv.body.data.bills.every((b) => b.status === 'paid'));
    assert.deepEqual(await ledgerFor('payment_voucher', pv.body.data.id), { 1110: { dr: 0, cr: 936 }, 2100: { dr: 963, cr: 0 }, 2210: { dr: 0, cr: 27 } });
    assert.equal((await accountant.post(`/api/accounting/payables/bills/${bill.body.data.id}/void`, { reason: 'x' })).status, 409);

    const pndRes = await accountant.get('/api/accounting/tax/wht?year=2019&month=7&form=PND53');
    assert.equal(pndRes.status, 200, JSON.stringify(pndRes.body));
    const pnd53 = pndRes.body.data;
    const line = pnd53.items.find((i) => i.voucherId === pv.body.data.id);
    assert.ok(line, JSON.stringify(pnd53.items));
    assert.equal(line.wht, 27);
    assert.equal(line.amount, 900);

    const cert = await accountant.post(`/api/accounting/payables/vouchers/${pv.body.data.id}/wht-certificate`, {});
    assert.equal(cert.status, 201, JSON.stringify(cert.body));
    const doc = (await accountant.get(`/api/accounting/documents/${cert.body.data.documentId}`)).body.data;
    assert.equal(doc.docType, 'wht_certificate');
    assert.equal(doc.whtAmount, 27);
    assert.equal(doc.whtSource.amount, 900);
    assert.equal(doc.whtSource.counterpartyType, 'company');

    // undo: the certificate first, then the voucher; the bills are owed again
    assert.equal((await accountant.post(`/api/accounting/payables/vouchers/${pv.body.data.id}/void`, { reason: 'จ่ายผิด' })).status, 400);
    await accountant.post(`/api/accounting/documents/${cert.body.data.documentId}/void`, { reason: 'ออกใหม่' });
    const v = await accountant.post(`/api/accounting/payables/vouchers/${pv.body.data.id}/void`, { reason: 'จ่ายผิด' });
    assert.equal(v.status, 200, JSON.stringify(v.body));
    assert.ok(v.body.data.bills.every((b) => b.status === 'unpaid'));
    assert.ok(Object.values(await ledgerFor('payment_voucher', pv.body.data.id)).every((x) => x.dr === x.cr));
    // a voucher can only pay one supplier's open bills
    assert.equal((await accountant.post('/api/accounting/payables/vouchers', { supplierId: state.supplierId, payDate: `${D}21`, paymentMethod: 'cash', billIds: [cn.body.data.id] })).status, 400);
    assert.equal((await cashier.get('/api/accounting/payables/bills')).status, 403);
  });
});

describe('petty cash and substitute receipts', () => {
  test('top-ups fill the box, expenses paid from it empty it; a no-VAT expense gets a ใบรับรองแทนใบเสร็จ', async () => {
    const before = (await accountant.get('/api/accounting/payables/petty-cash')).body.data.balance;
    const top = await accountant.post('/api/accounting/payables/petty-cash/topups', { date: `${D}01`, amount: 2000, fromMethod: 'cash' });
    assert.equal(top.status, 201, JSON.stringify(top.body));
    assert.deepEqual(await ledgerFor('petty_cash_topup', top.body.data.id), { 1100: { dr: 0, cr: 2000 }, 1105: { dr: 2000, cr: 0 } });
    const exp = await accountant.post('/api/accounting/transactions', {
      type: 'expense',
      category: 'ค่าใช้จ่ายอื่น',
      amount: 150,
      txnDate: `${D}03`,
      description: 'ซื้อน้ำแข็งจากตลาด',
      counterparty: 'แม่ค้าตลาด',
      paymentMethod: 'petty_cash',
    });
    assert.equal(exp.status, 201, JSON.stringify(exp.body));
    const pc = (await accountant.get('/api/accounting/payables/petty-cash')).body.data;
    assert.equal(Math.round((pc.balance - before) * 100) / 100, 1850);
    assert.ok(pc.expenses.some((x) => x.id === exp.body.data.id));

    const sr = await accountant.post('/api/accounting/documents/substitute-receipt', { transactionId: exp.body.data.id });
    assert.equal(sr.status, 201, JSON.stringify(sr.body));
    assert.equal(sr.body.data.docType, 'substitute_receipt');
    assert.match(sr.body.data.docNo, /^SR201907-\d{4}$/);
    assert.equal(sr.body.data.total, 150);
    assert.equal(sr.body.data.items[0].description, 'ซื้อน้ำแข็งจากตลาด');
    // asking again gives the same document; the expense cannot be voided while it stands
    assert.equal((await accountant.post('/api/accounting/documents/substitute-receipt', { transactionId: exp.body.data.id })).body.data.id, sr.body.data.id);
    assert.equal((await accountant.post(`/api/accounting/transactions/${exp.body.data.id}/void`, { reason: 'x' })).status, 400);

    const vatExp = await accountant.post('/api/accounting/transactions', {
      type: 'expense',
      category: 'ค่าใช้จ่ายอื่น',
      amount: 100,
      vatMode: 'exclusive',
      txnDate: `${D}03`,
      description: 'มี VAT',
      paymentMethod: 'cash',
    });
    assert.equal(vatExp.body.data.vatAmount, 7);
    assert.equal((await accountant.post('/api/accounting/documents/substitute-receipt', { transactionId: vatExp.body.data.id })).status, 400);
  });

  test('the documents hub lists requests, bills, vouchers and top-ups', async () => {
    const hub = await accountant.get(`/api/documents/hub?from=${D}01&to=${D}31`);
    const types = new Set(hub.body.data.map((d) => d.type));
    for (const t of ['supplier_bill', 'supplier_credit', 'payment_voucher', 'petty_cash_topup', 'substitute_receipt']) assert.ok(types.has(t), t);
    const pr = await manager.get('/api/documents/hub?type=purchase_request');
    assert.ok(pr.body.data.some((d) => state.prIds.includes(d.id)));
  });
});
