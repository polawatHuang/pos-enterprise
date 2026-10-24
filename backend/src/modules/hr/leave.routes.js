'use strict';

// ใบลา: a staff member (leave:request, linked to a staff record) asks for leave; a manager
// (leave:approve) or HR (hr:manage) approves or rejects. Approvers can also file for someone.

const express = require('express');
const { z } = require('zod');
const db = require('../../db/pool');
const { validate } = require('../../core/http');
const { audit } = require('../../core/audit');
const { badRequest, conflict, forbidden, notFound } = require('../../core/errors');
const { nextNumber } = require('../accounting/ledger.service');
const { localDate } = require('../../utils/dates');
const { myEmployee } = require('./employees.routes');

const router = express.Router();
const idParam = z.object({ id: z.coerce.number().int().positive() });
const TYPES = ['sick', 'personal', 'vacation', 'maternity', 'other'];
const isApprover = (user) => ['leave:approve', 'hr:manage'].some((p) => user.permissions.includes(p));

const SELECT = `SELECT l.*, DATE_FORMAT(l.start_date, '%Y-%m-%d') AS start_day, DATE_FORMAT(l.end_date, '%Y-%m-%d') AS end_day,
                       e.emp_code, e.title, e.full_name, e.position, d.full_name AS decided_by_name
                  FROM leave_requests l JOIN employees e ON e.id = l.employee_id LEFT JOIN users d ON d.id = l.decided_by`;

const map = (l) => ({
  id: l.id,
  leaveNo: l.leave_no,
  employeeId: l.employee_id,
  empCode: l.emp_code,
  employeeName: `${l.title ?? ''}${l.full_name}`,
  position: l.position,
  leaveType: l.leave_type,
  startDate: l.start_day,
  endDate: l.end_day,
  days: Number(l.days),
  reason: l.reason,
  status: l.status,
  requestedBy: l.requested_by,
  requestedAt: l.requested_at,
  decidedBy: l.decided_by_name ?? null,
  decidedAt: l.decided_at,
  rejectReason: l.reject_reason,
});

const dayCount = (from, to) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;

router.get(
  '/leave',
  validate({ query: z.object({ status: z.enum(['pending', 'approved', 'rejected', 'cancelled']).optional(), employeeId: z.coerce.number().int().positive().optional() }) }),
  async (req, res) => {
    const f = req.valid.query;
    let employeeId = f.employeeId ?? null;
    if (!isApprover(req.user)) {
      const me = await myEmployee(req.user);
      if (!me) return res.json({ data: [] });
      employeeId = me.id;
    }
    const rows = await db.query(
      `${SELECT} WHERE l.org_id = :orgId AND (:status IS NULL OR l.status = :status) AND (:emp IS NULL OR l.employee_id = :emp)
       ORDER BY l.start_date DESC, l.id DESC LIMIT 300`,
      { orgId: req.user.orgId, status: f.status ?? null, emp: employeeId },
    );
    res.json({ data: rows.map(map) });
  },
);

/** Days taken this year by type, against the vacation quota. */
router.get(
  '/leave/summary',
  validate({ query: z.object({ employeeId: z.coerce.number().int().positive().optional(), year: z.coerce.number().int().min(2000).max(2100).optional() }) }),
  async (req, res) => {
    const f = req.valid.query;
    const year = f.year ?? Number(localDate().slice(0, 4));
    let emp;
    if (f.employeeId && isApprover(req.user)) emp = await db.one('SELECT * FROM employees WHERE id = :id AND org_id = :orgId', { id: f.employeeId, orgId: req.user.orgId });
    else emp = await myEmployee(req.user);
    if (!emp) return res.json({ data: null });
    const rows = await db.query(
      `SELECT leave_type, SUM(days) AS days FROM leave_requests
        WHERE employee_id = :emp AND status = 'approved' AND YEAR(start_date) = :year GROUP BY leave_type`,
      { emp: emp.id, year },
    );
    const used = Object.fromEntries(TYPES.map((t) => [t, 0]));
    for (const r of rows) used[r.leave_type] = Number(r.days);
    res.json({ data: { employeeId: emp.id, year, used, vacationQuota: Number(emp.annual_leave_days), vacationLeft: Number(emp.annual_leave_days) - used.vacation } });
  },
);

router.post(
  '/leave',
  validate({
    body: z
      .object({
        employeeId: z.number().int().positive().optional(),
        leaveType: z.enum(TYPES),
        startDate: z.iso.date(),
        endDate: z.iso.date(),
        days: z.coerce.number().min(0.5).max(365).optional(),
        reason: z.string().trim().max(255).nullable().optional(),
      })
      .refine((b) => b.endDate >= b.startDate, { message: 'วันสิ้นสุดต้องไม่ก่อนวันเริ่ม', path: ['endDate'] }),
  }),
  async (req, res) => {
    const b = req.valid.body;
    const { orgId, id: userId } = req.user;
    let employeeId;
    if (b.employeeId && b.employeeId !== (await myEmployee(req.user))?.id) {
      if (!isApprover(req.user)) throw forbidden('ยื่นใบลาแทนคนอื่นได้เฉพาะผู้อนุมัติ');
      const e = await db.one("SELECT id FROM employees WHERE id = :id AND org_id = :orgId AND status = 'active'", { id: b.employeeId, orgId });
      if (!e) throw notFound('ไม่พบพนักงาน');
      employeeId = e.id;
    } else {
      if (!req.user.permissions.includes('leave:request') && !isApprover(req.user)) throw forbidden('ต้องมีสิทธิ์ยื่นใบลา');
      const me = await myEmployee(req.user);
      if (!me) throw badRequest('บัญชีนี้ยังไม่ได้ผูกกับข้อมูลพนักงาน — ให้ฝ่ายบุคคลผูกบัญชีในหน้าพนักงานก่อน');
      employeeId = me.id;
    }
    const days = b.days ?? dayCount(b.startDate, b.endDate);
    if (days > dayCount(b.startDate, b.endDate)) throw badRequest('จำนวนวันลามากกว่าช่วงวันที่');
    const id = await db.tx(async (conn) => {
      const [[overlap]] = await conn.query(
        `SELECT leave_no FROM leave_requests WHERE employee_id = :emp AND status IN ('pending','approved')
            AND start_date <= :end AND end_date >= :start LIMIT 1`,
        { emp: employeeId, start: b.startDate, end: b.endDate },
      );
      if (overlap) throw conflict(`ช่วงนี้มีใบลา ${overlap.leave_no} อยู่แล้ว`);
      const no = await nextNumber(conn, orgId, 'leave_request', b.startDate);
      const [ins] = await conn.query(
        `INSERT INTO leave_requests (org_id, leave_no, employee_id, leave_type, start_date, end_date, days, reason, requested_by)
         VALUES (:orgId, :no, :emp, :type, :start, :end, :days, :reason, :userId)`,
        { orgId, no, emp: employeeId, type: b.leaveType, start: b.startDate, end: b.endDate, days, reason: b.reason ?? null, userId },
      );
      return ins.insertId;
    });
    audit(req, 'leave.request', 'leave_request', id, { type: b.leaveType, days });
    res.status(201).json({ data: map(await db.one(`${SELECT} WHERE l.id = :id`, { id })) });
  },
);

async function decide(req, id, status, extra = {}) {
  const r = await db.query(
    `UPDATE leave_requests SET status = :status, decided_by = :userId, decided_at = UTC_TIMESTAMP(), reject_reason = :reason
      WHERE id = :id AND org_id = :orgId AND status = 'pending'`,
    { id, orgId: req.user.orgId, userId: req.user.id, status, reason: extra.reason ?? null },
  );
  if (!r.affectedRows) throw conflict('ใบลานี้ดำเนินการไปแล้ว หรือไม่พบ');
  audit(req, `leave.${status}`, 'leave_request', id, extra);
  return map(await db.one(`${SELECT} WHERE l.id = :id`, { id }));
}

router.post('/leave/:id/approve', validate({ params: idParam }), async (req, res) => {
  if (!isApprover(req.user)) throw forbidden('ต้องมีสิทธิ์อนุมัติใบลา');
  res.json({ data: await decide(req, req.valid.params.id, 'approved') });
});

router.post('/leave/:id/reject', validate({ params: idParam, body: z.object({ reason: z.string().trim().min(1).max(255) }) }), async (req, res) => {
  if (!isApprover(req.user)) throw forbidden('ต้องมีสิทธิ์อนุมัติใบลา');
  res.json({ data: await decide(req, req.valid.params.id, 'rejected', { reason: req.valid.body.reason }) });
});

router.post('/leave/:id/cancel', validate({ params: idParam }), async (req, res) => {
  const { id } = req.valid.params;
  const l = await db.one('SELECT employee_id, status FROM leave_requests WHERE id = :id AND org_id = :orgId', { id, orgId: req.user.orgId });
  if (!l) throw notFound('ไม่พบใบลา');
  const me = await myEmployee(req.user);
  if (Number(l.employee_id) !== me?.id && !isApprover(req.user)) throw forbidden('ยกเลิกได้เฉพาะใบลาของตัวเอง');
  if (l.status !== 'pending' && !(l.status === 'approved' && isApprover(req.user))) throw conflict('ยกเลิกได้เฉพาะใบลาที่รออนุมัติ');
  await db.query("UPDATE leave_requests SET status = 'cancelled' WHERE id = :id", { id });
  audit(req, 'leave.cancel', 'leave_request', id);
  res.json({ data: map(await db.one(`${SELECT} WHERE l.id = :id`, { id })) });
});

module.exports = { router };
