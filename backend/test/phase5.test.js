'use strict';

// Phase 5 integration tests: trend sources, scoring, CSV import, AI analysis (MiniMax mocked),
// import to catalog, affiliate links. Requires schema.sql + seed.sql (+ migrations) imported.
process.env.NODE_ENV = 'test';

const crypto = require('node:crypto');
const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { createApp } = require('../src/app');
const db = require('../src/db/pool');
const { runDue } = require('../src/jobs/runner');
const minimax = require('../src/integrations/minimax');
const shopeeAffiliate = require('../src/integrations/shopee-affiliate');
const { trendScore, soldVelocity } = require('../src/modules/scraping/score');
const { parseCsv, parseNumber, csvToItems } = require('../src/modules/scraping/csv');
const { robotsAllows, extractJsonLdProducts } = require('../src/modules/scraping/sources');

const app = createApp();
const RUN = Date.now().toString(36);
const originalFetch = global.fetch;
const originalCreate = minimax.createMessage;
const ENV_KEYS = ['SHOPEE_AFFILIATE_APP_ID', 'SHOPEE_AFFILIATE_SECRET', 'APIFY_TOKEN', 'MINIMAX_API_KEY', 'AI_PROVIDER'];
const savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
let routes = {}; // url substring -> handler(url, init) returning Response
const calls = [];
const created = { sources: [], products: [] };
let manager;
let marketer;
let viewer;
let cashier;

async function cookie(email) {
  const res = await request(app).post('/api/auth/login').send({ email, password: 'Admin@1234' });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  return res.headers['set-cookie'].map((c) => c.split(';')[0]).join('; ');
}
const as = (c) => ({
  get: (url) => request(app).get(url).set('Cookie', c),
  post: (url, body) => request(app).post(url).set('Cookie', c).send(body),
  patch: (url, body) => request(app).patch(url).set('Cookie', c).send(body),
  delete: (url) => request(app).delete(url).set('Cookie', c),
});
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** Drain queued jobs, but only ours: other suites' leftovers are not touched. */
async function drainJobs() {
  await db.query("UPDATE jobs SET run_at = UTC_TIMESTAMP() WHERE status = 'queued' AND type IN ('scrape.run','scrape.poll')");
  await db.query("UPDATE jobs SET run_at = UTC_TIMESTAMP() + INTERVAL 1 DAY WHERE status = 'queued' AND type NOT IN ('scrape.run','scrape.poll')");
  return runDue({ maxJobs: 50 });
}
async function newSource(body) {
  const res = await manager.post('/api/scraping/sources', body);
  assert.equal(res.status, 201, JSON.stringify(res.body));
  created.sources.push(res.body.data.id);
  return res.body.data.id;
}

before(async () => {
  global.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    const key = Object.keys(routes).find((k) => String(url).includes(k));
    if (!key) return new Response('not found', { status: 404 });
    return routes[key](String(url), init);
  };
  delete process.env.AI_PROVIDER;
  manager = as(await cookie('manager@example.com'));
  marketer = as(await cookie('marketer@example.com'));
  viewer = as(await cookie('viewer@example.com'));
  cashier = as(await cookie('cashier@example.com'));
});

after(async () => {
  global.fetch = originalFetch;
  minimax.createMessage = originalCreate;
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
  await db.query("DELETE FROM jobs WHERE type IN ('scrape.run','scrape.poll')");
  await db.query("UPDATE jobs SET run_at = UTC_TIMESTAMP() WHERE status = 'queued' AND run_at > UTC_TIMESTAMP() + INTERVAL 20 HOUR");
  await db.query("DELETE FROM affiliate_links WHERE sub_id LIKE 'trend%' OR sub_id LIKE 'camp%'");
  await db.query("DELETE FROM trending_products WHERE org_id = 1 AND (external_id LIKE 't5-%' OR title LIKE 'T5 %')");
  await db.query("UPDATE trending_products SET status = 'new', imported_product_id = NULL, ai_analysis = NULL, ai_analyzed_at = NULL, affiliate_link_id = NULL WHERE id = 2");
  if (created.products.length) await db.query('DELETE FROM products WHERE id IN (:ids)', { ids: created.products });
  if (created.sources.length) await db.query('DELETE FROM scrape_sources WHERE id IN (:ids)', { ids: created.sources });
  await db.pool.end();
});

describe('scoring and parsing (unit)', () => {
  test('trend score rewards velocity most and stays within 0–100', () => {
    const slow = trendScore({ velocity: 10, soldCount: 50_000, rating: 4.8, commissionRate: 10 });
    const fast = trendScore({ velocity: 1500, soldCount: 5_000, rating: 4.8, commissionRate: 10 });
    assert.ok(fast > slow, `${fast} > ${slow}`);
    assert.equal(trendScore({ velocity: 1e9, soldCount: 1e9, rating: 5, commissionRate: 90 }), 100);
    assert.equal(trendScore({ velocity: null, soldCount: null, rating: 1, commissionRate: null }), 0);
  });

  test('velocity needs two snapshots at least 20h apart', () => {
    const now = Date.now();
    const at = (h) => new Date(now - h * 3600_000);
    assert.equal(soldVelocity([{ capturedAt: at(0), soldCount: 1000 }, { capturedAt: at(5), soldCount: 900 }]), null);
    assert.equal(soldVelocity([{ capturedAt: at(0), soldCount: 1000 }, { capturedAt: at(5), soldCount: 990 }, { capturedAt: at(48), soldCount: 600 }]), 200);
  });

  test('CSV parser handles BOM, quotes, Thai headers and shorthand numbers', () => {
    const csv = '﻿ชื่อสินค้า,ราคา,ยอดขาย,ค่าคอม,ร้าน\n"ครีม, กันแดด ""SPF50""","฿1,290",1.2k,0.12,ร้าน A\r\n,99,1,1,x\nเซรั่ม,350,"5,400",15%,ร้าน B\n';
    assert.deepEqual(parseCsv(csv)[1], ['ครีม, กันแดด "SPF50"', '฿1,290', '1.2k', '0.12', 'ร้าน A']);
    const r = csvToItems(csv, { platform: 'shopee' });
    assert.equal(r.items.length, 2);
    assert.deepEqual(r.errors, [{ row: 3, message: 'ไม่มีชื่อสินค้า' }]);
    assert.equal(r.items[0].price, 1290);
    assert.equal(r.items[0].soldCount, 1200);
    assert.equal(r.items[0].commissionRate, 12);
    assert.equal(r.items[1].commissionRate, 15);
    assert.equal(parseNumber('2.5หมื่น'), 25_000);
    assert.equal(parseNumber('abc'), null);
  });

  test('JSON-LD products are extracted from @graph and arrays', () => {
    const html = `<script type="application/ld+json">{"@graph":[{"@type":"WebPage"},{"@type":"Product","name":"กระเป๋า","sku":"B1","offers":{"price":"590"}}]}</script>
      <script type="application/ld+json">[{"@type":["Product"],"name":"หมวก"}]</script><script type="application/ld+json">{bad</script>`;
    assert.deepEqual(extractJsonLdProducts(html).map((p) => p.name), ['กระเป๋า', 'หมวก']);
  });

  test('robots.txt: most specific rule wins, our agent group beats "*"', async () => {
    routes = {
      'shop.test/robots.txt': () => new Response('User-agent: *\nDisallow: /\n\nUser-agent: POSEnterpriseBot\nDisallow: /private\nAllow: /private/ok\n'),
    };
    assert.equal(await robotsAllows('https://shop.test/products/1'), true);
    assert.equal(await robotsAllows('https://shop.test/private/x'), false);
    assert.equal(await robotsAllows('https://shop.test/private/ok/1'), true);
    routes = { 'other.test/robots.txt': () => new Response('User-agent: *\nDisallow: /p/\n') };
    assert.equal(await robotsAllows('https://other.test/p/1'), false);
    routes = {};
    assert.equal(await robotsAllows('https://none.test/x'), true); // 404 robots = allowed
  });
});

describe('Shopee Affiliate source', () => {
  test('signature follows SHA256(appId + timestamp + payload + secret)', () => {
    const h = shopeeAffiliate.authorization('123', 'sec', '{"q":1}', 1700000000);
    const sig = crypto.createHash('sha256').update('1231700000000{"q":1}sec').digest('hex');
    assert.equal(h, `SHA256 Credential=123, Timestamp=1700000000, Signature=${sig}`);
  });

  test('run without keys is refused with the missing variable names', async () => {
    delete process.env.SHOPEE_AFFILIATE_APP_ID;
    delete process.env.SHOPEE_AFFILIATE_SECRET;
    const res = await manager.post('/api/scraping/sources/1/run');
    assert.equal(res.status, 503);
    assert.match(JSON.stringify(res.body), /SHOPEE_AFFILIATE_APP_ID/);
  });

  test('run → job fetches offers, upserts, snapshots and re-runs without duplicates', async () => {
    process.env.SHOPEE_AFFILIATE_APP_ID = 'app1';
    process.env.SHOPEE_AFFILIATE_SECRET = 'secret1';
    let sales = 1000;
    const bodies = [];
    routes = {
      'open-api.affiliate.shopee.co.th/graphql': (url, init) => {
        bodies.push({ auth: init.headers.Authorization, body: JSON.parse(init.body) });
        return json({
          data: {
            productOfferV2: {
              nodes: [
                { itemId: `t5-${RUN}-1`, productName: 'T5 ไม้ถูพื้นสเปรย์', priceMin: '259', sales, ratingStar: '4.8', commissionRate: '0.15', offerLink: 'https://shope.ee/x1', shopName: 'Clean Home', imageUrl: 'https://cf.shopee.co.th/a.jpg' },
                { itemId: `t5-${RUN}-2`, productName: 'T5 ถุงเก็บสูญญากาศ', priceMin: '199', sales: 50, ratingStar: null, commissionRate: '0.08', productLink: 'https://shopee.co.th/p2' },
              ],
              pageInfo: { page: 1, limit: 50, hasNextPage: false },
            },
          },
        });
      },
    };
    const sourceId = await newSource({ platform: 'shopee_affiliate', name: `T5 Shopee ${RUN}`, config: { keyword: 'บ้าน', sortType: 'sales' }, intervalHours: 6 });
    const run = await marketer.post(`/api/scraping/sources/${sourceId}/run`);
    assert.equal(run.status, 202, JSON.stringify(run.body));
    assert.equal((await marketer.post(`/api/scraping/sources/${sourceId}/run`)).status, 409); // one open run at a time
    await drainJobs();

    assert.equal(bodies.length, 1);
    assert.match(bodies[0].auth, /^SHA256 Credential=app1, Timestamp=\d+, Signature=[0-9a-f]{64}$/);
    assert.equal(bodies[0].body.variables.keyword, 'บ้าน');
    assert.equal(bodies[0].body.variables.sortType, 2);
    const runs = await viewer.get(`/api/scraping/runs?sourceId=${sourceId}`);
    assert.equal(runs.body.data[0].status, 'succeeded');
    assert.equal(runs.body.data[0].itemsFound, 2);
    assert.equal(runs.body.data[0].itemsNew, 2);

    const t = await db.one('SELECT * FROM trending_products WHERE external_id = :e', { e: `t5-${RUN}-1` });
    assert.equal(Number(t.commission_rate), 15);
    assert.equal(t.url, 'https://shope.ee/x1');
    assert.equal(t.shop_name, 'Clean Home');

    // Pretend the first snapshot was taken a day ago, then re-run with more sales
    await db.query('UPDATE trending_snapshots SET captured_at = UTC_TIMESTAMP() - INTERVAL 24 HOUR WHERE trending_product_id = :id', { id: t.id });
    sales = 1600;
    await db.query("UPDATE scrape_runs SET status = 'succeeded' WHERE source_id = :id", { id: sourceId });
    assert.equal((await marketer.post(`/api/scraping/sources/${sourceId}/run`)).status, 202);
    await drainJobs();
    const t2 = await db.one('SELECT * FROM trending_products WHERE id = :id', { id: t.id });
    assert.equal(Math.round(Number(t2.sold_velocity)), 600);
    assert.ok(Number(t2.trend_score) > Number(t.trend_score));
    const counts = await db.one('SELECT COUNT(*) AS n FROM trending_products WHERE external_id LIKE :e', { e: `t5-${RUN}-%` });
    assert.equal(Number(counts.n), 2);
    const runs2 = await viewer.get(`/api/scraping/runs?sourceId=${sourceId}`);
    assert.equal(runs2.body.data[0].itemsNew, 0);

    const detail = await viewer.get(`/api/scraping/trends/${t.id}`);
    assert.equal(detail.status, 200);
    assert.equal(detail.body.data.snapshots.length, 2);
    assert.equal(detail.body.data.snapshots.at(-1).soldCount, 1600);
  });

  test('API errors are recorded on the run and the source', async () => {
    routes = { 'open-api.affiliate.shopee.co.th/graphql': () => json({ errors: [{ message: 'Invalid Signature' }] }) };
    const sourceId = await newSource({ platform: 'shopee_affiliate', name: `T5 bad ${RUN}`, config: {} });
    await marketer.post(`/api/scraping/sources/${sourceId}/run`);
    await drainJobs();
    const src = (await viewer.get('/api/scraping/sources')).body.data.find((s) => s.id === sourceId);
    assert.match(src.lastError, /Invalid Signature/);
  });

  test('due sources are scheduled by the recurring tick', async () => {
    const sourceId = await newSource({ platform: 'shopee_affiliate', name: `T5 due ${RUN}`, config: {}, intervalHours: 1 });
    const { scheduleDueSources } = require('../src/modules/scraping/sources');
    await scheduleDueSources();
    const run = await db.one("SELECT id FROM scrape_runs WHERE source_id = :id AND status = 'running'", { id: sourceId });
    assert.ok(run);
    await scheduleDueSources(); // not twice while one is open
    const n = await db.one('SELECT COUNT(*) AS n FROM scrape_runs WHERE source_id = :id', { id: sourceId });
    assert.equal(Number(n.n), 1);
  });
});

describe('other sources', () => {
  test('Apify: start → poll until SUCCEEDED → dataset items mapped by fieldMap', async () => {
    process.env.APIFY_TOKEN = 'apify-t';
    let status = 'RUNNING';
    routes = {
      '/acts/me~trend-actor/runs': () => json({ data: { id: 'run1', defaultDatasetId: 'ds1', status: 'READY' } }),
      '/actor-runs/run1': () => json({ data: { id: 'run1', status, defaultDatasetId: 'ds1' } }),
      '/datasets/ds1/items': () => json([{ name: 'T5 แก้วกาแฟ', pid: `t5-${RUN}-ap`, cost: { value: 159 }, sold: 3000 }]),
    };
    const sourceId = await newSource({
      platform: 'apify',
      name: `T5 Apify ${RUN}`,
      config: { actorId: 'me/trend-actor', input: { q: 'mug' }, platform: 'other', fieldMap: { title: 'name', externalId: 'pid', price: 'cost.value' } },
    });
    await marketer.post(`/api/scraping/sources/${sourceId}/run`);
    await drainJobs(); // start
    const start = calls.find((c) => c.url.includes('/acts/me~trend-actor/runs'));
    assert.equal(start.init.headers.Authorization, 'Bearer apify-t');
    assert.deepEqual(JSON.parse(start.init.body), { q: 'mug' });
    await drainJobs(); // poll: still running → re-queued
    let run = await db.one('SELECT * FROM scrape_runs WHERE source_id = :id', { id: sourceId });
    assert.equal(run.status, 'running');
    assert.equal(run.external_run_id, 'run1');
    status = 'SUCCEEDED';
    await drainJobs();
    run = await db.one('SELECT * FROM scrape_runs WHERE source_id = :id', { id: sourceId });
    assert.equal(run.status, 'succeeded');
    const t = await db.one('SELECT * FROM trending_products WHERE external_id = :e', { e: `t5-${RUN}-ap` });
    assert.equal(Number(t.price), 159);
    assert.equal(t.platform, 'other');
  });

  test('custom URL: reads JSON-LD, refuses Shopee/TikTok and robots-disallowed pages', async () => {
    routes = {
      'brand.test/robots.txt': () => new Response('User-agent: *\nDisallow: /cart\n'),
      'brand.test/p/1': () =>
        new Response(`<html><script type="application/ld+json">{"@type":"Product","name":"T5 เสื่อโยคะ","sku":"t5-${RUN}-y","offers":{"price":"490"},"aggregateRating":{"ratingValue":"4.7"}}</script></html>`),
    };
    const ok = await newSource({ platform: 'custom_url', name: `T5 url ${RUN}`, config: { urls: ['https://brand.test/p/1'] } });
    await marketer.post(`/api/scraping/sources/${ok}/run`);
    const blocked = await newSource({ platform: 'custom_url', name: `T5 blocked ${RUN}`, config: { urls: ['https://brand.test/cart'] } });
    await marketer.post(`/api/scraping/sources/${blocked}/run`);
    const shopee = await newSource({ platform: 'custom_url', name: `T5 shopee ${RUN}`, config: { urls: ['https://shopee.co.th/item-1'] } });
    await marketer.post(`/api/scraping/sources/${shopee}/run`);
    await drainJobs();
    const t = await db.one('SELECT * FROM trending_products WHERE external_id = :e', { e: `t5-${RUN}-y` });
    assert.equal(Number(t.rating), 4.7);
    assert.equal(t.platform, 'brand.test');
    const status = async (id) => db.one('SELECT status, error FROM scrape_runs WHERE source_id = :id', { id });
    assert.match((await status(blocked)).error, /robots\.txt/);
    assert.match((await status(shopee)).error, /ไม่อนุญาต/);
    assert.equal(calls.some((c) => c.url.startsWith('https://shopee.co.th/')), false);
  });

  test('TikTok Shop source explains why it cannot run', async () => {
    const id = await newSource({ platform: 'tiktok_shop', name: `T5 tts ${RUN}`, config: {} });
    const res = await marketer.post(`/api/scraping/sources/${id}/run`);
    assert.equal(res.status, 400);
    assert.match(res.body.error.message, /ร้านตัวเอง/);
    const src = (await viewer.get('/api/scraping/sources')).body.data.find((s) => s.id === id);
    assert.equal(src.runnable, false);
  });
});

describe('trends API', () => {
  test('CSV preview then import', async () => {
    const csv = `Product Name,Item ID,Price,Units Sold,Commission Rate,Shop\nT5 หูฟังบลูทูธ,t5-${RUN}-c1,"1,290",8.5k,12%,Audio Pro\nT5 สายชาร์จ,t5-${RUN}-c2,99,25000,0.2,Cable Co\n`;
    const pre = await marketer.post('/api/scraping/trends/import-csv', { csv, platform: 'tiktok_shop', preview: true });
    assert.equal(pre.status, 200, JSON.stringify(pre.body));
    assert.equal(pre.body.data.total, 2);
    assert.equal(pre.body.data.mapping.soldCount, 3);
    const n0 = await db.one('SELECT COUNT(*) AS n FROM trending_products WHERE external_id LIKE :e', { e: `t5-${RUN}-c%` });
    assert.equal(Number(n0.n), 0);
    // The UI sends back the (partial) mapping it showed in the preview
    const imp = await marketer.post('/api/scraping/trends/import-csv', { csv, platform: 'tiktok_shop', mapping: pre.body.data.mapping });
    assert.equal(imp.status, 200);
    assert.equal(imp.body.data.created, 2);
    const again = await marketer.post('/api/scraping/trends/import-csv', { csv, platform: 'tiktok_shop' });
    assert.equal(again.body.data.created, 0);
    const bad = await marketer.post('/api/scraping/trends/import-csv', { csv: 'foo,bar\n1,2\n', platform: 'shopee' });
    assert.equal(bad.status, 400);
    assert.match(bad.body.error.message, /ชื่อสินค้า/);
  });

  test('list filters and sorts; viewer read-only; cashier blocked', async () => {
    const res = await viewer.get('/api/scraping/trends?sort=velocity&status=all&pageSize=100');
    assert.equal(res.status, 200);
    const v = res.body.data.map((t) => t.soldVelocity).filter((x) => x != null);
    assert.deepEqual(v, [...v].sort((a, b) => b - a));
    assert.ok(res.body.meta.platforms.some((p) => p.platform === 'shopee'));
    const tts = await viewer.get('/api/scraping/trends?platform=tiktok_shop&q=T5');
    assert.ok(tts.body.data.length >= 2 && tts.body.data.every((t) => t.platform === 'tiktok_shop'));
    assert.equal((await viewer.patch('/api/scraping/trends/1', { status: 'watching' })).status, 403);
    assert.equal((await cashier.get('/api/scraping/trends')).status, 403);
    assert.equal((await marketer.patch('/api/scraping/trends/1', { status: 'watching' })).status, 200);
    assert.equal((await marketer.patch('/api/scraping/trends/1', { status: 'new' })).status, 200);
  });

  test('AI analysis via MiniMax (forced tool), cached until refresh', async () => {
    process.env.MINIMAX_API_KEY = 'test-key';
    let n = 0;
    let captured;
    minimax.createMessage = async (params) => {
      n += 1;
      captured = params;
      return {
        model: 'MiniMax-M3',
        stop_reason: 'tool_use',
        content: [
          {
            type: 'tool_use',
            id: 't1',
            name: 'submit_analysis',
            input: {
              fitScore: 12,
              verdict: 'ขายดีเร็ว ค่าคอมสูง เหมาะทำคลิปรีวิว',
              targetAudience: 'วัยรุ่น 18-25',
              sellingPoints: ['ติดทน', 'ราคาเข้าถึงง่าย'],
              videoHooks: ['ปากแห้งต้องดู!', 'ลิปที่ไม่ติดแมส', 'ของถูกแต่ดี'],
              contentAngle: 'ทดสอบติดทน 8 ชั่วโมง',
              risks: ['เครื่องสำอางต้องมีเลข อย.'],
              suggestedPrice: 149,
            },
          },
        ],
      };
    };
    const res = await marketer.post('/api/scraping/trends/2/analyze', {});
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.data.analysis.fitScore, 10); // clamped
    assert.equal(res.body.data.analysis.provider, 'minimax');
    assert.deepEqual(captured.toolChoice, { type: 'tool', name: 'submit_analysis' });
    assert.match(captured.messages[0].content[0].text, /ลิปทินท์/);
    const cached = await marketer.post('/api/scraping/trends/2/analyze', {});
    assert.equal(cached.body.data.cached, true);
    assert.equal(n, 1);
    await marketer.post('/api/scraping/trends/2/analyze', { refresh: true });
    assert.equal(n, 2);
    assert.equal((await viewer.get('/api/scraping/trends/2')).body.data.aiAnalysis.videoHooks.length, 3);

    delete process.env.MINIMAX_API_KEY;
    const nokey = await marketer.post('/api/scraping/trends/3/analyze', {});
    assert.equal(nokey.status, 503);
    assert.match(JSON.stringify(nokey.body), /MINIMAX_API_KEY/);
  });

  test('import as a draft product uses the AI selling points and price', async () => {
    assert.equal((await marketer.post('/api/scraping/trends/2/import-product', {})).status, 403); // needs products:write
    const res = await manager.post('/api/scraping/trends/2/import-product', {});
    assert.equal(res.status, 201, JSON.stringify(res.body));
    created.products.push(res.body.data.productId);
    const p = await db.one('SELECT * FROM products WHERE id = :id', { id: res.body.data.productId });
    assert.equal(p.status, 'draft');
    assert.equal(p.sku, 'TR-2');
    assert.equal(Number(p.price), 149);
    assert.match(p.selling_points, /ติดทน/);
    const t = await db.one('SELECT status, imported_product_id FROM trending_products WHERE id = 2');
    assert.equal(t.status, 'imported');
    assert.equal((await manager.post('/api/scraping/trends/2/import-product', {})).status, 409);
    assert.equal((await marketer.patch('/api/scraping/trends/2', { status: 'ignored' })).status, 409);
  });

  test('affiliate short link for Shopee items', async () => {
    const t = await db.one('SELECT id FROM trending_products WHERE external_id = :e', { e: `t5-${RUN}-1` });
    delete process.env.SHOPEE_AFFILIATE_APP_ID;
    assert.equal((await marketer.post(`/api/scraping/trends/${t.id}/affiliate-link`, {})).status, 503);
    process.env.SHOPEE_AFFILIATE_APP_ID = 'app1';
    let input;
    routes = {
      'open-api.affiliate.shopee.co.th/graphql': (url, init) => {
        input = JSON.parse(init.body).variables.input;
        return json({ data: { generateShortLink: { shortLink: 'https://s.shopee.co.th/abc' } } });
      },
    };
    const res = await marketer.post(`/api/scraping/trends/${t.id}/affiliate-link`, { subId: 'camp1' });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(res.body.data.shortUrl, 'https://s.shopee.co.th/abc');
    assert.deepEqual(input, { originUrl: 'https://shope.ee/x1', subIds: ['camp1'] });
    const detail = await viewer.get(`/api/scraping/trends/${t.id}`);
    assert.equal(detail.body.data.affiliateUrl, 'https://s.shopee.co.th/abc');
    assert.equal((await marketer.post(`/api/scraping/trends/${t.id}/affiliate-link`, { subId: 'bad id!' })).status, 400);
    assert.equal((await marketer.post('/api/scraping/trends/2/affiliate-link', {})).status, 400); // TikTok item
  });
});
