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
const { upsertItems } = require('./trends.service');
const { csvToItems, FIELDS } = require('./csv');
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
    notRunnableReason: p?.runnable ? null : p?.reason ?? null,
    configured: p?.adapter ? p.adapter.isConfigured() : Boolean(p?.runnable),
    missingEnv: p?.adapter && !p.adapter.isConfigured() ? p.adapter.meta.env.filter((e) => !e.optional && !process.env[e.name]).map((e) => e.name) : [],
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
  })
  .strict();

const sourceBody = z.object({
  platform: z.enum(['shopee_affiliate', 'apify', 'custom_url', 'tiktok_shop', 'shopee']),
  name: z.string().trim().min(1).max(191),
  config: sourceConfig.default({}),
  intervalHours: z.coerce.number().int().min(1).max(24 * 30).nullable().default(null),
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
  audit(req, 'scraping.source.create', 'scrape_source', r.insertId, { platform: b.platform });
  res.status(201).json({ data: { id: r.insertId } });
});

router.patch(
  '/sources/:id',
  requirePermission('scraping:run'),
  validate({ params: idParam, body: sourceBody.omit({ platform: true }).partial() }),
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
  const open = await db.one(
    "SELECT id FROM scrape_runs WHERE source_id = :id AND status = 'running' AND started_at > UTC_TIMESTAMP() - INTERVAL 2 HOUR",
    { id: s.id },
  );
  if (open) throw conflict('แหล่งข้อมูลนี้กำลังดึงข้อมูลอยู่');
  const runId = await startRun(s.id, req.user.id);
  audit(req, 'scraping.run', 'scrape_source', s.id, { runId });
  res.status(202).json({ data: { runId } });
});

router.get(
  '/runs',
  requirePermission('scraping:read'),
  validate({ query: z.object({ sourceId: z.coerce.number().int().positive().optional() }) }),
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
    trendScore: n(t.trend_score),
    status: t.status,
    importedProductId: t.imported_product_id,
    affiliateLinkId: t.affiliate_link_id,
    affiliateUrl: t.affiliate_url ?? null,
    hasAnalysis: t.ai_analysis != null,
    aiAnalyzedAt: t.ai_analyzed_at,
    firstSeenAt: t.first_seen_at,
    lastSeenAt: t.last_seen_at,
  };
}

const SORTS = {
  score: ['t.trend_score', 'DESC'],
  velocity: ['t.sold_velocity', 'DESC'],
  sold: ['t.sold_count', 'DESC'],
  commission: ['t.commission_rate', 'DESC'],
  price: ['t.price', 'ASC'],
  newest: ['t.first_seen_at', 'DESC'],
};

router.get(
  '/trends',
  requirePermission('scraping:read'),
  validate({
    query: z.object({
      status: z.enum(['new', 'watching', 'imported', 'ignored', 'active', 'all']).default('active'),
      platform: z.string().trim().max(30).optional(),
      q: z.string().trim().max(100).optional(),
      sort: z.enum(['score', 'velocity', 'sold', 'commission', 'price', 'newest']).default('score'),
      minCommission: z.coerce.number().min(0).max(100).optional(),
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
      AND (:minCommission IS NULL OR t.commission_rate >= :minCommission)`;
    const params = {
      orgId: req.user.orgId,
      status: f.status,
      platform: f.platform || null,
      q: f.q ? `%${f.q}%` : null,
      minCommission: f.minCommission ?? null,
      limit: f.pageSize,
      offset: (f.page - 1) * f.pageSize,
    };
    const [rows, total, platforms] = await Promise.all([
      db.query(
        `SELECT t.*, s.name AS source_name, a.short_url AS affiliate_url FROM trending_products t
           LEFT JOIN scrape_sources s ON s.id = t.source_id LEFT JOIN affiliate_links a ON a.id = t.affiliate_link_id
          WHERE ${where} ORDER BY ${SORTS[f.sort][0]} IS NULL, ${SORTS[f.sort].join(' ')}, t.id DESC LIMIT :limit OFFSET :offset`,
        params,
      ),
      db.one(`SELECT COUNT(*) AS n FROM trending_products t WHERE ${where}`, params),
      db.query('SELECT platform, COUNT(*) AS n FROM trending_products WHERE org_id = :orgId GROUP BY platform ORDER BY n DESC', { orgId: req.user.orgId }),
    ]);
    res.json({
      data: rows.map(mapTrend),
      meta: { page: f.page, pageSize: f.pageSize, total: Number(total.n), platforms: platforms.map((p) => ({ platform: p.platform, count: Number(p.n) })) },
    });
  },
);

async function getTrend(orgId, id) {
  const t = await db.one(
    `SELECT t.*, s.name AS source_name, a.short_url AS affiliate_url FROM trending_products t
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
      aiAnalysis: parseJson(t.ai_analysis),
      snapshots: snaps.reverse().map((s) => ({ capturedAt: s.captured_at, price: n(s.price), soldCount: n(s.sold_count), rating: n(s.rating), commissionRate: n(s.commission_rate) })),
    },
  });
});

router.patch(
  '/trends/:id',
  requirePermission('scraping:run'),
  validate({ params: idParam, body: z.object({ status: z.enum(['new', 'watching', 'ignored']) }) }),
  async (req, res) => {
    const t = await getTrend(req.user.orgId, req.valid.params.id);
    if (t.status === 'imported') throw conflict('สินค้านี้นำเข้าเป็นสินค้าของร้านแล้ว');
    await db.query('UPDATE trending_products SET status = :status WHERE id = :id', { id: t.id, status: req.valid.body.status });
    res.json({ data: { ok: true } });
  },
);

/* --------------------------------------------------------------- CSV import */

router.post(
  '/trends/import-csv',
  requirePermission('scraping:run'),
  validate({
    body: z.object({
      csv: z.string().min(1).max(2 * 1024 * 1024, 'ไฟล์ใหญ่เกิน 2 MB'),
      platform: z.enum(['shopee', 'tiktok_shop', 'lazada', 'other']),
      mapping: z.partialRecord(z.enum(FIELDS), z.number().int().min(0)).optional(),
      preview: z.boolean().default(false),
    }),
  }),
  async (req, res) => {
    const b = req.valid.body;
    const parsed = csvToItems(b.csv, { platform: b.platform, mapping: b.mapping });
    if (b.preview) {
      return res.json({
        data: { header: parsed.header, mapping: parsed.mapping, rows: parsed.items.slice(0, 10), total: parsed.items.length, errors: parsed.errors.slice(0, 20) },
      });
    }
    if (!parsed.items.length) throw badRequest(parsed.errors[0]?.message ?? 'ไม่พบข้อมูลที่นำเข้าได้', { errors: parsed.errors.slice(0, 20) });
    if (parsed.items.length > 2000) throw badRequest('นำเข้าได้ครั้งละไม่เกิน 2,000 แถว');
    const stats = await upsertItems({ orgId: req.user.orgId, items: parsed.items });
    audit(req, 'scraping.import_csv', 'trending_product', null, { platform: b.platform, ...stats });
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
    fitScore: { type: 'integer', minimum: 0, maximum: 10, description: 'ความเหมาะที่ร้านจะขาย/ทำคอนเทนต์ 0-10' },
    verdict: str('สรุป 1-2 ประโยคว่าควรทำหรือไม่ เพราะอะไร'),
    targetAudience: str('กลุ่มลูกค้าเป้าหมาย'),
    sellingPoints: { type: 'array', items: { type: 'string' }, description: 'จุดขาย 3-5 ข้อ สั้นๆ' },
    videoHooks: { type: 'array', items: { type: 'string' }, description: 'ประโยคเปิดคลิปสั้น 9:16 ใน 3 วินาทีแรก 3 แบบ' },
    contentAngle: str('มุมการเล่าเรื่องในคลิปรีวิวที่แนะนำ'),
    risks: { type: 'array', items: { type: 'string' }, description: 'ความเสี่ยง เช่น ของปลอม ข้อห้ามโฆษณา (อย./สคบ.) การเคลมเกินจริง การแข่งขันราคา' },
    suggestedPrice: { type: ['number', 'null'], description: 'ราคาขายที่แนะนำ (บาท) หรือ null ถ้าข้อมูลไม่พอ' },
  },
};

const ANALYSIS_SYSTEM = `คุณเป็นนักวิเคราะห์สินค้าและนักการตลาดออนไลน์ในไทย (TikTok/Shopee)
ประเมินสินค้าเทรนด์ว่าร้านควรนำมาขายหรือทำคลิปรีวิว affiliate หรือไม่ จากข้อมูลที่ให้เท่านั้น
- อย่าแต่งตัวเลขที่ไม่มีในข้อมูล ถ้าข้อมูลไม่พอให้บอกในคำตัดสิน
- ความเร็วยอดขาย (ชิ้น/วัน) สำคัญกว่ายอดขายสะสม
- ระบุความเสี่ยงด้านกฎหมายโฆษณาไทย (เครื่องสำอาง อาหารเสริม เครื่องมือแพทย์ ต้องระวังคำเคลม) อย่างตรงไปตรงมา
- เขียนภาษาไทย กระชับ`;

router.post('/trends/:id/analyze', requirePermission('scraping:run'), validate({ params: idParam, body: z.object({ refresh: z.boolean().default(false) }).default({}) }), async (req, res) => {
  const t = await getTrend(req.user.orgId, req.valid.params.id);
  if (t.ai_analysis && !req.valid.body.refresh) return res.json({ data: { analysis: parseJson(t.ai_analysis), cached: true } });
  ai.requireConfig();
  const [org, categories] = await Promise.all([
    db.one('SELECT name FROM organizations WHERE id = :id', { id: req.user.orgId }),
    db.query('SELECT name FROM product_categories WHERE org_id = :orgId ORDER BY name LIMIT 30', { orgId: req.user.orgId }),
  ]);
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
  };
  const { data, model, provider } = await ai.extractStructured({
    system: ANALYSIS_SYSTEM,
    schema: ANALYSIS_SCHEMA,
    toolName: 'submit_analysis',
    toolDescription: 'ส่งผลการวิเคราะห์สินค้า',
    maxTokens: 3000,
    content: [
      {
        type: 'text',
        text: `ร้าน: ${org.name}\nหมวดสินค้าที่ร้านขายอยู่: ${categories.map((c) => c.name).join(', ') || '-'}\n\nข้อมูลสินค้า:\n${JSON.stringify(facts, null, 2)}`,
      },
    ],
  });
  const analysis = { ...data, fitScore: Math.max(0, Math.min(10, Math.round(Number(data.fitScore) || 0))), model, provider };
  await db.query('UPDATE trending_products SET ai_analysis = :a, ai_analyzed_at = UTC_TIMESTAMP() WHERE id = :id', { id: t.id, a: JSON.stringify(analysis) });
  audit(req, 'scraping.analyze', 'trending_product', t.id, { provider, model });
  return res.json({ data: { analysis, cached: false } });
});

/* -------------------------------------------------- import / affiliate link */

router.post(
  '/trends/:id/import-product',
  requirePermission('products:write'),
  validate({ params: idParam, body: z.object({ price: z.coerce.number().min(0).max(9_999_999).optional() }).default({}) }),
  async (req, res) => {
    const t = await getTrend(req.user.orgId, req.valid.params.id);
    if (t.imported_product_id) throw conflict('นำเข้าเป็นสินค้าแล้ว');
    const a = parseJson(t.ai_analysis);
    const price = req.valid.body.price ?? a?.suggestedPrice ?? n(t.price) ?? 0;
    const productId = await db.tx(async (conn) => {
      const [ins] = await conn.query(
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
      ).catch((err) => {
        if (err.code === 'ER_DUP_ENTRY') throw conflict(`มีสินค้ารหัส TR-${t.id} อยู่แล้ว`);
        throw err;
      });
      await conn.query("UPDATE trending_products SET status = 'imported', imported_product_id = :pid WHERE id = :id", { id: t.id, pid: ins.insertId });
      return ins.insertId;
    });
    audit(req, 'scraping.import_product', 'product', productId, { trendId: t.id });
    res.status(201).json({ data: { productId } });
  },
);

router.post(
  '/trends/:id/affiliate-link',
  requirePermission('scraping:run'),
  validate({ params: idParam, body: z.object({ subId: z.string().trim().regex(/^[A-Za-z0-9]{0,50}$/, 'sub id ใช้ได้เฉพาะ a-z, 0-9').optional() }).default({}) }),
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
      { orgId: req.user.orgId, productId: t.imported_product_id, url: t.url.slice(0, 1000), shortUrl, subId },
    );
    await db.query('UPDATE trending_products SET affiliate_link_id = :aid WHERE id = :id', { id: t.id, aid: r.insertId });
    audit(req, 'scraping.affiliate_link', 'affiliate_link', r.insertId, { trendId: t.id });
    res.status(201).json({ data: { id: r.insertId, shortUrl, subId } });
  },
);

module.exports = { router, ANALYSIS_SCHEMA };
