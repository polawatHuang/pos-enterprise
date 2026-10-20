'use strict';

// "AI ปกคลิป": design via MiniMax chat (forced tool), background via MiniMax image (both mocked).
process.env.NODE_ENV = 'test';

const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { createApp } = require('../src/app');
const db = require('../src/db/pool');
const { runDue } = require('../src/jobs/runner');
const minimax = require('../src/integrations/minimax');
const minimaxMedia = require('../src/integrations/minimax-media');
const { cleanDesign } = require('../src/modules/covers/covers.service');
const { decodeImage } = require('../src/modules/covers/covers.routes');

const app = createApp();
const RUN = Date.now().toString(36);
const originalCreate = minimax.createMessage;
const originalImage = minimaxMedia.generateImage;
const savedKey = process.env.MINIMAX_API_KEY;
const savedProvider = process.env.AI_PROVIDER;
const PNG_1PX = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const dataUrl = (b64 = PNG_1PX, mime = 'image/png') => `data:${mime};base64,${b64}`;
let marketer;
let viewer;
let cashier;
let chatCalls = [];
let imageCalls = [];
let imageFails = null;

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
async function drain() {
  await db.query("UPDATE jobs SET run_at = UTC_TIMESTAMP() WHERE status = 'queued' AND type = 'cover.generate'");
  await db.query("UPDATE jobs SET run_at = UTC_TIMESTAMP() + INTERVAL 1 DAY WHERE status = 'queued' AND type <> 'cover.generate'");
  await runDue({ maxJobs: 20 });
}

before(async () => {
  delete process.env.AI_PROVIDER;
  process.env.MINIMAX_API_KEY = 'test-key';
  minimax.createMessage = async (params) => {
    chatCalls.push(params);
    return {
      model: 'MiniMax-M3',
      stop_reason: 'tool_use',
      content: [
        {
          type: 'tool_use',
          id: 't1',
          name: 'submit_cover_design',
          input: {
            imagePrompt: 'neon city street at night, empty space at top',
            layout: 'split-left',
            palette: { primary: '#111827', accent: '#FF3366', text: '#FFFFFF', stroke: 'red' },
            font: 'mitr',
            emphasisWord: 'ลด 50%',
            mood: 'นีออนจัดจ้าน',
          },
        },
      ],
    };
  };
  minimaxMedia.generateImage = async (params) => {
    imageCalls.push(params);
    if (imageFails) throw imageFails;
    return { buffer: Buffer.from(PNG_1PX, 'base64'), mime: 'image/jpeg' };
  };
  marketer = as(await cookie('marketer@example.com'));
  viewer = as(await cookie('viewer@example.com'));
  cashier = as(await cookie('cashier@example.com'));
});

after(async () => {
  minimax.createMessage = originalCreate;
  minimaxMedia.generateImage = originalImage;
  if (savedKey === undefined) delete process.env.MINIMAX_API_KEY;
  else process.env.MINIMAX_API_KEY = savedKey;
  if (savedProvider !== undefined) process.env.AI_PROVIDER = savedProvider;
  await db.query("DELETE FROM jobs WHERE type = 'cover.generate'");
  await db.query('DELETE FROM cover_projects WHERE headline LIKE :h', { h: `%${RUN}%` });
  await db.pool.end();
});

describe('cover helpers (unit)', () => {
  test('design is sanitized: bad colors, split layout on portrait, emphasis not in headline', () => {
    const d = cleanDesign(
      { imagePrompt: 'x', layout: 'split-left', palette: { text: 'white', accent: '#00ff00' }, font: 'comic', emphasisWord: 'ไม่มีในหัวข้อ' },
      { orientation: 'portrait', headline: 'ลดราคา' },
    );
    assert.equal(d.layout, 'top-title');
    assert.equal(d.font, 'kanit');
    assert.equal(d.palette.text, '#ffffff');
    assert.equal(d.palette.accent, '#00ff00');
    assert.equal(d.emphasisWord, null);
  });

  test('image data URLs: only png/jpeg/webp within the size limit', () => {
    assert.equal(decodeImage(dataUrl(), 1000, 'x').mime, 'image/png');
    assert.throws(() => decodeImage('data:image/svg+xml;base64,PHN2Zz4=', 1000, 'x'), /PNG, JPEG/);
    assert.throws(() => decodeImage('http://example.com/a.png', 1000, 'x'), /PNG, JPEG/);
    assert.throws(() => decodeImage(dataUrl(), 10, 'x'), /ใหญ่เกิน/);
  });
});

describe('covers API', () => {
  let coverId;

  test('permissions and missing key', async () => {
    const body = { orientation: 'portrait', style: 'ป๊อปสดใส', headline: `ทดสอบ ${RUN}` };
    assert.equal((await viewer.get('/api/covers')).status, 403);
    assert.equal((await cashier.post('/api/covers', body)).status, 403);
    delete process.env.MINIMAX_API_KEY;
    const r = await marketer.post('/api/covers', body);
    assert.equal(r.status, 503);
    process.env.MINIMAX_API_KEY = 'test-key';
    assert.equal((await marketer.post('/api/covers', { ...body, headline: '' })).status, 400);
    assert.equal((await marketer.post('/api/covers', { ...body, image: 'data:text/html;base64,PGI+' })).status, 400);
  });

  test('portrait with a product photo: design → text-free background → ready', async () => {
    const res = await marketer.post('/api/covers', {
      orientation: 'portrait',
      style: 'นีออนสตรีท',
      headline: `ลด 50% วันนี้ ${RUN}`,
      subtext: 'ส่งฟรีทั่วไทย',
      badge: 'HOT',
      image: dataUrl(),
      imageKind: 'product',
    });
    assert.equal(res.status, 202, JSON.stringify(res.body));
    coverId = res.body.data.id;
    const pending = (await marketer.get(`/api/covers/${coverId}`)).body.data;
    assert.equal(pending.status, 'generating');
    assert.ok(pending.uploadUrl);
    await drain();

    assert.equal(chatCalls.length, 1);
    assert.deepEqual(chatCalls[0].toolChoice, { type: 'tool', name: 'submit_cover_design' });
    const text = chatCalls[0].messages[0].content[0].text;
    assert.match(text, /แนวตั้ง 9:16/);
    assert.match(text, /นีออนสตรีท/);
    assert.match(text, /รูปสินค้า/);
    assert.match(chatCalls[0].system, /ไม่มีตัวหนังสือ/);
    assert.equal(imageCalls.length, 1);
    assert.equal(imageCalls[0].aspectRatio, '9:16');
    assert.match(imageCalls[0].prompt, /no text/i);
    assert.equal(imageCalls[0].subjectImage, null); // product photos are composited, not referenced

    const c = (await marketer.get(`/api/covers/${coverId}`)).body.data;
    assert.equal(c.status, 'ready', c.error);
    assert.equal(c.design.layout, 'top-title'); // split-left is landscape-only
    assert.equal(c.design.font, 'mitr');
    assert.equal(c.design.palette.stroke, '#111111'); // invalid color replaced
    assert.equal(c.design.emphasisWord, 'ลด 50%');
    assert.ok(c.backgroundUrl);
    const img = await marketer.get(c.backgroundUrl);
    assert.equal(img.status, 200);
    assert.equal(img.headers['content-type'], 'image/jpeg');
  });

  test('landscape with a person photo uses it as the character reference', async () => {
    imageCalls = [];
    const res = await marketer.post('/api/covers', {
      orientation: 'landscape',
      style: 'หรูหรา',
      headline: `รีวิวจริง ${RUN}`,
      image: dataUrl(),
      imageKind: 'person',
    });
    await drain();
    assert.equal(imageCalls[0].aspectRatio, '16:9');
    assert.match(imageCalls[0].subjectImage, /^data:image\/png;base64,/);
    const c = (await marketer.get(`/api/covers/${res.body.data.id}`)).body.data;
    assert.equal(c.design.layout, 'split-left');
  });

  test('edit text/design, save final PNG, regenerate background only', async () => {
    const p = await marketer.patch(`/api/covers/${coverId}`, {
      headline: `หัวข้อใหม่ ${RUN}`,
      badge: null,
      user: { font: 'kanit', titleScale: 1.2, imageX: 0.5 },
    });
    assert.equal(p.status, 200, JSON.stringify(p.body));
    assert.equal(p.body.data.badge, null);
    assert.equal(p.body.data.design.user.font, 'kanit');
    assert.equal((await marketer.patch(`/api/covers/${coverId}`, { user: { font: 'comic' } })).status, 400);

    const f = await marketer.post(`/api/covers/${coverId}/final`, { image: dataUrl() });
    assert.equal(f.status, 200);
    assert.ok(f.body.data.finalUrl);
    assert.equal((await marketer.get(f.body.data.finalUrl)).headers['content-type'], 'image/png');

    chatCalls = [];
    imageCalls = [];
    assert.equal((await marketer.post(`/api/covers/${coverId}/regenerate`, {})).status, 202);
    assert.equal((await marketer.post(`/api/covers/${coverId}/regenerate`, {})).status, 409);
    await drain();
    assert.equal(chatCalls.length, 0); // same design, new image
    assert.equal(imageCalls.length, 1);
    const c = (await marketer.get(`/api/covers/${coverId}`)).body.data;
    assert.equal(c.status, 'ready');
    assert.equal(c.design.user.titleScale, 1.2); // user edits survive
  });

  test('image provider error → failed with a Thai message', async () => {
    imageFails = Object.assign(new Error('MiniMax: input new_sensitive'), { status: 502 });
    const res = await marketer.post('/api/covers', { orientation: 'portrait', style: 'มินิมอล', headline: `พัง ${RUN}` });
    await drain();
    imageFails = null;
    const c = (await marketer.get(`/api/covers/${res.body.data.id}`)).body.data;
    assert.equal(c.status, 'failed');
    assert.match(c.error, /ปฏิเสธ/);
  });

  test('list, cross-org isolation of assets, delete', async () => {
    const list = await marketer.get('/api/covers');
    assert.ok(list.body.data.some((c) => c.id === coverId));
    await db.query('UPDATE cover_projects SET org_id = org_id WHERE id = :id', { id: coverId });
    assert.equal((await marketer.get(`/api/covers/999999/assets/background`)).status, 404);
    assert.equal((await marketer.delete(`/api/covers/${coverId}`)).status, 200);
    assert.equal((await marketer.get(`/api/covers/${coverId}`)).status, 404);
    const assets = await db.one('SELECT COUNT(*) AS n FROM cover_assets WHERE cover_id = :id', { id: coverId });
    assert.equal(Number(assets.n), 0);
  });
});
