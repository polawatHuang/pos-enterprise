'use strict';

const express = require('express');
const db = require('../../db/pool');
const { authenticate, requirePermission } = require('../../core/auth');

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

module.exports = { router };
