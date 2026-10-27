'use strict';

const db = require('../../db/pool');
const { enqueue } = require('../queue');

/**
 * Job handlers keyed by type. Each receives (payload, ctx) and returns a JSON-able result.
 * Later phases register: 'social.publish', 'video.pipeline', ...
 */
const handlers = {
  /** Housekeeping: prune expired refresh tokens and old finished jobs. */
  async 'system.cleanup'() {
    const tokens = await db.query(
      `DELETE FROM refresh_tokens WHERE expires_at < UTC_TIMESTAMP() - INTERVAL 1 DAY
          OR (revoked_at IS NOT NULL AND revoked_at < UTC_TIMESTAMP() - INTERVAL 7 DAY)`,
    );
    const jobs = await db.query(`DELETE FROM jobs WHERE status IN ('succeeded','cancelled') AND updated_at < UTC_TIMESTAMP() - INTERVAL 14 DAY`);
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

/** Trend sources: run a fetch, or check on an async (Apify) run. Failures are recorded on the run. */
handlers['scrape.run'] = async ({ runId }) => require('../../modules/scraping/sources').executeRun(runId);
handlers['scrape.poll'] = async ({ runId, polls }) => require('../../modules/scraping/sources').pollRun(runId, polls);
handlers['scrape.ai'] = async ({ runId, step }) => require('../../modules/scraping/ai-search').runStep(runId, step);

/** AI video pipeline steps (each step queues the next; see modules/video/pipeline.js). */
const video = () => require('../../modules/video/pipeline');
handlers['video.voice'] = (p) => video().voice(p);
handlers['video.images'] = (p) => video().images(p);
handlers['video.clips_start'] = (p) => video().clipsStart(p);
handlers['video.clips_poll'] = (p) => video().clipsPoll(p);
handlers['video.compose'] = (p) => video().compose(p);
handlers['video.compose_poll'] = (p) => video().composePoll(p);
handlers['cover.generate'] = (p) => require('../../modules/covers/covers.service').generateCover(p);

/** Social posting: publish a due post, then poll the platform until the video is live. */
handlers['social.publish'] = (p) => require('../../modules/social/publish').publish(p);
handlers['social.status'] = (p) => require('../../modules/social/publish').checkStatus(p);

/** Low / out-of-stock alerts (in-app + LINE OA) for every org. */
handlers['inventory.alerts'] = () => require('../../modules/inventory/alerts').runAlerts();

/** Daily sales summary to LINE OA at each org's set time (default 18:00), once a day. */
handlers['reports.daily_sales'] = () => require('../../modules/reports/daily-sales').runDue();

/** "ให้ AI ค้นข้อมูลร้าน/รีวิวจากเว็บ" for one trend product: one model call per job. */
handlers['trend.facts'] = (payload) => require('../../modules/scraping/web-facts').step(payload);

/** Kalodata monthly market pull: one short step per job, re-queued until the run is done. */
handlers['kalodata.step'] = (payload) => require('../../modules/scraping/kalodata.service').step(payload);

/** Shopee / TikTok Shop chat: sync conversations with unread buyer messages (pushes can be missed). */
handlers['inbox.marketplace_poll'] = async () => {
  const [{ n }] = await db.query("SELECT COUNT(*) AS n FROM channels WHERE platform IN ('shopee','tiktok') AND is_active = 1");
  return Number(n) ? require('../../modules/inbox/marketplace.service').pollAll() : { shops: 0 };
};

/** Recurring jobs scheduled by the cron tick (idempotent: one queued instance at a time). */
const recurring = [
  { type: 'system.cleanup', everyMinutes: 60 * 24 },
  { type: 'inventory.alerts', everyMinutes: 60 },
  // every 5 minutes so the report arrives within minutes of its set time
  { type: 'reports.daily_sales', everyMinutes: 5 },
  { type: 'inbox.marketplace_poll', everyMinutes: 2 },
];

async function scheduleRecurring() {
  for (const r of recurring) {
    const existing = await db.one(
      `SELECT id FROM jobs WHERE type = :type AND (status IN ('queued','running')
          OR (status = 'succeeded' AND updated_at > UTC_TIMESTAMP() - INTERVAL :mins MINUTE)) LIMIT 1`,
      { type: r.type, mins: r.everyMinutes },
    );
    if (!existing) await enqueue(r.type, {}, { priority: -10 });
  }
  await require('../../modules/scraping/sources').scheduleDueSources();
  await require('../../modules/scraping/kalodata.service').scheduleMonthly();
  await require('../../modules/social/publish').dispatchDue();
}

module.exports = handlers;
module.exports.scheduleRecurring = scheduleRecurring;
