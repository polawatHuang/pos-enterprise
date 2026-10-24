'use strict';

// Payroll reports for the Revenue Department and the Social Security Office, and the papers staff ask
// for: ภ.ง.ด.1 (monthly), ภ.ง.ด.1ก (yearly), สปส.1-10 (monthly), 50 ทวิ for the year, and
// หนังสือรับรองเงินเดือน / การทำงาน. Months count when their payroll run is approved or paid.

const express = require('express');
const { z } = require('zod');
const db = require('../../db/pool');
const { validate } = require('../../core/http');
const { requirePermission } = require('../../core/auth');
const { notFound } = require('../../core/errors');
const { thaiBahtText } = require('../../utils/thai-baht-text');
const { sendCsv, money } = require('../accounting/csv');
const { ssoSettings, loadEmployee, mapEmployee } = require('./employees.routes');
const { r2 } = require('./payroll-calc');

const router = express.Router();
router.use(requirePermission('hr:manage'));

const year = z.coerce.number().int().min(2000).max(2100);
const month = z.coerce.number().int().min(1).max(12);
const periodOf = (y, m) => `${y}-${String(m).padStart(2, '0')}`;

async function org(orgId) {
  const o = await db.one(
    `SELECT o.name, o.legal_name, o.tax_id, o.address, o.phone, b.branch_no FROM organizations o
       LEFT JOIN branches b ON b.org_id = o.id AND b.branch_no = '00000' WHERE o.id = :orgId LIMIT 1`,
    { orgId },
  );
  return { name: o.name, legalName: o.legal_name, taxId: o.tax_id, address: o.address, phone: o.phone, branchNo: o.branch_no ?? '00000' };
}

/** Per employee for one month (ภ.ง.ด.1, สปส.1-10). */
async function monthRows(orgId, period) {
  return db.query(
    `SELECT e.id, e.emp_code, e.title, e.full_name, e.national_id, e.sso_number, e.address,
            SUM(i.gross) AS gross, SUM(i.wht) AS wht, SUM(i.sso_base) AS sso_base, SUM(i.sso_employee) AS sso_employee, SUM(i.sso_employer) AS sso_employer,
            MAX(DATE_FORMAT(r.pay_date, '%Y-%m-%d')) AS pay_date
       FROM payroll_items i JOIN payroll_runs r ON r.id = i.run_id JOIN employees e ON e.id = i.employee_id
      WHERE r.org_id = :orgId AND r.period = :period AND r.status IN ('approved','paid')
      GROUP BY e.id ORDER BY e.emp_code`,
    { orgId, period },
  );
}

async function pnd1(orgId, y, m) {
  const rows = await monthRows(orgId, periodOf(y, m));
  const items = rows.map((r, idx) => ({
    seq: idx + 1,
    employeeId: r.id,
    nationalId: r.national_id,
    name: `${r.title ?? ''}${r.full_name}`,
    payDate: r.pay_date,
    income: Number(r.gross),
    wht: Number(r.wht),
  }));
  return {
    period: { year: y, month: m },
    org: await org(orgId),
    items,
    totals: { count: items.length, income: r2(items.reduce((s, i) => s + i.income, 0)), wht: r2(items.reduce((s, i) => s + i.wht, 0)) },
    warnings: items.filter((i) => !i.nationalId).map((i) => `${i.name} ไม่มีเลขประจำตัวประชาชน`),
    dueNote: 'ยื่น ภ.ง.ด.1 และนำส่งภาษีภายในวันที่ 7 ของเดือนถัดไป (ยื่นออนไลน์ขยายได้ถึงประมาณวันที่ 15)',
  };
}

router.get('/pnd1', validate({ query: z.object({ year, month }) }), async (req, res) => {
  res.json({ data: await pnd1(req.user.orgId, req.valid.query.year, req.valid.query.month) });
});

router.get('/pnd1.csv', validate({ query: z.object({ year, month }) }), async (req, res) => {
  const d = await pnd1(req.user.orgId, req.valid.query.year, req.valid.query.month);
  const rows = [['ลำดับ', 'เลขประจำตัวผู้เสียภาษี', 'ชื่อ-นามสกุล', 'วันที่จ่าย', 'เงินได้ (40(1))', 'ภาษีที่หักนำส่ง']];
  for (const i of d.items) rows.push([i.seq, i.nationalId ?? '', i.name, i.payDate, money(i.income), money(i.wht)]);
  rows.push(['', '', 'รวม', '', money(d.totals.income), money(d.totals.wht)]);
  sendCsv(res, `pnd1-${periodOf(d.period.year, d.period.month)}.csv`, rows);
});

async function pnd1a(orgId, y) {
  const rows = await db.query(
    `SELECT e.id, e.title, e.full_name, e.national_id, e.address, SUM(i.gross) AS gross, SUM(i.wht) AS wht, SUM(i.sso_employee) AS sso
       FROM payroll_items i JOIN payroll_runs r ON r.id = i.run_id JOIN employees e ON e.id = i.employee_id
      WHERE r.org_id = :orgId AND r.period LIKE :y AND r.status IN ('approved','paid')
      GROUP BY e.id ORDER BY e.emp_code`,
    { orgId, y: `${y}-%` },
  );
  const items = rows.map((r, idx) => ({
    seq: idx + 1,
    employeeId: r.id,
    nationalId: r.national_id,
    name: `${r.title ?? ''}${r.full_name}`,
    address: r.address,
    income: Number(r.gross),
    wht: Number(r.wht),
    sso: Number(r.sso),
  }));
  return {
    year: y,
    org: await org(orgId),
    items,
    totals: { count: items.length, income: r2(items.reduce((s, i) => s + i.income, 0)), wht: r2(items.reduce((s, i) => s + i.wht, 0)) },
    dueNote: 'ยื่น ภ.ง.ด.1ก ภายในเดือนกุมภาพันธ์ของปีถัดไป และออกหนังสือรับรอง 50 ทวิ ให้พนักงานทุกคน',
  };
}

router.get('/pnd1a', validate({ query: z.object({ year }) }), async (req, res) => {
  res.json({ data: await pnd1a(req.user.orgId, req.valid.query.year) });
});

router.get('/pnd1a.csv', validate({ query: z.object({ year }) }), async (req, res) => {
  const d = await pnd1a(req.user.orgId, req.valid.query.year);
  const rows = [['ลำดับ', 'เลขประจำตัวผู้เสียภาษี', 'ชื่อ-นามสกุล', 'ที่อยู่', 'เงินได้ทั้งปี', 'ภาษีที่หักทั้งปี']];
  for (const i of d.items) rows.push([i.seq, i.nationalId ?? '', i.name, i.address ?? '', money(i.income), money(i.wht)]);
  rows.push(['', '', 'รวม', '', money(d.totals.income), money(d.totals.wht)]);
  sendCsv(res, `pnd1a-${d.year}.csv`, rows);
});

async function sso(orgId, y, m) {
  const rows = await monthRows(orgId, periodOf(y, m));
  const cfg = await ssoSettings(orgId);
  const items = rows
    .filter((r) => Number(r.sso_employee) > 0)
    .map((r, idx) => ({
      seq: idx + 1,
      employeeId: r.id,
      ssoNumber: r.sso_number || r.national_id,
      name: `${r.title ?? ''}${r.full_name}`,
      wage: Number(r.sso_base),
      employee: Number(r.sso_employee),
      employer: Number(r.sso_employer),
    }));
  const t = (k) => r2(items.reduce((s, i) => s + i[k], 0));
  return {
    period: { year: y, month: m },
    org: await org(orgId),
    rate: cfg.rate,
    ceiling: cfg.ceiling,
    items,
    totals: { count: items.length, wage: t('wage'), employee: t('employee'), employer: t('employer'), total: r2(t('employee') + t('employer')) },
    dueNote: 'ยื่นแบบ สปส.1-10 และนำส่งเงินสมทบภายในวันที่ 15 ของเดือนถัดไป',
  };
}

router.get('/sso', validate({ query: z.object({ year, month }) }), async (req, res) => {
  res.json({ data: await sso(req.user.orgId, req.valid.query.year, req.valid.query.month) });
});

router.get('/sso.csv', validate({ query: z.object({ year, month }) }), async (req, res) => {
  const d = await sso(req.user.orgId, req.valid.query.year, req.valid.query.month);
  const rows = [['ลำดับ', 'เลขประจำตัวประชาชน', 'ชื่อ-นามสกุล', 'ค่าจ้าง', 'เงินสมทบผู้ประกันตน', 'เงินสมทบนายจ้าง']];
  for (const i of d.items) rows.push([i.seq, i.ssoNumber ?? '', i.name, money(i.wage), money(i.employee), money(i.employer)]);
  rows.push(['', '', 'รวม', money(d.totals.wage), money(d.totals.employee), money(d.totals.employer)]);
  sendCsv(res, `sso-1-10-${periodOf(d.period.year, d.period.month)}.csv`, rows);
});

/** 50 ทวิ for a year's salary (income type 40(1), filed with ภ.ง.ด.1ก). */
router.get('/wht-certificate', validate({ query: z.object({ year, employeeId: z.coerce.number().int().positive() }) }), async (req, res) => {
  const { year: y, employeeId } = req.valid.query;
  const e = await loadEmployee(req.user.orgId, employeeId);
  const t = await db.one(
    `SELECT COALESCE(SUM(i.gross), 0) AS gross, COALESCE(SUM(i.wht), 0) AS wht, COALESCE(SUM(i.sso_employee), 0) AS sso, COUNT(*) AS months
       FROM payroll_items i JOIN payroll_runs r ON r.id = i.run_id
      WHERE i.employee_id = :emp AND r.period LIKE :y AND r.status IN ('approved','paid')`,
    { emp: employeeId, y: `${y}-%` },
  );
  if (!Number(t.months)) throw notFound(`ไม่มีเงินเดือนของปี ${y + 543} สำหรับพนักงานคนนี้`);
  res.json({
    data: {
      year: y,
      org: await org(req.user.orgId),
      employee: mapEmployee(e),
      income: Number(t.gross),
      wht: Number(t.wht),
      sso: Number(t.sso),
      months: Number(t.months),
      whtText: thaiBahtText(t.wht),
    },
  });
});

/** หนังสือรับรองเงินเดือน / หนังสือรับรองการทำงาน. */
router.get(
  '/certificate',
  validate({ query: z.object({ employeeId: z.coerce.number().int().positive(), kind: z.enum(['salary', 'employment']).default('salary') }) }),
  async (req, res) => {
    const e = mapEmployee(await loadEmployee(req.user.orgId, req.valid.query.employeeId));
    res.json({ data: { kind: req.valid.query.kind, org: await org(req.user.orgId), employee: e, salaryText: thaiBahtText(e.baseSalary) } });
  },
);

module.exports = { router };
