'use strict';

const { defineAdapter } = require('./define');
const { notImplemented } = require('../core/errors');

// Interface is fixed now so modules can be built against it; bodies land in phase 6.
const planned = (method) => () => {
  adapter.requireConfig();
  throw notImplemented(`HeyGen API: ${method} จะเปิดใช้งานในเฟสที่ 6`);
};

const adapter = defineAdapter(
  {
    id: 'heygen',
    name: 'HeyGen API',
    category: 'video',
    usedBy: ['video'],
    phase: 6,
    purpose: 'สร้างวิดีโอ AI avatar (คนรีวิวสินค้า) แนวตั้ง 9:16 จากสคริปต์/ไฟล์เสียง',
    applyUrl: 'https://app.heygen.com/settings?nav=API',
    env: [
      { name: 'HEYGEN_API_KEY' },
      { name: 'HEYGEN_DEFAULT_AVATAR_ID', optional: true },
    ],
  },
  {
    /** GET https://api.heygen.com/v2/avatars */
    listAvatars: planned('listAvatars'),
    /** POST https://api.heygen.com/v2/video/generate (dimension 1080x1920, voice type=audio with ElevenLabs URL) */
    generateVideo: planned('generateVideo'),
    /** GET https://api.heygen.com/v1/video_status.get?video_id= */
    getVideoStatus: planned('getVideoStatus'),
  },
);

module.exports = adapter;
