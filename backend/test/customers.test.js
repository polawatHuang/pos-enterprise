'use strict';

// Customers (CRM) API: list/search/sort, detail aggregates, create/edit, permissions, CSV export.
// Requires schema.sql + seed.sql (+ migrations) imported.
process.env.NODE_ENV = 'test';

const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { createApp } = require('../src/app');
const db = require('../src/db/pool');

const app = createApp();
const RUN = Date.now().toString(36);
const createdCustomers = [];
const createdOrders = [];
const createdConvs = [];
let manager;
let viewer;
let cashier;
let support;
let marketer;
let productId;
let channelId;

async function cookie(email) {
  const res = await request(app).post('/api/auth/login').send({ email, password: 'Admin@1234' });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  return res.headers['set-cookie'].map((c) => c.split(';')[0]).join('; ');
}
const as = (c) => ({
  get: (url) => request(app).get(url).set('Cookie', c),
  post: (url, body) => request(app).post(url).set('Cookie', c).send(body),
  patch: (url, body) => request(app).patch(url).set('Cookie', c).send(body),
});

/** Unique 10-digit mobile number per run. */
let phoneSeq = 0;
const phone = () => `09${String(Date.now() % 1e6).padStart(6, '0')}${String((phoneSeq += 1)).padStart(2, '0')}`;

async function createCustomer(body) {
  const res = await manager.post('/api/customers', body);
  assert.equal(res.status, 201, JSON.stringify(res.body));
  createdCustomers.push(res.body.data.id);
  return res.body.data;
}

async function addOrder(customerId, { total, status = 'completed', channel = 'pos', daysAgo = 0, qty = 1 }) {
  const r = await db.query(
    `INSERT INTO sales_orders (org_id, customer_id, order_no, channel, status, subtotal, total, ordered_at)
     VALUES (1, :customerId, :no, :channel, :status, :total, :total, UTC_TIMESTAMP() - INTERVAL :daysAgo DAY)`,
    { customerId, no: `T-${RUN}-${createdOrders.length + 1}`, channel, status, total, daysAgo },
  );
  createdOrders.push(r.insertId);
  await db.query(
    `INSERT INTO sales_order_items (order_id, product_id, name, quantity, unit_price, line_total)
     VALUES (:orderId, :productId, 'สินค้าทดสอบ', :qty, :price, :total)`,
    { orderId: r.insertId, productId, qty, price: total / qty, total },
  );
  return r.insertId;
}

before(async () => {
  [manager, viewer, cashier, support, marketer] = (
    await Promise.all(['manager', 'viewer', 'cashier', 'support', 'marketer'].map((u) => cookie(`${u}@example.com`)))
  ).map(as);
  productId = (await db.one('SELECT id FROM products WHERE org_id = 1 ORDER BY id LIMIT 1')).id;
  channelId = (await db.one('SELECT id FROM channels WHERE org_id = 1 ORDER BY id LIMIT 1')).id;
});

after(async () => {
  if (createdConvs.length) await db.query('DELETE FROM conversations WHERE id IN (:ids)', { ids: createdConvs });
  if (createdOrders.length) await db.query('DELETE FROM sales_orders WHERE id IN (:ids)', { ids: createdOrders });
  if (createdCustomers.length) {
    await db.query("DELETE FROM audit_logs WHERE entity_type = 'customer' AND entity_id IN (:ids)", { ids: createdCustomers.map(String) });
    await db.query('DELETE FROM customers WHERE id IN (:ids)', { ids: createdCustomers });
  }
  await db.pool.end();
});

describe('customers CRM', () => {
  let big;
  let small;
  let idle;

  before(async () => {
    big = await createCustomer({ name: `ลูกค้าวีไอพี ${RUN}`, phone: phone(), email: `vip-${RUN}@example.com`, tags: ['VIP', 'ขายส่ง'] });
    small = await createCustomer({ name: `ลูกค้าขาจร ${RUN}`, phone: phone(), tags: ['ขายส่ง'] });
    idle = await createCustomer({ name: `ลูกค้าใหม่ ${RUN}` });
    await addOrder(big.id, { total: 1000, daysAgo: 10, qty: 2 });
    await addOrder(big.id, { total: 500, channel: 'shopee', daysAgo: 2, qty: 3 });
    await addOrder(big.id, { total: 9999, status: 'cancelled', daysAgo: 1 });
    await addOrder(small.id, { total: 200, daysAgo: 1 });
    const conv = await db.query(
      `INSERT INTO conversations (org_id, channel_id, customer_id, external_thread_id, customer_name, status, last_message_at)
       VALUES (1, :channelId, :customerId, :thread, 'วีไอพี', 'open', UTC_TIMESTAMP())`,
      { channelId, customerId: big.id, thread: `crm-${RUN}` },
    );
    createdConvs.push(conv.insertId);
  });

  test('create assigns a member number and normalises fields', async () => {
    assert.match(big.memberNo, /^M\d{6}$/);
    assert.deepEqual(big.tags, ['VIP', 'ขายส่ง']);
    assert.equal(idle.phone, null);
    const dup = await manager.post('/api/customers', { name: 'ซ้ำ', phone: big.phone });
    assert.equal(dup.status, 409);
  });

  test('list searches by name, phone, email and member number', async () => {
    const byName = await viewer.get(`/api/customers?q=${encodeURIComponent(RUN)}`);
    assert.equal(byName.status, 200, JSON.stringify(byName.body));
    assert.equal(byName.body.meta.total, 3);
    for (const q of [big.phone.slice(-7), `vip-${RUN}`, big.memberNo]) {
      const res = await viewer.get(`/api/customers?q=${encodeURIComponent(q)}`);
      assert.ok(
        res.body.data.some((c) => c.id === big.id),
        `search ${q}`,
      );
    }
    const pct = await viewer.get('/api/customers?q=%25%25%25');
    assert.equal(pct.status, 200);
    assert.ok(!pct.body.data.some((c) => c.id === big.id), 'LIKE wildcards are escaped');
  });

  test('list returns live totals, last order, open chats and channels', async () => {
    const res = await viewer.get(`/api/customers?q=${encodeURIComponent(RUN)}&sort=top`);
    const [first, second, third] = res.body.data;
    assert.deepEqual([first.id, second.id, third.id], [big.id, small.id, idle.id]);
    assert.equal(first.totalSpent, 1500, 'cancelled order is not counted');
    assert.equal(first.orderCount, 2);
    assert.equal(first.avgBasket, 750);
    assert.equal(first.openChats, 1);
    assert.deepEqual(first.salesChannels.sort(), ['pos', 'shopee']);
    assert.equal(first.chatPlatforms.length, 1);
    assert.ok(first.lastOrderAt);
    assert.equal(third.orderCount, 0);
    assert.equal(third.lastOrderAt, null);
  });

  test('list sorts by name / orders / recent and paginates', async () => {
    const q = encodeURIComponent(RUN);
    const byName = await viewer.get(`/api/customers?q=${q}&sort=name`);
    const names = byName.body.data.map((c) => c.name);
    assert.deepEqual(
      names,
      [...names].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)),
    );
    const byOrders = await viewer.get(`/api/customers?q=${q}&sort=orders`);
    assert.equal(byOrders.body.data[0].id, big.id);
    const recent = await viewer.get(`/api/customers?q=${q}&sort=recent`);
    assert.equal(recent.body.data[0].id, idle.id, 'no orders -> sorted by sign-up time (just now)');
    const page = await viewer.get(`/api/customers?q=${q}&sort=top&limit=1&offset=1`);
    assert.equal(page.body.data.length, 1);
    assert.equal(page.body.data[0].id, small.id);
    assert.equal(page.body.meta.total, 3);
    const bad = await viewer.get('/api/customers?sort=bogus');
    assert.equal(bad.status, 400);
  });

  test('list filters by tag', async () => {
    const res = await viewer.get(`/api/customers?q=${encodeURIComponent(RUN)}&tag=${encodeURIComponent('ขายส่ง')}`);
    assert.deepEqual(res.body.data.map((c) => c.id).sort(), [big.id, small.id].sort());
    const vip = await viewer.get(`/api/customers?q=${encodeURIComponent(RUN)}&tag=VIP`);
    assert.deepEqual(
      vip.body.data.map((c) => c.id),
      [big.id],
    );
  });

  test('summary has KPI figures and tag counts', async () => {
    const res = await cashier.get('/api/customers/summary');
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const s = res.body.data;
    assert.ok(s.totalCustomers >= 3);
    assert.ok(s.newThisMonth >= 3);
    assert.ok(s.repeatRate >= 0 && s.repeatRate <= 100);
    assert.ok(s.avgSpend > 0);
    assert.ok(s.tags.find((t) => t.tag === 'VIP')?.count >= 1);
  });

  test('detail aggregates stats, orders, products and conversations', async () => {
    const res = await support.get(`/api/customers/${big.id}`);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const d = res.body.data;
    assert.equal(d.name, big.name);
    assert.equal(d.stats.totalSpent, 1500);
    assert.equal(d.stats.orderCount, 2);
    assert.equal(d.stats.avgBasket, 750);
    assert.equal(d.stats.itemsBought, 5);
    assert.equal(d.stats.cancelledCount, 1);
    assert.equal(d.stats.openChats, 1);
    assert.ok(new Date(d.stats.firstOrderAt) < new Date(d.stats.lastOrderAt));
    assert.equal(d.recentOrders.length, 3, 'history lists cancelled bills too');
    assert.equal(d.recentOrders[0].status, 'cancelled', 'newest first');
    assert.equal(d.recentOrders[1].itemCount, 3);
    assert.deepEqual(
      d.channels.map((c) => c.channel),
      ['pos', 'shopee'],
    );
    assert.equal(d.topProducts[0].quantity, 5);
    assert.equal(d.conversations.length, 1);
    assert.equal(d.conversations[0].id, createdConvs[0]);
    assert.equal(d.conversations[0].status, 'open');
    assert.ok(d.conversations[0].platform);
    assert.ok(d.conversations[0].channelName);

    const missing = await support.get('/api/customers/999999999');
    assert.equal(missing.status, 404);
  });

  test("an order of the customer opens for any reader; another customer's order does not", async () => {
    const ok = await cashier.get(`/api/customers/${big.id}/orders/${createdOrders[0]}`);
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    assert.equal(ok.body.data.total, 1000);
    assert.equal(ok.body.data.items.length, 1);
    const other = await cashier.get(`/api/customers/${small.id}/orders/${createdOrders[0]}`);
    assert.equal(other.status, 404);
  });

  test('patch edits fields, validates input and writes an audit entry', async () => {
    const res = await cashier.patch(`/api/customers/${small.id}`, {
      name: `  ลูกค้าประจำ ${RUN} `,
      email: `REG-${RUN}@example.com`,
      taxId: '0-1055-67000-00-1',
      branchNo: '00000',
      address: '1 ถนนสุขุมวิท กรุงเทพฯ',
      tags: ['ประจำ', 'ประจำ', 'ขายส่ง'],
      consentMarketing: true,
    });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const d = res.body.data;
    assert.equal(d.name, `ลูกค้าประจำ ${RUN}`);
    assert.equal(d.taxId, '0105567000001');
    assert.deepEqual(d.tags, ['ประจำ', 'ขายส่ง']);
    assert.equal(d.consentMarketing, true);
    const log = await db.one("SELECT metadata FROM audit_logs WHERE action = 'customer.update' AND entity_id = :id ORDER BY id DESC LIMIT 1", {
      id: String(small.id),
    });
    const meta = typeof log.metadata === 'string' ? JSON.parse(log.metadata) : log.metadata;
    assert.deepEqual(meta.fields.sort(), ['address', 'branchNo', 'consentMarketing', 'email', 'name', 'tags', 'taxId'].sort());

    const cleared = await cashier.patch(`/api/customers/${small.id}`, { email: '', address: null, tags: [] });
    assert.equal(cleared.status, 200);
    assert.equal(cleared.body.data.email, null);
    assert.equal(cleared.body.data.address, null);
    assert.deepEqual(cleared.body.data.tags, []);

    for (const body of [{ phone: '123' }, { email: 'not-an-email' }, { taxId: '123' }, { branchNo: 'abc' }, { name: '' }, {}, { tags: ['x'.repeat(31)] }]) {
      const bad = await cashier.patch(`/api/customers/${small.id}`, body);
      assert.equal(bad.status, 400, `${JSON.stringify(body)} -> ${bad.status}`);
    }
    const taken = await cashier.patch(`/api/customers/${small.id}`, { phone: big.phone });
    assert.equal(taken.status, 409);
    const p = phone();
    const formatted = await cashier.patch(`/api/customers/${idle.id}`, { phone: `${p.slice(0, 3)}-${p.slice(3, 6)} ${p.slice(6)}` });
    assert.equal(formatted.status, 200, JSON.stringify(formatted.body));
    assert.equal(formatted.body.data.phone, p);
  });

  test('permissions: read needs any of pos:sell / inbox:read / accounting:read, write needs pos:sell or inbox:reply', async () => {
    assert.equal((await marketer.get('/api/customers')).status, 403);
    assert.equal((await marketer.get(`/api/customers/${big.id}`)).status, 403);
    assert.equal((await marketer.get('/api/customers/export.csv')).status, 403);
    assert.equal((await request(app).get('/api/customers')).status, 401);
    // viewer can read (inbox:read, accounting:read) but not edit
    assert.equal((await viewer.get(`/api/customers/${big.id}`)).status, 200);
    assert.equal((await viewer.patch(`/api/customers/${big.id}`, { name: 'x' })).status, 403);
    assert.equal((await viewer.post('/api/customers', { name: 'x' })).status, 403);
    // support (inbox:reply) can edit
    const s = await support.patch(`/api/customers/${big.id}`, { tags: ['VIP', 'ขายส่ง', 'แชต'] });
    assert.equal(s.status, 200, JSON.stringify(s.body));
  });

  test('CSV export of the filtered list has a BOM, Thai headers and safe cells', async () => {
    await manager.patch(`/api/customers/${idle.id}`, { address: '=HYPERLINK("http://evil")' });
    const res = await viewer
      .get(`/api/customers/export.csv?q=${encodeURIComponent(RUN)}&sort=top`)
      .buffer(true)
      .parse((r, cb) => {
        let data = '';
        r.setEncoding('utf8');
        r.on('data', (chunk) => (data += chunk));
        r.on('end', () => cb(null, data));
      });
    assert.equal(res.status, 200);
    assert.match(res.headers['content-type'], /text\/csv/);
    assert.match(res.headers['content-disposition'], /attachment; filename="customers-\d{4}-\d{2}-\d{2}\.csv"/);
    const text = res.body;
    assert.equal(text.charCodeAt(0), 0xfeff);
    const lines = text.slice(1).trim().split('\r\n');
    assert.match(lines[0], /^"รหัสสมาชิก","ชื่อลูกค้า","เบอร์โทร"/);
    assert.equal(lines.length, 4, 'header + 3 customers of this run');
    assert.ok(lines[1].includes(big.name) && lines[1].includes('"1500.00"'));
    assert.ok(text.includes(`"'=HYPERLINK(""http://evil"")"`), 'formula is neutralised');
    const tagged = await viewer.get(`/api/customers/export.csv?q=${encodeURIComponent(RUN)}&tag=VIP`);
    assert.equal(tagged.text.trim().split('\r\n').length, 2);
  });
});
