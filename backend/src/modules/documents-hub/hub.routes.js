'use strict';

// ศูนย์รวมเอกสาร: one list of every document the business makes, wherever it is kept (sales and tax
// documents, purchase orders, goods receipts, transfers, counts, staff welfare requests, POS bills,
// income/expense records). Each source joins the list only when the user may read it; a row links
// back to the page that manages it.

const express = require('express');
const { z } = require('zod');
const db = require('../../db/pool');
const env = require('../../config/env');
const { validate } = require('../../core/http');
const { authenticate } = require('../../core/auth');

const router = express.Router();
router.use(authenticate);
const TZ = env.APP_TZ_OFFSET;
const localDay = (col) => `DATE(CONVERT_TZ(${col}, '+00:00', '${TZ}'))`;

const CATEGORIES = ['sales', 'purchase', 'stock', 'finance', 'hr'];
const has = (user, ...perms) => perms.some((p) => user.permissions.includes(p));

/**
 * Each source: who may see it and one SELECT with the shared columns
 * (source, id, type, category, doc_no, doc_date, party, amount, status, sort_at).
 * `day` / `no` / `party` name the columns the date range and search apply to.
 */
const SOURCES = [
  {
    key: 'documents',
    can: (u) => has(u, 'accounting:read'),
    sql: `SELECT 'document' AS source, d.id, d.doc_type AS type,
                 CASE WHEN d.doc_type IN ('wht_certificate','substitute_receipt') THEN 'finance' ELSE 'sales' END AS category,
                 d.doc_no, d.doc_date, d.party_name AS party,
                 CASE WHEN d.doc_type = 'wht_certificate' THEN d.wht_amount ELSE d.total END AS amount, d.status, d.created_at AS sort_at
            FROM documents d WHERE d.org_id = :orgId AND d.doc_type NOT IN ('purchase_order','expense_voucher')`,
    day: 'd.doc_date',
    no: 'd.doc_no',
    party: 'd.party_name',
  },
  {
    key: 'purchase_orders',
    can: (u) => has(u, 'inventory:read', 'purchasing:write'),
    sql: `SELECT 'purchase_order' AS source, po.id, 'purchase_order' AS type, 'purchase' AS category, po.po_no AS doc_no, po.order_date AS doc_date,
                 s.name AS party, po.total AS amount, po.status, po.created_at AS sort_at
            FROM purchase_orders po LEFT JOIN suppliers s ON s.id = po.supplier_id WHERE po.org_id = :orgId`,
    day: 'po.order_date',
    no: 'po.po_no',
    party: 's.name',
  },
  {
    key: 'purchase_requests',
    can: (u) => has(u, 'inventory:read', 'inventory:write', 'purchasing:write'),
    sql: `SELECT 'purchase_request' AS source, r.id, 'purchase_request' AS type, 'purchase' AS category, r.pr_no AS doc_no,
                 ${localDay('r.requested_at')} AS doc_date, COALESCE(s.name, w.name) AS party,
                 (SELECT SUM(i.quantity * COALESCE(i.est_unit_cost, p.cost)) FROM purchase_request_items i JOIN products p ON p.id = i.product_id
                   WHERE i.request_id = r.id) AS amount, r.status, r.requested_at AS sort_at
            FROM purchase_requests r JOIN warehouses w ON w.id = r.warehouse_id LEFT JOIN suppliers s ON s.id = r.supplier_id
           WHERE r.org_id = :orgId`,
    day: localDay('r.requested_at'),
    no: 'r.pr_no',
    party: 'COALESCE(s.name, w.name)',
  },
  {
    key: 'supplier_bills',
    can: (u) => has(u, 'accounting:read'),
    sql: `SELECT 'supplier_bill' AS source, b.id, IF(b.kind = 'credit_note', 'supplier_credit', 'supplier_bill') AS type, 'purchase' AS category,
                 b.bill_no AS doc_no, b.bill_date AS doc_date, s.name AS party, b.total AS amount, b.status, b.created_at AS sort_at
            FROM supplier_bills b JOIN suppliers s ON s.id = b.supplier_id WHERE b.org_id = :orgId`,
    day: 'b.bill_date',
    no: "CONCAT(b.bill_no, ' ', COALESCE(b.supplier_doc_no, ''))",
    party: 's.name',
  },
  {
    key: 'payment_vouchers',
    can: (u) => has(u, 'accounting:read'),
    sql: `SELECT 'payment_voucher' AS source, v.id, 'payment_voucher' AS type, 'finance' AS category, v.pv_no AS doc_no, v.pay_date AS doc_date,
                 s.name AS party, v.net_paid AS amount, v.status, v.created_at AS sort_at
            FROM payment_vouchers v JOIN suppliers s ON s.id = v.supplier_id WHERE v.org_id = :orgId`,
    day: 'v.pay_date',
    no: 'v.pv_no',
    party: 's.name',
  },
  {
    key: 'petty_cash',
    can: (u) => has(u, 'accounting:read'),
    sql: `SELECT 'petty_cash_topup' AS source, t.id, 'petty_cash_topup' AS type, 'finance' AS category, t.topup_no AS doc_no, t.topup_date AS doc_date,
                 'เติมเงินสดย่อย' AS party, t.amount, t.status, t.created_at AS sort_at
            FROM petty_cash_topups t WHERE t.org_id = :orgId`,
    day: 't.topup_date',
    no: 't.topup_no',
    party: "'เงินสดย่อย'",
  },
  {
    key: 'stock_documents',
    can: (u) => has(u, 'inventory:read'),
    sql: `SELECT 'stock_document' AS source, sd.id, sd.doc_type AS type,
                 CASE WHEN sd.doc_type = 'goods_receipt' THEN 'purchase' ELSE 'stock' END AS category,
                 sd.doc_no, sd.doc_date, COALESCE(s.name, w.name) AS party, sd.total_cost AS amount, 'done' AS status, sd.created_at AS sort_at
            FROM stock_documents sd JOIN warehouses w ON w.id = sd.warehouse_id LEFT JOIN suppliers s ON s.id = sd.supplier_id
           WHERE sd.org_id = :orgId`,
    day: 'sd.doc_date',
    no: 'sd.doc_no',
    party: 'COALESCE(s.name, w.name)',
  },
  {
    key: 'stock_transfers',
    can: (u) => has(u, 'inventory:read'),
    sql: `SELECT 'stock_transfer' AS source, t.id, 'stock_transfer' AS type, 'stock' AS category, t.transfer_no AS doc_no,
                 ${localDay('t.shipped_at')} AS doc_date, CONCAT(wf.name, ' → ', wt.name) AS party, NULL AS amount, t.status, t.shipped_at AS sort_at
            FROM stock_transfers t JOIN warehouses wf ON wf.id = t.from_warehouse_id JOIN warehouses wt ON wt.id = t.to_warehouse_id
           WHERE t.org_id = :orgId`,
    day: localDay('t.shipped_at'),
    no: 't.transfer_no',
    party: "CONCAT(wf.name, ' ', wt.name)",
  },
  {
    key: 'stock_counts',
    can: (u) => has(u, 'inventory:read', 'inventory:count'),
    sql: `SELECT 'stock_count' AS source, c.id, 'stock_count' AS type, 'stock' AS category, c.count_no AS doc_no,
                 ${localDay('c.created_at')} AS doc_date, w.name AS party, NULL AS amount, c.status, c.created_at AS sort_at
            FROM stock_counts c JOIN warehouses w ON w.id = c.warehouse_id WHERE c.org_id = :orgId`,
    day: localDay('c.created_at'),
    no: 'c.count_no',
    party: 'w.name',
  },
  {
    key: 'welfare',
    can: (u) => has(u, 'inventory:write', 'inventory:approve', 'settings:manage'),
    sql: `SELECT 'welfare' AS source, r.id, 'welfare' AS type, 'hr' AS category, r.request_no AS doc_no,
                 ${localDay('r.requested_at')} AS doc_date, u.full_name AS party, r.total_cost AS amount, r.status, r.requested_at AS sort_at
            FROM welfare_requests r LEFT JOIN users u ON u.id = r.employee_id WHERE r.org_id = :orgId`,
    day: localDay('r.requested_at'),
    no: 'r.request_no',
    party: 'u.full_name',
  },
  {
    key: 'payroll',
    can: (u) => has(u, 'hr:manage'),
    sql: `SELECT 'payroll_run' AS source, r.id, 'payroll_run' AS type, 'hr' AS category, r.run_no AS doc_no, r.pay_date AS doc_date,
                 CONCAT('เงินเดือน ', r.period) AS party, r.total_net AS amount, r.status, r.created_at AS sort_at
            FROM payroll_runs r WHERE r.org_id = :orgId`,
    day: 'r.pay_date',
    no: 'r.run_no',
    party: "CONCAT('เงินเดือน ', r.period)",
  },
  {
    key: 'leave',
    can: (u) => has(u, 'hr:manage', 'leave:approve'),
    sql: `SELECT 'leave_request' AS source, l.id, 'leave_request' AS type, 'hr' AS category, l.leave_no AS doc_no, l.start_date AS doc_date,
                 CONCAT(COALESCE(e.title, ''), e.full_name) AS party, NULL AS amount, l.status, l.requested_at AS sort_at
            FROM leave_requests l JOIN employees e ON e.id = l.employee_id WHERE l.org_id = :orgId`,
    day: 'l.start_date',
    no: 'l.leave_no',
    party: 'e.full_name',
  },
  {
    key: 'transactions',
    can: (u) => has(u, 'accounting:read'),
    sql: `SELECT 'transaction' AS source, x.id, x.type, 'finance' AS category, CONCAT(IF(x.type = 'income', 'IN-', 'EX-'), x.id) AS doc_no,
                 x.txn_date AS doc_date, COALESCE(x.counterparty, x.category) AS party, x.amount + x.vat_amount AS amount, x.status, x.created_at AS sort_at
            FROM transactions x WHERE x.org_id = :orgId`,
    day: 'x.txn_date',
    no: "CONCAT(IF(x.type = 'income', 'IN-', 'EX-'), x.id)",
    party: 'COALESCE(x.counterparty, x.category, x.description)',
  },
  {
    key: 'pos_returns',
    can: (u) => has(u, 'pos:manage', 'accounting:read'),
    sql: `SELECT 'pos_return' AS source, r.order_id AS id, 'pos_return' AS type, 'sales' AS category, r.return_no AS doc_no,
                 ${localDay('r.created_at')} AS doc_date, c.name AS party, r.refund_amount AS amount, IF(r.voided_at IS NULL, 'done', 'void') AS status,
                 r.created_at AS sort_at
            FROM sales_returns r JOIN sales_orders o ON o.id = r.order_id LEFT JOIN customers c ON c.id = o.customer_id
           WHERE r.org_id = :orgId`,
    day: localDay('r.created_at'),
    no: 'r.return_no',
    party: 'c.name',
  },
  {
    key: 'pos_sales',
    optional: true, // hundreds a day: only when asked for
    can: (u) => has(u, 'pos:manage', 'accounting:read'),
    sql: `SELECT 'pos_sale' AS source, o.id, 'pos_sale' AS type, 'sales' AS category, o.order_no AS doc_no,
                 ${localDay('o.ordered_at')} AS doc_date, c.name AS party, o.total AS amount, o.status, o.ordered_at AS sort_at
            FROM sales_orders o LEFT JOIN customers c ON c.id = o.customer_id WHERE o.org_id = :orgId`,
    day: localDay('o.ordered_at'),
    // indexed time range first: the day filter on its own cannot use idx_so_time
    range: 'o.ordered_at',
    no: 'o.order_no',
    party: 'c.name',
  },
];

const query = z.object({
  category: z.enum(CATEGORIES).optional(),
  type: z.string().trim().max(40).optional(),
  status: z.string().trim().max(20).optional(),
  q: z.string().trim().max(100).optional(),
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
  includePos: z.enum(['0', '1']).default('0'),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(30),
});

/** Every source this user may read, with the date range and search pushed inside each SELECT. */
function unionFor(user, f) {
  const parts = SOURCES.filter((s) => s.can(user) && (!s.optional || f.includePos === '1')).map((s) => {
    const where = [];
    if (f.from) where.push(`${s.day} >= :from`);
    if (f.to) where.push(`${s.day} <= :to`);
    if (s.range && f.from) where.push(`${s.range} >= CONVERT_TZ(:from, '${TZ}', '+00:00') - INTERVAL 1 DAY`);
    if (s.range && f.to) where.push(`${s.range} < CONVERT_TZ(:to, '${TZ}', '+00:00') + INTERVAL 2 DAY`);
    if (f.q) where.push(`(${s.no} LIKE :q OR ${s.party} LIKE :q)`);
    return `(${s.sql}${where.length ? ` AND ${where.join(' AND ')}` : ''})`;
  });
  return parts.length ? parts.join('\nUNION ALL\n') : null;
}

router.get('/hub', validate({ query }), async (req, res) => {
  const f = req.valid.query;
  const union = unionFor(req.user, f);
  if (!union) return res.json({ data: [], meta: { page: 1, pageSize: f.pageSize, total: 0, counts: {}, sources: [] } });
  const params = {
    orgId: req.user.orgId,
    from: f.from ?? null,
    to: f.to ?? null,
    q: f.q ? `%${f.q}%` : null,
    category: f.category ?? null,
    type: f.type ?? null,
    status: f.status ?? null,
    limit: f.pageSize,
    offset: (f.page - 1) * f.pageSize,
  };
  const filter = `(:category IS NULL OR h.category = :category) AND (:type IS NULL OR h.type = :type) AND (:status IS NULL OR h.status = :status)`;
  const [rows, total, counts] = await Promise.all([
    db.query(
      `SELECT h.*, DATE_FORMAT(h.doc_date, '%Y-%m-%d') AS day FROM (${union}) h WHERE ${filter}
        ORDER BY h.doc_date DESC, h.sort_at DESC, h.id DESC LIMIT :limit OFFSET :offset`,
      params,
    ),
    db.one(`SELECT COUNT(*) AS n FROM (${union}) h WHERE ${filter}`, params),
    // tab badges: the same search and dates, every category
    db.query(`SELECT h.category, COUNT(*) AS n FROM (${union}) h WHERE (:type IS NULL OR h.type = :type) GROUP BY h.category`, params),
  ]);
  res.json({
    data: rows.map((r) => ({
      source: r.source,
      id: Number(r.id),
      type: r.type,
      category: r.category,
      docNo: r.doc_no,
      docDate: r.day,
      party: r.party ?? null,
      amount: r.amount == null ? null : Number(r.amount),
      status: r.status,
    })),
    meta: {
      page: f.page,
      pageSize: f.pageSize,
      total: Number(total.n),
      counts: Object.fromEntries(counts.map((c) => [c.category, Number(c.n)])),
      // which kinds of documents this user can see (the page hides the rest of its menus)
      sources: SOURCES.filter((s) => s.can(req.user)).map((s) => s.key),
    },
  });
});

module.exports = { router, SOURCES };
