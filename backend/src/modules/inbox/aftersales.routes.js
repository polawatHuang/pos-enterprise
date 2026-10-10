'use strict';

const crypto = require('node:crypto');
const express = require('express');
const { z } = require('zod');
const db = require('../../db/pool');
const { validate } = require('../../core/http');
const { authenticate, requirePermission } = require('../../core/auth');
const { audit } = require('../../core/audit');
const { notFound, conflict } = require('../../core/errors');
const inbox = require('./inbox.service');

/** Returns, disputes and AI offers awaiting a manager — the after-sales side of the inbox. */
const router = express.Router();
router.use(authenticate);

const idParam = z.object({ id: z.coerce.number().int().positive() });

router.get(
  '/returns',
  requirePermission('inbox:read'),
  validate({ query: z.object({ status: z.enum(['requested', 'approved', 'received', 'completed', 'rejected']).optional() }) }),
  async (req, res) => {
    const rows = await db.query(
      `SELECT r.*, so.order_no, so.total AS order_total, c.customer_name, ch.platform
         FROM returns r
         LEFT JOIN sales_orders so ON so.id = r.order_id
         LEFT JOIN conversations c ON c.id = r.conversation_id
         LEFT JOIN channels ch ON ch.id = c.channel_id
        WHERE r.org_id = :orgId AND (:status IS NULL OR r.status = :status)
        ORDER BY r.status = 'requested' DESC, r.id DESC LIMIT 100`,
      { orgId: req.user.orgId, status: req.valid.query.status ?? null },
    );
    res.json({
      data: rows.map((r) => ({
        id: r.id,
        orderId: r.order_id,
        orderNo: r.order_no,
        orderTotal: r.order_total == null ? null : Number(r.order_total),
        conversationId: r.conversation_id,
        customerName: r.customer_name,
        platform: r.platform,
        reason: r.reason,
        detail: r.detail,
        resolution: r.resolution,
        resolutionNote: r.resolution_note,
        amount: Number(r.amount),
        status: r.status,
        createdAt: r.created_at,
      })),
    });
  },
);

router.patch(
  '/returns/:id',
  requirePermission('inbox:manage_ai'),
  validate({
    params: idParam,
    body: z.object({
      status: z.enum(['requested', 'approved', 'received', 'completed', 'rejected']).optional(),
      resolution: z.enum(['pending', 'refund', 'exchange', 'discount', 'store_credit', 'rejected']).optional(),
      amount: z.coerce.number().min(0).max(99_999_999).optional(),
      resolutionNote: z.string().trim().max(2000).nullable().optional(),
      notifyCustomer: z.string().trim().max(2000).optional(),
    }),
  }),
  async (req, res) => {
    const b = req.valid.body;
    const ret = await db.one('SELECT * FROM returns WHERE id = :id AND org_id = :orgId', { id: req.valid.params.id, orgId: req.user.orgId });
    if (!ret) throw notFound('ไม่พบเรื่องคืนสินค้า');
    await db.query(
      `UPDATE returns SET status = COALESCE(:status, status), resolution = COALESCE(:resolution, resolution),
              amount = COALESCE(:amount, amount), resolution_note = IF(:noteSet, :note, resolution_note) WHERE id = :id`,
      {
        id: ret.id,
        status: b.status ?? null,
        resolution: b.resolution ?? null,
        amount: b.amount ?? null,
        noteSet: b.resolutionNote !== undefined,
        note: b.resolutionNote ?? null,
      },
    );
    if (b.notifyCustomer && ret.conversation_id) {
      await inbox.sendReply({ conversationId: ret.conversation_id, text: b.notifyCustomer, senderType: 'agent', userId: req.user.id });
    }
    audit(req, 'return.update', 'return', ret.id, { status: b.status, resolution: b.resolution });
    res.json({ data: { ok: true } });
  },
);

router.get('/disputes', requirePermission('inbox:read'), async (req, res) => {
  const rows = await db.query(
    `SELECT d.*, so.order_no FROM disputes d LEFT JOIN sales_orders so ON so.id = d.order_id
      WHERE d.org_id = :orgId ORDER BY d.status IN ('open','negotiating','escalated') DESC, d.id DESC LIMIT 100`,
    { orgId: req.user.orgId },
  );
  res.json({
    data: rows.map((d) => ({
      id: d.id,
      orderNo: d.order_no,
      platform: d.platform,
      category: d.category,
      summary: d.summary,
      severity: d.severity,
      status: d.status,
      resolutionNote: d.resolution_note,
      conversationId: d.conversation_id,
      createdAt: d.created_at,
    })),
  });
});

router.post(
  '/disputes',
  requirePermission('inbox:reply'),
  validate({
    body: z.object({
      conversationId: z.number().int().positive().nullable().optional(),
      orderNo: z.string().trim().max(40).nullable().optional(),
      platform: z.string().trim().max(30).nullable().optional(),
      category: z.string().trim().min(1).max(100),
      summary: z.string().trim().max(2000).nullable().optional(),
      severity: z.enum(['low', 'medium', 'high']).default('medium'),
    }),
  }),
  async (req, res) => {
    const b = req.valid.body;
    const order = b.orderNo ? await db.one('SELECT id FROM sales_orders WHERE org_id = :orgId AND order_no = :no', { orgId: req.user.orgId, no: b.orderNo }) : null;
    const r = await db.query(
      `INSERT INTO disputes (org_id, order_id, conversation_id, platform, category, summary, severity)
       VALUES (:orgId, :orderId, :conversationId, :platform, :category, :summary, :severity)`,
      { orgId: req.user.orgId, orderId: order?.id ?? null, conversationId: b.conversationId ?? null, platform: b.platform ?? null, category: b.category, summary: b.summary ?? null, severity: b.severity },
    );
    audit(req, 'dispute.create', 'dispute', r.insertId);
    res.status(201).json({ data: { id: r.insertId } });
  },
);

router.patch(
  '/disputes/:id',
  requirePermission('inbox:manage_ai'),
  validate({ params: idParam, body: z.object({ status: z.enum(['open', 'negotiating', 'resolved', 'escalated', 'lost']), resolutionNote: z.string().trim().max(2000).nullable().optional() }) }),
  async (req, res) => {
    const r = await db.query(
      `UPDATE disputes SET status = :status, resolution_note = COALESCE(:note, resolution_note),
              resolved_at = IF(:status IN ('resolved','lost'), UTC_TIMESTAMP(), NULL)
        WHERE id = :id AND org_id = :orgId`,
      { id: req.valid.params.id, orgId: req.user.orgId, status: req.valid.body.status, note: req.valid.body.resolutionNote ?? null },
    );
    if (!r.affectedRows) throw notFound();
    audit(req, 'dispute.update', 'dispute', req.valid.params.id, { status: req.valid.body.status });
    res.json({ data: { ok: true } });
  },
);

/* --------------------------------------------------------------- AI offers */

router.get('/offers', requirePermission('inbox:read'), async (req, res) => {
  const rows = await db.query(
    `SELECT o.*, c.customer_name, ch.platform, d.code
       FROM ai_offers o JOIN conversations c ON c.id = o.conversation_id JOIN channels ch ON ch.id = c.channel_id
       LEFT JOIN discount_codes d ON d.id = o.discount_code_id
      WHERE o.org_id = :orgId ORDER BY o.status = 'needs_approval' DESC, o.id DESC LIMIT 100`,
    { orgId: req.user.orgId },
  );
  res.json({
    data: rows.map((o) => ({
      id: o.id,
      conversationId: o.conversation_id,
      customerName: o.customer_name,
      platform: o.platform,
      type: o.offer_type,
      value: Number(o.value),
      rationale: o.rationale,
      status: o.status,
      code: o.code,
      createdAt: o.created_at,
    })),
  });
});

/** Manager approves a discount above the AI's cap: issue the code and send it to the customer. */
router.post('/offers/:id/approve', requirePermission('inbox:manage_ai'), validate({ params: idParam }), async (req, res) => {
  const code = `OK${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
  const offer = await db.tx(async (conn) => {
    const [[o]] = await conn.query('SELECT * FROM ai_offers WHERE id = :id AND org_id = :orgId FOR UPDATE', { id: req.valid.params.id, orgId: req.user.orgId });
    if (!o) throw notFound('ไม่พบข้อเสนอ');
    if (o.status !== 'needs_approval') throw conflict('ข้อเสนอนี้ไม่ได้รออนุมัติ');
    const [[conv]] = await conn.query('SELECT customer_id FROM conversations WHERE id = :id', { id: o.conversation_id });
    const [ins] = await conn.query(
      `INSERT INTO discount_codes (org_id, code, type, value, max_uses, customer_id, issued_by, expires_at)
       VALUES (:orgId, :code, 'percent', :value, 1, :customerId, 'user', UTC_TIMESTAMP() + INTERVAL 14 DAY)`,
      { orgId: req.user.orgId, code, value: o.value, customerId: conv?.customer_id ?? null },
    );
    await conn.query("UPDATE ai_offers SET status = 'accepted', approved_by = :userId, discount_code_id = :codeId WHERE id = :id", {
      id: o.id,
      userId: req.user.id,
      codeId: ins.insertId,
    });
    return o;
  });
  await inbox.sendReply({
    conversationId: offer.conversation_id,
    text: `ผู้จัดการอนุมัติส่วนลด ${Number(offer.value)}% ให้แล้วค่ะ ใช้โค้ด ${code} ได้ภายใน 14 วันนะคะ 😊`,
    senderType: 'agent',
    userId: req.user.id,
  });
  audit(req, 'offer.approve', 'ai_offer', offer.id, { value: Number(offer.value) });
  res.json({ data: { code } });
});

router.post('/offers/:id/decline', requirePermission('inbox:manage_ai'), validate({ params: idParam }), async (req, res) => {
  const r = await db.query("UPDATE ai_offers SET status = 'declined', approved_by = :userId WHERE id = :id AND org_id = :orgId AND status = 'needs_approval'", {
    id: req.valid.params.id,
    orgId: req.user.orgId,
    userId: req.user.id,
  });
  if (!r.affectedRows) throw conflict('ข้อเสนอนี้ไม่ได้รออนุมัติ');
  audit(req, 'offer.decline', 'ai_offer', req.valid.params.id);
  res.json({ data: { ok: true } });
});

module.exports = { router };
