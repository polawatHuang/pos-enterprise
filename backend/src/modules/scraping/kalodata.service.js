'use strict';

const db = require('../../db/pool');
const logger = require('../../core/logger');
const { conflict, badRequest } = require('../../core/errors');
const { enqueue } = require('../../jobs/queue');
const kalodata = require('../../integrations/kalodata');
const { upsertItems, rescore } = require('./trends.service');

/**
 * Monthly pull of TikTok Shop Thailand market data from Kalodata (the "standard" depth, ~25–40 credits):
 *   1. category ranking, levels 1–3 with parents (level 3 only under the top level-2 categories).
 *      Kalodata's category endpoints only take rolling windows (last7Day…last365Day), not a calendar
 *      month, so categories are the last 30 days at pull time, stored under the month being pulled
 *      (the pull runs early in the next month, so that is about the same window)
 *   2. channel split + daily trend of each level-1 category
 *   3. best sellers of the top level-2 categories, then market-wide risers, new launches and
 *      high-commission affiliate products
 *   4. product detail (creators, videos, category, reviews) for the best candidates
 * A run is a list of small tasks kept in scrape_runs.state; each queued step works for a short while
 * and re-queues itself, so shared hosting (45 s cron ticks) never hits a timeout mid-pull.
 */

const SETTINGS_KEY = 'trends.kalodata';
const DEFAULTS = { enabled: false, dayOfMonth: 2, lastPeriod: null };
const PLATFORM = 'kalodata';
const TOP_L2 = 60; // level-2 categories that get their own product list and level-3 breakdown
const PRODUCTS_PER_L2 = 50;
const DETAIL_PRODUCTS = 100;
/** Category rank/detail accept only last7Day/last30Day/last90Day/last180Day/last365Day. */
const CATEGORY_RANGE = 'last30Day';
const MIN_CREDITS = 40;
const STEP_BUDGET_MS = 25_000;
const TASK_RETRIES = 2;
const EST_CREDITS = 30;
/** Steps that, when they keep failing, fail the whole pull (instead of being skipped with a warning). */
const CRITICAL = new Set(['balance', 'cat1', 'plan2', 'planDetails']);

const parse = (v) => (v == null ? null : typeof v === 'string' ? JSON.parse(v) : v);
const num = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));

/* --------------------------------------------------------------- settings */

async function getSettings(orgId) {
  const row = await db.one('SELECT value FROM settings WHERE org_id = :orgId AND setting_key = :k', { orgId, k: SETTINGS_KEY });
  const v = parse(row?.value);
  return { ...DEFAULTS, ...(v && typeof v === 'object' ? v : {}) };
}

async function saveSettings(orgId, patch) {
  const next = { ...(await getSettings(orgId)), ...patch };
  await db.query(
    `INSERT INTO settings (org_id, setting_key, value) VALUES (:orgId, :k, :v) ON DUPLICATE KEY UPDATE value = VALUES(value)`,
    { orgId, k: SETTINGS_KEY, v: JSON.stringify(next) },
  );
  return next;
}

/** Bangkok calendar: the month that just ended is the one to pull. */
function bangkokToday(now = new Date()) {
  const d = new Date(now.getTime() + 7 * 3600_000);
  return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, day: d.getUTCDate() };
}
const pad = (n) => String(n).padStart(2, '0');
function shiftPeriod(period, months) {
  const [y, m] = period.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + months, 1));
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`;
}
function lastFullMonth(now) {
  const { y, m } = bangkokToday(now);
  return shiftPeriod(`${y}-${pad(m)}`, -1);
}

async function ensureSource(orgId) {
  const s = await db.one("SELECT id FROM scrape_sources WHERE org_id = :orgId AND platform = 'kalodata' ORDER BY id LIMIT 1", { orgId });
  if (s) return s.id;
  const r = await db.query(
    `INSERT INTO scrape_sources (org_id, platform, method, name, config, interval_hours, is_active)
     VALUES (:orgId, 'kalodata', 'official_api', 'Kalodata · TikTok Shop ไทย (รายเดือน)', :config, NULL, 1)`,
    { orgId, config: JSON.stringify({ region: 'TH' }) },
  );
  return r.insertId;
}

/* -------------------------------------------------------------------- runs */

async function openRun(orgId) {
  return db.one(
    `SELECT r.id FROM scrape_runs r JOIN scrape_sources s ON s.id = r.source_id
      WHERE s.org_id = :orgId AND s.platform = 'kalodata' AND r.status = 'running' AND r.started_at > UTC_TIMESTAMP() - INTERVAL 6 HOUR LIMIT 1`,
    { orgId },
  );
}

/** Start a pull for `period` (default: last full month). Returns the run id. */
async function startMonthly(orgId, { period = null, userId = null } = {}) {
  kalodata.requireConfig();
  const p = period ?? lastFullMonth();
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(p)) throw badRequest('เดือนต้องเป็น YYYY-MM');
  if (p > lastFullMonth()) throw badRequest('ดึงได้เฉพาะเดือนที่จบแล้ว');
  if (await openRun(orgId)) throw conflict('กำลังดึงข้อมูล Kalodata อยู่ รอให้เสร็จก่อน');
  const sourceId = await ensureSource(orgId);
  const state = { period: p, tasks: [{ t: 'balance' }], credits: 0, counts: { categories: 0, products: 0, details: 0 }, warnings: [] };
  const r = await db.query(
    "INSERT INTO scrape_runs (source_id, status, stage, triggered_by, state) VALUES (:sourceId, 'running', 'balance', :userId, :state)",
    { sourceId, userId, state: JSON.stringify(state) },
  );
  await enqueue('kalodata.step', { runId: r.insertId }, { orgId, maxAttempts: 3 });
  return r.insertId;
}

/** Cron tick: start this month's pull for every org that turned it on, once it is due. */
async function scheduleMonthly(now = new Date()) {
  if (!kalodata.isConfigured()) return 0;
  const rows = await db.query("SELECT org_id, value FROM settings WHERE setting_key = :k", { k: SETTINGS_KEY });
  const { day } = bangkokToday(now);
  const period = lastFullMonth(now);
  let started = 0;
  for (const row of rows) {
    const s = { ...DEFAULTS, ...(parse(row.value) ?? {}) };
    if (!s.enabled || day < s.dayOfMonth || s.lastPeriod === period) continue;
    if (await openRun(row.org_id)) continue;
    // a failed attempt waits a day before the next try, so a bad key or empty wallet does not loop
    const failed = await db.one(
      `SELECT r.id FROM scrape_runs r JOIN scrape_sources s ON s.id = r.source_id
        WHERE s.org_id = :orgId AND s.platform = 'kalodata' AND r.status = 'failed' AND r.triggered_by IS NULL
          AND r.started_at > UTC_TIMESTAMP() - INTERVAL 1 DAY LIMIT 1`,
      { orgId: row.org_id },
    );
    if (failed) continue;
    try {
      await startMonthly(row.org_id, { period });
      started += 1;
    } catch (err) {
      logger.warn({ err, orgId: row.org_id }, 'kalodata monthly pull not started');
    }
  }
  return started;
}

/* ------------------------------------------------------------------- tasks */

async function upsertCategories(orgId, period, level, rows, parentId = null) {
  for (const c of rows ?? []) {
    if (!c?.category_id) continue;
    await db.query(
      `INSERT INTO trend_categories (org_id, period, category_id, parent_id, level, name, rank_no, revenue, sale, growth_rate, top3_shop_ratio, avg_shop_revenue)
       VALUES (:orgId, :period, :id, :parent, :level, :name, :rank, :revenue, :sale, :growth, :top3, :avg)
       ON DUPLICATE KEY UPDATE parent_id = COALESCE(VALUES(parent_id), parent_id), level = VALUES(level), name = VALUES(name),
         rank_no = VALUES(rank_no), revenue = VALUES(revenue), sale = VALUES(sale), growth_rate = VALUES(growth_rate),
         top3_shop_ratio = VALUES(top3_shop_ratio), avg_shop_revenue = VALUES(avg_shop_revenue)`,
      {
        orgId,
        period,
        id: String(c.category_id),
        // history months carry no parents: reuse the mapping learnt for any month
        parent: parentId ?? (await db.one('SELECT parent_id FROM trend_categories WHERE org_id = :orgId AND category_id = :id AND parent_id IS NOT NULL LIMIT 1', { orgId, id: String(c.category_id) }))?.parent_id ?? null,
        level,
        name: String(c.category_name ?? c.category_id).slice(0, 191),
        rank: num(c.rank),
        revenue: num(c.revenue),
        sale: num(c.sale),
        growth: num(c.revenue_growth_rate),
        top3: num(c.top3_shop_revenue_ratio),
        avg: num(c.average_revenue),
      },
    );
  }
  return rows?.length ?? 0;
}

/** Units in the month before: our own history first, else back-worked from the growth rate. */
async function prevSales(trendId, period, sales, growth) {
  if (trendId) {
    const r = await db.one('SELECT sales FROM trend_product_months WHERE trending_product_id = :id AND period = :p', { id: trendId, p: shiftPeriod(period, -1) });
    if (r?.sales != null) return Number(r.sales);
  }
  if (sales != null && growth != null && growth > -100) return Math.round(sales / (1 + growth / 100));
  return null;
}

/** Store a product list (rank rows) as trend items, with their Kalodata fields and month history. */
async function saveProducts(orgId, sourceId, period, rows, { l2 = null, rankBase = 0 } = {}) {
  const list = (rows ?? []).filter((r) => r?.product_id && r?.product_name);
  if (!list.length) return [];
  const existing = new Map(
    (
      await db.query("SELECT id, external_id FROM trending_products WHERE org_id = :orgId AND platform = 'kalodata' AND external_id IN (:ids)", {
        orgId,
        ids: list.map((r) => String(r.product_id)),
      })
    ).map((r) => [r.external_id, r.id]),
  );
  const items = [];
  for (const [i, r] of list.entries()) {
    const sales = num(r.sales_volumn);
    items.push({
      platform: PLATFORM,
      externalId: String(r.product_id),
      title: r.product_name,
      url: `https://shop.tiktok.com/view/product/${r.product_id}?region=TH`,
      imageUrl: r.master_image_url || null,
      shopName: r.seller_name || null,
      price: num(r.unit_price),
      soldCount: sales,
      monthlySold: sales,
      prevMonthlySold: await prevSales(existing.get(String(r.product_id)), period, sales, num(r.revenue_growth_rate)),
      commissionRate: num(r.commission_rate),
      category: l2?.name ?? null,
      categoryRank: l2 ? rankBase + i + 1 : null,
      raw: { kalodata: r, period },
    });
  }
  await upsertItems({ orgId, sourceId, items });
  const ids = await db.query("SELECT id, external_id FROM trending_products WHERE org_id = :orgId AND platform = 'kalodata' AND external_id IN (:ids)", {
    orgId,
    ids: list.map((r) => String(r.product_id)),
  });
  const idOf = new Map(ids.map((r) => [r.external_id, r.id]));
  for (const [i, r] of list.entries()) {
    const id = idOf.get(String(r.product_id));
    if (!id) continue;
    const split = { video: num(r.video_revenue), live: num(r.live_revenue), showcase: num(r.showcase_revenue) };
    await db.query(
      `UPDATE trending_products SET kalo_category_id = COALESCE(:cat, kalo_category_id), revenue = :revenue, revenue_growth_rate = :growth,
              launch_date = COALESCE(:launch, launch_date), channel_split = :split WHERE id = :id`,
      { id, cat: l2?.id ?? null, revenue: num(r.revenue), growth: num(r.revenue_growth_rate), launch: /^\d{4}-\d{2}-\d{2}/.test(r.launch_date ?? '') ? r.launch_date.slice(0, 10) : null, split: JSON.stringify(split) },
    );
    await db.query(
      `INSERT INTO trend_product_months (trending_product_id, period, revenue, sales, growth_rate, unit_price, commission_rate, live_revenue, video_revenue, showcase_revenue, rank_in_category)
       VALUES (:id, :period, :revenue, :sales, :growth, :price, :commission, :live, :video, :showcase, :rank)
       ON DUPLICATE KEY UPDATE revenue = VALUES(revenue), sales = VALUES(sales), growth_rate = VALUES(growth_rate), unit_price = VALUES(unit_price),
         commission_rate = VALUES(commission_rate), live_revenue = VALUES(live_revenue), video_revenue = VALUES(video_revenue),
         showcase_revenue = VALUES(showcase_revenue), rank_in_category = COALESCE(VALUES(rank_in_category), rank_in_category)`,
      {
        id,
        period,
        revenue: num(r.revenue),
        sales: num(r.sales_volumn),
        growth: num(r.revenue_growth_rate),
        price: num(r.unit_price),
        commission: num(r.commission_rate),
        live: split.live,
        video: split.video,
        showcase: split.showcase,
        rank: l2 ? rankBase + i + 1 : null,
      },
    );
  }
  return [...idOf.values()];
}

/** Product detail → creators, videos, reviews, category, channel split; also kept as the 'detail' extra. */
async function applyDetail(orgId, trendId, period, d, credits = 0) {
  if (!d) return;
  const l2 = d.sec_cate_id ? await db.one('SELECT category_id, name FROM trend_categories WHERE org_id = :orgId AND category_id = :id ORDER BY period DESC LIMIT 1', { orgId, id: String(d.sec_cate_id) }) : null;
  await db.query(
    `UPDATE trending_products SET creator_count = :creators, video_count = :videos, live_count = :lives, review_count = COALESCE(:reviews, review_count),
            kalo_leaf_id = COALESCE(:leaf, kalo_leaf_id), kalo_category_id = COALESCE(kalo_category_id, :l2),
            category = COALESCE(category, :l2name), launch_date = COALESCE(:launch, launch_date),
            channel_split = JSON_SET(COALESCE(channel_split, JSON_OBJECT()), '$.video', :video, '$.live', :live, '$.mall', :mall),
            image_url = COALESCE(image_url, :image) WHERE id = :id`,
    {
      id: trendId,
      creators: num(d.creator_number),
      videos: num(d.video_number),
      lives: num(d.live_number),
      reviews: num(d.product_review_count),
      leaf: d.ter_cate_id ? String(d.ter_cate_id) : null,
      l2: l2?.category_id ?? null,
      l2name: l2?.name ?? null,
      launch: /^\d{4}-\d{2}-\d{2}/.test(d.launch_date ?? '') ? d.launch_date.slice(0, 10) : null,
      video: num(d.video_revenue),
      live: num(d.live_revenue),
      mall: num(d.shopping_mall_revenue),
      image: d.master_image_url || null,
    },
  );
  await saveExtra(trendId, 'detail', { ...d, period }, credits, null);
}

async function saveExtra(trendId, kind, data, credits, userId) {
  await db.query(
    `INSERT INTO trend_product_extras (trending_product_id, kind, data, credits, fetched_by, fetched_at) VALUES (:id, :kind, :data, :credits, :userId, UTC_TIMESTAMP())
     ON DUPLICATE KEY UPDATE data = VALUES(data), credits = VALUES(credits), fetched_by = VALUES(fetched_by), fetched_at = VALUES(fetched_at)`,
    { id: trendId, kind, data: JSON.stringify(data), credits, userId },
  );
}

const rankCost = (rows) => kalodata.COST.rank(Math.max(1, rows?.length ?? 0));

/** One unit of work. Mutates `st` (pushes follow-up tasks, adds credits/counts). */
async function runTask(task, st, ctx) {
  const { orgId, sourceId } = ctx;
  const P = st.period;
  switch (task.t) {
    case 'balance': {
      const b = await kalodata.balance();
      st.balanceStart = num(b?.totalRemain);
      if (st.balanceStart != null && st.balanceStart < MIN_CREDITS) {
        throw Object.assign(new Error(`เครดิต Kalodata เหลือ ${st.balanceStart} ไม่พอ (ต้องมีอย่างน้อย ${MIN_CREDITS}) — เติมเครดิตแล้วกดดึงใหม่`), { fatal: true });
      }
      st.tasks.push({ t: 'cat1' });
      return 'categories';
    }
    case 'cat1': {
      const rows = await kalodata.categoryRank({ date_range: CATEGORY_RANGE, category_level: 1 });
      st.credits += rankCost(rows);
      st.counts.categories += await upsertCategories(orgId, P, 1, rows);
      for (const c of rows ?? []) st.tasks.push({ t: 'cat2', id: String(c.category_id) });
      st.tasks.push({ t: 'plan2' });
      for (const c of rows ?? []) st.tasks.push({ t: 'catDetail', id: String(c.category_id) });
      return 'categories';
    }
    case 'cat2': {
      const rows = await kalodata.categoryRank({ date_range: CATEGORY_RANGE, category_level: 2, category_ids: [task.id] });
      st.credits += rankCost(rows);
      st.counts.categories += await upsertCategories(orgId, P, 2, rows, task.id);
      return 'categories';
    }
    case 'plan2': {
      const top = await db.query(
        'SELECT category_id, name FROM trend_categories WHERE org_id = :orgId AND period = :p AND level = 2 ORDER BY revenue DESC LIMIT :n',
        { orgId, p: P, n: TOP_L2 },
      );
      for (const c of top) st.tasks.push({ t: 'cat3', id: c.category_id });
      for (const c of top) st.tasks.push({ t: 'products', id: c.category_id, name: c.name });
      st.tasks.push({ t: 'special', kind: 'rising' }, { t: 'special', kind: 'new' }, { t: 'special', kind: 'commission' }, { t: 'planDetails' });
      return 'categories';
    }
    case 'cat3': {
      const rows = await kalodata.categoryRank({ date_range: CATEGORY_RANGE, category_level: 3, category_ids: [task.id] });
      st.credits += rankCost(rows);
      st.counts.categories += await upsertCategories(orgId, P, 3, rows, task.id);
      return 'categories';
    }
    case 'catDetail': {
      const d = await kalodata.categoryDetail(task.id, CATEGORY_RANGE);
      st.credits += kalodata.COST.detail;
      if (d) {
        await db.query(
          `UPDATE trend_categories SET shop_number = :shops, active_products = :products, live_revenue = :live, video_revenue = :video,
                  mall_revenue = :mall, affiliate_revenue = :aff, self_revenue = :self, revenue_trend = :trend,
                  avg_shop_revenue = COALESCE(avg_shop_revenue, :avg)
            WHERE org_id = :orgId AND period = :p AND category_id = :id`,
          {
            orgId,
            p: P,
            id: task.id,
            shops: num(d.shop_number),
            products: num(d.active_product_number),
            live: num(d.live_revenue),
            video: num(d.video_revenue),
            mall: num(d.shopping_mall_revenue),
            aff: num(d.affiliate_revenue),
            self: num(d.self_operate_revenue),
            trend: JSON.stringify(Array.isArray(d.revenue_trend) ? d.revenue_trend.map(num) : []),
            avg: num(d.average_shop_revenue),
          },
        );
      }
      return 'categories';
    }
    case 'products': {
      const rows = await kalodata.productRank({ date_range: P, category_ids: [task.id], page_size: PRODUCTS_PER_L2 });
      st.credits += rankCost(rows);
      const ids = await saveProducts(orgId, sourceId, P, rows, { l2: { id: task.id, name: task.name } });
      st.counts.products += ids.length;
      return 'products';
    }
    case 'special': {
      const body = {
        rising: { sort_field: { field: 'revenue_growth_rate', type: 'DESC' }, revenue_range: '>20000' },
        new: { launch_date: '<30' },
        commission: { is_affiliate: 1, commission_rate: '>=15' },
      }[task.kind];
      const rows = await kalodata.productRank({ date_range: P, page_size: 100, ...body });
      st.credits += rankCost(rows);
      const ids = await saveProducts(orgId, sourceId, P, rows);
      st.counts.products += ids.length;
      return 'products';
    }
    case 'planDetails': {
      // products without a category first (risers/new launches), then the best picks
      const rows = await db.query(
        `SELECT t.id, t.external_id FROM trending_products t
           LEFT JOIN trend_product_extras x ON x.trending_product_id = t.id AND x.kind = 'detail' AND x.fetched_at > UTC_TIMESTAMP() - INTERVAL 20 DAY
          WHERE t.org_id = :orgId AND t.platform = 'kalodata' AND t.last_seen_at > UTC_TIMESTAMP() - INTERVAL 1 DAY AND x.trending_product_id IS NULL
            AND t.status <> 'ignored'
          ORDER BY t.kalo_category_id IS NULL DESC, t.pick_score DESC, t.revenue DESC LIMIT :n`,
        { orgId, n: DETAIL_PRODUCTS },
      );
      for (const r of rows) st.tasks.push({ t: 'detail', id: r.id, pid: r.external_id });
      st.tasks.push({ t: 'finish' });
      return 'details';
    }
    case 'detail': {
      const d = await kalodata.productDetail(task.pid, P);
      st.credits += kalodata.COST.detail;
      await applyDetail(orgId, task.id, P, d, kalodata.COST.detail);
      await db.tx((conn) => rescore(conn, task.id));
      st.counts.details += 1;
      return 'details';
    }
    case 'finish': {
      try {
        const b = await kalodata.balance();
        st.balanceEnd = num(b?.totalRemain);
      } catch {
        /* the pull itself succeeded */
      }
      return 'finish';
    }
    default:
      return null;
  }
}

/** Job handler: work through the run's tasks for a while, then re-queue (or finish). */
async function step({ runId }) {
  const run = await db.one(
    `SELECT r.*, s.org_id, s.id AS sid FROM scrape_runs r JOIN scrape_sources s ON s.id = r.source_id WHERE r.id = :id`,
    { id: runId },
  );
  if (!run || run.status !== 'running') return { skipped: true };
  const st = parse(run.state);
  const ctx = { orgId: run.org_id, sourceId: run.sid };
  const started = Date.now();
  let stage = run.stage;
  try {
    while (st.tasks.length && Date.now() - started < STEP_BUDGET_MS) {
      const task = st.tasks[0];
      try {
        stage = (await runTask(task, st, ctx)) ?? stage;
        st.tasks.shift();
      } catch (err) {
        if (err.fatal || err.status === 402 || err.code === 'KALODATA_AUTH' || err.code === 'INTEGRATION_NOT_CONFIGURED') throw err;
        task.tries = (task.tries ?? 0) + 1;
        if (task.tries > TASK_RETRIES) {
          // without these the rest of the pull has nothing to work from
          if (CRITICAL.has(task.t)) throw err;
          st.warnings.push(`${task.t}${task.id ? ` ${task.id}` : ''}: ${err.message}`.slice(0, 200));
          st.tasks.shift();
        } else await new Promise((r) => setTimeout(r, err.status === 429 ? 5_000 : 1_500));
      }
      await db.query('UPDATE scrape_runs SET state = :state, stage = :stage, items_found = :found WHERE id = :id', {
        id: runId,
        state: JSON.stringify(st),
        stage,
        found: st.counts.products,
      });
    }
  } catch (err) {
    st.warnings = st.warnings.slice(-20);
    await db.query("UPDATE scrape_runs SET status = 'failed', error = :error, state = :state, finished_at = UTC_TIMESTAMP() WHERE id = :id", {
      id: runId,
      error: String(err.message).slice(0, 1000),
      state: JSON.stringify({ ...st, tasks: [] }),
    });
    await db.query('UPDATE scrape_sources SET last_error = :e WHERE id = :id', { id: run.sid, e: String(err.message).slice(0, 1000) });
    return { failed: err.message };
  }
  if (!st.tasks.length && st.counts.categories === 0) {
    const msg = 'ไม่ได้ข้อมูลหมวดหมู่จาก Kalodata เลย — ตรวจคีย์และแพ็กเกจข้อมูลประเทศไทย';
    await db.query("UPDATE scrape_runs SET status = 'failed', error = :error, finished_at = UTC_TIMESTAMP() WHERE id = :id", { id: runId, error: msg });
    await db.query('UPDATE scrape_sources SET last_error = :e WHERE id = :id', { id: run.sid, e: msg });
    return { failed: msg };
  }
  if (st.tasks.length) {
    await enqueue('kalodata.step', { runId }, { orgId: run.org_id, maxAttempts: 3 });
    return { remaining: st.tasks.length };
  }
  const created = await db.one('SELECT COUNT(*) AS n FROM trending_products WHERE source_id = :sid AND first_seen_at >= :since', { sid: run.sid, since: run.started_at });
  await db.query(
    "UPDATE scrape_runs SET status = 'succeeded', stage = 'done', items_found = :found, items_new = :created, finished_at = UTC_TIMESTAMP(), state = :state WHERE id = :id",
    { id: runId, found: st.counts.products, created: Number(created.n), state: JSON.stringify({ ...st, warnings: st.warnings.slice(-20) }) },
  );
  await db.query('UPDATE scrape_sources SET last_run_at = UTC_TIMESTAMP(), last_error = NULL WHERE id = :id', { id: run.sid });
  const s = await getSettings(run.org_id);
  if (!s.lastPeriod || st.period >= s.lastPeriod) await saveSettings(run.org_id, { lastPeriod: st.period });
  return { done: true, credits: st.credits };
}

/* --------------------------------------------------- on-demand per product */

const EXTRA_TTL_DAYS = 14;
const EXTRA_COST = { detail: 0.1, analysis: 0.1, comments: 1, videos: 0.1, creators: 0.1 };

async function getExtras(trendId) {
  const rows = await db.query('SELECT kind, data, credits, fetched_at FROM trend_product_extras WHERE trending_product_id = :id', { id: trendId });
  return Object.fromEntries(rows.map((r) => [r.kind, { data: parse(r.data), credits: Number(r.credits), fetchedAt: r.fetched_at }]));
}

/** Fetch one kind of extra data for a product; a copy younger than 14 days is returned free. */
async function fetchExtra(orgId, trend, kind, userId) {
  if (trend.platform !== 'kalodata') throw badRequest('ข้อมูลเชิงลึกจาก Kalodata ใช้ได้กับสินค้าที่มาจาก Kalodata เท่านั้น');
  const cached = await db.one(
    `SELECT data, fetched_at FROM trend_product_extras WHERE trending_product_id = :id AND kind = :kind AND fetched_at > UTC_TIMESTAMP() - INTERVAL ${EXTRA_TTL_DAYS} DAY`,
    { id: trend.id, kind },
  );
  if (cached) return { data: parse(cached.data), fetchedAt: cached.fetched_at, cached: true, credits: 0 };
  const pid = trend.external_id;
  const period = (await getSettings(orgId)).lastPeriod ?? 'last30Day';
  let data;
  if (kind === 'detail') {
    data = await kalodata.productDetail(pid, period);
    await applyDetail(orgId, trend.id, period, data, EXTRA_COST.detail);
    await db.tx((conn) => rescore(conn, trend.id));
  } else if (kind === 'analysis') data = await kalodata.productAnalysis(pid);
  else if (kind === 'comments') data = await kalodata.commentInsight(pid);
  else if (kind === 'videos') data = await kalodata.videoRank({ product_id: pid, date_range: 'last30Day', page_size: 10 });
  else if (kind === 'creators') data = await kalodata.creatorRank({ product_id: pid, date_range: 'last30Day', page_size: 10 });
  else throw badRequest('ไม่รู้จักชนิดข้อมูล');
  if (kind !== 'detail') await saveExtra(trend.id, kind, data, EXTRA_COST[kind], userId);
  return { data, fetchedAt: new Date(), cached: false, credits: EXTRA_COST[kind] };
}

module.exports = {
  SETTINGS_KEY,
  EST_CREDITS,
  EXTRA_COST,
  EXTRA_TTL_DAYS,
  getSettings,
  saveSettings,
  ensureSource,
  startMonthly,
  scheduleMonthly,
  step,
  getExtras,
  fetchExtra,
  lastFullMonth,
  shiftPeriod,
  openRun,
};
