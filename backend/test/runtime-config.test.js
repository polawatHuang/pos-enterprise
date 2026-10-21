'use strict';

// API keys saved from Settings > การเชื่อมต่อ API: stored encrypted, used before the server
// environment, never echoed back, and limited to integration settings.
process.env.NODE_ENV = 'test';
process.env.APP_ENCRYPTION_KEY = process.env.APP_ENCRYPTION_KEY || Buffer.alloc(32, 7).toString('base64');

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { createApp } = require('../src/app');
const db = require('../src/db/pool');
const runtime = require('../src/config/runtime');
const apify = require('../src/integrations/apify');
const minimax = require('../src/integrations/minimax');

const app = createApp();
const SECRET = 'apify_api_SECRET_value_9f3c';
const NAMES = ['APIFY_TOKEN', 'MINIMAX_MODEL', 'AI_PROVIDER'];
let owner;
let manager;
const savedEnv = process.env.APIFY_TOKEN;

async function cookie(email) {
  const res = await request(app).post('/api/auth/login').send({ email, password: 'Admin@1234' });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  return res.headers['set-cookie'].map((c) => c.split(';')[0]).join('; ');
}
const put = (values, who = owner) => request(app).put('/api/integrations/config').set('Cookie', who).send({ values });
const envOf = (body, id, name) => body.data.find((a) => a.id === id).env.find((e) => e.name === name);

before(async () => {
  delete process.env.APIFY_TOKEN;
  await db.query('DELETE FROM app_config WHERE name IN (:names)', { names: NAMES });
  await runtime.load();
  owner = await cookie('admin@example.com');
  manager = await cookie('manager@example.com');
});

after(async () => {
  await db.query('DELETE FROM app_config WHERE name IN (:names)', { names: NAMES });
  if (savedEnv !== undefined) process.env.APIFY_TOKEN = savedEnv;
  await db.pool.end();
});

test('a key saved from the web is used, stored encrypted and never returned', async () => {
  assert.equal(apify.isConfigured(), false);
  const res = await put({ APIFY_TOKEN: `  ${SECRET}  ` });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.ok(!JSON.stringify(res.body).includes(SECRET), 'the secret is not echoed');
  const e = envOf(res.body, 'apify', 'APIFY_TOKEN');
  assert.deepEqual([e.set, e.source, e.secret, e.hint, e.envDefault], [true, 'db', true, '••••9f3c', false]);

  assert.equal(apify.isConfigured(), true);
  assert.equal(apify.requireConfig().APIFY_TOKEN, SECRET, 'trimmed value reaches the adapter');

  const row = await db.one("SELECT value_enc FROM app_config WHERE name = 'APIFY_TOKEN'");
  assert.ok(!row.value_enc.includes(SECRET), 'stored encrypted');
  const log = await db.one("SELECT metadata FROM audit_logs WHERE action = 'integrations.config_update' ORDER BY id DESC LIMIT 1");
  const meta = typeof log.metadata === 'string' ? log.metadata : JSON.stringify(log.metadata);
  assert.ok(meta.includes('APIFY_TOKEN') && !meta.includes(SECRET), 'audit keeps the name only');

  const status = await request(app).get('/api/integrations/status').set('Cookie', owner);
  assert.ok(!JSON.stringify(status.body).includes(SECRET));
});

test('the saved value wins over the environment; removing it falls back to .env', async () => {
  process.env.MINIMAX_MODEL = 'env-model';
  try {
    await put({ MINIMAX_MODEL: 'web-model' });
    assert.equal(minimax.requireConfig().MINIMAX_MODEL, 'web-model');
    const res = await put({ MINIMAX_MODEL: null, APIFY_TOKEN: '' });
    assert.equal(res.status, 200);
    const e = envOf(res.body, 'minimax', 'MINIMAX_MODEL');
    assert.deepEqual([e.source, e.hint], ['env', 'env-model'], 'non-secret values are shown in full');
    assert.equal(minimax.requireConfig().MINIMAX_MODEL, 'env-model');
    assert.equal(apify.isConfigured(), false);
  } finally {
    delete process.env.MINIMAX_MODEL;
  }
});

test('only integration settings can be changed, only by integrations:manage', async () => {
  for (const name of ['DB_PASSWORD', 'JWT_ACCESS_SECRET', 'CRON_SECRET', 'APP_ENCRYPTION_KEY']) {
    const res = await put({ [name]: 'x' });
    assert.equal(res.status, 400, name);
  }
  assert.equal((await put({ AI_PROVIDER: 'openai' })).status, 400);
  assert.equal((await put({ APIFY_TOKEN: 'x' }, manager)).status, 403);
  assert.equal((await request(app).get('/api/integrations/status').set('Cookie', manager)).status, 403);
  const n = await db.one("SELECT COUNT(*) AS n FROM app_config WHERE name = 'APIFY_TOKEN'");
  assert.equal(Number(n.n), 0);
});

test('connection test reports a clear error for unsupported or unknown services', async () => {
  assert.equal((await request(app).post('/api/integrations/apify/test').set('Cookie', owner)).status, 400);
  assert.equal((await request(app).post('/api/integrations/nope/test').set('Cookie', owner)).status, 404);
});
