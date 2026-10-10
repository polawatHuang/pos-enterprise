'use strict';

const db = require('../db/pool');

/**
 * Enqueue a background job. Executed by the runner on the next cron tick at/after runAt.
 * @param {string} type     handler name, e.g. 'social.publish'
 * @param {object} payload  JSON-serialisable input
 * @param {{orgId?: number, runAt?: Date, priority?: number, maxAttempts?: number}} [opts]
 */
async function enqueue(type, payload = {}, opts = {}) {
  const rows = await db.query(
    `INSERT INTO jobs (org_id, type, payload, priority, max_attempts, run_at)
     VALUES (:orgId, :type, :payload, :priority, :maxAttempts, COALESCE(:runAt, UTC_TIMESTAMP()))`,
    {
      orgId: opts.orgId ?? null,
      type,
      payload: JSON.stringify(payload),
      priority: opts.priority ?? 0,
      maxAttempts: opts.maxAttempts ?? 5,
      runAt: opts.runAt ?? null,
    },
  );
  return rows.insertId;
}

module.exports = { enqueue };
