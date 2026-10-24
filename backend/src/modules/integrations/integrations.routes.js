'use strict';

const express = require('express');
const { z } = require('zod');
const { authenticate, requirePermission } = require('../../core/auth');
const { validate } = require('../../core/http');
const { audit } = require('../../core/audit');
const { badRequest, notFound } = require('../../core/errors');
const runtime = require('../../config/runtime');
const { adapters, status, EDITABLE } = require('../../integrations');
// testable ids are listed in status() so the page only offers the button where it works

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

/** Graph API: an app access token (id|secret) can read the app itself — proves the id/secret pair. */
async function checkMetaApp() {
  const id = runtime.get('META_APP_ID');
  const secret = runtime.get('META_APP_SECRET');
  if (!id) throw new Error('ต้องตั้ง META_APP_ID ด้วยจึงจะทดสอบได้');
  const v = runtime.get('META_GRAPH_VERSION') || 'v23.0';
  const res = await fetch(`https://graph.facebook.com/${v}/${encodeURIComponent(id)}?fields=id,name&access_token=${encodeURIComponent(`${id}|${secret}`)}`, {
    signal: AbortSignal.timeout(15_000),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok || json?.error) throw Object.assign(new Error(json?.error?.message ?? `HTTP ${res.status}`), { status: res.status });
  return `แอป ${json.name ?? json.id}`;
}

/**
 * A cheap, read-only request per service with the current keys, so a pasted key can be checked
 * right away. Returns an optional detail shown next to "เชื่อมต่อได้".
 */
const ping = (a) => a.createMessage({ messages: [{ role: 'user', content: 'ping' }], maxTokens: 16, timeoutMs: 20_000, maxRetries: 0 }).then(() => null);
const TESTS = {
  minimax: ping,
  anthropic: ping,
  minimax_media: async (a) => `พบเสียงพากย์ ${(await a.listVoices()).length} เสียง`,
  shotstack: async (a) => {
    const r = await a.call('/models');
    const models = r?.models ?? [];
    return `${runtime.get('SHOTSTACK_ENV') || 'stage'} · โมเดล AI ที่ใช้ได้ ${models.filter((m) => m.available !== false).length} รายการ`;
  },
  line: async (a) => {
    const info = await a.call('/info', runtime.get('LINE_CHANNEL_ACCESS_TOKEN'), null, 'GET');
    return info?.displayName ? `LINE OA: ${info.displayName}` : null;
  },
  elevenlabs: async () => {
    const res = await fetch('https://api.elevenlabs.io/v1/user', { headers: { 'xi-api-key': runtime.get('ELEVENLABS_API_KEY') }, signal: AbortSignal.timeout(15_000) });
    if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status}`), { status: res.status });
    return null;
  },
  meta: checkMetaApp,
  meta_social: checkMetaApp,
  kalodata: async (a) => `เครดิตคงเหลือ ${Number((await a.balance())?.totalRemain ?? 0).toLocaleString('th-TH')}`,
};

router.post('/:id/test', validate({ params: z.object({ id: z.string().max(40) }) }), async (req, res) => {
  const adapter = adapters.find((a) => a.meta.id === req.valid.params.id);
  if (!adapter) throw notFound();
  const test = TESTS[adapter.meta.id];
  if (!test) throw badRequest('บริการนี้ยังไม่รองรับการทดสอบจากหน้าเว็บ');
  adapter.requireConfig();
  const started = Date.now();
  let detail;
  try {
    detail = await test(adapter);
  } catch (err) {
    const msg = err?.error?.error?.message || err?.message || 'unknown error';
    throw badRequest(`เชื่อมต่อไม่สำเร็จ (${err?.status ?? 'network'}): ${String(msg).slice(0, 200)}`);
  }
  res.json({ data: { ok: true, ms: Date.now() - started, detail: detail ?? null } });
});

module.exports = { router };
