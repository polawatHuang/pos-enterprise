'use strict';

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const db = require('../src/db/pool');
const repo = require('../src/modules/operations/operations.repo');

const originalTx = db.tx;

after(() => {
  db.tx = originalTx;
  return db.pool.end();
});

test('daily operations templates include receiving and linked workflows', () => {
  const receiving = repo.DEFAULT_TASKS.find((task) => task.code === 'receive-delivery');
  assert.equal(receiving.type, 'receiving');
  assert.equal(receiving.link, '/purchasing?tab=orders');
  assert.ok(repo.DEFAULT_TASKS.every((task) => task.type));
});

test('workers cannot reopen a closed operations task', async () => {
  const row = { id: 7, assigned_to: null, status: 'done' };
  db.tx = (run) => run({
    query: async () => [[row]],
  });

  await assert.rejects(
    repo.update({
      orgId: 1,
      userId: 2,
      branchId: 3,
      taskId: 7,
      changes: { status: 'in_progress' },
      manager: false,
    }),
    /งานที่ปิดแล้วต้องให้ผู้จัดการเป็นผู้เปิดใหม่/,
  );
});
