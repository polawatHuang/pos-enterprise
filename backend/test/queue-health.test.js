'use strict';

// A due job nobody picks up (no cron tick) must be reported, so pages can say the worker is down.
process.env.NODE_ENV = 'test';

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { createApp } = require('../src/app');
const db = require('../src/db/pool');
const { queueHealth } = require('../src/jobs/queue');

let jobId;
after(async () => {
  if (jobId) await db.query('DELETE FROM jobs WHERE id = :id', { id: jobId });
  await db.pool.end();
});

test('a job due for 10 minutes marks the queue as stalled, also on /api/health', async () => {
  const r = await db.query(
    "INSERT INTO jobs (type, payload, run_at) VALUES ('test.never_runs', '{}', UTC_TIMESTAMP() - INTERVAL 10 MINUTE)",
  );
  jobId = r.insertId;
  const h = await queueHealth();
  assert.equal(h.stalled, true);
  assert.ok(h.due >= 1 && h.waitingSec >= 590, JSON.stringify(h));
  const res = await request(createApp()).get('/api/health');
  assert.equal(res.body.data.jobs.stalled, true);
});
