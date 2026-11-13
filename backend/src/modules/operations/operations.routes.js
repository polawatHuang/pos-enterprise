'use strict';

const express = require('express');
const { z } = require('zod');
const { validate } = require('../../core/http');
const { authenticate } = require('../../core/auth');
const { audit } = require('../../core/audit');
const { badRequest, forbidden } = require('../../core/errors');
const repo = require('./operations.repo');

const router = express.Router();
router.use(authenticate);
router.use((req, res, next) => {
  res.set('Cache-Control', 'private, no-store');
  next();
});

const branchQuery = z.object({ branchId: z.coerce.number().int().positive().optional() });
const idParams = z.object({ id: z.coerce.number().int().positive() });
const createBody = z.object({
  branchId: z.number().int().positive(),
  type: z.enum(['checklist', 'incident', 'handoff', 'receiving']).default('checklist'),
  shift: z.enum(['morning', 'day', 'evening', 'any']).default('any'),
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000).optional(),
  priority: z.enum(['normal', 'high', 'urgent']).default('normal'),
  assignedTo: z.number().int().positive().nullable().optional(),
  dueAt: z.iso.datetime({ offset: true }).nullable().optional(),
  handoffNote: z.string().trim().max(1000).optional(),
});
const updateBody = z.object({
  status: z.enum(['pending', 'in_progress', 'done', 'skipped', 'follow_up']).optional(),
  reason: z.string().trim().max(500).optional(),
  note: z.string().trim().max(1000).optional(),
  assignedTo: z.number().int().positive().nullable().optional(),
  priority: z.enum(['normal', 'high', 'urgent']).optional(),
}).refine((value) => Object.keys(value).length > 0, 'กรุณาระบุข้อมูลที่ต้องการแก้ไข');

const canWork = (req) => req.user.permissions.includes('operations:work') || req.user.permissions.includes('operations:manage');
const canManage = (req) => req.user.permissions.includes('operations:manage');
const requireWork = (req, res, next) => (canWork(req) ? next() : next(forbidden('ต้องมีสิทธิ์ operations:work')));
const requireManager = (req, res, next) => (canManage(req) ? next() : next(forbidden('ต้องมีสิทธิ์ operations:manage')));

function scopeBranch(req, requestedBranchId) {
  if (req.user.branchId != null && Number(req.user.branchId) !== Number(requestedBranchId)) {
    throw forbidden('คุณไม่มีสิทธิ์เข้าถึงงานของสาขานี้');
  }
  if (!requestedBranchId) throw badRequest('กรุณาเลือกสาขา');
  return Number(requestedBranchId);
}

router.get('/tasks', requireWork, validate({ query: branchQuery }), async (req, res) => {
  const branchId = scopeBranch(req, req.valid.query.branchId ?? req.user.branchId);
  res.json({
    data: await repo.list({
      orgId: req.user.orgId,
      userId: req.user.id,
      branchId,
      managed: canManage(req),
    }),
  });
});

router.get('/team', requireManager, validate({ query: branchQuery }), async (req, res) => {
  const branchId = scopeBranch(req, req.valid.query.branchId ?? req.user.branchId);
  res.json({ data: await repo.team({ orgId: req.user.orgId, branchId }) });
});

router.post('/tasks', requireManager, validate({ body: createBody }), async (req, res) => {
  const body = req.valid.body;
  const branchId = scopeBranch(req, body.branchId);
  const task = await repo.create({
    orgId: req.user.orgId,
    userId: req.user.id,
    branchId,
    task: body,
  });
  audit(req, 'operations.task.create', 'operations_task', task.id, { type: task.type, priority: task.priority, branchId });
  res.status(201).json({ data: task });
});

router.patch('/tasks/:id', requireWork, validate({ params: idParams, body: updateBody, query: branchQuery }), async (req, res) => {
  const branchId = scopeBranch(req, req.valid.query.branchId ?? req.user.branchId);
  const changes = req.valid.body;
  const manager = canManage(req);
  if (!manager && (changes.assignedTo !== undefined || changes.priority !== undefined)) {
    throw forbidden('ต้องมีสิทธิ์ operations:manage เพื่อมอบหมายงานหรือเปลี่ยนความสำคัญ');
  }
  const task = await repo.update({
    orgId: req.user.orgId,
    userId: req.user.id,
    branchId,
    taskId: req.valid.params.id,
    changes,
    manager,
  });
  audit(req, 'operations.task.update', 'operations_task', task.id, {
    status: task.status,
    assignedTo: task.assignedTo,
    priority: task.priority,
  });
  res.json({ data: task });
});

router.get('/tasks/:id/events', requireWork, validate({ params: idParams, query: branchQuery }), async (req, res) => {
  const branchId = scopeBranch(req, req.valid.query.branchId ?? req.user.branchId);
  res.json({
    data: await repo.events({
      orgId: req.user.orgId,
      userId: req.user.id,
      branchId,
      taskId: req.valid.params.id,
      manager: canManage(req),
    }),
  });
});

module.exports = { router };
