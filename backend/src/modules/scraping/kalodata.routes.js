'use strict';

const express = require('express');
const { z } = require('zod');
const db = require('../../db/pool');
const { validate } = require('../../core/http');
const { requirePermission } = require('../../core/auth');
const { audit } = require('../../core/audit');
const { notFound } = require('../../core/errors');
const kalodata = require('../../integrations/kalodata');
const svc = require('./kalodata.service');

/** Kalodata: monthly-pull settings, the category report (market → category → products), per-product extras. */
const router = express.Router();

const parse = (v) => (v == null ? null : typeof v === 'string' ? JSON.parse(v) : v);
const n = (v) => (v == null ? null : Number(v));
const periodRe = /^\d{4}-(0[1-9]|1[0-2])$/;

/* ---------------------------------------------------------------- settings */

async function lastRuns(orgId, limit = 6) {
  const rows = await db.query(
    `SELECT r.id, r.status, r.stage, r.items_found, r.items_new, r.error, r.state, r.started_at, r.finished_at, u.full_name AS who
       FROM scrape_runs r JOIN scrape_sources s ON s.id = r.source_id LEFT JOIN users u ON u.id = r.triggered_by
      WHERE s.org_id = :orgId AND s.platform = 'kalodata' ORDER BY r.id DESC LIMIT :limit`,
    { orgId, limit },
  );
  return rows.map((r) => {
    const st = parse(r.state) ?? {};
    return {
      id: r.id,
      status: r.status,
      stage: r.stage,
      period: st.period ?? null,
      scopeName: st.scope?.name ?? null,
      credits: st.credits != null ? Math.round(st.credits * 100) / 100 : null,
      balanceUsed: st.balanceStart != null && st.balanceEnd != null ? Math.round((st.balanceStart - st.balanceEnd) * 100) / 100 : null,
      counts: st.counts ?? null,
      tasksLeft: st.tasks?.length ?? 0,
      warnings: (st.warnings ?? []).slice(-5),
      itemsFound: r.items_found,
      itemsNew: r.items_new,
      error: r.error,
      triggeredBy: r.who ?? 'ตั้งเวลาอัตโนมัติ',
      startedAt: r.started_at,
      finishedAt: r.finished_at,
    };
  });
}

async function status(orgId) {
  const s = await svc.getSettings(orgId);
  const configured = kalodata.isConfigured();
  const last = await db.one('SELECT MAX(period) AS p FROM trend_categories WHERE org_id = :orgId', { orgId });
  const next = svc.lastFullMonth();
  return {
    enabled: Boolean(s.enabled),
    dayOfMonth: s.dayOfMonth,
    configured,
    lastPeriod: s.lastPeriod ?? last?.p ?? null,
    nextPeriod: s.lastPeriod === next ? svc.shiftPeriod(next, 1) : next,
    latestFull: next,
    estimateCredits: svc.estimateCredits(s),
    running: Boolean(await svc.openRun(orgId)),
    scope: s.scope === 'all' ? 'all' : 'category',
    category: s.scope !== 'all' && s.categoryId ? { id: s.categoryId, name: s.categoryName, level: s.categoryLevel, path: await pathOf(orgId, s.categoryId) } : null,
  };
}

/** "หมวดหลัก › หมวดรอง" above a category (names from the newest month that has them). */
async function pathOf(orgId, id) {
  const names = [];
  let cur = (await db.one('SELECT parent_id FROM trend_categories WHERE org_id = :orgId AND category_id = :id AND parent_id IS NOT NULL LIMIT 1', { orgId, id }))?.parent_id;
  for (let i = 0; cur && i < 3; i += 1) {
    const c = await db.one('SELECT name, parent_id FROM trend_categories WHERE org_id = :orgId AND category_id = :id ORDER BY period DESC LIMIT 1', { orgId, id: cur });
    if (!c) break;
    names.unshift(c.name);
    cur = c.parent_id;
  }
  return names.join(' › ');
}

router.get('/kalodata/settings', requirePermission('scraping:read'), async (req, res) => {
  res.json({ data: { ...(await status(req.user.orgId)), runs: await lastRuns(req.user.orgId) } });
});

/** Credits left, asked separately so the settings dialog opens at once even when Kalodata is slow. */
router.get('/kalodata/balance', requirePermission('scraping:read'), async (req, res) => {
  if (!kalodata.isConfigured()) return res.json({ data: { balance: null, error: null } });
  try {
    res.json({ data: { balance: n((await kalodata.balance({ timeoutMs: 10_000 }))?.totalRemain), error: null } });
  } catch (err) {
    res.json({ data: { balance: null, error: err.message } });
  }
});

router.put(
  '/kalodata/settings',
  requirePermission('scraping:run'),
  validate({
    body: z
      .object({
        enabled: z.boolean().optional(),
        dayOfMonth: z.coerce.number().int().min(1).max(28).optional(),
        scope: z.enum(['category', 'all']).optional(),
        categoryId: z.string().trim().min(1).max(32).nullable().optional(),
      })
      .strict(),
  }),
  async (req, res) => {
    const b = { ...req.valid.body };
    if (b.enabled) kalodata.requireConfig(); // 503 naming KALODATA_API_KEY
    if (b.categoryId) {
      const c = await db.one('SELECT category_id, name, level FROM trend_categories WHERE org_id = :orgId AND category_id = :id ORDER BY period DESC LIMIT 1', {
        orgId: req.user.orgId,
        id: b.categoryId,
      });
      if (!c) throw notFound('ไม่พบหมวดหมู่นี้ — โหลดรายชื่อหมวดก่อน');
      Object.assign(b, { scope: 'category', categoryName: c.name, categoryLevel: c.level });
    } else if (b.categoryId === null) Object.assign(b, { categoryName: null, categoryLevel: null });
    await svc.saveSettings(req.user.orgId, b);
    if (b.enabled) await svc.ensureSource(req.user.orgId);
    audit(req, 'scraping.kalodata.settings', 'settings', null, b);
    res.json({ data: await status(req.user.orgId) });
  },
);

/** Categories to choose from (search by name or parent name) — from data already pulled, so free. */
router.get(
  '/kalodata/category-options',
  requirePermission('scraping:read'),
  validate({ query: z.object({ q: z.string().trim().max(100).optional() }) }),
  async (req, res) => {
    const orgId = req.user.orgId;
    const latest = await db.one('SELECT MAX(period) AS p FROM trend_categories WHERE org_id = :orgId', { orgId });
    if (!latest?.p) return res.json({ data: { items: [], needsLoad: true } });
    const q = req.valid.query.q ? `%${req.valid.query.q}%` : null;
    // newest row of each category, with up to two parent names for the path
    const rows = await db.query(
      `SELECT c.category_id, c.name, c.level, c.revenue, c.growth_rate, p.name AS parent_name, gp.name AS grand_name
         FROM trend_categories c
         LEFT JOIN trend_categories p ON p.org_id = c.org_id AND p.category_id = c.parent_id AND p.period = c.period
         LEFT JOIN trend_categories gp ON gp.org_id = c.org_id AND gp.category_id = p.parent_id AND gp.period = c.period
        WHERE c.org_id = :orgId
          AND c.period = (SELECT MAX(x.period) FROM trend_categories x WHERE x.org_id = c.org_id AND x.category_id = c.category_id)
          AND (:q IS NULL OR c.name LIKE :q OR p.name LIKE :q OR gp.name LIKE :q)
        ORDER BY (:q IS NOT NULL AND c.name LIKE :q) DESC, c.level, c.revenue DESC
        LIMIT 60`,
      { orgId, q },
    );
    res.json({
      data: {
        needsLoad: false,
        items: rows.map((r) => ({
          id: r.category_id,
          name: r.name,
          level: r.level,
          path: [r.grand_name, r.parent_name].filter(Boolean).join(' › '),
          revenue: n(r.revenue),
          growth: n(r.growth_rate),
        })),
      },
    });
  },
);

/** First time only: pull the level-1 and level-2 category list (~3 credits) so there is something to choose. */
router.post('/kalodata/category-options/load', requirePermission('scraping:run'), async (req, res) => {
  const r = await svc.loadCategoryList(req.user.orgId);
  audit(req, 'scraping.kalodata.categories', 'settings', null, r);
  res.json({ data: r });
});

router.post(
  '/kalodata/run',
  requirePermission('scraping:run'),
  validate({ body: z.object({ period: z.string().regex(periodRe).optional() }).strict() }),
  async (req, res) => {
    const runId = await svc.startMonthly(req.user.orgId, { period: req.valid.body.period ?? null, userId: req.user.id });
    audit(req, 'scraping.kalodata.run', 'scrape_run', runId, { period: req.valid.body.period ?? null });
    res.status(202).json({ data: { runId } });
  },
);

/* ---------------------------------------------------------------- category report */

const SORTS = {
  revenue: 'c.revenue',
  growth: 'c.growth_rate',
  sale: 'c.sale',
  top3: 'c.top3_shop_ratio',
  avgShop: 'c.avg_shop_revenue',
  rank: 'c.rank_no',
};

function mapCategory(c) {
  return {
    id: c.category_id,
    parentId: c.parent_id,
    level: c.level,
    name: c.name,
    rank: n(c.rank_no),
    revenue: n(c.revenue),
    sale: n(c.sale),
    growth: n(c.growth_rate),
    top3: n(c.top3_shop_ratio),
    avgShopRevenue: n(c.avg_shop_revenue),
    shopNumber: n(c.shop_number),
    activeProducts: n(c.active_products),
    avgPrice: c.revenue != null && Number(c.sale) > 0 ? Math.round((Number(c.revenue) / Number(c.sale)) * 100) / 100 : null,
  };
}

/**
 * "โอกาส": growing, not owned by a few shops, and shops there earn at least the level's median.
 * The guide's reading of the category table (ตลาดใหญ่และเติบโต / ยอดขายกระจุกตัว).
 */
function tagOpportunity(items) {
  const avgs = items.map((i) => i.avgShopRevenue).filter((v) => v != null).sort((a, b) => a - b);
  const median = avgs.length ? avgs[Math.floor(avgs.length / 2)] : null;
  for (const i of items) {
    const reasons = [];
    if (i.growth != null && i.growth >= 10) reasons.push('กำลังโต');
    if (i.top3 != null && i.top3 < 50) reasons.push('ยอดขายไม่กระจุก');
    if (median != null && i.avgShopRevenue != null && i.avgShopRevenue >= median) reasons.push('ร้านในหมวดขายได้ดี');
    i.opportunity = reasons.length === 3;
    i.signal =
      i.growth == null
        ? null
        : i.growth >= 10 && i.top3 != null && i.top3 >= 60
          ? 'concentrated'
          : i.growth >= 10
            ? i.opportunity
              ? 'opportunity'
              : 'growing'
            : i.growth <= -10
              ? 'shrinking'
              : 'steady';
    i.signalReasons = reasons;
  }
  return items;
}

async function periodsOf(orgId) {
  return (await db.query('SELECT DISTINCT period FROM trend_categories WHERE org_id = :orgId ORDER BY period DESC LIMIT 24', { orgId })).map((r) => r.period);
}

async function breadcrumb(orgId, id) {
  const path = [];
  let cur = id;
  for (let i = 0; cur && i < 3; i += 1) {
    const c = await db.one('SELECT category_id, parent_id, level, name FROM trend_categories WHERE org_id = :orgId AND category_id = :id ORDER BY period DESC LIMIT 1', { orgId, id: cur });
    if (!c) break;
    path.unshift({ id: c.category_id, name: c.name, level: c.level });
    cur = c.parent_id;
  }
  return path;
}

/** Revenue of each category over the 6 months ending at `period`, for sparklines. */
async function sparklines(orgId, ids, period) {
  if (!ids.length) return new Map();
  const rows = await db.query(
    `SELECT category_id, period, revenue FROM trend_categories
      WHERE org_id = :orgId AND category_id IN (:ids) AND period <= :p AND period >= :from ORDER BY period`,
    { orgId, ids, p: period, from: svc.shiftPeriod(period, -5) },
  );
  const out = new Map();
  for (const r of rows) {
    if (!out.has(r.category_id)) out.set(r.category_id, []);
    out.get(r.category_id).push({ period: r.period, revenue: n(r.revenue) });
  }
  return out;
}

/** Trend items under a category: level 1 → its level-2 children, level 2 → itself, level 3 → leaf. */
async function productScope(orgId, id) {
  const c = await db.one('SELECT level FROM trend_categories WHERE org_id = :orgId AND category_id = :id ORDER BY period DESC LIMIT 1', { orgId, id });
  if (!c) return null;
  if (c.level === 1) {
    const kids = await db.query('SELECT DISTINCT category_id FROM trend_categories WHERE org_id = :orgId AND parent_id = :id', { orgId, id });
    // + the level-1 id itself: products a level-1 pull found before their detail named the child
    return { ids: [id, ...kids.map((k) => k.category_id)], leaf: null };
  }
  if (c.level === 2) return { ids: [id], leaf: null };
  return { ids: [], leaf: id };
}

async function productCounts(orgId, items) {
  const counts = new Map();
  if (!items.length) return counts;
  const rows = await db.query(
    `SELECT kalo_category_id AS id, COUNT(*) AS n FROM trending_products WHERE org_id = :orgId AND platform = 'kalodata' AND kalo_category_id IS NOT NULL
      GROUP BY kalo_category_id`,
    { orgId },
  );
  const byL2 = new Map(rows.map((r) => [r.id, Number(r.n)]));
  const parents = await db.query('SELECT DISTINCT category_id, parent_id FROM trend_categories WHERE org_id = :orgId AND level = 2', { orgId });
  for (const i of items) {
    if (i.level === 2) counts.set(i.id, byL2.get(i.id) ?? 0);
    else if (i.level === 1) counts.set(i.id, parents.filter((p) => p.parent_id === i.id).reduce((s, p) => s + (byL2.get(p.category_id) ?? 0), 0));
  }
  return counts;
}

router.get(
  '/categories',
  requirePermission('scraping:read'),
  validate({
    query: z.object({
      period: z.string().regex(periodRe).optional(),
      level: z.coerce.number().int().min(1).max(3).default(1),
      parentId: z.string().trim().max(32).optional(),
      q: z.string().trim().max(100).optional(),
      sort: z.enum(['revenue', 'growth', 'sale', 'top3', 'avgShop', 'rank']).default('revenue'),
      dir: z.enum(['asc', 'desc']).default('desc'),
      growingOnly: z.enum(['0', '1']).optional(),
      // first open of the page: start at the chosen category (its children, or its siblings for a leaf)
      auto: z.enum(['0', '1']).optional(),
    }),
  }),
  async (req, res) => {
    const f = { ...req.valid.query };
    const orgId = req.user.orgId;
    const periods = await periodsOf(orgId);
    const period = f.period && periods.includes(f.period) ? f.period : periods[0];
    const kalo = await status(orgId);
    if (!period) return res.json({ data: { period: null, periods, items: [], summary: null, breadcrumb: [], parentId: null, kalodata: kalo } });
    if (f.auto === '1' && !f.parentId && kalo.scope === 'category' && kalo.category) {
      const kids = await db.one('SELECT COUNT(*) AS n FROM trend_categories WHERE org_id = :orgId AND period = :period AND parent_id = :id', {
        orgId,
        period,
        id: kalo.category.id,
      });
      const own = await db.one('SELECT parent_id FROM trend_categories WHERE org_id = :orgId AND category_id = :id AND parent_id IS NOT NULL LIMIT 1', {
        orgId,
        id: kalo.category.id,
      });
      f.parentId = Number(kids.n) ? kalo.category.id : (own?.parent_id ?? undefined);
    }
    const level = f.parentId ? null : f.level;
    const rows = await db.query(
      `SELECT c.* FROM trend_categories c
        WHERE c.org_id = :orgId AND c.period = :period
          AND ${f.parentId ? 'c.parent_id = :parentId' : 'c.level = :level'}
          AND (:q IS NULL OR c.name LIKE :q)
          ${f.growingOnly === '1' ? 'AND c.growth_rate > 0' : ''}
        ORDER BY ${SORTS[f.sort]} IS NULL, ${SORTS[f.sort]} ${f.dir === 'asc' ? 'ASC' : 'DESC'}, c.revenue DESC LIMIT 500`,
      { orgId, period, parentId: f.parentId ?? null, level, q: f.q ? `%${f.q}%` : null },
    );
    const items = tagOpportunity(rows.map(mapCategory));
    const ids = items.map((i) => i.id);
    const [spark, kids, counts] = await Promise.all([
      sparklines(orgId, ids, period),
      ids.length
        ? db.query('SELECT parent_id, COUNT(*) AS n FROM trend_categories WHERE org_id = :orgId AND period = :period AND parent_id IN (:ids) GROUP BY parent_id', { orgId, period, ids })
        : [],
      productCounts(orgId, items),
    ]);
    const kidCount = new Map(kids.map((k) => [k.parent_id, Number(k.n)]));
    for (const i of items) {
      i.trend = spark.get(i.id) ?? [];
      i.childCount = kidCount.get(i.id) ?? 0;
      i.productCount = counts.get(i.id) ?? 0;
    }

    // market summary from level 1 (the whole of TikTok Shop TH for the month)
    const l1 = tagOpportunity(
      (await db.query('SELECT * FROM trend_categories WHERE org_id = :orgId AND period = :period AND level = 1', { orgId, period })).map(mapCategory),
    );
    const prev = await db.one('SELECT SUM(revenue) AS r FROM trend_categories WHERE org_id = :orgId AND period = :p AND level = 1', {
      orgId,
      p: svc.shiftPeriod(period, -1),
    });
    const total = l1.reduce((s, c) => s + (c.revenue ?? 0), 0);
    const sizable = l1.filter((c) => c.revenue != null && c.revenue >= total * 0.01 && c.growth != null);
    const fastest = sizable.sort((a, b) => b.growth - a.growth)[0] ?? null;
    const l2 = tagOpportunity(
      (await db.query('SELECT * FROM trend_categories WHERE org_id = :orgId AND period = :period AND level = 2', { orgId, period })).map(mapCategory),
    );
    let best = l2.filter((c) => c.opportunity).sort((a, b) => (b.revenue ?? 0) - (a.revenue ?? 0))[0] ?? null;
    let fastestPick = fastest && { id: fastest.id, name: fastest.name, growth: fastest.growth, level: 1 };

    // one category is pulled: its numbers and its children lead the page
    let scope = null;
    if (kalo.scope === 'category' && kalo.category) {
      const row = await db.one('SELECT * FROM trend_categories WHERE org_id = :orgId AND category_id = :id ORDER BY period = :period DESC, period DESC LIMIT 1', {
        orgId,
        id: kalo.category.id,
        period,
      });
      if (row) {
        const kids = tagOpportunity(
          (await db.query('SELECT * FROM trend_categories WHERE org_id = :orgId AND period = :period AND parent_id = :id', { orgId, period: row.period, id: row.category_id })).map(
            mapCategory,
          ),
        );
        const c = mapCategory(row);
        scope = { ...c, period: row.period, path: kalo.category.path, focusParentId: kids.length ? c.id : c.parentId };
        const fast = kids.filter((k) => k.growth != null).sort((a, b) => b.growth - a.growth)[0];
        fastestPick = fast ? { id: fast.id, name: fast.name, growth: fast.growth, level: fast.level } : null;
        best = kids.filter((k) => k.opportunity).sort((a, b) => (b.revenue ?? 0) - (a.revenue ?? 0))[0] ?? null;
      }
    }
    const tracked = await db.one("SELECT COUNT(*) AS n FROM trending_products WHERE org_id = :orgId AND platform = 'kalodata' AND status = 'watching'", { orgId });
    const products = await db.one("SELECT COUNT(*) AS n FROM trending_products WHERE org_id = :orgId AND platform = 'kalodata'", { orgId });

    // no stored month before this one: work the previous 30 days back from each category's growth rate
    const prevRevenue = prev?.r
      ? Number(prev.r)
      : l1.every((c) => c.revenue != null && c.growth != null && c.growth > -100)
        ? l1.reduce((s, c) => s + c.revenue / (1 + c.growth / 100), 0)
        : null;

    res.json({
      data: {
        period,
        periods,
        breadcrumb: f.parentId ? await breadcrumb(orgId, f.parentId) : [],
        parentId: f.parentId ?? null,
        items,
        summary: {
          revenue: total,
          prevRevenue: prevRevenue == null ? null : Math.round(prevRevenue),
          growth: prevRevenue ? Math.round((total / prevRevenue - 1) * 10000) / 100 : null,
          categories: l1.length,
          fastest: fastestPick,
          opportunity: best && { id: best.id, name: best.name, growth: best.growth, top3: best.top3, level: best.level },
          scope,
          tracked: Number(tracked.n),
          products: Number(products.n),
        },
        kalodata: kalo,
      },
    });
  },
);

/** What the channel split means for the kind of content to make (guide §5.1). */
function channelAdvice(c) {
  const parts = { video: c.video_revenue, live: c.live_revenue, mall: c.mall_revenue };
  const total = Object.values(parts).reduce((s, v) => s + (Number(v) || 0), 0);
  if (!total) return null;
  const share = Object.fromEntries(Object.entries(parts).map(([k, v]) => [k, Math.round(((Number(v) || 0) / total) * 1000) / 10]));
  const top = Object.entries(share).sort((a, b) => b[1] - a[1])[0][0];
  const advice = {
    video: 'ยอดขายมาจากวิดีโอมาก — ถอดสูตรคลิปที่ขายได้หลายคลิป ทดลอง Hook และการสาธิตหลายแบบ',
    live: 'ยอดขายมาจากไลฟ์มาก — สินค้าอาจต้องอธิบาย/สาธิตสด ถ้าไม่ไลฟ์ ให้ดูว่ามีคลิปวิดีโอที่ขายได้จริงหรือไม่ก่อนตัดสินใจ',
    mall: 'ยอดขายมาจากหน้าร้าน/Product Card มาก — ราคา โปรโมชัน และหน้าสินค้ามีผลมาก สัดส่วนนี้ไม่ใช่ยอดที่ครีเอเตอร์สร้างโดยตรง',
  }[top];
  return { share, top, advice };
}

router.get(
  '/categories/:id',
  requirePermission('scraping:read'),
  validate({ params: z.object({ id: z.string().trim().max(32) }), query: z.object({ period: z.string().regex(periodRe).optional() }) }),
  async (req, res) => {
    const orgId = req.user.orgId;
    const { id } = req.valid.params;
    const history = await db.query('SELECT * FROM trend_categories WHERE org_id = :orgId AND category_id = :id ORDER BY period', { orgId, id });
    if (!history.length) throw notFound('ไม่พบหมวดหมู่นี้');
    const period = req.valid.query.period && history.some((h) => h.period === req.valid.query.period) ? req.valid.query.period : history[history.length - 1].period;
    const c = history.find((h) => h.period === period);
    const children = tagOpportunity(
      (
        await db.query('SELECT * FROM trend_categories c WHERE c.org_id = :orgId AND c.period = :period AND c.parent_id = :id ORDER BY c.revenue DESC', {
          orgId,
          period,
          id,
        })
      ).map(mapCategory),
    );
    const spark = await sparklines(orgId, children.map((k) => k.id), period);
    const counts = await productCounts(orgId, children);
    for (const k of children) {
      k.trend = spark.get(k.id) ?? [];
      k.productCount = counts.get(k.id) ?? 0;
    }
    const scope = await productScope(orgId, id);
    const [base] = tagOpportunity([mapCategory(c)]);
    res.json({
      data: {
        ...base,
        period,
        periods: history.map((h) => h.period).reverse(),
        breadcrumb: await breadcrumb(orgId, id),
        history: history.map((h) => ({ period: h.period, revenue: n(h.revenue), sale: n(h.sale), growth: n(h.growth_rate) })),
        dailyTrend: (parse(c.revenue_trend) ?? []).map(n),
        channels: {
          video: n(c.video_revenue),
          live: n(c.live_revenue),
          mall: n(c.mall_revenue),
          affiliate: n(c.affiliate_revenue),
          self: n(c.self_revenue),
        },
        channelAdvice: channelAdvice(c),
        children,
        productScope: scope,
      },
    });
  },
);

module.exports = { router, productScope };
