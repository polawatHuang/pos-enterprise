'use strict';

const express = require('express');
const db = require('../../db/pool');
const { z } = require('zod');
const { authenticate, requirePermission } = require('../../core/auth');
const { validate } = require('../../core/http');
const { audit } = require('../../core/audit');
const { badRequest, forbidden } = require('../../core/errors');
const { resetOrgData, CONFIRM_PHRASE } = require('./reset');

const router = express.Router();
router.use(authenticate);

router.get('/branches', async (req, res) => {
  const rows = await db.query(
    'SELECT id, code, name, branch_no AS branchNo, is_active AS isActive FROM branches WHERE org_id = :orgId ORDER BY code',
    { orgId: req.user.orgId },
  );
  res.json({ data: rows.map((r) => ({ ...r, isActive: Boolean(r.isActive) })) });
});

router.get('/roles', requirePermission('users:read'), async (req, res) => {
  const rows = await db.query(
    `SELECT r.code, r.name, r.description, GROUP_CONCAT(p.code ORDER BY p.code) AS permissions
       FROM roles r
       LEFT JOIN role_permissions rp ON rp.role_id = r.id
       LEFT JOIN permissions p ON p.id = rp.permission_id
      GROUP BY r.id
      ORDER BY r.id`,
  );
  res.json({ data: rows.map((r) => ({ ...r, permissions: r.permissions ? r.permissions.split(',') : [] })) });
});

router.get('/organization', async (req, res) => {
  const org = await db.one(
    'SELECT id, name, legal_name AS legalName, tax_id AS taxId, currency, timezone FROM organizations WHERE id = :orgId',
    { orgId: req.user.orgId },
  );
  res.json({ data: org });
});

/* ------------------------------------------------------- demo data reset */

const OWNER_ROLES = ['owner', 'admin'];
const onlyOwner = (req) => {
  if (!req.user.roles.some((r) => OWNER_ROLES.includes(r))) throw forbidden('เฉพาะเจ้าของกิจการหรือผู้ดูแลระบบเท่านั้น');
};

/** What a reset would remove, so the confirmation dialog can show real numbers. */
router.get('/data-summary', requirePermission('settings:manage'), async (req, res) => {
  onlyOwner(req);
  const orgId = req.user.orgId;
  const count = async (sql) => Number((await db.one(sql, { orgId, me: req.user.id })).n);
  res.json({
    data: {
      products: await count('SELECT COUNT(*) AS n FROM products WHERE org_id = :orgId'),
      salesOrders: await count('SELECT COUNT(*) AS n FROM sales_orders WHERE org_id = :orgId'),
      customers: await count('SELECT COUNT(*) AS n FROM customers WHERE org_id = :orgId'),
      documents: await count('SELECT COUNT(*) AS n FROM documents WHERE org_id = :orgId'),
      transactions: await count('SELECT COUNT(*) AS n FROM transactions WHERE org_id = :orgId'),
      conversations: await count('SELECT COUNT(*) AS n FROM conversations WHERE org_id = :orgId'),
      trends: await count('SELECT COUNT(*) AS n FROM trending_products WHERE org_id = :orgId'),
      videos: await count('SELECT COUNT(*) AS n FROM video_projects WHERE org_id = :orgId'),
      otherUsers: await count('SELECT COUNT(*) AS n FROM users WHERE org_id = :orgId AND id <> :me'),
      confirmPhrase: CONFIRM_PHRASE,
    },
  });
});

/** Delete all demo/business data of the org; only the caller's account survives. */
router.post(
  '/reset-data',
  requirePermission('settings:manage'),
  validate({ body: z.object({ confirm: z.string() }) }),
  async (req, res) => {
    onlyOwner(req);
    if (req.valid.body.confirm.trim() !== CONFIRM_PHRASE) throw badRequest(`พิมพ์ "${CONFIRM_PHRASE}" เพื่อยืนยัน`);
    const { deleted, skipped } = await resetOrgData({ orgId: req.user.orgId, keepUserId: req.user.id });
    // The audit log was cleared with the rest; this entry records who reset it and when
    audit(req, 'org.reset_data', 'organization', req.user.orgId, { tables: Object.keys(deleted).length, skipped });
    res.json({ data: { deleted, skipped } });
  },
);

module.exports = { router };
