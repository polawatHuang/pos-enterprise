'use strict';

const { defineAdapter } = require('./define');
const { AppError } = require('../core/errors');

/**
 * Kalodata OpenAPI — TikTok Shop market data (category / product / video / creator rankings).
 * Docs: backend/kalodata-api-docs. Every endpoint is POST + JSON with a `secret-key` header.
 * Billing (1 credit ≈ 0.1 USD): detail 0.1 per call, ranking 0.1 × ceil(rows/100),
 * comment insight 1, video URL 0.5, product images 0.01, balance free.
 * Rankings allow 10 requests / 10 s, so calls are spaced out in-process.
 */
const MARKET = { region: 'TH', language: 'th-TH', currency: 'THB' };
// tests set KALODATA_MIN_GAP_MS=0
const minGap = () => Number(process.env.KALODATA_MIN_GAP_MS ?? 1_100);

const COST = {
  rank: (rows) => 0.1 * Math.max(1, Math.ceil(rows / 100)),
  detail: 0.1,
  analysis: 0.1,
  comments: 1,
  videoUrl: 0.5,
  images: 0.01,
};

let lastCall = 0;
async function throttle() {
  const wait = lastCall + minGap() - Date.now();
  lastCall = Date.now() + Math.max(0, wait);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
}

const adapter = defineAdapter(
  {
    id: 'kalodata',
    name: 'Kalodata (ข้อมูลตลาด TikTok Shop)',
    category: 'commerce',
    usedBy: ['scraping'],
    phase: 1,
    purpose: 'อันดับหมวดหมู่ สินค้า วิดีโอ และครีเอเตอร์ของ TikTok Shop ไทย สำหรับหน้าสินค้าเทรนด์ (ดึงอัตโนมัติเดือนละครั้ง)',
    applyUrl: 'https://www.kalodata.com/',
    env: [{ name: 'KALODATA_API_KEY' }, { name: 'KALODATA_API_BASE', optional: true, default: 'https://www.kalodata.com/openapi/v1' }],
  },
  {
    MARKET,
    COST,

    /** POST an endpoint; returns `data`. Errors carry Kalodata's message in Thai context. */
    async call(path, body = {}, { market = true, timeoutMs = 30_000, method = 'POST' } = {}) {
      const { KALODATA_API_KEY, KALODATA_API_BASE } = adapter.requireConfig();
      await throttle();
      let res;
      try {
        res = await fetch(`${KALODATA_API_BASE.replace(/\/$/, '')}${path}`, {
          method,
          headers: { 'secret-key': KALODATA_API_KEY, ...(method === 'GET' ? {} : { 'content-type': 'application/json;charset=UTF-8' }) },
          body: method === 'GET' ? undefined : JSON.stringify(market ? { ...MARKET, ...body } : body),
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (err) {
        throw new AppError(502, 'KALODATA_UNREACHABLE', `เชื่อมต่อ Kalodata ไม่ได้: ${err.message}`);
      }
      // some failures come back as plain text/HTML (e.g. HTTP 554), not JSON
      const text = await res.text().catch(() => '');
      let json = null;
      try {
        json = text ? JSON.parse(text) : null;
      } catch {
        /* not JSON: handled below by status */
      }
      if (res.status === 401 || res.status === 403) throw new AppError(502, 'KALODATA_AUTH', 'คีย์ Kalodata ไม่ถูกต้องหรือหมดอายุ');
      if (res.status === 429) throw new AppError(429, 'KALODATA_RATE_LIMIT', 'เรียก Kalodata ถี่เกินไป ลองใหม่อีกครั้ง');
      if (res.status >= 500 && !json?.message) {
        const snippet = text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120);
        throw new AppError(502, 'KALODATA_UPSTREAM', `Kalodata ขัดข้องชั่วคราว (HTTP ${res.status}) — ครั้งนี้ไม่เสียเครดิต ลองใหม่ภายหลัง${snippet ? ` [${snippet}]` : ''}`, {
          status: res.status,
        });
      }
      if (!res.ok || !json || json.success === false) {
        const msg = json?.message || `HTTP ${res.status}`;
        const credit = /credit|เครดิต|balance|insufficient/i.test(msg);
        throw new AppError(credit ? 402 : 502, credit ? 'KALODATA_NO_CREDIT' : 'KALODATA_ERROR', `Kalodata: ${msg}`.slice(0, 300));
      }
      return json.data;
    },

    // the only GET endpoint in the API
    balance: ({ timeoutMs } = {}) => adapter.call('/credit/balance', {}, { market: false, timeoutMs, method: 'GET' }),
    categoryRank: (body) => adapter.call('/tiktok/category/rank', { page_size: 100, page_number: 1, ...body }),
    categoryDetail: (categoryId, dateRange) => adapter.call('/tiktok/category/detail', { category_id: String(categoryId), date_range: dateRange }),
    productRank: (body) => adapter.call('/tiktok/product/rank', { page_size: 100, page_number: 1, need_image: 1, need_extra: true, ...body }),
    productDetail: (productId, dateRange) => adapter.call('/tiktok/product/detail', { product_id: String(productId), date_range: dateRange, need_image: 1 }),
    productAnalysis: (productId) => adapter.call('/tiktok/product/analysis', { product_id: String(productId), region: MARKET.region, language: MARKET.language }, { market: false }),
    // lower-case country code as in the docs' example ("us"); building the summary can take a while
    commentInsight: (productId) =>
      adapter.call('/tiktok/product/comment/insight', { product_id: String(productId), country_code: MARKET.region.toLowerCase() }, { market: false, timeoutMs: 60_000 }),
    videoRank: (body) => adapter.call('/tiktok/video/rank', { page_size: 10, page_number: 1, ...body }),
    creatorRank: (body) => adapter.call('/tiktok/creator/rank', { page_size: 10, page_number: 1, need_image: 1, ...body }),
    videoUrl: (videoId) => adapter.call('/tiktok/video/url', { video_id: String(videoId) }, { market: false }),
  },
);

module.exports = adapter;
