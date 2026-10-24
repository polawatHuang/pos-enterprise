'use strict';

// ศูนย์รวมเอกสาร: debit notes, billing notes, numbered stock documents (GR/AJ/WS), the stock
// ledger (ม.87(3)) and the one list that gathers every document the user may read.
process.env.NODE_ENV = 'test';

const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { createApp } = require('../src/app');
const db = require('../src/db/pool');
const { localDate } = require('../src/utils/dates');

const app = createApp();
const RUN = Date.now().toString(36);
const D = '2019-06-'; // documents live in a month no other test uses
const state = { productId: 0, orderIds: [], shiftIds: [] };
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
      WHERE e.ref_type = :refType AND e.ref_id = :refId AND e.status = 'posted' GROUP BY a.code`,
    { refType, refId },
  );
  return Object.fromEntries(rows.map((r) => [r.code, { dr: Number(r.dr), cr: Number(r.cr) }]));
}

async function cleanup() {
  await db.query("DELETE FROM journal_entries WHERE org_id = 1 AND entry_date >= '2019-06-01' AND entry_date < '2019-07-01'");
  await db.query("DELETE FROM documents WHERE org_id = 1 AND doc_date >= '2019-06-01' AND doc_date < '2019-07-01'");
  await db.query("DELETE FROM document_sequences WHERE org_id = 1 AND period = '201906'");
}

/** An issued tax invoice for a customer, VAT exclusive. */
async function taxInvoice(partyName, unitPrice, day = '05') {
  const d = await accountant.post('/api/accounting/documents', {
    docType: 'tax_invoice',
    docDate: `${D}${day}`,
    partyName,
    partyTaxId: '0105500000002',
    items: [{ description: 'สินค้า', quantity: 1, unitPrice }],
  });
  assert.equal(d.status, 201, JSON.stringify(d.body));
  const i = await accountant.post(`/api/accounting/documents/${d.body.data.id}/issue`, {});
  assert.equal(i.status, 200, JSON.stringify(i.body));
  return i.body.data;
}

before(async () => {
  await cleanup();
  accountant = await as('accountant@example.com');
  manager = await as('manager@example.com');
  cashier = await as('cashier@example.com');
});

after(async () => {
  await cleanup();
  for (const id of state.orderIds) await db.query("DELETE FROM journal_entries WHERE ref_type = 'sales_order' AND ref_id = :id", { id });
  if (state.orderIds.length) await db.query('DELETE FROM sales_orders WHERE id IN (:ids)', { ids: state.orderIds });
  if (state.shiftIds.length) await db.query('DELETE FROM pos_shifts WHERE id IN (:ids)', { ids: state.shiftIds });
  if (state.productId) {
    await db.query("DELETE FROM journal_entries WHERE ref_type = 'stock_lot' AND ref_id IN (SELECT id FROM stock_lots WHERE product_id = :p)", { p: state.productId });
    await db.query(
      'DELETE FROM stock_documents WHERE id IN (SELECT stock_document_id FROM stock_movements WHERE product_id = :p AND stock_document_id IS NOT NULL)',
      { p: state.productId },
    );
    await db.query('DELETE FROM stock_lots WHERE product_id = :p', { p: state.productId });
    await db.query('DELETE FROM products WHERE id = :p', { p: state.productId });
  }
  await db.pool.end();
});

describe('debit note (ใบเพิ่มหนี้)', () => {
  test('must point at an issued tax invoice; posts AR / sales / output VAT and counts in PP.30', async () => {
    const ti = await taxInvoice(`ลูกค้าเพิ่มหนี้ ${RUN}`, 1000);
    const quote = await accountant.post('/api/accounting/documents', { docType: 'quotation', docDate: `${D}05`, partyName: 'x', items: [{ description: 'x', quantity: 1, unitPrice: 1 }] });
    const bad = await accountant.post('/api/accounting/documents', {
      docType: 'debit_note',
      docDate: `${D}10`,
      partyName: 'x',
      refDocId: quote.body.data.id,
      items: [{ description: 'ค่าขนส่งเพิ่ม', quantity: 1, unitPrice: 100 }],
    });
    assert.equal(bad.status, 400);
    assert.equal(
      (await accountant.post('/api/accounting/documents', { docType: 'debit_note', docDate: `${D}10`, partyName: 'x', items: [{ description: 'x', quantity: 1, unitPrice: 1 }] })).status,
      400,
    );

    const before = (await accountant.get('/api/accounting/tax/pp30?year=2019&month=6')).body.data;
    // the tax invoice page can start one (dated today; a draft is deleted when voided)
    const conv = await accountant.post(`/api/accounting/documents/${ti.id}/convert`, { docType: 'debit_note' });
    assert.equal(conv.status, 201, JSON.stringify(conv.body));
    assert.equal(conv.body.data.refDocId, ti.id);
    await accountant.post(`/api/accounting/documents/${conv.body.data.id}/void`, { reason: 'ทดสอบ' });
    const dn = await accountant.post('/api/accounting/documents', {
      docType: 'debit_note',
      docDate: `${D}10`,
      partyName: ti.partyName,
      refDocId: ti.id,
      items: [{ description: 'ค่าสินค้าเพิ่ม', quantity: 1, unitPrice: 1000 }],
    });
    assert.equal(dn.status, 201, JSON.stringify(dn.body));
    const issued = await accountant.post(`/api/accounting/documents/${dn.body.data.id}/issue`, {});
    assert.equal(issued.status, 200, JSON.stringify(issued.body));
    assert.match(issued.body.data.docNo, /^DN201906-\d{4}$/);
    const l = await ledgerFor('document', dn.body.data.id);
    assert.deepEqual(l['1200'], { dr: 1070, cr: 0 });
    assert.deepEqual(l['4100'], { dr: 0, cr: 1000 });
    const after = (await accountant.get('/api/accounting/tax/pp30?year=2019&month=6')).body.data;
    assert.equal(Math.round((after.sales.vat - before.sales.vat) * 100) / 100, 70);
    // a debit note is collected like an invoice
    assert.equal((await accountant.post(`/api/accounting/documents/${dn.body.data.id}/pay`, { paymentMethod: 'cash', paidDate: `${D}20` })).body.data.status, 'paid');
  });
});

describe('billing note (ใบวางบิล)', () => {
  test('collects one customer\'s unpaid invoices less credit notes; issuing posts nothing; paying settles all at once', async () => {
    const who = `ลูกค้าวางบิล ${RUN}`;
    const a = await taxInvoice(who, 1000, '02');
    const b = await taxInvoice(who, 500, '03');
    const other = await taxInvoice(`ลูกค้าอื่น ${RUN}`, 300, '03');
    const cnDraft = await accountant.post('/api/accounting/documents', {
      docType: 'credit_note',
      docDate: `${D}04`,
      partyName: who,
      refDocId: b.id,
      items: [{ description: 'คืนสินค้า', quantity: 1, unitPrice: 500 }],
    });
    assert.equal(cnDraft.status, 201, JSON.stringify(cnDraft.body));
    const cn = await accountant.post(`/api/accounting/documents/${cnDraft.body.data.id}/issue`, {});
    assert.equal(cn.status, 200, JSON.stringify(cn.body));

    const billable = await accountant.get(`/api/accounting/documents/billable?partyName=${encodeURIComponent(who)}`);
    assert.equal(billable.status, 200, JSON.stringify(billable.body));
    assert.deepEqual(billable.body.data.map((d) => d.id).sort(), [a.id, b.id, cnDraft.body.data.id].sort());
    const customers = (await accountant.get('/api/accounting/documents/billable')).body.data;
    assert.ok(customers.some((c) => c.partyName === who && c.count === 3));

    // another customer's invoice cannot ride along
    const mixed = await accountant.post('/api/accounting/documents/billing-note', { docDate: `${D}15`, documentIds: [a.id, other.id] });
    assert.equal(mixed.status, 400);

    const bn = await accountant.post('/api/accounting/documents/billing-note', {
      docDate: `${D}15`,
      dueDate: `${D}30`,
      documentIds: [a.id, b.id, cnDraft.body.data.id],
    });
    assert.equal(bn.status, 201, JSON.stringify(bn.body));
    assert.match(bn.body.data.docNo, /^BN201906-\d{4}$/);
    // 1070 + 535 - 535 (the credit note gives back all of b)
    assert.equal(bn.body.data.total, 1070);
    assert.equal(bn.body.data.billedDocuments.length, 3);
    assert.deepEqual(await ledgerFor('document', bn.body.data.id), {});
    // the same invoice cannot be on two open billing notes
    assert.equal((await accountant.post('/api/accounting/documents/billing-note', { docDate: `${D}16`, documentIds: [a.id] })).status, 400);
    // printable detail lists what it collects
    const detail = await accountant.get(`/api/accounting/documents/${bn.body.data.id}`);
    assert.equal(detail.body.data.billedDocuments.length, 3);

    const paid = await accountant.post(`/api/accounting/documents/${bn.body.data.id}/settle`, { paymentMethod: 'transfer', paidDate: `${D}25` });
    assert.equal(paid.status, 200, JSON.stringify(paid.body));
    assert.equal(paid.body.data.status, 'paid');
    assert.ok(paid.body.data.billedDocuments.every((d) => d.status === 'paid'));
    assert.deepEqual(await ledgerFor('document', bn.body.data.id), { 1110: { dr: 1070, cr: 0 }, 1200: { dr: 0, cr: 1070 } });

    // voiding the paid billing note reverses the payment and reopens what it settled
    const v = await accountant.post(`/api/accounting/documents/${bn.body.data.id}/void`, { reason: 'ทดสอบ' });
    assert.equal(v.status, 200);
    // the payment and its reversal cancel out
    assert.ok(Object.values(await ledgerFor('document', bn.body.data.id)).every((x) => x.dr === x.cr));
    const again = await accountant.get(`/api/accounting/documents/billable?partyName=${encodeURIComponent(who)}`);
    assert.equal(again.body.data.length, 3);
  });
});

describe('stock documents and the stock ledger (ม.87(3))', () => {
  test('receive / adjust / write-off get GR / AJ / WS numbers; the ledger balances with the stock', async () => {
    const p = await manager.post('/api/products', { name: `สินค้ารายงานสต๊อก ${RUN}`, price: 50, cost: 20, trackExpiry: true });
    assert.equal(p.status, 201, JSON.stringify(p.body));
    state.productId = p.body.data.id;
    const exp = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);

    const gr = await manager.post('/api/inventory/receive', {
      warehouseId: 2,
      reference: `INV-${RUN}`,
      items: [{ productId: state.productId, quantity: 10, unitCost: 20, expiryDate: exp }],
    });
    assert.equal(gr.status, 201, JSON.stringify(gr.body));
    assert.match(gr.body.document.docNo, /^GR\d{6}-\d{4}$/);
    const grDoc = await manager.get(`/api/inventory/documents/${gr.body.document.id}`);
    assert.equal(grDoc.status, 200);
    assert.equal(grDoc.body.data.reference, `INV-${RUN}`);
    assert.equal(grDoc.body.data.totalCost, 200);
    assert.equal(grDoc.body.data.lines[0].quantity, 10);

    const aj = await manager.post('/api/inventory/adjust', { warehouseId: 2, productId: state.productId, delta: -2, reason: 'แตก' });
    assert.equal(aj.status, 200, JSON.stringify(aj.body));
    assert.match(aj.body.data.document.docNo, /^AJ\d{6}-\d{4}$/);
    // a quick adjustment can still be undone from the history
    const moves = (await manager.get(`/api/inventory/movements?productId=${state.productId}`)).body.data;
    const adj = moves.find((m) => m.type === 'adjustment');
    assert.equal(adj.documentNo, aj.body.data.document.docNo);
    assert.equal(adj.reversible, true);

    const lot = await db.one('SELECT id FROM stock_lots WHERE product_id = :p AND quantity > 0 ORDER BY id LIMIT 1', { p: state.productId });
    const ws = await manager.post(`/api/inventory/expiry/lots/${lot.id}/waste`, { qty: 1, reason: 'damaged' });
    assert.equal(ws.status, 200, JSON.stringify(ws.body));
    assert.match(ws.body.data.document.docNo, /^WS\d{6}-\d{4}$/);

    // two till bills: one line in the ledger for the day
    await db.query('UPDATE pos_shifts SET closed_at = UTC_TIMESTAMP() WHERE user_id = 4 AND closed_at IS NULL');
    const shift = await cashier.post('/api/pos/shift/open', { openingCash: 0 });
    assert.equal(shift.status, 201, JSON.stringify(shift.body));
    state.shiftIds.push(shift.body.data.id);
    for (let i = 0; i < 2; i += 1) {
      const s = await cashier.post('/api/pos/checkout', { items: [{ productId: state.productId, quantity: 1 }], payments: [{ method: 'cash', amount: 50 }] });
      assert.equal(s.status, 201, JSON.stringify(s.body));
      state.orderIds.push(s.body.data.id);
    }

    const month = localDate().slice(0, 7);
    const r = await accountant.get(`/api/accounting/reports/stock-ledger?month=${month}&warehouseId=2&productId=${state.productId}`);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const row = r.body.data.products[0];
    assert.equal(row.opening, 0);
    assert.equal(row.totalIn, 10);
    assert.equal(row.totalOut, 5);
    assert.equal(row.closing, 5);
    const level = await db.one('SELECT quantity FROM stock_levels WHERE warehouse_id = 2 AND product_id = :p', { p: state.productId });
    assert.equal(Number(level.quantity), row.closing);
    const docs = row.lines.map((l) => l.docNo);
    assert.ok(docs.includes(gr.body.document.docNo));
    assert.ok(docs.includes(aj.body.data.document.docNo));
    assert.ok(docs.includes(ws.body.data.document.docNo));
    const sales = row.lines.filter((l) => l.type === 'sale');
    assert.equal(sales.length, 1);
    assert.equal(sales[0].qtyOut, 2);
    assert.match(sales[0].docNo, /2 บิล/);

    const csv = await accountant.get(`/api/accounting/reports/stock-ledger.csv?month=${month}&warehouseId=2&productId=${state.productId}`);
    assert.equal(csv.status, 200);
    assert.match(csv.text, /ยอดยกมา/);
    assert.equal((await cashier.get(`/api/accounting/reports/stock-ledger?month=${month}&warehouseId=2`)).status, 403);
  });
});

describe('the documents hub', () => {
  test('one list from every source the user may read, with categories, search and dates', async () => {
    const all = await accountant.get(`/api/documents/hub?from=${D}01&to=${D}30`);
    assert.equal(all.status, 200, JSON.stringify(all.body));
    assert.ok(all.body.data.some((d) => d.type === 'billing_note'));
    assert.ok(all.body.data.some((d) => d.type === 'debit_note'));
    assert.ok(all.body.meta.counts.sales >= 4);

    const q = await accountant.get(`/api/documents/hub?q=${encodeURIComponent(`ลูกค้าวางบิล ${RUN}`)}`);
    assert.ok(q.body.data.length >= 3);
    assert.ok(q.body.data.every((d) => d.party === `ลูกค้าวางบิล ${RUN}`));

    const stock = await manager.get(`/api/documents/hub?category=stock&q=${encodeURIComponent('AJ')}`);
    assert.equal(stock.status, 200);
    assert.ok(stock.body.data.every((d) => d.category === 'stock'));
    const purchase = await manager.get('/api/documents/hub?category=purchase&type=goods_receipt');
    assert.ok(purchase.body.data.some((d) => d.source === 'stock_document' && /^GR/.test(d.docNo)));

    // till bills only when asked for
    const today = localDate();
    const noPos = await manager.get(`/api/documents/hub?from=${today}&to=${today}`);
    assert.ok(!noPos.body.data.some((d) => d.type === 'pos_sale'));
    const withPos = await manager.get(`/api/documents/hub?from=${today}&to=${today}&includePos=1&type=pos_sale`);
    assert.ok(withPos.body.data.some((d) => state.orderIds.includes(d.id)));

    // a cashier sees no accounting documents
    const c = await cashier.get(`/api/documents/hub?from=${D}01&to=${D}30`);
    assert.equal(c.status, 200);
    assert.ok(!c.body.meta.sources.includes('documents'));
    assert.equal(c.body.data.filter((d) => d.source === 'document').length, 0);
  });
});
