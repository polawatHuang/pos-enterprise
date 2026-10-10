'use strict';

// Integration tests: need a MySQL/MariaDB with database/schema.sql + seed.sql imported
// and DB_* variables in backend/.env (or the environment).
process.env.NODE_ENV = 'test';

const { test, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { createApp } = require('../src/app');
const db = require('../src/db/pool');
const env = require('../src/config/env');

const app = createApp();
const PASSWORD = 'Admin@1234';

async function login(email) {
  const res = await request(app).post('/api/auth/login').send({ email, password: PASSWORD });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  return res;
}
const cookiesOf = (res) => res.headers['set-cookie'] || [];
const cookieHeader = (res) => cookiesOf(res).map((c) => c.split(';')[0]).join('; ');
const refreshCookie = (res) => cookiesOf(res).find((c) => c.startsWith('pe_rt=')).split(';')[0];

after(async () => {
  await db.query("DELETE FROM users WHERE email LIKE 'test.%@example.com'");
  await db.pool.end();
});

describe('health & infrastructure', () => {
  test('GET /api/health reports database ok', async () => {
    const res = await request(app).get('/api/health');
    assert.equal(res.status, 200);
    assert.equal(res.body.data.database, 'ok');
  });

  test('CORS allows configured origins only', async () => {
    const allowed = env.corsOrigins[0];
    const ok = await request(app).options('/api/auth/login').set('Origin', allowed).set('Access-Control-Request-Method', 'POST');
    assert.equal(ok.headers['access-control-allow-origin'], allowed);
    assert.equal(ok.headers['access-control-allow-credentials'], 'true');
    const bad = await request(app).options('/api/auth/login').set('Origin', 'https://evil.example').set('Access-Control-Request-Method', 'POST');
    assert.equal(bad.headers['access-control-allow-origin'], undefined);
  });

  test('cron tick requires the secret', async () => {
    assert.equal((await request(app).post('/internal/cron/tick')).status, 401);
    const res = await request(app).post('/internal/cron/tick').set('X-Cron-Secret', env.CRON_SECRET);
    assert.equal(res.status, 200);
    assert.equal(typeof res.body.data.processed, 'number');
  });
});

describe('auth', () => {
  test('rejects a wrong password', async () => {
    const res = await request(app).post('/api/auth/login').send({ email: 'manager@example.com', password: 'nope-nope1' });
    assert.equal(res.status, 401);
  });

  test('login sets httpOnly cookies and /me works with them', async () => {
    const res = await login('manager@example.com');
    const cookies = cookiesOf(res);
    assert.ok(cookies.some((c) => c.startsWith('pe_at=') && /HttpOnly/i.test(c)));
    assert.ok(cookies.some((c) => c.startsWith('pe_rt=') && /Path=\/api\/auth/i.test(c)));
    const me = await request(app).get('/api/auth/me').set('Cookie', cookieHeader(res));
    assert.equal(me.status, 200);
    assert.deepEqual(me.body.data.user.roles, ['manager']);
  });

  test('Bearer token works for non-browser clients', async () => {
    const res = await login('manager@example.com');
    const me = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${res.body.data.accessToken}`);
    assert.equal(me.status, 200);
  });

  test('refresh rotates the token and detects reuse', async () => {
    const res = await login('viewer@example.com');
    const rt1 = refreshCookie(res);
    const r1 = await request(app).post('/api/auth/refresh').set('Cookie', rt1);
    assert.equal(r1.status, 200);
    const rt2 = refreshCookie(r1);
    assert.notEqual(rt1, rt2);

    // Replaying the rotated token revokes the whole family, including rt2
    assert.equal((await request(app).post('/api/auth/refresh').set('Cookie', rt1)).status, 401);
    assert.equal((await request(app).post('/api/auth/refresh').set('Cookie', rt2)).status, 401);
  });

  test('logout revokes the refresh token', async () => {
    const res = await login('viewer@example.com');
    const rt = refreshCookie(res);
    assert.equal((await request(app).post('/api/auth/logout').set('Cookie', rt)).status, 200);
    assert.equal((await request(app).post('/api/auth/refresh').set('Cookie', rt)).status, 401);
  });
});

describe('RBAC', () => {
  test('cashier cannot see the dashboard but can reach POS', async () => {
    const c = cookieHeader(await login('cashier@example.com'));
    assert.equal((await request(app).get('/api/dashboard/summary').set('Cookie', c)).status, 403);
    assert.equal((await request(app).get('/api/pos/settings').set('Cookie', c)).status, 200);
    assert.equal((await request(app).get('/api/users').set('Cookie', c)).status, 403);
  });

  test('unauthenticated requests get 401', async () => {
    assert.equal((await request(app).get('/api/dashboard/summary')).status, 401);
  });

  test('admin-level user can create users, but only owner may grant owner', async () => {
    const owner = cookieHeader(await login('admin@example.com'));
    const created = await request(app)
      .post('/api/users')
      .set('Cookie', owner)
      .send({ email: 'test.support@example.com', fullName: 'Test Support', password: 'Passw0rd!', roles: ['support'] });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    assert.deepEqual(created.body.data.roles, ['support']);

    const manager = cookieHeader(await login('manager@example.com'));
    // manager has users:read only
    const denied = await request(app)
      .post('/api/users')
      .set('Cookie', manager)
      .send({ email: 'test.x@example.com', fullName: 'X', password: 'Passw0rd!', roles: ['owner'] });
    assert.equal(denied.status, 403);
  });

  test('validation errors return 400 with details', async () => {
    const owner = cookieHeader(await login('admin@example.com'));
    const res = await request(app).post('/api/users').set('Cookie', owner).send({ email: 'bad', roles: [] });
    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, 'VALIDATION_ERROR');
  });
});

describe('dashboard', () => {
  test('summary and widgets return data for seeded org', async () => {
    const c = cookieHeader(await login('manager@example.com'));
    const summary = await request(app).get('/api/dashboard/summary').set('Cookie', c);
    assert.equal(summary.status, 200);
    assert.ok(summary.body.data.monthToDate.revenue > 0);

    const trend = await request(app).get('/api/dashboard/sales-trend?days=30').set('Cookie', c);
    assert.equal(trend.body.data.length, 30);

    for (const path of ['channel-mix', 'top-products', 'cashflow', 'low-stock', 'inbox', 'trending', 'activity']) {
      const res = await request(app).get(`/api/dashboard/${path}`).set('Cookie', c);
      assert.equal(res.status, 200, path);
      assert.ok(Array.isArray(res.body.data), path);
    }
  });

  test('rejects unsupported ranges', async () => {
    const c = cookieHeader(await login('manager@example.com'));
    assert.equal((await request(app).get('/api/dashboard/sales-trend?days=13').set('Cookie', c)).status, 400);
  });
});
