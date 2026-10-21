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

/**
 * Is anything running the queue? Jobs are executed only when the cron tick (Plesk Scheduled
 * Task -> /internal/cron/tick) or the in-process worker runs, so a due job waiting minutes means
 * neither is working. Returns how long the oldest due job has waited.
 */
async function queueHealth() {
  const r = await db.one(
    `SELECT COUNT(*) AS due, TIMESTAMPDIFF(SECOND, MIN(run_at), UTC_TIMESTAMP()) AS oldest
       FROM jobs WHERE status = 'queued' AND run_at <= UTC_TIMESTAMP()`,
  );
  const waitingSec = Number(r?.oldest ?? 0);
  return { due: Number(r?.due ?? 0), waitingSec, stalled: waitingSec > 180 };
}

module.exports = { enqueue, queueHealth };
