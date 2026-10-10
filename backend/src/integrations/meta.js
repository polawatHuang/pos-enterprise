'use strict';

const { defineAdapter } = require('./define');
const { notImplemented } = require('../core/errors');

// Interface is fixed now so modules can be built against it; bodies land in phase 4.
const planned = (method) => () => {
  adapter.requireConfig();
  throw notImplemented(`Meta Graph API (Facebook / Instagram / Messenger): ${method} จะเปิดใช้งานในเฟสที่ 4`);
};

const adapter = defineAdapter(
  {
    id: 'meta',
    name: 'Meta Graph API (Facebook / Instagram / Messenger)',
    category: 'social',
    usedBy: ['social','inbox'],
    phase: 4,
    purpose: 'โพสต์ Reels ลง Facebook Page / Instagram และรับ-ตอบแชต Messenger / IG Direct',
    applyUrl: 'https://developers.facebook.com/apps/',
    env: [
      { name: 'META_APP_ID' },
      { name: 'META_APP_SECRET' },
      { name: 'META_WEBHOOK_VERIFY_TOKEN' },
      { name: 'META_GRAPH_VERSION', optional: true, default: 'v23.0' },
    ],
  },
  {
    /** GET hub.challenge handshake + X-Hub-Signature-256 HMAC check on POST */
    verifyWebhook: planned('verifyWebhook'),
    /** POST /{page-id}/messages (respect 24h standard messaging window) */
    sendMessage: planned('sendMessage'),
    /** POST /{page-id}/video_reels (upload_phase start/transfer/finish) */
    publishPageReel: planned('publishPageReel'),
    /** POST /{ig-user-id}/media (media_type=REELS) then /media_publish */
    publishInstagramReel: planned('publishInstagramReel'),
  },
);

module.exports = adapter;
