'use strict';

/**
 * Product lifecycle phase, selection checklist and "pick score" for affiliate (นายหน้า) sellers.
 * Method from the book "คู่มือทำนายหน้า TikTok ด้วย AI เดือนละ 100,000 แบบไม่ออกหน้ากล้อง"
 * (ch. 8–9), summarised in docs/PRODUCT_RESEARCH.md. Pure functions; the book stresses these are
 * rough estimates ("ไม่มีสูตรตายตัว"), so every result carries its reasons.
 *
 * Phases follow the book's bell curve: 1–5 rising, A peak, B–E declining. The sweet spot is 3
 * (2–4 acceptable): demand is building but the market is not yet crowded with competing clips.
 */

const PHASES = ['1', '2', '3', '4', '5', 'A', 'B', 'C', 'D', 'E'];

/**
 * Rising side: units sold as a share of the category peak (avg of the category's #1–#2).
 * Calibrated on the book's examples: 29k of 100k → 3 (it states 25–35% = Phase 3),
 * 11k of 200k → "2–3", 3.3k of 200k → "1–2".
 */
const RISING_BANDS = [
  { max: 5, phase: '1' },
  { max: 25, phase: '2' },
  { max: 35, phase: '3' },
  { max: 50, phase: '4' },
  { max: 80, phase: '5' },
  { max: Infinity, phase: 'A' },
];

/** Declining side: current demand as a share of the product's own best period. */
const DECLINE_BANDS = [
  { min: 0.75, phase: null }, // not declining
  { min: 0.5, phase: 'B' },
  { min: 0.25, phase: 'C' },
  { min: 0.1, phase: 'D' },
  { min: -Infinity, phase: 'E' },
];

const MIN_GAP_HOURS = 20;
const VELOCITY_WINDOW = 3;
const VELOCITY_MIN_POINTS = 4;
const SATURATED_RANK = 10; // book: avoid the category's #1–#10, pick #11 and below

/**
 * Units/day between consecutive snapshots at least MIN_GAP_HOURS apart.
 * @param {{capturedAt: Date|string, soldCount: number|null}[]} snaps any order
 */
function velocitySeries(snaps) {
  const pts = snaps
    .filter((s) => s.soldCount != null)
    .map((s) => ({
      t: new Date(s.capturedAt).getTime(),
      sold: Number(s.soldCount),
    }))
    .sort((a, b) => a.t - b.t);
  const out = [];
  let base = pts[0];
  for (const p of pts.slice(1)) {
    const hours = (p.t - base.t) / 3_600_000;
    if (hours < MIN_GAP_HOURS) continue;
    out.push(Math.max(0, (p.sold - base.sold) / (hours / 24)));
    base = p;
  }
  return out;
}

const round2 = (n) => Math.round(n * 100) / 100;
const fmt = (n) => new Intl.NumberFormat('th-TH').format(Math.round(n));

/**
 * @param {{sold:number|null, peak:number|null, peakSource?:'auto'|'manual', monthlySold?:number|null,
 *          prevMonthlySold?:number|null, velocities?:number[], categoryRank?:number|null}} p
 * @returns {{phase:string|null, ratio:number|null, declining:boolean, confidence:'high'|'medium'|'low'|null, reasons:string[]}}
 */
function estimatePhase({ sold, peak, peakSource = 'auto', monthlySold = null, prevMonthlySold = null, velocities = [], categoryRank = null }) {
  const reasons = [];
  // Demand trend: month-over-month first (what the shop page shows), else snapshot velocities
  let trend = null;
  if (monthlySold != null && prevMonthlySold != null && prevMonthlySold > 0) {
    trend = monthlySold / prevMonthlySold;
    reasons.push(`ยอดเดือนล่าสุด ${fmt(monthlySold)} ชิ้น เทียบเดือนก่อน ${fmt(prevMonthlySold)} ชิ้น (${Math.round(trend * 100)}%)`);
  } else if (velocities.length >= VELOCITY_MIN_POINTS) {
    // Rolling means smooth day-to-day noise so one slow day does not read as a decline
    const avgs = [];
    for (let i = VELOCITY_WINDOW - 1; i < velocities.length; i += 1) {
      avgs.push(velocities.slice(i - VELOCITY_WINDOW + 1, i + 1).reduce((a, v) => a + v, 0) / VELOCITY_WINDOW);
    }
    const best = Math.max(...avgs);
    const now = avgs[avgs.length - 1];
    if (best > 0) {
      trend = now / best;
      reasons.push(`ความเร็วยอดขายช่วงหลัง ${fmt(now)} ชิ้น/วัน เทียบช่วงที่ดีที่สุด ${fmt(best)} ชิ้น/วัน`);
    }
  }
  const decline = trend == null ? null : DECLINE_BANDS.find((b) => trend >= b.min).phase;

  if (sold == null)
    return {
      phase: decline,
      ratio: null,
      declining: Boolean(decline),
      confidence: decline ? 'low' : null,
      reasons: [...reasons, 'ยังไม่มียอดขายสะสมของสินค้า'],
    };
  if (!peak || peak <= 0) {
    return {
      phase: decline,
      ratio: null,
      declining: Boolean(decline),
      confidence: decline ? 'low' : null,
      reasons: [...reasons, 'ยังไม่รู้ยอดขายสูงสุดของหมวด — ใส่ยอดขายเฉลี่ยของอันดับ 1–2 ในหมวดเพื่อประเมิน Phase'],
    };
  }

  const ratio = round2((sold / peak) * 100);
  const rising = RISING_BANDS.find((b) => ratio < b.max).phase;
  reasons.unshift(`ขายแล้ว ${fmt(sold)} ชิ้น = ${ratio}% ของยอดอันดับ 1–2 ของหมวด (${fmt(peak)} ชิ้น)`);

  let phase = rising;
  let declining = false;
  // A product can fade before reaching the category peak: a clear drop in its own demand wins
  if (decline) {
    phase = decline;
    declining = true;
    reasons.push('ความต้องการกำลังลดลง — เลยช่วงพีกของสินค้าแล้ว');
  } else if (rising === 'A') {
    reasons.push('ยอดขายใกล้ระดับสูงสุดของหมวด ตลาดน่าจะเริ่มอิ่มตัว');
  }
  if (categoryRank != null && categoryRank <= SATURATED_RANK) {
    reasons.push(`ติดอันดับ ${categoryRank} ของหมวด (อันดับ 1–10 คนทำคลิปขายเยอะแล้ว แนะนำมองหาอันดับ 11 ขึ้นไป)`);
  }
  const confidence = peakSource === 'manual' ? (trend != null ? 'high' : 'medium') : trend != null ? 'medium' : 'low';
  return { phase, ratio, declining, confidence, reasons };
}

/* -------------------------------------------------------------- checklist */

/** The book's 9-point checklist. `test` returns true/false, or null when the data is missing. */
const CHECKS = [
  {
    key: 'phase',
    label: 'สินค้าอยู่ใน Phase 3',
    test: (t) => (t.phase == null ? null : t.phase === '3' ? true : ['2', '4'].includes(t.phase) ? 'partial' : false),
  },
  {
    key: 'rating',
    label: 'ดาวสินค้าเฉลี่ย 4.5+',
    test: (t) => (t.rating == null ? null : t.rating >= 4.5),
  },
  {
    key: 'positiveReviews',
    label: 'มีรีวิวเชิงบวก',
    test: (t) => (t.positiveReviewPct == null ? null : t.positiveReviewPct >= 80),
  },
  {
    key: 'mediaReviews',
    label: 'มีรีวิวภาพถ่าย/วิดีโอจริง',
    test: (t) => (t.mediaReviewCount == null ? null : t.mediaReviewCount > 0),
  },
  {
    key: 'shopRating',
    label: 'คะแนนร้าน 4.5+',
    test: (t) => (t.shopRating == null ? null : t.shopRating >= 4.5),
  },
  {
    key: 'responseRate',
    label: 'อัตราการตอบกลับ 75%+',
    test: (t) => (t.shopResponseRate == null ? null : t.shopResponseRate >= 75),
  },
  {
    key: 'ship48',
    label: 'จัดส่งภายใน 48 ชม. 65%+',
    test: (t) => (t.shopShip48Rate == null ? null : t.shopShip48Rate >= 65),
  },
  {
    key: 'commission',
    label: 'ค่าคอมมิชชัน 8%+',
    test: (t) => (t.commissionRate == null ? null : t.commissionRate >= 8),
  },
  {
    key: 'flashSale',
    label: 'มีแฟลชเซลอย่างต่อเนื่อง',
    test: (t) => (t.hasFlashSale == null ? null : Boolean(t.hasFlashSale)),
  },
];

/**
 * @param {object} t item fields (camelCase) + phase
 * @param {Record<string, boolean>} [manual] criteria a person has confirmed/refuted (wins over data)
 * @returns {{items:{key,label,status:'pass'|'partial'|'fail'|'unknown',manual:boolean}[], passed:number, known:number}}
 */
function evaluateChecklist(t, manual = {}) {
  const items = CHECKS.map((c) => {
    const m = manual?.[c.key];
    if (typeof m === 'boolean' && c.key !== 'phase')
      return {
        key: c.key,
        label: c.label,
        status: m ? 'pass' : 'fail',
        manual: true,
      };
    const r = c.test(t);
    const status = r === null ? 'unknown' : r === 'partial' ? 'partial' : r ? 'pass' : 'fail';
    return { key: c.key, label: c.label, status, manual: false };
  });
  return {
    items,
    passed: items.filter((i) => i.status === 'pass').length,
    known: items.filter((i) => i.status !== 'unknown').length,
  };
}

/** Phase weight for the pick score: Phase 3 best, 2/4 good, past the peak nearly worthless. */
const PHASE_WEIGHT = {
  1: 0.4,
  2: 0.75,
  3: 1,
  4: 0.75,
  5: 0.35,
  A: 0.1,
  B: 0.05,
  C: 0,
  D: 0,
  E: 0,
};
const STATUS_VALUE = { pass: 1, partial: 0.5, unknown: 0.5, fail: 0 };

/**
 * 0–100 "worth picking for affiliate clips": half lifecycle phase, half the other 8 checks
 * (unknown counts as neutral), × 0.6 when the item is in the category's top 10.
 */
function pickScore({ phase, checklist, categoryRank }) {
  const w = phase == null ? 0.3 : (PHASE_WEIGHT[phase] ?? 0.3);
  const rest = checklist.items.filter((i) => i.key !== 'phase');
  const c = rest.reduce((n, i) => n + STATUS_VALUE[i.status], 0) / rest.length;
  let score = 50 * w + 50 * c;
  if (categoryRank != null && categoryRank <= SATURATED_RANK) score *= 0.6;
  return round2(score);
}

module.exports = {
  PHASES,
  RISING_BANDS,
  DECLINE_BANDS,
  SATURATED_RANK,
  CHECKS,
  velocitySeries,
  estimatePhase,
  evaluateChecklist,
  pickScore,
};
