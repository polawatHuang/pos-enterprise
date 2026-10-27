'use strict';

const db = require('../../db/pool');
const logger = require('../../core/logger');
const { badRequest } = require('../../core/errors');
const { decryptJson } = require('../../utils/crypto');
const shopee = require('../../integrations/shopee');
const tiktokShop = require('../../integrations/tiktok-shop');
const inbox = require('./inbox.service');

/**
 * Shopee / TikTok Shop chat in the inbox. One channel per shop (external_id = shop id), its tokens
 * saved encrypted with the channel. Messages come in two ways that end in the same sync:
 *   - push / webhook for a conversation  → syncConversation
 *   - a poll every 2 minutes of conversations with unread messages (pushes can be missed or not set up)
 * A sync reads the conversation's latest messages from the platform and stores the buyer's ones
 * (idempotent on the platform message id), then lets the AI answer as on LINE / Facebook.
 */

const REFRESH_MARGIN_MS = 10 * 60_000;
/** Only answer recent messages: a first sync must not reply to week-old unread chats. */
const ANSWER_WITHIN_MS = 60 * 60_000;
const PLATFORM_LABEL = { shopee: 'Shopee', tiktok: 'TikTok Shop' };

/* ------------------------------------------------------------- credentials */

async function credential(channel) {
  const row = await db.one('SELECT data_encrypted FROM integration_credentials WHERE org_id = :orgId AND provider = :p AND account_ref = :ref', {
    orgId: channel.org_id,
    p: channel.platform,
    ref: channel.external_id,
  });
  if (!row) throw badRequest(`ร้าน ${channel.name} ยังไม่ได้เชื่อมต่อ — กดเชื่อมต่อร้านใหม่ในหน้าตั้งค่าช่องทางแชต`);
  return decryptJson(row.data_encrypted);
}

const saveCredential = (orgId, platform, shopId, cred) =>
  inbox.saveChannelToken({ org_id: orgId, platform, external_id: String(shopId) }, cred.accessToken, cred);

/** A working access token: refreshed (and saved) when it expires within 10 minutes. */
async function freshCredential(channel) {
  const cred = await credential(channel);
  if (cred.expiresAt && cred.expiresAt - Date.now() > REFRESH_MARGIN_MS) return cred;
  if (!cred.refreshToken) throw badRequest(`token ของร้าน ${channel.name} หมดอายุ — กดเชื่อมต่อร้านใหม่`);
  let next;
  if (channel.platform === 'shopee') {
    const t = await shopee.refreshToken(cred.refreshToken, channel.external_id);
    next = { ...cred, accessToken: t.accessToken, refreshToken: t.refreshToken || cred.refreshToken, expiresAt: Date.now() + t.expiresIn * 1000 };
  } else {
    const t = await tiktokShop.refresh(cred.refreshToken);
    next = { ...cred, accessToken: t.accessToken, refreshToken: t.refreshToken || cred.refreshToken, expiresAt: t.expiresAt, refreshExpiresAt: t.refreshExpiresAt };
  }
  await saveCredential(channel.org_id, channel.platform, channel.external_id, next);
  return next;
}

async function upsertChannel(orgId, platform, shopId, name) {
  await db.query(
    `INSERT INTO channels (org_id, platform, name, external_id, ai_enabled, is_active) VALUES (:orgId, :platform, :name, :shopId, 1, 1)
     ON DUPLICATE KEY UPDATE name = VALUES(name), is_active = 1`,
    { orgId, platform, name, shopId: String(shopId) },
  );
}

/* ------------------------------------------------------------------ connect */

/** OAuth return from Shopee (?code&shop_id): one shop. */
async function connectShopee(orgId, code, shopId) {
  if (!code || !shopId) throw badRequest('Shopee ไม่ได้ส่งรหัสยืนยันหรือรหัสร้านกลับมา');
  const t = await shopee.getToken(code, shopId);
  const name = (await shopee.shopName(t.accessToken, shopId)) || `ร้าน Shopee ${shopId}`;
  await upsertChannel(orgId, 'shopee', shopId, name);
  await saveCredential(orgId, 'shopee', shopId, { accessToken: t.accessToken, refreshToken: t.refreshToken, expiresAt: Date.now() + t.expiresIn * 1000 });
  return { connected: 1, names: [name] };
}

/** OAuth return from TikTok Shop (?code): every shop the seller authorized. */
async function connectTiktok(orgId, code) {
  if (!code) throw badRequest('TikTok Shop ไม่ได้ส่งรหัสยืนยันกลับมา');
  const t = await tiktokShop.getToken(code);
  const shops = await tiktokShop.shops(t.accessToken);
  if (!shops.length) throw badRequest('บัญชีนี้ยังไม่มีร้าน TikTok Shop ที่อนุญาตให้แอปเข้าถึง');
  for (const s of shops) {
    await upsertChannel(orgId, 'tiktok', s.id, s.name || `ร้าน TikTok ${s.id}`);
    await saveCredential(orgId, 'tiktok', s.id, {
      accessToken: t.accessToken,
      refreshToken: t.refreshToken,
      expiresAt: t.expiresAt,
      refreshExpiresAt: t.refreshExpiresAt,
      shopCipher: s.cipher,
    });
  }
  return { connected: shops.length, names: shops.map((s) => s.name) };
}

/* ---------------------------------------------------------------- messages */

const SHOPEE_LABEL = { image: '[ส่งรูปภาพ]', sticker: '[ส่งสติกเกอร์]', item: '[ส่งสินค้า]', order: '[ส่งคำสั่งซื้อ]', video: '[ส่งวิดีโอ]', product_list: '[ส่งรายการสินค้า]' };
const TIKTOK_LABEL = { IMAGE: '[ส่งรูปภาพ]', VIDEO: '[ส่งวิดีโอ]', PRODUCT_CARD: '[ส่งสินค้า]', ORDER_CARD: '[ส่งคำสั่งซื้อ]', EMOTICONS: '[ส่งอีโมจิ]', COUPON_CARD: '[ส่งคูปอง]' };

function parseJson(v) {
  if (v && typeof v === 'object') return v;
  try {
    return JSON.parse(v);
  } catch {
    return null;
  }
}

/** Platform messages → buyer messages, oldest first: { id, text, at, buyerId, buyerName } */
function buyerMessages(platform, shopId, list) {
  const out = [];
  for (const m of list) {
    if (platform === 'shopee') {
      if (String(m.from_shop_id ?? '') === String(shopId) || !m.message_id) continue;
      const text = m.message_type === 'text' ? (m.content?.text ?? '') : (SHOPEE_LABEL[m.message_type] ?? `[${m.message_type}]`);
      out.push({ id: String(m.message_id), text, at: Number(m.created_timestamp) * 1000, buyerId: m.from_id, buyerName: null });
    } else {
      if (m.sender?.role !== 'BUYER' || !m.id || m.is_visible === false) continue;
      const c = parseJson(m.content);
      const text = m.type === 'TEXT' ? (c?.content ?? '') : (TIKTOK_LABEL[m.type] ?? `[${m.type}]`);
      out.push({ id: String(m.id), text, at: Number(m.create_time) * 1000, buyerId: m.sender.im_user_id, buyerName: m.sender.nickname ?? null });
    }
  }
  return out.filter((m) => m.text).sort((a, b) => a.at - b.at);
}

/**
 * Store the buyer's new messages of one conversation and let the AI answer the latest one.
 * @returns {{ingested:number, conversationId:number|null}}
 */
async function syncConversation(channel, conversationId, { buyerName = null } = {}) {
  const cred = await freshCredential(channel);
  const list =
    channel.platform === 'shopee'
      ? await shopee.messages(cred.accessToken, channel.external_id, conversationId)
      : await tiktokShop.messages(cred.accessToken, cred.shopCipher, conversationId);
  let ingested = 0;
  let latest = null;
  let convId = null;
  for (const m of buyerMessages(channel.platform, channel.external_id, list)) {
    const r = await inbox.ingestInbound({
      channel,
      threadId: String(conversationId),
      customerName: m.buyerName || buyerName,
      text: m.text,
      externalMessageId: m.id,
      threadMeta: channel.platform === 'shopee' ? { toId: m.buyerId } : null,
    });
    convId = r.conversationId;
    if (!r.duplicate) {
      ingested += 1;
      latest = m;
    }
  }
  if (latest && Date.now() - latest.at < ANSWER_WITHIN_MS) {
    // lazy: the webhook module owns the "reply now + queued fallback" helper
    await require('./webhooks.routes').respond(convId);
  }
  return { ingested, conversationId: convId };
}

/** Conversations with unread buyer messages, for the poll. */
async function unreadConversations(channel) {
  const cred = await freshCredential(channel);
  if (channel.platform === 'shopee') {
    const list = await shopee.conversations(cred.accessToken, channel.external_id);
    return list.filter((c) => Number(c.unread_count) > 0).map((c) => ({ id: String(c.conversation_id), buyerName: c.to_name ?? null }));
  }
  const list = await tiktokShop.conversations(cred.accessToken, cred.shopCipher);
  return list
    .filter((c) => Number(c.unread_count) > 0)
    .map((c) => ({ id: String(c.id), buyerName: (c.participants ?? []).find((p) => p.role === 'BUYER')?.nickname ?? null }));
}

/** Recurring job: sync every shop's unread conversations. One failing shop does not stop the others. */
async function pollAll() {
  const channels = await db.query("SELECT * FROM channels WHERE platform IN ('shopee','tiktok') AND is_active = 1");
  const result = { shops: channels.length, conversations: 0, ingested: 0, failed: 0 };
  for (const channel of channels) {
    try {
      for (const c of await unreadConversations(channel)) {
        const r = await syncConversation(channel, c.id, { buyerName: c.buyerName });
        result.conversations += 1;
        result.ingested += r.ingested;
      }
    } catch (err) {
      result.failed += 1;
      logger.warn({ err: err.message, channelId: channel.id }, 'marketplace chat poll failed');
    }
  }
  return result;
}

/** Reply on Shopee / TikTok (called by inbox.deliver). */
async function deliver(conversation, channel, text) {
  const cred = await freshCredential(channel);
  if (channel.platform === 'shopee') {
    const toId = parseJson(conversation.platform_meta)?.toId;
    if (!toId) throw badRequest('ยังไม่รู้รหัสผู้ซื้อของแชตนี้ — รอให้ลูกค้าส่งข้อความเข้ามาก่อน');
    await shopee.sendText(cred.accessToken, channel.external_id, toId, text);
  } else {
    await tiktokShop.sendText(cred.accessToken, cred.shopCipher, conversation.external_thread_id, text);
  }
  return { delivered: true, via: 'api' };
}

module.exports = { connectShopee, connectTiktok, syncConversation, pollAll, deliver, freshCredential, buyerMessages, PLATFORM_LABEL };
