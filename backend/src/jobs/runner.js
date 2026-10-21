'use strict';

const os = require('node:os');
const db = require('../db/pool');
const logger = require('../core/logger');
const runtime = require('../config/runtime');
const handlers = require('./handlers');

const WORKER_ID = `${os.hostname()}:${process.pid}`;
// Jobs stuck in "running" longer than this (process killed mid-job) are re-queued.
const STALE_LOCK_MINUTES = 15;

/** Atomically claim one due job. SKIP LOCKED needs MySQL 8.0.1+ / MariaDB 10.6+. */
async function claimNext() {
  return db.tx(async (conn) => {
    const [rows] = await conn.query(
      `SELECT id, org_id, type, payload, attempts, max_attempts FROM jobs
        WHERE status = 'queued' AND run_at <= UTC_TIMESTAMP()
        ORDER BY priority DESC, run_at ASC
        LIMIT 1
        FOR UPDATE SKIP LOCKED`,
    );
    const job = rows[0];
    if (!job) return null;
    await conn.query(
      `UPDATE jobs SET status = 'running', attempts = attempts + 1, locked_at = UTC_TIMESTAMP(), locked_by = :worker
        WHERE id = :id`,
      { id: job.id, worker: WORKER_ID },
    );
    return { ...job, attempts: job.attempts + 1 };
  });
}

function parsePayload(p) {
  if (p == null) return {};
  return typeof p === 'string' ? JSON.parse(p) : p;
}

async function runOne(job) {
  const handler = handlers[job.type];
  try {
    if (!handler) throw new Error(`No handler registered for job type "${job.type}"`);
    const result = await handler(parsePayload(job.payload), { jobId: job.id, orgId: job.org_id });
    await db.query(
      `UPDATE jobs SET status = 'succeeded', result = :result, last_error = NULL, locked_at = NULL WHERE id = :id`,
      { id: job.id, result: result === undefined ? null : JSON.stringify(result) },
    );
    return 'succeeded';
  } catch (err) {
    const final = job.attempts >= job.max_attempts || !handler;
    // Exponential backoff: 1, 4, 9, 16 ... minutes
    const delayMin = job.attempts * job.attempts;
    await db.query(
      `UPDATE jobs SET status = :status, last_error = :error, locked_at = NULL,
              run_at = IF(:final, run_at, UTC_TIMESTAMP() + INTERVAL :delayMin MINUTE)
        WHERE id = :id`,
      { id: job.id, status: final ? 'failed' : 'queued', error: String(err?.stack || err).slice(0, 4000), final, delayMin },
    );
    logger.warn({ jobId: job.id, type: job.type, err: err?.message, final }, 'job failed');
    return final ? 'failed' : 'retry';
  }
}

/**
 * Process due jobs until none remain or the time budget is spent.
 * Called by POST /internal/cron/tick (shared hosting) or by the in-process loop (VPS).
 */
async function runDue({ maxJobs = 20, timeBudgetMs = 45_000 } = {}) {
  const started = Date.now();
  await runtime.load(); // keys saved from the web UI, also for the in-process worker that serves no requests
  await db.query(
    `UPDATE jobs SET status = 'queued', locked_at = NULL
      WHERE status = 'running' AND locked_at < UTC_TIMESTAMP() - INTERVAL :mins MINUTE`,
    { mins: STALE_LOCK_MINUTES },
  );
  const stats = { processed: 0, succeeded: 0, failed: 0, retry: 0 };
  while (stats.processed < maxJobs && Date.now() - started < timeBudgetMs) {
    const job = await claimNext();
    if (!job) break;
    const outcome = await runOne(job);
    stats.processed += 1;
    stats[outcome] += 1;
  }
  stats.durationMs = Date.now() - started;
  return stats;
}

/** VPS mode only: poll continuously inside the web process. */
function startInProcessLoop(intervalMs = 15_000) {
  let busy = false;
  const timer = setInterval(async () => {
    if (busy) return;
    busy = true;
    try {
      await runDue();
    } catch (err) {
      logger.error({ err }, 'in-process job loop error');
    } finally {
      busy = false;
    }
  }, intervalMs);
  timer.unref();
  return timer;
}

module.exports = { runDue, startInProcessLoop };
