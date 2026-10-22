'use strict';

const express = require('express');
const { z } = require('zod');
const db = require('../../db/pool');
const env = require('../../config/env');
const { validate } = require('../../core/http');
const { authenticate, requirePermission } = require('../../core/auth');
const { audit } = require('../../core/audit');
const { badRequest, conflict, forbidden, notFound } = require('../../core/errors');
const { applyMovement, getWarehouse } = require('./inventory.service');
const { consumeFefo, parseAlloc } = require('./lots');
const { postJournal, ACC } = require('../accounting/ledger.service');
const { localDate } = require('../../utils/dates');

/**
 * Employee welfare withdrawal (เบิกสินค้าสวัสดิการพนักงาน):
 *   staff (welfare:request) asks for products from a warehouse -> a manager (inventory:approve, never
 *   for their own request unless settings:manage) approves -> stock leaves FEFO as a 'welfare'
 *   movement at cost and the journal books Dr 5250 ค่าสวัสดิการพนักงาน / Cr 1300 สินค้าคงเหลือ.
 * Reject / cancel never touch stock. Each employee has a monthly limit valued at cost
 * (users.welfare_monthly_limit, else settings welfare.monthly_limit; 0 = unlimited). Usage counts
 * pending + approved requests of the Thai-local month and is checked at request time and on approval.
 */
const router = express.Router();
router.use(authenticate);

const LIMIT_KEY = 'welfare.monthly_limit';
const COUNTED = ['pending', 'approved'];
const r2 = (n) => Math.round(Number(n) * 100) / 100;
const r3 = (n) => Math.round(Number(n) * 1000) / 1000;
const baht = (n) => `฿${Number(n).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const idParam = z.object({ id: z.coerce.number().int().positive() });
const monthSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'เดือนต้องเป็น YYYY-MM');

const has = (req, p) => req.user.permissions.includes(p);
/** Sees and requests for every employee (stock staff, approvers, owners); others only for themselves. */
const seesAll = (req) => has(req, 'inventory:write') || has(req, 'inventory:approve') || has(req, 'settings:manage');

/** Anyone who requests, approves or administers welfare withdrawals. */
function requireWelfareAccess(req, res, next) {
  if (['welfare:request', 'inventory:write', 'inventory:approve', 'settings:manage'].some((p) => has(req, p))) return next();
  return next(forbidden('ต้องมีสิทธิ์: welfare:request'));
}

/** Current business month (YYYY-MM) in APP_TZ_OFFSET. */
const thisMonth = () => localDate().slice(0, 7);
/** Business month of a stored UTC instant. */
const monthOf = (at) => localDate(at instanceof Date ? at : new Date(at)).slice(0, 7);

/** UTC instants bounding a local month, so the requested_at index can be used. */
function monthBounds(month) {
  const [y, m] = month.split('-').map(Number);
  const next = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
  const at = (ym) => new Date(`${ym}-01T00:00:00${env.APP_TZ_OFFSET}`);
  return { from: at(month), to: at(next) };
}

/** Query runner on a transaction connection, or the pool. */
const runner = (conn) => (conn ? (sql, p) => conn.query(sql, p).then(([rows]) => rows) : db.query);

async function defaultLimit(orgId, conn = null) {
  const [row] = await runner(conn)('SELECT value FROM settings WHERE org_id = :orgId AND setting_key = :key', { orgId, key: LIMIT_KEY });
  if (!row || row.value == null) return 0;
  let v = row.value;
  if (typeof v === 'string') {
    try {
      v = JSON.parse(v);
    } catch {
      v = 0;
    }
  }
  return Math.max(Number(v) || 0, 0);
}

/** Effective monthly limit: per-user override, else the org default. 0 = unlimited. */
const effectiveLimit = (override, fallback) => (override == null ? fallback : Number(override));

/** Sum of pending + approved request costs per employee in a month. */
async function usage(orgId, month, { employeeId = null, excludeId = null, conn = null } = {}) {
  const { from, to } = monthBounds(month);
  const rows = await runner(conn)(
    `SELECT employee_id, SUM(total_cost) AS used,
            SUM(IF(status = 'approved', total_cost, 0)) AS approved, SUM(IF(status = 'pending', total_cost, 0)) AS pending,
            COUNT(*) AS requests
       FROM welfare_requests
      WHERE org_id = :orgId AND status IN (:counted) AND requested_at >= :from AND requested_at < :to
        AND (:employeeId IS NULL OR employee_id = :employeeId) AND (:excludeId IS NULL OR id <> :excludeId)
      GROUP BY employee_id`,
    { orgId, counted: COUNTED, from, to, employeeId, excludeId },
  );
  return new Map(
    rows.map((r) => [Number(r.employee_id), { used: r2(r.used), approved: r2(r.approved), pending: r2(r.pending), requests: Number(r.requests) }]),
  );
}

/**
 * Throws 400 when `amount` on top of the month's usage would exceed the employee's limit.
 * Locks the employee row so two requests for the same person cannot both slip under the limit.
 */
async function checkLimit(conn, { orgId, employeeId, month, amount, excludeId = null }) {
  const [[emp]] = await conn.query('SELECT id, full_name, welfare_monthly_limit FROM users WHERE id = :employeeId AND org_id = :orgId FOR UPDATE', {
    employeeId,
    orgId,
  });
  if (!emp) throw notFound('ไม่พบพนักงาน');
  const limit = effectiveLimit(emp.welfare_monthly_limit, await defaultLimit(orgId, conn));
  if (!(limit > 0)) return { limit: 0, used: null };
  const used = (await usage(orgId, month, { employeeId, excludeId, conn })).get(Number(employeeId))?.used ?? 0;
  if (r2(used + amount) > limit + 1e-9) {
    const left = Math.max(r2(limit - used), 0);
    throw badRequest(
      `เกินวงเงินสวัสดิการเดือนนี้ของ ${emp.full_name}: วงเงิน ${baht(limit)} ใช้ไปแล้ว ${baht(used)} คงเหลือ ${baht(left)} แต่รายการนี้ ${baht(amount)}`,
      { limit, used, remaining: left, amount },
    );
  }
  return { limit, used };
}

/* ------------------------------------------------------------------ reads */

const SELECT_REQUEST = `
  SELECT r.*, w.name AS warehouse_name, e.full_name AS employee_name, rb.full_name AS requested_by_name, ab.full_name AS approved_by_name
    FROM welfare_requests r
    JOIN warehouses w ON w.id = r.warehouse_id
    JOIN users e ON e.id = r.employee_id
    LEFT JOIN users rb ON rb.id = r.requested_by
    LEFT JOIN users ab ON ab.id = r.approved_by`;

async function withItems(rows) {
  if (!rows.length) return [];
  const items = await db.query(
    `SELECT i.id, i.request_id, i.product_id, i.quantity, i.unit_cost, i.lot_allocations, p.sku, p.name, p.unit
       FROM welfare_request_items i JOIN products p ON p.id = i.product_id
      WHERE i.request_id IN (:ids) ORDER BY i.id`,
    { ids: rows.map((r) => r.id) },
  );
  const byReq = new Map();
  for (const i of items) {
    const list = byReq.get(i.request_id) ?? [];
    list.push({
      id: i.id,
      productId: i.product_id,
      sku: i.sku,
      name: i.name,
      unit: i.unit,
      quantity: Number(i.quantity),
      unitCost: Number(i.unit_cost),
      lineCost: r2(Number(i.quantity) * Number(i.unit_cost)),
      lots: parseAlloc(i.lot_allocations),
    });
    byReq.set(i.request_id, list);
  }
  return rows.map((r) => ({
    id: r.id,
    requestNo: r.request_no,
    status: r.status,
    warehouseId: r.warehouse_id,
    warehouseName: r.warehouse_name,
    employeeId: r.employee_id,
    employeeName: r.employee_name,
    note: r.note,
    totalCost: Number(r.total_cost),
    requestedBy: r.requested_by,
    requestedByName: r.requested_by_name ?? null,
    requestedAt: r.requested_at,
    approvedBy: r.approved_by,
    approvedByName: r.approved_by_name ?? null,
    approvedAt: r.approved_at,
    rejectReason: r.reject_reason,
    items: byReq.get(r.id) ?? [],
  }));
}

async function loadOne(orgId, id) {
  const rows = await db.query(`${SELECT_REQUEST} WHERE r.id = :id AND r.org_id = :orgId`, { id, orgId });
  if (!rows.length) throw notFound('ไม่พบคำขอเบิก');
  return (await withItems(rows))[0];
}

/** Warehouses to withdraw from (requesters may not hold inventory:read). */
router.get('/warehouses', requireWelfareAccess, async (req, res) => {
  const rows = await db.query(
    `SELECT w.id, w.name, w.branch_id AS branchId, b.name AS branchName FROM warehouses w LEFT JOIN branches b ON b.id = w.branch_id
      WHERE w.org_id = :orgId ORDER BY w.id`,
    { orgId: req.user.orgId },
  );
  res.json({ data: rows });
});

/** Employees who can receive welfare, with this month's usage against their limit. */
router.get('/employees', requireWelfareAccess, validate({ query: z.object({ month: monthSchema.optional() }) }), async (req, res) => {
  const orgId = req.user.orgId;
  const month = req.valid.query.month ?? thisMonth();
  const rows = await db.query(
    `SELECT u.id, u.full_name, u.welfare_monthly_limit, b.name AS branch_name
       FROM users u LEFT JOIN branches b ON b.id = u.branch_id
      WHERE u.org_id = :orgId AND u.status = 'active' AND (:self IS NULL OR u.id = :self)
      ORDER BY u.full_name`,
    { orgId, self: seesAll(req) ? null : req.user.id },
  );
  const fallback = await defaultLimit(orgId);
  const used = await usage(orgId, month);
  res.json({
    data: rows.map((u) => {
      const limit = effectiveLimit(u.welfare_monthly_limit, fallback);
      const usedThisMonth = used.get(Number(u.id))?.used ?? 0;
      return {
        id: u.id,
        name: u.full_name,
        branchName: u.branch_name ?? null,
        limit,
        limitOverride: u.welfare_monthly_limit == null ? null : Number(u.welfare_monthly_limit),
        usedThisMonth,
        remaining: limit > 0 ? Math.max(r2(limit - usedThisMonth), 0) : null,
      };
    }),
  });
});

router.get(
  '/',
  requireWelfareAccess,
  validate({
    query: z.object({
      status: z.enum(['pending', 'approved', 'rejected', 'cancelled']).optional(),
      month: monthSchema.optional(),
      employeeId: z.coerce.number().int().positive().optional(),
      limit: z.coerce.number().int().min(1).max(500).default(200),
    }),
  }),
  async (req, res) => {
    const q = req.valid.query;
    const bounds = q.month ? monthBounds(q.month) : null;
    const rows = await db.query(
      `${SELECT_REQUEST}
        WHERE r.org_id = :orgId
          AND (:status IS NULL OR r.status = :status)
          AND (:employeeId IS NULL OR r.employee_id = :employeeId)
          AND (:from IS NULL OR (r.requested_at >= :from AND r.requested_at < :to))
          AND (:self IS NULL OR r.employee_id = :self OR r.requested_by = :self)
        ORDER BY r.requested_at DESC, r.id DESC
        LIMIT :limit`,
      {
        orgId: req.user.orgId,
        status: q.status ?? null,
        employeeId: q.employeeId ?? null,
        from: bounds?.from ?? null,
        to: bounds?.to ?? null,
        self: seesAll(req) ? null : req.user.id,
        limit: q.limit,
      },
    );
    res.json({ data: await withItems(rows) });
  },
);

/** Per-employee usage of a month against the limit (everyone with a limit or any request). */
router.get('/summary', requireWelfareAccess, validate({ query: z.object({ month: monthSchema.optional() }) }), async (req, res) => {
  const orgId = req.user.orgId;
  const month = req.valid.query.month ?? thisMonth();
  const self = seesAll(req) ? null : req.user.id;
  const fallback = await defaultLimit(orgId);
  const used = await usage(orgId, month, { employeeId: self });
  const users = await db.query(
    `SELECT u.id, u.full_name, u.status, u.welfare_monthly_limit, b.name AS branch_name
       FROM users u LEFT JOIN branches b ON b.id = u.branch_id
      WHERE u.org_id = :orgId AND (:self IS NULL OR u.id = :self) ORDER BY u.full_name`,
    { orgId, self },
  );
  const rows = users
    // disabled staff only matter when they still used welfare that month
    .filter((u) => u.status === 'active' || used.has(Number(u.id)))
    .map((u) => {
      const limit = effectiveLimit(u.welfare_monthly_limit, fallback);
      const s = used.get(Number(u.id)) ?? { used: 0, approved: 0, pending: 0, requests: 0 };
      return {
        employeeId: u.id,
        name: u.full_name,
        branchName: u.branch_name ?? null,
        limit,
        approved: s.approved,
        pending: s.pending,
        used: s.used,
        requests: s.requests,
        remaining: limit > 0 ? Math.max(r2(limit - s.used), 0) : null,
        overLimit: limit > 0 && s.used > limit + 1e-9,
      };
    })
    .sort((a, b) => b.used - a.used || a.name.localeCompare(b.name, 'th'));
  res.json({
    data: {
      month,
      defaultLimit: fallback,
      totalApproved: r2(rows.reduce((s, r) => s + r.approved, 0)),
      totalPending: r2(rows.reduce((s, r) => s + r.pending, 0)),
      employees: rows,
    },
  });
});

/* -------------------------------------------------------------- settings */

router.get('/settings', requirePermission('settings:manage'), async (req, res) => {
  const orgId = req.user.orgId;
  const users = await db.query(
    `SELECT u.id, u.full_name, u.email, u.welfare_monthly_limit, b.name AS branch_name
       FROM users u LEFT JOIN branches b ON b.id = u.branch_id
      WHERE u.org_id = :orgId AND u.status = 'active' ORDER BY u.full_name`,
    { orgId },
  );
  res.json({
    data: {
      defaultLimit: await defaultLimit(orgId),
      users: users.map((u) => ({
        userId: u.id,
        name: u.full_name,
        email: u.email,
        branchName: u.branch_name ?? null,
        limit: u.welfare_monthly_limit == null ? null : Number(u.welfare_monthly_limit),
      })),
    },
  });
});

const money = z.coerce.number().min(0).max(9_999_999_999);

router.put(
  '/limits',
  requirePermission('settings:manage'),
  validate({
    body: z.object({
      defaultLimit: money.optional(),
      users: z.array(z.object({ userId: z.number().int().positive(), limit: money.nullable() })).max(1000).default([]),
    }),
  }),
  async (req, res) => {
    const orgId = req.user.orgId;
    const b = req.valid.body;
    await db.tx(async (conn) => {
      if (b.defaultLimit !== undefined) {
        await conn.query(
          `INSERT INTO settings (org_id, setting_key, value) VALUES (:orgId, :key, :value)
           ON DUPLICATE KEY UPDATE value = VALUES(value)`,
          { orgId, key: LIMIT_KEY, value: JSON.stringify(r2(b.defaultLimit)) },
        );
      }
      for (const u of b.users) {
        const [r] = await conn.query('UPDATE users SET welfare_monthly_limit = :limit WHERE id = :userId AND org_id = :orgId', {
          limit: u.limit == null ? null : r2(u.limit),
          userId: u.userId,
          orgId,
        });
        if (!r.affectedRows) {
          const [[exists]] = await conn.query('SELECT id FROM users WHERE id = :userId AND org_id = :orgId', { userId: u.userId, orgId });
          if (!exists) throw notFound(`ไม่พบผู้ใช้ #${u.userId}`);
        }
      }
    });
    audit(req, 'welfare.limits', 'settings', LIMIT_KEY, { defaultLimit: b.defaultLimit, users: b.users });
    res.json({ data: { ok: true } });
  },
);

/* ----------------------------------------------------------------- flow */

router.post(
  '/',
  requireWelfareAccess,
  validate({
    body: z.object({
      employeeId: z.number().int().positive(),
      warehouseId: z.number().int().positive(),
      note: z.string().trim().max(255).optional(),
      items: z
        .array(
          z.object({
            productId: z.number().int().positive(),
            quantity: z.coerce.number().positive('จำนวนต้องมากกว่า 0').max(1_000_000),
          }),
        )
        .min(1, 'กรุณาเลือกสินค้าอย่างน้อย 1 รายการ')
        .max(100),
    }),
  }),
  async (req, res) => {
    const b = req.valid.body;
    const orgId = req.user.orgId;
    if (b.employeeId !== req.user.id && !has(req, 'inventory:write')) throw forbidden('ขอเบิกได้เฉพาะของตัวเอง');
    if (b.employeeId === req.user.id && !has(req, 'welfare:request') && !has(req, 'inventory:write')) throw forbidden('ต้องมีสิทธิ์: welfare:request');
    // The same product on two lines is one request line
    const lines = new Map();
    for (const i of b.items) lines.set(i.productId, r3((lines.get(i.productId) ?? 0) + i.quantity));

    const result = await db.tx(async (conn) => {
      await getWarehouse(conn, orgId, b.warehouseId);
      const [[emp]] = await conn.query("SELECT id, full_name, status FROM users WHERE id = :id AND org_id = :orgId", { id: b.employeeId, orgId });
      if (!emp) throw notFound('ไม่พบพนักงาน');
      if (emp.status !== 'active') throw badRequest(`บัญชีของ ${emp.full_name} ถูกปิดใช้งาน`);

      const items = [];
      for (const [productId, quantity] of lines) {
        const [[p]] = await conn.query(
          `SELECT p.id, p.name, p.cost, p.status, COALESCE(sl.quantity, 0) AS onhand
             FROM products p LEFT JOIN stock_levels sl ON sl.product_id = p.id AND sl.warehouse_id = :warehouseId AND sl.variant_id = 0
            WHERE p.id = :productId AND p.org_id = :orgId`,
          { productId, orgId, warehouseId: b.warehouseId },
        );
        if (!p) throw notFound(`ไม่พบสินค้า #${productId}`);
        if (Number(p.onhand) + 1e-9 < quantity) throw conflict(`สต๊อก "${p.name}" ไม่พอ (คงเหลือ ${r3(p.onhand)})`);
        items.push({ productId, quantity, unitCost: Number(p.cost) });
      }
      const total = r2(items.reduce((s, i) => s + r2(i.quantity * i.unitCost), 0));
      await checkLimit(conn, { orgId, employeeId: b.employeeId, month: thisMonth(), amount: total });

      const [ins] = await conn.query(
        `INSERT INTO welfare_requests (org_id, request_no, warehouse_id, employee_id, status, note, total_cost, requested_by, requested_at)
         VALUES (:orgId, :tmp, :warehouseId, :employeeId, 'pending', :note, :total, :userId, UTC_TIMESTAMP())`,
        {
          orgId,
          tmp: `TMP-${Date.now()}-${req.user.id}`,
          warehouseId: b.warehouseId,
          employeeId: b.employeeId,
          note: b.note || null,
          total,
          userId: req.user.id,
        },
      );
      const requestNo = `WF${String(ins.insertId).padStart(6, '0')}`;
      await conn.query('UPDATE welfare_requests SET request_no = :no WHERE id = :id', { no: requestNo, id: ins.insertId });
      for (const i of items) {
        await conn.query(
          'INSERT INTO welfare_request_items (request_id, product_id, quantity, unit_cost) VALUES (:requestId, :productId, :quantity, :unitCost)',
          { requestId: ins.insertId, ...i },
        );
      }
      return { id: ins.insertId, requestNo, total };
    });
    audit(req, 'welfare.request', 'welfare_request', result.id, {
      requestNo: result.requestNo,
      employeeId: b.employeeId,
      warehouseId: b.warehouseId,
      totalCost: result.total,
      items: [...lines].map(([productId, quantity]) => ({ productId, quantity })),
    });
    res.status(201).json({ data: await loadOne(orgId, result.id) });
  },
);

async function lockRequest(conn, orgId, id) {
  const [[r]] = await conn.query(
    `SELECT r.*, e.full_name AS employee_name FROM welfare_requests r JOIN users e ON e.id = r.employee_id
      WHERE r.id = :id AND r.org_id = :orgId FOR UPDATE`,
    { id, orgId },
  );
  if (!r) throw notFound('ไม่พบคำขอเบิก');
  return r;
}

const CLOSED = { approved: 'คำขอนี้อนุมัติแล้ว', rejected: 'คำขอนี้ถูกปฏิเสธแล้ว', cancelled: 'คำขอนี้ถูกยกเลิกแล้ว' };
const assertPending = (r) => {
  if (r.status !== 'pending') throw conflict(CLOSED[r.status] ?? 'คำขอนี้ปิดแล้ว');
};

/** Approve: stock out FEFO at current cost, 'welfare' movements, Dr 5250 / Cr 1300. */
router.post('/:id/approve', requirePermission('inventory:approve'), validate({ params: idParam }), async (req, res) => {
  const orgId = req.user.orgId;
  const result = await db.tx(async (conn) => {
    const r = await lockRequest(conn, orgId, req.valid.params.id);
    assertPending(r);
    const own = Number(r.employee_id) === req.user.id || Number(r.requested_by) === req.user.id;
    if (own && !has(req, 'settings:manage')) throw forbidden('อนุมัติคำขอเบิกของตัวเองไม่ได้ — ให้ผู้จัดการคนอื่นอนุมัติ');

    const [items] = await conn.query(
      `SELECT i.id, i.product_id, i.quantity, p.cost, p.name FROM welfare_request_items i JOIN products p ON p.id = i.product_id
        WHERE i.request_id = :id ORDER BY i.id`,
      { id: r.id },
    );
    // Valued at today's cost; the limit is re-checked with that value (the request's own month)
    const total = r2(items.reduce((s, i) => s + r2(Number(i.quantity) * Number(i.cost)), 0));
    await checkLimit(conn, { orgId, employeeId: r.employee_id, month: monthOf(r.requested_at), amount: total, excludeId: r.id });

    for (const i of items) {
      const qty = Number(i.quantity);
      const lots = await consumeFefo(conn, { warehouseId: r.warehouse_id, productId: i.product_id, qty });
      await applyMovement(conn, {
        orgId,
        warehouseId: r.warehouse_id,
        productId: i.product_id,
        quantity: -qty,
        type: 'welfare',
        unitCost: Number(i.cost),
        refType: 'welfare_request',
        refId: r.id,
        note: `เบิกสวัสดิการ ${r.request_no}: ${r.employee_name}`.slice(0, 255),
        userId: req.user.id,
      });
      await conn.query('UPDATE welfare_request_items SET unit_cost = :cost, lot_allocations = :lots WHERE id = :id', {
        cost: Number(i.cost),
        lots: lots.length ? JSON.stringify(lots) : null,
        id: i.id,
      });
    }
    const journal = await postJournal(conn, {
      orgId,
      date: localDate(),
      description: `เบิกสินค้าสวัสดิการพนักงาน ${r.request_no} (${r.employee_name})`,
      refType: 'welfare_request',
      refId: r.id,
      userId: req.user.id,
      lines: [
        { account: ACC.WELFARE, debit: total, memo: `สวัสดิการ ${r.employee_name}` },
        { account: ACC.INVENTORY, credit: total },
      ],
    });
    await conn.query(
      "UPDATE welfare_requests SET status = 'approved', total_cost = :total, approved_by = :userId, approved_at = UTC_TIMESTAMP() WHERE id = :id",
      { total, userId: req.user.id, id: r.id },
    );
    return { id: r.id, requestNo: r.request_no, employeeId: r.employee_id, totalCost: total, journalNo: journal?.entryNo ?? null };
  });
  audit(req, 'welfare.approve', 'welfare_request', result.id, result);
  res.json({ data: await loadOne(orgId, result.id) });
});

router.post(
  '/:id/reject',
  requirePermission('inventory:approve'),
  validate({ params: idParam, body: z.object({ reason: z.string().trim().min(1, 'กรุณาระบุเหตุผล').max(255) }) }),
  async (req, res) => {
    const orgId = req.user.orgId;
    const reason = req.valid.body.reason;
    const r = await db.tx(async (conn) => {
      const row = await lockRequest(conn, orgId, req.valid.params.id);
      assertPending(row);
      await conn.query(
        "UPDATE welfare_requests SET status = 'rejected', reject_reason = :reason, approved_by = :userId, approved_at = UTC_TIMESTAMP() WHERE id = :id",
        { reason, userId: req.user.id, id: row.id },
      );
      return row;
    });
    audit(req, 'welfare.reject', 'welfare_request', r.id, { requestNo: r.request_no, employeeId: r.employee_id, reason });
    res.json({ data: await loadOne(orgId, r.id) });
  },
);

/** The requester (or the employee it was for) withdraws a pending request. */
router.post('/:id/cancel', requireWelfareAccess, validate({ params: idParam }), async (req, res) => {
  const orgId = req.user.orgId;
  const r = await db.tx(async (conn) => {
    const row = await lockRequest(conn, orgId, req.valid.params.id);
    if (Number(row.requested_by) !== req.user.id && Number(row.employee_id) !== req.user.id) throw forbidden('ยกเลิกได้เฉพาะคำขอของตัวเอง');
    assertPending(row);
    await conn.query("UPDATE welfare_requests SET status = 'cancelled' WHERE id = :id", { id: row.id });
    return row;
  });
  audit(req, 'welfare.cancel', 'welfare_request', r.id, { requestNo: r.request_no, employeeId: r.employee_id });
  res.json({ data: await loadOne(orgId, r.id) });
});

module.exports = { router, monthBounds, effectiveLimit };
