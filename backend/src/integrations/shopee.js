'use strict';

const { defineAdapter } = require('./define');
const { notImplemented } = require('../core/errors');

// Interface is fixed now so modules can be built against it; bodies land in phase 5.
const planned = (method) => () => {
  adapter.requireConfig();
  throw notImplemented(`Shopee Open Platform: ${method} ยังไม่เปิดใช้งาน (รอสิทธิ์ Partner API ของแพลตฟอร์ม)`);
};

const adapter = defineAdapter(
  {
    id: 'shopee',
    planned: true,
    name: 'Shopee Open Platform',
    category: 'commerce',
    usedBy: ['scraping','inbox','pos'],
    phase: 5,
    purpose: 'ดึงสินค้า ออร์เดอร์ แชต (sellerchat) และข้อมูลยอดขายของร้านบน Shopee',
    applyUrl: 'https://open.shopee.com/',
    env: [
      { name: 'SHOPEE_PARTNER_ID' },
      { name: 'SHOPEE_PARTNER_KEY' },
      { name: 'SHOPEE_REDIRECT_URL' },
      { name: 'SHOPEE_API_BASE', optional: true, default: 'https://partner.shopeemobile.com' },
    ],
  },
  {
    /** HMAC-SHA256(partner_id + path + timestamp + access_token + shop_id) */
    signRequest: planned('signRequest'),
    /** GET /api/v2/product/get_item_list */
    getItemList: planned('getItemList'),
    /** GET /api/v2/order/get_order_list */
    getOrderList: planned('getOrderList'),
    /** POST /api/v2/sellerchat/send_message */
    sendChatMessage: planned('sendChatMessage'),
  },
);

module.exports = adapter;
