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
      // Who turns scene pictures into AI clips (and draws missing pictures): "shotstack" (uses Shotstack credits) or "minimax" (Hailuo + image-01, needs a MiniMax plan with those models)
      { name: 'VIDEO_SCENE_AI', optional: true, default: 'shotstack' },
    ],
  },
  {
    async call(path, { method = 'GET', body, api = 'edit' } = {}) {
      const env = adapter.requireConfig();
      const res = await fetch(`https://api.shotstack.io/${api}/${env.SHOTSTACK_ENV || 'stage'}${path}`, {
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

    /**
     * Create API: generate a picture from a prompt (FLUX). Sides must be multiples of 256, max 1280.
     * Docs: https://shotstack.io/docs/guide/generating-assets/ai-image-generation/
     */
    async createImage(prompt, { width = 768, height = 1280 } = {}) {
      const r = await adapter.call('/assets', {
        api: 'create',
        method: 'POST',
        body: { provider: 'shotstack', options: { type: 'text-to-image', prompt: String(prompt).slice(0, 1500), width, height } },
      });
      const id = r?.data?.id;
      if (!id) throw new AppError(502, 'SHOTSTACK_ERROR', 'Shotstack ไม่ส่งรหัสงานสร้างภาพกลับมา');
      return { assetId: String(id) };
    },

    /** @returns {{status:'processing'|'ready'|'failed', url?:string, error?:string}} */
    async getAsset(assetId) {
      const r = await adapter.call(`/assets/${encodeURIComponent(assetId)}`, { api: 'create' });
      const a = r?.data?.attributes ?? {};
      if (a.status === 'done' && a.url) return { status: 'ready', url: a.url };
      if (a.status === 'failed') return { status: 'failed', error: a.error ?? 'generation failed' };
      return { status: 'processing' };
    },
  },
);

module.exports = adapter;
