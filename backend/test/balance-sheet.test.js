'use strict';

// Balance sheet + accounting report CSV exports. Posts its own balanced journals dated
// Dec 2010 – Mar 2011 and asserts the change they make (so existing ledger data never matters),
// then deletes everything it created.
process.env.NODE_ENV = 'test';

const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { createApp } = require('../src/app');
const db = require('../src/db/pool');
const { postJournal } = require('../src/modules/accounting/ledger.service');

const app = createApp();
const PERIODS = ['201012', '201102', '201103'];
const BOM = '\uFEFF';
const S = { entryIds: [], entryNos: {}, accountCreated: false, seqExisted: new Set(), orgId: 0 };
let accountant;
let viewer;
let manager;
let cashier;

async function as(email) {
  const res = await request(app).post('/api/auth/login').send({ email, password: 'Admin@1234' });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const c = res.headers['set-cookie'].map((x) => x.split(';')[0]).join('; ');
  return { get: (u) => request(app).get(u).set('Cookie', c) };
}

const bs = async (asOf, compareTo) => {
  const res = await accountant.get(`/api/accounting/reports/balance-sheet?asOf=${asOf}${compareTo ? `&compareTo=${compareTo}` : ''}`);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  return res.body.data;
};
/** Amount of one account line (0 when absent) in a balance-sheet section. */
const amt = (section, code, field = 'amount') => section.lines.find((l) => l.code === code)?.[field] ?? 0;
const r2 = (n) => Math.round(n * 100) / 100;

async function post(date, description, lines) {
  const r = await db.tx((conn) => postJournal(conn, { orgId: S.orgId, date, description, refType: 'bs_test', lines }));
  S.entryIds.push(r.id);
  S.entryNos[description] = r.entryNo;
  return r;
}

let base; // balance sheet at 2011-03-31 vs 2011-02-28 before our postings
let baseJournalMarch;

before(async () => {
  accountant = await as('accountant@example.com');
  viewer = await as('viewer@example.com');
  manager = await as('manager@example.com');
  cashier = await as('cashier@example.com');
  S.orgId = (await db.one("SELECT org_id FROM users WHERE email = 'accountant@example.com'")).org_id;

  const seq = await db.query("SELECT period FROM document_sequences WHERE org_id = :orgId AND doc_type = 'journal' AND period IN (:p)", {
    orgId: S.orgId,
    p: PERIODS,
  });
  for (const r of seq) S.seqExisted.add(r.period);

  // A non-current asset account (the seeded chart only has current ones)
  if (!(await db.one("SELECT id FROM chart_of_accounts WHERE org_id = :orgId AND code = '1510'", { orgId: S.orgId }))) {
    await db.query("INSERT INTO chart_of_accounts (org_id, code, name, type) VALUES (:orgId, '1510', 'อุปกรณ์ (ทดสอบ)', 'asset')", { orgId: S.orgId });
    S.accountCreated = true;
  }

  base = await bs('2011-03-31', '2011-02-28');
  baseJournalMarch = (await accountant.get('/api/accounting/reports/journal?from=2011-03-01&to=2011-03-31&pageSize=100')).body.meta.total;

  await post('2010-12-15', 'BS ทุน', [
    { account: '1110', debit: 100000 },
    { account: '3100', credit: 100000 },
  ]);
  await post('2010-12-20', 'BS ขายปีก่อน', [
    { account: '1100', debit: 5000 },
    { account: '4100', credit: 5000 },
  ]);
  await post('2011-02-10', 'BS ซื้อสินค้าเชื่อ', [
    { account: '1300', debit: 20000 },
    { account: '2100', credit: 20000 },
  ]);
  await post('2011-03-05', 'BS ขายสินค้า', [
    { account: '1110', debit: 10700 },
    { account: '4100', credit: 10000 },
    { account: '2200', credit: 700 },
    { account: '5100', debit: 6000 },
    { account: '1300', credit: 6000 },
  ]);
  await post('2011-03-20', 'BS ค่าเช่า', [
    { account: '5300', debit: 3000 },
    { account: '1110', credit: 3000 },
  ]);
  await post('2011-03-25', 'BS ซื้ออุปกรณ์', [
    { account: '1510', debit: 8000 },
    { account: '1110', credit: 8000 },
  ]);
});

after(async () => {
  if (S.entryIds.length) await db.query('DELETE FROM journal_entries WHERE id IN (:ids)', { ids: S.entryIds });
  await db.query("DELETE FROM journal_entries WHERE org_id = :orgId AND ref_type = 'bs_test'", { orgId: S.orgId });
  const gone = PERIODS.filter((p) => !S.seqExisted.has(p));
  if (gone.length)
    await db.query("DELETE FROM document_sequences WHERE org_id = :orgId AND doc_type = 'journal' AND period IN (:p)", { orgId: S.orgId, p: gone });
  if (S.accountCreated) await db.query("DELETE FROM chart_of_accounts WHERE org_id = :orgId AND code = '1510'", { orgId: S.orgId });
  await db.pool.end();
});

describe('balance sheet', () => {
  test('baseline balances', () => {
    assert.equal(base.balanced, true, `baseline difference ${base.difference}`);
  });

  test('groups accounts, computes equity incl. retained earnings and current profit, and balances', async () => {
    const d = await bs('2011-03-31', '2011-02-28');
    assert.equal(d.asOf, '2011-03-31');
    assert.equal(d.fiscalYearStart, '2011-01-01');

    // Assets: bank 100000 + 10700 − 3000 − 8000, cash 5000, inventory 20000 − 6000, equipment 8000 (non-current)
    assert.equal(r2(amt(d.assets.current, '1110') - amt(base.assets.current, '1110')), 99700);
    assert.equal(r2(amt(d.assets.current, '1100') - amt(base.assets.current, '1100')), 5000);
    assert.equal(r2(amt(d.assets.current, '1300') - amt(base.assets.current, '1300')), 14000);
    assert.equal(r2(amt(d.assets.nonCurrent, '1510') - amt(base.assets.nonCurrent, '1510')), 8000);
    assert.ok(!d.assets.current.lines.some((l) => l.code === '1510'), 'equipment is non-current');
    assert.equal(r2(d.assets.current.total - base.assets.current.total), 118700);
    assert.equal(r2(d.assets.nonCurrent.total - base.assets.nonCurrent.total), 8000);
    assert.equal(r2(d.totals.assets - base.totals.assets), 126700);

    // Liabilities: AP 20000, output VAT 700
    assert.equal(r2(amt(d.liabilities.current, '2100') - amt(base.liabilities.current, '2100')), 20000);
    assert.equal(r2(amt(d.liabilities.current, '2200') - amt(base.liabilities.current, '2200')), 700);
    assert.equal(r2(d.totals.liabilities - base.totals.liabilities), 20700);

    // Equity: capital 100000, prior-year profit 5000, current-year profit 10000 − 6000 − 3000
    assert.equal(r2(amt(d.equity, '3100') - amt(base.equity, '3100')), 100000);
    assert.equal(r2(d.equity.retainedEarnings.amount - base.equity.retainedEarnings.amount), 5000);
    assert.equal(r2(d.equity.currentProfit.amount - base.equity.currentProfit.amount), 1000);
    assert.equal(r2(d.totals.equity - base.totals.equity), 106000);
    assert.equal(r2(d.totals.liabilitiesAndEquity - base.totals.liabilitiesAndEquity), 126700);

    assert.equal(d.balanced, true);
    assert.equal(d.difference, 0);
    assert.equal(d.totals.liabilitiesAndEquity, r2(d.totals.liabilities + d.totals.equity));
    assert.equal(d.totals.assets, r2(d.assets.current.total + d.assets.nonCurrent.total));
  });

  test('comparison column holds the earlier date', async () => {
    const d = await bs('2011-03-31', '2011-02-28');
    assert.equal(d.compareTo, '2011-02-28');
    assert.equal(d.comparison.balanced, true);
    // At end of February: bank 100000, cash 5000, inventory 20000; AP 20000; capital 100000 + prior profit 5000
    assert.equal(r2(amt(d.assets.current, '1110', 'previous') - amt(base.assets.current, '1110', 'previous')), 100000);
    assert.equal(r2(amt(d.assets.nonCurrent, '1510', 'previous') - amt(base.assets.nonCurrent, '1510', 'previous')), 0);
    assert.equal(r2(d.assets.previousTotal - base.assets.previousTotal), 125000);
    assert.equal(r2(d.liabilities.previousTotal - base.liabilities.previousTotal), 20000);
    assert.equal(r2(d.equity.retainedEarnings.previous - base.equity.retainedEarnings.previous), 5000);
    assert.equal(r2(d.equity.currentProfit.previous - base.equity.currentProfit.previous), 0);
    assert.equal(r2(d.equity.previousTotal - base.equity.previousTotal), 105000);

    const plain = await bs('2011-03-31');
    assert.equal(plain.compareTo, null);
    assert.equal(plain.comparison, null);
    assert.equal(plain.assets.current.previousTotal, null);
  });

  test('a later fiscal year rolls the profit into retained earnings', async () => {
    const dec = await bs('2011-12-31');
    const jan = await bs('2012-01-01');
    // Everything up to 31 Dec 2011 (prior + that year's profit) becomes "prior years" on 1 Jan 2012
    assert.equal(jan.fiscalYearStart, '2012-01-01');
    assert.equal(jan.equity.retainedEarnings.amount, r2(dec.equity.retainedEarnings.amount + dec.equity.currentProfit.amount));
    assert.equal(dec.balanced, true);
    const d = jan;
    assert.equal(d.balanced, true);
  });

  test('reports an unbalanced ledger with the difference', async () => {
    const entry = await db.query(
      "INSERT INTO journal_entries (org_id, entry_no, entry_date, description, ref_type, status) VALUES (:orgId, 'BSTEST-UNBAL', '2011-03-31', 'unbalanced', 'bs_test', 'posted')",
      { orgId: S.orgId },
    );
    const acc = await db.one("SELECT id FROM chart_of_accounts WHERE org_id = :orgId AND code = '1100'", { orgId: S.orgId });
    try {
      await db.query('INSERT INTO journal_lines (entry_id, account_id, debit, credit) VALUES (:e, :a, 50, 0)', { e: entry.insertId, a: acc.id });
      const d = await bs('2011-03-31');
      assert.equal(d.balanced, false);
      assert.equal(d.difference, 50);
    } finally {
      await db.query('DELETE FROM journal_entries WHERE id = :id', { id: entry.insertId });
    }
  });

  test('validation and permissions', async () => {
    assert.equal((await accountant.get('/api/accounting/reports/balance-sheet')).status, 400);
    assert.equal((await accountant.get('/api/accounting/reports/balance-sheet?asOf=31-03-2011')).status, 400);
    assert.equal((await viewer.get('/api/accounting/reports/balance-sheet?asOf=2011-03-31')).status, 200);
    assert.equal((await manager.get('/api/accounting/reports/balance-sheet?asOf=2011-03-31')).status, 200);
    assert.equal((await cashier.get('/api/accounting/reports/balance-sheet?asOf=2011-03-31')).status, 403);
    for (const u of [
      '/api/accounting/reports/balance-sheet.csv?asOf=2011-03-31',
      '/api/accounting/reports/pnl.csv?from=2011-03-01&to=2011-03-31',
      '/api/accounting/reports/trial-balance.csv?asOf=2011-03-31',
      '/api/accounting/reports/journal.csv?from=2011-03-01&to=2011-03-31',
      '/api/accounting/tax/pp30.csv?year=2011&month=3',
    ]) {
      assert.equal((await cashier.get(u)).status, 403, u);
      assert.equal((await viewer.get(u)).status, 200, u);
    }
    assert.equal((await request(app).get('/api/accounting/reports/balance-sheet.csv?asOf=2011-03-31')).status, 401);
  });
});

describe('journal date filter', () => {
  test('from/to limits the entries', async () => {
    const res = await accountant.get('/api/accounting/reports/journal?from=2011-03-01&to=2011-03-31&pageSize=100');
    assert.equal(res.status, 200);
    assert.equal(res.body.meta.total, baseJournalMarch + 3);
    assert.ok(res.body.data.every((e) => e.date >= '2011-03-01' && e.date <= '2011-03-31'));
    const nos = res.body.data.map((e) => e.entryNo);
    for (const k of ['BS ขายสินค้า', 'BS ค่าเช่า', 'BS ซื้ออุปกรณ์']) assert.ok(nos.includes(S.entryNos[k]), k);
    assert.ok(!nos.includes(S.entryNos['BS ซื้อสินค้าเชื่อ']));
    const sale = res.body.data.find((e) => e.entryNo === S.entryNos['BS ขายสินค้า']);
    assert.equal(sale.lines.length, 5);

    const feb = await accountant.get('/api/accounting/reports/journal?from=2011-02-01&to=2011-02-28&pageSize=100');
    assert.ok(feb.body.data.some((e) => e.entryNo === S.entryNos['BS ซื้อสินค้าเชื่อ']));
    assert.equal((await accountant.get('/api/accounting/reports/journal?from=2011-13-01')).status, 400);
  });
});

describe('CSV exports', () => {
  const csv = async (url) => {
    const res = await accountant.get(url);
    assert.equal(res.status, 200, url);
    assert.match(res.headers['content-type'], /^text\/csv; charset=utf-8/);
    assert.match(res.headers['content-disposition'], /^attachment; filename="[\w.-]+\.csv"$/);
    assert.ok(res.text.startsWith(BOM), `${url} starts with a BOM`);
    const lines = res.text.slice(1).trimEnd().split('\r\n');
    return { text: res.text, header: lines[0], lines };
  };

  test('balance sheet', async () => {
    const d = await bs('2011-03-31', '2011-02-28');
    const { header, text, lines } = await csv('/api/accounting/reports/balance-sheet.csv?asOf=2011-03-31&compareTo=2011-02-28');
    assert.equal(header, '"หมวด","รหัสบัญชี","ชื่อบัญชี","ณ วันที่ 2011-03-31","ณ วันที่ 2011-02-28"');
    assert.ok(lines.includes(`"รวมสินทรัพย์","","","${d.totals.assets.toFixed(2)}","${d.assets.previousTotal.toFixed(2)}"`));
    assert.match(text, /"สินทรัพย์ไม่หมุนเวียน","1510","อุปกรณ์ \(ทดสอบ\)"/);
    assert.match(text, /"กำไร \(ขาดทุน\) สุทธิงวดปีปัจจุบัน"/);
    assert.ok(lines.at(-1).startsWith('"ผลต่าง (ต้องเป็นศูนย์)","","","0.00"'));
    const single = await csv('/api/accounting/reports/balance-sheet.csv?asOf=2011-03-31');
    assert.equal(single.header, '"หมวด","รหัสบัญชี","ชื่อบัญชี","ณ วันที่ 2011-03-31"');
  });

  test('P&L keeps negative numbers numeric', async () => {
    const pnl = (await accountant.get('/api/accounting/reports/pnl?from=2011-03-20&to=2011-03-31')).body.data;
    const { header, text } = await csv('/api/accounting/reports/pnl.csv?from=2011-03-20&to=2011-03-31');
    assert.equal(header, '"หมวด","รหัสบัญชี","ชื่อบัญชี","จำนวนเงิน"');
    assert.match(text, /"ค่าใช้จ่ายในการขายและบริหาร","5300","[^"]+","\d+\.\d\d"/);
    assert.ok(text.includes(`"${pnl.totals.netProfit >= 0 ? 'กำไรสุทธิ' : 'ขาดทุนสุทธิ'}","","","${pnl.totals.netProfit.toFixed(2)}"`));
    assert.ok(!text.includes(`"'-`), 'no formula guard on plain negative numbers');
  });

  test('trial balance', async () => {
    const tb = (await accountant.get('/api/accounting/reports/trial-balance?asOf=2011-03-31')).body.data;
    const { header, lines } = await csv('/api/accounting/reports/trial-balance.csv?asOf=2011-03-31');
    assert.equal(header, '"รหัสบัญชี","ชื่อบัญชี","ประเภท","เดบิต","เครดิต"');
    assert.equal(lines.length, tb.accounts.length + 2);
    assert.equal(lines.at(-1), `"รวม","","","${tb.totalDebit.toFixed(2)}","${tb.totalCredit.toFixed(2)}"`);
  });

  test('journal (date range required)', async () => {
    assert.equal((await accountant.get('/api/accounting/reports/journal.csv?from=2011-03-01')).status, 400);
    const { header, text } = await csv('/api/accounting/reports/journal.csv?from=2011-03-01&to=2011-03-31');
    assert.equal(header, '"เลขที่รายการ","วันที่","คำอธิบาย","อ้างอิง","สถานะ","รหัสบัญชี","ชื่อบัญชี","เดบิต","เครดิต"');
    assert.ok(text.includes(`"${S.entryNos['BS ขายสินค้า']}","2011-03-05","BS ขายสินค้า","bs_test","posted","1110"`));
    assert.ok(!text.includes(S.entryNos['BS ซื้อสินค้าเชื่อ']));
  });

  test('PP30 summary', async () => {
    const pp = (await accountant.get('/api/accounting/tax/pp30?year=2011&month=3')).body.data;
    const { header, lines } = await csv('/api/accounting/tax/pp30.csv?year=2011&month=3');
    assert.equal(header, '"หมวด","รายการ","จำนวน","มูลค่าก่อนภาษี","ภาษีมูลค่าเพิ่ม"');
    assert.ok(lines.includes(`"ภาษีขาย","รวมภาษีขาย","","${pp.sales.base.toFixed(2)}","${pp.sales.vat.toFixed(2)}"`));
    assert.ok(lines.includes(`"สรุป","ภาษีที่ต้องชำระ","","","${pp.vatPayable.toFixed(2)}"`));
  });
});
