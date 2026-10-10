'use strict';

const { defineAdapter } = require('./define');
const { AppError } = require('../core/errors');

const adapter = defineAdapter(
  {
    id: 'elevenlabs',
    name: 'ElevenLabs Text-to-Speech (ทางเลือก)',
    category: 'video',
    usedBy: ['video'],
    phase: 6,
    purpose: 'เสียงพากย์ทางเลือกแทน MiniMax (ส่งไฟล์เสียงกลับมาตรง ๆ จึงต้องมี R2 ไว้เก็บไฟล์)',
    applyUrl: 'https://elevenlabs.io/app/settings/api-keys',
    env: [
      { name: 'ELEVENLABS_API_KEY' },
      { name: 'ELEVENLABS_VOICE_ID', optional: true },
      { name: 'ELEVENLABS_MODEL_ID', optional: true, default: 'eleven_multilingual_v2' },
    ],
  },
  {
    /**
     * POST /v1/text-to-speech/{voice_id}/with-timestamps → mp3 bytes + duration from the alignment.
     * @returns {{audio:Buffer, durationMs:number|null}}
     */
    async synthesize(text, { voiceId } = {}) {
      const env = adapter.requireConfig();
      const voice = voiceId || env.ELEVENLABS_VOICE_ID;
      if (!voice) throw new AppError(400, 'BAD_REQUEST', 'ยังไม่ได้เลือกเสียง ElevenLabs (ELEVENLABS_VOICE_ID)');
      const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voice)}/with-timestamps?output_format=mp3_44100_128`, {
        method: 'POST',
        headers: { 'xi-api-key': env.ELEVENLABS_API_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, model_id: env.ELEVENLABS_MODEL_ID || 'eleven_multilingual_v2' }),
        signal: AbortSignal.timeout(60_000),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.audio_base64) {
        throw new AppError(502, 'ELEVENLABS_ERROR', `ElevenLabs: ${json?.detail?.message ?? json?.detail ?? `HTTP ${res.status}`}`.slice(0, 300));
      }
      const ends = json.alignment?.character_end_times_seconds;
      return { audio: Buffer.from(json.audio_base64, 'base64'), durationMs: ends?.length ? Math.round(ends[ends.length - 1] * 1000) : null };
    },
  },
);

module.exports = adapter;
