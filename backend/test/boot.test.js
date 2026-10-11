'use strict';
/* eslint-disable no-console */

// Boot fallback: what a misconfigured deploy answers instead of Passenger's blank 500.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { describeBootError, startFallbackServer } = require('../src/boot/fallback');

test('missing env vars → names and reasons only, never values', () => {
  const err = Object.assign(new Error('Invalid environment configuration'), {
    issues: [
      { name: 'DB_USER', problem: 'ยังไม่ได้ตั้งค่า' },
      { name: 'JWT_ACCESS_SECRET', problem: 'JWT_ACCESS_SECRET must be at least 32 characters' },
    ],
  });
  const d = describeBootError(err);
  assert.equal(d.code, 'MISCONFIGURED');
  assert.deepEqual(d.missing, ['DB_USER', 'JWT_ACCESS_SECRET']);
  assert.equal(d.issues.length, 2);
});

test('npm install not run → package name, no server paths', () => {
  const pkg = describeBootError(Object.assign(new Error("Cannot find module 'zod'\nRequire stack: /var/www/app.js"), { code: 'MODULE_NOT_FOUND' }));
  assert.equal(pkg.code, 'DEPENDENCIES_MISSING');
  assert.deepEqual(pkg.missing, ['zod']);
  assert.doesNotMatch(JSON.stringify(pkg), /\/var\/www/);
  const local = describeBootError(Object.assign(new Error("Cannot find module '/var/www/vhosts/x/src/app'"), { code: 'MODULE_NOT_FOUND' }));
  assert.doesNotMatch(JSON.stringify(local), /vhosts/);
});

test('other errors stay generic (no stack or message leak)', () => {
  const d = describeBootError(new Error('secret=abc123 at /srv/app.js'));
  assert.equal(d.code, 'BOOT_FAILED');
  assert.doesNotMatch(JSON.stringify(d), /abc123|\/srv/);
});

test('fallback server answers 503 JSON on every path', async () => {
  const errLog = console.error;
  console.error = () => {};
  const server = startFallbackServer(Object.assign(new Error('x'), { issues: [{ name: 'DB_NAME', problem: 'ยังไม่ได้ตั้งค่า' }] }), 0);
  console.error = errLog;
  await new Promise((r) => server.once('listening', r));
  try {
    const res = await fetch(`http://127.0.0.1:${server.address().port}/api/health`);
    assert.equal(res.status, 503);
    const body = await res.json();
    assert.equal(body.error.code, 'MISCONFIGURED');
    assert.deepEqual(body.error.missing, ['DB_NAME']);
  } finally {
    server.close();
  }
});
