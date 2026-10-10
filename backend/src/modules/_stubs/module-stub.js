'use strict';

const express = require('express');
const { authenticate, requirePermission } = require('../../core/auth');
const { notImplemented } = require('../../core/errors');

/**
 * Placeholder router for modules scheduled in later phases. It is already wired
 * into auth/RBAC so the frontend can integrate against the final URL shape.
 */
function moduleStub({ name, phase, permission, integrations = [] }) {
  const router = express.Router();
  router.use(authenticate, requirePermission(permission));
  router.get('/', (req, res) => {
    res.json({ data: { module: name, phase, status: 'planned', integrations } });
  });
  router.all('/{*rest}', () => {
    throw notImplemented(`โมดูล ${name} จะเปิดใช้งานในเฟสที่ ${phase}`, { module: name, phase });
  });
  return router;
}

module.exports = { moduleStub };
