'use strict';

const db = require('../../db/pool');
const logger = require('../../core/logger');
const { conflict, badRequest } = require('../../core/errors');
const { encryptJson, decryptJson } = require('../../utils/crypto');
const line = require('../../integrations/line');
const meta = require('../../integrations/meta');
const runtime = require('../../config/runtime');

/* ------------------------------------------------------------- credentials */

/**
 * Access token for a channel: per-channel token saved (encrypted) from Inbox settings,
 * falling back to a single-account env var.
 */
async function channelToken(channel) {
  const row = await db.one(
    'SELECT data_encrypted FROM integration_credentials WHERE org_id = :orgId AND provider = :provider AND account_ref = :ref',
    { orgId: channel.org_id, provider: channel.platform, ref: channel.external_id ?? 'default' },
  );
  if (row) {
    try {
      // Inbox saves {accessToken}; a page connected from โพสต์โซเชียล saves {pageToken} under the same key
      const data = decryptJson(row.data_encrypted);
      return data.accessToken ?? data.pageToken ?? null;
    } catch (err) {
      logger.error({ err, channelId: channel.id }, 'cannot decrypt channel token (APP_ENCRYPTION_KEY changed?)');
    }
  }
  if (channel.platform === 'line') return runtime.get('LINE_CHANNEL_ACCESS_TOKEN') || null;
  if (channel.platform === 'facebook' || channel.platform === 'instagram') return process.env.META_PAGE_ACCESS_TOKEN || null;
  return null;
}

/** Save a channel's token. Meta page tokens are stored under both names so Inbox and social posting share them. */
async function saveChannelToken(channel, accessToken, extra = {}) {
  if (!process.env.APP_ENCRYPTION_KEY) throw badRequest('ต้องตั้งค่า APP_ENCRYPTION_KEY บนเซิร์ฟเวอร์ก่อนบันทึก token');
  await db.query(
    `INSERT INTO integration_credentials (org_id, provider, account_ref, data_encrypted)
     VALUES (:orgId, :provider, :ref, :data)
     ON DUPLICATE KEY UPDATE data_encrypted = VALUES(data_encrypted)`,
    { orgId: channel.org_id, provider: channel.platform, ref: channel.external_id ?? 'default', data: encryptJson({ accessToken, ...(['facebook', 'instagram'].includes(channel.platform) ? { pageToken: accessToken } : {}), ...extra }) },
  );
}

/* ----------------------------------------------------------------- inbound */

/**
 * Store a customer message. Creates the conversation (and a customer record) on first contact.
 * Idempotent on the platform message id, because webhooks may be delivered more than once.
 * @returns {Promise<{conversationId:number, messageId:number, duplicate:boolean, isNew:boolean}>}
 */
async function ingestInbound({ channel, threadId, customerName, text, externalMessageId = null, attachments = null, threadMeta = null }) {
  return db.tx(async (conn) => {
    if (externalMessageId) {
      const [[dup]] = await conn.query(
        `SELECT m.id, m.conversation_id FROM messages m JOIN conversations c ON c.id = m.conversation_id
          WHERE c.channel_id = :channelId AND m.external_message_id = :mid LIMIT 1`,
        { channelId: channel.id, mid: externalMessageId },
      );
      if (dup) return { conversationId: dup.conversation_id, messageId: dup.id, duplicate: true, isNew: false };
    }
    let [[conv]] = await conn.query(
      'SELECT * FROM conversations WHERE channel_id = :channelId AND external_thread_id = :threadId FOR UPDATE',
      { channelId: channel.id, threadId },
    );
    let isNew = false;
    if (!conv) {
      isNew = true;
      const name = customerName || `ลูกค้า ${channel.platform.toUpperCase()}`;
      const [cust] = await conn.query('INSERT INTO customers (org_id, name, tags) VALUES (:orgId, :name, :tags)', {
        orgId: channel.org_id,
        name,
        tags: channel.platform,
      });
      const [ins] = await conn.query(
        `INSERT INTO conversations (org_id, channel_id, customer_id, external_thread_id, customer_name, status, mode)
         VALUES (:orgId, :channelId, :customerId, :threadId, :name, 'open', :mode)`,
        { orgId: channel.org_id, channelId: channel.id, customerId: cust.insertId, threadId, name, mode: channel.ai_enabled ? 'ai' : 'human' },
      );
      [[conv]] = await conn.query('SELECT * FROM conversations WHERE id = :id', { id: ins.insertId });
    }
    const [msg] = await conn.query(
      `INSERT INTO messages (conversation_id, direction, sender_type, content, attachments, external_message_id)
       VALUES (:conversationId, 'in', 'customer', :text, :attachments, :mid)`,
      { conversationId: conv.id, text, attachments: attachments ? JSON.stringify(attachments) : null, mid: externalMessageId },
    );
    await conn.query(
      `UPDATE conversations
          SET unread_count = unread_count + 1, last_message_at = UTC_TIMESTAMP(), last_customer_message_at = UTC_TIMESTAMP(),
              status = IF(status IN ('resolved','closed'), 'open', status),
              customer_name = COALESCE(customer_name, :name),
              platform_meta = COALESCE(:meta, platform_meta)
        WHERE id = :id`,
      { id: conv.id, name: customerName ?? null, meta: threadMeta ? JSON.stringify(threadMeta) : null },
    );
    return { conversationId: conv.id, messageId: msg.insertId, duplicate: false, isNew };
  });
}

/* ---------------------------------------------------------------- outbound */

const META_WINDOW_MS = 24 * 3600 * 1000;

/**
 * Deliver a reply on the customer's channel. `replyToken` (LINE) is used when still fresh,
 * otherwise push. Website/simulator channels have no delivery: the customer reads from the API.
 */
async function deliver(conversation, channel, text, { replyToken } = {}) {
  if (channel.platform === 'website' || channel.platform === 'email') return { delivered: false, via: 'none' };
  // Shopee / TikTok Shop keep refreshable tokens of their own
  if (channel.platform === 'shopee' || channel.platform === 'tiktok') return require('./marketplace.service').deliver(conversation, channel, text);
  const token = await channelToken(channel);
  if (!token) throw badRequest(`ช่องทาง ${channel.name} ยังไม่ได้ตั้งค่า access token`);
  if (channel.platform === 'line') {
    if (replyToken) {
      try {
        await line.reply(token, replyToken, text);
        return { delivered: true, via: 'reply' };
      } catch (err) {
        logger.warn({ err: err.message }, 'LINE reply token failed, falling back to push');
      }
    }
    await line.push(token, conversation.external_thread_id, text);
    return { delivered: true, via: 'push' };
  }
  if (channel.platform === 'facebook' || channel.platform === 'instagram') {
    const last = conversation.last_customer_message_at ? new Date(conversation.last_customer_message_at).getTime() : 0;
    if (Date.now() - last > META_WINDOW_MS) {
      throw conflict('เกิน 24 ชั่วโมงนับจากข้อความล่าสุดของลูกค้า Meta ไม่อนุญาตให้ส่งข้อความทั่วไป');
    }
    await meta.sendMessage(token, conversation.external_thread_id, text);
    return { delivered: true, via: 'send_api' };
  }
  throw badRequest(`ช่องทาง ${channel.platform} ยังไม่รองรับการส่งข้อความ (รอสิทธิ์ API ของแพลตฟอร์ม)`);
}

/** Save an outbound message, then deliver it. Delivery failure is recorded, not thrown. */
async function sendReply({ conversationId, text, senderType, userId = null, aiMeta = null, replyToken = null }) {
  const conv = await db.one('SELECT * FROM conversations WHERE id = :id', { id: conversationId });
  const channel = await db.one('SELECT * FROM channels WHERE id = :id', { id: conv.channel_id });
  const ins = await db.query(
    `INSERT INTO messages (conversation_id, direction, sender_type, sender_user_id, content, delivery_status, ai_meta)
     VALUES (:conversationId, 'out', :senderType, :userId, :text, 'pending', :aiMeta)`,
    { conversationId, senderType, userId, text, aiMeta: aiMeta ? JSON.stringify(aiMeta) : null },
  );
  let status;
  let error = null;
  try {
    const r = await deliver(conv, channel, text, { replyToken });
    status = r.delivered ? 'delivered' : 'sent';
  } catch (err) {
    status = 'failed';
    error = err.message;
    logger.warn({ conversationId, err: err.message }, 'message delivery failed');
  }
  await db.query('UPDATE messages SET delivery_status = :status WHERE id = :id', { status, id: ins.insertId });
  await db.query(
    `UPDATE conversations SET last_message_at = UTC_TIMESTAMP()
       ${senderType === 'ai' ? ', last_ai_reply_at = UTC_TIMESTAMP()' : ''} WHERE id = :id`,
    { id: conversationId },
  );
  return { messageId: ins.insertId, deliveryStatus: status, error };
}

async function addSystemNote(conversationId, text) {
  await db.query(`INSERT INTO messages (conversation_id, direction, sender_type, content) VALUES (:id, 'out', 'system', :text)`, {
    id: conversationId,
    text,
  });
}

/** Hand the chat to a human: AI stops replying until someone switches it back on. */
async function handoff(conversationId, reason) {
  const r = await db.query(
    `UPDATE conversations SET mode = 'human', status = 'pending', handoff_reason = :reason WHERE id = :id AND mode <> 'human'`,
    { id: conversationId, reason: reason.slice(0, 255) },
  );
  if (r.affectedRows) await addSystemNote(conversationId, `ส่งต่อให้แอดมิน: ${reason}`);
}

module.exports = { channelToken, saveChannelToken, ingestInbound, deliver, sendReply, addSystemNote, handoff };
