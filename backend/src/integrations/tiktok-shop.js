'use strict';

const { defineAdapter } = require('./define');
const { notImplemented } = require('../core/errors');

// Interface is fixed now so modules can be built against it; bodies land in phase 5.
const planned = (method) => () => {
  adapter.requireConfig();
  throw notImplemented(`TikTok Shop Partner API: ${method} ยังไม่เปิดใช้งาน (รอสิทธิ์ Partner API ของแพลตฟอร์ม)`);
};

const adapter = defineAdapter(
  {
    id: 'tiktok_shop',
    planned: true,
    name: 'TikTok Shop Partner API',
    category: 'commerce',
    usedBy: ['scraping','inbox','pos'],
    phase: 5,
    purpose: 'ดึงสินค้า/ออร์เดอร์/แชตลูกค้าของร้านบน TikTok Shop',
    applyUrl: 'https://partner.tiktokshop.com/',
    env: [
      { name: 'TIKTOK_SHOP_APP_KEY' },
      { name: 'TIKTOK_SHOP_APP_SECRET' },
    ],
  },
  {
    /** HMAC-SHA256 signature over path + sorted params with app secret */
    signRequest: planned('signRequest'),
    /** POST /product/202309/products/search */
    listProducts: planned('listProducts'),
    /** POST /order/202309/orders/search */
    listOrders: planned('listOrders'),
    /** GET /customer_service/202309/conversations */
    listConversations: planned('listConversations'),
  },
);

module.exports = adapter;
