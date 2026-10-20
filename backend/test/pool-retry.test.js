'use strict';

// A pooled connection the host already closed must not turn the first request after a quiet
// period into a 500: reads are re-sent once on a fresh connection, writes never are.
process.env.NODE_ENV = 'test';

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const db = require('../src/db/pool');

const lost = () => Object.assign(new Error('Connection lost: The server closed the connection.'), { code: 'PROTOCOL_CONNECTION_LOST', fatal: true });

function failFirst(times = 1) {
  const real = db.pool.query;
  let calls = 0;
  db.pool.query = function (...args) {
    calls += 1;
    if (calls <= times) return Promise.reject(lost());
    return real.apply(this, args);
  };
  return { restore: () => (db.pool.query = real), calls: () => calls };
}

after(() => db.pool.end());

test('a read is retried once after a lost connection', async () => {
  const stub = failFirst(1);
  try {
    const row = await db.one('SELECT 1 + 1 AS n');
    assert.equal(row.n, 2);
    assert.equal(stub.calls(), 2);
  } finally {
    stub.restore();
  }
});

test('a write is not re-sent (it may already have run)', async () => {
  const stub = failFirst(1);
  try {
    await assert.rejects(db.query('UPDATE organizations SET name = name WHERE id = 0'), { code: 'PROTOCOL_CONNECTION_LOST' });
    assert.equal(stub.calls(), 1);
  } finally {
    stub.restore();
  }
});

test('other errors are not retried', async () => {
  await assert.rejects(db.query('SELECT * FROM no_such_table_xyz'), { code: 'ER_NO_SUCH_TABLE' });
});

test('tx retries when the connection dies before the transaction starts', async () => {
  const real = db.pool.getConnection;
  let calls = 0;
  db.pool.getConnection = function (...args) {
    calls += 1;
    if (calls === 1) return Promise.reject(lost());
    return real.apply(this, args);
  };
  try {
    const n = await db.tx(async (conn) => (await conn.query('SELECT 3 AS n'))[0][0].n);
    assert.equal(n, 3);
    assert.equal(calls, 2);
  } finally {
    db.pool.getConnection = real;
  }
});
