'use strict';

const { defineAdapter } = require('./define');
const { AppError } = require('../core/errors');

/**
 * MiniMax speech (T2A v2) and Hailuo video generation. Same account and key as the chat model
 * (MINIMAX_API_KEY) but the native REST API, not the Anthropic-compatible one.
 * Docs: https://platform.minimax.io/docs/api-reference/speech-t2a-http
 *       https://platform.minimax.io/docs/api-reference/video-generation-intro
 */
const adapter = defineAdapter(
  {
    id: 'minimax_media',
    name: 'MiniMax Speech + Hailuo Video (ค่าเริ่มต้น)',
    category: 'video',
    usedBy: ['video', 'covers'],
    phase: 6,
    purpose: 'เสียงพากย์ (speech) และคลิปวิดีโอ AI (Hailuo) ใช้ key เดียวกับ MiniMax chat',
    applyUrl: 'https://platform.minimax.io/',
    env: [
      { name: 'MINIMAX_API_KEY' },
      { name: 'MINIMAX_API_HOST', optional: true, default: 'https://api.minimax.io' },
      { name: 'MINIMAX_TTS_MODEL', optional: true, default: 'speech-2.6-hd' },
      { name: 'MINIMAX_VOICE_ID', optional: true },
      { name: 'MINIMAX_TTS_LANGUAGE', optional: true, default: 'auto' },
      { name: 'MINIMAX_VIDEO_MODEL', optional: true, default: 'MiniMax-Hailuo-2.3' },
      { name: 'MINIMAX_IMAGE_MODEL', optional: true, default: 'image-01' },
      { name: 'MINIMAX_GROUP_ID', optional: true },
    ],
  },
  {
    async call(path, { method = 'GET', body, timeoutMs = 60_000 } = {}) {
      const env = adapter.requireConfig();
      const host = (env.MINIMAX_API_HOST || 'https://api.minimax.io').replace(/\/+$/, '');
      const sep = path.includes('?') ? '&' : '?';
      // Older accounts must pass GroupId on media endpoints
      const url = `${host}${path}${env.MINIMAX_GROUP_ID ? `${sep}GroupId=${encodeURIComponent(env.MINIMAX_GROUP_ID)}` : ''}`;
      const res = await fetch(url, {
        method,
        headers: { Authorization: `Bearer ${env.MINIMAX_API_KEY}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(timeoutMs),
      });
      const json = await res.json().catch(() => null);
      const code = json?.base_resp?.status_code;
      if (!res.ok || (code !== undefined && code !== 0)) {
        const msg = json?.base_resp?.status_msg || `HTTP ${res.status}`;
        throw new AppError(502, 'MINIMAX_MEDIA_ERROR', `MiniMax: ${msg}`.slice(0, 300), { status: res.status, code });
      }
      return json;
    },

    /**
     * Text → image (image-01). Returns the image bytes; provider URLs expire so callers store them.
     * subjectImage (data URL) keeps a person's likeness ("character" reference only on MiniMax).
     * @returns {Promise<{buffer: Buffer, mime: string}>}
     */
    async generateImage({ prompt, aspectRatio = '9:16', subjectImage = null }) {
      const env = adapter.requireConfig();
      const r = await adapter.call('/v1/image_generation', {
        method: 'POST',
        timeoutMs: 120_000,
        body: {
          model: env.MINIMAX_IMAGE_MODEL || 'image-01',
          prompt: String(prompt).slice(0, 1500),
          aspect_ratio: aspectRatio,
          response_format: 'base64',
          n: 1,
          prompt_optimizer: true,
          ...(subjectImage ? { subject_reference: [{ type: 'character', image_file: subjectImage }] } : {}),
        },
      });
      const b64 = r?.data?.image_base64?.[0];
      if (b64) return { buffer: Buffer.from(b64, 'base64'), mime: 'image/jpeg' };
      const url = r?.data?.image_urls?.[0];
      if (!url) throw new AppError(502, 'MINIMAX_MEDIA_ERROR', 'MiniMax: ไม่ได้รับภาพกลับมา');
      const img = await fetch(url, { signal: AbortSignal.timeout(60_000) });
      if (!img.ok) throw new AppError(502, 'MINIMAX_MEDIA_ERROR', `MiniMax: ดาวน์โหลดภาพไม่สำเร็จ (HTTP ${img.status})`);
      return { buffer: Buffer.from(await img.arrayBuffer()), mime: img.headers.get('content-type') || 'image/jpeg' };
    },

    /**
     * Text → speech. Asks for a hosted URL (valid ~24h; copy it to R2 to keep it).
     * @returns {{url:string, durationMs:number|null}}
     */
    async synthesize(text, { voiceId, speed = 1 } = {}) {
      const env = adapter.requireConfig();
      const voice = voiceId || env.MINIMAX_VOICE_ID;
      if (!voice) throw new AppError(400, 'BAD_REQUEST', 'ยังไม่ได้เลือกเสียงพากย์ (voice id) — ตั้ง MINIMAX_VOICE_ID หรือเลือกในโปรเจกต์');
      const r = await adapter.call('/v1/t2a_v2', {
        method: 'POST',
        body: {
          model: env.MINIMAX_TTS_MODEL || 'speech-2.6-hd',
          text,
          stream: false,
          language_boost: env.MINIMAX_TTS_LANGUAGE || 'auto',
          output_format: 'url',
          voice_setting: { voice_id: voice, speed, vol: 1, pitch: 0 },
          audio_setting: { sample_rate: 32000, bitrate: 128000, format: 'mp3', channel: 1 },
        },
      });
      const url = r?.data?.audio;
      if (!url || !/^https?:\/\//.test(url)) throw new AppError(502, 'MINIMAX_MEDIA_ERROR', 'MiniMax ไม่ส่งลิงก์ไฟล์เสียงกลับมา');
      return { url, durationMs: r?.extra_info?.audio_length ?? null };
    },

    /**
     * Every voice this account can use: MiniMax's system voices plus the account's cloned and
     * designed ones. Field names vary between API versions, so read them loosely.
     * Docs: https://platform.minimax.io/docs (Voice Management → Get Voice)
     * @returns {Promise<{id:string, name:string, group:'system'|'cloned'|'generated', description:string}[]>}
     */
    async listVoices() {
      const r = await adapter.call('/v1/get_voice', { method: 'POST', body: { voice_type: 'all' }, timeoutMs: 30_000 });
      const groups = [
        ['system', r?.system_voice],
        ['cloned', r?.voice_cloning],
        ['generated', r?.voice_generation],
      ];
      const seen = new Set();
      const out = [];
      for (const [group, list] of groups) {
        for (const v of Array.isArray(list) ? list : []) {
          const id = String(v?.voice_id ?? '').trim();
          if (!id || seen.has(id)) continue;
          seen.add(id);
          const description = (Array.isArray(v.description) ? v.description.join(' ') : String(v.description ?? '')).trim();
          out.push({ id, name: String(v.voice_name || id).trim(), group, description: description.slice(0, 300) });
        }
      }
      return out;
    },

    /** Start a 6s clip. With an image the clip follows its aspect ratio (use a portrait image for 9:16). */
    async createVideo({ prompt, imageUrl = null, duration = 6, resolution = '768P' }) {
      const env = adapter.requireConfig();
      const r = await adapter.call('/v1/video_generation', {
        method: 'POST',
        body: {
          model: env.MINIMAX_VIDEO_MODEL || 'MiniMax-Hailuo-2.3',
          prompt: String(prompt).slice(0, 2000),
          duration,
          resolution,
          prompt_optimizer: true,
          ...(imageUrl ? { first_frame_image: imageUrl } : {}),
        },
      });
      if (!r?.task_id) throw new AppError(502, 'MINIMAX_MEDIA_ERROR', 'MiniMax ไม่ส่ง task_id กลับมา');
      return { taskId: String(r.task_id) };
    },

    /** @returns {{status:'processing'|'ready'|'failed', fileId?:string}} */
    async queryVideo(taskId) {
      const r = await adapter.call(`/v1/query/video_generation?task_id=${encodeURIComponent(taskId)}`);
      const s = String(r?.status ?? '');
      if (s === 'Success') return { status: 'ready', fileId: String(r.file_id) };
      if (s === 'Fail') return { status: 'failed' };
      return { status: 'processing' }; // Preparing / Queueing / Processing
    },

    async fileUrl(fileId) {
      const r = await adapter.call(`/v1/files/retrieve?file_id=${encodeURIComponent(fileId)}`);
      const url = r?.file?.download_url || r?.file?.backup_download_url;
      if (!url) throw new AppError(502, 'MINIMAX_MEDIA_ERROR', 'MiniMax ไม่ส่งลิงก์ดาวน์โหลดวิดีโอ');
      return url;
    },
  },
);

module.exports = adapter;
