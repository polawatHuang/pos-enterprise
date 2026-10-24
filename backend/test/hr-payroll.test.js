'use strict';

// HR: payroll arithmetic (social security, ภ.ง.ด.1 withholding), staff records, a monthly run from
// draft to paid with its journals, the PND1 / PND1ก / สปส.1-10 reports, payslips, remittances, leave.
process.env.NODE_ENV = 'test';

const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { createApp } = require('../src/app');
const db = require('../src/db/pool');
const { computeLine, incomeTax, ssoContribution } = require('../src/modules/hr/payroll-calc');

const app = createApp();
const RUN = Date.now().toString(36);
const PERIOD = '2019-08';
const state = { employees: [], runIds: [], remitIds: [], leaveIds: [] };
let accountant;
let manager;
let cashier;
let marketer;

async function as(email) {
  const res = await request(app).post('/api/auth/login').send({ email, password: 'Admin@1234' });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const cookie = res.headers['set-cookie'].map((c) => c.split(';')[0]).join('; ');
  return {
    get: (url) => request(app).get(url).set('Cookie', cookie),
    post: (url, body) => request(app).post(url).set('Cookie', cookie).send(body),
    put: (url, body) => request(app).put(url).set('Cookie', cookie).send(body),
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
  await db.query("DELETE FROM journal_entries WHERE ref_type IN ('payroll_run','payroll_remittance') AND entry_date >= '2019-08-01' AND entry_date < '2019-10-01'");
  await db.query("DELETE FROM payroll_remittances WHERE org_id = 1 AND period = :p", { p: PERIOD });
  await db.query("DELETE FROM payroll_runs WHERE org_id = 1 AND period = :p", { p: PERIOD });
  await db.query("DELETE FROM document_sequences WHERE org_id = 1 AND period IN ('201908','201909')");
}

before(async () => {
  await cleanup();
  await db.query('UPDATE employees SET user_id = NULL WHERE user_id = 4');
  accountant = await as('accountant@example.com');
  manager = await as('manager@example.com');
  cashier = await as('cashier@example.com');
  marketer = await as('marketer@example.com');
});

after(async () => {
  await cleanup();
  if (state.employees.length) {
    await db.query('DELETE FROM leave_requests WHERE employee_id IN (:ids)', { ids: state.employees });
    await db.query('DELETE FROM payroll_items WHERE employee_id IN (:ids)', { ids: state.employees });
    await db.query('DELETE FROM employees WHERE id IN (:ids)', { ids: state.employees });
  }
  await db.query("DELETE FROM document_sequences WHERE org_id = 1 AND doc_type = 'leave_request' AND period = '201908'");
  await db.pool.end();
});

describe('payroll arithmetic', () => {
  test('social security is capped; withholding annualises regular pay and taxes a bonus on top', () => {
    assert.deepEqual(ssoContribution(30000, { rate: 5, floor: 1650, ceiling: 17500 }), { base: 17500, amount: 875 });
    assert.deepEqual(ssoContribution(1000, { rate: 5, floor: 1650, ceiling: 17500 }), { base: 1650, amount: 83 });
    assert.equal(incomeTax(150000), 0);
    assert.equal(incomeTax(189500), 1975);
    const monthly = computeLine({ pay_type: 'monthly', base_salary: 30000, sso_enrolled: 1, tax_extra_deductions: 0 });
    assert.equal(monthly.ssoEmployee, 875);
    assert.equal(monthly.wht, 164.58);
    assert.equal(monthly.net, 28960.42);
    const withBonus = computeLine({ pay_type: 'monthly', base_salary: 30000, sso_enrolled: 1, tax_extra_deductions: 0 }, { bonus: 30000 });
    assert.equal(withBonus.wht, 1664.58);
    const daily = computeLine({ pay_type: 'daily', base_salary: 400, sso_enrolled: 1, tax_extra_deductions: 0 }, { daysWorked: 26 });
    assert.equal(daily.basePay, 10400);
    assert.equal(daily.ssoEmployee, 520);
    assert.equal(daily.wht, 0);
    const typed = computeLine({ pay_type: 'monthly', base_salary: 30000, sso_enrolled: 0, tax_extra_deductions: 0 }, { wht: 500 });
    assert.equal(typed.wht, 500);
    assert.equal(typed.ssoEmployee, 0);
  });
});

describe('staff, payroll run, reports', () => {
  test('HR keeps staff records; a run goes draft -> approved -> paid with balanced journals; reports and payslips follow', async () => {
    assert.equal((await manager.get('/api/hr/employees')).status, 403);
    const bad = await accountant.post('/api/hr/employees', { fullName: 'x', nationalId: '1234567890123', baseSalary: 1, startDate: '2019-01-01' });
    assert.equal(bad.status, 400);
    const a = await accountant.post('/api/hr/employees', {
      title: 'นาย',
      fullName: `ทดสอบ เงินเดือน ${RUN}`,
      nationalId: '1101700230708',
      position: 'พนักงานขาย',
      baseSalary: 30000,
      startDate: '2019-01-01',
      userId: 4, // the cashier's login: leave and payslips for themself
    });
    assert.equal(a.status, 201, JSON.stringify(a.body));
    state.employees.push(a.body.data.id);
    const d = await accountant.post('/api/hr/employees', { fullName: `รายวัน ${RUN}`, payType: 'daily', baseSalary: 400, startDate: '2019-01-01' });
    assert.equal(d.status, 201, JSON.stringify(d.body));
    state.employees.push(d.body.data.id);
    // someone who left before the month is not paid
    const gone = await accountant.post('/api/hr/employees', { fullName: `ลาออก ${RUN}`, baseSalary: 9000, startDate: '2019-01-01', endDate: '2019-06-30' });
    state.employees.push(gone.body.data.id);
    assert.equal(gone.body.data.status, 'resigned');

    const run = await accountant.post('/api/hr/payroll', { period: PERIOD, payDate: '2019-08-31' });
    assert.equal(run.status, 201, JSON.stringify(run.body));
    state.runIds.push(run.body.data.id);
    assert.match(run.body.data.runNo, /^PY201908-\d{4}$/);
    const mine = (r) => r.items.filter((i) => state.employees.includes(i.employeeId));
    assert.equal(mine(run.body.data).length, 2);
    const itemA = run.body.data.items.find((i) => i.employeeId === a.body.data.id);
    assert.equal(itemA.wht, 164.58);
    assert.equal((await accountant.post('/api/hr/payroll', { period: PERIOD, payDate: '2019-08-31' })).status, 409);

    // the daily worker's days, and overtime for the other
    const itemD = run.body.data.items.find((i) => i.employeeId === d.body.data.id);
    const e1 = await accountant.put(`/api/hr/payroll/${run.body.data.id}/items/${itemD.id}`, { daysWorked: 26 });
    assert.equal(e1.status, 200, JSON.stringify(e1.body));
    assert.equal(e1.body.data.items.find((i) => i.employeeId === d.body.data.id).net, 9880);
    const e2 = await accountant.put(`/api/hr/payroll/${run.body.data.id}/items/${itemA.id}`, { overtime: 1500, deduction: 500 });
    const a2 = e2.body.data.items.find((i) => i.employeeId === a.body.data.id);
    assert.equal(a2.gross, 31000);
    assert.equal(a2.ssoEmployee, 875);

    const appr = await accountant.post(`/api/hr/payroll/${run.body.data.id}/approve`, {});
    assert.equal(appr.status, 200, JSON.stringify(appr.body));
    const r = appr.body.data;
    const j = await ledgerFor('payroll_run', r.id);
    assert.equal(j['5200'].dr, r.totalGross);
    assert.equal(j['5210'].dr, r.totalSsoEmployer);
    assert.equal(j['2240'].cr, r.totalNet);
    assert.equal(j['2220'].cr, r.totalWht);
    assert.equal(j['2230'].cr, Math.round((r.totalSsoEmployee + r.totalSsoEmployer) * 100) / 100);
    assert.equal((await accountant.put(`/api/hr/payroll/${r.id}/items/${itemA.id}`, { overtime: 0 })).status, 409);

    const paid = await accountant.post(`/api/hr/payroll/${r.id}/pay`, { paymentMethod: 'transfer' });
    assert.equal(paid.body.data.status, 'paid');
    const j2 = await ledgerFor('payroll_run', r.id);
    assert.equal(j2['2240'].dr, r.totalNet);
    assert.equal(j2['1110'].cr, r.totalNet);

    const pnd1 = (await accountant.get('/api/hr/reports/pnd1?year=2019&month=8')).body.data;
    const p1 = pnd1.items.find((i) => i.employeeId === a.body.data.id);
    assert.equal(p1.income, 31000);
    assert.equal(p1.nationalId, '1101700230708');
    const sso = (await accountant.get('/api/hr/reports/sso?year=2019&month=8')).body.data;
    assert.equal(sso.items.find((i) => i.employeeId === d.body.data.id).employee, 520);
    const pnd1a = (await accountant.get('/api/hr/reports/pnd1a?year=2019')).body.data;
    assert.ok(pnd1a.items.some((i) => i.employeeId === a.body.data.id));
    const cert = await accountant.get(`/api/hr/reports/wht-certificate?year=2019&employeeId=${a.body.data.id}`);
    assert.equal(cert.status, 200, JSON.stringify(cert.body));
    assert.equal(cert.body.data.income, 31000);
    const csv = await accountant.get('/api/hr/reports/pnd1.csv?year=2019&month=8');
    assert.match(csv.text, /1101700230708/);

    // payslips: HR sees any; the employee sees their own
    const slip = await accountant.get(`/api/hr/payslips/${itemA.id}`);
    assert.equal(slip.body.data.net, a2.net);
    const own = await cashier.get('/api/hr/my/payslips');
    assert.ok(own.body.data.some((s) => s.itemId === itemA.id));
    assert.equal((await cashier.get(`/api/hr/my/payslips/${itemD.id}`)).status, 404);

    // remitting the withheld tax clears 2220; twice is refused; the run cannot be voided after
    const remit = await accountant.post('/api/hr/remittances', { kind: 'pnd1', period: PERIOD, remitDate: '2019-09-05' });
    assert.equal(remit.status, 201, JSON.stringify(remit.body));
    assert.deepEqual(await ledgerFor('payroll_remittance', remit.body.data.id), { 1110: { dr: 0, cr: r.totalWht }, 2220: { dr: r.totalWht, cr: 0 } });
    assert.equal((await accountant.post('/api/hr/remittances', { kind: 'pnd1', period: PERIOD, remitDate: '2019-09-05' })).status, 400);
    assert.equal((await accountant.post(`/api/hr/payroll/${r.id}/void`, { reason: 'x' })).status, 409);
  });
});

describe('leave', () => {
  test('staff ask for leave, managers approve, the balance follows; overlaps and unlinked accounts are refused', async () => {
    const me = await cashier.get('/api/hr/me');
    assert.ok(me.body.data, 'cashier is linked to a staff record');
    const lv = await cashier.post('/api/hr/leave', { leaveType: 'vacation', startDate: '2019-08-12', endDate: '2019-08-13', reason: 'ธุระที่บ้าน' });
    assert.equal(lv.status, 201, JSON.stringify(lv.body));
    state.leaveIds.push(lv.body.data.id);
    assert.equal(lv.body.data.days, 2);
    assert.match(lv.body.data.leaveNo, /^LV201908-\d{4}$/);
    assert.equal((await cashier.post('/api/hr/leave', { leaveType: 'sick', startDate: '2019-08-13', endDate: '2019-08-13' })).status, 409);
    assert.equal((await marketer.post('/api/hr/leave', { leaveType: 'sick', startDate: '2019-08-13', endDate: '2019-08-13' })).status, 400);
    assert.equal((await cashier.post(`/api/hr/leave/${lv.body.data.id}/approve`, {})).status, 403);

    const ok = await manager.post(`/api/hr/leave/${lv.body.data.id}/approve`, {});
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    assert.equal(ok.body.data.status, 'approved');
    const sum = (await cashier.get('/api/hr/leave/summary?year=2019')).body.data;
    assert.equal(sum.used.vacation, 2);
    assert.equal(sum.vacationLeft, 4);
    // the cashier sees only their own; the manager sees everyone's
    assert.ok((await cashier.get('/api/hr/leave')).body.data.every((l) => l.employeeId === me.body.data.id));

    const hub = await accountant.get('/api/documents/hub?category=hr&from=2019-08-01&to=2019-08-31');
    const types = new Set(hub.body.data.map((x) => x.type));
    assert.ok(types.has('payroll_run'));
    assert.ok(types.has('leave_request'));
  });
});
