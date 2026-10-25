'use strict';

// "เชื่อมต่อ LINE OA": the OA behind the access token becomes the LINE channel (its bot user ID is the
// webhook destination), the LINE webhook is pointed at us and tested; webhook trouble is a warning.
process.env.NODE_ENV = 'test';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { createApp } = require('../src/app');
const db = require('../src/db/pool');

const app = createApp();
const RUN = Date.now().toString(36);
const BOT = `Ubot${RUN}`;
const KEYS = ['LINE_CHANNEL_SECRET', 'LINE_CHANNEL_ACCESS_TOKEN', 'PUBLIC_API_URL'];
const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
const originalFetch = global.fetch;
const calls = [];
let webhookFails = false;
let manager;
let viewer;

const json = (b, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json' } });
async function login(email) {
  const res = await request(app).post('/api/auth/login').send({ email, password: 'Admin@1234' });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const cookie = res.headers['set-cookie'].map((c) => c.split(';')[0]).join('; ');
  return { post: (url, body) => request(app).post(url).set('Cookie', cookie).send(body ?? {}) };
}

before(async () => {
  process.env.LINE_CHANNEL_SECRET = 'line-secret';
  process.env.LINE_CHANNEL_ACCESS_TOKEN = 'line-token';
  process.env.PUBLIC_API_URL = 'https://api.shop.test';
  global.fetch = async (url, init = {}) => {
    const u = String(url);
    calls.push({ url: u, method: init.method ?? 'GET', body: init.body ? JSON.parse(init.body) : null, auth: init.headers?.Authorization });
    if (u.endsWith('/v2/bot/info')) return json({ userId: BOT, basicId: '@shop', displayName: 'ร้านทดสอบ OA' });
    if (u.endsWith('/channel/webhook/endpoint')) return webhookFails ? json({ message: 'Invalid webhook endpoint URL' }, 400) : json({});
    if (u.endsWith('/channel/webhook/test')) return json({ success: true, timestamp: '2026-10-25T00:00:00Z', statusCode: 200, reason: 'OK', detail: '200' });
    return json({});
  };
  manager = await login('manager@example.com');
  viewer = await login('viewer@example.com');
});

after(async () => {
  global.fetch = originalFetch;
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  await db.query('DELETE FROM channels WHERE external_id = :id', { id: BOT });
  await db.pool.end();
});

test('connect: the OA becomes the LINE channel and the webhook is set and tested', async () => {
  const res = await manager.post('/api/inbox/channels/line/connect');
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const d = res.body.data;
  assert.equal(d.channel.externalId, BOT);
  assert.equal(d.channel.name, 'ร้านทดสอบ OA');
  assert.equal(d.webhookUrl, 'https://api.shop.test/webhooks/line');
  assert.equal(d.webhookSet, true);
  assert.equal(d.webhookTest.success, true);
  assert.deepEqual(d.warnings, []);
  const put = calls.find((c) => c.url.endsWith('/channel/webhook/endpoint'));
  assert.equal(put.method, 'PUT');
  assert.equal(put.body.endpoint, 'https://api.shop.test/webhooks/line');
  assert.equal(put.auth, 'Bearer line-token');
  const ch = await db.one("SELECT * FROM channels WHERE platform = 'line' AND external_id = :id", { id: BOT });
  assert.equal(ch.is_active, 1);
  assert.equal(ch.ai_enabled, 1);
});

test('connect again: same channel, webhook failure is only a warning', async () => {
  webhookFails = true;
  const res = await manager.post('/api/inbox/channels/line/connect');
  webhookFails = false;
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.data.webhookSet, false);
  assert.match(res.body.data.warnings[0], /ตั้ง webhook อัตโนมัติไม่สำเร็จ/);
  const [{ n }] = await db.query("SELECT COUNT(*) AS n FROM channels WHERE platform = 'line' AND external_id = :id", { id: BOT });
  assert.equal(Number(n), 1);
});

test('connect: no token → a Thai 400; viewers may not connect', async () => {
  delete process.env.LINE_CHANNEL_ACCESS_TOKEN;
  const res = await manager.post('/api/inbox/channels/line/connect');
  process.env.LINE_CHANNEL_ACCESS_TOKEN = 'line-token';
  assert.equal(res.status, 400);
  assert.match(res.body.error.message, /Channel access token/);
  assert.equal((await viewer.post('/api/inbox/channels/line/connect')).status, 403);
});
