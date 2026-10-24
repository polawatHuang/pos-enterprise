'use strict';

const express = require('express');
const { authenticate } = require('../../core/auth');

/** /api/hr — staff records, payroll, leave, payroll reports; each route checks its own permission. */
const router = express.Router();
router.use(authenticate);
router.use(require('./employees.routes').router);
router.use(require('./payroll.routes').router);
router.use(require('./leave.routes').router);
router.use('/reports', require('./reports.routes').router);

module.exports = { router };
