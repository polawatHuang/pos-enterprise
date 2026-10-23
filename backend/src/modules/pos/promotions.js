'use strict';

/**
 * POS promotions, 7-Eleven style, per branch:
 *   time_discount  products/categories are cheaper on chosen dates, weekdays and hours
 *   bundle         buy A together with B (slot 1 + slot 2) for a special price
 *   multi_buy      buy N pieces from a group (mix and match) for a special price
 *
 * Promotions stack in layers (time discount -> near-expiry markdown -> bundle/multi-buy set ->
 * bill discounts). priceCart() is pure so the till's live quote and checkout share it.
 */
const db = require('../../db/pool');
const { localDate, localTime } = require('../../utils/dates');

const r2 = (n) => Math.round(n * 100) / 100;
const EPS = 0.004;

/** True when local "HH:MM" falls inside [from, to); windows may wrap midnight (22:00-06:00). */
function inWindow(now, from, to) {
  if (from === to) return false;
  return from < to ? now >= from && now < to : now >= from || now < to;
}

/** Is the promotion running at this local date ("YYYY-MM-DD"), weekday (0 = Sunday) and time ("HH:MM")? */
function isRunning(p, { date, weekday, time }) {
  if (!p.isActive) return false;
  if (p.startsOn && date < p.startsOn) return false;
  if (p.endsOn && date > p.endsOn) return false;
  if (!(p.daysMask & (1 << weekday))) return false;
  if (p.timeFrom && p.timeTo && !inWindow(time, p.timeFrom, p.timeTo)) return false;
  return true;
}

function localClock(at = new Date()) {
  const date = localDate(at);
  return { date, weekday: new Date(`${date}T00:00:00Z`).getUTCDay(), time: localTime(at) };
}

// DATE columns arrive as midnight UTC (the pool uses timezone 'Z')
const ymd = (v) => (v == null ? null : typeof v === 'string' ? v.slice(0, 10) : v.toISOString().slice(0, 10));

/** Rows -> promotion objects: { ..., branches: [ids], slots: [{ qty, productIds, categoryIds }] }. */
async function loadPromotions(orgId, { ids = null } = {}) {
  const promos = await db.query(
    `SELECT * FROM pos_promotions WHERE org_id = :orgId ${ids ? 'AND id IN (:ids)' : ''} ORDER BY id DESC`,
    { orgId, ids: ids?.length ? ids : [0] },
  );
  if (!promos.length) return [];
  const pids = promos.map((p) => p.id);
  const [items, branches] = await Promise.all([
    db.query('SELECT * FROM pos_promotion_items WHERE promotion_id IN (:pids) ORDER BY slot, id', { pids }),
    db.query('SELECT pb.promotion_id, pb.branch_id, b.name FROM pos_promotion_branches pb JOIN branches b ON b.id = pb.branch_id WHERE pb.promotion_id IN (:pids)', { pids }),
  ]);
  return promos.map((p) => {
    const slots = [];
    for (const it of items.filter((i) => i.promotion_id === p.id)) {
      const s = (slots[it.slot - 1] ??= { qty: Number(it.qty) || 1, productIds: [], categoryIds: [] });
      if (it.product_id) s.productIds.push(Number(it.product_id));
      if (it.category_id) s.categoryIds.push(Number(it.category_id));
    }
    const bs = branches.filter((b) => b.promotion_id === p.id);
    return {
      id: p.id,
      name: p.name,
      kind: p.kind,
      discountType: p.discount_type,
      value: Number(p.value),
      startsOn: ymd(p.starts_on),
      endsOn: ymd(p.ends_on),
      daysMask: Number(p.days_mask),
      timeFrom: p.time_from || null,
      timeTo: p.time_to || null,
      isActive: Boolean(p.is_active),
      branches: bs.map((b) => Number(b.branch_id)),
      branchNames: bs.map((b) => b.name),
      slots: slots.filter(Boolean),
      createdAt: p.created_at,
    };
  });
}

// Running promotions per org+branch, kept briefly so every cart change does not hit the database
const cache = new Map();
const TTL_MS = 30_000;
function clearCache(orgId) {
  for (const k of cache.keys()) if (k.startsWith(`${orgId}:`)) cache.delete(k);
}

async function activePromotions(orgId, branchId, at = new Date()) {
  const key = `${orgId}:${branchId ?? 0}`;
  let hit = cache.get(key);
  if (!hit || hit.until < Date.now()) {
    const all = await loadPromotions(orgId);
    hit = { until: Date.now() + TTL_MS, list: all.filter((p) => p.isActive && (!p.branches.length || p.branches.includes(Number(branchId)))) };
    cache.set(key, hit);
  }
  const clock = localClock(at);
  return hit.list.filter((p) => isRunning(p, clock));
}

const matches = (slot, piece) => slot.productIds.includes(piece.productId) || (piece.categoryId != null && slot.categoryIds.includes(piece.categoryId));

/** Baht off a set of pieces whose prices add up to `sum`. */
function dealDiscount(p, sum) {
  if (p.discountType === 'percent') return r2((sum * Math.min(p.value, 100)) / 100);
  if (p.discountType === 'amount_off') return r2(Math.min(p.value, sum));
  return r2(Math.max(sum - p.value, 0)); // set_price: the set costs `value`
}

/**
 * Price a cart with stacked promotions, layer by layer, each on the price the layer before left:
 *   1. time discount   the best running time_discount for the item lowers its piece price
 *   2. markdown        a near-expiry lot markdown (a % of price) applies on that lower price
 *   3. deals           bundle / multi-buy sets are priced from those lowered prices; a piece joins at
 *                      most one set; sets are chosen greedily, biggest saving first; "set price" never
 *                      charges more than the pieces already cost
 * Bill-level discounts (manual, codes, points) stack on top at checkout.
 *
 * `lines`: [{ productId, categoryId, price (per piece), quantity, markdown, eligible }] where markdown
 * is the near-expiry markdown on the line at full price (baht) and eligible=false for pack lines.
 * Returns per line { promoDiscount, markdownKept, promotionId, promotionName } and the deals applied.
 */
function priceCart(lines, promos) {
  const timed = promos.filter((p) => p.kind === 'time_discount');
  const deals = promos.filter((p) => p.kind !== 'time_discount' && p.slots.length);

  // One entry per whole piece (sets need whole pieces); a fractional rest gets layers 1-2 only
  const pieces = [];
  const rest = [];
  lines.forEach((l, li) => {
    const qty = Number(l.quantity) || 0;
    const price = Number(l.price) || 0;
    let t = { off: 0, promo: null };
    if (l.eligible !== false) {
      for (const p of timed) {
        if (!p.slots[0] || !matches(p.slots[0], l)) continue;
        const off = dealDiscount(p, price);
        if (off > t.off + EPS) t = { off, promo: p };
      }
    }
    const mdPct = qty && price ? (l.markdown || 0) / qty / price : 0; // markdown as a share of the price
    const afterTime = price - t.off;
    const md = afterTime * mdPct;
    const layer = { time: t.off, timePromo: t.promo, md, net: afterTime - md };
    const whole = Math.floor(qty + 1e-9);
    for (let i = 0; i < whole; i++) pieces.push({ li, productId: l.productId, categoryId: l.categoryId, eligible: l.eligible !== false, ...layer, deal: null, share: 0 });
    if (qty - whole > 1e-9) rest.push({ li, frac: qty - whole, ...layer });
  });

  const applied = [];
  for (let guard = 0; guard < 500; guard++) {
    let best = null;
    for (const p of deals) {
      const free = pieces.filter((x) => !x.deal && x.eligible);
      const pick = [];
      let ok = true;
      for (const slot of p.slots) {
        const cands = free.filter((x) => !pick.includes(x) && matches(slot, x)).sort((a, b) => b.net - a.net);
        if (cands.length < slot.qty) {
          ok = false;
          break;
        }
        pick.push(...cands.slice(0, slot.qty));
      }
      if (!ok) continue;
      const sum = pick.reduce((s, x) => s + x.net, 0);
      const off = dealDiscount(p, sum);
      if (off > EPS && (!best || off > best.off)) best = { p, pick, off, sum };
    }
    if (!best) break;
    const { p, pick, off, sum } = best;
    let left = off;
    pick.forEach((x, i) => {
      const share = i === pick.length - 1 ? r2(left) : r2((off * x.net) / sum);
      left = r2(left - share);
      x.deal = p;
      x.share = share;
    });
    applied.push({ promotionId: p.id, name: p.name, discount: off });
  }

  const out = lines.map(() => ({ promoDiscount: 0, markdownKept: 0, byPromo: new Map() }));
  const add = (li, promo, amount) => {
    if (!promo || amount <= 0) return;
    out[li].promoDiscount += amount;
    out[li].byPromo.set(promo, (out[li].byPromo.get(promo) ?? 0) + amount);
  };
  for (const x of pieces) {
    add(x.li, x.timePromo, x.time);
    out[x.li].markdownKept += x.md;
    if (x.deal) add(x.li, x.deal, x.share);
  }
  for (const r of rest) {
    add(r.li, r.timePromo, r.time * r.frac);
    out[r.li].markdownKept += r.md * r.frac;
  }
  const timedUsed = new Map();
  for (const o of out) for (const [p, amt] of o.byPromo) if (p.kind === 'time_discount') timedUsed.set(p, (timedUsed.get(p) ?? 0) + amt);
  for (const [p, amt] of timedUsed) applied.push({ promotionId: p.id, name: p.name, discount: r2(amt) });

  return {
    lines: out.map((o) => {
      let top = null;
      for (const [p, amt] of o.byPromo) if (!top || amt > top.amt) top = { p, amt };
      return {
        promoDiscount: r2(o.promoDiscount),
        markdownKept: r2(o.markdownKept),
        promotionId: top?.p.id ?? null,
        promotionName: o.byPromo.size > 1 ? [...o.byPromo.keys()].map((p) => p.name).join(' + ') : (top?.p.name ?? null),
      };
    }),
    applied: applied.map((a) => ({ ...a, discount: r2(a.discount) })),
    total: r2(out.reduce((s, o) => s + o.promoDiscount, 0)),
  };
}

/** Short tag for a product tile, e.g. "2 ชิ้น ฿39", "ลด 20% ถึง 17:00", "ซื้อคู่ถูกกว่า". */
function promoLabel(p) {
  const v = Number.isInteger(p.value) ? String(p.value) : p.value.toFixed(2);
  const until = p.timeTo ? ` ถึง ${p.timeTo}` : '';
  if (p.kind === 'time_discount') {
    if (p.discountType === 'percent') return `ลด ${v}%${until}`;
    if (p.discountType === 'amount_off') return `ลด ฿${v}${until}`;
    return `เหลือ ฿${v}${until}`;
  }
  if (p.kind === 'multi_buy') {
    const n = p.slots[0]?.qty ?? 2;
    if (p.discountType === 'set_price') return `${n} ชิ้น ฿${v}`;
    if (p.discountType === 'percent') return `${n} ชิ้น ลด ${v}%`;
    return `${n} ชิ้น ลด ฿${v}`;
  }
  return p.discountType === 'set_price' ? `ซื้อคู่ ฿${v}` : 'ซื้อคู่ถูกกว่า';
}

/** Deals a catalog item takes part in, and its time-discounted price when one runs now. */
function catalogTags(item, promos) {
  const piece = { productId: Number(item.id), categoryId: item.categoryId == null ? null : Number(item.categoryId) };
  const tags = [];
  let promoPrice = null;
  for (const p of promos) {
    if (!p.slots.some((s) => matches(s, piece))) continue;
    tags.push({ id: p.id, kind: p.kind, label: promoLabel(p) });
    if (p.kind === 'time_discount') {
      const price = r2(item.price - dealDiscount(p, item.price));
      if (promoPrice == null || price < promoPrice) promoPrice = price;
    }
  }
  return { tags, promoPrice };
}

/**
 * Up-sell hints: deals the cart has started but not completed (one of "2 for 39", or A without B).
 * `candidates(slot, n)` returns products that can be added (in stock). Each hint carries the exact
 * extra saving, found by pricing the cart again with the suggested pieces added.
 */
async function suggestions(lines, promos, candidates) {
  const base = priceCart(lines, promos).total;
  const out = [];
  for (const p of promos.filter((x) => x.kind !== 'time_discount' && x.slots.length)) {
    const priced = priceCart(lines, [p]);
    const counts = p.slots.map((slot) =>
      lines.reduce((s, l) => (l.eligible !== false && matches(slot, l) ? s + Math.floor(l.quantity + 1e-9) : s), 0),
    );
    const sets = priced.applied.filter((a) => a.promotionId === p.id).length;
    // pieces needed for one more set, per slot
    const need = p.slots.map((slot, i) => Math.max(slot.qty * (sets + 1) - counts[i], 0));
    const missing = need.reduce((s, n) => s + n, 0);
    const started = counts.some((c, i) => c > p.slots[i].qty * sets);
    if (!started || !missing || missing > 3) continue;
    const slotIdx = need.findIndex((n) => n > 0);
    const items = await candidates(p.slots[slotIdx], lines);
    if (!items.length) continue;
    // the exact extra saving of each candidate, best first
    const ranked = items
      .slice(0, 8)
      .map((it) => {
        const extra = { productId: it.id, categoryId: it.categoryId, price: it.price, quantity: need[slotIdx], markdown: 0, eligible: true };
        return { it, saving: r2(priceCart([...lines, extra], promos).total - base) };
      })
      .filter((x) => x.saving > EPS)
      .sort((a, b) => b.saving - a.saving);
    if (!ranked.length) continue;
    const saving = ranked[0].saving;
    out.push({
      promotionId: p.id,
      name: p.name,
      label: promoLabel(p),
      need: need[slotIdx],
      saving,
      message: `เพิ่มอีก ${need[slotIdx]} ชิ้น ประหยัดได้ถึง ฿${saving.toLocaleString('th-TH', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`,
      items: ranked.slice(0, 4).map((x) => ({ ...x.it, saving: x.saving })),
    });
  }
  return out.sort((a, b) => b.saving - a.saving).slice(0, 3);
}

module.exports = { priceCart, activePromotions, loadPromotions, clearCache, isRunning, localClock, promoLabel, catalogTags, suggestions, dealDiscount, inWindow };
