'use strict';

// "ให้ AI ค้นข้อมูลร้าน/รีวิวจากเว็บ": the AI's web facts are kept only with a page the search
// returned, fill only empty fields and move the checklist; the review summary's own star ratings
// fill the rating fields; the AI analysis prompt carries every insight fetched (MiniMax mocked).
process.env.NODE_ENV = 'test';

const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { createApp } = require('../src/app');
const db = require('../src/db/pool');
const { runDue } = require('../src/jobs/runner');
const minimax = require('../src/integrations/minimax');
const { verify } = require('../src/modules/scraping/web-facts');
const { fillFromComments } = require('../src/modules/scraping/kalodata.service');

const app = createApp();
const RUN = Date.now().toString(36);
const originalCreate = minimax.createMessage;
const ENV_KEYS = ['MINIMAX_API_KEY', 'AI_PROVIDER'];
const savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
const U1 = `https://shop.tiktok.com/view/product/wf-${RUN}`;
const U2 = `https://shopee.co.th/shop-${RUN}`;
let admin;
let script = [];
let calls = [];
let trendId;

async function drain() {
  for (let i = 0; i < 6; i += 1) {
    await db.query("UPDATE jobs SET run_at = UTC_TIMESTAMP() WHERE status = 'queued' AND type = 'trend.facts'");
    await db.query("UPDATE jobs SET run_at = UTC_TIMESTAMP() + INTERVAL 1 DAY WHERE status = 'queued' AND type <> 'trend.facts'");
    await runDue({ maxJobs: 10 });
    const [{ n }] = await db.query("SELECT COUNT(*) AS n FROM jobs WHERE status = 'queued' AND type = 'trend.facts'");
    if (!Number(n)) break;
  }
}
const webFacts = async () => (await admin.get(`/api/scraping/trends/${trendId}`)).body.data.extras.webfacts?.data;

before(async () => {
  delete process.env.AI_PROVIDER;
  process.env.MINIMAX_API_KEY = 'test-key';
  minimax.createMessage = async (params) => {
    calls.push(params);
    const next = script.shift();
    if (!next) throw new Error('unexpected AI call');
    if (next instanceof Error) throw next;
    return typeof next === 'function' ? next(params) : next;
  };
  const r = await db.query(
    `INSERT INTO trending_products (org_id, platform, external_id, title, shop_name, price, commission_rate, review_count, monthly_sold, status)
     VALUES (1, 'kalodata', :ext, :title, 'ร้านทดสอบ', 299, 12, 10, 800, 'new')`,
    { ext: `wf-${RUN}`, title: `เซรั่มทดสอบ ${RUN}` },
  );
  trendId = r.insertId;
  const res = await request(app).post('/api/auth/login').send({ email: 'admin@example.com', password: 'Admin@1234' });
  const cookie = res.headers['set-cookie'].map((c) => c.split(';')[0]).join('; ');
  admin = {
    get: (url) => request(app).get(url).set('Cookie', cookie),
    post: (url, body) => request(app).post(url).set('Cookie', cookie).send(body),
  };
});

after(async () => {
  minimax.createMessage = originalCreate;
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
  await db.query("DELETE FROM jobs WHERE type = 'trend.facts'");
  await db.query('DELETE FROM trending_products WHERE id = :id', { id: trendId });
  await db.pool.end();
});

describe('AI web facts', () => {
  test('verify keeps sourced, in-range facts only', () => {
    const { kept, dropped } = verify(
      [
        { field: 'rating', value: '4.7', sourceUrl: U1 },
        { field: 'shopRating', value: 7, sourceUrl: U1 },
        { field: 'shopResponseRate', value: 90, sourceUrl: 'https://made-up.example/x' },
        { field: 'rating', value: 4.1, sourceUrl: U2 },
        { field: 'hasFlashSale', value: 'มี', sourceUrl: U2 },
      ],
      [{ url: U1 }, { url: `${U2}/` }],
    );
    assert.deepEqual(
      kept.map((f) => [f.field, f.value]),
      [
        ['rating', 4.7],
        ['hasFlashSale', true],
      ],
    );
    assert.deepEqual(
      dropped.map((d) => d.reason),
      ['ค่าไม่อยู่ในช่วงที่เป็นไปได้', 'ไม่มีหน้าเว็บยืนยัน', 'ซ้ำ'],
    );
  });

  test('search → sourced facts fill empty fields, keep existing ones, and move the checklist', async () => {
    script = [
      {
        model: 'MiniMax-M3',
        stop_reason: 'tool_use',
        content: [
          { type: 'server_tool_use', id: 's1', name: 'web_search', input: { query: 'เซรั่มทดสอบ TikTok Shop' } },
          {
            type: 'web_search_tool_result',
            tool_use_id: 's1',
            content: [
              { type: 'web_search_result', url: U1, title: 'หน้าสินค้า' },
              { type: 'web_search_result', url: U2, title: 'หน้าร้าน' },
            ],
          },
          {
            type: 'tool_use',
            id: 't1',
            name: 'submit_facts',
            input: {
              facts: [
                { field: 'rating', value: 4.8, sourceUrl: U1, note: 'หน้าสินค้า TikTok Shop' },
                { field: 'reviewCount', value: 1520, sourceUrl: U1 },
                { field: 'positiveReviewPct', value: '92%', sourceUrl: U2 },
                { field: 'shopRating', value: 4.9, sourceUrl: 'https://fake.example/none' },
                { field: 'hasFlashSale', value: true, sourceUrl: U1 },
              ],
              summary: 'เจอหน้าสินค้าและหน้าร้าน ไม่เจออัตราตอบแชต',
            },
          },
        ],
      },
    ];
    const res = await admin.post(`/api/scraping/trends/${trendId}/web-facts`);
    assert.equal(res.status, 202, JSON.stringify(res.body));
    assert.equal((await webFacts()).status, 'running');
    await drain();
    assert.deepEqual(calls[0].tools[0], { type: 'web_search_20250305', name: 'web_search' });
    const w = await webFacts();
    assert.equal(w.status, 'done', JSON.stringify(w));
    assert.equal(w.facts.length, 4);
    assert.equal(w.dropped.length, 1);
    assert.equal(w.model, 'MiniMax-M3');
    assert.equal(w.facts.find((f) => f.field === 'reviewCount').applied, false, 'review count was already known');
    const t = await db.one('SELECT rating, review_count, positive_review_pct, shop_rating, has_flash_sale, checklist FROM trending_products WHERE id = :id', { id: trendId });
    assert.equal(Number(t.rating), 4.8);
    assert.equal(Number(t.review_count), 10);
    assert.equal(Number(t.positive_review_pct), 92);
    assert.equal(t.shop_rating, null);
    assert.equal(t.has_flash_sale, 1);
    const checklist = typeof t.checklist === 'string' ? JSON.parse(t.checklist) : t.checklist;
    assert.equal(checklist.find((c) => c.key === 'rating').status, 'pass');
    assert.equal(checklist.find((c) => c.key === 'flashSale').status, 'pass');
  });

  test('provider without web search: a failed state with a Thai reason', async () => {
    script = [Object.assign(new Error('400 tool type web_search_20250305 not supported'), { status: 400 })];
    await admin.post(`/api/scraping/trends/${trendId}/web-facts`);
    await drain();
    const w = await webFacts();
    assert.equal(w.status, 'failed');
    assert.match(w.error, /ยังไม่รองรับการค้นเว็บ/);
  });
});

describe('review summary → checklist', () => {
  test('star ratings and photos in the summarised comments fill only empty fields', async () => {
    await db.query('UPDATE trending_products SET rating = NULL, positive_review_pct = NULL, media_review_count = NULL WHERE id = :id', { id: trendId });
    const comments = [5, 5, 4, 3, 5, 4].map((rating, i) => ({ content: `รีวิว ${i}`, rating, images: i < 2 ? ['x.jpg'] : [] }));
    const r = await fillFromComments(trendId, { original_comments: comments });
    assert.equal(r.rating, 4.33);
    assert.equal(r.positive_review_pct, 83.33);
    assert.equal(r.media_review_count, 2);
    const again = await fillFromComments(trendId, { original_comments: comments.map((c) => ({ ...c, rating: 1 })) });
    assert.equal(again, null, 'already filled: nothing overwritten');
    assert.equal(await fillFromComments(trendId, { original_comments: [{ content: 'ไม่มีดาว' }] }), null);
  });
});

describe('AI analysis prompt', () => {
  test('carries the review summary, web facts and the 30-point score; the model name is kept', async () => {
    await db.query(
      `INSERT INTO trend_product_extras (trending_product_id, kind, data) VALUES (:id, 'comments', :data)
       ON DUPLICATE KEY UPDATE data = VALUES(data)`,
      { id: trendId, data: JSON.stringify({ comment_summary: { summary: 'ซึมไว ไม่เหนียว' }, positive_points: [{ point: 'ส่งไว' }], pain_points: [{ point: 'กลิ่นแรง' }] }) },
    );
    // the earlier failed search replaced the found facts: put a finished one back
    await db.query(
      `INSERT INTO trend_product_extras (trending_product_id, kind, data) VALUES (:id, 'webfacts', :data)
       ON DUPLICATE KEY UPDATE data = VALUES(data)`,
      { id: trendId, data: JSON.stringify({ status: 'done', facts: [{ field: 'rating', label: 'ดาวสินค้าเฉลี่ย', value: 4.8, sourceUrl: U1 }] }) },
    );
    script = [
      (params) => ({
        model: 'MiniMax-M3',
        stop_reason: 'tool_use',
        content: [
          {
            type: 'tool_use',
            id: 'a1',
            name: params.tools[0].name,
            input: { fitScore: 7, verdict: 'น่าลอง', targetAudience: 'ผู้หญิง', sellingPoints: ['ซึมไว'], videoHooks: ['ลองทาให้ดู'], contentAngle: 'รีวิวจริง', risks: [], suggestedPrice: 299 },
          },
        ],
      }),
    ];
    const res = await admin.post(`/api/scraping/trends/${trendId}/analyze`, { refresh: true });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const text = calls.at(-1).messages[0].content[0].text;
    assert.match(text, /สรุปรีวิวลูกค้า/);
    assert.match(text, /กลิ่นแรง/);
    assert.match(text, /ข้อมูลที่ค้นจากเว็บ/);
    assert.match(text, /tiktok\.com/);
    assert.match(text, /คะแนนคัดเลือก/);
    assert.equal(res.body.data.analysis.model, 'MiniMax-M3');
    assert.equal(res.body.data.analysis.provider, 'minimax');
  });
});
