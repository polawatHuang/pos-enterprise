'use strict';

const { defineAdapter } = require('./define');
const { notImplemented } = require('../core/errors');

// Interface is fixed now so modules can be built against it; bodies land in phase 5.
const planned = (method) => () => {
  adapter.requireConfig();
  throw notImplemented(`Apify (scraping service): ${method} จะเปิดใช้งานในเฟสที่ 5`);
};

const adapter = defineAdapter(
  {
    id: 'apify',
    name: 'Apify (scraping service)',
    category: 'commerce',
    usedBy: ['scraping'],
    phase: 5,
    purpose: 'ทางเลือกสำรองสำหรับดึงข้อมูลหน้าเว็บที่ไม่มี API (รัน headless browser บนคลาวด์ของ Apify)',
    applyUrl: 'https://console.apify.com/account/integrations',
    env: [
      { name: 'APIFY_TOKEN' },
    ],
  },
  {
    /** POST https://api.apify.com/v2/acts/{actorId}/runs */
    runActor: planned('runActor'),
    /** GET https://api.apify.com/v2/datasets/{datasetId}/items */
    getDatasetItems: planned('getDatasetItems'),
  },
);

module.exports = adapter;
