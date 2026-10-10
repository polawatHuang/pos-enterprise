'use strict';

// Phase 3 integration tests: ledger, transactions, documents, tax, reports, AI receipt.
// Uses business dates in 2020 so assertions are exact and independent of the demo data.
process.env.NODE_ENV = 'test';

const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { createApp } = require('../src/app');
const db = require('../src/db/pool');
const anthropic = require('../src/integrations/anthropic');

const app = createApp();
const S = { txnIds: [], docIds: [], orderIds: [], shiftIds: [], productId: 0 };
let accountant;
let manager;
let cashier;
let viewer;
let marketer;

async function as(email) {
  const res = await request(app).post('/api/auth/login').send({ email, password: 'Admin@1234' });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const c = res.headers['set-cookie'].map((x) => x.split(';')[0]).join('; ');
  return {
    get: (u) => request(app).get(u).set('Cookie', c),
    post: (u, b) => request(app).post(u).set('Cookie', c).send(b),
    patch: (u, b) => request(app).patch(u).set('Cookie', c).send(b),
  };
}

/** Sum of debits/credits per account for every journal of a source record. */
async function ledgerFor(refType, refId) {
  const rows = await db.query(
    `SELECT a.code, SUM(l.debit) AS dr, SUM(l.credit) AS cr FROM journal_entries e
       JOIN journal_lines l ON l.entry_id = e.id JOIN chart_of_accounts a ON a.id = l.account_id
      WHERE e.ref_type = :refType AND e.ref_id = :refId GROUP BY a.code`,
    { refType, refId },
  );
  return Object.fromEntries(rows.map((r) => [r.code, { dr: Number(r.dr), cr: Number(r.cr) }]));
}

async function cleanup2020() {
  await db.query("DELETE FROM journal_entries WHERE org_id = 1 AND entry_date < '2021-01-01'");
  await db.query("DELETE FROM documents WHERE org_id = 1 AND doc_date < '2021-01-01'");
  await db.query("DELETE FROM transactions WHERE org_id = 1 AND txn_date < '2021-01-01'");
  await db.query("DELETE FROM tax_reports WHERE org_id = 1 AND period_year = 2020");
  await db.query("DELETE FROM document_sequences WHERE org_id = 1 AND period LIKE '2020%'");
}

before(async () => {
  await cleanup2020();
  accountant = await as('accountant@example.com');
  manager = await as('manager@example.com');
  cashier = await as('cashier@example.com');
  viewer = await as('viewer@example.com');
  marketer = await as('marketer@example.com');
});

after(async () => {
  await cleanup2020();
  for (const id of S.orderIds) await db.query("DELETE FROM journal_entries WHERE ref_type = 'sales_order' AND ref_id = :id", { id });
  if (S.orderIds.length) await db.query('DELETE FROM sales_orders WHERE id IN (:ids)', { ids: S.orderIds });
  if (S.shiftIds.length) await db.query('DELETE FROM pos_shifts WHERE id IN (:ids)', { ids: S.shiftIds });
  await db.query("DELETE FROM products WHERE sku LIKE 'ACCTEST-%'");
  delete process.env.ANTHROPIC_API_KEY;
  await db.pool.end();
});

describe('permissions', () => {
  test('cashier and marketer cannot open accounting; viewer is read-only', async () => {
    assert.equal((await cashier.get('/api/accounting/transactions')).status, 403);
    assert.equal((await marketer.get('/api/accounting/reports/overview')).status, 403);
    assert.equal((await viewer.get('/api/accounting/transactions')).status, 200);
    const res = await viewer.post('/api/accounting/transactions', { type: 'expense', category: 'ค่าเช่า', amount: 1, txnDate: '2020-01-02', description: 'x' });
    assert.equal(res.status, 403);
  });
});

describe('income & expense ledger', () => {
  test('expense with VAT on top and 5% WHT posts a balanced entry to the right accounts', async () => {
    const res = await accountant.post('/api/accounting/transactions', {
      type: 'expense',
      category: 'ค่าเช่า',
      amount: 10000,
      vatMode: 'exclusive',
      whtRate: 5,
      whtIncomeType: '40(5)',
      txnDate: '2020-01-05',
      description: 'ค่าเช่าเดือน ม.ค.',
      counterparty: 'บริษัท ให้เช่า จำกัด',
      counterpartyTaxId: '0105500000001',
      counterpartyType: 'company',
      paymentMethod: 'transfer',
    });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    S.txnIds.push(res.body.data.id);
    assert.equal(res.body.data.vatAmount, 700);
    assert.equal(res.body.data.whtAmount, 500);
    assert.equal(res.body.data.netAmount, 10200);
    const l = await ledgerFor('transaction', res.body.data.id);
    assert.deepEqual(l['5300'], { dr: 10000, cr: 0 });
    assert.deepEqual(l['1400'], { dr: 700, cr: 0 });
    assert.deepEqual(l['1110'], { dr: 0, cr: 10200 });
    assert.deepEqual(l['2210'], { dr: 0, cr: 500 });
  });

  test('individual payee with 3% WHT, and VAT-inclusive income', async () => {
    const exp = await accountant.post('/api/accounting/transactions', {
      type: 'expense',
      category: 'ค่าใช้จ่ายอื่น',
      amount: 5000,
      whtRate: 3,
      whtIncomeType: '40(2)',
      txnDate: '2020-01-10',
      description: 'ค่าจ้างออกแบบ',
      counterparty: 'นายช่าง ภาพสวย',
      counterpartyType: 'individual',
      paymentMethod: 'cash',
    });
    assert.equal(exp.status, 201, JSON.stringify(exp.body));
    S.txnIds.push(exp.body.data.id);
    assert.equal(exp.body.data.whtAmount, 150);

    const inc = await accountant.post('/api/accounting/transactions', {
      type: 'income',
      category: 'รายได้อื่น',
      amount: 1070,
      vatMode: 'inclusive',
      txnDate: '2020-01-12',
      description: 'ค่าบริการติดตั้ง',
      paymentMethod: 'transfer',
    });
    assert.equal(inc.status, 201);
    S.txnIds.push(inc.body.data.id);
    assert.equal(inc.body.data.amount, 1000);
    assert.equal(inc.body.data.vatAmount, 70);
    const l = await ledgerFor('transaction', inc.body.data.id);
    assert.deepEqual(l['4900'], { dr: 0, cr: 1000 });
    assert.deepEqual(l['2200'], { dr: 0, cr: 70 });
  });

  test('WHT without payee type is rejected', async () => {
    const res = await accountant.post('/api/accounting/transactions', {
      type: 'expense', category: 'ค่าโฆษณา', amount: 100, whtRate: 2, txnDate: '2020-01-03', description: 'ads', counterparty: 'X',
    });
    assert.equal(res.status, 400);
  });

  test('void reverses the entry', async () => {
    const t = await accountant.post('/api/accounting/transactions', {
      type: 'expense', category: 'ค่าขนส่ง', amount: 300, txnDate: '2020-01-20', description: 'ส่งของ', paymentMethod: 'cash',
    });
    const v = await accountant.post(`/api/accounting/transactions/${t.body.data.id}/void`, { reason: 'บันทึกซ้ำ' });
    assert.equal(v.status, 200);
    const l = await ledgerFor('transaction', t.body.data.id);
    assert.equal(l['5500'].dr, l['5500'].cr);
    assert.equal((await accountant.post(`/api/accounting/transactions/${t.body.data.id}/void`, { reason: 'x' })).status, 409);
  });
});

describe('documents', () => {
  let taxInvoiceId;

  test('tax invoice: draft -> issue (numbered, posted to AR) -> paid', async () => {
    const draft = await accountant.post('/api/accounting/documents', {
      docType: 'tax_invoice',
      docDate: '2020-01-15',
      dueDate: '2020-02-14',
      partyName: 'บริษัท ลูกค้า จำกัด',
      partyTaxId: '0105500000002',
      items: [
        { description: 'สินค้า A', quantity: 2, unitPrice: 500 },
        { description: 'ค่าส่ง (ยกเว้น VAT)', quantity: 1, unitPrice: 100, vatType: 'exempt' },
      ],
    });
    assert.equal(draft.status, 201, JSON.stringify(draft.body));
    taxInvoiceId = draft.body.data.id;
    S.docIds.push(taxInvoiceId);
    assert.equal(draft.body.data.subtotal, 1100);
    assert.equal(draft.body.data.vatAmount, 70);
    assert.equal(draft.body.data.total, 1170);
    assert.match(draft.body.data.docNo, /^DRAFT-/);

    const issued = await accountant.post(`/api/accounting/documents/${taxInvoiceId}/issue`, {});
    assert.equal(issued.status, 200, JSON.stringify(issued.body));
    assert.match(issued.body.data.docNo, /^TI202001-\d{4}$/);
    assert.equal(issued.body.data.amountText, 'หนึ่งพันหนึ่งร้อยเจ็ดสิบบาทถ้วน');
    let l = await ledgerFor('document', taxInvoiceId);
    assert.deepEqual(l['1200'], { dr: 1170, cr: 0 });
    assert.deepEqual(l['4100'], { dr: 0, cr: 1100 });

    assert.equal((await accountant.patch(`/api/accounting/documents/${taxInvoiceId}`, draft.body.data)).status, 400 + 9);
    const paid = await accountant.post(`/api/accounting/documents/${taxInvoiceId}/pay`, { paymentMethod: 'transfer', paidDate: '2020-01-31' });
    assert.equal(paid.body.data.status, 'paid');
    l = await ledgerFor('document', taxInvoiceId);
    assert.deepEqual(l['1200'], { dr: 1170, cr: 1170 });
    assert.deepEqual(l['1110'], { dr: 1170, cr: 0 });
  });

  test('concurrent issuing produces unique, consecutive numbers', async () => {
    const drafts = [];
    for (let i = 0; i < 5; i += 1) {
      const d = await accountant.post('/api/accounting/documents', {
        docType: 'quotation', docDate: '2020-02-01', partyName: `ลูกค้า ${i}`, items: [{ description: 'x', quantity: 1, unitPrice: 10 }],
      });
      drafts.push(d.body.data.id);
    }
    const issued = await Promise.all(drafts.map((id) => accountant.post(`/api/accounting/documents/${id}/issue`, {})));
    const nums = issued.map((r) => Number(r.body.data.docNo.split('-')[1])).sort((a, b) => a - b);
    assert.equal(new Set(nums).size, 5);
    assert.equal(nums[4] - nums[0], 4);
    // quotations do not touch the ledger
    assert.deepEqual(await ledgerFor('document', drafts[0]), {});
  });

  test('receipt needs a payment method; WHT certificate is generated from an expense', async () => {
    const d = await accountant.post('/api/accounting/documents', {
      docType: 'tax_invoice_receipt', docDate: '2020-01-25', partyName: 'ลูกค้าเงินสด', items: [{ description: 'บริการ', quantity: 1, unitPrice: 200 }],
    });
    assert.equal((await accountant.post(`/api/accounting/documents/${d.body.data.id}/issue`, {})).status, 400);
    const ok = await accountant.post(`/api/accounting/documents/${d.body.data.id}/issue`, { paymentMethod: 'cash' });
    assert.equal(ok.body.data.status, 'paid');

    const cert = await accountant.post('/api/accounting/documents/wht-certificate', { transactionId: S.txnIds[0] });
    assert.equal(cert.status, 201, JSON.stringify(cert.body));
    assert.equal(cert.body.data.docType, 'wht_certificate');
    assert.equal(cert.body.data.whtAmount, 500);
    assert.equal(cert.body.data.amountText, 'ห้าร้อยบาทถ้วน');
    const detail = await accountant.get(`/api/accounting/documents/${cert.body.data.id}`);
    assert.equal(detail.body.data.whtSource.incomeType, '40(5)');
    // the source expense cannot be voided while a certificate exists
    assert.equal((await accountant.post(`/api/accounting/transactions/${S.txnIds[0]}/void`, { reason: 'x' })).status, 400);
  });
});

describe('tax', () => {
  test('PP30 = output VAT (invoices + VAT income) - claimable input VAT', async () => {
    const res = await accountant.get('/api/accounting/tax/pp30?year=2020&month=1');
    assert.equal(res.status, 200, JSON.stringify(res.body));
    // output: TI 70 + TR 14 + other income 70 = 154 ; input: rent 700
    assert.equal(res.body.data.sales.vat, 154);
    assert.equal(res.body.data.purchases.vat, 700);
    assert.equal(res.body.data.vatPayable, 0);
    assert.equal(res.body.data.vatCredit, 546);
  });

  test('PND3 and PND53 split payees by type; CSV is Excel-safe', async () => {
    const p53 = await accountant.get('/api/accounting/tax/wht?form=PND53&year=2020&month=1');
    assert.equal(p53.body.data.totals.wht, 500);
    const p3 = await accountant.get('/api/accounting/tax/wht?form=PND3&year=2020&month=1');
    assert.equal(p3.body.data.totals.wht, 150);
    assert.equal(p3.body.data.warnings.length, 1); // payee without tax ID

    const csv = await accountant.get('/api/accounting/tax/wht.csv?form=PND53&year=2020&month=1');
    assert.match(csv.headers['content-type'], /text\/csv/);
    assert.ok(csv.text.startsWith('﻿'));
    assert.match(csv.text, /"0105500000001"/);
  });

  test('only tax:file may record filing status', async () => {
    assert.equal((await manager.post('/api/accounting/tax/reports', { formType: 'PP30', year: 2020, month: 1, status: 'filed' })).status, 403);
    const ok = await accountant.post('/api/accounting/tax/reports', { formType: 'PP30', year: 2020, month: 1, status: 'filed' });
    assert.equal(ok.body.data.status, 'filed');
  });
});

describe('reports', () => {
  test('P&L for January 2020 matches the postings', async () => {
    const res = await accountant.get('/api/accounting/reports/pnl?from=2020-01-01&to=2020-01-31');
    const t = res.body.data.totals;
    // revenue: TI 1100 + TR 200 + other income 1000 ; expenses: rent 10000 + design 5000 (+ voided transport nets to 0)
    assert.equal(t.revenue, 2300);
    assert.equal(t.expenses, 15000);
    assert.equal(t.netProfit, -12700);
  });

  test('void of an issued invoice reverses it and the trial balance still balances', async () => {
    const d = await accountant.post('/api/accounting/documents', {
      docType: 'invoice', docDate: '2020-01-28', partyName: 'ลูกค้ายกเลิก', items: [{ description: 'x', quantity: 1, unitPrice: 1000 }],
    });
    await accountant.post(`/api/accounting/documents/${d.body.data.id}/issue`, {});
    const v = await accountant.post(`/api/accounting/documents/${d.body.data.id}/void`, { reason: 'ออกผิด' });
    assert.equal(v.status, 200);
    const l = await ledgerFor('document', d.body.data.id);
    assert.equal(l['1200'].dr, l['1200'].cr);
    const tb = await accountant.get('/api/accounting/reports/trial-balance?asOf=2030-12-31');
    assert.equal(tb.body.data.balanced, true);
  });

  test('every journal in the system is balanced', async () => {
    const bad = await db.query(
      `SELECT e.id FROM journal_entries e JOIN journal_lines l ON l.entry_id = e.id
        GROUP BY e.id HAVING ROUND(SUM(l.debit), 2) <> ROUND(SUM(l.credit), 2)`,
    );
    assert.equal(bad.length, 0);
  });
});

describe('POS posts to the ledger', () => {
  test('checkout posts revenue/VAT/COGS and void reverses it', async () => {
    const p = await manager.post('/api/products', { sku: `ACCTEST-${Date.now()}`, name: 'ทดสอบบัญชี', price: 107, cost: 40 });
    S.productId = p.body.data.id;
    await manager.post('/api/inventory/receive', { warehouseId: 2, items: [{ productId: S.productId, quantity: 5, unitCost: 40 }] });
    await db.query('UPDATE pos_shifts SET closed_at = UTC_TIMESTAMP() WHERE user_id = 4 AND closed_at IS NULL');
    const shift = await cashier.post('/api/pos/shift/open', { openingCash: 0 });
    S.shiftIds.push(shift.body.data.id);
    const sale = await cashier.post('/api/pos/checkout', { items: [{ productId: S.productId, quantity: 1 }], payment: { method: 'cash', amountReceived: 107 } });
    assert.equal(sale.status, 201, JSON.stringify(sale.body));
    S.orderIds.push(sale.body.data.id);

    let l = await ledgerFor('sales_order', sale.body.data.id);
    assert.deepEqual(l['1100'], { dr: 107, cr: 0 });
    assert.deepEqual(l['4100'], { dr: 0, cr: 100 });
    assert.deepEqual(l['2200'], { dr: 0, cr: 7 });
    assert.deepEqual(l['5100'], { dr: 40, cr: 0 });

    await manager.post(`/api/pos/orders/${sale.body.data.id}/void`, { reason: 'ทดสอบ' });
    l = await ledgerFor('sales_order', sale.body.data.id);
    for (const code of ['1100', '4100', '2200', '5100', '1300']) assert.equal(l[code].dr, l[code].cr, code);
    await cashier.post('/api/pos/shift/close', { closingCash: 0 });
  });
});

describe('AI receipt extraction', () => {
  const png = Buffer.alloc(300, 1).toString('base64');

  test('returns 503 when no Anthropic key is configured', async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const res = await accountant.post('/api/accounting/ai/extract-receipt', { mediaType: 'image/png', data: png });
    assert.equal(res.status, 503);
    assert.equal(res.body.error.code, 'INTEGRATION_NOT_CONFIGURED');
  });

  test('passes the image with a JSON schema and returns parsed fields', async () => {
    process.env.ANTHROPIC_API_KEY = 'test-key';
    const original = anthropic.createMessage;
    let captured;
    anthropic.createMessage = async (params) => {
      captured = params;
      return {
        model: 'claude-opus-5-5',
        stop_reason: 'end_turn',
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              vendorName: 'ร้านเครื่องเขียน', vendorTaxId: '0-1055-00000-00-3', isFullTaxInvoice: true, documentNo: 'A001',
              date: '2026-10-01', subtotal: 100, vatAmount: 7, whtAmount: null, total: 107, category: 'ค่าใช้จ่ายอื่น',
              description: 'ซื้อเครื่องเขียน', confidence: 'high',
            }),
          },
        ],
      };
    };
    try {
      const res = await accountant.post('/api/accounting/ai/extract-receipt', { mediaType: 'image/png', data: png });
      assert.equal(res.status, 200, JSON.stringify(res.body));
      assert.equal(res.body.data.total, 107);
      assert.equal(res.body.data.vendorTaxId, '0105500000003');
      assert.equal(captured.output_config.format.type, 'json_schema');
      assert.equal(captured.messages[0].content[0].type, 'image');
    } finally {
      anthropic.createMessage = original;
    }
  });

  test('rejects non-base64 payloads', async () => {
    process.env.ANTHROPIC_API_KEY = 'test-key';
    const res = await accountant.post('/api/accounting/ai/extract-receipt', { mediaType: 'image/png', data: `${'!'.repeat(200)}` });
    assert.equal(res.status, 400);
  });
});
