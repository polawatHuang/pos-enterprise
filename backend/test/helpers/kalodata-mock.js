'use strict';

/**
 * Deterministic fake Kalodata OpenAPI (response shapes from backend/kalodata-api-docs) for tests and
 * local UI checks: 6 level-1 categories × 4 level-2 × 3 level-3, products per level-2 category.
 * `respond(path, body)` returns the JSON envelope Kalodata would send.
 */

const L1 = [
  ['1001', 'ความงามและของใช้ส่วนตัว'],
  ['1002', 'เสื้อผ้าสตรีและชุดชั้นใน'],
  ['1003', 'อาหารและเครื่องดื่ม'],
  ['1004', 'บ้านและสวน'],
  ['1005', 'โทรศัพท์และอุปกรณ์อิเล็กทรอนิกส์'],
  ['1006', 'แม่และเด็ก'],
];
const L2_NAMES = {
  1001: ['ดูแลผิวหน้า', 'เมคอัพ', 'ดูแลเส้นผม', 'น้ำหอม'],
  1002: ['เดรส', 'เสื้อยืดและเสื้อเชิ้ต', 'ชุดชั้นใน', 'กางเกง'],
  1003: ['ขนมขบเคี้ยว', 'เครื่องดื่ม', 'อาหารเสริม', 'อาหารแห้ง'],
  1004: ['ของใช้ในครัว', 'จัดเก็บและจัดระเบียบ', 'ทำความสะอาด', 'ของตกแต่งบ้าน'],
  1005: ['หูฟังและลำโพง', 'อุปกรณ์เสริมมือถือ', 'อุปกรณ์สมาร์ทโฮม', 'กล้องและอุปกรณ์'],
  1006: ['ผ้าอ้อมและของใช้เด็ก', 'ของเล่นเด็ก', 'อาหารเด็ก', 'เสื้อผ้าเด็ก'],
};
const L3_SUFFIX = ['พรีเมียม', 'ราคาประหยัด', 'ขนาดพกพา'];

const hash = (s) => {
  let h = 2166136261;
  for (const ch of String(s)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return (h >>> 0) / 4294967295;
};
const monthFactor = (dateRange) => {
  const m = /^(\d{4})-(\d{2})$/.exec(dateRange ?? '');
  return m ? 0.75 + (Number(m[2]) % 6) * 0.07 + (Number(m[1]) - 2025) * 0.05 : 1;
};

function l2Of(l1) {
  return L2_NAMES[l1].map((name, i) => [`${l1}${i + 1}`, name]);
}
function l3Of(l2, l2name) {
  return L3_SUFFIX.map((s, i) => [`${l2}${i + 1}`, `${l2name} ${s}`]);
}
function category(id, name, dateRange, scale) {
  const f = monthFactor(dateRange);
  const revenue = Math.round(scale * (0.4 + hash(id)) * f);
  return {
    category_id: id,
    category_name: name,
    revenue,
    sale: Math.round(revenue / (150 + hash(`${id}p`) * 400)),
    revenue_growth_rate: Math.round((hash(`${id}${dateRange}`) * 80 - 25) * 10) / 10,
    top3_shop_revenue_ratio: Math.round((15 + hash(`${id}t`) * 65) * 10) / 10,
    average_revenue: Math.round(revenue / (40 + hash(`${id}s`) * 400)),
  };
}

/** Every category: id → { id, name, level } (ids nest by prefix: 1001 → 10011 → 100111). */
const NODES = new Map();
for (const [l1, n1] of L1) {
  NODES.set(l1, { id: l1, name: n1, level: 1 });
  for (const [l2, n2] of l2Of(l1)) {
    NODES.set(l2, { id: l2, name: n2, level: 2 });
    for (const [l3, n3] of l3Of(l2, n2)) NODES.set(l3, { id: l3, name: n3, level: 3 });
  }
}
const SCALE = { 1: 90_000_000, 2: 20_000_000, 3: 6_000_000 };

/** Like the API: category_ids limits to those categories and their descendants. */
function categoryRank(b) {
  const level = b.category_level ?? 1;
  const within = (id) => !b.category_ids?.length || b.category_ids.some((c) => id.startsWith(String(c)));
  const rows = [...NODES.values()].filter((n) => n.level === level && within(n.id)).map((n) => category(n.id, n.name, b.date_range, SCALE[level]));
  rows.sort((a, b2) => b2.revenue - a.revenue);
  return rows.slice(0, b.page_size ?? 10).map((r, i) => ({ ...r, rank: i + 1 }));
}

function product(id, name, l2, i, dateRange) {
  const f = monthFactor(dateRange);
  const sales = Math.max(20, Math.round((8000 / (1 + i * 0.6)) * (0.5 + hash(id)) * f));
  const price = Math.round((79 + hash(`${id}price`) * 900) * 100) / 100;
  const revenue = Math.round(sales * price);
  return {
    product_id: id,
    product_name: name,
    revenue,
    commission_rate: Math.round((5 + hash(`${id}c`) * 20) * 10) / 10,
    revenue_growth_rate: Math.round((hash(`${id}${dateRange}g`) * 120 - 30) * 10) / 10,
    sales_volumn: sales,
    unit_price: price,
    live_revenue: Math.round(revenue * 0.35),
    video_revenue: Math.round(revenue * 0.45),
    showcase_revenue: Math.round(revenue * 0.2),
    launch_date: i % 7 === 0 ? '2026-10-02' : '2025-11-15',
    master_image_url: `https://picsum.photos/seed/${id}/300/300`,
    seller_id: `s${l2}${i % 5}`,
    seller_name: `ร้าน ${['สวยใส', 'บ้านสุข', 'ดีลดี', 'ช้อปเพลิน', 'มีของ'][i % 5]}`,
    sku_count: String(1 + (i % 4)),
  };
}

function productRank(b) {
  const size = b.page_size ?? 10;
  let rows;
  if (b.category_ids?.length) {
    const node = NODES.get(String(b.category_ids[0]));
    if (!node) return [];
    // a level-1 list is made of its first child's products; filtered lists get their own ids
    const base = node.level === 1 ? `${node.id}1` : node.id;
    const special = b.launch_date || b.is_affiliate || b.sort_field?.field === 'revenue_growth_rate';
    rows = Array.from({ length: size }, (_, i) => {
      const n = special ? 500 + i : i + 1;
      return product(`${base}${String(n).padStart(3, '0')}`, `${node.name} รุ่นที่ ${n}`, base, i, b.date_range);
    });
    if (b.launch_date) rows = rows.map((r) => ({ ...r, launch_date: '2026-10-05' }));
    if (b.is_affiliate) rows = rows.map((r) => ({ ...r, commission_rate: 15 + hash(r.product_id) * 15 }));
    if (b.sort_field?.field === 'revenue_growth_rate') rows = rows.map((r) => ({ ...r, revenue_growth_rate: 40 + hash(r.product_id) * 200 }));
  } else {
    // market-wide lists: products from several categories plus a few only seen here
    const tag = b.launch_date ? 'n' : b.is_affiliate ? 'c' : 'r';
    rows = Array.from({ length: Math.min(size, 30) }, (_, i) => {
      const l1 = L1[i % 6][0];
      const [l2, l2name] = l2Of(l1)[i % 4];
      return i % 3 === 0
        ? product(`9${tag}${String(i).padStart(4, '0')}`, `สินค้าใหม่มาแรง ${tag.toUpperCase()}${i}`, l2, i + 3, b.date_range)
        : product(`${l2}${String((i % 5) + 1).padStart(3, '0')}`, `${l2name} รุ่นที่ ${(i % 5) + 1}`, l2, i % 5, b.date_range);
    });
    if (b.launch_date) rows = rows.map((r) => ({ ...r, launch_date: '2026-10-05' }));
    if (b.is_affiliate) rows = rows.map((r) => ({ ...r, commission_rate: 15 + (hash(r.product_id) * 15) }));
    if (b.sort_field?.field === 'revenue_growth_rate') rows = rows.map((r) => ({ ...r, revenue_growth_rate: 40 + hash(r.product_id) * 200 }));
  }
  return rows;
}

function productDetail(b) {
  const id = String(b.product_id);
  const l2 = /^9/.test(id) ? '10011' : id.slice(0, 5);
  const l3 = id.length >= 9 && !/^9/.test(id) ? id.slice(0, 6) : `${l2}1`;
  const base = product(id, `สินค้า ${id}`, l2, 2, b.date_range);
  return {
    product_id: id,
    product_region: 'TH',
    product_name: base.product_name,
    product_shop_id: base.seller_id,
    pri_cate_id: l2.slice(0, 4),
    sec_cate_id: l2,
    ter_cate_id: l3,
    max_price: base.unit_price * 1.2,
    min_price: base.unit_price,
    revenue: base.revenue,
    video_revenue: base.video_revenue,
    live_revenue: base.live_revenue,
    sales_volumn: base.sales_volumn,
    creator_number: Math.round(10 + hash(`${id}cr`) * 400),
    video_number: Math.round(20 + hash(`${id}v`) * 900),
    live_number: Math.round(hash(`${id}l`) * 120),
    delivery_type: 'local',
    shopping_mall_revenue: base.showcase_revenue,
    commission_rate: base.commission_rate,
    unit_price: base.unit_price,
    product_review_count: Math.round(hash(`${id}rv`) * 3000),
    launch_date: base.launch_date,
    master_image_url: base.master_image_url,
    revenue_trend: Array.from({ length: 30 }, (_, i) => Math.round((base.revenue / 30) * (0.7 + hash(`${id}${i}`) * 0.6))),
  };
}

const state = { balance: 315, calls: [], commentStatus: null };

function respond(path, body = {}, method = 'POST') {
  state.calls.push({ path, body, method });
  // like the real API: balance is GET, everything else POST
  if ((path.endsWith('/credit/balance') ? 'GET' : 'POST') !== method) return { success: false, message: `Request method '${method}' not supported` };
  const ok = (data) => ({ success: true, data, message: 'ok', cached: false, code: '0' });
  const rolling = ['last7Day', 'last30Day', 'last90Day', 'last180Day', 'last365Day'];
  if (/\/tiktok\/category\//.test(path) && !rolling.includes(body.date_range)) {
    return { success: false, message: 'date_range must be last7Day/last30Day/last90Day/last180Day/last365Day' };
  }
  if (path.endsWith('/credit/balance')) return ok({ totalRemain: state.balance, mainRemain: state.balance });
  if (path.endsWith('/tiktok/category/rank')) return ok(categoryRank(body));
  if (path.endsWith('/tiktok/category/detail')) {
    const id = String(body.category_id);
    const r = category(id, `หมวด ${id}`, body.date_range, 90_000_000);
    return ok({
      ...r,
      shop_number: Math.round(500 + hash(`${id}sn`) * 5000),
      live_revenue: Math.round(r.revenue * (0.2 + hash(`${id}lv`) * 0.4)),
      video_revenue: Math.round(r.revenue * 0.35),
      shopping_mall_revenue: Math.round(r.revenue * 0.2),
      affiliate_revenue: Math.round(r.revenue * 0.55),
      self_operate_revenue: Math.round(r.revenue * 0.3),
      average_shop_revenue: r.average_revenue,
      active_product_number: Math.round(2000 + hash(`${id}ap`) * 20000),
      revenue_trend: Array.from({ length: 30 }, (_, i) => Math.round((r.revenue / 30) * (0.8 + hash(`${id}d${i}`) * 0.4))),
    });
  }
  if (path.endsWith('/tiktok/product/rank')) return ok(productRank(body));
  if (path.endsWith('/tiktok/product/detail')) return ok(productDetail(body));
  if (path.endsWith('/tiktok/product/analysis'))
    return ok({
      product_id: body.product_id,
      region: 'TH',
      language: 'th-TH',
      highlights: [
        { key_word: 'ซึมไว ไม่เหนียว', region_text: 'เนื้อบางเบา ซึมไวใน 10 วินาที' },
        { key_word: 'ขนาดพกพา', region_text: 'ขวด 30 มล. พกขึ้นเครื่องได้' },
      ],
      attributes: [
        { key: 'ขนาด', value: '30 มล.' },
        { key: 'เหมาะกับ', value: 'ผิวมัน ผิวผสม' },
      ],
    });
  if (path.endsWith('/tiktok/product/comment/insight') && body.country_code !== String(body.country_code ?? '').toLowerCase()) {
    return { success: false, message: 'country_code must be lower case' };
  }
  if (path.endsWith('/tiktok/product/comment/insight') && state.commentStatus) return { status: state.commentStatus, text: '<html>554 insight not ready</html>' };
  if (path.endsWith('/tiktok/product/comment/insight'))
    return ok({
      product_id: body.product_id,
      country_code: 'TH',
      cached_at: '2026-10-20T00:00:00Z',
      comment_summary: { total: 1240, positive_ratio: 0.86, summary: 'ส่วนใหญ่ชอบเนื้อสัมผัสและส่งไว บางคนบ่นกลิ่นแรง' },
      positive_points: [{ point: 'ส่งไว แพ็กดี', count: 312 }, { point: 'ใช้แล้วผิวชุ่มชื้น', count: 280 }],
      pain_points: [{ point: 'กลิ่นแรงไป', count: 64 }, { point: 'ขวดเล็กกว่าที่คิด', count: 41 }],
      usage_scenarios: [{ scenario: 'ใช้ก่อนแต่งหน้าตอนเช้า', count: 150 }],
      original_comments: [{ content: 'ดีมาก ซื้อซ้ำรอบที่ 3 แล้ว', rating: 5 }],
    });
  if (path.endsWith('/tiktok/video/rank'))
    return ok(
      Array.from({ length: 5 }, (_, i) => ({
        video_id: `7${String(body.product_id).slice(-6)}${i}`,
        video_title: ['รีวิวจริงใช้ 7 วัน', 'เทียบ 3 ยี่ห้อ', 'แกะกล่อง + ทดลองใช้', 'ปัญหาผิวมัน แก้ยังไง', 'ของดีราคาไม่แพง'][i],
        belonged_creator_id: `c${i}`,
        belonged_creator_handle: ['beautybyploy', 'reviewjing', 'maewmaew.review', 'pimchanok', 'dealdeeshop'][i],
        revenue: 50000 - i * 8000,
        views: 400000 - i * 60000,
        revenue_growth_rate: 12 - i * 3,
        ads_roas: i === 1 ? 3.2 : null,
        digg_count: 15000 - i * 2000,
        share_count: 800 - i * 100,
        comment_count: 300 - i * 40,
        ad: i === 1 ? 1 : 0,
        creator_debut: '2026-09-1' + i,
      })),
    );
  if (path.endsWith('/tiktok/creator/rank'))
    return ok(
      Array.from({ length: 5 }, (_, i) => ({
        creator_id: `c${i}`,
        creator_nickname: ['พลอย บิวตี้', 'รีวิวจริง', 'แมวเหมียวรีวิว', 'พิมชนก', 'ดีลดีช้อป'][i],
        creator_handle: ['beautybyploy', 'reviewjing', 'maewmaew.review', 'pimchanok', 'dealdeeshop'][i],
        revenue: 80000 - i * 12000,
        revenue_growth_rate: 10,
        content_views: String(900000 - i * 100000),
        creator_followers: String(250000 - i * 40000),
        sales_volumn: 600 - i * 80,
        video_revenue: 50000 - i * 8000,
        live_revenue: 30000 - i * 4000,
      })),
    );
  if (path.endsWith('/tiktok/video/url')) return ok({ video_id: body.video_id, video_url: 'https://example.com/v.mp4', expires_at: '2026-12-01T00:00:00Z' });
  return { success: false, message: `unknown path ${path}` };
}

/** Replace global fetch for calls to the Kalodata base URL; returns a restore function. */
function installFetch(base = 'https://kalo.test/openapi/v1') {
  const real = global.fetch;
  global.fetch = async (url, opts = {}) => {
    if (!String(url).startsWith(base)) return real(url, opts);
    const body = opts.body ? JSON.parse(opts.body) : {};
    const json = respond(String(url).slice(base.length), body, opts.method ?? 'GET');
    // a raw (non-JSON) failure, e.g. Kalodata's HTTP 554
    if (json.status) return { ok: false, status: json.status, text: async () => json.text, json: async () => JSON.parse(json.text) };
    const status = json.success === false ? 400 : 200;
    return { ok: status === 200, status, text: async () => JSON.stringify(json), json: async () => json };
  };
  return () => {
    global.fetch = real;
  };
}

module.exports = { respond, installFetch, state, L1 };
