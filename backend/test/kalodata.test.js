'use strict';

// Kalodata: the 30-point selection score, the monthly pull (switch, schedule, steps, credits),
// the category report, product groups, per-product extras with a 14-day cache.
process.env.NODE_ENV = 'test';
process.env.KALODATA_API_KEY = 'test-key';
process.env.KALODATA_API_BASE = 'https://kalo.test/openapi/v1';
process.env.KALODATA_MIN_GAP_MS = '0';

const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { createApp } = require('../src/app');
const db = require('../src/db/pool');
const runtime = require('../src/config/runtime');
const mock = require('./helpers/kalodata-mock');
const svc = require('../src/modules/scraping/kalodata.service');
const { selectScore } = require('../src/modules/scraping/select-score');

const app = createApp();
const PERIOD = '2026-09';
let admin;
let cashier;
let restoreFetch;

async function as(email) {
  const res = await request(app).post('/api/auth/login').send({ email, password: 'Admin@1234' });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const cookie = res.headers['set-cookie'].map((c) => c.split(';')[0]).join('; ');
  return {
    get: (url) => request(app).get(url).set('Cookie', cookie),
    post: (url, body) => request(app).post(url).set('Cookie', cookie).send(body),
    put: (url, body) => request(app).put(url).set('Cookie', cookie).send(body),
    patch: (url, body) => request(app).patch(url).set('Cookie', cookie).send(body),
  };
}

async function cleanup() {
  await db.query("DELETE FROM trending_products WHERE org_id = 1 AND platform = 'kalodata'");
  await db.query("DELETE FROM trend_category_benchmarks WHERE org_id = 1 AND platform = 'kalodata'");
  await db.query('DELETE FROM trend_categories WHERE org_id = 1');
  await db.query("DELETE FROM scrape_sources WHERE org_id = 1 AND platform = 'kalodata'");
  await db.query("DELETE FROM settings WHERE org_id = 1 AND setting_key = 'trends.kalodata'");
  await db.query("DELETE FROM jobs WHERE type = 'kalodata.step'");
}

/** Drive a run to the end the way the job queue would. */
async function finishRun(runId) {
  for (let i = 0; i < 200; i += 1) {
    const r = await svc.step({ runId });
    if (!r.remaining) return r;
  }
  throw new Error('run did not finish');
}

before(async () => {
  await runtime.load();
  restoreFetch = mock.installFetch(process.env.KALODATA_API_BASE);
  await cleanup();
  admin = await as('admin@example.com');
  cashier = await as('cashier@example.com');
});

after(async () => {
  await cleanup();
  restoreFetch();
  await db.pool.end();
});

describe('selection score (30 points)', () => {
  test('scores the five data criteria, leaves content to a person, and gives a verdict', () => {
    const s = selectScore({ monthlySold: 2000, categoryRank: 14, growthRate: 30, price: 300, commissionRate: 12, creatorCount: 30, top3ShopRatio: 30, rating: 4.8, reviewCount: 500, phase: '3' });
    const by = Object.fromEntries(s.items.map((i) => [i.key, i.score]));
    assert.deepEqual(by, { demand: 4, trend: 4, commission: 4, competition: 4, content: null, trust: 5 });
    assert.equal(s.total, 21);
    assert.equal(s.known, 5);
    assert.equal(s.projected, 25);
    assert.equal(s.verdict, 'test');
    assert.deepEqual(s.stops, []);
  });

  test('stop rules and a crowded top-10 product', () => {
    const s = selectScore({ monthlySold: 9000, categoryRank: 2, growthRate: -40, price: 50, commissionRate: 5, creatorCount: 3000, top3ShopRatio: 70, rating: 3.6, phase: 'C', contentScore: 2 });
    const by = Object.fromEntries(s.items.map((i) => [i.key, i.score]));
    assert.equal(by.competition, 1);
    assert.equal(by.content, 2);
    assert.equal(s.verdict, 'skip');
    assert.equal(s.stops.length, 3);
  });

  test('too little data gives no verdict', () => {
    assert.equal(selectScore({ monthlySold: 100 }).verdict, 'insufficient');
  });
});

describe('monthly pull', () => {
  test('credits are asked separately from the settings', async () => {
    const res = await admin.get('/api/scraping/kalodata/balance');
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.data, { balance: 315, error: null });
  });

  test('off by default; the schedule does nothing until switched on', async () => {
    const res = await admin.get('/api/scraping/kalodata/settings');
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.data.enabled, false);
    assert.equal(res.body.data.configured, true);
    assert.equal(await svc.scheduleMonthly(new Date('2026-10-05T03:00:00Z')), 0);
  });

  test('one category by default: nothing chosen → no pull, by hand or by schedule', async () => {
    const res = await admin.post('/api/scraping/kalodata/run', { period: PERIOD });
    assert.equal(res.status, 400);
    assert.match(res.body.error.message, /เลือกหมวด/);
    await admin.put('/api/scraping/kalodata/settings', { enabled: true });
    assert.equal(await svc.scheduleMonthly(new Date('2026-10-05T03:00:00Z')), 0);
    const st = await admin.get('/api/scraping/kalodata/settings');
    assert.equal(st.body.data.scope, 'category');
    assert.equal(st.body.data.estimateCredits, null);
  });

  test('switched on: starts once the day comes, never twice for a month', async () => {
    // the whole market (the old behaviour) when chosen
    const put = await admin.put('/api/scraping/kalodata/settings', { enabled: true, dayOfMonth: 3, scope: 'all' });
    assert.equal(put.body.data.estimateCredits, 30);
    assert.equal(put.status, 200, JSON.stringify(put.body));
    assert.equal(await svc.scheduleMonthly(new Date('2026-10-02T03:00:00Z')), 0, 'before the set day');
    assert.equal(await svc.scheduleMonthly(new Date('2026-10-05T03:00:00Z')), 1);
    assert.equal(await svc.scheduleMonthly(new Date('2026-10-05T04:00:00Z')), 0, 'one run at a time');
    const run = await svc.openRun(1);
    const r = await finishRun(run.id);
    assert.equal(r.done, true);
    const s = await svc.getSettings(1);
    assert.equal(s.lastPeriod, PERIOD);
    assert.equal(await svc.scheduleMonthly(new Date('2026-10-20T03:00:00Z')), 0, 'already pulled this month');
    // switched off → nothing even in a new month
    await admin.put('/api/scraping/kalodata/settings', { enabled: false });
    assert.equal(await svc.scheduleMonthly(new Date('2026-11-05T03:00:00Z')), 0);
  });

  test('stores categories with parents and history, products with phase and the 30-point score', async () => {
    const cats = await db.query('SELECT level, COUNT(*) AS n FROM trend_categories WHERE org_id = 1 AND period = :p GROUP BY level ORDER BY level', { p: PERIOD });
    assert.deepEqual(cats.map((c) => [c.level, Number(c.n)]), [[1, 6], [2, 24], [3, 72]]);
    const orphan = await db.one('SELECT COUNT(*) AS n FROM trend_categories WHERE org_id = 1 AND period = :p AND level > 1 AND parent_id IS NULL', { p: PERIOD });
    assert.equal(Number(orphan.n), 0);
    // category endpoints take rolling windows only: one month per pull, history builds up month by month
    const months = await db.one("SELECT COUNT(DISTINCT period) AS n FROM trend_categories WHERE org_id = 1 AND level = 1");
    assert.equal(Number(months.n), 1);
    const catCalls = mock.state.calls.filter((c) => c.path.includes('/tiktok/category/'));
    assert.ok(catCalls.every((c) => c.body.date_range === 'last30Day'));
    const productCalls = mock.state.calls.filter((c) => c.path.endsWith('/tiktok/product/rank'));
    assert.ok(productCalls.every((c) => c.body.date_range === PERIOD), 'products use the calendar month');
    const detail = await db.one("SELECT live_revenue, revenue_trend FROM trend_categories WHERE org_id = 1 AND period = :p AND category_id = '1001'", { p: PERIOD });
    assert.ok(Number(detail.live_revenue) > 0);

    const p = await db.one(
      "SELECT * FROM trending_products WHERE org_id = 1 AND platform = 'kalodata' AND external_id = '10011005'",
    );
    assert.equal(p.kalo_category_id, '10011');
    assert.equal(p.category, 'ดูแลผิวหน้า');
    assert.equal(p.category_rank, 5);
    assert.ok(p.monthly_sold > 0 && p.prev_monthly_sold > 0);
    assert.ok(p.lifecycle_phase, 'phase from the level-2 category peak');
    assert.ok(p.select_score > 0);
    const hist = await db.one('SELECT sales, rank_in_category FROM trend_product_months WHERE trending_product_id = :id AND period = :p', { id: p.id, p: PERIOD });
    assert.equal(Number(hist.sales), Number(p.monthly_sold));

    // products only seen in the market-wide lists got their category from the detail call
    const fresh = await db.one("SELECT kalo_category_id, creator_count FROM trending_products WHERE org_id = 1 AND platform = 'kalodata' AND external_id LIKE '9%' LIMIT 1");
    assert.ok(fresh.kalo_category_id);
    assert.ok(fresh.creator_count != null);

    const run = (await admin.get('/api/scraping/kalodata/settings')).body.data.runs[0];
    assert.equal(run.status, 'succeeded');
    assert.ok(run.credits > 5 && run.credits < 45, `credits ${run.credits}`);
  });

  test('pulling the same month again adds no duplicate products', async () => {
    const before1 = await db.one("SELECT COUNT(*) AS n FROM trending_products WHERE org_id = 1 AND platform = 'kalodata'");
    const res = await admin.post('/api/scraping/kalodata/run', { period: PERIOD });
    assert.equal(res.status, 202, JSON.stringify(res.body));
    const again = await admin.post('/api/scraping/kalodata/run', { period: PERIOD });
    assert.equal(again.status, 409);
    await finishRun(res.body.data.runId);
    const after1 = await db.one("SELECT COUNT(*) AS n FROM trending_products WHERE org_id = 1 AND platform = 'kalodata'");
    assert.equal(Number(after1.n), Number(before1.n));
  });

  test('stops before spending when credits are low', async () => {
    mock.state.balance = 10;
    try {
      const res = await admin.post('/api/scraping/kalodata/run', { period: '2026-08' });
      assert.equal(res.status, 202);
      const r = await svc.step({ runId: res.body.data.runId });
      assert.match(r.failed, /เครดิต/);
      const row = await db.one('SELECT status FROM scrape_runs WHERE id = :id', { id: res.body.data.runId });
      assert.equal(row.status, 'failed');
    } finally {
      mock.state.balance = 315;
    }
  });

  test('Kalodata unreachable: the pull fails instead of finishing empty', async () => {
    const real = global.fetch;
    global.fetch = async () => {
      throw new Error('fetch failed');
    };
    try {
      const res = await admin.post('/api/scraping/kalodata/run', { period: '2026-07' });
      assert.equal(res.status, 202);
      const r = await svc.step({ runId: res.body.data.runId });
      assert.match(r.failed ?? '', /fetch failed|เชื่อมต่อ/);
      const row = await db.one('SELECT status FROM scrape_runs WHERE id = :id', { id: res.body.data.runId });
      assert.equal(row.status, 'failed');
    } finally {
      global.fetch = real;
    }
  });

  test('only finished months can be pulled', async () => {
    const res = await admin.post('/api/scraping/kalodata/run', { period: '2099-01' });
    assert.equal(res.status, 400);
  });
});

describe('category report', () => {
  test('level-1 table with sparkline, opportunity tags and market summary', async () => {
    const res = await admin.get(`/api/scraping/categories?period=${PERIOD}&level=1&sort=revenue`);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const d = res.body.data;
    assert.equal(d.items.length, 6);
    assert.ok(d.items[0].revenue >= d.items[1].revenue);
    assert.equal(d.items[0].trend.length, 1);
    assert.equal(d.items[0].childCount, 4);
    assert.ok(d.items.every((i) => typeof i.opportunity === 'boolean'));
    assert.ok(d.summary.revenue > 0 && d.summary.growth != null);
    assert.ok(d.summary.fastest?.name);
    assert.equal(d.periods[0], PERIOD);
  });

  test('drill down: children, breadcrumb, category page with channels', async () => {
    const kids = await admin.get(`/api/scraping/categories?period=${PERIOD}&parentId=1001`);
    assert.equal(kids.body.data.items.length, 4);
    assert.deepEqual(kids.body.data.breadcrumb.map((b) => b.id), ['1001']);
    const page = await admin.get('/api/scraping/categories/1001');
    assert.equal(page.status, 200);
    assert.equal(page.body.data.children.length, 4);
    assert.ok(page.body.data.channelAdvice?.advice);
    assert.equal(page.body.data.history.length, 1);
    const leaf = await admin.get('/api/scraping/categories/100111');
    assert.deepEqual(leaf.body.data.breadcrumb.map((b) => b.level), [1, 2, 3]);
  });

  test('products of a category by group', async () => {
    const all = await admin.get('/api/scraping/trends?kaloCategory=1001&group=bestseller&pageSize=100');
    assert.equal(all.status, 200, JSON.stringify(all.body));
    assert.ok(all.body.data.length > 50);
    assert.ok(all.body.data.every((t) => t.kaloCategoryId.startsWith('1001')));
    assert.ok(all.body.data[0].revenue >= all.body.data[1].revenue);
    const rising = await admin.get('/api/scraping/trends?kaloCategory=1001&group=rising&pageSize=100');
    assert.ok(rising.body.data.every((t) => t.revenueGrowth >= 20));
    const pricey = await admin.get('/api/scraping/trends?kaloCategory=10011&minPrice=500&pageSize=100');
    assert.ok(pricey.body.data.every((t) => t.price >= 500 && t.kaloCategoryId === '10011'));
  });

  test('people without trend access cannot read the report', async () => {
    const res = await cashier.get('/api/scraping/categories');
    assert.equal(res.status, 403);
  });
});

describe('product page extras', () => {
  test('detail carries months, category path, score; extras cost once then come from cache', async () => {
    const p = await db.one("SELECT id FROM trending_products WHERE org_id = 1 AND platform = 'kalodata' AND external_id = '10011005'");
    const d = await admin.get(`/api/scraping/trends/${p.id}`);
    assert.equal(d.status, 200);
    assert.equal(d.body.data.months.length, 1);
    assert.deepEqual(d.body.data.categoryPath.map((c) => c.level), [1, 2]);
    assert.ok(d.body.data.selectDetail.items.length === 6);

    const first = await admin.post(`/api/scraping/trends/${p.id}/kalodata/comments`);
    assert.equal(first.status, 200, JSON.stringify(first.body));
    assert.equal(first.body.data.cached, false);
    assert.equal(first.body.data.credits, 1);
    assert.ok(first.body.data.data.pain_points.length);
    const calls = mock.state.calls.length;
    const second = await admin.post(`/api/scraping/trends/${p.id}/kalodata/comments`);
    assert.equal(second.body.data.cached, true);
    assert.equal(mock.state.calls.length, calls, 'no call to Kalodata');

    const videos = await admin.post(`/api/scraping/trends/${p.id}/kalodata/videos`);
    assert.equal(videos.body.data.data.length, 5);
    const again = await admin.get(`/api/scraping/trends/${p.id}`);
    assert.ok(again.body.data.extras.comments && again.body.data.extras.videos);
  });

  test('content score from a person feeds the 30-point score', async () => {
    const p = await db.one("SELECT id, select_score FROM trending_products WHERE org_id = 1 AND platform = 'kalodata' AND external_id = '10011005'");
    const patch = await admin.patch(`/api/scraping/trends/${p.id}`, { contentScore: 5 });
    assert.equal(patch.status, 200, JSON.stringify(patch.body));
    assert.equal(patch.body.data.selectScore, Number(p.select_score) + 5);
    assert.equal(patch.body.data.selectDetail.items.find((i) => i.key === 'content').score, 5);
  });
});

describe('one category only', () => {
  const runFor = async (categoryId) => {
    const put = await admin.put('/api/scraping/kalodata/settings', { categoryId });
    assert.equal(put.status, 200, JSON.stringify(put.body));
    await db.query("DELETE FROM trending_products WHERE org_id = 1 AND platform = 'kalodata'");
    mock.state.calls.length = 0;
    const res = await admin.post('/api/scraping/kalodata/run', { period: PERIOD });
    assert.equal(res.status, 202, JSON.stringify(res.body));
    await finishRun(res.body.data.runId);
    return { status: put.body.data, run: (await admin.get('/api/scraping/kalodata/settings')).body.data.runs[0] };
  };

  test('the picker searches pulled categories by name and parent, for free', async () => {
    const calls = mock.state.calls.length;
    const res = await admin.get(`/api/scraping/kalodata/category-options?q=${encodeURIComponent('ดูแลผิว')}`);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const skin = res.body.data.items.find((i) => i.id === '10011');
    assert.equal(skin.path, 'ความงามและของใช้ส่วนตัว');
    assert.ok(res.body.data.items.some((i) => i.level === 3 && i.path === 'ความงามและของใช้ส่วนตัว › ดูแลผิวหน้า'));
    const byParent = await admin.get(`/api/scraping/kalodata/category-options?q=${encodeURIComponent('แม่และเด็ก')}`);
    assert.ok(byParent.body.data.items.length >= 5, 'the category and those under it');
    assert.equal(mock.state.calls.length, calls);
  });

  test('a level-2 pick asks Kalodata about that category only and costs a few credits', async () => {
    const { status, run } = await runFor('10011');
    assert.equal(status.category.name, 'ดูแลผิวหน้า');
    assert.equal(status.category.path, 'ความงามและของใช้ส่วนตัว');
    assert.equal(status.estimateCredits, 4);
    assert.equal(run.status, 'succeeded', JSON.stringify(run));
    const kaloCalls = mock.state.calls.filter((c) => c.path.includes('/tiktok/category/rank') || c.path.includes('/tiktok/product/rank'));
    assert.ok(kaloCalls.every((c) => JSON.stringify(c.body.category_ids) === '["10011"]'), JSON.stringify(kaloCalls.map((c) => c.body.category_ids)));
    const cats = await db.query("SELECT category_id FROM trend_categories WHERE org_id = 1 AND period = :p AND (category_id = '10011' OR parent_id = '10011')", { p: PERIOD });
    assert.equal(cats.length, 4, 'itself + 3 children');
    const prods = await db.query("SELECT kalo_category_id FROM trending_products WHERE org_id = 1 AND platform = 'kalodata'");
    assert.ok(prods.length >= 100);
    assert.ok(prods.every((x) => x.kalo_category_id === '10011'));
    const details = mock.state.calls.filter((c) => c.path.endsWith('/tiktok/product/detail'));
    assert.ok(details.length <= 30, `${details.length} details`);
    assert.ok(run.credits < 6, `credits ${run.credits}`);

    const report = await admin.get(`/api/scraping/categories?period=${PERIOD}`);
    assert.equal(report.body.data.summary.scope.id, '10011');
    assert.equal(report.body.data.summary.scope.focusParentId, '10011');
    assert.equal(report.body.data.summary.fastest.level, 3);
    const auto = await admin.get(`/api/scraping/categories?period=${PERIOD}&auto=1`);
    assert.equal(auto.body.data.parentId, '10011');
    assert.equal(auto.body.data.items.length, 3);
    assert.deepEqual(auto.body.data.breadcrumb.map((b) => b.id), ['1001', '10011']);
  });

  test('a level-3 pick files products under that leaf', async () => {
    const { run } = await runFor('100111');
    assert.equal(run.status, 'succeeded', JSON.stringify(run));
    const prods = await db.query("SELECT kalo_category_id, kalo_leaf_id, category FROM trending_products WHERE org_id = 1 AND platform = 'kalodata'");
    assert.ok(prods.length > 0);
    assert.ok(prods.every((x) => x.kalo_leaf_id === '100111' && x.kalo_category_id === '10011'));
    const list = await admin.get('/api/scraping/trends?kaloCategory=100111&status=all&pageSize=100');
    assert.equal(list.body.meta.total, prods.length);
    const report = await admin.get(`/api/scraping/categories?period=${PERIOD}`);
    assert.equal(report.body.data.summary.scope.focusParentId, '10011', 'no children: open at its parent');
  });

  test('a level-1 pick takes its sub-categories and their products', async () => {
    const { status, run } = await runFor('1002');
    assert.equal(status.estimateCredits, 6);
    assert.equal(run.status, 'succeeded', JSON.stringify(run));
    const prods = await db.query("SELECT DISTINCT kalo_category_id FROM trending_products WHERE org_id = 1 AND platform = 'kalodata'");
    assert.ok(prods.length >= 2);
    assert.ok(prods.every((x) => String(x.kalo_category_id).startsWith('1002')));
  });

  test('no categories yet: the picker offers to load the list', async () => {
    await db.query('DELETE FROM trend_categories WHERE org_id = 1');
    const empty = await admin.get('/api/scraping/kalodata/category-options');
    assert.equal(empty.body.data.needsLoad, true);
    const load = await admin.post('/api/scraping/kalodata/category-options/load');
    assert.equal(load.status, 200, JSON.stringify(load.body));
    assert.equal(load.body.data.categories, 30);
    const opts = await admin.get('/api/scraping/kalodata/category-options');
    assert.equal(opts.body.data.items.length, 30);
    assert.ok(opts.body.data.items.find((i) => i.id === '10011').path);
  });
});
