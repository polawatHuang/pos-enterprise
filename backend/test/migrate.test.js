'use strict';

// Automatic migrations on start-up: pending files run once, in order, and a half-imported file can
// be finished without errors about what is already there.
process.env.NODE_ENV = 'test';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const db = require('../src/db/pool');
const { migrate, splitSql, alterClauses } = require('../src/db/migrate');

const RUN = Date.now().toString(36);
const table = `zz_mig_${RUN}`;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mig-'));
const versions = [`900_${RUN}_a`, `901_${RUN}_b`];

after(async () => {
  await db.query(`DROP TABLE IF EXISTS ${table}`);
  await db.query('DELETE FROM schema_migrations WHERE version IN (:v)', { v: versions });
  fs.rmSync(dir, { recursive: true, force: true });
  await db.pool.end();
});

test('statements split on ; outside quotes and comments', () => {
  const sql = "-- a; comment\nCREATE TABLE t (a INT COMMENT 'x; y');\n/* b; */ INSERT INTO t VALUES (1); # c;\n";
  assert.deepEqual(splitSql(sql), ["CREATE TABLE t (a INT COMMENT 'x; y')", 'INSERT INTO t VALUES (1)']);
  assert.deepEqual(alterClauses('ALTER TABLE t ADD COLUMN a INT, ADD UNIQUE KEY k (a, b)'), ['ALTER TABLE t ADD COLUMN a INT', 'ALTER TABLE t ADD UNIQUE KEY k (a, b)']);
  assert.equal(alterClauses('ALTER TABLE t ADD COLUMN a INT'), null);
});

test('pending files run in order, are recorded, and a half-imported one is finished', async () => {
  fs.writeFileSync(path.join(dir, `${versions[0]}.sql`), `CREATE TABLE ${table} (id INT PRIMARY KEY);\nINSERT INTO schema_migrations (version) VALUES ('${versions[0]}');\n`);
  fs.writeFileSync(
    path.join(dir, `${versions[1]}.sql`),
    `ALTER TABLE ${table}\n  ADD COLUMN a INT NULL,\n  ADD COLUMN b INT NULL,\n  ADD UNIQUE KEY uq_${RUN} (a, b);\nINSERT INTO schema_migrations (version) VALUES ('${versions[1]}');\n`,
  );
  const first = await migrate({ dir });
  assert.equal(first.state, 'done', JSON.stringify(first.error));
  assert.deepEqual(first.applied, versions);
  const cols = (await db.query(`SHOW COLUMNS FROM ${table}`)).map((c) => c.Field);
  assert.deepEqual(cols, ['id', 'a', 'b']);

  // nothing left to do
  assert.deepEqual((await migrate({ dir })).applied, []);

  // someone imported part of 901 by hand: column a is there, b and the key are not
  await db.query(`ALTER TABLE ${table} DROP KEY uq_${RUN}, DROP COLUMN b`);
  await db.query('DELETE FROM schema_migrations WHERE version = :v', { v: versions[1] });
  const again = await migrate({ dir });
  assert.equal(again.state, 'done', JSON.stringify(again.error));
  assert.deepEqual(again.applied, [versions[1]]);
  assert.deepEqual((await db.query(`SHOW COLUMNS FROM ${table}`)).map((c) => c.Field), ['id', 'a', 'b']);
  assert.equal((await db.query(`SHOW INDEX FROM ${table} WHERE Key_name = :k`, { k: `uq_${RUN}` })).length, 2);
});

test('a real error stops and is reported; no folder = nothing run', async () => {
  const bad = `902_${RUN}_bad`;
  versions.push(bad);
  fs.writeFileSync(path.join(dir, `${bad}.sql`), `ALTER TABLE ${table} ADD COLUMN c NOT_A_TYPE;\n`);
  const r = await migrate({ dir });
  assert.equal(r.state, 'failed');
  assert.equal(r.error.migration, bad);
  assert.deepEqual(r.pending, [bad]);
  assert.equal((await migrate({ dir: path.join(dir, 'missing') })).state, 'skipped');
});
