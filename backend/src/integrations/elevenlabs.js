'use strict';

const { defineAdapter } = require('./define');
const { notImplemented } = require('../core/errors');

// Interface is fixed now so modules can be built against it; bodies land in phase 6.
const planned = (method) => () => {
  adapter.requireConfig();
  throw notImplemented(`ElevenLabs Text-to-Speech: ${method} จะเปิดใช้งานในเฟสที่ 6`);
};

const adapter = defineAdapter(
  {
    id: 'elevenlabs',
    name: 'ElevenLabs Text-to-Speech',
    category: 'video',
    usedBy: ['video'],
    phase: 6,
    purpose: 'เสียงพากย์ภาษาไทยที่เป็นธรรมชาติ พร้อม timestamp ระดับตัวอักษรสำหรับทำซับไตเติล',
    applyUrl: 'https://elevenlabs.io/app/settings/api-keys',
    env: [
      { name: 'ELEVENLABS_API_KEY' },
      { name: 'ELEVENLABS_VOICE_ID', optional: true },
      { name: 'ELEVENLABS_MODEL_ID', optional: true, default: 'eleven_multilingual_v2' },
    ],
  },
  {
    /** POST https://api.elevenlabs.io/v1/text-to-speech/{voice_id}/with-timestamps */
    synthesizeWithTimestamps: planned('synthesizeWithTimestamps'),
    /** GET https://api.elevenlabs.io/v1/voices */
    listVoices: planned('listVoices'),
  },
);

module.exports = adapter;
