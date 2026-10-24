'use strict';

/**
 * The 30-point selection score from the Kalodata affiliate guide (backend/kalodata-api-docs,
 * "ระบบให้คะแนนคัดเลือกสินค้า"): six criteria, 1–5 each. Five are worked out from the data;
 * "ศักยภาพทำคอนเทนต์" (can we demo it, hook ideas) is a person's call. Unknown criteria stay null,
 * and the verdict uses the known ones scaled to 30 — the guide stresses this ranks candidates,
 * it does not predict sales. Pure function.
 */

const band = (v, steps) => {
  for (const [min, score] of steps) if (v >= min) return score;
  return 1;
};
const fmt = (n) => new Intl.NumberFormat('th-TH', { maximumFractionDigits: 1 }).format(n);

/**
 * @param {{monthlySold?:number|null, categoryRank?:number|null, growthRate?:number|null, price?:number|null,
 *   commissionRate?:number|null, creatorCount?:number|null, top3ShopRatio?:number|null, rating?:number|null,
 *   reviewCount?:number|null, shopRating?:number|null, contentScore?:number|null, phase?:string|null}} t
 */
function selectScore(t) {
  const items = [];
  const add = (key, label, score, reason) => items.push({ key, label, score, reason });

  // 1. demand: units sold in the month (and how it ranks in its category)
  if (t.monthlySold != null) {
    const s = band(t.monthlySold, [
      [5000, 5],
      [1500, 4],
      [500, 3],
      [100, 2],
    ]);
    add('demand', 'ความต้องการซื้อและขนาดตลาด', s, `ขายได้ ${fmt(t.monthlySold)} ชิ้นในเดือนล่าสุด${t.categoryRank ? ` · อันดับ ${t.categoryRank} ของหมวด` : ''}`);
  } else add('demand', 'ความต้องการซื้อและขนาดตลาด', null, 'ยังไม่มียอดขายรายเดือน');

  // 2. trend: growth vs the month before
  if (t.growthRate != null) {
    const s = band(t.growthRate, [
      [50, 5],
      [15, 4],
      [-5, 3],
      [-25, 2],
    ]);
    add('trend', 'แนวโน้มยอดขาย', s, `ยอดขายเปลี่ยน ${t.growthRate > 0 ? '+' : ''}${fmt(t.growthRate)}% จากเดือนก่อน`);
  } else add('trend', 'แนวโน้มยอดขาย', null, 'ยังไม่มีข้อมูลเทียบเดือนก่อน');

  // 3. commission value: baht earned per unit
  const perUnit = t.price != null && t.commissionRate != null ? (t.price * t.commissionRate) / 100 : null;
  if (perUnit != null) {
    const s = band(perUnit, [
      [60, 5],
      [30, 4],
      [15, 3],
      [5, 2],
    ]);
    add('commission', 'ความคุ้มค่าคอมมิชชัน', s, `ได้ประมาณ ${fmt(perUnit)} บาท/ชิ้น (${fmt(t.commissionRate)}% ของ ${fmt(t.price)} บาท)`);
  } else add('commission', 'ความคุ้มค่าคอมมิชชัน', null, t.commissionRate == null ? 'ยังไม่รู้อัตราค่าคอม' : 'ยังไม่รู้ราคา');

  // 4. room to compete: creators per 100 units sold, top-10 rank, sales concentrated in a few shops
  if (t.creatorCount != null && t.monthlySold) {
    const per100 = (t.creatorCount / t.monthlySold) * 100;
    let s = per100 <= 1 ? 5 : per100 <= 3 ? 4 : per100 <= 8 ? 3 : per100 <= 20 ? 2 : 1;
    const why = [`ครีเอเตอร์ ${fmt(t.creatorCount)} คน ต่อยอดขาย ${fmt(t.monthlySold)} ชิ้น (${fmt(per100)} คน/100 ชิ้น)`];
    if (t.categoryRank != null && t.categoryRank <= 10) {
      s -= 1;
      why.push('ติดอันดับ 1–10 ของหมวด คนทำคลิปเยอะ');
    }
    if (t.top3ShopRatio != null && t.top3ShopRatio >= 60) {
      s -= 1;
      why.push(`3 ร้านแรกกินส่วนแบ่งหมวด ${fmt(t.top3ShopRatio)}%`);
    }
    add('competition', 'โอกาสแข่งขัน', Math.max(1, s), why.join(' · '));
  } else if (t.categoryRank != null) {
    add('competition', 'โอกาสแข่งขัน', t.categoryRank <= 10 ? 2 : 3, t.categoryRank <= 10 ? 'ติดอันดับ 1–10 ของหมวด คนทำคลิปเยอะ (ยังไม่รู้จำนวนครีเอเตอร์)' : `อันดับ ${t.categoryRank} ของหมวด (ยังไม่รู้จำนวนครีเอเตอร์)`);
  } else add('competition', 'โอกาสแข่งขัน', null, 'ยังไม่รู้จำนวนครีเอเตอร์และอันดับ');

  // 5. content potential: a person's judgement (hook ideas, easy to demo)
  add(
    'content',
    'ศักยภาพทำคอนเทนต์',
    t.contentScore != null ? Math.min(5, Math.max(1, Math.round(t.contentScore))) : null,
    t.contentScore != null ? 'ให้คะแนนเอง' : 'ให้คะแนนเอง: สาธิตง่ายไหม มี Hook หลายแบบไหม',
  );

  // 6. trust: product rating (+ enough reviews) and shop rating
  const rating = t.rating ?? t.shopRating;
  if (rating != null) {
    let s = band(rating, [
      [4.7, 5],
      [4.5, 4],
      [4.2, 3],
      [3.8, 2],
    ]);
    if (t.reviewCount != null && t.reviewCount < 20) s = Math.min(s, 3);
    add('trust', 'ความน่าเชื่อถือของสินค้าและร้าน', s, `${t.rating != null ? 'ดาวสินค้า' : 'ดาวร้าน'} ${fmt(rating)}${t.reviewCount != null ? ` · รีวิว ${fmt(t.reviewCount)}` : ''}`);
  } else add('trust', 'ความน่าเชื่อถือของสินค้าและร้าน', null, t.reviewCount != null ? `รีวิว ${fmt(t.reviewCount)} รายการ (ยังไม่รู้คะแนนดาว)` : 'ยังไม่มีคะแนนรีวิว');

  const known = items.filter((i) => i.score != null);
  const total = known.reduce((s, i) => s + i.score, 0);
  const projected = known.length >= 4 ? Math.round((total / known.length) * 6) : null;
  const verdict = projected == null ? 'insufficient' : projected >= 24 ? 'test' : projected >= 18 ? 'watch' : 'skip';

  // Stop rules: slow down even when the score is high
  const stops = [];
  if (t.commissionRate == null || t.commissionRate <= 0) stops.push('เงื่อนไขค่าคอมมิชชันยังไม่ชัด — ตรวจใน TikTok Shop ก่อน');
  else if (perUnit != null && perUnit < 5) stops.push('ค่าคอมต่อชิ้นต่ำมาก อาจไม่คุ้มเวลาทำคลิป');
  if (rating != null && rating < 4) stops.push('คะแนนรีวิวต่ำ สินค้าหรือร้านอาจมีปัญหา');
  if (['C', 'D', 'E'].includes(t.phase)) stops.push('สินค้าเลยช่วงพีกไปมากแล้ว');

  return { items, total, known: known.length, projected, verdict, stops };
}

module.exports = { selectScore };
