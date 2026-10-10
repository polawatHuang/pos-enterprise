'use strict';

const { defineAdapter } = require('./define');
const { notImplemented } = require('../core/errors');

// Interface is fixed now so modules can be built against it; bodies land in phase 4.
const planned = (method) => () => {
  adapter.requireConfig();
  throw notImplemented(`LINE Messaging API: ${method} จะเปิดใช้งานในเฟสที่ 4`);
};

const adapter = defineAdapter(
  {
    id: 'line',
    name: 'LINE Messaging API',
    category: 'chat',
    usedBy: ['inbox'],
    phase: 4,
    purpose: 'รับ-ตอบแชตลูกค้าจาก LINE Official Account',
    applyUrl: 'https://developers.line.biz/console/',
    env: [
      { name: 'LINE_CHANNEL_SECRET' },
      { name: 'LINE_CHANNEL_ACCESS_TOKEN' },
    ],
  },
  {
    /** x-line-signature = base64(HMAC-SHA256(body, channel secret)) */
    verifySignature: planned('verifySignature'),
    /** POST https://api.line.me/v2/bot/message/reply (reply token valid ~1 min) */
    reply: planned('reply'),
    /** POST https://api.line.me/v2/bot/message/push (counts against message quota) */
    push: planned('push'),
  },
);

module.exports = adapter;
