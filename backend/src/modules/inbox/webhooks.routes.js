'use strict';

const express = require('express');
const db = require('../../db/pool');
const logger = require('../../core/logger');
const { enqueue } = require('../../jobs/queue');
const line = require('../../integrations/line');
const meta = require('../../integrations/meta');
const metaSocial = require('../../integrations/meta-social');
const shopee = require('../../integrations/shopee');
const tiktokShop = require('../../integrations/tiktok-shop');
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

/* ------------------------------------------------------ Shopee / TikTok Shop */

/** Shop channel by shop id; the sync itself reads the messages from the platform API. */
const shopChannel = (platform, shopId) =>
  db.one('SELECT * FROM channels WHERE platform = :platform AND external_id = :shopId AND is_active = 1', { platform, shopId: String(shopId ?? '') });

/** Shopee signs "<push url>|<body>": accept the URL as configured (PUBLIC_API_URL) or as received. */
function shopeePushUrls(req) {
  const urls = [`${req.protocol}://${req.get('host')}${req.originalUrl}`];
  if (process.env.PUBLIC_API_URL) urls.unshift(`${process.env.PUBLIC_API_URL.replace(/\/+$/, '')}/webhooks/shopee`);
  return urls;
}

/** Shopee push (Webchat = code 10). Other push codes are acknowledged and ignored. */
router.post('/shopee', async (req, res) => {
  if (!shopee.isConfigured()) return res.status(503).json({ error: 'Shopee not configured' });
  const auth = req.get('authorization');
  if (!shopeePushUrls(req).some((url) => shopee.verifyPush(url, req.body, auth))) return res.status(401).json({ error: 'bad signature' });
  res.json({ ok: true });

  let body;
  try {
    body = JSON.parse(req.body.toString('utf8'));
  } catch {
    return undefined;
  }
  if (Number(body.code) !== 10) return undefined;
  try {
    const content = body.data?.content ?? body.data ?? {};
    await logEvent('shopee', content.message_id ? `chat:${content.message_id}` : null, body);
    const channel = await shopChannel('shopee', body.shop_id);
    if (!channel) return logger.warn({ shopId: body.shop_id }, 'Shopee push: shop not connected');
    const conversationId = content.conversation_id;
    const marketplace = require('./marketplace.service');
    // No conversation id in this push: check every unread chat instead
    if (conversationId) await marketplace.syncConversation(channel, String(conversationId), { buyerName: content.from_user_name ?? null });
    else await marketplace.pollAll();
  } catch (err) {
    logger.error({ err }, 'Shopee push failed');
  }
  return undefined;
});

/** TikTok Shop webhook: (13) new conversation, (14) new message. */
router.post('/tiktok', async (req, res) => {
  if (!tiktokShop.isConfigured()) return res.status(503).json({ error: 'TikTok Shop not configured' });
  if (!tiktokShop.verifyWebhook(req.body, req.get('authorization'))) return res.status(401).json({ error: 'bad signature' });
  res.json({ ok: true });

  let body;
  try {
    body = JSON.parse(req.body.toString('utf8'));
  } catch {
    return undefined;
  }
  if (![13, 14].includes(Number(body.type))) return undefined;
  try {
    await logEvent('tiktok_shop', body.tts_notification_id, body);
    const channel = await shopChannel('tiktok', body.shop_id);
    if (!channel) return logger.warn({ shopId: body.shop_id }, 'TikTok Shop webhook: shop not connected');
    const conversationId = body.data?.conversation_id;
    if (conversationId) await require('./marketplace.service').syncConversation(channel, String(conversationId));
  } catch (err) {
    logger.error({ err }, 'TikTok Shop webhook failed');
  }
  return undefined;
});

module.exports = { router, respond };
