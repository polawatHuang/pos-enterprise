'use strict';

const express = require('express');
const { z } = require('zod');
const { validate } = require('../../core/http');
const { authenticate, requirePermission } = require('../../core/auth');
const repo = require('./goals.repo');

const router = express.Router();
router.use(authenticate, requirePermission('dashboard:view'));
router.use((req, res, next) => {
  res.set('Cache-Control', 'private, no-store');
  next();
});

const goalId = z.object({ id: z.coerce.number().int().positive() });
const createGoal = z.object({ title: z.string().trim().min(1).max(200) });
const updateGoal = z.object({ status: z.enum(['pending', 'completed']) });
const historyQuery = z.object({ days: z.coerce.number().int().refine((d) => [7, 30, 90].includes(d)).default(30) });
const userCtx = (req) => ({ orgId: req.user.orgId, userId: req.user.id });

router.get('/today', async (req, res) => {
  res.json({ data: await repo.today(userCtx(req)) });
});

router.post('/', validate({ body: createGoal }), async (req, res) => {
  res.status(201).json({ data: await repo.create({ ...userCtx(req), title: req.valid.body.title }) });
});

router.patch('/:id', validate({ params: goalId, body: updateGoal }), async (req, res) => {
  res.json({ data: await repo.setStatus({ ...userCtx(req), id: req.valid.params.id, status: req.valid.body.status }) });
});

router.delete('/:id', validate({ params: goalId }), async (req, res) => {
  await repo.remove({ ...userCtx(req), id: req.valid.params.id });
  res.json({ data: { deleted: true } });
});

router.get('/history', validate({ query: historyQuery }), async (req, res) => {
  res.json({ data: await repo.history({ ...userCtx(req), days: req.valid.query.days }) });
});

module.exports = { router };
