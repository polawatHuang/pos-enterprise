'use strict';

const crypto = require('node:crypto');
const db = require('../../db/pool');
const { trendScore, soldVelocity } = require('./score');
const { velocitySeries, estimatePhase, evaluateChecklist, pickScore } = require('./lifecycle');
const { selectScore } = require('./select-score');

/** A snapshot newer than this is overwritten instead of adding a row (re-runs within the hour). */
const SNAPSHOT_MERGE_MINUTES = 60;

const num = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const pct = (v) => (num(v) != null && num(v) >= 0 && num(v) <= 100 ? num(v) : null);
const count = (v) => (num(v) != null ? Math.max(0, Math.round(num(v))) : null);
const bool = (v) => {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'boolean') return v;
  const s = String(v).trim().toLowerCase();
  if (['1', 'true', 'yes', 'y', 'มี', 'ใช่', '✓'].includes(s)) return true;
  if (['0', 'false', 'no', 'n', 'ไม่มี', 'ไม่', '-'].includes(s)) return false;
  return null;
};
const json = (v) => (v == null ? null : typeof v === 'string' ? JSON.parse(v) : v);
/** Auto benchmark needs a few items in the category, else one product would be its own "peak". */
const MIN_ITEMS_FOR_AUTO_PEAK = 3;
const cut = (v, len) => (v == null || v === '' ? null : String(v).trim().slice(0, len) || null);

/**
 * Validate and clamp an item from any source into the stored shape. Returns null when unusable.
 * @param {object} it {platform, externalId?, title, url?, imageUrl?, shopName?, price?, soldCount?, rating?, commissionRate?, category?, raw?,
 *   categoryRank?, monthlySold?, prevMonthlySold?, reviewCount?, mediaReviewCount?, positiveReviewPct?, shopRating?,
 *   shopResponseRate?, shopShip48Rate?, hasFlashSale?}
 */
function normalizeItem(it) {
  const title = cut(it.title, 500);
  if (!title) return null;
  const platform = cut(it.platform, 30) ?? 'other';
  const shopName = cut(it.shopName, 191);
  const externalId =
    cut(it.externalId, 191) ??
    `h_${crypto
      .createHash('sha1')
      .update(`${title}|${shopName ?? ''}`)
      .digest('hex')
      .slice(0, 20)}`;
  const rating = num(it.rating);
  const commission = num(it.commissionRate);
  const shopRating = num(it.shopRating);
  const rank = count(it.categoryRank);
  return {
    platform,
    externalId,
    title,
    url: cut(it.url, 1000),
    imageUrl: cut(it.imageUrl, 1000),
    shopName,
    price: num(it.price) != null ? Math.max(0, num(it.price)) : null,
    soldCount: num(it.soldCount) != null ? Math.max(0, Math.round(num(it.soldCount))) : null,
    rating: rating != null && rating >= 0 && rating <= 5 ? rating : null,
    commissionRate: commission != null && commission >= 0 && commission <= 100 ? commission : null,
    category: cut(it.category, 191),
    categoryRank: rank != null && rank >= 1 ? rank : null,
    monthlySold: count(it.monthlySold),
    prevMonthlySold: count(it.prevMonthlySold),
    reviewCount: count(it.reviewCount),
    mediaReviewCount: count(it.mediaReviewCount),
    positiveReviewPct: pct(it.positiveReviewPct),
    shopRating: shopRating != null && shopRating >= 0 && shopRating <= 5 ? shopRating : null,
    shopResponseRate: pct(it.shopResponseRate),
    shopShip48Rate: pct(it.shopShip48Rate),
    hasFlashSale: bool(it.hasFlashSale),
    raw: it.raw ?? null,
  };
}

/** Category peak (avg units sold of the category's #1–#2) used to place items on the lifecycle curve. */
async function getBenchmark(conn, orgId, platform, category) {
  if (!category) return null;
  const [[b]] = await conn.query(
    'SELECT peak_sold, source FROM trend_category_benchmarks WHERE org_id = :orgId AND platform = :platform AND category = :category',
    { orgId, platform, category },
  );
  return b ? { peak: Number(b.peak_sold), source: b.source } : null;
}

/** Recompute velocity, trend score, lifecycle phase, checklist and pick score from stored data. */
async function rescore(conn, trendId) {
  const [snaps] = await conn.query(
    'SELECT captured_at, sold_count FROM trending_snapshots WHERE trending_product_id = :id ORDER BY captured_at DESC LIMIT 60',
    { id: trendId },
  );
  const [[t]] = await conn.query('SELECT * FROM trending_products WHERE id = :id', { id: trendId });
  const series = snaps.map((s) => ({
    capturedAt: s.captured_at,
    soldCount: s.sold_count == null ? null : Number(s.sold_count),
  }));
  // Kalodata reports units per month, not a running total, so snapshot differences mean nothing there
  const velocity = t.platform === 'kalodata' ? (t.monthly_sold == null ? null : Math.round((Number(t.monthly_sold) / 30) * 100) / 100) : soldVelocity(series);
  const score = trendScore({
    velocity,
    soldCount: t.sold_count,
    rating: t.rating,
    commissionRate: t.commission_rate,
  });

  const n = (v) => (v == null ? null : Number(v));
  const bench = await getBenchmark(conn, t.org_id, t.platform, t.category);
  const est = estimatePhase({
    sold: n(t.sold_count),
    peak: bench?.peak ?? null,
    peakSource: bench?.source,
    monthlySold: n(t.monthly_sold),
    prevMonthlySold: n(t.prev_monthly_sold),
    velocities: velocitySeries(series),
    categoryRank: n(t.category_rank),
  });
  const checklist = evaluateChecklist(
    {
      phase: est.phase,
      rating: n(t.rating),
      positiveReviewPct: n(t.positive_review_pct),
      mediaReviewCount: n(t.media_review_count),
      shopRating: n(t.shop_rating),
      shopResponseRate: n(t.shop_response_rate),
      shopShip48Rate: n(t.shop_ship48_rate),
      commissionRate: n(t.commission_rate),
      hasFlashSale: t.has_flash_sale == null ? null : Boolean(t.has_flash_sale),
    },
    json(t.manual_checks) ?? {},
  );
  const pick = pickScore({
    phase: est.phase,
    checklist,
    categoryRank: n(t.category_rank),
  });
  let top3 = null;
  if (t.kalo_category_id) {
    const [[c]] = await conn.query(
      'SELECT top3_shop_ratio FROM trend_categories WHERE org_id = :orgId AND category_id = :cat ORDER BY period DESC LIMIT 1',
      { orgId: t.org_id, cat: t.kalo_category_id },
    );
    top3 = n(c?.top3_shop_ratio);
  }
  const growth =
    n(t.revenue_growth_rate) ??
    (n(t.monthly_sold) != null && n(t.prev_monthly_sold) > 0 ? Math.round((n(t.monthly_sold) / n(t.prev_monthly_sold) - 1) * 10000) / 100 : null);
  const select = selectScore({
    monthlySold: n(t.monthly_sold),
    categoryRank: n(t.category_rank),
    growthRate: growth,
    price: n(t.price),
    commissionRate: n(t.commission_rate),
    creatorCount: n(t.creator_count),
    top3ShopRatio: top3,
    rating: n(t.rating),
    reviewCount: n(t.review_count),
    shopRating: n(t.shop_rating),
    contentScore: n((json(t.manual_checks) ?? {}).contentScore),
    phase: est.phase,
  });
  await conn.query(
    `UPDATE trending_products SET sold_velocity = :velocity, trend_score = :score, lifecycle_phase = :phase, phase_ratio = :ratio,
        phase_notes = :notes, checklist = :checklist, checklist_passed = :passed, pick_score = :pick,
        select_score = :selectTotal, select_detail = :selectDetail WHERE id = :id`,
    {
      selectTotal: select.total,
      selectDetail: JSON.stringify(select),
      id: trendId,
      velocity,
      score,
      phase: est.phase,
      ratio: est.ratio,
      notes: JSON.stringify({
        confidence: est.confidence,
        declining: est.declining,
        reasons: est.reasons,
        peak: bench?.peak ?? null,
        peakSource: bench?.source ?? null,
      }),
      checklist: JSON.stringify(checklist.items),
      passed: checklist.passed,
      pick,
    },
  );
}

/**
 * Refresh the automatic category peak (unless a person set it) and rescore every item in the category.
 * Auto peak = average units sold of the category's top two items, per the book's method.
 */
async function recomputeCategory(conn, orgId, platform, category) {
  if (category) {
    const bench = await getBenchmark(conn, orgId, platform, category);
    if (bench?.source !== 'manual') {
      const [top] = await conn.query(
        `SELECT sold_count, (SELECT COUNT(*) FROM trending_products WHERE org_id = :orgId AND platform = :platform AND category = :category) AS n
           FROM trending_products WHERE org_id = :orgId AND platform = :platform AND category = :category AND sold_count IS NOT NULL
          ORDER BY sold_count DESC LIMIT 2`,
        { orgId, platform, category },
      );
      if (top.length && Number(top[0].n) >= MIN_ITEMS_FOR_AUTO_PEAK) {
        const peak = Math.round(top.reduce((a, r) => a + Number(r.sold_count), 0) / top.length);
        await conn.query(
          `INSERT INTO trend_category_benchmarks (org_id, platform, category, peak_sold, source) VALUES (:orgId, :platform, :category, :peak, 'auto')
           ON DUPLICATE KEY UPDATE peak_sold = IF(source = 'manual', peak_sold, VALUES(peak_sold))`,
          { orgId, platform, category, peak },
        );
      } else if (bench) {
        await conn.query("DELETE FROM trend_category_benchmarks WHERE org_id = :orgId AND platform = :platform AND category = :category AND source = 'auto'", {
          orgId,
          platform,
          category,
        });
      }
    }
  }
  const [ids] = await conn.query(
    `SELECT id FROM trending_products WHERE org_id = :orgId AND platform = :platform AND ${category ? 'category = :category' : 'category IS NULL'}`,
    { orgId, platform, category },
  );
  for (const { id } of ids) await rescore(conn, id);
}

/**
 * Insert or refresh trend items and record a snapshot for each.
 * @returns {Promise<{found:number, created:number, skipped:number}>}
 */
async function upsertItems({ orgId, sourceId = null, items }) {
  const stats = { found: 0, created: 0, skipped: 0 };
  const touched = new Map(); // "platform|category" → [platform, category]
  for (const rawItem of items) {
    const it = normalizeItem(rawItem);
    if (!it) {
      stats.skipped += 1;
      continue;
    }
    await db.tx(async (conn) => {
      // Checked up front: affectedRows cannot tell insert from no-op update when FOUND_ROWS is on
      const [[existing]] = await conn.query(
        'SELECT id FROM trending_products WHERE org_id = :orgId AND platform = :platform AND external_id = :externalId FOR UPDATE',
        { orgId, platform: it.platform, externalId: it.externalId },
      );
      const [r] = await conn.query(
        `INSERT INTO trending_products
           (org_id, source_id, platform, external_id, title, url, shop_name, image_url, price, sold_count, rating, commission_rate, category, raw,
            category_rank, monthly_sold, prev_monthly_sold, review_count, media_review_count, positive_review_pct,
            shop_rating, shop_response_rate, shop_ship48_rate, has_flash_sale)
         VALUES (:orgId, :sourceId, :platform, :externalId, :title, :url, :shopName, :imageUrl, :price, :soldCount, :rating, :commissionRate, :category, :raw,
            :categoryRank, :monthlySold, :prevMonthlySold, :reviewCount, :mediaReviewCount, :positiveReviewPct,
            :shopRating, :shopResponseRate, :shopShip48Rate, :hasFlashSale)
         ON DUPLICATE KEY UPDATE
           id = LAST_INSERT_ID(id),
           source_id = COALESCE(VALUES(source_id), source_id), title = VALUES(title),
           url = COALESCE(VALUES(url), url), shop_name = COALESCE(VALUES(shop_name), shop_name),
           image_url = COALESCE(VALUES(image_url), image_url), price = COALESCE(VALUES(price), price),
           sold_count = COALESCE(VALUES(sold_count), sold_count), rating = COALESCE(VALUES(rating), rating),
           commission_rate = COALESCE(VALUES(commission_rate), commission_rate), category = COALESCE(VALUES(category), category),
           raw = COALESCE(VALUES(raw), raw), category_rank = COALESCE(VALUES(category_rank), category_rank),
           monthly_sold = COALESCE(VALUES(monthly_sold), monthly_sold), prev_monthly_sold = COALESCE(VALUES(prev_monthly_sold), prev_monthly_sold),
           review_count = COALESCE(VALUES(review_count), review_count), media_review_count = COALESCE(VALUES(media_review_count), media_review_count),
           positive_review_pct = COALESCE(VALUES(positive_review_pct), positive_review_pct), shop_rating = COALESCE(VALUES(shop_rating), shop_rating),
           shop_response_rate = COALESCE(VALUES(shop_response_rate), shop_response_rate),
           shop_ship48_rate = COALESCE(VALUES(shop_ship48_rate), shop_ship48_rate), has_flash_sale = COALESCE(VALUES(has_flash_sale), has_flash_sale),
           last_seen_at = UTC_TIMESTAMP()`,
        {
          orgId,
          sourceId,
          ...it,
          hasFlashSale: it.hasFlashSale == null ? null : Number(it.hasFlashSale),
          raw: it.raw ? JSON.stringify(it.raw) : null,
        },
      );
      const trendId = existing?.id ?? r.insertId;
      if (!existing) stats.created += 1;
      const [[recent]] = await conn.query(
        `SELECT id FROM trending_snapshots WHERE trending_product_id = :id
            AND captured_at > UTC_TIMESTAMP() - INTERVAL ${SNAPSHOT_MERGE_MINUTES} MINUTE ORDER BY id DESC LIMIT 1`,
        { id: trendId },
      );
      const snap = {
        id: trendId,
        price: it.price,
        sold: it.soldCount,
        rating: it.rating,
        commission: it.commissionRate,
      };
      if (recent) {
        await conn.query(
          `UPDATE trending_snapshots SET captured_at = UTC_TIMESTAMP(), price = :price, sold_count = :sold, rating = :rating, commission_rate = :commission
            WHERE id = :snapId`,
          { ...snap, snapId: recent.id },
        );
      } else {
        await conn.query(
          `INSERT INTO trending_snapshots (trending_product_id, captured_at, price, sold_count, rating, commission_rate)
           VALUES (:id, UTC_TIMESTAMP(), :price, :sold, :rating, :commission)`,
          snap,
        );
      }
      // Category may come from an earlier run when this one omits it
      const [[cur]] = await conn.query('SELECT category FROM trending_products WHERE id = :id', { id: trendId });
      touched.set(`${it.platform}|${cur.category ?? ''}`, [it.platform, cur.category ?? null]);
    });
    stats.found += 1;
  }
  // Benchmarks depend on the whole category, so score once per touched category after the batch
  for (const [platform, category] of touched.values()) await db.tx((conn) => recomputeCategory(conn, orgId, platform, category));
  return stats;
}

module.exports = {
  normalizeItem,
  upsertItems,
  rescore,
  recomputeCategory,
  getBenchmark,
};
