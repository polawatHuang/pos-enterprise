'use strict';

const crypto = require('node:crypto');
const db = require('../../db/pool');
const { trendScore, soldVelocity } = require('./score');

/** A snapshot newer than this is overwritten instead of adding a row (re-runs within the hour). */
const SNAPSHOT_MERGE_MINUTES = 60;

const num = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const cut = (v, len) => (v == null || v === '' ? null : String(v).trim().slice(0, len) || null);

/**
 * Validate and clamp an item from any source into the stored shape. Returns null when unusable.
 * @param {object} it {platform, externalId?, title, url?, imageUrl?, shopName?, price?, soldCount?, rating?, commissionRate?, category?, raw?}
 */
function normalizeItem(it) {
  const title = cut(it.title, 500);
  if (!title) return null;
  const platform = cut(it.platform, 30) ?? 'other';
  const shopName = cut(it.shopName, 191);
  const externalId =
    cut(it.externalId, 191) ?? `h_${crypto.createHash('sha1').update(`${title}|${shopName ?? ''}`).digest('hex').slice(0, 20)}`;
  const rating = num(it.rating);
  const commission = num(it.commissionRate);
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
    raw: it.raw ?? null,
  };
}

/** Recompute velocity and score from the stored snapshots. */
async function rescore(conn, trendId) {
  const [snaps] = await conn.query(
    'SELECT captured_at, sold_count FROM trending_snapshots WHERE trending_product_id = :id ORDER BY captured_at DESC LIMIT 60',
    { id: trendId },
  );
  const [[t]] = await conn.query('SELECT sold_count, rating, commission_rate FROM trending_products WHERE id = :id', { id: trendId });
  const velocity = soldVelocity(snaps.map((s) => ({ capturedAt: s.captured_at, soldCount: s.sold_count == null ? null : Number(s.sold_count) })));
  const score = trendScore({ velocity, soldCount: t.sold_count, rating: t.rating, commissionRate: t.commission_rate });
  await conn.query('UPDATE trending_products SET sold_velocity = :velocity, trend_score = :score WHERE id = :id', { id: trendId, velocity, score });
}

/**
 * Insert or refresh trend items and record a snapshot for each.
 * @returns {Promise<{found:number, created:number, skipped:number}>}
 */
async function upsertItems({ orgId, sourceId = null, items }) {
  const stats = { found: 0, created: 0, skipped: 0 };
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
           (org_id, source_id, platform, external_id, title, url, shop_name, image_url, price, sold_count, rating, commission_rate, category, raw)
         VALUES (:orgId, :sourceId, :platform, :externalId, :title, :url, :shopName, :imageUrl, :price, :soldCount, :rating, :commissionRate, :category, :raw)
         ON DUPLICATE KEY UPDATE
           id = LAST_INSERT_ID(id),
           source_id = COALESCE(VALUES(source_id), source_id), title = VALUES(title),
           url = COALESCE(VALUES(url), url), shop_name = COALESCE(VALUES(shop_name), shop_name),
           image_url = COALESCE(VALUES(image_url), image_url), price = COALESCE(VALUES(price), price),
           sold_count = COALESCE(VALUES(sold_count), sold_count), rating = COALESCE(VALUES(rating), rating),
           commission_rate = COALESCE(VALUES(commission_rate), commission_rate), category = COALESCE(VALUES(category), category),
           raw = COALESCE(VALUES(raw), raw), last_seen_at = UTC_TIMESTAMP()`,
        { orgId, sourceId, ...it, raw: it.raw ? JSON.stringify(it.raw) : null },
      );
      const trendId = existing?.id ?? r.insertId;
      if (!existing) stats.created += 1;
      const [[recent]] = await conn.query(
        `SELECT id FROM trending_snapshots WHERE trending_product_id = :id
            AND captured_at > UTC_TIMESTAMP() - INTERVAL ${SNAPSHOT_MERGE_MINUTES} MINUTE ORDER BY id DESC LIMIT 1`,
        { id: trendId },
      );
      const snap = { id: trendId, price: it.price, sold: it.soldCount, rating: it.rating, commission: it.commissionRate };
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
      await rescore(conn, trendId);
    });
    stats.found += 1;
  }
  return stats;
}

module.exports = { normalizeItem, upsertItems, rescore };
