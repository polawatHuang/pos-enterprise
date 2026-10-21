'use strict';

/** Each branch can take payments into its own PromptPay / bank account; empty = the shop's. */
process.env.NODE_ENV = 'test';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { createApp } = require('../src/app');
const db = require('../src/db/pool');

const app = createApp();
let admin;
let cashier;
let original;

async function cookie(email) {
  const res = await request(app).post('/api/auth/login').send({ email, password: 'Admin@1234' });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  return res.headers['set-cookie'].map((c) => c.split(';')[0]).join('; ');
}
const as = (c) => ({
  get: (url) => request(app).get(url).set('Cookie', c),
  patch: (url, body) => request(app).patch(url).set('Cookie', c).send(body),
  put: (url, body) => request(app).put(url).set('Cookie', c).send(body),
});
/** PromptPay target inside an EMVCo payload (tag 29, sub-tag 01/02/03). */
const target = (payload) => {
  const m = payload.match(/29\d{2}0016A000000677010111(?:01|02|03)(\d{2})/);
  return payload.slice(m.index + m[0].length, m.index + m[0].length + Number(m[1]));
};

before(async () => {
  admin = as(await cookie('admin@example.com'));
  cashier = as(await cookie('cashier@example.com')); // branch 2, no open shift needed
  original = await db.one('SELECT promptpay_id, bank_account FROM branches WHERE id = 2');
  await db.query("DELETE FROM settings WHERE org_id = 1 AND setting_key IN ('pos.promptpay_id', 'org.bank_account')");
  await db.query('UPDATE pos_shifts SET closed_at = UTC_TIMESTAMP() WHERE user_id = 4 AND closed_at IS NULL');
});

after(async () => {
  await db.query('UPDATE branches SET promptpay_id = :p, bank_account = :b WHERE id = 2', { p: original.promptpay_id, b: original.bank_account });
  await db.query("DELETE FROM settings WHERE org_id = 1 AND setting_key IN ('pos.promptpay_id', 'org.bank_account')");
  await db.pool.end();
});

test('a branch with its own accounts charges into them; clearing them falls back to the shop', async () => {
  const shop = await admin.put('/api/pos/settings', { promptpayId: '0812345678', bankAccount: { bank: 'ธนาคารไทยพาณิชย์', number: '1112223334', name: 'ร้านหลัก' } });
  assert.equal(shop.status, 200, JSON.stringify(shop.body));

  // no branch override yet
  let s = (await cashier.get('/api/pos/settings')).body.data;
  assert.equal(s.promptpayId, '0812345678');
  assert.equal(s.paymentBranch.id, 2);
  assert.equal(s.paymentBranch.ownPromptpay, false);

  assert.equal((await admin.patch('/api/org/branches/2', { promptpayId: '12345' })).status, 400);
  const set = await admin.patch('/api/org/branches/2', {
    promptpayId: '004-999-081990680',
    bankAccount: { bank: 'ธนาคารกสิกรไทย', number: '062-1-55427-1', name: 'สาขาสอง' },
  });
  assert.equal(set.status, 200, JSON.stringify(set.body));

  const branches = (await admin.get('/api/org/branches')).body.data;
  const b2 = branches.find((b) => b.id === 2);
  assert.equal(b2.promptpayId, '004999081990680');
  assert.equal(b2.bankAccount.display, '062-1-55427-1');

  s = (await cashier.get('/api/pos/settings')).body.data;
  assert.equal(s.promptpayId, '004999081990680');
  assert.equal(s.bankAccount.name, 'สาขาสอง');
  assert.deepEqual([s.paymentBranch.ownPromptpay, s.paymentBranch.ownBank], [true, true]);
  assert.equal(s.defaults.promptpayId, '0812345678');
  assert.equal(s.defaults.bankAccount.name, 'ร้านหลัก');

  const qr = await cashier.get('/api/pos/promptpay?amount=1');
  assert.equal(qr.status, 200);
  assert.equal(target(qr.body.data.payload), '004999081990680');

  // the shop-wide PromptPay still serves branches without their own
  const adminQr = await admin.get('/api/pos/promptpay?amount=1'); // admin works at branch 1, which has no override
  assert.equal(target(adminQr.body.data.payload), '0066812345678');

  // clear only the PromptPay: the bank account override stays
  assert.equal((await admin.patch('/api/org/branches/2', { promptpayId: '' })).status, 200);
  s = (await cashier.get('/api/pos/settings')).body.data;
  assert.equal(s.promptpayId, '0812345678');
  assert.equal(s.bankAccount.name, 'สาขาสอง');
  assert.equal((await admin.patch('/api/org/branches/2', { bankAccount: null })).status, 200);
  assert.equal((await cashier.get('/api/pos/settings')).body.data.bankAccount.name, 'ร้านหลัก');

  assert.equal((await cashier.patch('/api/org/branches/2', { promptpayId: '0812345678' })).status, 403);
});
