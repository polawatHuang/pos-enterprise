'use strict';

const { defineAdapter } = require('./define');
const { AppError } = require('../core/errors');

/** Generate error codes (403) in words the shop owner can act on. */
const PLAN_CODES = {
  AiCapabilityNotIncluded: 'แพ็กเกจ Shotstack ของคุณไม่รวม AI generation แบบนี้ (ต้องอัปเกรดแพ็กเกจ)',
  FeatureNotIncluded: 'แพ็กเกจ Shotstack ของคุณไม่รวมฟีเจอร์นี้',
  AiDisabled: 'AI generation ถูกปิดอยู่ในบัญชี Shotstack',
  AiAccessUnavailable: 'Shotstack ตรวจสิทธิ์ไม่ได้ชั่วคราว ลองใหม่อีกครั้ง',
};
const modelCache = new Map();
/** Whether an option schema accepts this value (no enum = any value). */
const allows = (prop, value) => Boolean(prop) && (!Array.isArray(prop.enum) || prop.enum.includes(value));

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
      // Generation models (GET /edit/{env}/models lists the ones the account can use)
      { name: 'SHOTSTACK_VIDEO_MODEL', optional: true, default: 'seedance-2.0-image-to-video' },
      { name: 'SHOTSTACK_IMAGE_MODEL', optional: true, default: 'nano-banana-2' },
    ],
  },
  {
    async call(path, { method = 'GET', body, api = 'edit', headers = {} } = {}) {
      const env = adapter.requireConfig();
      const res = await fetch(`https://api.shotstack.io/${api}/${env.SHOTSTACK_ENV || 'stage'}${path}`, {
        method,
        headers: { 'x-api-key': env.SHOTSTACK_API_KEY, Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(30_000),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || json?.success === false) {
        // Render: {message, response:{error:{details:[{message}]}}}; Generate: {error, code, available}
        const why = [
          ...(json?.response?.error?.details ?? []).map((d) => d?.message),
          ...(json?.errors ?? []).map((e) => e?.detail || e?.title),
          typeof json?.response === 'string' ? json.response : json?.response?.error?.message,
          typeof json?.error === 'string' ? json.error : json?.error?.message,
          PLAN_CODES[json?.code],
          res.status === 402 ? `เครดิต Shotstack ไม่พอ${json?.available != null ? ` (เหลือ ${json.available})` : ''}` : null,
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
     * AI generation (Edit API /generate): an image from a prompt, or a video from a prompt and a
     * starting image. `length` sets the clip duration for models that generate to a duration.
     * Docs: @shotstack/schemas GenerationRequest — https://shotstack.io/docs/api/
     * @param {{key?:string}} opts Idempotency-Key: a new key generates afresh instead of returning the cached result
     * @returns {{jobId:string}} poll with getGeneration
     */
    async generate(asset, length, { key } = {}) {
      // Without a key identical requests share one cached result (a failed one too): a retry needs a new key
      const r = await adapter.call('/generate', {
        method: 'POST',
        body: { asset, ...(length ? { length: Math.round(length * 10) / 10 } : {}) },
        headers: key ? { 'Idempotency-Key': key } : {},
      });
      if (!r?.id) throw new AppError(502, 'SHOTSTACK_ERROR', 'Shotstack ไม่ส่งรหัสงานสร้างกลับมา');
      return { jobId: String(r.id) };
    },

    /** @returns {{status:'processing'|'ready'|'failed', url?:string, error?:string}} */
    async getGeneration(jobId) {
      const r = await adapter.call(`/generate/${encodeURIComponent(jobId)}`);
      if (r?.status === 'done' && r.url) return { status: 'ready', url: r.url };
      if (r?.status === 'failed') return { status: 'failed', error: r.error ?? 'generation failed' };
      return { status: 'processing' };
    },

    /** Option names a generation model accepts (unknown options are rejected), cached for an hour. */
    async modelOptions(model) {
      const hit = modelCache.get(model);
      if (hit && Date.now() - hit.at < 3600_000) return hit.props;
      let r;
      try {
        r = await adapter.call(`/models/${encodeURIComponent(model)}`);
      } catch (err) {
        throw new AppError(502, 'SHOTSTACK_ERROR', `ใช้โมเดล ${model} ของ Shotstack ไม่ได้ — ${err.message}`.slice(0, 500));
      }
      if (r?.available === false) throw new AppError(502, 'SHOTSTACK_ERROR', `แพ็กเกจ Shotstack ของคุณยังใช้โมเดล ${model} ไม่ได้`);
      const props = r?.options?.properties ?? {};
      modelCache.set(model, { at: Date.now(), props });
      return props;
    },

    /** Generation asset for a scene picture (missing scene): the configured image model, portrait when the model allows. */
    async imageAsset(prompt) {
      const env = adapter.requireConfig();
      const model = env.SHOTSTACK_IMAGE_MODEL || 'nano-banana-2';
      const props = await adapter.modelOptions(model);
      const options = allows(props.aspectRatio, '9:16') ? { aspectRatio: '9:16' } : {};
      return { type: 'image', prompt: String(prompt).slice(0, 4000), model, ...(Object.keys(options).length ? { options } : {}) };
    },

    /** Generation asset animating a picture: the image goes in startSrc (inputSrc on the original image-to-video models). */
    async videoAsset(prompt, imageUrl) {
      const env = adapter.requireConfig();
      const model = env.SHOTSTACK_VIDEO_MODEL || 'seedance-2.0-image-to-video';
      const props = await adapter.modelOptions(model);
      const key = props.startSrc ? 'startSrc' : props.inputSrc ? 'inputSrc' : null;
      if (!key) throw new AppError(400, 'BAD_REQUEST', `โมเดล ${model} ไม่รับภาพเริ่มต้น — ตั้ง SHOTSTACK_VIDEO_MODEL เป็นโมเดล image-to-video`);
      const options = { [key]: imageUrl, ...(allows(props.aspectRatio, '9:16') ? { aspectRatio: '9:16' } : {}) };
      return { type: 'video', prompt: String(prompt).slice(0, 4000), model, options };
    },
  },
);

module.exports = adapter;
