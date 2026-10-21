'use strict';

// Audit log viewer: filters, keyset pagination, facets, secret masking, CSV export and RBAC.
// Requires schema.sql + seed.sql (+ migrations) imported.
process.env.NODE_ENV = 'test';

const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { createApp } = require('../src/app');
const db = require('../src/db/pool');
const env = require('../src/config/env');

const app = createApp();
const RUN = Date.now().toString(36);
// Own action prefix so the assertions only see the rows this file inserts
const MOD = `zzaudit${RUN.replace(/[^a-z]/g, '')}`.slice(0, 40);
const MANAGER_ID = 2;
const VIEWER_ID = 7;
let manager;
let viewer;
let otherOrgId = null;

async function cookie(email) {
  const res = await request(app).post('/api/auth/login').send({ email, password: 'Admin@1234' });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  return res.headers['set-cookie'].map((c) => c.split(';')[0]).join('; ');
}
const as = (c) => ({ get: (url) => request(app).get(url).set('Cookie', c) });

/** A business-local wall-clock time (APP_TZ_OFFSET) as a UTC Date for created_at. */
const local = (ymdhm) => new Date(`${ymdhm}:00${env.APP_TZ_OFFSET}`);

async function insert(row) {
  const r = await db.query(
    `INSERT INTO audit_logs (org_id, user_id, action, entity_type, entity_id, metadata, ip, created_at)
     VALUES (:orgId, :userId, :action, :entityType, :entityId, :metadata, :ip, :createdAt)`,
    {
      orgId: 1,
      userId: null,
      entityType: null,
      entityId: null,
      ip: '10.0.0.1',
      ...row,
      metadata: row.metadata === undefined ? null : JSON.stringify(row.metadata),
    },
  );
  return r.insertId;
}

const ids = {};

before(async () => {
  manager = await cookie('manager@example.com');
  viewer = await cookie('viewer@example.com');

  ids.create = await insert({
    userId: MANAGER_ID,
    action: `${MOD}.create`,
    entityType: 'product',
    entityId: `P-${RUN}`,
    metadata: { sku: `SKU-${RUN}`, name: 'สินค้าทดสอบ' },
    createdAt: local('2020-01-16T00:30'), // = 2020-01-15 17:30 UTC
  });
  ids.secret = await insert({
    userId: MANAGER_ID,
    action: `${MOD}.connect`,
    entityType: 'channel',
    entityId: `C-${RUN}`,
    metadata: {
      platform: 'line',
      accessToken: 'super-secret-token-value',
      nested: { apiKey: 'k-123', clientSecret: 'shh', list: [{ password: 'p@ss', ok: 1 }] },
      header: 'Bearer abc.def',
      fields: ['accessToken', 'name'],
    },
    createdAt: local('2020-01-17T10:00'),
  });
  ids.viewerUpdate = await insert({
    userId: VIEWER_ID,
    action: `${MOD}.update`,
    entityType: 'product',
    entityId: `P-${RUN}`,
    metadata: { fields: ['price'], note: `=HYPERLINK("x")` },
    createdAt: local('2020-01-18T09:00'),
  });
  ids.system = await insert({
    action: `${MOD}.sync`,
    entityId: `=cmd|${RUN}`,
    metadata: { runId: `R-${RUN}` },
    createdAt: local('2020-01-19T23:59'),
  });

  // A row in another organisation must never be visible
  const org = await db.query(`INSERT INTO organizations (name) VALUES (:name)`, { name: `Audit other ${RUN}` }).catch(() => null);
  if (org) {
    otherOrgId = org.insertId;
    ids.otherOrg = await insert({ orgId: otherOrgId, action: `${MOD}.create`, entityId: `P-${RUN}`, createdAt: local('2020-01-16T01:00') });
  }
});

after(async () => {
  await db.query('DELETE FROM audit_logs WHERE action LIKE :p', { p: `${MOD}.%` });
  if (otherOrgId) await db.query('DELETE FROM organizations WHERE id = :id', { id: otherOrgId });
  await db.pool.end();
});

const list = (query) => as(manager).get(`/api/audit?${new URLSearchParams({ module: MOD, ...query })}`);

describe('GET /api/audit', () => {
  test('requires audit:read', async () => {
    const res = await as(viewer).get('/api/audit');
    assert.equal(res.status, 403);
    assert.equal((await as(viewer).get('/api/audit/facets')).status, 403);
    assert.equal((await as(viewer).get('/api/audit/export.csv')).status, 403);
    assert.equal((await request(app).get('/api/audit')).status, 401);
  });

  test('module filter returns this org only, newest first, with the user joined', async () => {
    const res = await list({});
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const got = res.body.data.map((r) => r.id);
    assert.deepEqual(got, [ids.system, ids.viewerUpdate, ids.secret, ids.create]);
    const create = res.body.data.find((r) => r.id === ids.create);
    assert.equal(create.module, MOD);
    assert.equal(create.entityType, 'product');
    assert.equal(create.ip, '10.0.0.1');
    assert.deepEqual(create.metadata, { sku: `SKU-${RUN}`, name: 'สินค้าทดสอบ' });
    assert.equal(create.user.id, MANAGER_ID);
    assert.equal(create.user.email, 'manager@example.com');
    assert.ok(create.user.name);
    assert.equal(res.body.data.find((r) => r.id === ids.system).user, null);
  });

  test('filters by user, system, action prefix and entity', async () => {
    assert.deepEqual(
      (await list({ userId: String(VIEWER_ID) })).body.data.map((r) => r.id),
      [ids.viewerUpdate],
    );
    assert.deepEqual(
      (await list({ userId: 'system' })).body.data.map((r) => r.id),
      [ids.system],
    );
    assert.deepEqual(
      (await list({ action: `${MOD}.con` })).body.data.map((r) => r.id),
      [ids.secret],
    );
    const entity = await as(manager).get(`/api/audit?entityType=product&entityId=P-${RUN}`);
    assert.deepEqual(
      entity.body.data.map((r) => r.id),
      [ids.viewerUpdate, ids.create],
    );
  });

  test('date range is interpreted in the business timezone', async () => {
    // 2020-01-16 00:30 local is still the 15th in UTC: it belongs to the 16th
    assert.deepEqual(
      (await list({ from: '2020-01-16', to: '2020-01-16' })).body.data.map((r) => r.id),
      [ids.create],
    );
    assert.deepEqual((await list({ from: '2020-01-15', to: '2020-01-15' })).body.data, []);
    assert.deepEqual(
      (await list({ from: '2020-01-17', to: '2020-01-19' })).body.data.map((r) => r.id),
      [ids.system, ids.viewerUpdate, ids.secret],
    );
    assert.equal((await list({ from: '2020-01-19', to: '2020-01-17' })).status, 400);
    assert.equal((await list({ from: 'yesterday' })).status, 400);
  });

  test('free-text search matches action, entity id and metadata', async () => {
    assert.deepEqual(
      (await list({ q: `SKU-${RUN}` })).body.data.map((r) => r.id),
      [ids.create],
    );
    assert.deepEqual(
      (await list({ q: `R-${RUN}` })).body.data.map((r) => r.id),
      [ids.system],
    );
    assert.deepEqual(
      (await list({ q: `C-${RUN}` })).body.data.map((r) => r.id),
      [ids.secret],
    );
    assert.deepEqual(
      (await list({ q: '.update' })).body.data.map((r) => r.id),
      [ids.viewerUpdate],
    );
    // LIKE wildcards are literal
    assert.deepEqual((await list({ q: '%' })).body.data, []);
  });

  test('keyset pagination walks every row once', async () => {
    const first = await list({ limit: '3' });
    assert.equal(first.body.data.length, 3);
    assert.equal(first.body.meta.nextCursor, ids.secret);
    const second = await list({ limit: '3', cursor: String(first.body.meta.nextCursor) });
    assert.deepEqual(
      second.body.data.map((r) => r.id),
      [ids.create],
    );
    assert.equal(second.body.meta.nextCursor, null);
    assert.equal((await list({ limit: '500' })).status, 400);
  });

  test('secrets in metadata are masked', async () => {
    const row = (await list({ action: `${MOD}.connect` })).body.data[0];
    const m = row.metadata;
    assert.equal(m.platform, 'line');
    assert.notEqual(m.accessToken, 'super-secret-token-value');
    assert.notEqual(m.nested.apiKey, 'k-123');
    assert.notEqual(m.nested.clientSecret, 'shh');
    assert.notEqual(m.nested.list[0].password, 'p@ss');
    assert.equal(m.nested.list[0].ok, 1);
    assert.notEqual(m.header, 'Bearer abc.def');
    // Field *names* listed as values are not secrets
    assert.deepEqual(m.fields, ['accessToken', 'name']);
    const body = JSON.stringify(row);
    for (const secret of ['super-secret-token-value', 'k-123', 'shh', 'p@ss', 'abc.def']) assert.ok(!body.includes(secret), secret);
  });
});

describe('GET /api/audit/facets', () => {
  test('lists users (incl. system) and modules with counts', async () => {
    const res = await as(manager).get('/api/audit/facets');
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const mod = res.body.data.modules.find((m) => m.module === MOD);
    assert.equal(mod.count, 4);
    const mgr = res.body.data.users.find((u) => u.id === MANAGER_ID);
    assert.equal(mgr.email, 'manager@example.com');
    assert.ok(mgr.count >= 2);
    assert.ok(res.body.data.users.some((u) => u.id === VIEWER_ID));
    assert.ok(res.body.data.users.some((u) => u.id === null && u.name === 'ระบบ'));
    assert.ok(res.body.data.entityTypes.some((e) => e.entityType === 'product'));
  });
});

describe('GET /api/audit/export.csv', () => {
  test('exports the current filter as UTF-8 CSV with BOM, masked and injection-safe', async () => {
    const res = await as(manager)
      .get(`/api/audit/export.csv?module=${MOD}`)
      .buffer(true)
      .parse((r, cb) => {
        const chunks = [];
        r.on('data', (c) => chunks.push(c));
        r.on('end', () => cb(null, Buffer.concat(chunks).toString('utf8')));
      });
    assert.equal(res.status, 200);
    assert.match(res.headers['content-type'], /text\/csv; charset=utf-8/);
    assert.match(res.headers['content-disposition'], /attachment; filename="audit-log-\d{4}-\d{2}-\d{2}\.csv"/);
    const text = res.body;
    assert.equal(text.charCodeAt(0), 0xfeff);
    const lines = text.slice(1).trim().split('\r\n');
    assert.equal(lines.length, 5); // header + 4 rows
    assert.match(lines[0], /^"เวลา/);
    assert.equal(res.headers['x-export-rows'], '4');
    // Newest first, local wall-clock time
    assert.match(lines[1], /^"2020-01-19 23:59:00",/);
    assert.match(lines[4], /^"2020-01-16 00:30:00",/);
    assert.ok(lines.some((l) => l.includes('manager@example.com')));
    assert.ok(!text.includes('super-secret-token-value'));
    // A cell that starts with "=" is defused for spreadsheets
    assert.ok(lines[1].includes(`"'=cmd|${RUN}"`));
    const filtered = await as(manager).get(`/api/audit/export.csv?module=${MOD}&userId=${VIEWER_ID}`);
    assert.equal(filtered.headers['x-export-rows'], '1');
  });
});
