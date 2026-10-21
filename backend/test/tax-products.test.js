'use strict';

// Shop VAT settings, product opening stock / delete and category management, on a throw-away
// organization so the demo org's 7% and products are never touched.
process.env.NODE_ENV = 'test';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { createApp } = require('../src/app');
const db = require('../src/db/pool');
const { resetOrgData } = require('../src/modules/org/reset');

const app = createApp();
const RUN = Date.now().toString(36);
const ADMIN_HASH = '$2b$12$tdInEICNwYyiP0tCAHua7.BFJGJzClcRSdkcy1g2/xWCDrBeNh/JK'; // Admin@1234 (seed)
const t = { orgId: 0, branchId: 0, warehouseId: 0, productId: 0 };
let owner;
let manager;

async function cookie(email) {
  const res = await request(app).post('/api/auth/login').send({ email, password: 'Admin@1234' });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  return res.headers['set-cookie'].map((c) => c.split(';')[0]).join('; ');
}
const as = (who) => ({
  get: (url) => request(app).get(url).set('Cookie', who),
  post: (url, body) => request(app).post(url).set('Cookie', who).send(body),
  put: (url, body) => request(app).put(url).set('Cookie', who).send(body),
  patch: (url, body) => request(app).patch(url).set('Cookie', who).send(body),
  del: (url) => request(app).delete(url).set('Cookie', who),
});

before(async () => {
  const org = await db.query('INSERT INTO organizations (name) VALUES (:name)', { name: `ร้านทดสอบภาษี ${RUN}` });
  t.orgId = org.insertId;
  const br = await db.query("INSERT INTO branches (org_id, code, name, branch_no) VALUES (:o, 'HQ', 'สำนักงานใหญ่', '00000')", { o: t.orgId });
  t.branchId = br.insertId;
  const wh = await db.query("INSERT INTO warehouses (org_id, branch_id, code, name) VALUES (:o, :b, 'WH', 'คลัง')", { o: t.orgId, b: t.branchId });
  t.warehouseId = wh.insertId;
  // Sales post journal entries: give the shop the demo chart of accounts
  await db.query('INSERT INTO chart_of_accounts (org_id, code, name, type, is_active) SELECT :o, code, name, type, is_active FROM chart_of_accounts WHERE org_id = 1', {
    o: t.orgId,
  });
  const mk = async (email, roleId) => {
    const u = await db.query(
      'INSERT INTO users (org_id, branch_id, email, password_hash, full_name, must_change_password) VALUES (:o, :b, :email, :h, :email, 0)',
      { o: t.orgId, b: t.branchId, email, h: ADMIN_HASH },
    );
    await db.query('INSERT INTO user_roles (user_id, role_id) VALUES (:u, :r)', { u: u.insertId, r: roleId });
    return u.insertId;
  };
  t.ownerId = await mk(`owner-${RUN}@tax.test`, 1);
  await mk(`manager-${RUN}@tax.test`, 3);
  owner = as(await cookie(`owner-${RUN}@tax.test`));
  manager = as(await cookie(`manager-${RUN}@tax.test`));
});

after(async () => {
  await resetOrgData({ orgId: t.orgId, keepUserId: 0 });
  await db.query('DELETE FROM organizations WHERE id = :o', { o: t.orgId });
  await db.pool.end();
});

test('a new product can start with stock on hand, recorded as an opening movement', async () => {
  assert.deepEqual((await owner.get('/api/org/tax')).body.data, { vatRegistered: true, vatRate: 7, defaultVatType: 'vat7' });
  const res = await owner.post('/api/products', {
    sku: `TAX-${RUN}`,
    name: 'สินค้าทดสอบภาษี',
    price: 110,
    cost: 50,
    openingStock: { warehouseId: t.warehouseId, quantity: 12 },
  });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  t.productId = res.body.data.id;
  assert.equal(res.body.data.vatType, 'vat7', 'shop default VAT type');
  const level = await db.one('SELECT quantity FROM stock_levels WHERE warehouse_id = :w AND product_id = :p', { w: t.warehouseId, p: t.productId });
  assert.equal(Number(level.quantity), 12);
  const move = await db.one('SELECT type, quantity FROM stock_movements WHERE product_id = :p', { p: t.productId });
  assert.deepEqual([move.type, Number(move.quantity)], ['opening', 12]);

});

test('POS sales and documents use the shop VAT rate, and none when not VAT registered', async () => {
  assert.equal((await manager.put('/api/org/tax', { vatRate: 10 })).status, 403);
  const put = await owner.put('/api/org/tax', { vatRate: 10 });
  assert.equal(put.status, 200, JSON.stringify(put.body));
  assert.equal(put.body.data.vatRate, 10);

  assert.equal((await owner.post('/api/pos/shift/open', { branchId: t.branchId, openingCash: 0 })).status, 201);
  const sale = await owner.post('/api/pos/checkout', { items: [{ productId: t.productId, quantity: 1 }], payments: [{ method: 'cash', amount: 110 }] });
  assert.equal(sale.status, 201, JSON.stringify(sale.body));
  assert.equal(sale.body.data.vatAmount, 10, '110 incl. 10% VAT = 100 + 10');

  const doc = await owner.post('/api/accounting/documents', {
    docType: 'quotation',
    docDate: '2026-10-01',
    partyName: 'ลูกค้า',
    items: [{ description: 'A', quantity: 1, unitPrice: 100 }],
  });
  assert.equal(doc.status, 201, JSON.stringify(doc.body));
  assert.deepEqual([doc.body.data.vatAmount, doc.body.data.total], [10, 110]);

  await owner.put('/api/org/tax', { vatRegistered: false });
  const sale2 = await owner.post('/api/pos/checkout', { items: [{ productId: t.productId, quantity: 1 }], payments: [{ method: 'cash', amount: 110 }] });
  assert.equal(sale2.body.data.vatAmount, 0, 'an unregistered shop records no VAT');
  const doc2 = await owner.post('/api/accounting/documents', {
    docType: 'quotation',
    docDate: '2026-10-01',
    partyName: 'ลูกค้า',
    items: [{ description: 'A', quantity: 1, unitPrice: 100 }],
  });
  assert.deepEqual([doc2.body.data.vatAmount, doc2.body.data.total], [0, 100]);

  await owner.put('/api/org/tax', { vatRegistered: true, vatRate: 7, defaultVatType: 'exempt' });
  const p = await owner.post('/api/products', { sku: `EX-${RUN}`, name: 'สินค้ายกเว้น', price: 20 });
  assert.equal(p.body.data.vatType, 'exempt');
  assert.equal((await owner.put('/api/org/tax', { vatRate: 50 })).status, 400);
});

test('a product with history cannot be deleted; an unused one can', async () => {
  const sold = await owner.del(`/api/products/${t.productId}`);
  assert.equal(sold.status, 409);
  assert.match(sold.body.error.message, /ประวัติการขาย 2 รายการ.*เลิกขาย/);

  const fresh = await owner.post('/api/products', {
    sku: `DEL-${RUN}`,
    name: 'ลบได้',
    price: 5,
    openingStock: { warehouseId: t.warehouseId, quantity: 3 },
  });
  const res = await owner.del(`/api/products/${fresh.body.data.id}`);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const left = await db.one('SELECT (SELECT COUNT(*) FROM products WHERE id = :id) AS p, (SELECT COUNT(*) FROM stock_levels WHERE product_id = :id) AS s', {
    id: fresh.body.data.id,
  });
  assert.deepEqual([Number(left.p), Number(left.s)], [0, 0]);
  assert.equal((await owner.del('/api/products/1')).status, 404, 'demo org product');
});

test('categories: create, unique names, rename and delete leaves products uncategorised', async () => {
  const c = await owner.post('/api/products/categories', { name: 'เครื่องดื่ม' });
  assert.equal(c.status, 201);
  assert.equal((await owner.post('/api/products/categories', { name: 'เครื่องดื่ม' })).status, 409);
  const other = await owner.post('/api/products/categories', { name: 'ขนม' });
  assert.equal((await owner.patch(`/api/products/categories/${other.body.data.id}`, { name: 'เครื่องดื่ม' })).status, 409);
  assert.equal((await owner.patch(`/api/products/categories/${c.body.data.id}`, { name: 'น้ำดื่ม' })).status, 200);

  await owner.patch(`/api/products/${t.productId}`, { categoryId: c.body.data.id });
  const del = await owner.del(`/api/products/categories/${c.body.data.id}`);
  assert.equal(del.status, 200);
  assert.equal(del.body.data.uncategorised, 1);
  const p = await db.one('SELECT category_id FROM products WHERE id = :id', { id: t.productId });
  assert.equal(p.category_id, null);
});
