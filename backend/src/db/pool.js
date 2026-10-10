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
});

// Store and compare all timestamps in UTC regardless of the hosting server's timezone.
pool.pool.on('connection', (conn) => {
  conn.query("SET time_zone = '+00:00'");
});

async function query(sql, params) {
  const [rows] = await pool.query(sql, params);
  return rows;
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
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const result = await fn(conn);
      await conn.commit();
      return result;
    } catch (err) {
      await conn.rollback();
      if (!RETRYABLE.has(err.code) || attempt >= attempts) throw err;
      await new Promise((r) => setTimeout(r, 20 * attempt + Math.random() * 30));
    } finally {
      conn.release();
    }
  }
}

module.exports = { pool, query, one, tx };
