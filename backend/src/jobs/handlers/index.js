'use strict';

const db = require('../../db/pool');
const { enqueue } = require('../queue');

/**
 * Job handlers keyed by type. Each receives (payload, ctx) and returns a JSON-able result.
 * Later phases register: 'social.publish', 'video.pipeline', 'scrape.run', 'inbox.ai_reply', ...
 */
const handlers = {
  /** Housekeeping: prune expired refresh tokens and old finished jobs. */
  async 'system.cleanup'() {
    const tokens = await db.query(
      `DELETE FROM refresh_tokens WHERE expires_at < UTC_TIMESTAMP() - INTERVAL 1 DAY
          OR (revoked_at IS NOT NULL AND revoked_at < UTC_TIMESTAMP() - INTERVAL 7 DAY)`,
    );
    const jobs = await db.query(
      `DELETE FROM jobs WHERE status IN ('succeeded','cancelled') AND updated_at < UTC_TIMESTAMP() - INTERVAL 14 DAY`,
    );
    return { tokensDeleted: tokens.affectedRows, jobsDeleted: jobs.affectedRows };
  },
};

/**
 * AI reply fallback for chats whose immediate (in-request) reply did not complete, e.g. the
 * app was recycled by Passenger. replyToConversation is idempotent, so a double run is harmless.
 */
handlers['inbox.ai_reply'] = async ({ conversationId }, { jobId }) => {
  const { replyToConversation } = require('../../modules/inbox/agent.service');
  try {
    return await replyToConversation(conversationId);
  } catch (err) {
    const job = await db.one('SELECT attempts, max_attempts FROM jobs WHERE id = :jobId', { jobId });
    if (job && job.attempts >= job.max_attempts) {
      const { handoff } = require('../../modules/inbox/inbox.service');
      await handoff(conversationId, 'AI ตอบไม่สำเร็จหลายครั้ง');
    }
    throw err;
  }
};

/** Recurring jobs scheduled by the cron tick (idempotent: one queued instance at a time). */
const recurring = [{ type: 'system.cleanup', everyMinutes: 60 * 24 }];

async function scheduleRecurring() {
  for (const r of recurring) {
    const existing = await db.one(
      `SELECT id FROM jobs WHERE type = :type AND (status IN ('queued','running')
          OR (status = 'succeeded' AND updated_at > UTC_TIMESTAMP() - INTERVAL :mins MINUTE)) LIMIT 1`,
      { type: r.type, mins: r.everyMinutes },
    );
    if (!existing) await enqueue(r.type, {}, { priority: -10 });
  }
}

module.exports = handlers;
module.exports.scheduleRecurring = scheduleRecurring;
