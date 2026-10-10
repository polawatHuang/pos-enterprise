'use strict';

const pino = require('pino');
const env = require('../config/env');

// JSON logs to stdout/stderr — Plesk/Passenger captures them in the app's log files.
module.exports = pino({
  level: env.isTest ? 'silent' : env.LOG_LEVEL,
  redact: ['req.headers.authorization', 'req.headers.cookie', 'password', '*.password'],
});
