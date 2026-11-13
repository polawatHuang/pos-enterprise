'use strict';

process.env.NODE_ENV = 'test';
process.env.DB_USER = process.env.DB_USER || 'test';
process.env.DB_NAME = process.env.DB_NAME || 'test';
process.env.JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET || 'test-secret-that-is-long-enough-for-jwt';
process.env.CRON_SECRET = process.env.CRON_SECRET || 'test-cron-secret-long-enough';

const { test, after } = require('node:test');
const assert = require('node:assert/strict');

const poolPath = require.resolve('../src/db/pool');
const savedPool = require.cache[poolPath];
const calls = [];
let queryResult;
let oneResult;
require.cache[poolPath] = {
  id: poolPath,
  filename: poolPath,
  loaded: true,
  exports: {
    query: async (sql, params) => {
      calls.push({ method: 'query', sql, params });
      return typeof queryResult === 'function' ? queryResult(sql, params) : queryResult;
    },
    one: async (sql, params) => {
      calls.push({ method: 'one', sql, params });
      return typeof oneResult === 'function' ? oneResult(sql, params) : oneResult;
    },
  },
};

const goals = require('../src/modules/dashboard/goals.repo');
after(() => {
  if (savedPool) require.cache[poolPath] = savedPool;
  else delete require.cache[poolPath];
});

const owner = { orgId: 7, userId: 21 };
const row = { id: 17, goal_date: '2026-11-13', title: 'ขายเสื้อ 20 ตัว', status: 'pending', created_at: null, completed_at: null };

test('today expires this user’s overdue goals and returns only their current-day goals', async () => {
  calls.length = 0;
  queryResult = (sql) => sql.startsWith('UPDATE') ? { affectedRows: 1 } : [row];
  const result = await goals.today(owner);
  assert.equal(result[0].id, 17);
  assert.equal(result[0].date, '2026-11-13');
  assert.deepEqual(calls.map((call) => call.method), ['query', 'query']);
  assert.ok(calls.every(({ params }) => params.orgId === owner.orgId && params.userId === owner.userId));
  assert.match(calls[0].sql, /status = 'missed'/);
});

test('creation enforces the daily limit before inserting', async () => {
  calls.length = 0;
  oneResult = { count: 20 };
  await assert.rejects(goals.create({ ...owner, title: 'เป้าหมายใหม่' }), (err) => err.status === 400);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, 'one');
});

test('completion is scoped to the owner and returns the persisted status', async () => {
  calls.length = 0;
  queryResult = { affectedRows: 1 };
  oneResult = { ...row, status: 'completed', completed_at: '2026-11-13 03:00:00' };
  const result = await goals.setStatus({ ...owner, id: 17, status: 'completed' });
  assert.equal(result.status, 'completed');
  assert.equal(calls[0].params.orgId, owner.orgId);
  assert.equal(calls[0].params.userId, owner.userId);
  assert.equal(calls[0].params.id, 17);
  assert.match(calls[0].sql, /goal_date = DATE\(CONVERT_TZ/);
});

test('history includes goals created today in the selected calendar-day range', async () => {
  calls.length = 0;
  queryResult = (sql) => sql.startsWith('UPDATE') ? { affectedRows: 0 } : [row];
  const result = await goals.history({ ...owner, days: 30 });
  const historyQuery = calls[1];
  assert.equal(result[0].id, 17);
  assert.equal(result[0].date, '2026-11-13');
  assert.equal(historyQuery.params.daysBeforeToday, 29);
  assert.match(historyQuery.sql, /goal_date <= DATE\(CONVERT_TZ/);
});
