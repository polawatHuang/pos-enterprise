'use strict';

// Phase 5c: one-click AI web search for trending products (MiniMax server-side web_search, mocked).
process.env.NODE_ENV = 'test';

const { test, before, after, beforeEach, describe } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { createApp } = require('../src/app');
const db = require('../src/db/pool');
const { runDue } = require('../src/jobs/runner');
const minimax = require('../src/integrations/minimax');
const { webSearchTool, verifyFindings, normUrl, searchHits, buildPrompt } = require('../src/modules/scraping/ai-search');

const app = createApp();
const RUN = Date.now().toString(36);
const originalCreate = minimax.createMessage;
const originalFetch = global.fetch;
const ENV_KEYS = ['MINIMAX_API_KEY', 'AI_PROVIDER', 'SHOPEE_AFFILIATE_APP_ID', 'SHOPEE_AFFILIATE_SECRET'];
const savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
let manager;
let marketer;
let viewer;
let script = [];
let calls = [];
let shopeeCalls = [];

async function cookie(email) {
  const res = await request(app).post('/api/auth/login').send({ email, password: 'Admin@1234' });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  return res.headers['set-cookie'].map((c) => c.split(';')[0]).join('; ');
}
const as = (c) => ({
  get: (url) => request(app).get(url).set('Cookie', c),
  post: (url, body) => request(app).post(url).set('Cookie', c).send(body),
});

/** Drain only AI search jobs; leave other suites' queued jobs alone. */
async function drain() {
  for (let i = 0; i < 8; i += 1) {
    await db.query("UPDATE jobs SET run_at = UTC_TIMESTAMP() WHERE status = 'queued' AND type IN ('scrape.run','scrape.ai')");
    await db.query("UPDATE jobs SET run_at = UTC_TIMESTAMP() + INTERVAL 1 DAY WHERE status = 'queued' AND type NOT IN ('scrape.run','scrape.ai')");
    await runDue({ maxJobs: 20 });
    const [{ n }] = await db.query("SELECT COUNT(*) AS n FROM jobs WHERE status = 'queued' AND type IN ('scrape.run','scrape.ai')");
    if (!Number(n)) break;
  }
}

const P = (n) => `https://news${n}.example.th/trend-${RUN}`;
const searchBlocks = (urls) => [
  { type: 'server_tool_use', id: 'srv1', name: 'web_search', input: { query: 'สินค้าขายดี Shopee เดือนนี้' } },
  {
    type: 'web_search_tool_result',
    tool_use_id: 'srv1',
    content: urls.map((u, i) => ({ type: 'web_search_result', url: u, title: `บทความ ${i + 1}`, encrypted_content: 'x'.repeat(50) })),
  },
];
const product = (title, urls, extra = {}) => ({
  title,
  category: `AI ${RUN}`,
  searchKeywords: [`${title} ราคาถูก`],
  whyTrending: `${title} ถูกพูดถึงมากใน TikTok`,
  trendStage: 'rising',
  evidence: urls.map((url) => ({ url, title: 'อ้างอิง', quote: 'ขายดีมาก' })),
  soldHint: 'ขายแล้ว 10k+',
  priceHint: '99-199 บาท',
  risks: [],
  ...extra,
});
const submit = (products) => ({ type: 'tool_use', id: 'tu1', name: 'submit_products', input: { products } });
const reply = (content, stop = 'tool_use') => ({ model: 'MiniMax-M3', stop_reason: stop, content });

async function lastRun(sourceId) {
  return (await viewer.get(`/api/scraping/runs?sourceId=${sourceId}`)).body.data[0];
}
const aiSource = () => db.one("SELECT * FROM scrape_sources WHERE org_id = 1 AND platform = 'ai_search' ORDER BY id LIMIT 1");

before(async () => {
  delete process.env.AI_PROVIDER;
  delete process.env.SHOPEE_AFFILIATE_APP_ID;
  delete process.env.SHOPEE_AFFILIATE_SECRET;
  process.env.MINIMAX_API_KEY = 'test-key';
  minimax.createMessage = async (params) => {
    calls.push(params);
    const next = script.shift();
    if (!next) throw new Error('unexpected AI call');
    if (next instanceof Error) throw next;
    return typeof next === 'function' ? next(params) : next;
  };
  global.fetch = async (url, init = {}) => {
    if (!String(url).includes('open-api.affiliate.shopee.co.th')) return new Response('not found', { status: 404 });
    const body = JSON.parse(init.body);
    shopeeCalls.push(body.variables);
    const kw = body.variables.keyword;
    return new Response(
      JSON.stringify({
        data: {
          productOfferV2: {
            nodes: [
              {
                itemId: `ai-${RUN}-${shopeeCalls.length}`,
                productName: `${kw} ของจริง`,
                priceMin: '149',
                sales: 3200,
                ratingStar: '4.8',
                commissionRate: '0.1',
                offerLink: 'https://shope.ee/ai',
              },
            ],
            pageInfo: { hasNextPage: false },
          },
        },
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  };
  manager = as(await cookie('manager@example.com'));
  marketer = as(await cookie('marketer@example.com'));
  viewer = as(await cookie('viewer@example.com'));
});

beforeEach(async () => {
  script = [];
  calls = [];
  shopeeCalls = [];
  // Previous test's run must not block the next one
  await db.query(
    "UPDATE scrape_runs r JOIN scrape_sources s ON s.id = r.source_id SET r.status = 'failed' WHERE s.platform = 'ai_search' AND r.status = 'running'",
  );
});

after(async () => {
  minimax.createMessage = originalCreate;
  global.fetch = originalFetch;
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
  await db.query("DELETE FROM jobs WHERE type = 'scrape.ai'");
  await db.query('DELETE FROM trending_products WHERE org_id = 1 AND (category LIKE :c OR title LIKE :t)', { c: `AI ${RUN}%`, t: `%ของจริง` });
  await db.query("DELETE FROM scrape_sources WHERE org_id = 1 AND platform = 'ai_search'");
  await db.pool.end();
});

describe('AI search helpers (unit)', () => {
  test('web search tool declaration per provider', () => {
    assert.deepEqual(webSearchTool('minimax'), { type: 'web_search_20250305', name: 'web_search' });
    const claude = webSearchTool('anthropic');
    assert.equal(claude.type, 'web_search_20250305');
    assert.equal(claude.max_uses, 5);
    assert.equal(claude.user_location.country, 'TH');
  });

  test('only evidence the search returned survives; dedupe and cap', () => {
    const hits = searchHits(searchBlocks(['https://www.a.example/x/?utm=1', 'https://b.example/y']));
    assert.equal(normUrl('https://www.A.example/x/?utm=2#f'), 'a.example/x');
    assert.equal(normUrl('javascript:alert(1)'), null);
    const { kept, dropped } = verifyFindings(
      [
        product('พัดลมคล้องคอ', ['https://a.example/x', 'https://made-up.example/z']),
        product('พัดลมคล้องคอ', ['https://b.example/y']), // duplicate title
        product('ของแต่ง', ['https://made-up.example/z']), // no verified evidence
        product('กล่องเก็บของ', ['https://b.example/y'], { trendStage: 'bogus' }),
        product('ตัวที่สี่', ['https://b.example/y']),
      ],
      hits,
      2,
    );
    assert.deepEqual(
      kept.map((p) => p.title),
      ['พัดลมคล้องคอ', 'กล่องเก็บของ'],
    );
    assert.deepEqual(
      kept[0].evidence.map((e) => e.url),
      ['https://www.a.example/x/?utm=1'],
    ); // canonical URL from the search, fabricated one removed
    assert.equal(kept[1].trendStage, null);
    assert.deepEqual(
      dropped.map((d) => d.title),
      ['ของแต่ง', 'ตัวที่สี่'],
    );
  });

  test('prompt carries date, platform, focus and channel interests', () => {
    const text = buildPrompt({
      config: { count: 40, platformFocus: 'tiktok_shop', focus: 'ของใช้ในห้องนอน' },
      profile: { name: 'ช่องแมว', persona: 'คนเลี้ยงแมว', interests: '["แมว","จัดห้อง"]', on_camera: 0 },
      today: '11 ตุลาคม 2569',
    });
    assert.match(text, /11 ตุลาคม 2569/);
    assert.match(text, /จำนวน 15 รายการ/); // clamped
    assert.match(text, /TikTok Shop/);
    assert.match(text, /ของใช้ในห้องนอน/);
    assert.match(text, /แมว, จัดห้อง/);
    assert.match(text, /ไม่ออกหน้ากล้อง/);
  });
});

describe('AI search API + jobs', () => {
  test('permissions and missing key', async () => {
    assert.equal((await viewer.post('/api/scraping/ai-search', {})).status, 403);
    delete process.env.MINIMAX_API_KEY;
    const r = await marketer.post('/api/scraping/ai-search', {});
    assert.equal(r.status, 503);
    assert.match(JSON.stringify(r.body), /MINIMAX_API_KEY/);
    process.env.MINIMAX_API_KEY = 'test-key';
    assert.equal((await marketer.post('/api/scraping/ai-search', { count: 99 })).status, 400);
  });

  test('happy path: search → submit → verified candidates imported without figures', async () => {
    script = [
      reply([
        ...searchBlocks([P(1), P(2)]),
        submit([product(`AI-${RUN} พัดลม`, [P(1), 'https://fake.example/no']), product(`AI-${RUN} ปลอม`, ['https://fake.example/no'])]),
      ]),
    ];
    const res = await marketer.post('/api/scraping/ai-search', { focus: 'ของใช้หน้าร้อน', platformFocus: 'shopee', count: 5 });
    assert.equal(res.status, 202, JSON.stringify(res.body));
    assert.equal((await marketer.post('/api/scraping/ai-search', {})).status, 409);
    await drain();

    assert.equal(calls.length, 1);
    const c = calls[0];
    assert.deepEqual(c.tools[0], { type: 'web_search_20250305', name: 'web_search' });
    assert.equal(c.tools[1].name, 'submit_products');
    assert.equal(c.maxRetries, 0);
    assert.ok(c.timeoutMs >= 120_000);
    assert.match(c.messages[0].content, /ของใช้หน้าร้อน/);
    assert.match(c.system, /กำลังจะเป็นกระแส/);

    const run = await lastRun(res.body.data.sourceId);
    assert.equal(run.status, 'succeeded', run.error);
    assert.equal(run.stage, 'done');
    assert.equal(run.itemsFound, 1);
    assert.equal(run.summary.products.length, 1);
    assert.equal(run.summary.dropped[0].title, `AI-${RUN} ปลอม`);
    assert.equal(run.summary.searches, 1);
    assert.equal(run.summary.enriched, 0);

    const t = await db.one('SELECT * FROM trending_products WHERE title = :t', { t: `AI-${RUN} พัดลม` });
    assert.equal(t.platform, 'shopee');
    assert.equal(t.url, null);
    assert.equal(t.sold_count, null);
    assert.equal(t.price, null);
    // Detail exposes the reasons and only the verified source
    const d = (await viewer.get(`/api/scraping/trends/${t.id}`)).body.data;
    assert.equal(d.sourcePlatform, 'ai_search');
    assert.equal(d.aiSearch.verified, false);
    assert.deepEqual(
      d.aiSearch.evidence.map((e) => e.url),
      [P(1)],
    );
    assert.equal(d.aiSearch.soldHint, 'ขายแล้ว 10k+');
    // List filter by source
    const list = await viewer.get(`/api/scraping/trends?sourceId=${res.body.data.sourceId}&status=all`);
    assert.ok(list.body.data.some((x) => x.id === t.id));
    // Conversation is not kept after the run
    const raw = await db.one('SELECT state FROM scrape_runs WHERE id = :id', { id: run.id });
    const state = typeof raw.state === 'string' ? JSON.parse(raw.state) : raw.state;
    assert.equal(state.messages, undefined);
    // Settings remembered
    const s = (await viewer.get('/api/scraping/ai-search')).body.data;
    assert.equal(s.config.focus, 'ของใช้หน้าร้อน');
    assert.equal(s.config.platformFocus, 'shopee');
  });

  test('pause_turn continues in the next job, then prose answer goes through extract', async () => {
    script = [
      reply([...searchBlocks([P(3)])], 'pause_turn'),
      reply([...searchBlocks([P(4)]), { type: 'text', text: `<think>x</think>สรุป: AI-${RUN} กล่อง มาแรง (${P(4)})` }], 'end_turn'),
      (params) => {
        assert.deepEqual(params.toolChoice, { type: 'tool', name: 'submit_products' });
        assert.match(params.messages[0].content[0].text, new RegExp(P(4).replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')));
        return reply([submit([product(`AI-${RUN} กล่อง`, [P(4)])])]);
      },
    ];
    const res = await marketer.post('/api/scraping/ai-search', { platformFocus: 'any' });
    assert.equal(res.status, 202);
    await drain();
    assert.equal(calls.length, 3);
    // Continuation resent the paused assistant turn
    assert.equal(calls[1].messages.length, 2);
    assert.equal(calls[1].messages[1].role, 'assistant');
    const run = await lastRun(res.body.data.sourceId);
    assert.equal(run.status, 'succeeded', run.error);
    assert.equal(run.summary.searches, 2);
    const t = await db.one('SELECT platform FROM trending_products WHERE title = :t', { t: `AI-${RUN} กล่อง` });
    assert.equal(t.platform, 'other');
  });

  test('with Shopee Affiliate: findings become real listings with numbers', async () => {
    process.env.SHOPEE_AFFILIATE_APP_ID = 'app1';
    process.env.SHOPEE_AFFILIATE_SECRET = 'secret1';
    try {
      script = [reply([...searchBlocks([P(5)]), submit([product(`AI-${RUN} ไฟ`, [P(5)])])])];
      const res = await marketer.post('/api/scraping/ai-search', { platformFocus: 'shopee', enrich: true });
      await drain();
      assert.equal(shopeeCalls.length, 1);
      assert.equal(shopeeCalls[0].keyword, `AI-${RUN} ไฟ ราคาถูก`);
      assert.equal(shopeeCalls[0].sortType, 2);
      const run = await lastRun(res.body.data.sourceId);
      assert.equal(run.status, 'succeeded', run.error);
      assert.equal(run.summary.enriched, 1);
      const t = await db.one('SELECT * FROM trending_products WHERE title = :t', { t: `AI-${RUN} ไฟ ราคาถูก ของจริง` });
      assert.equal(Number(t.sold_count), 3200);
      assert.equal(t.category, `AI ${RUN}`);
      const d = (await viewer.get(`/api/scraping/trends/${t.id}`)).body.data;
      assert.equal(d.aiSearch.verified, true);
    } finally {
      delete process.env.SHOPEE_AFFILIATE_APP_ID;
      delete process.env.SHOPEE_AFFILIATE_SECRET;
    }
  });

  test('provider rejects web_search → failed run with a Thai explanation', async () => {
    const err = Object.assign(new Error('400 invalid params: tool type web_search_20250305 not supported'), { status: 400 });
    script = [err];
    const res = await marketer.post('/api/scraping/ai-search', {});
    await drain();
    const run = await lastRun(res.body.data.sourceId);
    assert.equal(run.status, 'failed');
    assert.match(run.error, /ยังไม่รองรับการค้นเว็บ/);
    const src = await aiSource();
    assert.match(src.last_error, /ยังไม่รองรับการค้นเว็บ/);
  });

  test('no search performed → nothing imported, explains the beta limitation', async () => {
    script = [reply([submit([product(`AI-${RUN} เดา`, ['https://guess.example/a'])])])];
    const res = await marketer.post('/api/scraping/ai-search', {});
    await drain();
    const run = await lastRun(res.body.data.sourceId);
    assert.equal(run.status, 'failed');
    assert.match(run.error, /ไม่ได้ค้นเว็บ/);
    assert.equal(await db.one('SELECT id FROM trending_products WHERE title = :t', { t: `AI-${RUN} เดา` }), null);
  });

  test('ai_search shows up as a source and can be run from the sources page', async () => {
    const list = (await manager.get('/api/scraping/sources')).body.data;
    const s = list.find((x) => x.platform === 'ai_search');
    assert.ok(s);
    assert.equal(s.method, 'ai_web_search');
    assert.equal(s.runnable, true);
    assert.equal(s.configured, true);
    script = [reply([...searchBlocks([P(6)]), submit([product(`AI-${RUN} หมอน`, [P(6)])])])];
    const r = await manager.post(`/api/scraping/sources/${s.id}/run`);
    assert.equal(r.status, 202, JSON.stringify(r.body));
    await drain();
    assert.equal((await lastRun(s.id)).status, 'succeeded');
  });
});
