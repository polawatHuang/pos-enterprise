'use strict';

const crypto = require('node:crypto');
const { defineAdapter } = require('./define');
const { AppError } = require('../core/errors');

/**
 * Shopee Open Platform v2: shop authorization and SellerChat (customer chat in the inbox).
 * Signature = hex HMAC-SHA256(partner_key, partner_id + /api/v2/<path> + timestamp [+ access_token + shop_id]).
 * Access tokens last 4 hours, refresh tokens 30 days. SellerChat needs the chat permission on the app.
 */
const hmac = (key, text) => crypto.createHmac('sha256', key).update(text).digest('hex');
const now = () => Math.floor(Date.now() / 1000);

const adapter = defineAdapter(
  {
    id: 'shopee',
    name: 'Shopee Open Platform',
    category: 'commerce',
    usedBy: ['inbox'],
    phase: 5,
    purpose: 'เชื่อมร้าน Shopee เพื่อรับ-ตอบแชตลูกค้า (SellerChat) ในหน้ารวมแชต พร้อม AI ตอบ',
    applyUrl: 'https://open.shopee.com/',
    env: [
      { name: 'SHOPEE_PARTNER_ID' },
      { name: 'SHOPEE_PARTNER_KEY' },
      // https://<web app>/api/inbox/oauth/shopee/callback
      { name: 'SHOPEE_REDIRECT_URL' },
      { name: 'SHOPEE_API_BASE', optional: true, default: 'https://partner.shopeemobile.com' },
    ],
  },
  {
    /** Signed query for /api/v2/<path>; shop calls add access_token + shop_id. */
    signedQuery(path, { accessToken, shopId } = {}) {
      const { SHOPEE_PARTNER_ID, SHOPEE_PARTNER_KEY } = adapter.requireConfig();
      const ts = now();
      const base = `${SHOPEE_PARTNER_ID}/api/v2/${path}${ts}${accessToken && shopId ? `${accessToken}${shopId}` : ''}`;
      const q = new URLSearchParams({ partner_id: String(SHOPEE_PARTNER_ID), timestamp: String(ts), sign: hmac(SHOPEE_PARTNER_KEY, base) });
      if (accessToken && shopId) {
        q.set('access_token', accessToken);
        q.set('shop_id', String(shopId));
      }
      return q;
    },

    async call(path, { method = 'GET', query = {}, body, accessToken, shopId } = {}) {
      const { SHOPEE_API_BASE } = adapter.requireConfig();
      const q = adapter.signedQuery(path, { accessToken, shopId });
      for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== null) q.set(k, String(v));
      let res;
      try {
        res = await fetch(`${SHOPEE_API_BASE.replace(/\/$/, '')}/api/v2/${path}?${q}`, {
          method,
          headers: method === 'GET' ? {} : { 'content-type': 'application/json' },
          body: method === 'GET' ? undefined : JSON.stringify(body ?? {}),
          signal: AbortSignal.timeout(20_000),
        });
      } catch (err) {
        throw new AppError(502, 'SHOPEE_UNREACHABLE', `เชื่อมต่อ Shopee ไม่ได้: ${err.message}`);
      }
      const json = await res.json().catch(() => null);
      if (!res.ok || !json || json.error) {
        throw new AppError(502, 'SHOPEE_ERROR', `Shopee: ${json?.message || json?.error || `HTTP ${res.status}`}`.slice(0, 300), { code: json?.error });
      }
      return json;
    },

    /** Link the seller opens to authorize a shop; Shopee returns to the redirect with ?code&shop_id. */
    authUrl(state) {
      const { SHOPEE_API_BASE, SHOPEE_REDIRECT_URL } = adapter.requireConfig();
      const q = adapter.signedQuery('shop/auth_partner');
      const redirect = new URL(SHOPEE_REDIRECT_URL);
      redirect.searchParams.set('state', state);
      q.set('redirect', redirect.toString());
      return `${SHOPEE_API_BASE.replace(/\/$/, '')}/api/v2/shop/auth_partner?${q}`;
    },

    /** code → { accessToken, refreshToken, expiresIn (s) } */
    async getToken(code, shopId) {
      const { SHOPEE_PARTNER_ID } = adapter.requireConfig();
      const r = await adapter.call('auth/token/get', { method: 'POST', body: { code, shop_id: Number(shopId), partner_id: Number(SHOPEE_PARTNER_ID) } });
      return { accessToken: r.access_token, refreshToken: r.refresh_token, expiresIn: Number(r.expire_in ?? 14_400) };
    },

    async refreshToken(refreshToken, shopId) {
      const { SHOPEE_PARTNER_ID } = adapter.requireConfig();
      const r = await adapter.call('auth/access_token/get', {
        method: 'POST',
        body: { refresh_token: refreshToken, shop_id: Number(shopId), partner_id: Number(SHOPEE_PARTNER_ID) },
      });
      return { accessToken: r.access_token, refreshToken: r.refresh_token, expiresIn: Number(r.expire_in ?? 14_400) };
    },

    async shopName(accessToken, shopId) {
      const r = await adapter.call('shop/get_shop_info', { accessToken, shopId }).catch(() => null);
      return r?.shop_name ?? r?.response?.shop_name ?? null;
    },

    /** Conversations with unread buyer messages (newest first). */
    async conversations(accessToken, shopId, { type = 'unread', pageSize = 20 } = {}) {
      const r = await adapter.call('sellerchat/get_conversation_list', { accessToken, shopId, query: { direction: 'latest', type, page_size: pageSize } });
      return r.response?.conversations ?? [];
    },

    /** Latest messages of one conversation (newest first). */
    async messages(accessToken, shopId, conversationId, { pageSize = 20 } = {}) {
      const r = await adapter.call('sellerchat/get_message', { accessToken, shopId, query: { conversation_id: conversationId, page_size: pageSize } });
      return r.response?.messages ?? [];
    },

    sendText(accessToken, shopId, toId, text) {
      return adapter.call('sellerchat/send_message', {
        method: 'POST',
        accessToken,
        shopId,
        body: { to_id: Number(toId), message_type: 'text', content: { text: text.slice(0, 1000) } },
      });
    },

    markRead(accessToken, shopId, conversationId, lastMessageId) {
      return adapter.call('sellerchat/read_conversation', {
        method: 'POST',
        accessToken,
        shopId,
        body: { conversation_id: Number(conversationId), last_read_message_id: String(lastMessageId) },
      });
    },

    /** Push notifications: Authorization = hex HMAC-SHA256(partner_key, "<push url>|<raw body>"). */
    verifyPush(url, rawBody, header) {
      const { SHOPEE_PARTNER_KEY } = adapter.requireConfig();
      if (!header) return false;
      const expected = Buffer.from(hmac(SHOPEE_PARTNER_KEY, `${url}|${rawBody.toString('utf8')}`));
      const got = Buffer.from(String(header));
      return expected.length === got.length && crypto.timingSafeEqual(expected, got);
    },
  },
);

module.exports = adapter;
