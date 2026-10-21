'use strict';

const crypto = require('node:crypto');
const express = require('express');
const { z } = require('zod');
const db = require('../../db/pool');
const logger = require('../../core/logger');
const { validate } = require('../../core/http');
const { authenticate, requirePermission } = require('../../core/auth');
const { audit } = require('../../core/audit');
const { notFound, badRequest, conflict } = require('../../core/errors');
const ai = require('../../integrations/ai');
const inbox = require('./inbox.service');
const { replyToConversation } = require('./agent.service');
const runtime = require('../../config/runtime');
const metaSocial = require('../../integrations/meta-social');
const metaWebhook = require('../../integrations/meta');
const { signState, requireEncryption } = require('../social/accounts.service');

const router = express.Router();
router.use(authenticate);

const idParam = z.object({ id: z.coerce.number().int().positive() });

function mapConversation(r) {
  return {
    id: r.id,
    channelId: r.channel_id,
    platform: r.platform,
    channelName: r.channel_name,
    customerId: r.customer_id,
    customerName: r.customer_name,
    status: r.status,
    mode: r.mode,
    handoffReason: r.handoff_reason,
    intent: r.intent,
    sentiment: r.sentiment,
    unread: Number(r.unread_count),
    assignedTo: r.assigned_to,
    assignedName: r.assigned_name ?? null,
    lastMessage: r.last_message ?? null,
    lastSender: r.last_sender ?? null,
    lastMessageAt: r.last_message_at,
    lastCustomerMessageAt: r.last_customer_message_at,
  };
}

const CONV_SELECT = `
  SELECT c.*, ch.platform, ch.name AS channel_name, u.full_name AS assigned_name,
         (SELECT m.content FROM messages m WHERE m.conversation_id = c.id ORDER BY m.id DESC LIMIT 1) AS last_message,
         (SELECT m.sender_type FROM messages m WHERE m.conversation_id = c.id ORDER BY m.id DESC LIMIT 1) AS last_sender
    FROM conversations c
    JOIN channels ch ON ch.id = c.channel_id
    LEFT JOIN users u ON u.id = c.assigned_to`;

async function getConversation(orgId, id) {
  const row = await db.one(`${CONV_SELECT} WHERE c.org_id = :orgId AND c.id = :id`, { orgId, id });
  if (!row) throw notFound('ไม่พบแชต');
  return row;
}

/* ------------------------------------------------------------ conversations */

router.get('/summary', requirePermission('inbox:read'), async (req, res) => {
  const row = await db.one(
    `SELECT SUM(status IN ('open','pending')) AS open_count, SUM(status IN ('open','pending') AND mode = 'human') AS needs_human,
            COALESCE(SUM(unread_count), 0) AS unread
       FROM conversations WHERE org_id = :orgId`,
    { orgId: req.user.orgId },
  );
  const approvals = await db.one("SELECT COUNT(*) AS n FROM ai_offers WHERE org_id = :orgId AND status = 'needs_approval'", { orgId: req.user.orgId });
  const returns = await db.one("SELECT COUNT(*) AS n FROM returns WHERE org_id = :orgId AND status = 'requested'", { orgId: req.user.orgId });
  // Per platform: connected (active) channels and open chats, for the channel filter
  const platforms = await db.query(
    `SELECT ch.platform, COUNT(DISTINCT ch.id) AS channels,
            COUNT(c.id) AS open_count
       FROM channels ch LEFT JOIN conversations c ON c.channel_id = ch.id AND c.status IN ('open','pending')
      WHERE ch.org_id = :orgId AND ch.is_active = 1 GROUP BY ch.platform`,
    { orgId: req.user.orgId },
  );
  res.json({
    data: {
      open: Number(row.open_count ?? 0),
      needsHuman: Number(row.needs_human ?? 0),
      unread: Number(row.unread),
      pendingApprovals: Number(approvals.n),
      newReturns: Number(returns.n),
      aiProvider: ai.providerId(),
      aiConfigured: ai.isConfigured(),
      platforms: platforms.map((p) => ({ platform: p.platform, channels: Number(p.channels), open: Number(p.open_count) })),
    },
  });
});

router.get(
  '/conversations',
  requirePermission('inbox:read'),
  validate({
    query: z.object({
      view: z.enum(['active', 'human', 'ai', 'resolved', 'all']).default('active'),
      channelId: z.coerce.number().int().positive().optional(),
      platform: z.enum(['facebook', 'instagram', 'line', 'tiktok', 'shopee', 'website', 'email']).optional(),
      q: z.string().trim().max(100).optional(),
      limit: z.coerce.number().int().min(1).max(100).default(50),
    }),
  }),
  async (req, res) => {
    const f = req.valid.query;
    const viewSql = {
      active: "c.status IN ('open','pending')",
      human: "c.status IN ('open','pending') AND c.mode = 'human'",
      ai: "c.status IN ('open','pending') AND c.mode = 'ai'",
      resolved: "c.status IN ('resolved','closed')",
      all: '1=1',
    }[f.view];
    const rows = await db.query(
      `${CONV_SELECT}
        WHERE c.org_id = :orgId AND ${viewSql}
          AND (:channelId IS NULL OR c.channel_id = :channelId)
          AND (:platform IS NULL OR c.channel_id IN (SELECT id FROM channels WHERE org_id = :orgId AND platform = :platform))
          AND (:q IS NULL OR c.customer_name LIKE :q)
        ORDER BY (c.mode = 'human' AND c.status IN ('open','pending')) DESC, c.last_message_at DESC
        LIMIT :limit`,
      { orgId: req.user.orgId, channelId: f.channelId ?? null, platform: f.platform ?? null, q: f.q ? `%${f.q}%` : null, limit: f.limit },
    );
    res.json({ data: rows.map(mapConversation) });
  },
);

router.get('/conversations/:id', requirePermission('inbox:read'), validate({ params: idParam }), async (req, res) => {
  const conv = await getConversation(req.user.orgId, req.valid.params.id);
  const [messages, customer, orders, returns, offers] = await Promise.all([
    db.query(
      `SELECT m.id, m.direction, m.sender_type, m.content, m.delivery_status, m.ai_meta, m.created_at, u.full_name AS sender_name
         FROM messages m LEFT JOIN users u ON u.id = m.sender_user_id
        WHERE m.conversation_id = :id ORDER BY m.id DESC LIMIT 100`,
      { id: conv.id },
    ),
    conv.customer_id ? db.one('SELECT id, name, phone, email, total_spent, order_count, tags FROM customers WHERE id = :id', { id: conv.customer_id }) : null,
    conv.customer_id
      ? db.query(
          "SELECT id, order_no, channel, status, total, ordered_at FROM sales_orders WHERE customer_id = :id ORDER BY ordered_at DESC LIMIT 5",
          { id: conv.customer_id },
        )
      : [],
    db.query('SELECT id, reason, detail, resolution, status, amount, created_at FROM returns WHERE conversation_id = :id ORDER BY id DESC', { id: conv.id }),
    db.query(
      `SELECT o.id, o.offer_type, o.value, o.status, o.rationale, o.created_at, d.code FROM ai_offers o
         LEFT JOIN discount_codes d ON d.id = o.discount_code_id WHERE o.conversation_id = :id ORDER BY o.id DESC`,
      { id: conv.id },
    ),
  ]);
  const parseMeta = (v) => (v == null ? null : typeof v === 'string' ? JSON.parse(v) : v);
  res.json({
    data: {
      ...mapConversation(conv),
      messages: messages.reverse().map((m) => ({
        id: m.id,
        direction: m.direction,
        senderType: m.sender_type,
        senderName: m.sender_name,
        content: m.content,
        deliveryStatus: m.delivery_status,
        aiMeta: parseMeta(m.ai_meta),
        createdAt: m.created_at,
      })),
      customer: customer && {
        id: customer.id,
        name: customer.name,
        phone: customer.phone,
        email: customer.email,
        totalSpent: Number(customer.total_spent),
        orderCount: customer.order_count,
        tags: customer.tags,
      },
      orders: orders.map((o) => ({ id: o.id, orderNo: o.order_no, channel: o.channel, status: o.status, total: Number(o.total), orderedAt: o.ordered_at })),
      returns: returns.map((r) => ({ ...r, amount: Number(r.amount) })),
      offers: offers.map((o) => ({ id: o.id, type: o.offer_type, value: Number(o.value), status: o.status, rationale: o.rationale, code: o.code, createdAt: o.created_at })),
    },
  });
});

router.post('/conversations/:id/read', requirePermission('inbox:read'), validate({ params: idParam }), async (req, res) => {
  await db.query('UPDATE conversations SET unread_count = 0 WHERE id = :id AND org_id = :orgId', { id: req.valid.params.id, orgId: req.user.orgId });
  res.json({ data: { ok: true } });
});

/** Staff reply. Sending as a human pauses the AI on this chat so the two never talk over each other. */
router.post(
  '/conversations/:id/messages',
  requirePermission('inbox:reply'),
  validate({ params: idParam, body: z.object({ text: z.string().trim().min(1).max(4000), keepAi: z.boolean().default(false) }) }),
  async (req, res) => {
    const conv = await getConversation(req.user.orgId, req.valid.params.id);
    if (!req.valid.body.keepAi && conv.mode === 'ai') {
      await db.query("UPDATE conversations SET mode = 'human', handoff_reason = :reason WHERE id = :id", {
        id: conv.id,
        reason: `${req.user.name} ตอบเอง`,
      });
    }
    const r = await inbox.sendReply({ conversationId: conv.id, text: req.valid.body.text, senderType: 'agent', userId: req.user.id });
    await db.query("UPDATE conversations SET unread_count = 0, status = IF(status = 'open', 'pending', status) WHERE id = :id", { id: conv.id });
    audit(req, 'inbox.reply', 'conversation', conv.id);
    res.status(201).json({ data: r });
  },
);

router.patch(
  '/conversations/:id',
  requirePermission('inbox:reply'),
  validate({
    params: idParam,
    body: z.object({
      mode: z.enum(['ai', 'human']).optional(),
      status: z.enum(['open', 'pending', 'resolved', 'closed']).optional(),
      assignedTo: z.number().int().positive().nullable().optional(),
    }),
  }),
  async (req, res) => {
    const conv = await getConversation(req.user.orgId, req.valid.params.id);
    const b = req.valid.body;
    await db.query(
      `UPDATE conversations SET mode = COALESCE(:mode, mode), status = COALESCE(:status, status),
              assigned_to = IF(:assignSet, :assignedTo, assigned_to),
              handoff_reason = IF(:mode = 'ai', NULL, handoff_reason)
        WHERE id = :id`,
      { id: conv.id, mode: b.mode ?? null, status: b.status ?? null, assignSet: b.assignedTo !== undefined, assignedTo: b.assignedTo ?? null },
    );
    if (b.mode && b.mode !== conv.mode) {
      await inbox.addSystemNote(conv.id, b.mode === 'ai' ? `${req.user.name} เปิดให้ AI ตอบต่อ` : `${req.user.name} รับเรื่องต่อจาก AI`);
    }
    audit(req, 'inbox.update', 'conversation', conv.id, b);
    res.json({ data: mapConversation(await getConversation(req.user.orgId, conv.id)) });
  },
);

/** Ask the AI to answer the latest customer message now (e.g. after switching AI back on). */
router.post('/conversations/:id/ai-reply', requirePermission('inbox:reply'), validate({ params: idParam }), async (req, res) => {
  const conv = await getConversation(req.user.orgId, req.valid.params.id);
  if (conv.mode !== 'ai') throw conflict('แชตนี้ปิด AI อยู่ เปิดโหมด AI ก่อน');
  res.json({ data: await replyToConversation(conv.id) });
});

/* --------------------------------------------------------------- simulator */

/**
 * Chat as a customer on a built-in "website" channel to try the AI agent without any
 * messaging-platform keys. Waits for the AI so the tester sees the reply immediately.
 */
router.post(
  '/simulate',
  requirePermission('inbox:manage_ai'),
  validate({ body: z.object({ threadId: z.string().trim().max(64).optional(), customerName: z.string().trim().max(100).default('ลูกค้าทดสอบ'), text: z.string().trim().min(1).max(2000) }) }),
  async (req, res) => {
    let channel = await db.one("SELECT * FROM channels WHERE org_id = :orgId AND platform = 'website' AND external_id = 'simulator'", { orgId: req.user.orgId });
    if (!channel) {
      const r = await db.query(
        "INSERT INTO channels (org_id, platform, name, external_id, ai_enabled) VALUES (:orgId, 'website', 'แชตทดสอบ (Simulator)', 'simulator', 1)",
        { orgId: req.user.orgId },
      );
      channel = await db.one('SELECT * FROM channels WHERE id = :id', { id: r.insertId });
    }
    const threadId = req.valid.body.threadId || `sim-${crypto.randomBytes(4).toString('hex')}`;
    const r = await inbox.ingestInbound({ channel, threadId, customerName: req.valid.body.customerName, text: req.valid.body.text });
    let result;
    try {
      result = await replyToConversation(r.conversationId);
    } catch (err) {
      logger.warn({ err: err.message }, 'simulator AI reply failed');
      result = { status: 'error', error: err.message };
    }
    res.json({ data: { conversationId: r.conversationId, threadId, ...result } });
  },
);

/* ------------------------------------------------------- agent & knowledge */

const agentBody = z.object({
  name: z.string().trim().min(1).max(100),
  persona: z.string().trim().max(2000).nullable(),
  salesRules: z.string().trim().max(4000).nullable(),
  maxDiscountPct: z.coerce.number().min(0).max(100),
  handoffKeywords: z.string().trim().max(500).nullable(),
});

router.get('/agent', requirePermission('inbox:read'), async (req, res) => {
  const p = await db.one('SELECT * FROM ai_agent_profiles WHERE org_id = :orgId ORDER BY is_default DESC, id LIMIT 1', { orgId: req.user.orgId });
  res.json({
    data: {
      name: p?.name ?? 'แอดมิน',
      persona: p?.persona ?? '',
      salesRules: p?.sales_rules ?? '',
      maxDiscountPct: Number(p?.max_discount_pct ?? 10),
      handoffKeywords: p?.handoff_keywords ?? '',
      provider: ai.providerId(),
      configured: ai.isConfigured(),
    },
  });
});

router.put('/agent', requirePermission('inbox:manage_ai'), validate({ body: agentBody }), async (req, res) => {
  const b = req.valid.body;
  const existing = await db.one('SELECT id FROM ai_agent_profiles WHERE org_id = :orgId ORDER BY is_default DESC, id LIMIT 1', { orgId: req.user.orgId });
  const params = { orgId: req.user.orgId, name: b.name, persona: b.persona, rules: b.salesRules, max: b.maxDiscountPct, keywords: b.handoffKeywords };
  if (existing) {
    await db.query(
      'UPDATE ai_agent_profiles SET name = :name, persona = :persona, sales_rules = :rules, max_discount_pct = :max, handoff_keywords = :keywords WHERE id = :id',
      { ...params, id: existing.id },
    );
  } else {
    await db.query(
      `INSERT INTO ai_agent_profiles (org_id, name, persona, sales_rules, max_discount_pct, handoff_keywords, is_default)
       VALUES (:orgId, :name, :persona, :rules, :max, :keywords, 1)`,
      params,
    );
  }
  audit(req, 'inbox.agent.update', 'ai_agent_profile', existing?.id ?? null);
  res.json({ data: { ok: true } });
});

router.get('/knowledge', requirePermission('inbox:read'), async (req, res) => {
  const rows = await db.query(
    'SELECT id, kind, question, answer FROM product_knowledge WHERE org_id = :orgId AND product_id IS NULL ORDER BY id',
    { orgId: req.user.orgId },
  );
  res.json({ data: rows });
});

router.post(
  '/knowledge',
  requirePermission('inbox:manage_ai'),
  validate({ body: z.object({ kind: z.enum(['faq', 'policy', 'objection', 'usage', 'other']).default('policy'), question: z.string().trim().max(500).nullable(), answer: z.string().trim().min(1).max(5000) }) }),
  async (req, res) => {
    const b = req.valid.body;
    const r = await db.query('INSERT INTO product_knowledge (org_id, product_id, kind, question, answer) VALUES (:orgId, NULL, :kind, :q, :a)', {
      orgId: req.user.orgId,
      kind: b.kind,
      q: b.question,
      a: b.answer,
    });
    res.status(201).json({ data: { id: r.insertId, ...b } });
  },
);

router.delete('/knowledge/:id', requirePermission('inbox:manage_ai'), validate({ params: idParam }), async (req, res) => {
  const r = await db.query('DELETE FROM product_knowledge WHERE id = :id AND org_id = :orgId AND product_id IS NULL', { id: req.valid.params.id, orgId: req.user.orgId });
  if (!r.affectedRows) throw notFound();
  res.json({ data: { ok: true } });
});

/* ----------------------------------------------------------------- channels */

const publicApiUrl = (req) => (process.env.PUBLIC_API_URL || `${req.protocol}://${req.get('host')}`).replace(/\/+$/, '');
const WEBHOOK_PATH = { line: '/webhooks/line', facebook: '/webhooks/meta', instagram: '/webhooks/meta' };

router.get('/channels', requirePermission('inbox:read'), async (req, res) => {
  const rows = await db.query(
    `SELECT ch.*, (SELECT COUNT(*) FROM conversations c WHERE c.channel_id = ch.id AND c.status IN ('open','pending')) AS open_count,
            EXISTS (SELECT 1 FROM integration_credentials ic WHERE ic.org_id = ch.org_id AND ic.provider = ch.platform AND ic.account_ref = ch.external_id) AS has_token
       FROM channels ch WHERE ch.org_id = :orgId ORDER BY ch.id`,
    { orgId: req.user.orgId },
  );
  const base = publicApiUrl(req);
  res.json({
    data: rows.map((c) => ({
      id: c.id,
      platform: c.platform,
      name: c.name,
      externalId: c.external_id,
      aiEnabled: Boolean(c.ai_enabled),
      isActive: Boolean(c.is_active),
      openCount: Number(c.open_count),
      hasToken: Boolean(c.has_token) || (c.platform === 'line' && Boolean(runtime.get('LINE_CHANNEL_ACCESS_TOKEN'))),
      webhookUrl: WEBHOOK_PATH[c.platform] ? `${base}${WEBHOOK_PATH[c.platform]}` : null,
      supported: ['line', 'facebook', 'instagram', 'website'].includes(c.platform),
    })),
    meta: {
      publicApiUrlConfigured: Boolean(process.env.PUBLIC_API_URL),
      // "เชื่อมต่อด้วย Facebook" needs the Facebook Login app keys; messages arrive through the Meta webhook
      metaLogin: { configured: metaSocial.isConfigured(), missing: metaSocial.missing() },
      metaWebhook: { configured: metaWebhook.isConfigured(), missing: metaWebhook.missing(), callbackUrl: `${base}${WEBHOOK_PATH.facebook}` },
    },
  });
});

/** Facebook Login for Messenger + Instagram Direct: pick the pages, channels and tokens are set up on return. */
router.get('/oauth/meta/start', requirePermission('inbox:manage_ai'), (req, res) => {
  metaSocial.requireConfig();
  requireEncryption();
  res.json({ data: { url: metaSocial.getAuthorizeUrl(signState({ o: req.user.orgId, u: req.user.id, p: 'meta', k: 'inbox' }), { inbox: true }) } });
});

const channelBody = z.object({
  platform: z.enum(['facebook', 'instagram', 'line', 'tiktok', 'shopee', 'website']),
  name: z.string().trim().min(1).max(191),
  externalId: z.string().trim().min(1, 'ระบุ ID ของเพจ/บัญชี').max(191),
  aiEnabled: z.boolean().default(true),
  isActive: z.boolean().default(true),
  accessToken: z.string().trim().min(10).max(1000).optional(),
});

router.post('/channels', requirePermission('inbox:manage_ai'), validate({ body: channelBody }), async (req, res) => {
  const b = req.valid.body;
  const r = await db.query(
    'INSERT INTO channels (org_id, platform, name, external_id, ai_enabled, is_active) VALUES (:orgId, :platform, :name, :externalId, :ai, :active)',
    { orgId: req.user.orgId, platform: b.platform, name: b.name, externalId: b.externalId, ai: b.aiEnabled ? 1 : 0, active: b.isActive ? 1 : 0 },
  ).catch((err) => {
    if (err.code === 'ER_DUP_ENTRY') throw conflict('มีช่องทางนี้อยู่แล้ว');
    throw err;
  });
  if (b.accessToken) await inbox.saveChannelToken({ org_id: req.user.orgId, platform: b.platform, external_id: b.externalId }, b.accessToken);
  audit(req, 'inbox.channel.create', 'channel', r.insertId, { platform: b.platform });
  res.status(201).json({ data: { id: r.insertId } });
});

router.patch('/channels/:id', requirePermission('inbox:manage_ai'), validate({ params: idParam, body: channelBody.partial() }), async (req, res) => {
  const ch = await db.one('SELECT * FROM channels WHERE id = :id AND org_id = :orgId', { id: req.valid.params.id, orgId: req.user.orgId });
  if (!ch) throw notFound('ไม่พบช่องทาง');
  const b = req.valid.body;
  if (b.platform && b.platform !== ch.platform) throw badRequest('เปลี่ยนแพลตฟอร์มของช่องทางไม่ได้');
  await db.query(
    `UPDATE channels SET name = COALESCE(:name, name), external_id = COALESCE(:externalId, external_id),
            ai_enabled = COALESCE(:ai, ai_enabled), is_active = COALESCE(:active, is_active) WHERE id = :id`,
    {
      id: ch.id,
      name: b.name ?? null,
      externalId: b.externalId ?? null,
      ai: b.aiEnabled === undefined ? null : b.aiEnabled ? 1 : 0,
      active: b.isActive === undefined ? null : b.isActive ? 1 : 0,
    },
  );
  if (b.accessToken) await inbox.saveChannelToken({ ...ch, external_id: b.externalId ?? ch.external_id }, b.accessToken);
  audit(req, 'inbox.channel.update', 'channel', ch.id, { fields: Object.keys(b).filter((k) => k !== 'accessToken') });
  res.json({ data: { ok: true } });
});

module.exports = { router };
