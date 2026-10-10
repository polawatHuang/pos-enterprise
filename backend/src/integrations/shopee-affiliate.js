'use strict';

const { defineAdapter } = require('./define');
const { notImplemented } = require('../core/errors');

// Interface is fixed now so modules can be built against it; bodies land in phase 5.
const planned = (method) => () => {
  adapter.requireConfig();
  throw notImplemented(`Shopee Affiliate Open API: ${method} จะเปิดใช้งานในเฟสที่ 5`);
};

const adapter = defineAdapter(
  {
    id: 'shopee_affiliate',
    name: 'Shopee Affiliate Open API',
    category: 'commerce',
    usedBy: ['scraping','social'],
    phase: 5,
    purpose: 'ค้นหาสินค้าขายดี/ค่าคอมมิชชัน และสร้าง short link affiliate สำหรับแนบในโพสต์',
    applyUrl: 'https://affiliate.shopee.co.th/open_api',
    env: [
      { name: 'SHOPEE_AFFILIATE_APP_ID' },
      { name: 'SHOPEE_AFFILIATE_SECRET' },
    ],
  },
  {
    /** GraphQL productOfferV2 (sortType by sales / commission) */
    productOfferList: planned('productOfferList'),
    /** GraphQL generateShortLink(originUrl, subIds) */
    generateShortLink: planned('generateShortLink'),
    /** GraphQL conversionReport */
    conversionReport: planned('conversionReport'),
  },
);

module.exports = adapter;
