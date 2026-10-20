'use strict';

const express = require('express');
const { z } = require('zod');
const db = require('../../db/pool');
const { validate } = require('../../core/http');
const { authenticate, requirePermission } = require('../../core/auth');
const { audit } = require('../../core/audit');
const { badRequest } = require('../../core/errors');
const alerts = require('../inventory/alerts');

const router = express.Router();
router.use(authenticate);

/** Notifications the user may see: org-wide ones plus those tied to a permission they hold. */
const VISIBLE = `n.org_id = :orgId AND (n.permission IS NULL OR n.permission IN (:perms)) AND n.created_at > UTC_TIMESTAMP() - INTERVAL 30 DAY`;
const params = (req) => ({ orgId: req.user.orgId, userId: req.user.id, perms: req.user.permissions.length ? req.user.permissions : [''] });

router.get('/', validate({ query: z.object({ limit: z.coerce.number().int().min(1).max(100).default(30) }) }), async (req, res) => {
  const rows = await db.query(
    `SELECT n.id, n.type, n.severity, n.title, n.body, n.link, n.created_at, (r.user_id IS NOT NULL) AS is_read
       FROM notifications n LEFT JOIN notification_reads r ON r.notification_id = n.id AND r.user_id = :userId
      WHERE ${VISIBLE} ORDER BY n.id DESC LIMIT :limit`,
    { ...params(req), limit: req.valid.query.limit },
  );
  res.json({
    data: rows.map((n) => ({
      id: n.id,
      type: n.type,
      severity: n.severity,
      title: n.title,
      body: n.body,
      link: n.link,
      createdAt: n.created_at,
      read: Boolean(n.is_read),
    })),
  });
});

router.get('/unread-count', async (req, res) => {
  const row = await db.one(
    `SELECT COUNT(*) AS n FROM notifications n LEFT JOIN notification_reads r ON r.notification_id = n.id AND r.user_id = :userId
      WHERE ${VISIBLE} AND r.user_id IS NULL`,
    params(req),
  );
  res.json({ data: { count: Number(row.n) } });
});

router.post('/:id/read', validate({ params: z.object({ id: z.coerce.number().int().positive() }) }), async (req, res) => {
  await db.query(
    `INSERT IGNORE INTO notification_reads (notification_id, user_id)
     SELECT n.id, :userId FROM notifications n WHERE n.id = :id AND ${VISIBLE}`,
    { ...params(req), id: req.valid.params.id },
  );
  res.json({ data: { ok: true } });
});

router.post('/read-all', async (req, res) => {
  await db.query(
    `INSERT IGNORE INTO notification_reads (notification_id, user_id)
     SELECT n.id, :userId FROM notifications n WHERE ${VISIBLE}`,
    params(req),
  );
  res.json({ data: { ok: true } });
});

/* ---------------------------------------------------- stock alert settings (LINE OA) */

router.get('/settings', requirePermission('inventory:write'), async (req, res) => {
  const line = await alerts.getLineSettings(req.user.orgId);
  // People who chatted with the shop's LINE OA: staff send it one message, then pick themselves here
  const targets = await db.query(
    `SELECT c.external_thread_id AS id, COALESCE(c.customer_name, 'ผู้ใช้ LINE') AS name, c.last_message_at
       FROM conversations c JOIN channels ch ON ch.id = c.channel_id
      WHERE c.org_id = :orgId AND ch.platform = 'line' ORDER BY c.last_message_at DESC LIMIT 30`,
    { orgId: req.user.orgId },
  );
  res.json({ data: { line, lineTargets: targets.map((t) => ({ id: t.id, name: t.name, lastMessageAt: t.last_message_at })) } });
});

router.put(
  '/settings',
  requirePermission('inventory:write'),
  validate({
    body: z.object({
      line: z.object({
        enabled: z.boolean(),
        to: z
          .array(
            z
              .string()
              .trim()
              .regex(/^[UCR][0-9a-f]{32}$/, 'LINE ID ต้องขึ้นต้นด้วย U (ผู้ใช้) หรือ C (กลุ่ม) ตามด้วย 32 ตัวอักษร'),
          )
          .max(10),
        digestTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'เวลาต้องเป็น HH:MM'),
      }),
    }),
  }),
  async (req, res) => {
    await alerts.saveSetting(req.user.orgId, 'notify.line', req.valid.body.line);
    audit(req, 'notify.settings', 'settings', 'notify.line', { enabled: req.valid.body.line.enabled, targets: req.valid.body.line.to.length });
    res.json({ data: { line: await alerts.getLineSettings(req.user.orgId) } });
  },
);

router.post('/test-line', requirePermission('inventory:write'), async (req, res) => {
  const s = await alerts.getLineSettings(req.user.orgId);
  if (!s.to.length) throw badRequest('ยังไม่ได้เลือกผู้รับแจ้งเตือน');
  try {
    const sent = await alerts.pushLine(req.user.orgId, '✅ ทดสอบแจ้งเตือนสต๊อกจาก POS Enterprise', { ...s, enabled: true });
    res.json({ data: { sent } });
  } catch (err) {
    throw badRequest(`ส่ง LINE ไม่สำเร็จ: ${err.message}`);
  }
});

/** Run the stock check now (the cron also runs it every hour). */
router.post('/check-stock', requirePermission('inventory:read'), async (req, res) => {
  res.json({ data: await alerts.checkOrg(req.user.orgId) });
});

module.exports = { router };
