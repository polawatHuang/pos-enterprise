'use strict';

const crypto = require('node:crypto');
const express = require('express');
const env = require('../config/env');
const { unauthorized } = require('../core/errors');
const { runDue } = require('../jobs/runner');
const { scheduleRecurring } = require('../jobs/handlers');

const router = express.Router();

function safeEqual(a, b) {
  const ab = Buffer.from(String(a || ''));
  const bb = Buffer.from(String(b || ''));
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}

async function tick(req, res) {
  await scheduleRecurring();
  const stats = await runDue();
  res.json({ data: stats });
}

/**
 * Triggered every minute by Plesk "Scheduled Tasks" because Passenger may stop an idle
 * Node app, so in-process timers are not reliable.
 *   POST + X-Cron-Secret header  -> task type "Run a command" with curl (preferred)
 *   GET  ?key=<CRON_SECRET>      -> task type "Fetch a URL" (cannot send headers)
 */
router.post('/cron/tick', async (req, res) => {
  if (!safeEqual(req.get('x-cron-secret'), env.CRON_SECRET)) throw unauthorized('invalid cron secret');
  await tick(req, res);
});

router.get('/cron/tick', async (req, res) => {
  if (!safeEqual(req.query.key, env.CRON_SECRET)) throw unauthorized('invalid cron secret');
  await tick(req, res);
});

module.exports = { router };
