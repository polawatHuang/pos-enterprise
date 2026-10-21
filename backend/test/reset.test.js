'use strict';

// "Delete all demo data": runs on a throw-away second organization so the demo org (1) used by the
// other suites is never touched, and proves the reset is scoped to one org.
process.env.NODE_ENV = 'test';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { createApp } = require('../src/app');
const db = require('../src/db/pool');
const { STEPS, tablesOf, stepsToRun } = require('../src/modules/org/reset');

const app = createApp();
const RUN = Date.now().toString(36);
const ADMIN_HASH = '$2b$12$tdInEICNwYyiP0tCAHua7.BFJGJzClcRSdkcy1g2/xWCDrBeNh/JK'; // Admin@1234 (seed)
const t = { orgId: 0, ownerId: 0, staffId: 0, warehouseId: 0 };
let owner;
let staff;

async function cookie(email) {
  const res = await request(app).post('/api/auth/login').send({ email, password: 'Admin@1234' });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  return res.headers['set-cookie'].map((c) => c.split(';')[0]).join('; ');
}
const org1Counts = async () =>
  db.one(
    `SELECT (SELECT COUNT(*) FROM products WHERE org_id = 1) AS products, (SELECT COUNT(*) FROM users WHERE org_id = 1) AS users,
            (SELECT COUNT(*) FROM sales_orders WHERE org_id = 1) AS orders, (SELECT COUNT(*) FROM journal_entries WHERE org_id = 1) AS journals`,
  );

before(async () => {
  const org = await db.query('INSERT INTO organizations (name) VALUES (:name)', { name: `ร้านทดสอบรีเซ็ต ${RUN}` });
  t.orgId = org.insertId;
  const br = await db.query("INSERT INTO branches (org_id, code, name, branch_no) VALUES (:o, 'HQ', 'สำนักงานใหญ่', '00000')", { o: t.orgId });
  const wh = await db.query("INSERT INTO warehouses (org_id, branch_id, code, name) VALUES (:o, :b, 'WH', 'คลัง')", { o: t.orgId, b: br.insertId });
  t.warehouseId = wh.insertId;
  const mk = async (email, roleId) => {
    const u = await db.query(
      `INSERT INTO users (org_id, branch_id, email, password_hash, full_name, must_change_password) VALUES (:o, :b, :email, :h, :email, 0)`,
      { o: t.orgId, b: br.insertId, email, h: ADMIN_HASH },
    );
    await db.query('INSERT INTO user_roles (user_id, role_id) VALUES (:u, :r)', { u: u.insertId, r: roleId });
    return u.insertId;
  };
  t.ownerId = await mk(`owner-${RUN}@reset.test`, 1);
  t.staffId = await mk(`staff-${RUN}@reset.test`, 3); // manager: has stock/POS rights but not settings
  // Demo-like data in the throw-away org
  const p = await db.query("INSERT INTO products (org_id, sku, name, price, cost) VALUES (:o, 'R-1', 'สินค้าเดโม', 10, 5)", { o: t.orgId });
  await db.query('INSERT INTO stock_levels (warehouse_id, product_id, variant_id, quantity) VALUES (:w, :p, 0, 7)', { w: t.warehouseId, p: p.insertId });
  await db.query("INSERT INTO stock_movements (org_id, warehouse_id, product_id, variant_id, type, quantity) VALUES (:o, :w, :p, 0, 'opening', 7)", {
    o: t.orgId,
    w: t.warehouseId,
    p: p.insertId,
  });
  await db.query("INSERT INTO customers (org_id, name, phone) VALUES (:o, 'ลูกค้าเดโม', '0811111111')", { o: t.orgId });
  await db.query("INSERT INTO settings (org_id, setting_key, value) VALUES (:o, 'pos.receipt_footer', '\"ขอบคุณ\"')", { o: t.orgId });
  owner = await cookie(`owner-${RUN}@reset.test`);
  staff = await cookie(`staff-${RUN}@reset.test`);
});

after(async () => {
  await db.query('DELETE FROM organizations WHERE id = :o', { o: t.orgId });
  await db.pool.end();
});

test('only an owner/admin with the exact phrase can reset', async () => {
  assert.equal((await request(app).post('/api/org/reset-data').set('Cookie', staff).send({ confirm: 'ลบข้อมูลทั้งหมด' })).status, 403);
  const summary = await request(app).get('/api/org/data-summary').set('Cookie', owner);
  assert.equal(summary.status, 200, JSON.stringify(summary.body));
  assert.deepEqual([summary.body.data.products, summary.body.data.customers, summary.body.data.otherUsers], [1, 1, 1]);
  assert.equal((await request(app).post('/api/org/reset-data').set('Cookie', owner).send({ confirm: 'ลบ' })).status, 400);
  const still = await db.one('SELECT COUNT(*) AS n FROM products WHERE org_id = :o', { o: t.orgId });
  assert.equal(Number(still.n), 1, 'a wrong phrase deletes nothing');
});

test('reset clears the org, keeps its structure and the caller, and never touches another org', async () => {
  const before1 = await org1Counts();
  const res = await request(app).post('/api/org/reset-data').set('Cookie', owner).send({ confirm: 'ลบข้อมูลทั้งหมด' });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.data.deleted.products, 1);
  assert.equal(res.body.data.deleted.users, 1);
  assert.deepEqual(res.body.data.skipped, [], 'every table exists in a fully migrated database');

  const left = await db.one(
    `SELECT (SELECT COUNT(*) FROM products WHERE org_id = :o) AS products, (SELECT COUNT(*) FROM customers WHERE org_id = :o) AS customers,
            (SELECT COUNT(*) FROM stock_movements WHERE org_id = :o) AS moves, (SELECT COUNT(*) FROM stock_levels WHERE warehouse_id = :w) AS levels,
            (SELECT COUNT(*) FROM users WHERE org_id = :o) AS users, (SELECT COUNT(*) FROM branches WHERE org_id = :o) AS branches,
            (SELECT COUNT(*) FROM warehouses WHERE org_id = :o) AS warehouses, (SELECT COUNT(*) FROM settings WHERE org_id = :o) AS settings`,
    { o: t.orgId, w: t.warehouseId },
  );
  assert.deepEqual(Object.fromEntries(Object.entries(left).map(([k, v]) => [k, Number(v)])), {
    products: 0,
    customers: 0,
    moves: 0,
    levels: 0,
    users: 1,
    branches: 1,
    warehouses: 1,
    settings: 1,
  });
  const me = await db.one('SELECT id FROM users WHERE org_id = :o', { o: t.orgId });
  assert.equal(me.id, t.ownerId, 'the account that ran the reset is the one kept');
  assert.deepEqual(await org1Counts(), before1, 'the demo organization is untouched');

  // still logged in and able to start fresh
  const p = await request(app).post('/api/products').set('Cookie', owner).send({ sku: 'NEW-1', name: 'สินค้าจริงชิ้นแรก', price: 50 });
  assert.equal(p.status, 201, JSON.stringify(p.body));
  const log = await db.one("SELECT action FROM audit_logs WHERE org_id = :o AND action = 'org.reset_data'", { o: t.orgId });
  assert.ok(log, 'the reset itself is recorded');
});

test('every statement is scoped to an organization', () => {
  for (const [table, sql] of STEPS) assert.match(sql, /org_id = :orgId/, `${table} must be limited to one org`);
});

test('tables of a not-yet-imported migration are skipped, not fatal', () => {
  assert.deepEqual(tablesOf('DELETE a FROM cover_assets a JOIN cover_projects c ON c.id = a.cover_id WHERE c.org_id = :orgId'), ['cover_assets', 'cover_projects']);
  assert.deepEqual(tablesOf('DELETE FROM products WHERE org_id = :orgId'), ['products']);

  const all = new Set(STEPS.flatMap(([, sql]) => tablesOf(sql)));
  const missing = new Set(['cover_projects', 'cover_assets', 'stock_lots']);
  const { run, skipped } = stepsToRun(new Set([...all].filter((t) => !missing.has(t))));
  assert.deepEqual(skipped.sort(), ['cover_assets', 'cover_projects', 'stock_lots']);
  assert.equal(run.length, STEPS.length - 3);
});

test('every table named in the steps exists (a typo would be skipped silently)', async () => {
  const rows = await db.query('SELECT TABLE_NAME AS name FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE()');
  const existing = new Set(rows.map((r) => r.name));
  const unknown = [...new Set(STEPS.flatMap(([, sql]) => tablesOf(sql)))].filter((t) => !existing.has(t));
  assert.deepEqual(unknown, []);
});
