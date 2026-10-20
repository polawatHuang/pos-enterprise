'use strict';

// Global search: exact codes first, groups filtered by permission, LIKE wildcards are literal.
process.env.NODE_ENV = 'test';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { createApp } = require('../src/app');
const db = require('../src/db/pool');

const app = createApp();
let manager;
let cashier;

async function cookie(email) {
  const res = await request(app).post('/api/auth/login').send({ email, password: 'Admin@1234' });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  return res.headers['set-cookie'].map((c) => c.split(';')[0]).join('; ');
}
const search = (c, q) =>
  request(app)
    .get(`/api/search?q=${encodeURIComponent(q)}`)
    .set('Cookie', c);

before(async () => {
  manager = await cookie('manager@example.com');
  cashier = await cookie('cashier@example.com');
});
after(() => db.pool.end());

test('a scanned barcode puts the exact product first', async () => {
  const res = await search(manager, '8850000000002');
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const first = res.body.data.groups[0];
  assert.equal(first.key, 'products');
  assert.equal(first.items[0].exact, true);
  assert.match(first.items[0].href, /^\/products\/\d+$/);
});

test('groups follow permissions: cashiers never see accounting documents', async () => {
  const doc = await db.one('SELECT doc_no FROM documents WHERE org_id = 1 LIMIT 1');
  if (doc) {
    const m = await search(manager, doc.doc_no);
    assert.ok(m.body.data.groups.some((g) => g.key === 'documents'));
    const c = await search(cashier, doc.doc_no);
    assert.ok(!c.body.data.groups.some((g) => g.key === 'documents'));
  }
  const c = await search(cashier, 'a');
  assert.ok(c.body.data.groups.every((g) => ['products', 'customers', 'purchasing', 'suppliers'].includes(g.key)));
});

test('% and _ are matched literally and empty queries are rejected', async () => {
  const res = await search(manager, '%');
  assert.equal(res.status, 200);
  assert.equal(res.body.data.groups.length, 0);
  assert.equal((await search(manager, '')).status, 400);
  assert.equal((await request(app).get('/api/search?q=x')).status, 401);
});
