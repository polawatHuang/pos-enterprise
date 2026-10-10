'use strict';

/**
 * Trend score 0–100. Pure function (also used by database/tools/generate-seed.js).
 *   40  sales velocity (units/day, log scale, 2,000/day = full marks)
 *   25  total units sold (log scale, 100,000 = full marks)
 *   15  rating (3.0 → 0, 5.0 → full; unknown counts as 4.0)
 *   20  affiliate commission (20% = full marks)
 * Velocity weighs most: a product selling fast now matters more than one that sold a lot last year.
 */
const logShare = (v, max) => Math.min(1, Math.log10(1 + Math.max(0, Number(v) || 0)) / Math.log10(1 + max));
const clamp01 = (n) => Math.min(1, Math.max(0, n));

function trendScore({ velocity, soldCount, rating, commissionRate }) {
  const s =
    40 * logShare(velocity, 2000) +
    25 * logShare(soldCount, 100_000) +
    15 * clamp01(((rating == null ? 4 : Number(rating)) - 3) / 2) +
    20 * clamp01((Number(commissionRate) || 0) / 20);
  return Math.round(s * 100) / 100;
}

/**
 * Units/day between the newest snapshot and the latest one at least `minHours` older.
 * @param {{capturedAt: Date|string, soldCount: number|null}[]} snaps newest first
 */
function soldVelocity(snaps, minHours = 20) {
  const [latest, ...rest] = snaps.filter((s) => s.soldCount != null);
  if (!latest) return null;
  const t0 = new Date(latest.capturedAt).getTime();
  const base = rest.find((s) => t0 - new Date(s.capturedAt).getTime() >= minHours * 3600_000);
  if (!base) return null;
  const days = (t0 - new Date(base.capturedAt).getTime()) / 86_400_000;
  return Math.max(0, Math.round(((latest.soldCount - base.soldCount) / days) * 100) / 100);
}

module.exports = { trendScore, soldVelocity };
