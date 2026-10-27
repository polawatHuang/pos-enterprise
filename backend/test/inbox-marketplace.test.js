'use strict';

// Shopee / TikTok Shop chat in the inbox: connect a shop (OAuth), receive buyer messages from a
// signed push / webhook (read back from the platform API), reply through the API, refresh tokens,
// and poll unread chats. Platform APIs are mocked on global.fetch.
process.env.NODE_ENV = 'test';
process.env.APP_ENCRYPTION_KEY = process.env.APP_ENCRYPTION_KEY || Buffer.alloc(32, 7).toString('base64');

const crypto = require('node:crypto');
const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { createApp } = require('../src/app');
const db = require('../src/db/pool');
const inbox = require('../src/modules/inbox/inbox.service');
const marketplace = require('../src/modules/inbox/marketplace.service');

const app = createApp();
const RUN = Date.now().toString(36);
const SHOP = `9${Date.now() % 1e8}`;
const TT_SHOP = `7${Date.now() % 1e8}`;
const ENV = {
  SHOPEE_PARTNER_ID: '100200',
  SHOPEE_PARTNER_KEY: 'shopee-key',
  SHOPEE_REDIRECT_URL: 'https://app.shop.test/api/inbox/marketplace/shopee/callback',
  SHOPEE_API_BASE: 'https://partner.shopee.test',
  TIKTOK_SHOP_APP_KEY: 'ttkey',
  TIKTOK_SHOP_APP_SECRET: 'ttsecret',
  TIKTOK_SHOP_SERVICE_ID: 'svc-1',
  TIKTOK_SHOP_API_BASE: 'https://open-api.tiktok.test',
  PUBLIC_API_URL: 'https://api.shop.test',
};
const saved = Object.fromEntries([...Object.keys(ENV), 'MINIMAX_API_KEY', 'ANTHROPIC_API_KEY'].map((k) => [k, process.env[k]]));
const originalFetch = global.fetch;
let calls = [];
let shopeeMessages = [];
let ttMessages = [];
let manager;

const json = (b, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json' } });
const nowS = () => Math.floor(Date.now() / 1000);
async function waitFor(fn, ms = 3000) {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v || Date.now() > end) return v;
    await new Promise((r) => setTimeout(r, 50));
  }
}
const channelOf = (platform, shopId) => db.one('SELECT * FROM channels WHERE platform = :platform AND external_id = :shopId', { platform, shopId });

before(async () => {
  Object.assign(process.env, ENV);
  delete process.env.MINIMAX_API_KEY; // AI off: chats go to a human, no model calls
  delete process.env.ANTHROPIC_API_KEY;
  global.fetch = async (url, init = {}) => {
    const u = new URL(String(url));
    calls.push({ url: u, method: init.method ?? 'GET', body: init.body ? JSON.parse(init.body) : null, headers: init.headers ?? {} });
    const p = u.pathname;
    // Shopee
    if (p === '/api/v2/auth/token/get') return json({ access_token: 'sp-at-1', refresh_token: 'sp-rt-1', expire_in: 14400 });
    if (p === '/api/v2/auth/access_token/get') return json({ access_token: 'sp-at-2', refresh_token: 'sp-rt-2', expire_in: 14400 });
    if (p === '/api/v2/shop/get_shop_info') return json({ shop_name: 'ร้านทดสอบ Shopee' });
    if (p === '/api/v2/sellerchat/get_message') return json({ response: { messages: shopeeMessages } });
    if (p === '/api/v2/sellerchat/get_conversation_list')
      return json({ response: { conversations: [{ conversation_id: `${RUN}1`, to_id: 555, to_name: 'buyer_sp', unread_count: 1 }] } });
    if (p === '/api/v2/sellerchat/send_message') return json({ response: { message_id: 'out-1' } });
    // TikTok Shop
    if (u.host === 'auth.tiktok-shops.com')
      return json({ code: 0, data: { access_token: 'tt-at', refresh_token: 'tt-rt', access_token_expire_in: nowS() + 7 * 86400, refresh_token_expire_in: nowS() + 30 * 86400 } });
    if (p === '/authorization/202309/shops') return json({ code: 0, data: { shops: [{ id: TT_SHOP, name: 'ร้านทดสอบ TikTok', cipher: 'cipher-1', region: 'TH' }] } });
    if (p.endsWith('/messages') && (init.method ?? 'GET') === 'GET') return json({ code: 0, data: { messages: ttMessages } });
    if (p.endsWith('/messages')) return json({ code: 0, data: { message_id: 'tt-out-1' } });
    return json({});
  };
  const res = await request(app).post('/api/auth/login').send({ email: 'manager@example.com', password: 'Admin@1234' });
  const cookie = res.headers['set-cookie'].map((c) => c.split(';')[0]).join('; ');
  manager = { get: (url) => request(app).get(url).set('Cookie', cookie) };
});

after(async () => {
  global.fetch = originalFetch;
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  await new Promise((r) => setTimeout(r, 300));
  const chans = await db.query('SELECT id FROM channels WHERE external_id IN (:ids)', { ids: [SHOP, TT_SHOP] });
  if (chans.length) {
    const convs = await db.query('SELECT id, customer_id FROM conversations WHERE channel_id IN (:ids)', { ids: chans.map((c) => c.id) });
    if (convs.length) {
      await db.query('DELETE FROM messages WHERE conversation_id IN (:ids)', { ids: convs.map((c) => c.id) });
      await db.query("DELETE FROM jobs WHERE type = 'inbox.ai_reply'");
      await db.query('DELETE FROM conversations WHERE id IN (:ids)', { ids: convs.map((c) => c.id) });
      await db.query('DELETE FROM customers WHERE id IN (:ids)', { ids: convs.map((c) => c.customer_id).filter(Boolean) });
    }
    await db.query('DELETE FROM channels WHERE id IN (:ids)', { ids: chans.map((c) => c.id) });
  }
  await db.query('DELETE FROM integration_credentials WHERE account_ref IN (:ids)', { ids: [SHOP, TT_SHOP] });
  await db.pool.end();
});

describe('Shopee', () => {
  test('connect: start gives a signed authorize link; the callback saves the shop and its tokens', async () => {
    const start = await manager.get('/api/inbox/marketplace/shopee/start');
    assert.equal(start.status, 200, JSON.stringify(start.body));
    const link = new URL(start.body.data.url);
    assert.equal(link.pathname, '/api/v2/shop/auth_partner');
    const ts = link.searchParams.get('timestamp');
    const expected = crypto.createHmac('sha256', 'shopee-key').update(`100200/api/v2/shop/auth_partner${ts}`).digest('hex');
    assert.equal(link.searchParams.get('sign'), expected);
    const state = new URL(link.searchParams.get('redirect')).searchParams.get('state');

    const bad = await request(app).get('/api/inbox/marketplace/shopee/callback').query({ state: 'nope', code: 'c', shop_id: SHOP });
    assert.match(bad.headers.location, /error=/);
    const cb = await request(app).get('/api/inbox/marketplace/shopee/callback').query({ state, code: 'code-1', shop_id: SHOP });
    assert.equal(cb.status, 302);
    assert.match(cb.headers.location, /connected=shopee/);
    const ch = await channelOf('shopee', SHOP);
    assert.equal(ch.name, 'ร้านทดสอบ Shopee');
    assert.equal(ch.ai_enabled, 1);
    const tokenCall = calls.find((c) => c.url.pathname === '/api/v2/auth/token/get');
    assert.equal(tokenCall.body.code, 'code-1');
    assert.equal(tokenCall.body.shop_id, Number(SHOP));
  });

  test('push: bad signature is refused; a webchat push stores the buyer messages only, once', async () => {
    const body = JSON.stringify({ code: 10, shop_id: Number(SHOP), data: { type: 'message', content: { conversation_id: `${RUN}1`, from_user_name: 'buyer_sp' } } });
    const send = (sig) => request(app).post('/webhooks/shopee').set('Content-Type', 'application/json').set('Authorization', sig).send(body);
    assert.equal((await send('bad')).status, 401);
    shopeeMessages = [
      { message_id: 'sp-m2', message_type: 'image', from_id: 555, from_shop_id: 0, created_timestamp: nowS(), content: { url: 'x' } },
      { message_id: 'sp-m1', message_type: 'text', from_id: 555, from_shop_id: 0, created_timestamp: nowS() - 5, content: { text: 'มีสีดำไหมคะ' } },
      { message_id: 'sp-m0', message_type: 'text', from_id: 1, from_shop_id: Number(SHOP), created_timestamp: nowS() - 60, content: { text: 'สวัสดีค่ะ (ร้าน)' } },
    ];
    const sig = crypto.createHmac('sha256', 'shopee-key').update(`https://api.shop.test/webhooks/shopee|${body}`).digest('hex');
    assert.equal((await send(sig)).status, 200);
    const ch = await channelOf('shopee', SHOP);
    const conv = await waitFor(() => db.one('SELECT * FROM conversations WHERE channel_id = :id AND external_thread_id = :t', { id: ch.id, t: `${RUN}1` }));
    assert.ok(conv, 'conversation created');
    const msgs = await waitFor(async () => {
      const rows = await db.query("SELECT content FROM messages WHERE conversation_id = :id AND sender_type = 'customer' ORDER BY id", { id: conv.id });
      return rows.length === 2 ? rows : null;
    });
    assert.deepEqual(
      msgs.map((m) => m.content),
      ['มีสีดำไหมคะ', '[ส่งรูปภาพ]'],
    );
    assert.equal(JSON.parse((await db.one('SELECT platform_meta FROM conversations WHERE id = :id', { id: conv.id })).platform_meta).toId, 555);
    assert.equal(conv.customer_name, 'buyer_sp');
    // redelivery: nothing new
    await send(sig);
    await new Promise((r) => setTimeout(r, 200));
    const [{ n }] = await db.query("SELECT COUNT(*) AS n FROM messages WHERE conversation_id = :id AND sender_type = 'customer'", { id: conv.id });
    assert.equal(Number(n), 2);
  });

  test('reply goes to the buyer through send_message; an expiring token is refreshed first', async () => {
    const ch = await channelOf('shopee', SHOP);
    const conv = await db.one('SELECT * FROM conversations WHERE channel_id = :id', { id: ch.id });
    await inbox.saveChannelToken(ch, 'sp-at-1', { accessToken: 'sp-at-1', refreshToken: 'sp-rt-1', expiresAt: Date.now() + 60_000 });
    calls = [];
    const r = await inbox.sendReply({ conversationId: conv.id, text: 'มีค่ะ', senderType: 'agent' });
    assert.equal(r.deliveryStatus, 'delivered', r.error);
    assert.ok(calls.some((c) => c.url.pathname === '/api/v2/auth/access_token/get'), 'refreshed');
    const sent = calls.find((c) => c.url.pathname === '/api/v2/sellerchat/send_message');
    assert.deepEqual(sent.body, { to_id: 555, message_type: 'text', content: { text: 'มีค่ะ' } });
    assert.equal(sent.url.searchParams.get('access_token'), 'sp-at-2');
    assert.equal(sent.url.searchParams.get('shop_id'), SHOP);
  });
});

describe('TikTok Shop', () => {
  test('connect: every authorized shop becomes a channel with its shop cipher', async () => {
    const start = await manager.get('/api/inbox/marketplace/tiktok/start');
    const link = new URL(start.body.data.url);
    assert.equal(link.searchParams.get('service_id'), 'svc-1');
    const cb = await request(app).get('/api/inbox/marketplace/tiktok/callback').query({ state: link.searchParams.get('state'), code: 'tt-code' });
    assert.match(cb.headers.location, /connected=tiktok&count=1/);
    const ch = await channelOf('tiktok', TT_SHOP);
    assert.equal(ch.name, 'ร้านทดสอบ TikTok');
    const shopsCall = calls.find((c) => c.url.pathname === '/authorization/202309/shops');
    assert.equal(shopsCall.headers['x-tts-access-token'], 'tt-at');
  });

  test('webhook (14 new message): buyer messages only; the reply is a TEXT message with the shop cipher', async () => {
    const body = JSON.stringify({ type: 14, shop_id: TT_SHOP, tts_notification_id: `n-${RUN}`, data: { conversation_id: `tt-${RUN}` } });
    const send = (sig) => request(app).post('/webhooks/tiktok').set('Content-Type', 'application/json').set('Authorization', sig).send(body);
    assert.equal((await send('bad')).status, 401);
    ttMessages = [
      { id: 'tt-m2', type: 'TEXT', content: JSON.stringify({ content: 'ส่งวันไหนคะ' }), create_time: nowS(), sender: { role: 'BUYER', im_user_id: 'b1', nickname: 'แพร' } },
      { id: 'tt-m1', type: 'TEXT', content: JSON.stringify({ content: 'ขอบคุณที่สั่งค่ะ' }), create_time: nowS() - 30, sender: { role: 'SHOP', im_user_id: 's1' } },
      { id: 'tt-m0', type: 'ORDER_CARD', content: '{}', create_time: nowS() - 60, sender: { role: 'SYSTEM' } },
    ];
    const sig = crypto.createHmac('sha256', 'ttsecret').update(`ttkey${body}`).digest('hex');
    assert.equal((await send(sig)).status, 200);
    const ch = await channelOf('tiktok', TT_SHOP);
    const conv = await waitFor(() => db.one('SELECT * FROM conversations WHERE channel_id = :id AND external_thread_id = :t', { id: ch.id, t: `tt-${RUN}` }));
    assert.ok(conv);
    assert.equal(conv.customer_name, 'แพร');
    const rows = await waitFor(async () => {
      const r = await db.query("SELECT content FROM messages WHERE conversation_id = :id AND sender_type = 'customer'", { id: conv.id });
      return r.length ? r : null;
    });
    assert.deepEqual(
      rows.map((m) => m.content),
      ['ส่งวันไหนคะ'],
    );

    calls = [];
    const r = await inbox.sendReply({ conversationId: conv.id, text: 'พรุ่งนี้ค่ะ', senderType: 'agent' });
    assert.equal(r.deliveryStatus, 'delivered', r.error);
    const sent = calls.find((c) => c.method === 'POST' && c.url.pathname === `/customer_service/202309/conversations/tt-${RUN}/messages`);
    assert.deepEqual(sent.body, { type: 'TEXT', content: JSON.stringify({ content: 'พรุ่งนี้ค่ะ' }) });
    assert.equal(sent.url.searchParams.get('shop_cipher'), 'cipher-1');
    // the request signature covers path, sorted query and body
    const q = Object.fromEntries(sent.url.searchParams);
    const base = Object.keys(q)
      .filter((k) => k !== 'sign')
      .sort()
      .map((k) => `${k}${q[k]}`)
      .join('');
    const expected = crypto.createHmac('sha256', 'ttsecret').update(`ttsecret${sent.url.pathname}${base}${JSON.stringify(sent.body)}ttsecret`).digest('hex');
    assert.equal(q.sign, expected);
  });
});

test('poll: unread Shopee chats are synced without a push', async () => {
  shopeeMessages = [{ message_id: `sp-poll-${RUN}`, message_type: 'text', from_id: 555, from_shop_id: 0, created_timestamp: nowS(), content: { text: 'ยังอยู่ไหมคะ' } }];
  ttMessages = [];
  const r = await marketplace.pollAll();
  assert.ok(r.ingested >= 1, JSON.stringify(r));
  const row = await db.one('SELECT id FROM messages WHERE external_message_id = :id', { id: `sp-poll-${RUN}` });
  assert.ok(row);
});

test('buyerMessages: TikTok hidden and non-buyer messages are skipped', () => {
  const out = marketplace.buyerMessages('tiktok', TT_SHOP, [
    { id: 'a', type: 'TEXT', content: '{"content":"hi"}', create_time: 2, sender: { role: 'BUYER' }, is_visible: false },
    { id: 'b', type: 'IMAGE', content: '{}', create_time: 1, sender: { role: 'BUYER' } },
  ]);
  assert.deepEqual(
    out.map((m) => m.text),
    ['[ส่งรูปภาพ]'],
  );
});
