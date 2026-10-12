'use strict';

// /api/health explains database failures by error code only (no credentials or hosts).
process.env.NODE_ENV = 'test';

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const db = require('../src/db/pool');
const { createApp } = require('../src/app');

const app = createApp();
const originalQuery = db.query;

after(async () => {
  db.query = originalQuery;
  await db.pool.end();
});

test('healthy database → 200 without error fields', async () => {
  const res = await request(app).get('/api/health');
  assert.equal(res.status, 200);
  assert.equal(res.body.data.database, 'ok');
  assert.equal(res.body.data.databaseError, undefined);
});

test('access denied → 503 with code and hint, no secrets', async () => {
  db.query = async () => {
    throw Object.assign(new Error("Access denied for user 'pos_user'@'localhost' (using password: YES)"), { code: 'ER_ACCESS_DENIED_ERROR' });
  };
  const res = await request(app).get('/api/health');
  assert.equal(res.status, 503);
  assert.equal(res.body.data.status, 'degraded');
  assert.equal(res.body.data.databaseError, 'ER_ACCESS_DENIED_ERROR');
  assert.match(res.body.data.hint, /DB_PASSWORD/);
  assert.doesNotMatch(JSON.stringify(res.body), /pos_user|localhost'|using password/);
});

test('unknown error → generic hint', async () => {
  db.query = async () => {
    throw new Error('boom secret');
  };
  const res = await request(app).get('/api/health');
  assert.equal(res.body.data.databaseError, 'UNKNOWN');
  assert.doesNotMatch(JSON.stringify(res.body), /boom secret/);
});
