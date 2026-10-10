'use strict';

const express = require('express');
const { authenticate } = require('../../core/auth');

/** /api/accounting — every sub-router enforces its own accounting:* / tax:file permissions. */
const router = express.Router();
router.use(authenticate);
router.use('/transactions', require('./transactions.routes').router);
router.use('/documents', require('./documents.routes').router);
router.use('/tax', require('./tax.routes').router);
router.use('/reports', require('./reports.routes').router);
router.use('/ai', require('./ai-receipt.routes').router);

module.exports = { router };
