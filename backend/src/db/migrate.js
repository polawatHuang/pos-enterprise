'use strict';

// Brings the database up to the code on start-up: runs the files in database/migrations that
// schema_migrations does not list yet, in order. Before this, every deploy needed someone to import
// the new files in phpMyAdmin, and the app broke ("ฐานข้อมูลยังไม่ได้อัปเดต") until they did.
//
// Safe to run again after a half-finished import: "already exists" errors (a column, key or table
// that is already there) are skipped, and the data statements in the migrations are INSERT IGNORE.
// Any other error stops at that file so a person can look; /api/health shows what is pending.

const fs = require('node:fs');
const path = require('node:path');
const env = require('../config/env');
const logger = require('../core/logger');
const { pool } = require('./pool');

const DIR = process.env.MIGRATIONS_DIR || path.resolve(__dirname, '../../../database/migrations');
const FILE = /^(\d{3}_[a-z0-9_]+)\.sql$/i;
/** Part of the file was imported before: what it adds is already there. */
const ALREADY = new Set(['ER_DUP_FIELDNAME', 'ER_DUP_KEYNAME', 'ER_TABLE_EXISTS_ERROR', 'ER_FK_DUP_NAME', 'ER_DUP_ENTRY', 'ER_MULTIPLE_PRI_KEY', 'ER_CANT_DROP_FIELD_OR_KEY']);

/** Last run, for /api/health. */
const status = { state: 'idle', applied: [], pending: [], error: null, dir: null };

/** Splits a .sql file into statements on `;`, ignoring ones inside quotes and comments. */
function splitSql(sql) {
  const out = [];
  let cur = '';
  let quote = null;
  for (let i = 0; i < sql.length; i++) {
    const c = sql[i];
    const next = sql[i + 1];
    if (quote) {
      cur += c;
      if (c === '\\' && quote !== '`') {
        cur += next ?? '';
        i++;
      } else if (c === quote) quote = null;
      continue;
    }
    if (c === '-' && next === '-' && /\s/.test(sql[i + 2] ?? ' ')) {
      while (i < sql.length && sql[i] !== '\n') i++;
      cur += '\n';
      continue;
    }
    if (c === '#') {
      while (i < sql.length && sql[i] !== '\n') i++;
      cur += '\n';
      continue;
    }
    if (c === '/' && next === '*') {
      const end = sql.indexOf('*/', i + 2);
      i = end < 0 ? sql.length : end + 1;
      cur += ' ';
      continue;
    }
    if (c === "'" || c === '"' || c === '`') quote = c;
    if (c === ';') {
      if (cur.trim()) out.push(cur.trim());
      cur = '';
      continue;
    }
    cur += c;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

function migrationFiles(dir = DIR) {
  if (!fs.existsSync(dir)) return null;
  return fs
    .readdirSync(dir)
    .map((f) => FILE.exec(f))
    .filter(Boolean)
    .map((m) => ({ version: m[1], file: path.join(dir, m[0]) }))
    .sort((a, b) => a.version.localeCompare(b.version));
}

/** What is not applied yet (null when it cannot tell). */
async function pendingMigrations(conn, dir = DIR) {
  const files = migrationFiles(dir);
  if (!files) return null;
  const [tables] = await conn.query("SHOW TABLES LIKE 'schema_migrations'");
  // No bookkeeping table = a database we know nothing about: never guess, leave it to a person
  if (!tables.length) return null;
  const [rows] = await conn.query('SELECT version FROM schema_migrations');
  const done = new Set(rows.map((r) => r.version));
  return files.filter((f) => !done.has(f.version));
}

/** "ALTER TABLE t ADD a, ADD b" → ["ALTER TABLE t ADD a", "ALTER TABLE t ADD b"] (top-level commas only). */
function alterClauses(stmt) {
  const m = /^(ALTER\s+TABLE\s+\S+)\s+([\s\S]+)$/i.exec(stmt);
  if (!m) return null;
  const parts = [];
  let depth = 0;
  let quote = null;
  let cur = '';
  for (const c of m[2]) {
    if (quote) {
      if (c === quote) quote = null;
    } else if (c === "'" || c === '"' || c === '`') quote = c;
    else if (c === '(') depth++;
    else if (c === ')') depth--;
    else if (c === ',' && depth === 0) {
      parts.push(cur.trim());
      cur = '';
      continue;
    }
    cur += c;
  }
  parts.push(cur.trim());
  return parts.length > 1 ? parts.map((p) => `${m[1]} ${p}`) : null;
}

async function tolerant(conn, stmt, version) {
  try {
    await conn.query(stmt);
    return;
  } catch (err) {
    if (!ALREADY.has(err.code)) throw Object.assign(err, { migration: version });
    // one clause of a multi-part ALTER was there already: apply the others one by one
    const parts = alterClauses(stmt);
    if (!parts) return logger.warn({ migration: version, code: err.code }, 'migration step already applied, skipped');
  }
  for (const part of alterClauses(stmt)) {
    try {
      await conn.query(part);
    } catch (err) {
      if (!ALREADY.has(err.code)) throw Object.assign(err, { migration: version });
      logger.warn({ migration: version, code: err.code }, 'migration step already applied, skipped');
    }
  }
}

async function runFile(conn, m) {
  for (const stmt of splitSql(fs.readFileSync(m.file, 'utf8'))) await tolerant(conn, stmt, m.version);
  // the file's own INSERT may have been skipped above; make sure it is recorded
  await conn.query('INSERT IGNORE INTO schema_migrations (version) VALUES (?)', [m.version]);
}

/** Applies what is pending. One server at a time (Passenger can start several processes). */
async function migrate({ dir = DIR } = {}) {
  status.dir = dir;
  status.state = 'running';
  status.error = null;
  status.applied = [];
  let conn = null;
  let locked = false;
  try {
    conn = await pool.getConnection();
    const [[lock]] = await conn.query("SELECT GET_LOCK('pos_enterprise_migrate', 120) AS ok");
    locked = lock.ok === 1;
    if (!locked) throw new Error('another process is migrating');
    const pending = await pendingMigrations(conn, dir);
    if (!pending) {
      status.state = 'skipped';
      status.pending = [];
      logger.warn({ dir }, 'migrations: folder or schema_migrations table not found, nothing run');
      return status;
    }
    status.pending = pending.map((p) => p.version);
    for (const m of pending) {
      logger.info({ migration: m.version }, 'applying migration');
      await runFile(conn, m);
      status.applied.push(m.version);
      status.pending = status.pending.filter((v) => v !== m.version);
    }
    status.state = 'done';
    if (status.applied.length) logger.info({ applied: status.applied }, 'database migrated');
    return status;
  } catch (err) {
    status.state = 'failed';
    status.error = { migration: err.migration ?? null, code: err.code ?? null, message: err.sqlMessage ?? err.message };
    logger.error({ err, migration: err.migration }, 'migration failed');
    return status;
  } finally {
    if (locked) await conn.query("SELECT RELEASE_LOCK('pos_enterprise_migrate')").catch(() => {});
    conn?.release();
  }
}

const enabled = () => env.AUTO_MIGRATE !== false && !env.isTest;

module.exports = { migrate, pendingMigrations, splitSql, alterClauses, status, enabled };
