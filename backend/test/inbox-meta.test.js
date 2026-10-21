'use strict';

// Inbox: connect Facebook Pages / Instagram with Facebook Login, platform filter, customer names from Meta.
process.env.NODE_ENV = 'test';
process.env.APP_ENCRYPTION_KEY = process.env.APP_ENCRYPTION_KEY || Buffer.alloc(32, 7).toString('base64');

const crypto = require('node:crypto');
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { createApp } = require('../src/app');
const db = require('../src/db/pool');
const inbox = require('../src/modules/inbox/inbox.service');
const { connectInboxPages } = require('../src/modules/inbox/channels.service');
const { signState } = require('../src/modules/social/accounts.service');

const app = createApp();
const RUN = Date.now().toString(36);
const PAGE = `test-pg-${RUN}`;
const IG = `test-ig-${RUN}`;
const ENV = {
  META_APP_ID: 'app-1',
  META_APP_SECRET: 'meta-secret',
  META_REDIRECT_URI: 'https://api.example.com/api/social/oauth/meta/callback',
  META_WEBHOOK_VERIFY_TOKEN: 'v',
};
const saved = Object.fromEntries([...Object.keys(ENV), 'MINIMAX_API_KEY'].map((k) => [k, process.env[k]]));
const originalFetch = global.fetch;
const calls = [];
let subscribeFails = false;
let manager;
let viewer;

const json = (b, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json' } });
async function cookie(email) {
  const res = await request(app).post('/api/auth/login').send({ email, password: 'Admin@1234' });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  return res.headers['set-cookie'].map((c) => c.split(';')[0]).join('; ');
}
const as = (c) => ({ get: (url) => request(app).get(url).set('Cookie', c) });

before(async () => {
  Object.assign(process.env, ENV);
  delete process.env.MINIMAX_API_KEY; // AI off: new chats go to a human, no model calls
  global.fetch = async (url, init = {}) => {
    const u = String(url);
    calls.push({ url: u, method: init.method ?? 'GET' });
    if (u.includes('/subscribed_apps'))
      return subscribeFails ? json({ error: { message: '(#200) Requires pages_messaging permission' } }, 403) : json({ success: true });
    if (u.includes('/oauth/access_token')) return json({ access_token: 'user-token', expires_in: 5000000 });
    if (u.includes('/me/accounts'))
      return json({ data: [{ id: PAGE, name: 'เพจร้าน', access_token: 'page-tok', instagram_business_account: { id: IG, username: 'shop_ig' } }] });
    if (u.includes('/IGBUYER?')) return json({ username: 'buyer' });
    if (u.includes('/FBBUYER?')) return json({ first_name: 'สมหญิง', last_name: 'ใจดี' });
    return json({});
  };
  manager = as(await cookie('manager@example.com'));
  viewer = as(await cookie('viewer@example.com'));
});

after(async () => {
  global.fetch = originalFetch;
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  await new Promise((r) => setTimeout(r, 300));
  const convs = await db.query('SELECT c.id, c.customer_id FROM conversations c JOIN channels ch ON ch.id = c.channel_id WHERE ch.external_id IN (:ids)', {
    ids: [PAGE, IG],
  });
  if (convs.length) {
    await db.query('DELETE FROM messages WHERE conversation_id IN (:ids)', { ids: convs.map((c) => c.id) });
    await db.query('DELETE FROM conversations WHERE id IN (:ids)', { ids: convs.map((c) => c.id) });
    await db.query('DELETE FROM customers WHERE id IN (:ids)', { ids: convs.map((c) => c.customer_id).filter(Boolean) });
  }
  await db.query("DELETE FROM jobs WHERE type = 'inbox.ai_reply'");
  await db.query('DELETE FROM integration_credentials WHERE account_ref IN (:ids)', { ids: [PAGE, IG] });
  await db.query('DELETE FROM channels WHERE external_id IN (:ids)', { ids: [PAGE, IG] });
  await db.pool.end();
});

test('Facebook Login start asks for the messaging permissions; viewer cannot connect', async () => {
  const r = await manager.get('/api/inbox/oauth/meta/start');
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const scope = new URL(r.body.data.url).searchParams.get('scope');
  for (const s of ['pages_messaging', 'pages_manage_metadata', 'instagram_manage_messages']) assert.ok(scope.includes(s), scope);
  assert.equal((await viewer.get('/api/inbox/oauth/meta/start')).status, 403);
});

test('the shared Meta callback (inbox state) creates the Page and Instagram channels with the page token and subscribes the page', async () => {
  const state = signState({ o: 1, u: 1, p: 'meta', k: 'inbox' });
  const res = await request(app).get('/api/social/oauth/meta/callback').query({ code: 'c', state });
  assert.equal(res.status, 302);
  assert.match(res.headers.location, /\/inbox\/settings\?tab=channels&connected=meta&count=2$/);
  const chans = await db.query('SELECT * FROM channels WHERE external_id IN (:ids) ORDER BY platform', { ids: [PAGE, IG] });
  assert.deepEqual(
    chans.map((c) => [c.platform, c.name]),
    [
      ['facebook', 'เพจร้าน'],
      ['instagram', '@shop_ig'],
    ],
  );
  for (const c of chans) assert.equal(await inbox.channelToken(c), 'page-tok');
  const sub = calls.find((c) => c.url.includes(`/${PAGE}/subscribed_apps`));
  assert.ok(sub && sub.method === 'POST' && sub.url.includes('subscribed_fields=messages'));

  // Connecting again updates in place; a refused subscription is reported, not hidden
  subscribeFails = true;
  try {
    const r = await connectInboxPages(1, [{ id: PAGE, name: 'เพจร้าน (ใหม่)', token: 'page-tok-2', instagram: null }]);
    assert.equal(r.connected, 1);
    assert.match(r.warnings[0], /pages_messaging/);
  } finally {
    subscribeFails = false;
  }
  const n = await db.one('SELECT COUNT(*) AS n FROM channels WHERE external_id = :id', { id: PAGE });
  assert.equal(Number(n.n), 1);
});

test('webhook: first message looks up the customer name; list filters by platform; summary counts platforms', async () => {
  const send = async (object, recipient, sender, mid) => {
    const payload = JSON.stringify({
      object,
      entry: [{ id: recipient, messaging: [{ sender: { id: sender }, recipient: { id: recipient }, message: { mid, text: 'สนใจค่ะ' } }] }],
    });
    const sig = `sha256=${crypto.createHmac('sha256', ENV.META_APP_SECRET).update(payload).digest('hex')}`;
    assert.equal((await request(app).post('/webhooks/meta').set('Content-Type', 'application/json').set('x-hub-signature-256', sig).send(payload)).status, 200);
  };
  await send('instagram', IG, 'IGBUYER', `ig-${RUN}`);
  await send('page', PAGE, 'FBBUYER', `fb-${RUN}`);
  const wait = async (t) => {
    for (let i = 0; i < 60; i += 1) {
      const c = await db.one('SELECT * FROM conversations WHERE external_thread_id = :t', { t });
      if (c) return c;
      await new Promise((r) => setTimeout(r, 50));
    }
    return null;
  };
  assert.equal((await wait('IGBUYER'))?.customer_name, '@buyer');
  assert.equal((await wait('FBBUYER'))?.customer_name, 'สมหญิง ใจดี');

  const ig = await manager.get('/api/inbox/conversations?view=all&platform=instagram');
  assert.equal(ig.status, 200);
  assert.ok(ig.body.data.some((c) => c.customerName === '@buyer'));
  assert.ok(ig.body.data.every((c) => c.platform === 'instagram'));
  const s = await manager.get('/api/inbox/summary');
  const igRow = s.body.data.platforms.find((p) => p.platform === 'instagram');
  assert.ok(igRow.channels >= 1 && igRow.open >= 1);
});
