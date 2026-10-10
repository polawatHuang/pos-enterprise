'use strict';

const { defineAdapter } = require('./define');
const { notImplemented } = require('../core/errors');

// Interface is fixed now so modules can be built against it; bodies land in phase 6.
const planned = (method) => () => {
  adapter.requireConfig();
  throw notImplemented(`Shotstack Edit API: ${method} จะเปิดใช้งานในเฟสที่ 6`);
};

const adapter = defineAdapter(
  {
    id: 'shotstack',
    name: 'Shotstack Edit API',
    category: 'video',
    usedBy: ['video'],
    phase: 6,
    purpose: 'ประกอบคลิปบนคลาวด์ (avatar + ภาพสินค้า + ซับ + เพลง) ไม่ต้องใช้ ffmpeg บนโฮสต์',
    applyUrl: 'https://dashboard.shotstack.io/',
    env: [
      { name: 'SHOTSTACK_API_KEY' },
      { name: 'SHOTSTACK_ENV', optional: true, default: 'stage' },
    ],
  },
  {
    /** POST https://api.shotstack.io/edit/{env}/render (timeline JSON, output 1080x1920 mp4) */
    render: planned('render'),
    /** GET https://api.shotstack.io/edit/{env}/render/{id} */
    getRender: planned('getRender'),
  },
);

module.exports = adapter;
