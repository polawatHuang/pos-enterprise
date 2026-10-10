'use strict';

const { ZodError } = require('zod');
const { AppError } = require('./errors');
const logger = require('./logger');

function notFoundHandler(req, res) {
  res.status(404).json({ error: { code: 'NOT_FOUND', message: `Route ${req.method} ${req.path} not found` } });
}

function errorHandler(err, req, res, next) {
  if (err instanceof ZodError) {
    return res.status(400).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'ข้อมูลไม่ถูกต้อง',
        details: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      },
    });
  }
  if (err instanceof AppError) {
    return res.status(err.status).json({ error: { code: err.code, message: err.message, details: err.details } });
  }
  if (err && err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: { code: 'BAD_JSON', message: 'Malformed JSON body' } });
  }
  logger.error({ err, path: req.path }, 'Unhandled error');
  return res.status(500).json({ error: { code: 'INTERNAL', message: 'เกิดข้อผิดพลาดภายในระบบ' } });
}

/** Zod-validate req.body / req.query / req.params; parsed values are placed on req.valid */
function validate(schemas) {
  return (req, res, next) => {
    req.valid = req.valid || {};
    for (const key of ['body', 'query', 'params']) {
      if (schemas[key]) req.valid[key] = schemas[key].parse(req[key] ?? {});
    }
    next();
  };
}

module.exports = { notFoundHandler, errorHandler, validate };
