'use strict';

const express = require('express');
const { authenticate, requirePermission } = require('../../core/auth');
const { status } = require('../../integrations');

const router = express.Router();
router.use(authenticate, requirePermission('integrations:manage'));

// Which third-party keys are configured (never returns the secret values themselves)
router.get('/status', (req, res) => {
  res.json({ data: status() });
});

module.exports = { router };
