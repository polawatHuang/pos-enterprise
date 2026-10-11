'use strict';

// Phase 5b: product lifecycle phase, 9-point checklist, pick score, category benchmarks and
// channel profiles (method summarised in docs/PRODUCT_RESEARCH.md). MiniMax is mocked.
process.env.NODE_ENV = 'test';

const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { createApp } = require('../src/app');
const db = require('../src/db/pool');
const minimax = require('../src/integrations/minimax');
const { estimatePhase, evaluateChecklist, pickScore, velocitySeries } = require('../src/modules/scraping/lifecycle');
const { csvToItems } = require('../src/modules/scraping/csv');
const { normalizeItem, recomputeCategory } = require('../src/modules/scraping/trends.service');

const app = createApp();
const RUN = Date.now().toString(36);
const CAT = `T5B ${RUN}`;
const originalCreate = minimax.createMessage;
const savedKey = process.env.MINIMAX_API_KEY;
const savedProvider = process.env.AI_PROVIDER;
const createdProfiles = [];
let manager;
let marketer;
let viewer;

async function cookie(email) {
  const res = await request(app).post('/api/auth/login').send({ email, password: 'Admin@1234' });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  return res.headers['set-cookie'].map((c) => c.split(';')[0]).join('; ');
}
const as = (c) => ({
  get: (url) => request(app).get(url).set('Cookie', c),
  post: (url, body) => request(app).post(url).set('Cookie', c).send(body),
  put: (url, body) => request(app).put(url).set('Cookie', c).send(body),
  patch: (url, body) => request(app).patch(url).set('Cookie', c).send(body),
  delete: (url) => request(app).delete(url).set('Cookie', c),
});
const toolReply = (name, input) => ({ model: 'MiniMax-M3', stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 't1', name, input }] });
const byTitle = async (title) => db.one('SELECT * FROM trending_products WHERE org_id = 1 AND title = :title', { title });

before(async () => {
  delete process.env.AI_PROVIDER;
  manager = as(await cookie('manager@example.com'));
  marketer = as(await cookie('marketer@example.com'));
  viewer = as(await cookie('viewer@example.com'));
});

after(async () => {
  minimax.createMessage = originalCreate;
  if (savedKey === undefined) delete process.env.MINIMAX_API_KEY;
  else process.env.MINIMAX_API_KEY = savedKey;
  if (savedProvider !== undefined) process.env.AI_PROVIDER = savedProvider;
  await db.query('DELETE FROM trending_products WHERE org_id = 1 AND category LIKE :c', { c: 'T5B %' });
  await db.query('DELETE FROM trend_category_benchmarks WHERE org_id = 1 AND category LIKE :c', { c: 'T5B %' });
  if (createdProfiles.length) await db.query('DELETE FROM channel_profiles WHERE id IN (:ids)', { ids: createdProfiles });
  // Give the seeded profile its default flag back
  if (!(await db.one('SELECT id FROM channel_profiles WHERE org_id = 1 AND is_default = 1'))) {
    await db.query('UPDATE channel_profiles SET is_default = 1 WHERE org_id = 1 ORDER BY id LIMIT 1');
  }
  await db.query('UPDATE trending_products SET ai_analysis = NULL, ai_analyzed_at = NULL WHERE id = 9');
  await db.pool.end();
});

describe('lifecycle method (unit)', () => {
  test('phase estimate matches the book examples', () => {
    // T-shirt 29k of a 100k category peak → Phase 3 (25–35% band)
    assert.equal(estimatePhase({ sold: 29_000, peak: 100_000 }).phase, '3');
    // Jewellery box 11k of 200k → early (book: 2–3)
    assert.equal(estimatePhase({ sold: 11_000, peak: 200_000 }).phase, '2');
    // Shoe box 3.3k of 200k → very early (book: 1–2)
    assert.equal(estimatePhase({ sold: 3_300, peak: 200_000 }).phase, '1');
    // Shelf 23k of 25k, last month only 3,151 → past the peak
    const shelf = estimatePhase({ sold: 23_000, peak: 25_000, monthlySold: 3_151, prevMonthlySold: 9_800, categoryRank: 2 });
    assert.ok(['B', 'C', 'D', 'E'].includes(shelf.phase), shelf.phase);
    assert.equal(shelf.declining, true);
    assert.equal(shelf.ratio, 92);
    assert.ok(shelf.reasons.some((r) => /อันดับ 2/.test(r)));
    // Near the peak without a decline → A
    assert.equal(estimatePhase({ sold: 90_000, peak: 100_000, monthlySold: 10_000, prevMonthlySold: 9_000 }).phase, 'A');
  });

  test('no category peak → no phase, with a reason saying what to enter', () => {
    const r = estimatePhase({ sold: 5_000, peak: null });
    assert.equal(r.phase, null);
    assert.equal(r.ratio, null);
    assert.match(r.reasons.join(' '), /อันดับ 1–2/);
    assert.equal(estimatePhase({ sold: null, peak: 1000 }).phase, null);
  });

  test('snapshot velocity decline is smoothed', () => {
    const day = 86_400_000;
    const t0 = Date.parse('2026-01-01T00:00:00Z');
    const snapsFrom = (rates) => {
      let sold = 1000;
      return [{ capturedAt: new Date(t0), soldCount: sold }].concat(
        rates.map((r, i) => {
          sold += r;
          return { capturedAt: new Date(t0 + (i + 1) * day), soldCount: sold };
        }),
      );
    };
    // One slow day among steady sales is not a decline
    const steady = velocitySeries(snapsFrom([100, 110, 95, 105, 60, 100]));
    assert.equal(estimatePhase({ sold: 30_000, peak: 100_000, velocities: steady }).phase, '3');
    // Sustained drop to ~20% of the best rate → C or worse
    const falling = velocitySeries(snapsFrom([100, 110, 100, 40, 20, 15, 10]));
    const r = estimatePhase({ sold: 30_000, peak: 100_000, velocities: falling });
    assert.ok(['C', 'D', 'E'].includes(r.phase), r.phase);
    // Snapshots closer than 20h are skipped
    assert.equal(
      velocitySeries([
        { capturedAt: new Date(t0), soldCount: 1 },
        { capturedAt: new Date(t0 + 3600_000), soldCount: 50 },
      ]).length,
      0,
    );
  });

  test('checklist: pass / fail / unknown / partial, manual answers win', () => {
    const c = evaluateChecklist({
      phase: '4',
      rating: 4.8,
      positiveReviewPct: null,
      mediaReviewCount: 0,
      shopRating: 4.4,
      shopResponseRate: 80,
      shopShip48Rate: 64,
      commissionRate: 8,
      hasFlashSale: true,
    });
    const s = Object.fromEntries(c.items.map((i) => [i.key, i.status]));
    assert.deepEqual(s, {
      phase: 'partial',
      rating: 'pass',
      positiveReviews: 'unknown',
      mediaReviews: 'fail',
      shopRating: 'fail',
      responseRate: 'pass',
      ship48: 'fail',
      commission: 'pass',
      flashSale: 'pass',
    });
    assert.equal(c.passed, 4);
    assert.equal(c.known, 8);
    const m = evaluateChecklist({ phase: '3' }, { positiveReviews: true, mediaReviews: false, phase: false });
    const ms = Object.fromEntries(m.items.map((i) => [i.key, i]));
    assert.equal(ms.positiveReviews.status, 'pass');
    assert.equal(ms.positiveReviews.manual, true);
    assert.equal(ms.mediaReviews.status, 'fail');
    assert.equal(ms.phase.status, 'pass'); // phase is computed, never overridden by hand
  });

  test('pick score: Phase 3 with a good checklist beats a top-10 or past-peak item', () => {
    const good = {
      rating: 4.8,
      positiveReviewPct: 92,
      mediaReviewCount: 50,
      shopRating: 4.8,
      shopResponseRate: 95,
      shopShip48Rate: 85,
      commissionRate: 12,
      hasFlashSale: true,
    };
    const p3 = pickScore({ phase: '3', checklist: evaluateChecklist({ ...good, phase: '3' }), categoryRank: 25 });
    const top = pickScore({ phase: '3', checklist: evaluateChecklist({ ...good, phase: '3' }), categoryRank: 3 });
    const late = pickScore({ phase: 'C', checklist: evaluateChecklist({ ...good, phase: 'C' }), categoryRank: 25 });
    const unknown = pickScore({ phase: null, checklist: evaluateChecklist({}), categoryRank: null });
    assert.equal(p3, 100);
    assert.ok(p3 > top && p3 > late && p3 > unknown, `${p3} ${top} ${late} ${unknown}`);
    assert.ok(unknown >= 0 && unknown <= 100);
  });

  test('CSV maps the new Thai columns; normalize clamps and parses flags', () => {
    const csv =
      'ชื่อสินค้า,ขายแล้ว,อันดับ,ขายเดือนที่แล้ว,ขายเดือนก่อน,จำนวนรีวิว,รีวิวรูป/วิดีโอ,รีวิวเชิงบวก,คะแนนร้าน,อัตราการตอบกลับ,จัดส่งภายใน 48 ชม.,แฟลชเซล\n' +
      'กล่อง,"1,200",12,300,250,90,12,0.95,4.8,97%,88,มี\n';
    const { items, errors } = csvToItems(csv, { platform: 'shopee' });
    assert.deepEqual(errors, []);
    const it = normalizeItem(items[0]);
    assert.equal(it.soldCount, 1200);
    assert.equal(it.categoryRank, 12);
    assert.equal(it.monthlySold, 300);
    assert.equal(it.prevMonthlySold, 250);
    assert.equal(it.reviewCount, 90);
    assert.equal(it.mediaReviewCount, 12);
    assert.equal(it.positiveReviewPct, 95); // fraction → percent
    assert.equal(it.shopRating, 4.8);
    assert.equal(it.shopResponseRate, 97);
    assert.equal(it.shopShip48Rate, 88);
    assert.equal(it.hasFlashSale, true);
    const bad = normalizeItem({ title: 'x', shopRating: 9, shopResponseRate: 150, categoryRank: 0, hasFlashSale: 'maybe' });
    assert.equal(bad.shopRating, null);
    assert.equal(bad.shopResponseRate, null);
    assert.equal(bad.categoryRank, null);
    assert.equal(bad.hasFlashSale, null);
  });
});

describe('lifecycle API', () => {
  const csv = [
    'ชื่อสินค้า,ขายแล้ว,หมวดหมู่,อันดับ,ค่าคอม,คะแนน,คะแนนร้าน',
    `T5B ${RUN} top1,110000,${CAT},1,10,4.8,4.9`,
    `T5B ${RUN} top2,90000,${CAT},2,10,4.8,4.9`,
    `T5B ${RUN} rising,30000,${CAT},18,12,4.7,4.8`,
    `T5B ${RUN} early,2000,${CAT},70,9,4.6,4.7`,
  ].join('\n');

  test('import computes the auto category peak (avg of #1–#2) and phases', async () => {
    const res = await manager.post('/api/scraping/trends/import-csv', { csv, platform: 'lazada' });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.data.created, 4);
    const b = await db.one('SELECT peak_sold, source FROM trend_category_benchmarks WHERE org_id = 1 AND platform = :p AND category = :c', {
      p: 'lazada',
      c: CAT,
    });
    assert.equal(Number(b.peak_sold), 100_000);
    assert.equal(b.source, 'auto');
    const rising = await byTitle(`T5B ${RUN} rising`);
    assert.equal(rising.lifecycle_phase, '3');
    assert.equal(Number(rising.phase_ratio), 30);
    assert.equal((await byTitle(`T5B ${RUN} early`)).lifecycle_phase, '1');
    assert.equal((await byTitle(`T5B ${RUN} top1`)).lifecycle_phase, 'A');
  });

  test('list: pick sort is the default, phase and top-10 filters', async () => {
    const all = await viewer.get(`/api/scraping/trends?platform=lazada&q=${encodeURIComponent(`T5B ${RUN}`)}`);
    assert.equal(all.status, 200);
    assert.equal(all.body.data.length, 4);
    assert.equal(all.body.data[0].title, `T5B ${RUN} rising`);
    assert.ok(all.body.data[0].pickScore >= all.body.data[1].pickScore);
    assert.equal(all.body.data[0].phase, '3');
    assert.equal(typeof all.body.data[0].checklistPassed, 'number');
    const mid = await viewer.get(`/api/scraping/trends?platform=lazada&phase=2-4&q=${encodeURIComponent(`T5B ${RUN}`)}`);
    assert.deepEqual(
      mid.body.data.map((t) => t.title),
      [`T5B ${RUN} rising`],
    );
    const hidden = await viewer.get(`/api/scraping/trends?platform=lazada&hideTop10=1&q=${encodeURIComponent(`T5B ${RUN}`)}`);
    assert.equal(hidden.body.data.length, 2);
    assert.ok(hidden.body.data.every((t) => t.categoryRank > 10));
    const notHidden = await viewer.get(`/api/scraping/trends?platform=lazada&hideTop10=0&q=${encodeURIComponent(`T5B ${RUN}`)}`);
    assert.equal(notHidden.body.data.length, 4);
    assert.equal((await viewer.get('/api/scraping/trends?phase=bogus')).status, 400);
  });

  test('manual benchmark overrides auto, null returns to auto', async () => {
    assert.equal((await viewer.put('/api/scraping/benchmarks', { platform: 'lazada', category: CAT, peakSold: 300000 })).status, 403);
    const set = await marketer.put('/api/scraping/benchmarks', { platform: 'lazada', category: CAT, peakSold: 300000 });
    assert.equal(set.status, 200, JSON.stringify(set.body));
    assert.deepEqual(set.body.data, { peak: 300000, source: 'manual' });
    assert.equal((await byTitle(`T5B ${RUN} rising`)).lifecycle_phase, '2'); // 10% of 300k
    // A new import does not overwrite the manual figure
    await manager.post('/api/scraping/trends/import-csv', { csv: `ชื่อสินค้า,ขายแล้ว,หมวดหมู่\nT5B ${RUN} huge,500000,${CAT}`, platform: 'lazada' });
    const b = await db.one('SELECT peak_sold, source FROM trend_category_benchmarks WHERE platform = :p AND category = :c', { p: 'lazada', c: CAT });
    assert.equal(Number(b.peak_sold), 300000);
    const list = await viewer.get('/api/scraping/benchmarks');
    const row = list.body.data.find((r) => r.category === CAT);
    assert.equal(row.items, 5);
    assert.equal(row.source, 'manual');
    // Back to auto: avg of 500k and 110k
    const reset = await marketer.put('/api/scraping/benchmarks', { platform: 'lazada', category: CAT, peakSold: null });
    assert.deepEqual(reset.body.data, { peak: 305000, source: 'auto' });
  });

  test('PATCH facts and manual checks re-scores the item', async () => {
    const t = await byTitle(`T5B ${RUN} rising`);
    const before = await viewer.get(`/api/scraping/trends/${t.id}`);
    assert.equal(before.status, 200);
    assert.equal(before.body.data.checklist.length, 9);
    assert.deepEqual(before.body.data.benchmark, { peak: 305000, source: 'auto' });
    assert.ok(before.body.data.phaseNotes.reasons.length > 0);

    assert.equal((await viewer.patch(`/api/scraping/trends/${t.id}`, { shopResponseRate: 90 })).status, 403);
    assert.equal((await marketer.patch(`/api/scraping/trends/${t.id}`, { bogus: 1 })).status, 400);
    assert.equal((await marketer.patch(`/api/scraping/trends/${t.id}`, { shopResponseRate: 140 })).status, 400);
    const res = await marketer.patch(`/api/scraping/trends/${t.id}`, {
      shopResponseRate: 95,
      shopShip48Rate: 80,
      mediaReviewCount: 40,
      hasFlashSale: true,
      manualChecks: { positiveReviews: true },
    });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const st = Object.fromEntries(res.body.data.checklist.map((c) => [c.key, c.status]));
    assert.equal(st.responseRate, 'pass');
    assert.equal(st.ship48, 'pass');
    assert.equal(st.flashSale, 'pass');
    assert.equal(st.positiveReviews, 'pass');
    assert.equal(res.body.data.manualChecks.positiveReviews, true);
    assert.ok(res.body.data.pickScore > Number(t.pick_score), `${res.body.data.pickScore} > ${t.pick_score}`);
    assert.ok(res.body.data.checklistPassed > Number(t.checklist_passed));
    // Clearing a manual answer
    const cleared = await marketer.patch(`/api/scraping/trends/${t.id}`, { manualChecks: { positiveReviews: null } });
    assert.deepEqual(cleared.body.data.manualChecks, {});
    // Moving the sold count changes the category peak and the phase
    const moved = await marketer.patch(`/api/scraping/trends/${t.id}`, { soldCount: 600000 });
    assert.equal(moved.body.data.phase, 'A');
    // Status-only patch still works
    assert.equal((await marketer.patch(`/api/scraping/trends/${t.id}`, { status: 'watching' })).status, 200);
  });

  test('backend rescoring agrees with the seeded lifecycle data', async () => {
    const seeded = await db.one('SELECT id, lifecycle_phase, pick_score FROM trending_products WHERE id = 9');
    await db.tx((conn) => recomputeCategory(conn, 1, 'shopee', 'เสื้อยืด'));
    const again = await db.one('SELECT lifecycle_phase, pick_score FROM trending_products WHERE id = 9');
    assert.equal(seeded.lifecycle_phase, '3');
    assert.equal(again.lifecycle_phase, seeded.lifecycle_phase);
    assert.equal(Number(again.pick_score), Number(seeded.pick_score));
  });
});

describe('channel profiles', () => {
  test('CRUD with permissions; one default per org', async () => {
    const body = {
      name: `T5B ${RUN}`,
      persona: 'ผู้ชายอายุ 35 ชอบตกปลาและตั้งแคมป์ เลี้ยงหมา 1 ตัว',
      interests: ['ตกปลา', 'แคมป์'],
      audience: 'ผู้ชาย 25–45',
      onCamera: false,
    };
    assert.equal((await viewer.post('/api/scraping/channel-profiles', body)).status, 403);
    assert.equal((await marketer.post('/api/scraping/channel-profiles', { ...body, persona: 'สั้น' })).status, 400);
    const res = await marketer.post('/api/scraping/channel-profiles', body);
    assert.equal(res.status, 201, JSON.stringify(res.body));
    createdProfiles.push(res.body.data.id);
    assert.equal(res.body.data.isDefault, false); // seed already has a default
    assert.deepEqual(res.body.data.interests, ['ตกปลา', 'แคมป์']);
    const upd = await marketer.put(`/api/scraping/channel-profiles/${res.body.data.id}`, { ...body, isDefault: true });
    assert.equal(upd.body.data.isDefault, true);
    const list = await viewer.get('/api/scraping/channel-profiles');
    assert.equal(list.body.data.filter((p) => p.isDefault).length, 1);
    assert.equal(list.body.data[0].id, res.body.data.id);
  });

  test('AI channel plan via MiniMax forced tool', async () => {
    const id = createdProfiles[0];
    delete process.env.MINIMAX_API_KEY;
    assert.equal((await marketer.post(`/api/scraping/channel-profiles/${id}/plan`, {})).status, 503);
    process.env.MINIMAX_API_KEY = 'test-key';
    let captured;
    minimax.createMessage = async (params) => {
      captured = params;
      return toolReply('submit_channel_plan', {
        concept: 'ช่องสายแคมป์สายประหยัด',
        channelNames: ['แคมป์ไปเรื่อย', 'ตกปลากับเจ้าตูบ', 'Camp Easy'],
        contentFormats: ['ถ่ายมือจัดอุปกรณ์', 'พากย์เสียงทับวิดีโอทริป'],
        identity: 'โทนสบาย ๆ เป็นกันเอง',
        promotionPlan: ['โพสต์วันละคลิป'],
        contentExamples: ['จัดกระเป๋าแคมป์ 1 คืน'],
        productCategories: [{ category: 'อุปกรณ์แคมป์ปิ้ง', why: 'ตรงกับงานอดิเรก', keywords: ['เก้าอี้แคมป์', 'ไฟแคมป์'] }, { why: 'no category' }],
      });
    };
    const res = await marketer.post(`/api/scraping/channel-profiles/${id}/plan`, {});
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.deepEqual(captured.toolChoice, { type: 'tool', name: 'submit_channel_plan' });
    assert.match(captured.system, /Top 100/);
    assert.match(captured.messages[0].content[0].text, /ตกปลา/);
    assert.match(captured.messages[0].content[0].text, /ไม่ออกหน้ากล้อง/);
    const plan = res.body.data.aiPlan;
    assert.equal(plan.provider, 'minimax');
    assert.equal(plan.channelNames.length, 3);
    assert.equal(plan.productCategories.length, 1); // entries without a category dropped
    assert.deepEqual(plan.productCategories[0].keywords, ['เก้าอี้แคมป์', 'ไฟแคมป์']);
    assert.ok(res.body.data.aiPlannedAt);
  });

  test('trend analysis prompt includes phase, checklist and the default channel profile', async () => {
    process.env.MINIMAX_API_KEY = 'test-key';
    let captured;
    minimax.createMessage = async (params) => {
      captured = params;
      return toolReply('submit_analysis', {
        fitScore: 8,
        verdict: 'Phase 3 ยังทันกระแส',
        targetAudience: 'วัยรุ่น',
        sellingPoints: ['ผ้านุ่ม'],
        videoHooks: ['a', 'b', 'c'],
        contentAngle: 'ลองใส่',
        risks: [],
        suggestedPrice: 199,
        phaseComment: 'อยู่ช่วงขาขึ้น',
        channelFit: 'เข้ากับช่องแคมป์พอใช้',
      });
    };
    const res = await marketer.post('/api/scraping/trends/9/analyze', { refresh: true });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const text = captured.messages[0].content[0].text;
    assert.match(text, /Phase วงจรชีวิต/);
    assert.match(text, /"3"/);
    assert.match(text, /เช็กลิสต์/);
    assert.match(text, new RegExp(`T5B ${RUN}`)); // the default profile set above
    assert.match(captured.system, /อันดับ 11/);
    assert.equal(res.body.data.analysis.channelFit, 'เข้ากับช่องแคมป์พอใช้');
    assert.equal(res.body.data.analysis.channelProfile.id, createdProfiles[0]);
    assert.equal((await marketer.post('/api/scraping/trends/9/analyze', { refresh: true, channelProfileId: 999999 })).status, 404);
  });

  test('delete profile', async () => {
    const id = createdProfiles[0];
    assert.equal((await viewer.delete(`/api/scraping/channel-profiles/${id}`)).status, 403);
    assert.equal((await marketer.delete(`/api/scraping/channel-profiles/${id}`)).status, 200);
    assert.equal((await marketer.delete(`/api/scraping/channel-profiles/${id}`)).status, 404);
  });
});
