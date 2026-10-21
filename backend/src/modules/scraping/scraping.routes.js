'use strict';

const express = require('express');
const { z } = require('zod');
const db = require('../../db/pool');
const { validate } = require('../../core/http');
const { authenticate, requirePermission } = require('../../core/auth');
const { audit } = require('../../core/audit');
const { notFound, badRequest, conflict } = require('../../core/errors');
const ai = require('../../integrations/ai');
const shopeeAffiliate = require('../../integrations/shopee-affiliate');
const { upsertItems, rescore, recomputeCategory, getBenchmark } = require('./trends.service');
const { CHECKS, SATURATED_RANK } = require('./lifecycle');
const { csvToItems, csvTemplate, FIELDS, TEMPLATE_COLUMNS, TEMPLATE_ROWS } = require('./csv');
const { PLATFORMS, startRun } = require('./sources');

const router = express.Router();
router.use(authenticate);

const idParam = z.object({ id: z.coerce.number().int().positive() });
const parseJson = (v) => (v == null ? null : typeof v === 'string' ? JSON.parse(v) : v);
const n = (v) => (v == null ? null : Number(v));

/* ----------------------------------------------------------------- sources */

function mapSource(s) {
  const p = PLATFORMS[s.platform];
  return {
    id: s.id,
    platform: s.platform,
    method: s.method,
    name: s.name,
    config: parseJson(s.config) ?? {},
    intervalHours: s.interval_hours,
    isActive: Boolean(s.is_active),
    lastRunAt: s.last_run_at,
    lastError: s.last_error,
    runnable: Boolean(p?.runnable),
    notRunnableReason: p?.runnable ? null : (p?.reason ?? null),
    configured: p?.adapter ? p.adapter.isConfigured() : Boolean(p?.runnable),
    missingEnv: p?.adapter && !p.adapter.isConfigured() ? p.adapter.missing() : [],
    itemCount: Number(s.item_count ?? 0),
  };
}

router.get('/sources', requirePermission('scraping:read'), async (req, res) => {
  const rows = await db.query(
    `SELECT s.*, (SELECT COUNT(*) FROM trending_products t WHERE t.source_id = s.id) AS item_count
       FROM scrape_sources s WHERE s.org_id = :orgId ORDER BY s.id`,
    { orgId: req.user.orgId },
  );
  res.json({ data: rows.map(mapSource) });
});

const sourceConfig = z
  .object({
    keyword: z.string().trim().max(100).optional(),
    sortType: z.enum(['relevance', 'sales', 'price_desc', 'price_asc', 'commission']).optional(),
    pages: z.coerce.number().int().min(1).max(5).optional(),
    limit: z.coerce.number().int().min(1).max(50).optional(),
    urls: z.array(z.string().trim().url()).max(10).optional(),
    actorId: z.string().trim().max(200).optional(),
    input: z.record(z.string(), z.unknown()).optional(),
    fieldMap: z.record(z.string(), z.string().max(100)).optional(),
    platform: z.string().trim().max(30).optional(),
    // ai_search
    focus: z.string().trim().max(200).optional(),
    platformFocus: z.enum(['any', 'shopee', 'tiktok_shop', 'lazada']).optional(),
    count: z.coerce.number().int().min(3).max(15).optional(),
    channelProfileId: z.coerce.number().int().positive().nullable().optional(),
    enrich: z.boolean().optional(),
  })
  .strict();

const sourceBody = z.object({
  platform: z.enum(['shopee_affiliate', 'apify', 'custom_url', 'tiktok_shop', 'shopee', 'ai_search']),
  name: z.string().trim().min(1).max(191),
  config: sourceConfig.default({}),
  intervalHours: z.coerce
    .number()
    .int()
    .min(1)
    .max(24 * 30)
    .nullable()
    .default(null),
  isActive: z.boolean().default(true),
});

router.post('/sources', requirePermission('scraping:run'), validate({ body: sourceBody }), async (req, res) => {
  const b = req.valid.body;
  const r = await db.query(
    `INSERT INTO scrape_sources (org_id, platform, method, name, config, interval_hours, is_active)
     VALUES (:orgId, :platform, :method, :name, :config, :interval, :active)`,
    {
      orgId: req.user.orgId,
      platform: b.platform,
      method: PLATFORMS[b.platform].method,
      name: b.name,
      config: JSON.stringify(b.config),
      interval: b.intervalHours,
      active: b.isActive ? 1 : 0,
    },
  );
  audit(req, 'scraping.source.create', 'scrape_source', r.insertId, {
    platform: b.platform,
  });
  res.status(201).json({ data: { id: r.insertId } });
});

router.patch(
  '/sources/:id',
  requirePermission('scraping:run'),
  validate({
    params: idParam,
    body: sourceBody.omit({ platform: true }).partial(),
  }),
  async (req, res) => {
    const s = await db.one('SELECT id FROM scrape_sources WHERE id = :id AND org_id = :orgId', { id: req.valid.params.id, orgId: req.user.orgId });
    if (!s) throw notFound('ไม่พบแหล่งข้อมูล');
    const b = req.valid.body;
    await db.query(
      `UPDATE scrape_sources SET name = COALESCE(:name, name), config = COALESCE(:config, config),
              interval_hours = IF(:intervalSet, :interval, interval_hours), is_active = COALESCE(:active, is_active)
        WHERE id = :id`,
      {
        id: s.id,
        name: b.name ?? null,
        config: b.config ? JSON.stringify(b.config) : null,
        intervalSet: b.intervalHours !== undefined,
        interval: b.intervalHours ?? null,
        active: b.isActive === undefined ? null : b.isActive ? 1 : 0,
      },
    );
    audit(req, 'scraping.source.update', 'scrape_source', s.id);
    res.json({ data: { ok: true } });
  },
);

router.delete('/sources/:id', requirePermission('scraping:run'), validate({ params: idParam }), async (req, res) => {
  const r = await db.query('DELETE FROM scrape_sources WHERE id = :id AND org_id = :orgId', { id: req.valid.params.id, orgId: req.user.orgId });
  if (!r.affectedRows) throw notFound();
  audit(req, 'scraping.source.delete', 'scrape_source', req.valid.params.id);
  res.json({ data: { ok: true } });
});

/** Queue a fetch now. The cron tick (or the in-process runner) picks it up within a minute. */
router.post('/sources/:id/run', requirePermission('scraping:run'), validate({ params: idParam }), async (req, res) => {
  const s = await db.one('SELECT * FROM scrape_sources WHERE id = :id AND org_id = :orgId', { id: req.valid.params.id, orgId: req.user.orgId });
  if (!s) throw notFound('ไม่พบแหล่งข้อมูล');
  const p = PLATFORMS[s.platform];
  if (!p?.runnable) throw badRequest(p?.reason ?? 'แหล่งข้อมูลนี้ยังไม่รองรับ');
  if (p.adapter) p.adapter.requireConfig(); // 503 naming the missing keys
  const open = await db.one("SELECT id FROM scrape_runs WHERE source_id = :id AND status = 'running' AND started_at > UTC_TIMESTAMP() - INTERVAL 2 HOUR", {
    id: s.id,
  });
  if (open) throw conflict('แหล่งข้อมูลนี้กำลังดึงข้อมูลอยู่');
  const runId = await startRun(s.id, req.user.id);
  audit(req, 'scraping.run', 'scrape_source', s.id, { runId });
  res.status(202).json({ data: { runId } });
});

router.get(
  '/runs',
  requirePermission('scraping:read'),
  validate({
    query: z.object({
      sourceId: z.coerce.number().int().positive().optional(),
    }),
  }),
  async (req, res) => {
    const rows = await db.query(
      `SELECT r.*, s.name AS source_name, s.platform, u.full_name AS triggered_name
         FROM scrape_runs r JOIN scrape_sources s ON s.id = r.source_id LEFT JOIN users u ON u.id = r.triggered_by
        WHERE s.org_id = :orgId AND (:sourceId IS NULL OR r.source_id = :sourceId)
        ORDER BY r.id DESC LIMIT 30`,
      { orgId: req.user.orgId, sourceId: req.valid.query.sourceId ?? null },
    );
    res.json({
      data: rows.map((r) => ({
        id: r.id,
        sourceId: r.source_id,
        sourceName: r.source_name,
        platform: r.platform,
        status: r.status,
        stage: r.stage ?? null,
        summary: r.platform === 'ai_search' ? (parseJson(r.state)?.summary ?? null) : null,
        itemsFound: r.items_found,
        itemsNew: r.items_new,
        error: r.error,
        triggeredBy: r.triggered_name ?? (r.triggered_by ? `#${r.triggered_by}` : 'ตั้งเวลา'),
        startedAt: r.started_at,
        finishedAt: r.finished_at,
      })),
    });
  },
);

/* ------------------------------------------------------------------ trends */

/** Why AI search suggested the item (reasons, verified sources); null for other sources. */
function aiSearchOf(t) {
  const a = parseJson(t.raw)?.aiSearch;
  if (!a) return null;
  return {
    verified: Boolean(a.verified),
    whyTrending: a.whyTrending ?? null,
    trendStage: a.trendStage ?? null,
    keywords: a.searchKeywords ?? [],
    evidence: a.evidence ?? [],
    soldHint: a.soldHint ?? null,
    priceHint: a.priceHint ?? null,
    risks: a.risks ?? [],
    foundAt: a.foundAt ?? null,
    runId: a.runId ?? null,
  };
}

function mapTrend(t) {
  return {
    id: t.id,
    sourceId: t.source_id,
    sourceName: t.source_name ?? null,
    platform: t.platform,
    externalId: t.external_id,
    title: t.title,
    url: t.url,
    shopName: t.shop_name,
    imageUrl: t.image_url,
    price: n(t.price),
    soldCount: n(t.sold_count),
    soldVelocity: n(t.sold_velocity),
    rating: n(t.rating),
    commissionRate: n(t.commission_rate),
    category: t.category,
    categoryRank: n(t.category_rank),
    monthlySold: n(t.monthly_sold),
    prevMonthlySold: n(t.prev_monthly_sold),
    reviewCount: n(t.review_count),
    mediaReviewCount: n(t.media_review_count),
    positiveReviewPct: n(t.positive_review_pct),
    shopRating: n(t.shop_rating),
    shopResponseRate: n(t.shop_response_rate),
    shopShip48Rate: n(t.shop_ship48_rate),
    hasFlashSale: t.has_flash_sale == null ? null : Boolean(t.has_flash_sale),
    trendScore: n(t.trend_score),
    phase: t.lifecycle_phase ?? null,
    phaseRatio: n(t.phase_ratio),
    checklistPassed: n(t.checklist_passed),
    pickScore: n(t.pick_score),
    status: t.status,
    importedProductId: t.imported_product_id,
    affiliateLinkId: t.affiliate_link_id,
    affiliateUrl: t.affiliate_url ?? null,
    hasAnalysis: t.ai_analysis != null,
    aiAnalyzedAt: t.ai_analyzed_at,
    sourcePlatform: t.source_platform ?? null,
    aiSearch: aiSearchOf(t),
    firstSeenAt: t.first_seen_at,
    lastSeenAt: t.last_seen_at,
  };
}

const SORTS = {
  pick: ['t.pick_score', 'DESC'],
  score: ['t.trend_score', 'DESC'],
  velocity: ['t.sold_velocity', 'DESC'],
  sold: ['t.sold_count', 'DESC'],
  commission: ['t.commission_rate', 'DESC'],
  price: ['t.price', 'ASC'],
  newest: ['t.first_seen_at', 'DESC'],
};

const PHASE_FILTERS = {
  all: '1=1',
  '2-4': "t.lifecycle_phase IN ('2','3','4')",
  rising: "t.lifecycle_phase IN ('1','2','3','4','5')",
  declining: "t.lifecycle_phase IN ('B','C','D','E')",
};
/** Query-string boolean ("1"/"true"); z.coerce.boolean would read "0" as true. */
const flag = z
  .enum(['0', '1', 'true', 'false'])
  .optional()
  .transform((v) => v === '1' || v === 'true');

router.get(
  '/trends',
  requirePermission('scraping:read'),
  validate({
    query: z.object({
      status: z.enum(['new', 'watching', 'imported', 'ignored', 'active', 'all']).default('active'),
      platform: z.string().trim().max(30).optional(),
      q: z.string().trim().max(100).optional(),
      sort: z.enum(['pick', 'score', 'velocity', 'sold', 'commission', 'price', 'newest']).default('pick'),
      minCommission: z.coerce.number().min(0).max(100).optional(),
      sourceId: z.coerce.number().int().positive().optional(),
      phase: z.enum(['all', '2-4', 'rising', 'declining']).default('all'),
      hideTop10: flag,
      page: z.coerce.number().int().min(1).default(1),
      pageSize: z.coerce.number().int().min(1).max(100).default(24),
    }),
  }),
  async (req, res) => {
    const f = req.valid.query;
    const statusSql = { active: "t.status IN ('new','watching')", all: '1=1' }[f.status] ?? 't.status = :status';
    const where = `t.org_id = :orgId AND ${statusSql}
      AND (:platform IS NULL OR t.platform = :platform)
      AND (:q IS NULL OR t.title LIKE :q OR t.shop_name LIKE :q)
      AND (:minCommission IS NULL OR t.commission_rate >= :minCommission)
      AND (:sourceId IS NULL OR t.source_id = :sourceId)
      AND ${PHASE_FILTERS[f.phase]}
      ${f.hideTop10 ? `AND (t.category_rank IS NULL OR t.category_rank > ${SATURATED_RANK})` : ''}`;
    const params = {
      orgId: req.user.orgId,
      status: f.status,
      platform: f.platform || null,
      q: f.q ? `%${f.q}%` : null,
      minCommission: f.minCommission ?? null,
      sourceId: f.sourceId ?? null,
      limit: f.pageSize,
      offset: (f.page - 1) * f.pageSize,
    };
    const [rows, total, platforms] = await Promise.all([
      db.query(
        `SELECT t.*, s.name AS source_name, s.platform AS source_platform, a.short_url AS affiliate_url FROM trending_products t
           LEFT JOIN scrape_sources s ON s.id = t.source_id LEFT JOIN affiliate_links a ON a.id = t.affiliate_link_id
          WHERE ${where} ORDER BY ${SORTS[f.sort][0]} IS NULL, ${SORTS[f.sort].join(' ')}, t.id DESC LIMIT :limit OFFSET :offset`,
        params,
      ),
      db.one(`SELECT COUNT(*) AS n FROM trending_products t WHERE ${where}`, params),
      db.query('SELECT platform, COUNT(*) AS n FROM trending_products WHERE org_id = :orgId GROUP BY platform ORDER BY n DESC', { orgId: req.user.orgId }),
    ]);
    res.json({
      data: rows.map(mapTrend),
      meta: {
        page: f.page,
        pageSize: f.pageSize,
        total: Number(total.n),
        platforms: platforms.map((p) => ({
          platform: p.platform,
          count: Number(p.n),
        })),
      },
    });
  },
);

async function getTrend(orgId, id) {
  const t = await db.one(
    `SELECT t.*, s.name AS source_name, s.platform AS source_platform, a.short_url AS affiliate_url FROM trending_products t
       LEFT JOIN scrape_sources s ON s.id = t.source_id LEFT JOIN affiliate_links a ON a.id = t.affiliate_link_id
      WHERE t.id = :id AND t.org_id = :orgId`,
    { id, orgId },
  );
  if (!t) throw notFound('ไม่พบสินค้าเทรนด์');
  return t;
}

router.get('/trends/:id', requirePermission('scraping:read'), validate({ params: idParam }), async (req, res) => {
  const t = await getTrend(req.user.orgId, req.valid.params.id);
  const snaps = await db.query(
    'SELECT captured_at, price, sold_count, rating, commission_rate FROM trending_snapshots WHERE trending_product_id = :id ORDER BY captured_at DESC LIMIT 60',
    { id: t.id },
  );
  res.json({
    data: {
      ...mapTrend(t),
      phaseNotes: parseJson(t.phase_notes),
      checklist: parseJson(t.checklist) ?? [],
      manualChecks: parseJson(t.manual_checks) ?? {},
      benchmark: await getBenchmark(db.pool, t.org_id, t.platform, t.category),
      aiAnalysis: parseJson(t.ai_analysis),
      snapshots: snaps.reverse().map((s) => ({
        capturedAt: s.captured_at,
        price: n(s.price),
        soldCount: n(s.sold_count),
        rating: n(s.rating),
        commissionRate: n(s.commission_rate),
      })),
    },
  });
});

const CHECK_KEYS = CHECKS.map((c) => c.key).filter((k) => k !== 'phase');
const pctField = z.coerce.number().min(0).max(100).nullable();
const countField = z.coerce.number().int().min(0).max(1e12).nullable();
/** Facts the APIs rarely give (shop stats, reviews, rank) — filled in from the product/shop page. */
const TREND_FACTS = {
  category: ['category', z.string().trim().max(191).nullable()],
  categoryRank: ['category_rank', z.coerce.number().int().min(1).max(100000).nullable()],
  soldCount: ['sold_count', countField],
  monthlySold: ['monthly_sold', countField],
  prevMonthlySold: ['prev_monthly_sold', countField],
  rating: ['rating', z.coerce.number().min(0).max(5).nullable()],
  reviewCount: ['review_count', countField],
  mediaReviewCount: ['media_review_count', countField],
  positiveReviewPct: ['positive_review_pct', pctField],
  shopRating: ['shop_rating', z.coerce.number().min(0).max(5).nullable()],
  shopResponseRate: ['shop_response_rate', pctField],
  shopShip48Rate: ['shop_ship48_rate', pctField],
  commissionRate: ['commission_rate', pctField],
  hasFlashSale: ['has_flash_sale', z.boolean().nullable()],
};

router.patch(
  '/trends/:id',
  requirePermission('scraping:run'),
  validate({
    params: idParam,
    body: z
      .object({
        status: z.enum(['new', 'watching', 'ignored']).optional(),
        ...Object.fromEntries(Object.entries(TREND_FACTS).map(([k, [, schema]]) => [k, schema.optional()])),
        manualChecks: z.partialRecord(z.enum(CHECK_KEYS), z.boolean().nullable()).optional(),
      })
      .strict(),
  }),
  async (req, res) => {
    const t = await getTrend(req.user.orgId, req.valid.params.id);
    const b = req.valid.body;
    if (b.status) {
      if (t.status === 'imported') throw conflict('สินค้านี้นำเข้าเป็นสินค้าของร้านแล้ว');
      await db.query('UPDATE trending_products SET status = :status WHERE id = :id', { id: t.id, status: b.status });
    }
    const sets = [];
    const params = { id: t.id };
    for (const [key, [col]] of Object.entries(TREND_FACTS)) {
      if (b[key] === undefined) continue;
      sets.push(`${col} = :${key}`);
      params[key] = key === 'hasFlashSale' && b[key] != null ? Number(b[key]) : key === 'category' ? b[key] || null : b[key];
    }
    if (b.manualChecks) {
      // null clears a manual answer so the data-driven result applies again
      const merged = {
        ...(parseJson(t.manual_checks) ?? {}),
        ...b.manualChecks,
      };
      for (const k of Object.keys(merged)) if (merged[k] === null) delete merged[k];
      sets.push('manual_checks = :manual');
      params.manual = Object.keys(merged).length ? JSON.stringify(merged) : null;
    }
    if (sets.length) {
      await db.tx(async (conn) => {
        await conn.query(`UPDATE trending_products SET ${sets.join(', ')} WHERE id = :id`, params);
        const category = b.category !== undefined ? b.category || null : t.category;
        // Sold/category changes move the category peak, so the whole category is rescored
        if (b.category !== undefined || b.soldCount !== undefined) {
          await recomputeCategory(conn, t.org_id, t.platform, category);
          if (category !== t.category) await recomputeCategory(conn, t.org_id, t.platform, t.category);
        } else await rescore(conn, t.id);
      });
      audit(req, 'scraping.trend.update', 'trending_product', t.id, {
        fields: Object.keys(b),
      });
    }
    const fresh = await getTrend(req.user.orgId, t.id);
    res.json({
      data: {
        ...mapTrend(fresh),
        phaseNotes: parseJson(fresh.phase_notes),
        checklist: parseJson(fresh.checklist) ?? [],
        manualChecks: parseJson(fresh.manual_checks) ?? {},
      },
    });
  },
);

/* --------------------------------------------------------------- benchmarks */

/** Per-category peak (avg units sold of #1–#2). Auto from collected items unless a person sets it. */
router.get('/benchmarks', requirePermission('scraping:read'), async (req, res) => {
  const rows = await db.query(
    `SELECT c.platform, c.category, c.items, c.top_sold, b.peak_sold, b.source, b.updated_at
       FROM (SELECT platform, category, COUNT(*) AS items, MAX(sold_count) AS top_sold FROM trending_products
              WHERE org_id = :orgId AND category IS NOT NULL GROUP BY platform, category) c
       LEFT JOIN trend_category_benchmarks b ON b.org_id = :orgId AND b.platform = c.platform AND b.category = c.category
     UNION
     SELECT b.platform, b.category, 0, NULL, b.peak_sold, b.source, b.updated_at FROM trend_category_benchmarks b
      WHERE b.org_id = :orgId AND NOT EXISTS (SELECT 1 FROM trending_products t WHERE t.org_id = b.org_id AND t.platform = b.platform AND t.category = b.category)
     ORDER BY items DESC, category`,
    { orgId: req.user.orgId },
  );
  res.json({
    data: rows.map((r) => ({
      platform: r.platform,
      category: r.category,
      items: Number(r.items),
      topSold: n(r.top_sold),
      peakSold: n(r.peak_sold),
      source: r.source ?? null,
      updatedAt: r.updated_at ?? null,
    })),
  });
});

router.put(
  '/benchmarks',
  requirePermission('scraping:run'),
  validate({
    body: z.object({
      platform: z.string().trim().min(1).max(30),
      category: z.string().trim().min(1).max(191),
      peakSold: z.coerce.number().int().min(1).max(1e12).nullable(),
    }),
  }),
  async (req, res) => {
    const { platform, category, peakSold } = req.valid.body;
    const orgId = req.user.orgId;
    await db.tx(async (conn) => {
      if (peakSold == null) {
        // Back to automatic
        await conn.query('DELETE FROM trend_category_benchmarks WHERE org_id = :orgId AND platform = :platform AND category = :category', {
          orgId,
          platform,
          category,
        });
      } else {
        await conn.query(
          `INSERT INTO trend_category_benchmarks (org_id, platform, category, peak_sold, source) VALUES (:orgId, :platform, :category, :peakSold, 'manual')
           ON DUPLICATE KEY UPDATE peak_sold = VALUES(peak_sold), source = 'manual'`,
          { orgId, platform, category, peakSold },
        );
      }
      await recomputeCategory(conn, orgId, platform, category);
    });
    audit(req, 'scraping.benchmark.set', 'trend_category_benchmark', null, {
      platform,
      category,
      peakSold,
    });
    res.json({ data: await getBenchmark(db.pool, orgId, platform, category) });
  },
);

/* --------------------------------------------------------------- CSV import */

/* --------------------------------------------------------------- AI search */

const AI_SOURCE_NAME = 'AI ค้นหาสินค้าขายดี';

/**
 * One-click AI web search: reuse (or create) the org's ai_search source with the given settings
 * and queue a run. Progress and results come from GET /runs?sourceId=.
 */
router.post(
  '/ai-search',
  requirePermission('scraping:run'),
  validate({ body: sourceConfig.pick({ focus: true, platformFocus: true, count: true, channelProfileId: true, enrich: true }).default({}) }),
  async (req, res) => {
    ai.requireConfig(); // 503 naming the missing key before anything is stored
    const orgId = req.user.orgId;
    const b = req.valid.body;
    if (b.channelProfileId) {
      const p = await db.one('SELECT id FROM channel_profiles WHERE id = :id AND org_id = :orgId', { id: b.channelProfileId, orgId });
      if (!p) throw notFound('ไม่พบโปรไฟล์ช่อง');
    }
    let source = await db.one("SELECT * FROM scrape_sources WHERE org_id = :orgId AND platform = 'ai_search' ORDER BY id LIMIT 1", { orgId });
    const config = { platformFocus: 'any', count: 8, enrich: true, ...(parseJson(source?.config) ?? {}), ...b };
    if (!config.focus) delete config.focus;
    if (source) {
      await db.query('UPDATE scrape_sources SET config = :config, is_active = 1 WHERE id = :id', { id: source.id, config: JSON.stringify(config) });
    } else {
      const r = await db.query(
        `INSERT INTO scrape_sources (org_id, platform, method, name, config, interval_hours, is_active)
         VALUES (:orgId, 'ai_search', 'ai_web_search', :name, :config, NULL, 1)`,
        { orgId, name: AI_SOURCE_NAME, config: JSON.stringify(config) },
      );
      source = { id: r.insertId };
    }
    const open = await db.one("SELECT id FROM scrape_runs WHERE source_id = :id AND status = 'running' AND started_at > UTC_TIMESTAMP() - INTERVAL 2 HOUR", {
      id: source.id,
    });
    if (open) throw conflict('AI กำลังค้นหาอยู่ รอให้รอบนี้เสร็จก่อน', { runId: open.id });
    const runId = await startRun(source.id, req.user.id);
    audit(req, 'scraping.ai_search', 'scrape_source', source.id, { runId, ...config });
    res.status(202).json({ data: { runId, sourceId: source.id, config } });
  },
);

/** Last-used settings of the AI search source (to pre-fill the settings form). */
router.get('/ai-search', requirePermission('scraping:read'), async (req, res) => {
  const source = await db.one("SELECT id, config, last_run_at FROM scrape_sources WHERE org_id = :orgId AND platform = 'ai_search' ORDER BY id LIMIT 1", {
    orgId: req.user.orgId,
  });
  res.json({
    data: {
      sourceId: source?.id ?? null,
      config: { platformFocus: 'any', count: 8, enrich: true, ...(parseJson(source?.config) ?? {}) },
      lastRunAt: source?.last_run_at ?? null,
      configured: ai.isConfigured(),
      provider: ai.providerId(),
      shopeeEnrich: shopeeAffiliate.isConfigured(),
    },
  });
});

/** Sample file + column guide for the import dialog (headers are aliases, so the file maps itself). */
router.get('/csv-template', requirePermission('scraping:read'), (req, res) => {
  res.json({
    data: {
      filename: 'trend-import-template.csv',
      csv: csvTemplate(),
      columns: TEMPLATE_COLUMNS.map((c) => ({ ...c, required: Boolean(c.required), example: TEMPLATE_ROWS[0][c.field] ?? null })),
    },
  });
});

router.post(
  '/trends/import-csv',
  requirePermission('scraping:run'),
  validate({
    body: z.object({
      csv: z
        .string()
        .min(1)
        .max(2 * 1024 * 1024, 'ไฟล์ใหญ่เกิน 2 MB'),
      platform: z.enum(['shopee', 'tiktok_shop', 'lazada', 'other']),
      mapping: z.partialRecord(z.enum(FIELDS), z.number().int().min(0)).optional(),
      preview: z.boolean().default(false),
      // Dry run of the downloadable sample; only honoured for previews, never for an import
      allowSample: z.boolean().default(false),
    }),
  }),
  async (req, res) => {
    const b = req.valid.body;
    const parsed = csvToItems(b.csv, { platform: b.platform, mapping: b.mapping, allowSample: b.preview && b.allowSample });
    if (b.preview) {
      return res.json({
        data: {
          header: parsed.header,
          mapping: parsed.mapping,
          rows: parsed.items.slice(0, 10),
          total: parsed.items.length,
          errors: parsed.errors.slice(0, 20),
        },
      });
    }
    if (!parsed.items.length)
      throw badRequest(parsed.errors[0]?.message ?? 'ไม่พบข้อมูลที่นำเข้าได้', {
        errors: parsed.errors.slice(0, 20),
      });
    if (parsed.items.length > 2000) throw badRequest('นำเข้าได้ครั้งละไม่เกิน 2,000 แถว');
    const stats = await upsertItems({
      orgId: req.user.orgId,
      items: parsed.items,
    });
    audit(req, 'scraping.import_csv', 'trending_product', null, {
      platform: b.platform,
      ...stats,
    });
    return res.json({ data: { ...stats, errors: parsed.errors.slice(0, 20) } });
  },
);

/* ------------------------------------------------------------- AI analysis */

const str = (description) => ({ type: 'string', description });
const ANALYSIS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['fitScore', 'verdict', 'targetAudience', 'sellingPoints', 'videoHooks', 'contentAngle', 'risks', 'suggestedPrice'],
  properties: {
    fitScore: {
      type: 'integer',
      minimum: 0,
      maximum: 10,
      description: 'ความเหมาะที่ร้านจะขาย/ทำคอนเทนต์ 0-10',
    },
    verdict: str('สรุป 1-2 ประโยคว่าควรทำหรือไม่ เพราะอะไร'),
    targetAudience: str('กลุ่มลูกค้าเป้าหมาย'),
    sellingPoints: {
      type: 'array',
      items: { type: 'string' },
      description: 'จุดขาย 3-5 ข้อ สั้นๆ',
    },
    videoHooks: {
      type: 'array',
      items: { type: 'string' },
      description: 'ประโยคเปิดคลิปสั้น 9:16 ใน 3 วินาทีแรก 3 แบบ',
    },
    contentAngle: str('มุมการเล่าเรื่องในคลิปรีวิวที่แนะนำ'),
    risks: {
      type: 'array',
      items: { type: 'string' },
      description: 'ความเสี่ยง เช่น ของปลอม ข้อห้ามโฆษณา (อย./สคบ.) การเคลมเกินจริง การแข่งขันราคา',
    },
    suggestedPrice: {
      type: ['number', 'null'],
      description: 'ราคาขายที่แนะนำ (บาท) หรือ null ถ้าข้อมูลไม่พอ',
    },
    phaseComment: str('ความเห็นต่อ Phase วงจรชีวิตสินค้าและอันดับในหมวด ว่ายังทันกระแสหรือตลาดอิ่มตัวแล้ว'),
    channelFit: {
      type: ['string', 'null'],
      description: 'สินค้านี้เข้ากับตัวตน/ความสนใจของช่องแค่ไหน (null ถ้าไม่มีโปรไฟล์ช่อง)',
    },
  },
};

const ANALYSIS_SYSTEM = `คุณเป็นนักวิเคราะห์สินค้าและนักการตลาดออนไลน์ในไทย (TikTok/Shopee)
ประเมินสินค้าเทรนด์ว่าร้านควรนำมาขายหรือทำคลิปรีวิว affiliate หรือไม่ จากข้อมูลที่ให้เท่านั้น
- อย่าแต่งตัวเลขที่ไม่มีในข้อมูล ถ้าข้อมูลไม่พอให้บอกในคำตัดสิน
- ความเร็วยอดขาย (ชิ้น/วัน) สำคัญกว่ายอดขายสะสม
- "สินค้ากระแส" ไม่เท่ากับ "สินค้าขายดี": สินค้ามีวงจรชีวิต Phase 1–5 (ขาขึ้น) A (จุดสูงสุด) B–E (ขาลง)
  ช่วงที่เหมาะกับนายหน้าคือ Phase 3 (รับได้ 2–4) ถ้าเลยจุดสูงสุดแล้วให้เตือนชัดเจน
- สินค้าอันดับ 1–10 ของหมวดมีคนทำคลิปขายเยอะแล้ว ให้มองหาอันดับ 11 ขึ้นไป
- ใช้ผลเช็กลิสต์ (ดาวสินค้า/ร้าน การตอบกลับ การจัดส่ง ค่าคอม แฟลชเซล รีวิว) ประกอบ ข้อที่ "ไม่มีข้อมูล" ให้แนะนำว่าต้องไปตรวจอะไรเพิ่ม
- ถ้ามีโปรไฟล์ช่อง ให้ประเมินว่าสินค้าเข้ากับตัวตนช่องหรือไม่ (ช่องที่ขายของตรงกับความสนใจของตัวเองจะเล่าได้จริงใจกว่า)
- ระบุความเสี่ยงด้านกฎหมายโฆษณาไทย (เครื่องสำอาง อาหารเสริม เครื่องมือแพทย์ ต้องระวังคำเคลม) อย่างตรงไปตรงมา
- เขียนภาษาไทย กระชับ`;

const STATUS_TH = {
  pass: 'ผ่าน',
  partial: 'พอใช้',
  fail: 'ไม่ผ่าน',
  unknown: 'ไม่มีข้อมูล',
};

router.post(
  '/trends/:id/analyze',
  requirePermission('scraping:run'),
  validate({
    params: idParam,
    body: z
      .object({
        refresh: z.boolean().default(false),
        channelProfileId: z.number().int().positive().optional(),
      })
      .default({}),
  }),
  async (req, res) => {
    const t = await getTrend(req.user.orgId, req.valid.params.id);
    if (t.ai_analysis && !req.valid.body.refresh)
      return res.json({
        data: { analysis: parseJson(t.ai_analysis), cached: true },
      });
    ai.requireConfig();
    const [org, categories, profile] = await Promise.all([
      db.one('SELECT name FROM organizations WHERE id = :id', {
        id: req.user.orgId,
      }),
      db.query('SELECT name FROM product_categories WHERE org_id = :orgId ORDER BY name LIMIT 30', { orgId: req.user.orgId }),
      req.valid.body.channelProfileId
        ? db.one('SELECT * FROM channel_profiles WHERE id = :id AND org_id = :orgId', { id: req.valid.body.channelProfileId, orgId: req.user.orgId })
        : db.one('SELECT * FROM channel_profiles WHERE org_id = :orgId AND is_default = 1 LIMIT 1', { orgId: req.user.orgId }),
    ]);
    if (req.valid.body.channelProfileId && !profile) throw notFound('ไม่พบโปรไฟล์ช่อง');
    const notes = parseJson(t.phase_notes);
    const checklist = parseJson(t.checklist) ?? [];
    const facts = {
      สินค้า: t.title,
      แพลตฟอร์ม: t.platform,
      ร้านที่ขาย: t.shop_name,
      ราคา: n(t.price),
      ยอดขายสะสม: n(t.sold_count),
      'ความเร็วยอดขาย (ชิ้น/วัน)': n(t.sold_velocity),
      คะแนนรีวิว: n(t.rating),
      'ค่าคอมมิชชัน (%)': n(t.commission_rate),
      หมวด: t.category,
      'คะแนนเทรนด์ (0-100)': n(t.trend_score),
      อันดับในหมวด: n(t.category_rank),
      'ยอดขายเดือนล่าสุด / เดือนก่อน': t.monthly_sold != null ? `${n(t.monthly_sold)} / ${n(t.prev_monthly_sold) ?? '-'}` : null,
      'Phase วงจรชีวิต (ประเมินโดยระบบ)': t.lifecycle_phase ?? 'ประเมินไม่ได้',
      'เหตุผลของ Phase': notes?.reasons ?? [],
      'ยอดขายเทียบยอดสูงสุดของหมวด (%)': n(t.phase_ratio),
      เช็กลิสต์: Object.fromEntries(checklist.map((c) => [c.label, STATUS_TH[c.status] ?? c.status])),
    };
    const channel = profile
      ? `\n\nโปรไฟล์ช่อง "${profile.name}"${profile.on_camera ? '' : ' (ไม่ออกหน้ากล้อง)'}:\n${profile.persona}` +
        (parseJson(profile.interests)?.length ? `\nความสนใจ: ${parseJson(profile.interests).join(', ')}` : '') +
        (profile.audience ? `\nกลุ่มผู้ชม: ${profile.audience}` : '')
      : '';
    const { data, model, provider } = await ai.extractStructured({
      system: ANALYSIS_SYSTEM,
      schema: ANALYSIS_SCHEMA,
      toolName: 'submit_analysis',
      toolDescription: 'ส่งผลการวิเคราะห์สินค้า',
      maxTokens: 3000,
      content: [
        {
          type: 'text',
          text: `ร้าน: ${org.name}\nหมวดสินค้าที่ร้านขายอยู่: ${categories.map((c) => c.name).join(', ') || '-'}${channel}\n\nข้อมูลสินค้า:\n${JSON.stringify(facts, null, 2)}`,
        },
      ],
    });
    const analysis = {
      ...data,
      fitScore: Math.max(0, Math.min(10, Math.round(Number(data.fitScore) || 0))),
      channelFit: profile ? (data.channelFit ?? null) : null,
      channelProfile: profile ? { id: profile.id, name: profile.name } : null,
      model,
      provider,
    };
    await db.query('UPDATE trending_products SET ai_analysis = :a, ai_analyzed_at = UTC_TIMESTAMP() WHERE id = :id', { id: t.id, a: JSON.stringify(analysis) });
    audit(req, 'scraping.analyze', 'trending_product', t.id, {
      provider,
      model,
    });
    return res.json({ data: { analysis, cached: false } });
  },
);

/* --------------------------------------------------------- channel profiles */

/** Book method: describe the person behind the channel, let AI shape the channel and its product categories. */
const PLAN_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['concept', 'channelNames', 'contentFormats', 'identity', 'promotionPlan', 'contentExamples', 'productCategories'],
  properties: {
    concept: str('คอนเซ็ปต์ช่อง 2-3 ประโยค'),
    channelNames: {
      type: 'array',
      items: { type: 'string' },
      description: 'ชื่อช่องที่แนะนำ 3 ชื่อ',
    },
    contentFormats: {
      type: 'array',
      items: { type: 'string' },
      description: 'รูปแบบคอนเทนต์ 3-5 แบบ (ไม่ต้องออกหน้ากล้องถ้าโปรไฟล์ระบุ)',
    },
    identity: str('เอกลักษณ์ของช่อง: โทนเสียง ภาพ สไตล์การเล่า'),
    promotionPlan: {
      type: 'array',
      items: { type: 'string' },
      description: 'แผนโปรโมตช่อง 3-5 ข้อ',
    },
    contentExamples: {
      type: 'array',
      items: { type: 'string' },
      description: 'ตัวอย่างไอเดียคลิป 5 ชิ้น',
    },
    productCategories: {
      type: 'array',
      description: 'หมวดสินค้าที่ควรขาย 3-6 หมวด ที่ตรงกับความสนใจของช่อง',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['category', 'why', 'keywords'],
        properties: {
          category: str('ชื่อหมวดสินค้า'),
          why: str('ทำไมเข้ากับช่อง'),
          keywords: {
            type: 'array',
            items: { type: 'string' },
            description: 'คีย์เวิร์ดค้นหาสินค้าใน Shopee/TikTok Shop 2-4 คำ',
          },
        },
      },
    },
  },
};

const PLAN_SYSTEM = `สมมติว่าคุณเป็นสุดยอดนักวิเคราะห์ครีเอเตอร์ที่ศึกษาช่อง TikTok ระดับ Top 100 ของไทย
งานของคุณคือวางแนวช่องนายหน้าขายของ (affiliate) ให้คนตามโปรไฟล์ที่ได้รับ
- ช่องที่ขายสินค้าตรงกับความชอบและชีวิตจริงของเจ้าของช่องจะเล่าได้จริงใจและอยู่ได้นาน
- ถ้าโปรไฟล์ระบุว่าไม่ออกหน้ากล้อง ให้เสนอรูปแบบที่ใช้มือ เสียงพากย์ ภาพสินค้า หรือ AI แทน
- หมวดสินค้าต้องสอดคล้องกับคอนเซ็ปต์ และคีย์เวิร์ดต้องใช้ค้นหาสินค้าได้จริง
- เขียนภาษาไทย กระชับ เป็นรูปธรรม`;

function mapProfile(p) {
  return {
    id: p.id,
    name: p.name,
    persona: p.persona,
    interests: parseJson(p.interests) ?? [],
    audience: p.audience,
    onCamera: Boolean(p.on_camera),
    isDefault: Boolean(p.is_default),
    aiPlan: parseJson(p.ai_plan),
    aiPlannedAt: p.ai_planned_at,
    updatedAt: p.updated_at,
  };
}

const profileBody = z.object({
  name: z.string().trim().min(1).max(191),
  persona: z.string().trim().min(10, 'เล่าโปรไฟล์อย่างน้อย 10 ตัวอักษร').max(4000),
  interests: z.array(z.string().trim().min(1).max(60)).max(20).default([]),
  audience: z.string().trim().max(500).nullable().default(null),
  onCamera: z.boolean().default(false),
  isDefault: z.boolean().default(false),
});

async function getProfile(orgId, id) {
  const p = await db.one('SELECT * FROM channel_profiles WHERE id = :id AND org_id = :orgId', { id, orgId });
  if (!p) throw notFound('ไม่พบโปรไฟล์ช่อง');
  return p;
}

router.get('/channel-profiles', requirePermission('scraping:read'), async (req, res) => {
  const rows = await db.query('SELECT * FROM channel_profiles WHERE org_id = :orgId ORDER BY is_default DESC, id', { orgId: req.user.orgId });
  res.json({ data: rows.map(mapProfile) });
});

router.post('/channel-profiles', requirePermission('scraping:run'), validate({ body: profileBody }), async (req, res) => {
  const b = req.valid.body;
  const orgId = req.user.orgId;
  const id = await db.tx(async (conn) => {
    const [[{ c }]] = await conn.query('SELECT COUNT(*) AS c FROM channel_profiles WHERE org_id = :orgId', { orgId });
    const isDefault = b.isDefault || Number(c) === 0; // the first profile becomes the default
    if (isDefault) await conn.query('UPDATE channel_profiles SET is_default = 0 WHERE org_id = :orgId', { orgId });
    const [r] = await conn.query(
      `INSERT INTO channel_profiles (org_id, name, persona, interests, audience, on_camera, is_default)
       VALUES (:orgId, :name, :persona, :interests, :audience, :onCamera, :isDefault)`,
      {
        orgId,
        ...b,
        interests: JSON.stringify(b.interests),
        onCamera: b.onCamera ? 1 : 0,
        isDefault: isDefault ? 1 : 0,
      },
    );
    return r.insertId;
  });
  audit(req, 'scraping.channel_profile.create', 'channel_profile', id);
  res.status(201).json({ data: mapProfile(await getProfile(orgId, id)) });
});

router.put('/channel-profiles/:id', requirePermission('scraping:run'), validate({ params: idParam, body: profileBody }), async (req, res) => {
  const p = await getProfile(req.user.orgId, req.valid.params.id);
  const b = req.valid.body;
  await db.tx(async (conn) => {
    if (b.isDefault) await conn.query('UPDATE channel_profiles SET is_default = 0 WHERE org_id = :orgId', { orgId: p.org_id });
    await conn.query(
      `UPDATE channel_profiles SET name = :name, persona = :persona, interests = :interests, audience = :audience, on_camera = :onCamera,
              is_default = IF(:isDefault, 1, is_default) WHERE id = :id`,
      {
        id: p.id,
        ...b,
        interests: JSON.stringify(b.interests),
        onCamera: b.onCamera ? 1 : 0,
        isDefault: b.isDefault ? 1 : 0,
      },
    );
  });
  audit(req, 'scraping.channel_profile.update', 'channel_profile', p.id);
  res.json({ data: mapProfile(await getProfile(req.user.orgId, p.id)) });
});

router.delete('/channel-profiles/:id', requirePermission('scraping:run'), validate({ params: idParam }), async (req, res) => {
  const p = await getProfile(req.user.orgId, req.valid.params.id);
  await db.query('DELETE FROM channel_profiles WHERE id = :id', { id: p.id });
  audit(req, 'scraping.channel_profile.delete', 'channel_profile', p.id);
  res.json({ data: { ok: true } });
});

router.post('/channel-profiles/:id/plan', requirePermission('scraping:run'), validate({ params: idParam }), async (req, res) => {
  const p = await getProfile(req.user.orgId, req.valid.params.id);
  ai.requireConfig();
  const interests = parseJson(p.interests) ?? [];
  const { data, model, provider } = await ai.extractStructured({
    system: PLAN_SYSTEM,
    schema: PLAN_SCHEMA,
    toolName: 'submit_channel_plan',
    toolDescription: 'ส่งแผนวางแนวช่อง',
    maxTokens: 4000,
    content: [
      {
        type: 'text',
        text:
          `โปรไฟล์เจ้าของช่อง:\n${p.persona}` +
          (interests.length ? `\nความสนใจ: ${interests.join(', ')}` : '') +
          (p.audience ? `\nกลุ่มผู้ชมที่อยากได้: ${p.audience}` : '') +
          `\nออกหน้ากล้อง: ${p.on_camera ? 'ได้' : 'ไม่ออกหน้ากล้อง'}` +
          '\n\nช่วยวางแนวช่อง: คอนเซ็ปต์ → ชื่อช่อง → รูปแบบคอนเทนต์ → เอกลักษณ์ → แผนโปรโมต → ตัวอย่างคอนเทนต์ → หมวดสินค้าที่ควรขายพร้อมคีย์เวิร์ด',
      },
    ],
  });
  const arr = (v) => (Array.isArray(v) ? v.map(String).filter(Boolean) : []);
  const plan = {
    concept: String(data.concept ?? ''),
    channelNames: arr(data.channelNames),
    contentFormats: arr(data.contentFormats),
    identity: String(data.identity ?? ''),
    promotionPlan: arr(data.promotionPlan),
    contentExamples: arr(data.contentExamples),
    productCategories: (Array.isArray(data.productCategories) ? data.productCategories : [])
      .filter((c) => c && c.category)
      .map((c) => ({
        category: String(c.category),
        why: String(c.why ?? ''),
        keywords: arr(c.keywords).slice(0, 6),
      })),
    model,
    provider,
  };
  await db.query('UPDATE channel_profiles SET ai_plan = :plan, ai_planned_at = UTC_TIMESTAMP() WHERE id = :id', { id: p.id, plan: JSON.stringify(plan) });
  audit(req, 'scraping.channel_profile.plan', 'channel_profile', p.id, {
    provider,
    model,
  });
  res.json({ data: mapProfile(await getProfile(req.user.orgId, p.id)) });
});

/* -------------------------------------------------- import / affiliate link */

router.post(
  '/trends/:id/import-product',
  requirePermission('products:write'),
  validate({
    params: idParam,
    body: z.object({ price: z.coerce.number().min(0).max(9_999_999).optional() }).default({}),
  }),
  async (req, res) => {
    const t = await getTrend(req.user.orgId, req.valid.params.id);
    if (t.imported_product_id) throw conflict('นำเข้าเป็นสินค้าแล้ว');
    const a = parseJson(t.ai_analysis);
    const price = req.valid.body.price ?? a?.suggestedPrice ?? n(t.price) ?? 0;
    const productId = await db.tx(async (conn) => {
      const [ins] = await conn
        .query(
          `INSERT INTO products (org_id, sku, name, description, selling_points, price, image_url, status, shopee_item_id)
         VALUES (:orgId, :sku, :name, :description, :points, :price, :image, 'draft', :shopeeId)`,
          {
            orgId: req.user.orgId,
            sku: `TR-${t.id}`,
            name: t.title.slice(0, 255),
            description: a?.verdict ?? null,
            points: a?.sellingPoints?.length ? a.sellingPoints.map((p) => `- ${p}`).join('\n') : null,
            price,
            image: t.image_url,
            shopeeId: t.platform === 'shopee' ? String(t.external_id).slice(0, 64) : null,
          },
        )
        .catch((err) => {
          if (err.code === 'ER_DUP_ENTRY') throw conflict(`มีสินค้ารหัส TR-${t.id} อยู่แล้ว`);
          throw err;
        });
      await conn.query("UPDATE trending_products SET status = 'imported', imported_product_id = :pid WHERE id = :id", { id: t.id, pid: ins.insertId });
      return ins.insertId;
    });
    audit(req, 'scraping.import_product', 'product', productId, {
      trendId: t.id,
    });
    res.status(201).json({ data: { productId } });
  },
);

router.post(
  '/trends/:id/affiliate-link',
  requirePermission('scraping:run'),
  validate({
    params: idParam,
    body: z
      .object({
        subId: z
          .string()
          .trim()
          .regex(/^[A-Za-z0-9]{0,50}$/, 'sub id ใช้ได้เฉพาะ a-z, 0-9')
          .optional(),
      })
      .default({}),
  }),
  async (req, res) => {
    const t = await getTrend(req.user.orgId, req.valid.params.id);
    if (t.platform !== 'shopee') throw badRequest('สร้างลิงก์ affiliate ได้เฉพาะสินค้า Shopee');
    if (!t.url) throw badRequest('สินค้านี้ไม่มีลิงก์ต้นทาง');
    shopeeAffiliate.requireConfig();
    const subId = req.valid.body.subId || `trend${t.id}`;
    const shortUrl = await shopeeAffiliate.generateShortLink(t.url, [subId]);
    const r = await db.query(
      `INSERT INTO affiliate_links (org_id, product_id, platform, original_url, short_url, sub_id)
       VALUES (:orgId, :productId, 'shopee', :url, :shortUrl, :subId)`,
      {
        orgId: req.user.orgId,
        productId: t.imported_product_id,
        url: t.url.slice(0, 1000),
        shortUrl,
        subId,
      },
    );
    await db.query('UPDATE trending_products SET affiliate_link_id = :aid WHERE id = :id', { id: t.id, aid: r.insertId });
    audit(req, 'scraping.affiliate_link', 'affiliate_link', r.insertId, {
      trendId: t.id,
    });
    res.status(201).json({ data: { id: r.insertId, shortUrl, subId } });
  },
);

module.exports = { router, ANALYSIS_SCHEMA };
