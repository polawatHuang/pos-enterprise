'use strict';

const crypto = require('node:crypto');
const { defineAdapter } = require('./define');
const { AppError } = require('../core/errors');

const DEFAULT_ENDPOINT = 'https://open-api.affiliate.shopee.co.th/graphql';

/** productOfferV2 sortType values */
const SORT = { relevance: 1, sales: 2, price_desc: 3, price_asc: 4, commission: 5 };

const OFFER_FIELDS = `itemId productName priceMin priceMax sales ratingStar commissionRate
  imageUrl productLink offerLink shopName productCatIds priceDiscountRate shopType`;

const adapter = defineAdapter(
  {
    id: 'shopee_affiliate',
    name: 'Shopee Affiliate Open API',
    category: 'commerce',
    usedBy: ['scraping', 'social'],
    phase: 5,
    purpose: 'ค้นหาสินค้าขายดี/ค่าคอมมิชชัน และสร้าง short link affiliate สำหรับแนบในโพสต์',
    applyUrl: 'https://affiliate.shopee.co.th/open_api',
    env: [
      { name: 'SHOPEE_AFFILIATE_APP_ID' },
      { name: 'SHOPEE_AFFILIATE_SECRET' },
      { name: 'SHOPEE_AFFILIATE_ENDPOINT', optional: true, default: DEFAULT_ENDPOINT },
    ],
  },
  {
    SORT,

    /** Authorization: SHA256 Credential={appId}, Timestamp={ts}, Signature=sha256(appId + ts + payload + secret) */
    authorization(appId, secret, payload, timestamp = Math.floor(Date.now() / 1000)) {
      const signature = crypto.createHash('sha256').update(`${appId}${timestamp}${payload}${secret}`).digest('hex');
      return `SHA256 Credential=${appId}, Timestamp=${timestamp}, Signature=${signature}`;
    },

    async graphql(query, variables = {}) {
      const env = adapter.requireConfig();
      const payload = JSON.stringify({ query, variables });
      const res = await fetch(env.SHOPEE_AFFILIATE_ENDPOINT || DEFAULT_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: adapter.authorization(env.SHOPEE_AFFILIATE_APP_ID, env.SHOPEE_AFFILIATE_SECRET, payload),
        },
        body: payload,
        signal: AbortSignal.timeout(20_000),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok || body?.errors?.length) {
        const msg = body?.errors?.map((e) => e.message).join('; ') || `HTTP ${res.status}`;
        throw new AppError(502, 'SHOPEE_AFFILIATE_ERROR', `Shopee Affiliate API: ${msg.slice(0, 300)}`);
      }
      return body.data;
    },

    /**
     * Product offers, normalised to the trend item shape.
     * @param {{keyword?:string, sortType?:keyof SORT, page?:number, limit?:number}} opts
     */
    async productOfferList({ keyword = null, sortType = 'sales', page = 1, limit = 50 } = {}) {
      const data = await adapter.graphql(
        `query($keyword: String, $sortType: Int, $page: Int, $limit: Int) {
          productOfferV2(keyword: $keyword, sortType: $sortType, page: $page, limit: $limit) {
            nodes { ${OFFER_FIELDS} }
            pageInfo { page limit hasNextPage }
          }
        }`,
        { keyword, sortType: SORT[sortType] ?? SORT.sales, page, limit: Math.min(50, limit) },
      );
      const conn = data?.productOfferV2 ?? { nodes: [], pageInfo: {} };
      return {
        hasNextPage: Boolean(conn.pageInfo?.hasNextPage),
        items: (conn.nodes ?? []).map((n) => ({
          platform: 'shopee',
          externalId: String(n.itemId),
          title: n.productName,
          url: n.offerLink || n.productLink || null,
          imageUrl: n.imageUrl || null,
          shopName: n.shopName || null,
          price: n.priceMin != null ? Number(n.priceMin) : null,
          soldCount: n.sales != null ? Number(n.sales) : null,
          rating: n.ratingStar != null ? Number(n.ratingStar) : null,
          // API returns a fraction as a string, e.g. "0.12"
          commissionRate: n.commissionRate != null ? Math.round(Number(n.commissionRate) * 10000) / 100 : null,
          category: Array.isArray(n.productCatIds) && n.productCatIds.length ? String(n.productCatIds[0]) : null,
          // The API has no flash-sale flag; a live discount is the closest signal (absence stays unknown)
          hasFlashSale: Number(n.priceDiscountRate) > 0 ? true : null,
          raw: n,
        })),
      };
    },

    /** Affiliate short link with tracking sub ids (max 5, alphanumeric). */
    async generateShortLink(originUrl, subIds = []) {
      const data = await adapter.graphql(
        `mutation($input: ShortLinkInput!) { generateShortLink(input: $input) { shortLink } }`,
        { input: { originUrl, subIds: subIds.slice(0, 5) } },
      );
      const link = data?.generateShortLink?.shortLink;
      if (!link) throw new AppError(502, 'SHOPEE_AFFILIATE_ERROR', 'Shopee Affiliate API ไม่ส่ง short link กลับมา');
      return link;
    },
  },
);

module.exports = adapter;
