'use strict';

const express = require('express');
const { z } = require('zod');
const db = require('../../db/pool');
const env = require('../../config/env');
const { validate } = require('../../core/http');
const { authenticate } = require('../../core/auth');
const { audit } = require('../../core/audit');
const { conflict, forbidden, notFound, unauthorized } = require('../../core/errors');
const { getOrder } = require('../pos/pos.service');

/**
 * Customers (CRM): one profile per buyer with what they bought (sales_orders) and where they talk
 * to us (conversations). Totals are computed from the orders themselves, so they stay right even
 * for orders imported or voided outside the POS counters on the customers row.
 */
const router = express.Router();

// No dedicated permission code: anyone who sells, chats or does the books may look customers up.
const READ = ['pos:sell', 'inbox:read', 'accounting:read'];
const WRITE = ['pos:sell', 'inbox:reply'];

/** Requires ANY of the listed permissions (requirePermission needs all of them). */
function requireAny(codes) {
  return (req, res, next) => {
    if (!req.user) return next(unauthorized());
    if (!codes.some((c) => req.user.permissions.includes(c))) return next(forbidden(`ต้องมีสิทธิ์อย่างใดอย่างหนึ่ง: ${codes.join(', ')}`));
    return next();
  };
}

router.use(authenticate, requireAny(READ));

const TZ = env.APP_TZ_OFFSET;
/** Orders that count as a purchase (unpaid, cancelled and refunded bills do not). */
const SOLD = "('paid','packed','shipped','completed')";
const OPEN_CHAT = "('open','pending')";

const splitTags = (v) =>
  String(v ?? '')
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);
const splitList = (v) => (v ? String(v).split(',').filter(Boolean) : []);
const likeEscape = (s) => s.replace(/[\\%_]/g, (m) => `\\${m}`);

/* ------------------------------------------------------------------ list */

const SORTS = {
  recent: 'COALESCE(s.last_at, c.created_at) DESC, c.id DESC',
  top: 'spent DESC, orders DESC, c.id DESC',
  orders: 'orders DESC, spent DESC, c.id DESC',
  name: 'c.name ASC, c.id ASC',
  newest: 'c.created_at DESC, c.id DESC',
};

const listQuery = z.object({
  q: z.string().trim().max(100).optional(),
  tag: z.string().trim().max(50).optional(),
  sort: z.enum(Object.keys(SORTS)).default('recent'),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  offset: z.coerce.number().int().min(0).max(1_000_000).default(0),
});

/** WHERE clause on customers c shared by the list, its count and the CSV export. */
function listWhere(orgId, { q, tag }) {
  const parts = ['c.org_id = :orgId'];
  const params = { orgId };
  if (q) {
    const digits = q.replace(/\D/g, '');
    params.like = `%${likeEscape(q)}%`;
    params.exact = q;
    params.digitsLike = `%${digits}%`;
    params.digits = digits;
    parts.push(
      `(c.name LIKE :like OR c.email LIKE :like OR c.member_no = :exact OR c.member_no LIKE :like
        OR (LENGTH(:digits) >= 3 AND REPLACE(REPLACE(c.phone, '-', ''), ' ', '') LIKE :digitsLike))`,
    );
  }
  if (tag) {
    params.tag = tag;
    parts.push("FIND_IN_SET(:tag, REPLACE(c.tags, ', ', ',')) > 0");
  }
  return { where: parts.join(' AND '), params };
}

const LIST_SELECT = `
  SELECT c.id, c.name, c.member_no, c.phone, c.email, c.tax_id, c.branch_no, c.address, c.tags, c.points,
         c.consent_marketing, c.created_at,
         COALESCE(s.spent, 0) AS spent, COALESCE(s.orders, 0) AS orders, s.first_at, s.last_at, s.channels,
         COALESCE(v.open_chats, 0) AS open_chats, COALESCE(v.chats, 0) AS chats, v.platforms
    FROM customers c
    LEFT JOIN (
      SELECT customer_id, SUM(total) AS spent, COUNT(*) AS orders, MIN(ordered_at) AS first_at, MAX(ordered_at) AS last_at,
             GROUP_CONCAT(DISTINCT channel) AS channels
        FROM sales_orders
       WHERE org_id = :orgId AND customer_id IS NOT NULL AND status IN ${SOLD}
       GROUP BY customer_id
    ) s ON s.customer_id = c.id
    LEFT JOIN (
      SELECT cv.customer_id, COUNT(*) AS chats, SUM(cv.status IN ${OPEN_CHAT}) AS open_chats, GROUP_CONCAT(DISTINCT ch.platform) AS platforms
        FROM conversations cv
        JOIN channels ch ON ch.id = cv.channel_id
       WHERE cv.org_id = :orgId AND cv.customer_id IS NOT NULL
       GROUP BY cv.customer_id
    ) v ON v.customer_id = c.id`;

const mapListRow = (r) => ({
  id: r.id,
  name: r.name,
  memberNo: r.member_no,
  phone: r.phone,
  email: r.email,
  tags: splitTags(r.tags),
  points: Number(r.points),
  consentMarketing: Boolean(r.consent_marketing),
  totalSpent: Number(r.spent),
  orderCount: Number(r.orders),
  avgBasket: Number(r.orders) ? Math.round((Number(r.spent) / Number(r.orders)) * 100) / 100 : 0,
  firstOrderAt: r.first_at,
  lastOrderAt: r.last_at,
  openChats: Number(r.open_chats),
  chatCount: Number(r.chats),
  salesChannels: splitList(r.channels),
  chatPlatforms: splitList(r.platforms),
  createdAt: r.created_at,
});

router.get('/', validate({ query: listQuery }), async (req, res) => {
  const f = req.valid.query;
  const { where, params } = listWhere(req.user.orgId, f);
  const [rows, count] = await Promise.all([
    db.query(`${LIST_SELECT} WHERE ${where} ORDER BY ${SORTS[f.sort]} LIMIT ${f.limit} OFFSET ${f.offset}`, params),
    db.one(`SELECT COUNT(*) AS n FROM customers c WHERE ${where}`, params),
  ]);
  res.json({ data: rows.map(mapListRow), meta: { total: Number(count.n), limit: f.limit, offset: f.offset } });
});

/** KPI cards and the tag chips of the list page (whole organisation, not the filtered list). */
router.get('/summary', async (req, res) => {
  const orgId = req.user.orgId;
  const monthStart = `DATE_FORMAT(CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', '${TZ}'), '%Y-%m-01')`;
  const [totals, buyers, tagRows] = await Promise.all([
    db.one(
      `SELECT COUNT(*) AS total,
              SUM(CONVERT_TZ(created_at, '+00:00', '${TZ}') >= ${monthStart}) AS new_this_month,
              SUM(consent_marketing = 1) AS consent
         FROM customers WHERE org_id = :orgId`,
      { orgId },
    ),
    db.one(
      `SELECT COUNT(*) AS buyers, SUM(orders >= 2) AS repeat_buyers, COALESCE(SUM(spent), 0) AS spent, COALESCE(SUM(orders), 0) AS orders
         FROM (SELECT customer_id, COUNT(*) AS orders, SUM(total) AS spent
                 FROM sales_orders
                WHERE org_id = :orgId AND customer_id IS NOT NULL AND status IN ${SOLD}
                GROUP BY customer_id) t`,
      { orgId },
    ),
    db.query("SELECT tags FROM customers WHERE org_id = :orgId AND tags IS NOT NULL AND tags <> ''", { orgId }),
  ]);
  const tagCount = new Map();
  for (const r of tagRows) for (const t of new Set(splitTags(r.tags))) tagCount.set(t, (tagCount.get(t) ?? 0) + 1);
  const buyerCount = Number(buyers.buyers);
  res.json({
    data: {
      totalCustomers: Number(totals.total),
      newThisMonth: Number(totals.new_this_month ?? 0),
      consentCount: Number(totals.consent ?? 0),
      buyers: buyerCount,
      repeatBuyers: Number(buyers.repeat_buyers ?? 0),
      repeatRate: buyerCount ? Math.round((Number(buyers.repeat_buyers) / buyerCount) * 1000) / 10 : 0,
      avgSpend: buyerCount ? Math.round((Number(buyers.spent) / buyerCount) * 100) / 100 : 0,
      avgBasket: Number(buyers.orders) ? Math.round((Number(buyers.spent) / Number(buyers.orders)) * 100) / 100 : 0,
      tags: [...tagCount.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'th')).map(([tag, count]) => ({ tag, count })),
    },
  });
});

/* ------------------------------------------------------------ CSV export */

const csvCell = (v) => {
  const s = v == null ? '' : String(v);
  // Neutralise spreadsheet formula injection and quote every cell
  const safe = /^[=+\-@]/.test(s) ? `'${s}` : s;
  return `"${safe.replace(/"/g, '""')}"`;
};
const localDate = (d) => {
  if (!d) return '';
  const [h, m] = TZ.replace(/^[+-]/, '').split(':').map(Number);
  const sign = TZ.startsWith('-') ? -1 : 1;
  return new Date(new Date(d).getTime() + sign * (h * 60 + (m || 0)) * 60_000).toISOString().slice(0, 10);
};
const EXPORT_LIMIT = 20_000;

/** The filtered list as CSV (UTF-8 with BOM so Excel shows Thai). Logged: it is personal data (PDPA). */
router.get('/export.csv', validate({ query: listQuery.omit({ limit: true, offset: true }) }), async (req, res) => {
  const f = req.valid.query;
  const { where, params } = listWhere(req.user.orgId, f);
  const rows = (await db.query(`${LIST_SELECT} WHERE ${where} ORDER BY ${SORTS[f.sort]} LIMIT ${EXPORT_LIMIT}`, params)).map((r) => ({
    ...mapListRow(r),
    taxId: r.tax_id,
    branchNo: r.branch_no,
    address: r.address,
  }));
  const header = [
    'รหัสสมาชิก',
    'ชื่อลูกค้า',
    'เบอร์โทร',
    'อีเมล',
    'เลขผู้เสียภาษี',
    'สาขา',
    'ที่อยู่',
    'แท็ก',
    'ยอดซื้อรวม',
    'จำนวนบิล',
    'ยอดเฉลี่ยต่อบิล',
    'ซื้อครั้งแรก',
    'ซื้อล่าสุด',
    'แต้มสะสม',
    'แชตที่เปิดอยู่',
    'ยินยอมรับข่าวสาร',
    'วันที่สมัคร',
  ];
  const lines = rows.map((c) => [
    c.memberNo,
    c.name,
    c.phone,
    c.email,
    c.taxId,
    c.branchNo,
    c.address,
    c.tags.join(', '),
    c.totalSpent.toFixed(2),
    c.orderCount,
    c.avgBasket.toFixed(2),
    localDate(c.firstOrderAt),
    localDate(c.lastOrderAt),
    c.points,
    c.openChats,
    c.consentMarketing ? 'ยินยอม' : 'ไม่ยินยอม',
    localDate(c.createdAt),
  ]);
  const csv = [header, ...lines].map((r) => r.map(csvCell).join(',')).join('\r\n');
  audit(req, 'customer.export', 'customer', null, { count: rows.length, q: f.q ?? null, tag: f.tag ?? null });
  res.set('Content-Type', 'text/csv; charset=utf-8');
  res.set('Content-Disposition', `attachment; filename="customers-${localDate(new Date())}.csv"`);
  res.send(`\uFEFF${csv}\r\n`);
});

/* ---------------------------------------------------------------- detail */

const idParams = z.object({ id: z.coerce.number().int().positive() });

async function loadCustomer(orgId, id) {
  const c = await db.one('SELECT * FROM customers WHERE id = :id AND org_id = :orgId', { id, orgId });
  if (!c) throw notFound('ไม่พบลูกค้า');
  return c;
}

const mapProfile = (c) => ({
  id: c.id,
  name: c.name,
  memberNo: c.member_no,
  phone: c.phone,
  email: c.email,
  taxId: c.tax_id,
  branchNo: c.branch_no,
  address: c.address,
  tags: splitTags(c.tags),
  points: Number(c.points),
  consentMarketing: Boolean(c.consent_marketing),
  createdAt: c.created_at,
  updatedAt: c.updated_at,
});

router.get('/:id', validate({ params: idParams }), async (req, res) => {
  const orgId = req.user.orgId;
  const c = await loadCustomer(orgId, req.valid.params.id);
  const p = { orgId, id: c.id };
  const [stats, cancelled, orders, items, products, channels, convs] = await Promise.all([
    db.one(
      `SELECT COUNT(*) AS orders, COALESCE(SUM(total), 0) AS spent, MIN(ordered_at) AS first_at, MAX(ordered_at) AS last_at,
              COALESCE(SUM(discount), 0) AS discount, COALESCE(SUM(points_earned), 0) AS points_earned, COALESCE(SUM(points_used), 0) AS points_used
         FROM sales_orders WHERE org_id = :orgId AND customer_id = :id AND status IN ${SOLD}`,
      p,
    ),
    db.one(`SELECT COUNT(*) AS n FROM sales_orders WHERE org_id = :orgId AND customer_id = :id AND status IN ('cancelled','refunded')`, p),
    db.query(
      `SELECT so.id, so.order_no, so.channel, so.status, so.total, so.ordered_at, b.name AS branch_name,
              (SELECT COALESCE(SUM(i.quantity), 0) FROM sales_order_items i WHERE i.order_id = so.id) AS item_qty,
              (SELECT COUNT(*) FROM sales_order_items i WHERE i.order_id = so.id) AS line_count
         FROM sales_orders so
         LEFT JOIN branches b ON b.id = so.branch_id
        WHERE so.org_id = :orgId AND so.customer_id = :id
        ORDER BY so.ordered_at DESC, so.id DESC
        LIMIT 30`,
      p,
    ),
    db.one(
      `SELECT COALESCE(SUM(i.quantity), 0) AS qty
         FROM sales_order_items i JOIN sales_orders so ON so.id = i.order_id
        WHERE so.org_id = :orgId AND so.customer_id = :id AND so.status IN ${SOLD}`,
      p,
    ),
    db.query(
      `SELECT i.product_id, MAX(i.name) AS name, SUM(i.quantity) AS qty, SUM(i.line_total) AS total, COUNT(DISTINCT so.id) AS times
         FROM sales_order_items i JOIN sales_orders so ON so.id = i.order_id
        WHERE so.org_id = :orgId AND so.customer_id = :id AND so.status IN ${SOLD}
        GROUP BY i.product_id
        ORDER BY qty DESC, total DESC
        LIMIT 5`,
      p,
    ),
    db.query(
      `SELECT channel, COUNT(*) AS orders, SUM(total) AS spent
         FROM sales_orders WHERE org_id = :orgId AND customer_id = :id AND status IN ${SOLD}
        GROUP BY channel ORDER BY spent DESC`,
      p,
    ),
    db.query(
      `SELECT cv.id, cv.status, cv.mode, cv.intent, cv.sentiment, cv.unread_count, cv.last_message_at, cv.created_at, cv.customer_name,
              ch.platform, ch.name AS channel_name,
              (SELECT m.content FROM messages m WHERE m.conversation_id = cv.id ORDER BY m.id DESC LIMIT 1) AS last_message
         FROM conversations cv
         JOIN channels ch ON ch.id = cv.channel_id
        WHERE cv.org_id = :orgId AND cv.customer_id = :id
        ORDER BY COALESCE(cv.last_message_at, cv.created_at) DESC
        LIMIT 30`,
      p,
    ),
  ]);
  const orderCount = Number(stats.orders);
  const spent = Number(stats.spent);
  res.json({
    data: {
      ...mapProfile(c),
      stats: {
        totalSpent: spent,
        orderCount,
        avgBasket: orderCount ? Math.round((spent / orderCount) * 100) / 100 : 0,
        firstOrderAt: stats.first_at,
        lastOrderAt: stats.last_at,
        itemsBought: Number(items.qty),
        totalDiscount: Number(stats.discount),
        pointsEarned: Number(stats.points_earned),
        pointsUsed: Number(stats.points_used),
        points: Number(c.points),
        cancelledCount: Number(cancelled.n),
        openChats: convs.filter((v) => v.status === 'open' || v.status === 'pending').length,
      },
      channels: channels.map((r) => ({ channel: r.channel, orderCount: Number(r.orders), totalSpent: Number(r.spent) })),
      topProducts: products.map((r) => ({
        productId: r.product_id,
        name: r.name,
        quantity: Number(r.qty),
        total: Number(r.total),
        orderCount: Number(r.times),
      })),
      recentOrders: orders.map((o) => ({
        id: o.id,
        orderNo: o.order_no,
        channel: o.channel,
        status: o.status,
        total: Number(o.total),
        itemCount: Number(o.item_qty),
        lineCount: Number(o.line_count),
        branchName: o.branch_name,
        orderedAt: o.ordered_at,
      })),
      conversations: convs.map((v) => ({
        id: v.id,
        platform: v.platform,
        channelName: v.channel_name,
        customerName: v.customer_name,
        status: v.status,
        mode: v.mode,
        intent: v.intent,
        sentiment: v.sentiment,
        unreadCount: Number(v.unread_count),
        lastMessage: v.last_message ? String(v.last_message).slice(0, 140) : null,
        lastMessageAt: v.last_message_at,
        createdAt: v.created_at,
      })),
    },
  });
});

/** One of the customer's bills (items, payments) for anyone allowed to see the customer. */
router.get('/:id/orders/:orderId', validate({ params: idParams.extend({ orderId: z.coerce.number().int().positive() }) }), async (req, res) => {
  const { id, orderId } = req.valid.params;
  const order = await getOrder(req.user.orgId, orderId);
  if (order.customerId !== id) throw notFound('ไม่พบบิลของลูกค้ารายนี้');
  res.json({ data: order });
});

/* ---------------------------------------------------------- create / edit */

/** Optional text: trimmed, "" -> null (clears the field). */
const optText = (schema, clean = (s) => s.trim()) => z.preprocess((v) => (typeof v === 'string' ? clean(v) || null : v), schema.nullable().optional());

const tagsSchema = z
  .array(z.string().trim().min(1).max(30, 'แท็กยาวเกิน 30 ตัวอักษร'))
  .max(20, 'ใส่แท็กได้ไม่เกิน 20 แท็ก')
  .transform((tags) => {
    const seen = new Set();
    return tags.map((t) => t.replace(/,/g, ' ').trim()).filter((t) => t && !seen.has(t.toLowerCase()) && seen.add(t.toLowerCase()));
  })
  .refine((tags) => tags.join(',').length <= 500, 'แท็กรวมกันยาวเกินไป');

const nameSchema = z.string().trim().min(1, 'กรุณาใส่ชื่อ').max(191);
const fields = {
  phone: optText(z.string().regex(/^0\d{8,9}$/, 'เบอร์โทรไม่ถูกต้อง (เช่น 0812345678)'), (s) => s.replace(/[\s-]/g, '')),
  email: optText(z.email('อีเมลไม่ถูกต้อง').max(191)),
  taxId: optText(z.string().regex(/^\d{13}$/, 'เลขผู้เสียภาษีต้องเป็นตัวเลข 13 หลัก'), (s) => s.replace(/[\s-]/g, '')),
  branchNo: optText(z.string().regex(/^\d{5}$/, 'เลขสาขาต้องเป็นตัวเลข 5 หลัก (สำนักงานใหญ่ = 00000)')),
  address: optText(z.string().max(1000)),
  tags: tagsSchema.optional(),
  consentMarketing: z.boolean().optional(),
};
const createBody = z.object({ name: nameSchema, ...fields });
const patchBody = z.object({ name: nameSchema.optional(), ...fields }).refine((b) => Object.values(b).some((v) => v !== undefined), 'ไม่มีข้อมูลที่จะแก้ไข');

const COLUMNS = {
  name: 'name',
  phone: 'phone',
  email: 'email',
  taxId: 'tax_id',
  branchNo: 'branch_no',
  address: 'address',
  tags: 'tags',
  consentMarketing: 'consent_marketing',
};
const toDb = (k, v) => (k === 'tags' ? (v.length ? v.join(',') : null) : k === 'consentMarketing' ? (v ? 1 : 0) : v);

async function assertPhoneFree(orgId, phone, exceptId = 0) {
  if (!phone) return;
  const dup = await db.one('SELECT id, name FROM customers WHERE org_id = :orgId AND phone = :phone AND id <> :exceptId LIMIT 1', { orgId, phone, exceptId });
  if (dup) throw conflict(`เบอร์นี้เป็นของลูกค้า "${dup.name}" อยู่แล้ว`);
}

router.post('/', requireAny(WRITE), validate({ body: createBody }), async (req, res) => {
  const b = req.valid.body;
  const orgId = req.user.orgId;
  await assertPhoneFree(orgId, b.phone);
  const cols = Object.keys(COLUMNS).filter((k) => b[k] !== undefined);
  const values = Object.fromEntries(cols.map((k) => [k, toDb(k, b[k])]));
  const r = await db.query(
    `INSERT INTO customers (org_id, ${cols.map((k) => COLUMNS[k]).join(', ')}) VALUES (:orgId, ${cols.map((k) => `:${k}`).join(', ')})`,
    {
      orgId,
      ...values,
    },
  );
  await db.query('UPDATE customers SET member_no = :no WHERE id = :id', { no: `M${String(r.insertId).padStart(6, '0')}`, id: r.insertId });
  audit(req, 'customer.create', 'customer', r.insertId, { fields: cols });
  res.status(201).json({ data: mapProfile(await loadCustomer(orgId, r.insertId)) });
});

router.patch('/:id', requireAny(WRITE), validate({ params: idParams, body: patchBody }), async (req, res) => {
  const orgId = req.user.orgId;
  const c = await loadCustomer(orgId, req.valid.params.id);
  const b = req.valid.body;
  if (b.phone && b.phone !== c.phone) await assertPhoneFree(orgId, b.phone, c.id);
  const changed = Object.keys(COLUMNS).filter((k) => b[k] !== undefined && String(toDb(k, b[k]) ?? '') !== String(c[COLUMNS[k]] ?? ''));
  if (changed.length) {
    await db.query(`UPDATE customers SET ${changed.map((k) => `${COLUMNS[k]} = :${k}`).join(', ')} WHERE id = :id AND org_id = :orgId`, {
      id: c.id,
      orgId,
      ...Object.fromEntries(changed.map((k) => [k, toDb(k, b[k])])),
    });
    audit(req, 'customer.update', 'customer', c.id, { fields: changed });
  }
  res.json({ data: mapProfile(await loadCustomer(orgId, c.id)) });
});

module.exports = { router };
