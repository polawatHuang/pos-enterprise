'use strict';

const express = require('express');
const { z } = require('zod');
const { validate } = require('../../core/http');
const { authenticate, requirePermission } = require('../../core/auth');
const repo = require('./dashboard.repo');

const router = express.Router();
router.use(authenticate, requirePermission('dashboard:view'));

const filters = z.object({
  branchId: z.coerce.number().int().positive().optional(),
  days: z.coerce.number().int().refine((d) => [7, 30, 90].includes(d), 'days must be 7, 30 or 90').default(30),
  months: z.coerce.number().int().min(1).max(12).default(6),
  limit: z.coerce.number().int().min(1).max(20).default(5),
});

const ctx = (req) => ({ orgId: req.user.orgId, branchId: req.valid.query.branchId ?? null, ...req.valid.query });

// Short private cache: the dashboard is polled, but numbers needn't be real-time to the second.
router.use((req, res, next) => {
  res.set('Cache-Control', 'private, max-age=30');
  next();
});

const route = (path, fn) =>
  router.get(path, validate({ query: filters }), async (req, res) => {
    res.json({ data: await fn(ctx(req)) });
  });

route('/summary', repo.summary);
route('/sales-trend', repo.salesTrend);
route('/channel-mix', repo.channelMix);
route('/top-products', repo.topProducts);
route('/cashflow', repo.cashflow);
route('/low-stock', repo.lowStock);
route('/inbox', repo.inboxByChannel);
route('/trending', repo.trending);
route('/activity', repo.activity);

module.exports = { router };
