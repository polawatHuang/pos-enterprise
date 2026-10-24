'use strict';

// Monthly payroll: a draft run lists every employee on the books that month with social security
// and withholding worked out; lines can be edited while it is a draft. Approving books the month's
// cost (Dr salaries 5200 + employer social security 5210 / Cr salaries payable 2240, withholding
// payable 2220, social security payable 2230); paying books the transfer (Dr 2240 / Cr bank or cash).
// Remitting ภ.ง.ด.1 and สปส.1-10 clears 2220 / 2230.

const express = require('express');
const { z } = require('zod');
const db = require('../../db/pool');
const { validate } = require('../../core/http');
const { requirePermission } = require('../../core/auth');
const { audit } = require('../../core/audit');
const { badRequest, conflict, notFound } = require('../../core/errors');
const { thaiBahtText } = require('../../utils/thai-baht-text');
const { nextNumber, paymentAccount, postJournal, reverseJournalsFor } = require('../accounting/ledger.service');
const { computeLine, r2 } = require('./payroll-calc');
const { ssoSettings, myEmployee } = require('./employees.routes');

const router = express.Router();
const idParam = z.object({ id: z.coerce.number().int().positive() });
const periodRe = /^\d{4}-(0[1-9]|1[0-2])$/;
const ACC = { SALARY: '5200', SSO_EXPENSE: '5210', PND1: '2220', SSO: '2230', SALARY_PAYABLE: '2240' };

const lastDay = (period) => {
  const [y, m] = period.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
};

const RUN_SELECT = `SELECT r.*, DATE_FORMAT(r.pay_date, '%Y-%m-%d') AS pay_day, u.full_name AS created_by_name, a.full_name AS approved_by_name,
                           (SELECT COUNT(*) FROM payroll_items i WHERE i.run_id = r.id) AS headcount
                      FROM payroll_runs r LEFT JOIN users u ON u.id = r.created_by LEFT JOIN users a ON a.id = r.approved_by`;

const mapRun = (r) => ({
  id: r.id,
  runNo: r.run_no,
  period: r.period,
  payDate: r.pay_day,
  status: r.status,
  headcount: Number(r.headcount ?? 0),
  totalGross: Number(r.total_gross),
  totalSsoEmployee: Number(r.total_sso_employee),
  totalSsoEmployer: Number(r.total_sso_employer),
  totalWht: Number(r.total_wht),
  totalDeductions: Number(r.total_deductions),
  totalNet: Number(r.total_net),
  paymentMethod: r.payment_method,
  note: r.note,
  createdBy: r.created_by_name ?? null,
  approvedBy: r.approved_by_name ?? null,
  approvedAt: r.approved_at,
  paidAt: r.paid_at,
});

const ITEM_SELECT = `SELECT i.*, e.emp_code, e.title, e.full_name, e.position, e.pay_type, e.base_salary AS rate, e.national_id, e.bank_name, e.bank_account
                       FROM payroll_items i JOIN employees e ON e.id = i.employee_id`;

const mapItem = (i) => ({
  id: i.id,
  employeeId: i.employee_id,
  empCode: i.emp_code,
  name: `${i.title ?? ''}${i.full_name}`,
  position: i.position,
  payType: i.pay_type,
  rate: Number(i.rate),
  nationalId: i.national_id,
  bankName: i.bank_name,
  bankAccount: i.bank_account,
  daysWorked: i.days_worked == null ? null : Number(i.days_worked),
  basePay: Number(i.base_pay),
  overtime: Number(i.overtime),
  allowance: Number(i.allowance),
  bonus: Number(i.bonus),
  otherIncome: Number(i.other_income),
  deduction: Number(i.deduction),
  gross: Number(i.gross),
  ssoBase: Number(i.sso_base),
  ssoEmployee: Number(i.sso_employee),
  ssoEmployer: Number(i.sso_employer),
  wht: Number(i.wht),
  whtManual: Boolean(i.wht_manual),
  net: Number(i.net),
  note: i.note,
});

async function loadRun(orgId, id) {
  const r = await db.one(`${RUN_SELECT} WHERE r.id = :id AND r.org_id = :orgId`, { id, orgId });
  if (!r) throw notFound('ไม่พบรอบเงินเดือน');
  const items = await db.query(`${ITEM_SELECT} WHERE i.run_id = :id ORDER BY e.emp_code`, { id });
  return { ...mapRun(r), items: items.map(mapItem) };
}

async function writeItem(conn, runId, employeeId, line, note = null) {
  await conn.query(
    `INSERT INTO payroll_items (run_id, employee_id, days_worked, base_pay, overtime, allowance, bonus, other_income, gross, sso_base, sso_employee,
                                sso_employer, wht, wht_manual, deduction, net, note)
     VALUES (:runId, :employeeId, :daysWorked, :basePay, :overtime, :allowance, :bonus, :otherIncome, :gross, :ssoBase, :ssoEmployee,
             :ssoEmployer, :wht, :whtManual, :deduction, :net, :note)
     ON DUPLICATE KEY UPDATE days_worked = VALUES(days_worked), base_pay = VALUES(base_pay), overtime = VALUES(overtime), allowance = VALUES(allowance),
       bonus = VALUES(bonus), other_income = VALUES(other_income), gross = VALUES(gross), sso_base = VALUES(sso_base), sso_employee = VALUES(sso_employee),
       sso_employer = VALUES(sso_employer), wht = VALUES(wht), wht_manual = VALUES(wht_manual), deduction = VALUES(deduction), net = VALUES(net), note = VALUES(note)`,
    { runId, employeeId, ...line, whtManual: line.whtManual ? 1 : 0, note },
  );
}

async function updateTotals(conn, runId) {
  await conn.query(
    `UPDATE payroll_runs r SET
       total_gross = (SELECT COALESCE(SUM(gross), 0) FROM payroll_items WHERE run_id = r.id),
       total_sso_employee = (SELECT COALESCE(SUM(sso_employee), 0) FROM payroll_items WHERE run_id = r.id),
       total_sso_employer = (SELECT COALESCE(SUM(sso_employer), 0) FROM payroll_items WHERE run_id = r.id),
       total_wht = (SELECT COALESCE(SUM(wht), 0) FROM payroll_items WHERE run_id = r.id),
       total_deductions = (SELECT COALESCE(SUM(deduction), 0) FROM payroll_items WHERE run_id = r.id),
       total_net = (SELECT COALESCE(SUM(net), 0) FROM payroll_items WHERE run_id = r.id)
     WHERE r.id = :runId`,
    { runId },
  );
}

router.get('/payroll', requirePermission('hr:manage'), validate({ query: z.object({ year: z.coerce.number().int().min(2000).max(2100).optional() }) }), async (req, res) => {
  const rows = await db.query(`${RUN_SELECT} WHERE r.org_id = :orgId AND (:year IS NULL OR r.period LIKE :y) ORDER BY r.period DESC, r.id DESC`, {
    orgId: req.user.orgId,
    year: req.valid.query.year ?? null,
    y: `${req.valid.query.year ?? ''}-%`,
  });
  res.json({ data: rows.map(mapRun) });
});

router.get('/payroll/:id', requirePermission('hr:manage'), validate({ params: idParam }), async (req, res) => {
  res.json({ data: await loadRun(req.user.orgId, req.valid.params.id) });
});

/** A draft run for the month with every employee who worked in it. */
router.post(
  '/payroll',
  requirePermission('hr:manage'),
  validate({ body: z.object({ period: z.string().regex(periodRe, 'เดือนต้องเป็น YYYY-MM'), payDate: z.iso.date(), note: z.string().trim().max(255).nullable().optional() }) }),
  async (req, res) => {
    const b = req.valid.body;
    const { orgId, id: userId } = req.user;
    const sso = await ssoSettings(orgId);
    const id = await db.tx(async (conn) => {
      const [[dup]] = await conn.query("SELECT run_no FROM payroll_runs WHERE org_id = :orgId AND period = :period AND status <> 'void' LIMIT 1 FOR UPDATE", {
        orgId,
        period: b.period,
      });
      if (dup) throw conflict(`เดือนนี้มีรอบเงินเดือน ${dup.run_no} แล้ว`);
      const [emps] = await conn.query(
        `SELECT * FROM employees WHERE org_id = :orgId AND start_date <= :last AND (end_date IS NULL OR end_date >= :first) ORDER BY emp_code`,
        { orgId, last: lastDay(b.period), first: `${b.period}-01` },
      );
      if (!emps.length) throw badRequest('ยังไม่มีพนักงานที่ทำงานในเดือนนี้ — เพิ่มพนักงานก่อน');
      const runNo = await nextNumber(conn, orgId, 'payroll_run', `${b.period}-01`);
      const [ins] = await conn.query(
        'INSERT INTO payroll_runs (org_id, run_no, period, pay_date, note, created_by) VALUES (:orgId, :runNo, :period, :payDate, :note, :userId)',
        { orgId, runNo, period: b.period, payDate: b.payDate, note: b.note ?? null, userId },
      );
      for (const e of emps) await writeItem(conn, ins.insertId, e.id, computeLine(e, {}, sso));
      await updateTotals(conn, ins.insertId);
      return ins.insertId;
    });
    audit(req, 'payroll.create', 'payroll_run', id, { period: b.period });
    res.status(201).json({ data: await loadRun(orgId, id) });
  },
);

/** Edit one line of a draft: days, overtime, allowance, bonus, other income, deduction, or a typed withholding. */
router.put(
  '/payroll/:id/items/:itemId',
  requirePermission('hr:manage'),
  validate({
    params: z.object({ id: z.coerce.number().int().positive(), itemId: z.coerce.number().int().positive() }),
    body: z.object({
      daysWorked: z.coerce.number().min(0).max(31).nullable().optional(),
      basePay: z.coerce.number().min(0).max(10_000_000).optional(),
      overtime: z.coerce.number().min(0).max(10_000_000).default(0),
      allowance: z.coerce.number().min(0).max(10_000_000).default(0),
      bonus: z.coerce.number().min(0).max(100_000_000).default(0),
      otherIncome: z.coerce.number().min(0).max(10_000_000).default(0),
      deduction: z.coerce.number().min(0).max(10_000_000).default(0),
      wht: z.coerce.number().min(0).max(10_000_000).nullable().optional(),
      note: z.string().trim().max(255).nullable().optional(),
    }),
  }),
  async (req, res) => {
    const { id, itemId } = req.valid.params;
    const b = req.valid.body;
    const orgId = req.user.orgId;
    const sso = await ssoSettings(orgId);
    await db.tx(async (conn) => {
      const [[run]] = await conn.query('SELECT status FROM payroll_runs WHERE id = :id AND org_id = :orgId FOR UPDATE', { id, orgId });
      if (!run) throw notFound('ไม่พบรอบเงินเดือน');
      if (run.status !== 'draft') throw conflict('แก้ไขได้เฉพาะรอบที่ยังไม่อนุมัติ');
      const [[item]] = await conn.query('SELECT i.employee_id, e.* FROM payroll_items i JOIN employees e ON e.id = i.employee_id WHERE i.id = :itemId AND i.run_id = :id', {
        itemId,
        id,
      });
      if (!item) throw notFound('ไม่พบรายการ');
      const line = computeLine(item, { ...b, wht: b.wht ?? undefined }, sso);
      if (line.gross < 0) throw badRequest('ยอดหักมากกว่ารายได้');
      if (line.net < 0) throw badRequest('ภาษีและประกันสังคมมากกว่ารายได้สุทธิ');
      await writeItem(conn, id, item.employee_id, line, b.note ?? null);
      await updateTotals(conn, id);
    });
    res.json({ data: await loadRun(orgId, id) });
  },
);

router.post('/payroll/:id/approve', requirePermission('hr:manage'), validate({ params: idParam }), async (req, res) => {
  const { id } = req.valid.params;
  const { orgId, id: userId } = req.user;
  await db.tx(async (conn) => {
    const [[r]] = await conn.query('SELECT * FROM payroll_runs WHERE id = :id AND org_id = :orgId FOR UPDATE', { id, orgId });
    if (!r) throw notFound('ไม่พบรอบเงินเดือน');
    if (r.status !== 'draft') throw conflict('รอบนี้อนุมัติไปแล้ว');
    if (!(Number(r.total_net) > 0)) throw badRequest('ยอดจ่ายรวมเป็นศูนย์');
    await conn.query("UPDATE payroll_runs SET status = 'approved', approved_by = :userId, approved_at = UTC_TIMESTAMP() WHERE id = :id", { userId, id });
    await postJournal(conn, {
      orgId,
      date: lastDay(r.period),
      description: `เงินเดือน ${r.period} (${r.run_no})`,
      refType: 'payroll_run',
      refId: id,
      userId,
      lines: [
        { account: ACC.SALARY, debit: Number(r.total_gross) },
        { account: ACC.SSO_EXPENSE, debit: Number(r.total_sso_employer) },
        { account: ACC.SALARY_PAYABLE, credit: Number(r.total_net) },
        { account: ACC.PND1, credit: Number(r.total_wht) },
        { account: ACC.SSO, credit: r2(Number(r.total_sso_employee) + Number(r.total_sso_employer)) },
      ],
    });
  });
  audit(req, 'payroll.approve', 'payroll_run', id);
  res.json({ data: await loadRun(orgId, id) });
});

router.post(
  '/payroll/:id/pay',
  requirePermission('hr:manage'),
  validate({ params: idParam, body: z.object({ paymentMethod: z.enum(['transfer', 'cash', 'cheque']).default('transfer'), paidDate: z.iso.date().optional() }) }),
  async (req, res) => {
    const { id } = req.valid.params;
    const { orgId, id: userId } = req.user;
    await db.tx(async (conn) => {
      const [[r]] = await conn.query("SELECT *, DATE_FORMAT(pay_date, '%Y-%m-%d') AS pay_day FROM payroll_runs WHERE id = :id AND org_id = :orgId FOR UPDATE", {
        id,
        orgId,
      });
      if (!r) throw notFound('ไม่พบรอบเงินเดือน');
      if (r.status !== 'approved') throw conflict(r.status === 'paid' ? 'จ่ายไปแล้ว' : 'ต้องอนุมัติก่อนจ่าย');
      await conn.query("UPDATE payroll_runs SET status = 'paid', paid_at = UTC_TIMESTAMP(), payment_method = :m WHERE id = :id", {
        m: req.valid.body.paymentMethod,
        id,
      });
      await postJournal(conn, {
        orgId,
        date: req.valid.body.paidDate ?? r.pay_day,
        description: `จ่ายเงินเดือน ${r.period} (${r.run_no})`,
        refType: 'payroll_run',
        refId: id,
        userId,
        lines: [
          { account: ACC.SALARY_PAYABLE, debit: Number(r.total_net) },
          { account: paymentAccount(req.valid.body.paymentMethod), credit: Number(r.total_net) },
        ],
      });
    });
    audit(req, 'payroll.pay', 'payroll_run', id);
    res.json({ data: await loadRun(orgId, id) });
  },
);

/** A draft is deleted; an approved or paid run is voided and its journals reversed. */
router.post(
  '/payroll/:id/void',
  requirePermission('hr:manage'),
  validate({ params: idParam, body: z.object({ reason: z.string().trim().min(1).max(200) }) }),
  async (req, res) => {
    const { id } = req.valid.params;
    const orgId = req.user.orgId;
    let deleted = false;
    await db.tx(async (conn) => {
      const [[r]] = await conn.query('SELECT * FROM payroll_runs WHERE id = :id AND org_id = :orgId FOR UPDATE', { id, orgId });
      if (!r) throw notFound('ไม่พบรอบเงินเดือน');
      if (r.status === 'void') throw conflict('ยกเลิกไปแล้ว');
      if (r.status === 'draft') {
        await conn.query('DELETE FROM payroll_runs WHERE id = :id', { id });
        deleted = true;
        return;
      }
      const [[remit]] = await conn.query("SELECT kind FROM payroll_remittances WHERE org_id = :orgId AND period = :p AND status = 'posted' LIMIT 1", {
        orgId,
        p: r.period,
      });
      if (remit) throw conflict('นำส่งภาษี/ประกันสังคมของเดือนนี้ไปแล้ว — ยกเลิกการนำส่งก่อน');
      await conn.query("UPDATE payroll_runs SET status = 'void', note = CONCAT(COALESCE(note, ''), :r) WHERE id = :id", {
        id,
        r: ` [ยกเลิก] ${req.valid.body.reason}`.slice(0, 255),
      });
      await reverseJournalsFor(conn, { orgId, refType: 'payroll_run', refId: id, reason: req.valid.body.reason, userId: req.user.id });
    });
    audit(req, 'payroll.void', 'payroll_run', id, { reason: req.valid.body.reason });
    res.json({ data: deleted ? { deleted: true } : await loadRun(orgId, id) });
  },
);

/* ------------------------------------------------------------ remittances */

/** Paying the month's withheld tax (ภ.ง.ด.1) or social security (employee + employer) to the government. */
router.post(
  '/remittances',
  requirePermission('hr:manage'),
  validate({
    body: z.object({
      kind: z.enum(['pnd1', 'sso']),
      period: z.string().regex(periodRe),
      remitDate: z.iso.date(),
      paymentMethod: z.enum(['transfer', 'cash', 'cheque']).default('transfer'),
      reference: z.string().trim().max(100).nullable().optional(),
    }),
  }),
  async (req, res) => {
    const b = req.valid.body;
    const { orgId, id: userId } = req.user;
    const id = await db.tx(async (conn) => {
      const [[due]] = await conn.query(
        `SELECT COALESCE(SUM(${b.kind === 'pnd1' ? 'total_wht' : 'total_sso_employee + total_sso_employer'}), 0) AS amount
           FROM payroll_runs WHERE org_id = :orgId AND period = :period AND status IN ('approved','paid')`,
        { orgId, period: b.period },
      );
      const [[done]] = await conn.query(
        "SELECT COALESCE(SUM(amount), 0) AS amount FROM payroll_remittances WHERE org_id = :orgId AND kind = :kind AND period = :period AND status = 'posted' FOR UPDATE",
        { orgId, kind: b.kind, period: b.period },
      );
      const amount = r2(Number(due.amount) - Number(done.amount));
      if (!(amount > 0)) throw badRequest('ไม่มียอดค้างนำส่งของเดือนนี้');
      const [ins] = await conn.query(
        `INSERT INTO payroll_remittances (org_id, kind, period, remit_date, amount, payment_method, reference, created_by)
         VALUES (:orgId, :kind, :period, :date, :amount, :method, :reference, :userId)`,
        { orgId, kind: b.kind, period: b.period, date: b.remitDate, amount, method: b.paymentMethod, reference: b.reference ?? null, userId },
      );
      await postJournal(conn, {
        orgId,
        date: b.remitDate,
        description: `นำส่ง${b.kind === 'pnd1' ? 'ภาษี ภ.ง.ด.1' : 'เงินสมทบประกันสังคม'} ${b.period}`,
        refType: 'payroll_remittance',
        refId: ins.insertId,
        userId,
        lines: [
          { account: b.kind === 'pnd1' ? ACC.PND1 : ACC.SSO, debit: amount },
          { account: paymentAccount(b.paymentMethod), credit: amount },
        ],
      });
      return ins.insertId;
    });
    audit(req, 'payroll.remit', 'payroll_remittance', id, { kind: b.kind, period: b.period });
    res.status(201).json({ data: { id } });
  },
);

router.get('/remittances', requirePermission('hr:manage'), validate({ query: z.object({ year: z.coerce.number().int().min(2000).max(2100) }) }), async (req, res) => {
  const rows = await db.query(
    `SELECT id, kind, period, DATE_FORMAT(remit_date, '%Y-%m-%d') AS day, amount, payment_method, reference, status
       FROM payroll_remittances WHERE org_id = :orgId AND period LIKE :y ORDER BY period DESC, id DESC`,
    { orgId: req.user.orgId, y: `${req.valid.query.year}-%` },
  );
  res.json({
    data: rows.map((r) => ({ id: r.id, kind: r.kind, period: r.period, remitDate: r.day, amount: Number(r.amount), paymentMethod: r.payment_method, reference: r.reference, status: r.status })),
  });
});

/* -------------------------------------------------------------- payslips */

async function payslip(orgId, itemId, employeeId = null) {
  const i = await db.one(
    `${ITEM_SELECT.replace('FROM payroll_items i', ', r.period, r.run_no, r.status AS run_status, DATE_FORMAT(r.pay_date, \'%Y-%m-%d\') AS pay_day FROM payroll_items i JOIN payroll_runs r ON r.id = i.run_id')}
      WHERE i.id = :itemId AND r.org_id = :orgId AND (:employeeId IS NULL OR i.employee_id = :employeeId)`,
    { itemId, orgId, employeeId },
  );
  if (!i) throw notFound('ไม่พบสลิปเงินเดือน');
  const org = await db.one('SELECT name, legal_name, tax_id, address FROM organizations WHERE id = :orgId', { orgId });
  const ytd = await db.one(
    `SELECT COALESCE(SUM(x.gross), 0) AS gross, COALESCE(SUM(x.wht), 0) AS wht, COALESCE(SUM(x.sso_employee), 0) AS sso
       FROM payroll_items x JOIN payroll_runs r ON r.id = x.run_id
      WHERE x.employee_id = :emp AND r.status IN ('approved','paid') AND r.period LIKE :y AND r.period <= :p`,
    { emp: i.employee_id, y: `${i.period.slice(0, 4)}-%`, p: i.period },
  );
  return {
    ...mapItem(i),
    period: i.period,
    runNo: i.run_no,
    runStatus: i.run_status,
    payDate: i.pay_day,
    netText: thaiBahtText(i.net),
    ytd: { gross: Number(ytd.gross), wht: Number(ytd.wht), sso: Number(ytd.sso) },
    org: { name: org.name, legalName: org.legal_name, taxId: org.tax_id, address: org.address },
  };
}

router.get('/payslips/:itemId', requirePermission('hr:manage'), validate({ params: z.object({ itemId: z.coerce.number().int().positive() }) }), async (req, res) => {
  res.json({ data: await payslip(req.user.orgId, req.valid.params.itemId) });
});

/** A staff member's own payslips (approved or paid months only). */
router.get('/my/payslips', async (req, res) => {
  const e = await myEmployee(req.user);
  if (!e) return res.json({ data: [] });
  const rows = await db.query(
    `SELECT i.id, r.period, DATE_FORMAT(r.pay_date, '%Y-%m-%d') AS pay_day, i.gross, i.net FROM payroll_items i JOIN payroll_runs r ON r.id = i.run_id
      WHERE i.employee_id = :emp AND r.status IN ('approved','paid') ORDER BY r.period DESC LIMIT 24`,
    { emp: e.id },
  );
  res.json({ data: rows.map((r) => ({ itemId: r.id, period: r.period, payDate: r.pay_day, gross: Number(r.gross), net: Number(r.net) })) });
});

router.get('/my/payslips/:itemId', validate({ params: z.object({ itemId: z.coerce.number().int().positive() }) }), async (req, res) => {
  const e = await myEmployee(req.user);
  if (!e) throw notFound('ไม่พบข้อมูลพนักงานของคุณ');
  const slip = await payslip(req.user.orgId, req.valid.params.itemId, e.id);
  if (slip.runStatus === 'draft' || slip.runStatus === 'void') throw notFound('ไม่พบสลิปเงินเดือน');
  res.json({ data: slip });
});

module.exports = { router, lastDay };
