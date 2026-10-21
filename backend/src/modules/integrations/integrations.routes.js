'use strict';

const express = require('express');
const { z } = require('zod');
const { authenticate, requirePermission } = require('../../core/auth');
const { validate } = require('../../core/http');
const { audit } = require('../../core/audit');
const { badRequest, notFound } = require('../../core/errors');
const runtime = require('../../config/runtime');
const { adapters, status, EDITABLE } = require('../../integrations');

const router = express.Router();
router.use(authenticate, requirePermission('integrations:manage'));

// Which third-party keys are configured and where each value comes from (never the secret values themselves)
router.get('/status', (req, res) => {
  res.json({ data: status() });
});

/**
 * Save keys from the web UI. They are stored encrypted and take priority over the server
 * environment; sending null or "" for a name removes the override (back to the .env value).
 */
router.put(
  '/config',
  validate({ body: z.object({ values: z.record(z.string(), z.string().trim().max(4000).nullable()) }) }),
  async (req, res) => {
    const { values } = req.valid.body;
    const names = Object.keys(values);
    if (!names.length) throw badRequest('ไม่มีค่าที่จะบันทึก');
    const unknown = names.filter((n) => !EDITABLE.has(n));
    if (unknown.length) throw badRequest(`ตั้งค่าจากหน้าเว็บไม่ได้: ${unknown.join(', ')}`, { unknown });
    if (values.AI_PROVIDER && !['minimax', 'anthropic'].includes(values.AI_PROVIDER.toLowerCase())) {
      throw badRequest('AI_PROVIDER ต้องเป็น minimax หรือ anthropic');
    }
    try {
      await runtime.save(values, req.user.id);
    } catch (err) {
      if (/APP_ENCRYPTION_KEY/.test(err.message)) {
        throw badRequest('ต้องตั้งค่า APP_ENCRYPTION_KEY (32 bytes, base64) บนเซิร์ฟเวอร์ก่อน จึงจะบันทึกคีย์จากหน้าเว็บได้');
      }
      throw err;
    }
    // Names only: the values are secrets
    audit(req, 'integrations.config_update', 'app_config', null, {
      set: names.filter((n) => values[n]),
      reset: names.filter((n) => !values[n]),
    });
    res.json({ data: status() });
  },
);

// A one-line request with the current keys, so a pasted key can be checked right away
const TESTABLE = new Set(['minimax', 'anthropic']);
router.post('/:id/test', validate({ params: z.object({ id: z.string().max(40) }) }), async (req, res) => {
  const adapter = adapters.find((a) => a.meta.id === req.valid.params.id);
  if (!adapter) throw notFound();
  if (!TESTABLE.has(adapter.meta.id)) throw badRequest('บริการนี้ยังไม่รองรับการทดสอบจากหน้าเว็บ');
  adapter.requireConfig();
  const started = Date.now();
  try {
    await adapter.createMessage({ messages: [{ role: 'user', content: 'ping' }], maxTokens: 16, timeoutMs: 20_000, maxRetries: 0 });
  } catch (err) {
    const msg = err?.error?.error?.message || err?.message || 'unknown error';
    throw badRequest(`เชื่อมต่อไม่สำเร็จ (${err?.status ?? 'network'}): ${String(msg).slice(0, 200)}`);
  }
  res.json({ data: { ok: true, ms: Date.now() - started } });
});

module.exports = { router };
