'use strict';

// Webhooks from payment providers. The key in the URL says which shop it is for; the body only
// names a charge, which is then re-read from the provider (see pos/payment-intents).

const express = require('express');
const { rateLimit, ipKeyGenerator } = require('express-rate-limit');
const env = require('../../config/env');
const logger = require('../../core/logger');
const intents = require('../pos/payment-intents');

const router = express.Router();

const limiter = rateLimit({
  windowMs: 60 * 1000,
  limit: env.isTest ? 1000 : 120,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  keyGenerator: (req) => ipKeyGenerator(req.ip ?? ''),
});

router.post('/:provider/:key', limiter, async (req, res) => {
  try {
    const r = await intents.handleWebhook(String(req.params.provider), String(req.params.key), req.body ?? {});
    res.json({ ok: true, ...r });
  } catch (err) {
    if (err.status === 404) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'ไม่พบปลายทาง' } });
    logger.error({ err }, 'payment webhook failed');
    // a 5xx makes the provider retry later, which is what we want for a transient failure
    return res.status(500).json({ error: { code: 'INTERNAL', message: 'ประมวลผลไม่สำเร็จ' } });
  }
});

module.exports = { router };
