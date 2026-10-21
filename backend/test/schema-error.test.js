'use strict';

// A database that is missing a migration must say so, not "เกิดข้อผิดพลาดภายในระบบ".
process.env.NODE_ENV = 'test';

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { errorHandler } = require('../src/core/http');
const db = require('../src/db/pool');

after(() => db.pool.end());

function run(err) {
  const out = {};
  errorHandler(err, { path: '/api/x' }, { status: (c) => ((out.status = c), { json: (b) => (out.body = b) }) });
  return out;
}

test('missing table or column names the gap and points to the migrations', async () => {
  const err = await db.query('SELECT * FROM cover_projects_not_migrated').catch((e) => e);
  const r = run(err);
  assert.equal(r.status, 500);
  assert.equal(r.body.error.code, 'SCHEMA_OUTDATED');
  assert.match(r.body.error.message, /ตาราง cover_projects_not_migrated/);

  const col = await db.query('SELECT no_such_column FROM organizations').catch((e) => e);
  assert.match(run(col).body.error.message, /คอลัมน์ no_such_column/);
  assert.equal(run(new Error('boom')).body.error.code, 'INTERNAL');
});

test('a delete blocked by a foreign key names the referencing table', async () => {
  // Sold products are referenced by sales_order_items (no ON DELETE): the delete must be refused.
  // Runs in a transaction that is always rolled back, so the demo data is never touched.
  const conn = await db.pool.getConnection();
  let err;
  try {
    await conn.beginTransaction();
    err = await conn.query('DELETE FROM products WHERE id IN (SELECT product_id FROM sales_order_items)').then(
      () => null,
      (e) => e,
    );
  } finally {
    await conn.rollback();
    conn.release();
  }
  assert.ok(err, 'the delete must have been refused');
  const r = run(err);
  assert.equal(r.status, 409, err.code);
  assert.equal(r.body.error.code, 'IN_USE');
  assert.match(r.body.error.message, /ตาราง sales_order_items/);
});
