'use strict';

const crypto = require('node:crypto');
const { defineAdapter } = require('./define');
const { AppError } = require('../core/errors');

/**
 * TikTok Shop Partner API (202309): shop authorization and the Customer Service API
 * (buyer ↔ shop chat in the inbox; needs the seller.customer_service scope).
 * Request sign = hex HMAC-SHA256(app_secret, app_secret + path + sorted "key+value" query (without
 * sign / access_token) + JSON body + app_secret); the shop token goes in x-tts-access-token.
 */
const hmac = (key, text) => crypto.createHmac('sha256', key).update(text).digest('hex');
const AUTH_BASE = 'https://auth.tiktok-shops.com';

const adapter = defineAdapter(
  {
    id: 'tiktok_shop',
    name: 'TikTok Shop Partner API',
    category: 'commerce',
    usedBy: ['inbox'],
    phase: 5,
    purpose: 'เชื่อมร้าน TikTok Shop เพื่อรับ-ตอบแชตลูกค้า (Customer Service API) ในหน้ารวมแชต พร้อม AI ตอบ',
    applyUrl: 'https://partner.tiktokshop.com/',
    env: [
      { name: 'TIKTOK_SHOP_APP_KEY' },
      { name: 'TIKTOK_SHOP_APP_SECRET' },
      // Partner Center → App → Service ID (for the seller authorization link)
      { name: 'TIKTOK_SHOP_SERVICE_ID' },
      { name: 'TIKTOK_SHOP_API_BASE', optional: true, default: 'https://open-api.tiktokglobalshop.com' },
    ],
  },
  {
    sign(path, query, bodyText = '') {
      const { TIKTOK_SHOP_APP_SECRET: secret } = adapter.requireConfig();
      const params = Object.keys(query)
        .filter((k) => k !== 'sign' && k !== 'access_token')
        .sort()
        .map((k) => `${k}${query[k]}`)
        .join('');
      return hmac(secret, `${secret}${path}${params}${bodyText}${secret}`);
    },

    async call(path, { method = 'GET', query = {}, body, accessToken, shopCipher } = {}) {
      const { TIKTOK_SHOP_APP_KEY, TIKTOK_SHOP_API_BASE } = adapter.requireConfig();
      const q = { app_key: TIKTOK_SHOP_APP_KEY, timestamp: String(Math.floor(Date.now() / 1000)), ...(shopCipher ? { shop_cipher: shopCipher } : {}) };
      for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== null) q[k] = String(v);
      const bodyText = method === 'GET' ? '' : JSON.stringify(body ?? {});
      q.sign = adapter.sign(path, q, bodyText);
      let res;
      try {
        res = await fetch(`${TIKTOK_SHOP_API_BASE.replace(/\/$/, '')}${path}?${new URLSearchParams(q)}`, {
          method,
          headers: { 'content-type': 'application/json', ...(accessToken ? { 'x-tts-access-token': accessToken } : {}) },
          body: method === 'GET' ? undefined : bodyText,
          signal: AbortSignal.timeout(20_000),
        });
      } catch (err) {
        throw new AppError(502, 'TIKTOK_SHOP_UNREACHABLE', `เชื่อมต่อ TikTok Shop ไม่ได้: ${err.message}`);
      }
      const json = await res.json().catch(() => null);
      if (!res.ok || !json || (json.code !== undefined && json.code !== 0)) {
        throw new AppError(502, 'TIKTOK_SHOP_ERROR', `TikTok Shop: ${json?.message || `HTTP ${res.status}`}`.slice(0, 300), { code: json?.code });
      }
      return json.data ?? {};
    },

    /** Link the seller opens to authorize the app; TikTok returns to the app's redirect URL with ?code&state. */
    authUrl(state) {
      const { TIKTOK_SHOP_SERVICE_ID } = adapter.requireConfig();
      return `https://services.tiktokshop.com/open/authorize?${new URLSearchParams({ service_id: TIKTOK_SHOP_SERVICE_ID, state })}`;
    },

    async token(params) {
      const { TIKTOK_SHOP_APP_KEY, TIKTOK_SHOP_APP_SECRET } = adapter.requireConfig();
      const path = params.grant_type === 'refresh_token' ? 'refresh' : 'get';
      let res;
      try {
        res = await fetch(`${AUTH_BASE}/api/v2/token/${path}?${new URLSearchParams({ app_key: TIKTOK_SHOP_APP_KEY, app_secret: TIKTOK_SHOP_APP_SECRET, ...params })}`, {
          signal: AbortSignal.timeout(20_000),
        });
      } catch (err) {
        throw new AppError(502, 'TIKTOK_SHOP_UNREACHABLE', `เชื่อมต่อ TikTok Shop ไม่ได้: ${err.message}`);
      }
      const json = await res.json().catch(() => null);
      if (!res.ok || !json || json.code !== 0) throw new AppError(502, 'TIKTOK_SHOP_ERROR', `TikTok Shop: ${json?.message || `HTTP ${res.status}`}`.slice(0, 300));
      const d = json.data;
      // *_expire_in are unix timestamps (seconds)
      return {
        accessToken: d.access_token,
        refreshToken: d.refresh_token,
        expiresAt: Number(d.access_token_expire_in) * 1000,
        refreshExpiresAt: Number(d.refresh_token_expire_in) * 1000,
        sellerName: d.seller_name ?? null,
      };
    },

    getToken: (code) => adapter.token({ auth_code: code, grant_type: 'authorized_code' }),
    refresh: (refreshToken) => adapter.token({ refresh_token: refreshToken, grant_type: 'refresh_token' }),

    /** Shops this token may act for: [{ id, name, region, cipher }] */
    async shops(accessToken) {
      const d = await adapter.call('/authorization/202309/shops', { accessToken });
      return d.shops ?? [];
    },

    async conversations(accessToken, shopCipher, { pageSize = 20 } = {}) {
      const d = await adapter.call('/customer_service/202309/conversations', { accessToken, shopCipher, query: { page_size: pageSize, locale: 'th-TH' } });
      return d.conversations ?? [];
    },

    /** Latest messages of one conversation (newest first). */
    async messages(accessToken, shopCipher, conversationId, { pageSize = 20 } = {}) {
      const d = await adapter.call(`/customer_service/202309/conversations/${encodeURIComponent(conversationId)}/messages`, {
        accessToken,
        shopCipher,
        query: { page_size: pageSize, sort_order: 'DESC', sort_field: 'create_time', locale: 'th-TH' },
      });
      return d.messages ?? [];
    },

    /** Text only, up to 2000 characters. */
    sendText(accessToken, shopCipher, conversationId, text) {
      return adapter.call(`/customer_service/202309/conversations/${encodeURIComponent(conversationId)}/messages`, {
        method: 'POST',
        accessToken,
        shopCipher,
        body: { type: 'TEXT', content: JSON.stringify({ content: text.slice(0, 2000) }) },
      });
    },

    markRead(accessToken, shopCipher, conversationId) {
      return adapter.call(`/customer_service/202309/conversations/${encodeURIComponent(conversationId)}/messages/read`, { method: 'POST', accessToken, shopCipher });
    },

    /** Webhooks: Authorization = hex HMAC-SHA256(app_secret, app_key + raw body). */
    verifyWebhook(rawBody, header) {
      const { TIKTOK_SHOP_APP_KEY, TIKTOK_SHOP_APP_SECRET } = adapter.requireConfig();
      if (!header) return false;
      const expected = Buffer.from(hmac(TIKTOK_SHOP_APP_SECRET, `${TIKTOK_SHOP_APP_KEY}${rawBody.toString('utf8')}`));
      const got = Buffer.from(String(header));
      return expected.length === got.length && crypto.timingSafeEqual(expected, got);
    },
  },
);

module.exports = adapter;
