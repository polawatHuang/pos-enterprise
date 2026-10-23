'use strict';

const crypto = require('node:crypto');
const { defineAdapter } = require('./define');
const { AppError } = require('../core/errors');

const API = 'https://api.line.me/v2/bot';

const adapter = defineAdapter(
  {
    id: 'line',
    name: 'LINE Messaging API',
    category: 'chat',
    usedBy: ['inbox'],
    phase: 4,
    purpose: 'รับ-ตอบแชตลูกค้าจาก LINE Official Account (webhook: /webhooks/line)',
    applyUrl: 'https://developers.line.biz/console/',
    env: [
      { name: 'LINE_CHANNEL_SECRET' },
      // Optional here: the token can also be saved per channel in Inbox settings (encrypted in DB)
      { name: 'LINE_CHANNEL_ACCESS_TOKEN', optional: true },
    ],
  },
  {
    /** x-line-signature = base64(HMAC-SHA256(raw body, channel secret)) */
    verifySignature(rawBody, signature) {
      const { LINE_CHANNEL_SECRET } = adapter.requireConfig();
      if (!signature) return false;
      const expected = crypto.createHmac('sha256', LINE_CHANNEL_SECRET).update(rawBody).digest('base64');
      const a = Buffer.from(expected);
      const b = Buffer.from(String(signature));
      return a.length === b.length && crypto.timingSafeEqual(a, b);
    },

    async call(path, token, body, method = 'POST') {
      const res = await fetch(`${API}${path}`, {
        method,
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new AppError(502, 'LINE_API_ERROR', `LINE API ${res.status}: ${text.slice(0, 200)}`);
      }
      return res.status === 200 && method === 'GET' ? res.json() : null;
    },

    /** Free reply; the reply token is single-use and valid for about a minute. */
    reply(token, replyToken, text) {
      return adapter.call('/message/reply', token, { replyToken, messages: [{ type: 'text', text: text.slice(0, 5000) }] });
    },

    /** Push works any time but counts against the OA's monthly message quota. */
    push(token, to, text) {
      return adapter.call('/message/push', token, { to, messages: [{ type: 'text', text: text.slice(0, 5000) }] });
    },

    /** Push up to 5 prepared messages (e.g. a Flex report) in one request. */
    pushMessages(token, to, messages) {
      return adapter.call('/message/push', token, { to, messages: messages.slice(0, 5) });
    },

    async getProfile(token, userId) {
      try {
        return await adapter.call(`/profile/${encodeURIComponent(userId)}`, token, null, 'GET');
      } catch {
        return null;
      }
    },
  },
);

module.exports = adapter;
