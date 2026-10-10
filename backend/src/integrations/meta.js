'use strict';

const crypto = require('node:crypto');
const { defineAdapter } = require('./define');
const { AppError, notImplemented } = require('../core/errors');

const graph = () => `https://graph.facebook.com/${process.env.META_GRAPH_VERSION || 'v23.0'}`;

const adapter = defineAdapter(
  {
    id: 'meta',
    name: 'Meta Graph API (Facebook / Instagram / Messenger)',
    category: 'social',
    usedBy: ['social', 'inbox'],
    phase: 4,
    purpose: 'รับ-ตอบแชต Messenger / Instagram Direct (webhook: /webhooks/meta) และโพสต์ Reels ในเฟส 7',
    applyUrl: 'https://developers.facebook.com/apps/',
    env: [
      { name: 'META_APP_SECRET' },
      { name: 'META_WEBHOOK_VERIFY_TOKEN' },
      { name: 'META_APP_ID', optional: true },
      { name: 'META_GRAPH_VERSION', optional: true, default: 'v23.0' },
    ],
  },
  {
    /** GET handshake when the webhook is registered in the Meta app dashboard. */
    verifyChallenge(query) {
      const { META_WEBHOOK_VERIFY_TOKEN } = adapter.requireConfig();
      return query['hub.mode'] === 'subscribe' && query['hub.verify_token'] === META_WEBHOOK_VERIFY_TOKEN ? query['hub.challenge'] : null;
    },

    /** X-Hub-Signature-256 = "sha256=" + hex(HMAC-SHA256(raw body, app secret)) */
    verifySignature(rawBody, header) {
      const { META_APP_SECRET } = adapter.requireConfig();
      if (!header || !String(header).startsWith('sha256=')) return false;
      const expected = `sha256=${crypto.createHmac('sha256', META_APP_SECRET).update(rawBody).digest('hex')}`;
      const a = Buffer.from(expected);
      const b = Buffer.from(String(header));
      return a.length === b.length && crypto.timingSafeEqual(a, b);
    },

    /**
     * Send API (Messenger and Instagram Direct share it). messaging_type RESPONSE is only valid
     * inside the 24-hour standard messaging window that starts with the customer's last message.
     */
    async sendMessage(pageToken, recipientId, text) {
      const res = await fetch(`${graph()}/me/messages?access_token=${encodeURIComponent(pageToken)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recipient: { id: recipientId }, messaging_type: 'RESPONSE', message: { text: text.slice(0, 2000) } }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new AppError(502, 'META_API_ERROR', `Meta API ${res.status}: ${body?.error?.message ?? ''}`.slice(0, 300));
      }
      return res.json();
    },

    /** Reels publishing arrives with the social module (phase 7). */
    publishPageReel() {
      throw notImplemented('Meta: publishPageReel จะเปิดใช้งานในเฟสที่ 7');
    },
    publishInstagramReel() {
      throw notImplemented('Meta: publishInstagramReel จะเปิดใช้งานในเฟสที่ 7');
    },
  },
);

module.exports = adapter;
