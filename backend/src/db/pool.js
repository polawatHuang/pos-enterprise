'use strict';

const mysql = require('mysql2/promise');
const env = require('../config/env');

const pool = mysql.createPool({
  host: env.DB_HOST,
  port: env.DB_PORT,
  user: env.DB_USER,
  password: env.DB_PASSWORD,
  database: env.DB_NAME,
  connectionLimit: env.DB_CONNECTION_LIMIT,
  waitForConnections: true,
  queueLimit: 0,
  charset: 'utf8mb4',
  timezone: 'Z',
  dateStrings: false,
  decimalNumbers: true,
  enableKeepAlive: true,
  namedPlaceholders: true,
  connectTimeout: 10_000,
  // Shared hosts (Plesk) close idle MySQL connections; drop ours first so the first request
  // after a quiet period does not pick up a dead socket.
  maxIdle: 2,
  idleTimeout: 20_000,
});

// Store and compare all timestamps in UTC regardless of the hosting server's timezone.
pool.pool.on('connection', (conn) => {
  conn.query("SET time_zone = '+00:00'");
});

// The server closed the socket (idle timeout, MySQL restart, app waking up): a fresh connection usually works.
const CONNECTION_LOST = new Set(['PROTOCOL_CONNECTION_LOST', 'ECONNRESET', 'EPIPE', 'ETIMEDOUT', 'ER_CON_COUNT_ERROR', 'ECONNREFUSED']);
const isConnectionLost = (err) => CONNECTION_LOST.has(err?.code) || err?.fatal === true;
// A write may have run before the socket died, so only reads (or errors where the statement never
// reached the server) are re-sent.
const NEVER_SENT = new Set(['ECONNREFUSED', 'ER_CON_COUNT_ERROR']);
const canResend = (sql, err) => NEVER_SENT.has(err?.code) || /^\s*(SELECT|SHOW|WITH)\b/i.test(sql);

async function query(sql, params) {
  try {
    const [rows] = await pool.query(sql, params);
    return rows;
  } catch (err) {
    if (!isConnectionLost(err) || !canResend(sql, err)) throw err;
    await new Promise((r) => setTimeout(r, 150));
    const [rows] = await pool.query(sql, params);
    return rows;
  }
}

async function one(sql, params) {
  const rows = await query(sql, params);
  return rows[0] || null;
}

// InnoDB deadlock / lock-wait timeout: safe to retry the whole transaction.
const RETRYABLE = new Set(['ER_LOCK_DEADLOCK', 'ER_LOCK_WAIT_TIMEOUT']);

/**
 * Run fn(conn) inside a transaction; commits on success, rolls back on throw.
 * Deadlocks are retried (up to 3 attempts) because fn is re-run from scratch on a fresh transaction.
 */
async function tx(fn, attempts = 3) {
  for (let attempt = 1; ; attempt += 1) {
    let conn;
    try {
      conn = await pool.getConnection();
      await conn.beginTransaction();
    } catch (err) {
      // A dead pooled socket fails at BEGIN, before fn ran: safe to retry on a new connection.
      if (conn) conn.destroy();
      if (!isConnectionLost(err) || attempt >= attempts) throw err;
      await new Promise((r) => setTimeout(r, 150));
      continue;
    }
    try {
      const result = await fn(conn);
      await conn.commit();
      return result;
    } catch (err) {
      await conn.rollback().catch(() => {});
      if (!RETRYABLE.has(err.code) || attempt >= attempts) throw err;
      await new Promise((r) => setTimeout(r, 20 * attempt + Math.random() * 30));
    } finally {
      conn.release();
    }
  }
}

module.exports = { pool, query, one, tx, isConnectionLost };
