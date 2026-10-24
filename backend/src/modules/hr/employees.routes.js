'use strict';

// Staff records (hr:manage), the social-security settings, and "me" for anyone signed in (their
// own record, leave balance and payslips).

const express = require('express');
const { z } = require('zod');
const db = require('../../db/pool');
const { validate } = require('../../core/http');
const { requirePermission } = require('../../core/auth');
const { audit } = require('../../core/audit');
const { badRequest, conflict, forbidden, notFound } = require('../../core/errors');
const { isValidTaxId } = require('../pos/tax-invoice');
const { SSO_DEFAULT } = require('./payroll-calc');

const router = express.Router();
const idParam = z.object({ id: z.coerce.number().int().positive() });
const SSO_KEY = 'hr.sso';

async function ssoSettings(orgId) {
  const row = await db.one('SELECT value FROM settings WHERE org_id = :orgId AND setting_key = :k', { orgId, k: SSO_KEY });
  let v = row?.value;
  if (typeof v === 'string') {
    try {
      v = JSON.parse(v);
    } catch {
      v = null;
    }
  }
  return { ...SSO_DEFAULT, ...(v && typeof v === 'object' ? v : {}) };
}

const SELECT = `SELECT e.*, DATE_FORMAT(e.start_date, '%Y-%m-%d') AS start_day, DATE_FORMAT(e.end_date, '%Y-%m-%d') AS end_day,
                       DATE_FORMAT(e.birth_date, '%Y-%m-%d') AS birth_day, b.name AS branch_name, u.email AS user_email
                  FROM employees e LEFT JOIN branches b ON b.id = e.branch_id LEFT JOIN users u ON u.id = e.user_id`;

function mapEmployee(e) {
  return {
    id: e.id,
    userId: e.user_id,
    userEmail: e.user_email ?? null,
    empCode: e.emp_code,
    title: e.title,
    fullName: e.full_name,
    displayName: `${e.title ?? ''}${e.full_name}`,
    nationalId: e.national_id,
    birthDate: e.birth_day,
    address: e.address,
    phone: e.phone,
    email: e.email,
    branchId: e.branch_id,
    branchName: e.branch_name ?? null,
    position: e.position,
    department: e.department,
    payType: e.pay_type,
    baseSalary: Number(e.base_salary),
    startDate: e.start_day,
    endDate: e.end_day,
    status: e.status,
    ssoEnrolled: Boolean(e.sso_enrolled),
    ssoNumber: e.sso_number,
    taxExtraDeductions: Number(e.tax_extra_deductions),
    bankName: e.bank_name,
    bankAccount: e.bank_account,
    annualLeaveDays: Number(e.annual_leave_days),
    note: e.note,
  };
}

async function loadEmployee(orgId, id) {
  const e = await db.one(`${SELECT} WHERE e.id = :id AND e.org_id = :orgId`, { id, orgId });
  if (!e) throw notFound('ไม่พบพนักงาน');
  return e;
}

const body = z.object({
  empCode: z.string().trim().max(20).optional(),
  userId: z.number().int().positive().nullable().optional(),
  title: z.string().trim().max(20).nullable().optional(),
  fullName: z.string().trim().min(1, 'กรอกชื่อ-นามสกุล').max(191),
  nationalId: z
    .string()
    .trim()
    .regex(/^\d{13}$/, 'เลขบัตรประชาชน 13 หลัก')
    .nullable()
    .optional(),
  birthDate: z.iso.date().nullable().optional(),
  address: z.string().trim().max(1000).nullable().optional(),
  phone: z.string().trim().max(50).nullable().optional(),
  email: z.string().trim().max(191).nullable().optional(),
  branchId: z.number().int().positive().nullable().optional(),
  position: z.string().trim().max(100).nullable().optional(),
  department: z.string().trim().max(100).nullable().optional(),
  payType: z.enum(['monthly', 'daily']).default('monthly'),
  baseSalary: z.coerce.number().min(0).max(10_000_000),
  startDate: z.iso.date(),
  endDate: z.iso.date().nullable().optional(),
  ssoEnrolled: z.boolean().default(true),
  ssoNumber: z.string().trim().max(20).nullable().optional(),
  taxExtraDeductions: z.coerce.number().min(0).max(10_000_000).default(0),
  bankName: z.string().trim().max(100).nullable().optional(),
  bankAccount: z.string().trim().max(30).nullable().optional(),
  annualLeaveDays: z.coerce.number().min(0).max(60).default(6),
  note: z.string().trim().max(255).nullable().optional(),
});

function columns(b) {
  if (b.nationalId && !isValidTaxId(b.nationalId)) throw badRequest('เลขบัตรประชาชนไม่ถูกต้อง (ตรวจหลักสุดท้ายไม่ผ่าน)');
  return {
    userId: b.userId ?? null,
    title: b.title ?? null,
    fullName: b.fullName,
    nationalId: b.nationalId ?? null,
    birthDate: b.birthDate ?? null,
    address: b.address ?? null,
    phone: b.phone ?? null,
    email: b.email ?? null,
    branchId: b.branchId ?? null,
    position: b.position ?? null,
    department: b.department ?? null,
    payType: b.payType,
    baseSalary: b.baseSalary,
    startDate: b.startDate,
    endDate: b.endDate ?? null,
    status: b.endDate ? 'resigned' : 'active',
    sso: b.ssoEnrolled ? 1 : 0,
    ssoNumber: b.ssoNumber ?? b.nationalId ?? null,
    extra: b.taxExtraDeductions,
    bankName: b.bankName ?? null,
    bankAccount: b.bankAccount ?? null,
    leaveDays: b.annualLeaveDays,
    note: b.note ?? null,
  };
}

async function checkLinks(orgId, b) {
  if (b.userId) {
    const u = await db.one('SELECT id FROM users WHERE id = :id AND org_id = :orgId', { id: b.userId, orgId });
    if (!u) throw notFound('ไม่พบผู้ใช้');
  }
  if (b.branchId) {
    const br = await db.one('SELECT id FROM branches WHERE id = :id AND org_id = :orgId', { id: b.branchId, orgId });
    if (!br) throw notFound('ไม่พบสาขา');
  }
}

router.get(
  '/employees',
  requirePermission('hr:manage'),
  validate({ query: z.object({ status: z.enum(['active', 'resigned']).optional(), q: z.string().trim().max(100).optional() }) }),
  async (req, res) => {
    const f = req.valid.query;
    const rows = await db.query(
      `${SELECT} WHERE e.org_id = :orgId AND (:status IS NULL OR e.status = :status)
         AND (:q IS NULL OR e.full_name LIKE :q OR e.emp_code LIKE :q OR e.position LIKE :q) ORDER BY e.status, e.emp_code`,
      { orgId: req.user.orgId, status: f.status ?? null, q: f.q ? `%${f.q}%` : null },
    );
    res.json({ data: rows.map(mapEmployee) });
  },
);

/** Names only, for whoever approves leave. */
router.get('/employees/options', async (req, res) => {
  if (!['hr:manage', 'leave:approve'].some((p) => req.user.permissions.includes(p))) throw forbidden('ต้องมีสิทธิ์อนุมัติใบลา');
  const rows = await db.query("SELECT id, emp_code, title, full_name FROM employees WHERE org_id = :orgId AND status = 'active' ORDER BY full_name", {
    orgId: req.user.orgId,
  });
  res.json({ data: rows.map((r) => ({ id: r.id, empCode: r.emp_code, name: `${r.title ?? ''}${r.full_name}` })) });
});

router.get('/employees/:id', requirePermission('hr:manage'), validate({ params: idParam }), async (req, res) => {
  res.json({ data: mapEmployee(await loadEmployee(req.user.orgId, req.valid.params.id)) });
});

router.post('/employees', requirePermission('hr:manage'), validate({ body }), async (req, res) => {
  const b = req.valid.body;
  const orgId = req.user.orgId;
  await checkLinks(orgId, b);
  const c = columns(b);
  const id = await db.tx(async (conn) => {
    let code = b.empCode;
    if (!code) {
      const [[n]] = await conn.query('SELECT COUNT(*) + 1 AS n FROM employees WHERE org_id = :orgId FOR UPDATE', { orgId });
      code = `E${String(n.n).padStart(4, '0')}`;
    }
    try {
      const [ins] = await conn.query(
        `INSERT INTO employees (org_id, user_id, emp_code, title, full_name, national_id, birth_date, address, phone, email, branch_id, position, department,
                                pay_type, base_salary, start_date, end_date, status, sso_enrolled, sso_number, tax_extra_deductions, bank_name, bank_account,
                                annual_leave_days, note)
         VALUES (:orgId, :userId, :code, :title, :fullName, :nationalId, :birthDate, :address, :phone, :email, :branchId, :position, :department,
                 :payType, :baseSalary, :startDate, :endDate, :status, :sso, :ssoNumber, :extra, :bankName, :bankAccount, :leaveDays, :note)`,
        { orgId, code, ...c },
      );
      return ins.insertId;
    } catch (err) {
      if (err.code === 'ER_DUP_ENTRY') throw conflict(/uq_emp_user/.test(err.message) ? 'ผู้ใช้นี้ผูกกับพนักงานคนอื่นแล้ว' : `รหัสพนักงาน ${code} ซ้ำ`);
      throw err;
    }
  });
  audit(req, 'employee.create', 'employee', id);
  res.status(201).json({ data: mapEmployee(await loadEmployee(orgId, id)) });
});

router.put('/employees/:id', requirePermission('hr:manage'), validate({ params: idParam, body }), async (req, res) => {
  const { id } = req.valid.params;
  const b = req.valid.body;
  const orgId = req.user.orgId;
  const before = await loadEmployee(orgId, id);
  await checkLinks(orgId, b);
  const c = columns(b);
  try {
    await db.query(
      `UPDATE employees SET emp_code = :code, user_id = :userId, title = :title, full_name = :fullName, national_id = :nationalId, birth_date = :birthDate,
              address = :address, phone = :phone, email = :email, branch_id = :branchId, position = :position, department = :department,
              pay_type = :payType, base_salary = :baseSalary, start_date = :startDate, end_date = :endDate, status = :status, sso_enrolled = :sso,
              sso_number = :ssoNumber, tax_extra_deductions = :extra, bank_name = :bankName, bank_account = :bankAccount,
              annual_leave_days = :leaveDays, note = :note
        WHERE id = :id AND org_id = :orgId`,
      { id, orgId, code: b.empCode || before.emp_code, ...c },
    );
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') throw conflict(/uq_emp_user/.test(err.message) ? 'ผู้ใช้นี้ผูกกับพนักงานคนอื่นแล้ว' : 'รหัสพนักงานซ้ำ');
    throw err;
  }
  audit(req, 'employee.update', 'employee', id, { salaryChanged: Number(before.base_salary) !== b.baseSalary });
  res.json({ data: mapEmployee(await loadEmployee(orgId, id)) });
});

/** Logins (to link a staff record) and branches, for the employee form. */
router.get('/lookups', requirePermission('hr:manage'), async (req, res) => {
  const [users, branches] = await Promise.all([
    db.query(
      `SELECT u.id, u.full_name, u.email, e.id AS employee_id FROM users u LEFT JOIN employees e ON e.user_id = u.id
        WHERE u.org_id = :orgId AND u.status = 'active' ORDER BY u.full_name`,
      { orgId: req.user.orgId },
    ),
    db.query('SELECT id, name FROM branches WHERE org_id = :orgId ORDER BY id', { orgId: req.user.orgId }),
  ]);
  res.json({
    data: {
      users: users.map((u) => ({ id: u.id, name: u.full_name, email: u.email, employeeId: u.employee_id ?? null })),
      branches: branches.map((b) => ({ id: b.id, name: b.name })),
    },
  });
});

/* --------------------------------------------------------------- settings */

router.get('/settings', requirePermission('hr:manage'), async (req, res) => {
  res.json({ data: { sso: await ssoSettings(req.user.orgId) } });
});

router.put(
  '/settings',
  requirePermission('hr:manage'),
  validate({
    body: z.object({
      sso: z.object({ rate: z.coerce.number().min(0).max(15), floor: z.coerce.number().min(0).max(100_000), ceiling: z.coerce.number().min(0).max(1_000_000) }),
    }),
  }),
  async (req, res) => {
    const { sso } = req.valid.body;
    if (sso.floor > sso.ceiling) throw badRequest('ฐานค่าจ้างต่ำสุดต้องไม่มากกว่าเพดาน');
    await db.query(
      'INSERT INTO settings (org_id, setting_key, value) VALUES (:orgId, :k, :v) ON DUPLICATE KEY UPDATE value = VALUES(value)',
      { orgId: req.user.orgId, k: SSO_KEY, v: JSON.stringify(sso) },
    );
    audit(req, 'hr.settings', 'settings', SSO_KEY, sso);
    res.json({ data: { sso: await ssoSettings(req.user.orgId) } });
  },
);

/* --------------------------------------------------------------------- me */

/** The signed-in person's own staff record (or null), for leave and payslips. */
async function myEmployee(user) {
  return db.one(`${SELECT} WHERE e.org_id = :orgId AND e.user_id = :userId`, { orgId: user.orgId, userId: user.id });
}

router.get('/me', async (req, res) => {
  const e = await myEmployee(req.user);
  if (!e) return res.json({ data: null });
  const m = mapEmployee(e);
  // what a staff member sees about themselves: no bank or tax details
  res.json({
    data: {
      id: m.id,
      empCode: m.empCode,
      displayName: m.displayName,
      position: m.position,
      branchName: m.branchName,
      startDate: m.startDate,
      annualLeaveDays: m.annualLeaveDays,
    },
  });
});

module.exports = { router, ssoSettings, mapEmployee, loadEmployee, myEmployee };
