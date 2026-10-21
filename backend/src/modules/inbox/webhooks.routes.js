'use strict';

const express = require('express');
const db = require('../../db/pool');
const logger = require('../../core/logger');
const { enqueue } = require('../../jobs/queue');
const line = require('../../integrations/line');
const meta = require('../../integrations/meta');
const metaSocial = require('../../integrations/meta-social');
const inbox = require('./inbox.service');
const { replyToConversation } = require('./agent.service');

/**
 * Public webhooks (no session). Each request is authenticated by the platform's HMAC signature
 * over the raw body, so this router is mounted before the JSON parser with express.raw().
 * We answer 200 immediately (platforms retry slow endpoints) and then process.
 */
const router = express.Router();
router.use(express.raw({ type: '*/*', limit: '1mb' }));

const FALLBACK_DELAY_MS = 90_000;

async function findChannel(platforms, externalId) {
  return (
    (await db.one(
      `SELECT * FROM channels WHERE platform IN (:platforms) AND is_active = 1 AND external_id = :externalId LIMIT 1`,
      { platforms, externalId: externalId ?? '' },
    )) ??
    // Single-store installs: accept the only active channel of that platform
    (await db.one(`SELECT * FROM channels WHERE platform IN (:platforms) AND is_active = 1 ORDER BY id LIMIT 1`, { platforms }))
  );
}

async function logEvent(provider, eventId, payload) {
  await db
    .query('INSERT IGNORE INTO webhook_events (provider, event_id, payload) VALUES (:provider, :eventId, :payload)', {
      provider,
      eventId: eventId ? String(eventId).slice(0, 191) : null,
      payload: JSON.stringify(payload),
    })
    .catch((err) => logger.warn({ err: err.message }, 'webhook log failed'));
}

/** Reply right away (fast path) and queue an idempotent fallback in case this process is recycled. */
async function respond(conversationId, opts = {}) {
  await enqueue('inbox.ai_reply', { conversationId }, { runAt: new Date(Date.now() + FALLBACK_DELAY_MS), maxAttempts: 3 });
  setImmediate(() => {
    replyToConversation(conversationId, opts).catch((err) => logger.warn({ err: err.message, conversationId }, 'inline AI reply failed; fallback job will retry'));
  });
}

const lineText = (m) =>
  m.type === 'text' ? m.text : { sticker: '[ส่งสติกเกอร์]', image: '[ส่งรูปภาพ]', video: '[ส่งวิดีโอ]', audio: '[ส่งข้อความเสียง]', location: '[แชร์ตำแหน่ง]' }[m.type] ?? `[${m.type}]`;

/* --------------------------------------------------------------------- LINE */

router.post('/line', async (req, res) => {
  if (!line.isConfigured()) return res.status(503).json({ error: 'LINE not configured' });
  if (!line.verifySignature(req.body, req.get('x-line-signature'))) return res.status(401).json({ error: 'bad signature' });
  res.json({ ok: true });

  let body;
  try {
    body = JSON.parse(req.body.toString('utf8'));
  } catch {
    return undefined;
  }
  const channel = await findChannel(['line'], body.destination);
  if (!channel) return logger.warn({ destination: body.destination }, 'LINE webhook: no channel configured');
  for (const ev of body.events ?? []) {
    if (ev.type !== 'message' || ev.source?.type !== 'user') continue;
    try {
      await logEvent('line', ev.webhookEventId, ev);
      const userId = ev.source.userId;
      const token = await inbox.channelToken(channel);
      const profile = token ? await line.getProfile(token, userId) : null;
      const r = await inbox.ingestInbound({
        channel,
        threadId: userId,
        customerName: profile?.displayName ?? null,
        text: lineText(ev.message),
        externalMessageId: ev.message.id,
      });
      if (!r.duplicate) await respond(r.conversationId, { replyToken: ev.replyToken });
    } catch (err) {
      logger.error({ err }, 'LINE webhook event failed');
    }
  }
  return undefined;
});

/* --------------------------------------------------- Facebook / Instagram */

router.get('/meta', (req, res) => {
  if (!meta.isConfigured()) return res.status(503).send('Meta not configured');
  const challenge = meta.verifyChallenge(req.query);
  return challenge ? res.send(String(challenge)) : res.sendStatus(403);
});

router.post('/meta', async (req, res) => {
  if (!meta.isConfigured()) return res.status(503).json({ error: 'Meta not configured' });
  if (!meta.verifySignature(req.body, req.get('x-hub-signature-256'))) return res.status(401).json({ error: 'bad signature' });
  res.json({ ok: true });

  let body;
  try {
    body = JSON.parse(req.body.toString('utf8'));
  } catch {
    return undefined;
  }
  const platforms = body.object === 'instagram' ? ['instagram'] : ['facebook'];
  for (const entry of body.entry ?? []) {
    for (const ev of entry.messaging ?? []) {
      const msg = ev.message;
      if (!msg || msg.is_echo) continue; // echoes are our own outgoing messages
      try {
        await logEvent('meta', msg.mid, ev);
        const channel = await findChannel(platforms, ev.recipient?.id ?? entry.id);
        if (!channel) {
          logger.warn({ pageId: entry.id }, 'Meta webhook: no channel configured');
          continue;
        }
        const text = msg.text ?? (msg.attachments?.length ? `[ส่ง${msg.attachments[0].type === 'image' ? 'รูปภาพ' : 'ไฟล์แนบ'}]` : '[ข้อความ]');
        // First message from this person: look up their name (Messenger / Instagram profile)
        const known = await db.one('SELECT 1 AS x FROM conversations WHERE channel_id = :id AND external_thread_id = :t', { id: channel.id, t: ev.sender.id });
        const token = known ? null : await inbox.channelToken(channel);
        const customerName = token ? await metaSocial.customerName(channel.platform, ev.sender.id, token) : null;
        const r = await inbox.ingestInbound({ channel, threadId: ev.sender.id, customerName, text, externalMessageId: msg.mid });
        if (!r.duplicate) await respond(r.conversationId);
      } catch (err) {
        logger.error({ err }, 'Meta webhook event failed');
      }
    }
  }
  return undefined;
});

module.exports = { router };
