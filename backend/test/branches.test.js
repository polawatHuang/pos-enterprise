'use strict';

// Settings > สาขาและคลังสินค้า: runs on a throw-away organization so the demo branches are untouched.
process.env.NODE_ENV = 'test';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { createApp } = require('../src/app');
const db = require('../src/db/pool');

const app = createApp();
const RUN = Date.now().toString(36);
const ADMIN_HASH = '$2b$12$tdInEICNwYyiP0tCAHua7.BFJGJzClcRSdkcy1g2/xWCDrBeNh/JK'; // Admin@1234 (seed)
const t = { orgId: 0, hqId: 0 };
let owner;
let manager;

async function cookie(email) {
  const res = await request(app).post('/api/auth/login').send({ email, password: 'Admin@1234' });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  return res.headers['set-cookie'].map((c) => c.split(';')[0]).join('; ');
}

before(async () => {
  const org = await db.query('INSERT INTO organizations (name) VALUES (:name)', { name: `ร้านทดสอบสาขา ${RUN}` });
  t.orgId = org.insertId;
  const br = await db.query("INSERT INTO branches (org_id, code, name, branch_no) VALUES (:o, 'HQ', 'สำนักงานใหญ่', '00000')", { o: t.orgId });
  t.hqId = br.insertId;
  const mk = async (email, roleId) => {
    const u = await db.query(
      'INSERT INTO users (org_id, branch_id, email, password_hash, full_name, must_change_password) VALUES (:o, :b, :email, :h, :email, 0)',
      { o: t.orgId, b: t.hqId, email, h: ADMIN_HASH },
    );
    await db.query('INSERT INTO user_roles (user_id, role_id) VALUES (:u, :r)', { u: u.insertId, r: roleId });
  };
  await mk(`owner-${RUN}@branch.test`, 1);
  await mk(`manager-${RUN}@branch.test`, 3);
  owner = await cookie(`owner-${RUN}@branch.test`);
  manager = await cookie(`manager-${RUN}@branch.test`);
});

after(async () => {
  await db.query('DELETE FROM pos_shifts WHERE org_id = :o', { o: t.orgId });
  await db.query('DELETE FROM organizations WHERE id = :o', { o: t.orgId });
  await db.pool.end();
});

test('creating a branch also creates its warehouse; codes are unique', async () => {
  const res = await request(app)
    .post('/api/org/branches')
    .set('Cookie', owner)
    .send({ code: 'siam-1', name: 'สาขาสยาม', branchNo: '00001', address: 'ถนนพระราม 1' });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  const list = await request(app).get('/api/org/branches').set('Cookie', owner);
  const siam = list.body.data.find((b) => b.id === res.body.data.id);
  assert.equal(siam.code, 'SIAM-1', 'codes are upper-cased');
  assert.equal(siam.address, 'ถนนพระราม 1');
  assert.equal(siam.warehouseName, 'คลัง สาขาสยาม');
  assert.ok(siam.warehouseId);

  const dup = await request(app).post('/api/org/branches').set('Cookie', owner).send({ code: 'SIAM-1', name: 'ซ้ำ', branchNo: '00002' });
  assert.equal(dup.status, 409);
  const bad = await request(app).post('/api/org/branches').set('Cookie', owner).send({ code: 'X', name: 'X', branchNo: '1' });
  assert.equal(bad.status, 400, 'branch number must be 5 digits');
});

test('editing changes only the fields sent', async () => {
  const res = await request(app).patch(`/api/org/branches/${t.hqId}`).set('Cookie', owner).send({ name: 'ร้านหลัก', address: '99 ถนนสุขุมวิท' });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const row = await db.one('SELECT code, name, branch_no, address FROM branches WHERE id = :id', { id: t.hqId });
  assert.deepEqual({ ...row }, { code: 'HQ', name: 'ร้านหลัก', branch_no: '00000', address: '99 ถนนสุขุมวิท' });
});

test('the last active branch and a branch with an open shift cannot be disabled', async () => {
  const other = await db.one("SELECT id FROM branches WHERE org_id = :o AND code = 'SIAM-1'", { o: t.orgId });
  assert.equal((await request(app).patch(`/api/org/branches/${other.id}`).set('Cookie', owner).send({ isActive: false })).status, 200);
  const last = await request(app).patch(`/api/org/branches/${t.hqId}`).set('Cookie', owner).send({ isActive: false });
  assert.equal(last.status, 400);
  assert.match(last.body.error.message, /อย่างน้อย 1 สาขา/);

  // re-enable SIAM, open a shift there, then try to disable it
  await request(app).patch(`/api/org/branches/${other.id}`).set('Cookie', owner).send({ isActive: true });
  const me = await db.one('SELECT id FROM users WHERE org_id = :o ORDER BY id LIMIT 1', { o: t.orgId });
  await db.query('INSERT INTO pos_shifts (org_id, branch_id, user_id, opening_cash) VALUES (:o, :b, :u, 0)', { o: t.orgId, b: other.id, u: me.id });
  const busy = await request(app).patch(`/api/org/branches/${other.id}`).set('Cookie', owner).send({ isActive: false });
  assert.equal(busy.status, 400);
  assert.match(busy.body.error.message, /กะขายที่เปิดอยู่/);
});

test('only settings:manage can change branches; other orgs are not reachable', async () => {
  assert.equal((await request(app).post('/api/org/branches').set('Cookie', manager).send({ code: 'M', name: 'M', branchNo: '00009' })).status, 403);
  assert.equal((await request(app).patch(`/api/org/branches/${t.hqId}`).set('Cookie', manager).send({ name: 'x' })).status, 403);
  assert.equal((await request(app).patch('/api/org/branches/1').set('Cookie', owner).send({ name: 'แฮก' })).status, 404, 'demo org branch');
});
