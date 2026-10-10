'use strict';

const { defineAdapter } = require('./define');
const { AppError } = require('../core/errors');

const adapter = defineAdapter(
  {
    id: 'shotstack',
    name: 'Shotstack Edit API',
    category: 'video',
    usedBy: ['video'],
    phase: 6,
    purpose: 'ประกอบคลิป 9:16 บนคลาวด์ (ภาพ/คลิป + เสียงพากย์ + ซับ) ไม่ต้องใช้ ffmpeg บนโฮสต์',
    applyUrl: 'https://dashboard.shotstack.io/',
    env: [
      { name: 'SHOTSTACK_API_KEY' },
      // "stage" is free with a watermark; "v1" is production
      { name: 'SHOTSTACK_ENV', optional: true, default: 'stage' },
    ],
  },
  {
    async call(path, { method = 'GET', body } = {}) {
      const env = adapter.requireConfig();
      const res = await fetch(`https://api.shotstack.io/edit/${env.SHOTSTACK_ENV || 'stage'}${path}`, {
        method,
        headers: { 'x-api-key': env.SHOTSTACK_API_KEY, Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(30_000),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || json?.success === false) {
        throw new AppError(502, 'SHOTSTACK_ERROR', `Shotstack: ${json?.message ?? `HTTP ${res.status}`}`.slice(0, 300));
      }
      return json;
    },

    /** @param {object} edit {timeline, output} → render id */
    async render(edit) {
      const r = await adapter.call('/render', { method: 'POST', body: edit });
      return { renderId: r.response.id };
    },

    /** @returns {{status:'processing'|'ready'|'failed', url?:string, error?:string}} */
    async getRender(renderId) {
      const r = await adapter.call(`/render/${encodeURIComponent(renderId)}`);
      const s = r.response.status;
      if (s === 'done') return { status: 'ready', url: r.response.url };
      if (s === 'failed') return { status: 'failed', error: r.response.error ?? 'render failed' };
      return { status: 'processing' }; // queued / fetching / rendering / saving
    },
  },
);

module.exports = adapter;
