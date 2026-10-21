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
        // Edit API: {message, response:{error:{details:[{message}]}}}; Create API (JSON:API): {errors:[{title, detail}]}
        const why = [
          ...(json?.response?.error?.details ?? []).map((d) => d?.message),
          ...(json?.errors ?? []).map((e) => e?.detail || e?.title),
          typeof json?.response === 'string' ? json.response : json?.response?.error?.message,
        ].filter(Boolean);
        const head = json?.message ?? `HTTP ${res.status}`;
        throw new AppError(502, 'SHOTSTACK_ERROR', `Shotstack: ${head}${why.length ? ` — ${why.join('; ')}` : ''}`.slice(0, 500));
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
     * Create API: generate a picture from a prompt. 576x1024 is also the portrait size image-to-video accepts.
     * Docs: https://shotstack.io/docs/guide/generating-assets/ai-image-generation/
     */
    async createImage(prompt, { width = 576, height = 1024 } = {}) {
      const r = await adapter.call('/assets', {
        api: 'create',
        method: 'POST',
        body: { provider: 'shotstack', options: { type: 'text-to-image', prompt: String(prompt).slice(0, 1500), width, height } },
      });
      const id = r?.data?.id;
      if (!id) throw new AppError(502, 'SHOTSTACK_ERROR', 'Shotstack ไม่ส่งรหัสงานสร้างภาพกลับมา');
      return { assetId: String(id) };
    },

    /**
     * Render a picture to an exact size (crop to fill), e.g. the 576x1024 frame image-to-video requires.
     * @returns {{renderId:string}} poll with getRender
     */
    async resizeImage(src, { width = 576, height = 1024 } = {}) {
      return adapter.render({
        timeline: { tracks: [{ clips: [{ asset: { type: 'image', src }, start: 0, length: 1, fit: 'crop' }] }] },
        output: { format: 'jpg', size: { width, height } },
      });
    },

    /**
     * Create API image-to-video: animate a still into a short MP4. The image must be exactly
     * 576x1024, 1024x576 or 768x768 (see resizeImage). Poll with getAsset.
     */
    async createImageToVideo(imageUrl) {
      const r = await adapter.call('/assets', {
        api: 'create',
        method: 'POST',
        body: { provider: 'shotstack', options: { type: 'image-to-video', imageUrl } },
      });
      const id = r?.data?.id;
      if (!id) throw new AppError(502, 'SHOTSTACK_ERROR', 'Shotstack ไม่ส่งรหัสงานสร้างคลิปกลับมา');
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
