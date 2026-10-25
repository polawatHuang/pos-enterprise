'use strict';

// Public legal pages: the provider's details without login, data-subject requests (PDPA) with a
// reference number and a notification for the owner, and the owner's list to answer them.
process.env.NODE_ENV = 'test';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { createApp } = require('../src/app');
const db = require('../src/db/pool');

const app = createApp();
const RUN = Date.now().toString(36);
let admin;
let viewer;
let saved;

async function login(email) {
  const res = await request(app).post('/api/auth/login').send({ email, password: 'Admin@1234' });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const cookie = res.headers['set-cookie'].map((c) => c.split(';')[0]).join('; ');
  return {
    get: (url) => request(app).get(url).set('Cookie', cookie),
    put: (url, body) => request(app).put(url).set('Cookie', cookie).send(body),
    patch: (url, body) => request(app).patch(url).set('Cookie', cookie).send(body),
  };
}

before(async () => {
  saved = await db.one('SELECT id, name, legal_name, tax_id, address, phone, email FROM organizations ORDER BY id LIMIT 1');
  admin = await login('admin@example.com');
  viewer = await login('viewer@example.com');
});

after(async () => {
  await db.query('UPDATE organizations SET name = :name, legal_name = :legal_name, tax_id = :tax_id, address = :address, phone = :phone, email = :email WHERE id = :id', saved);
  const rows = await db.query('SELECT id FROM data_requests WHERE requester_name LIKE :n', { n: `%${RUN}%` });
  for (const r of rows) await db.query('DELETE FROM notifications WHERE ref_key = :k', { k: `data_request:${r.id}` });
  await db.query('DELETE FROM data_requests WHERE requester_name LIKE :n', { n: `%${RUN}%` });
  await db.pool.end();
});

test('business details: owners edit them, the public page reads them without login', async () => {
  const body = { name: 'ร้านทดสอบ', legalName: `บริษัท ทดสอบ ${RUN} จำกัด`, taxId: '0105561234567', address: '1 ถนนสุขุมวิท กรุงเทพฯ', phone: '021234567', email: 'privacy@shop.test' };
  assert.equal((await viewer.put('/api/org/organization', body)).status, 403);
  assert.equal((await admin.put('/api/org/organization', { ...body, taxId: '123' })).status, 400);
  assert.equal((await admin.put('/api/org/organization', body)).status, 200);
  const res = await request(app).get('/api/public/legal');
  assert.equal(res.status, 200);
  assert.equal(res.body.data.legalName, body.legalName);
  assert.equal(res.body.data.email, 'privacy@shop.test');
  assert.equal(res.body.data.id, undefined);
  assert.equal((await admin.get('/api/org/organization')).body.data.email, 'privacy@shop.test');
});

test('data request: public form → reference number, owner notified, answered from settings', async () => {
  assert.equal((await request(app).post('/api/public/legal/data-requests').send({ kind: 'delete', name: '', contact: 'x' })).status, 400);
  const res = await request(app)
    .post('/api/public/legal/data-requests')
    .send({ kind: 'delete', name: `ผู้ทัก ${RUN}`, contact: '0812345678', platform: 'facebook', detail: 'ขอลบแชตทั้งหมด' });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.match(res.body.data.ref, /^DR-\d{4}-[A-Z2-9]{6}$/);
  const row = await db.one('SELECT * FROM data_requests WHERE ref_code = :ref', { ref: res.body.data.ref });
  assert.equal(row.status, 'new');
  const n = await db.one('SELECT * FROM notifications WHERE ref_key = :k', { k: `data_request:${row.id}` });
  assert.equal(n.permission, 'settings:manage');
  assert.match(n.title, /ลบข้อมูล/);

  assert.equal((await viewer.get('/api/org/data-requests')).status, 403);
  const list = await admin.get('/api/org/data-requests');
  const item = list.body.data.find((d) => d.ref === res.body.data.ref);
  assert.equal(item.kind, 'delete');
  assert.ok(new Date(item.dueAt) > new Date(item.createdAt));
  const upd = await admin.patch(`/api/org/data-requests/${row.id}`, { status: 'done', note: 'ลบแชตและข้อมูลลูกค้าแล้ว' });
  assert.equal(upd.status, 200);
  const done = await db.one('SELECT status, handled_at, note FROM data_requests WHERE id = :id', { id: row.id });
  assert.equal(done.status, 'done');
  assert.ok(done.handled_at);
});
