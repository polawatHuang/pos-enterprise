'use strict';

// AI Video upgrade: own footage (signed URLs), word-by-word captions, fast cuts, hook variants, cover intro.
process.env.NODE_ENV = 'test';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.MEDIA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'pos-media-'));

const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { createApp } = require('../src/app');
const db = require('../src/db/pool');
const env = require('../src/config/env');
const { runDue } = require('../src/jobs/runner');
const minimax = require('../src/integrations/minimax');
const { wordChunks, captionCues, planShots, buildShotstackEdit, MAX_SHOT_SEC } = require('../src/modules/video/timeline');
const media = require('../src/modules/video/media');

const app = createApp();
const RUN = Date.now().toString(36);
const originalFetch = global.fetch;
const originalCreate = minimax.createMessage;
const ENV_KEYS = ['MINIMAX_API_KEY', 'MINIMAX_VOICE_ID', 'AI_PROVIDER', 'SHOTSTACK_API_KEY', 'SHOTSTACK_ENV', 'R2_ACCOUNT_ID'];
const savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
const savedPublic = env.PUBLIC_API_URL;
const created = [];
const coverIds = [];
const calls = [];
let marketer;
let viewer;

async function cookie(email) {
  const res = await request(app).post('/api/auth/login').send({ email, password: 'Admin@1234' });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  return res.headers['set-cookie'].map((c) => c.split(';')[0]).join('; ');
}
const as = (c) => ({
  cookie: c,
  get: (url) => request(app).get(url).set('Cookie', c),
  post: (url, body) => request(app).post(url).set('Cookie', c).send(body),
  put: (url, body) => request(app).put(url).set('Cookie', c).send(body),
  patch: (url, body) => request(app).patch(url).set('Cookie', c).send(body),
  delete: (url) => request(app).delete(url).set('Cookie', c),
  upload: (url, buf, type) => request(app).post(url).set('Cookie', c).set('Content-Type', type).send(buf),
});
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const JOBS = "('video.voice','video.compose','video.compose_poll')";
async function drain() {
  await db.query(`UPDATE jobs SET run_at = UTC_TIMESTAMP() WHERE status = 'queued' AND type IN ${JOBS}`);
  await db.query(`UPDATE jobs SET run_at = UTC_TIMESTAMP() + INTERVAL 1 DAY WHERE status = 'queued' AND type NOT IN ${JOBS}`);
  return runDue({ maxJobs: 50 });
}

const SCRIPT = {
  title: `ฟุตเทจ ${RUN}`,
  hooks: [
    { angle: 'ปัญหา', voiceover: 'ร้อนจนเหงื่อท่วมใช่ไหม', caption: 'ร้อนจัด!' },
    { angle: 'ผลลัพธ์', voiceover: 'เย็นทันทีใน 3 วินาที', caption: 'เย็นใน 3 วิ' },
    { angle: 'คำถาม', voiceover: 'พัดลมเล็กแค่นี้ แรงได้แค่ไหน', caption: 'แรงจริงไหม?' },
  ],
  scenes: [
    { voiceover: 'ร้อนจนเหงื่อท่วมใช่ไหม', caption: 'ร้อนจัด!', visual: 'x', showProduct: false, durationSec: 3, media: 2 },
    {
      voiceover: 'พัดลมคล้องคอตัวนี้ ลมแรง เงียบ ชาร์จทีเดียวใช้ได้ทั้งวัน ลด 50% วันนี้',
      caption: 'ลด 50%',
      visual: 'x',
      showProduct: true,
      durationSec: 5,
      media: 9,
    },
    { voiceover: 'กดตะกร้าได้เลย', caption: 'กดตะกร้า', visual: 'x', showProduct: false, durationSec: 2, media: null },
  ],
  postCaption: 'พัดลมพกพา',
  hashtags: ['พัดลม'],
};
let scriptCalls = [];
function mockScript(script = SCRIPT) {
  minimax.createMessage = async (params) => {
    scriptCalls.push(params);
    return { model: 'MiniMax-M3', stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 't1', name: 'submit_script', input: script }] };
  };
}

before(async () => {
  global.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    const u = String(url);
    if (u.includes('/v1/t2a_v2')) {
      const body = JSON.parse(init.body);
      return json({
        data: { audio: `https://cdn.minimax.test/v-${body.text.length}.mp3` },
        extra_info: { audio_length: 1500 + body.text.length * 40 },
        base_resp: { status_code: 0 },
      });
    }
    if (u.includes('api.shotstack.io/edit/stage/render/'))
      return json({ success: true, response: { id: 'r1', status: 'done', url: 'https://shotstack.test/out.mp4' } });
    if (u.includes('api.shotstack.io/edit/stage/render')) return json({ success: true, response: { id: 'r1', message: 'queued' } });
    return new Response('not found', { status: 404 });
  };
  for (const k of ENV_KEYS) delete process.env[k];
  process.env.MINIMAX_API_KEY = 'mm-key';
  process.env.MINIMAX_VOICE_ID = 'Thai_female_1';
  marketer = as(await cookie('marketer@example.com'));
  viewer = as(await cookie('viewer@example.com'));
});

after(async () => {
  global.fetch = originalFetch;
  minimax.createMessage = originalCreate;
  env.PUBLIC_API_URL = savedPublic;
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
  await db.query(`DELETE FROM jobs WHERE type IN ${JOBS}`);
  await db.query("UPDATE jobs SET run_at = UTC_TIMESTAMP() WHERE status = 'queued' AND run_at > UTC_TIMESTAMP() + INTERVAL 20 HOUR");
  if (created.length) await db.query('DELETE FROM video_projects WHERE id IN (:ids)', { ids: created });
  if (coverIds.length) await db.query('DELETE FROM cover_projects WHERE id IN (:ids)', { ids: coverIds });
  fs.rmSync(process.env.MEDIA_DIR, { recursive: true, force: true });
  await db.pool.end();
});

describe('timeline (unit)', () => {
  test('Thai word chunks are short and never empty', () => {
    const c = wordChunks('รีวิวจริงใช้จริง 30 วัน ลด 50% ส่งฟรีทั่วไทยวันนี้เท่านั้น');
    assert.ok(c.length >= 6);
    assert.ok(c.every((x) => x.replace(/\s/g, '').length <= 14 && x.trim()));
    assert.ok(c.includes('50%'));
    assert.deepEqual(wordChunks(''), []);
  });

  test('caption cues follow each scene, emphasise numbers/offers, shift by the intro', () => {
    const cues = captionCues(
      [{ voiceover: 'ร้อนจนเหงื่อท่วม' }, { voiceover: 'ลดเหลือ 290 บาท' }],
      [
        { start: 0, length: 2 },
        { start: 2, length: 2 },
      ],
      0.5,
    );
    assert.equal(cues[0].start, 0.5);
    const last = cues.at(-1);
    assert.ok(last.start + last.length <= 4.5 + 0.01);
    assert.ok(cues.some((c) => c.text.includes('290') && c.emphasis));
    assert.ok(cues.some((c) => c.text.includes('ลด') && c.emphasis));
  });

  test('shots are ≤1.8s, rotate sources and advance video trims', () => {
    const shots = planShots({
      timings: [{ start: 0, length: 5 }],
      visuals: [null],
      pool: [
        { type: 'video', url: 'v1', durationSec: 10 },
        { type: 'image', url: 'i1' },
      ],
    });
    assert.equal(shots.length, 3);
    assert.ok(shots.every((s) => s.length <= MAX_SHOT_SEC));
    assert.deepEqual(
      shots.map((s) => s.asset.src),
      ['v1', 'i1', 'v1'],
    );
    assert.equal(shots[0].asset.trim, undefined);
    assert.ok(shots[2].asset.trim > 0);
  });

  test('edit: cover intro shifts everything, caption styles, Kanit font', () => {
    const base = {
      scenes: [{ voiceover: 'ลด 50% วันนี้', caption: 'ลดแรง' }],
      timings: [{ start: 0, length: 2 }],
      voiceUrls: ['https://a/1.mp3'],
      visuals: [{ type: 'image', url: 'https://img/p.jpg' }],
    };
    const pop = buildShotstackEdit({ ...base, introUrl: 'https://api/cover.png' });
    const clips = pop.timeline.tracks.flatMap((t) => t.clips);
    const intro = clips.find((c) => c.asset.src === 'https://api/cover.png');
    assert.deepEqual([intro.start, intro.length], [0, 0.5]);
    assert.equal(clips.find((c) => c.asset.type === 'audio').start, 0.5);
    const words = clips.filter((c) => c.asset.type === 'html' && c.asset.css?.includes('Kanit'));
    assert.ok(words.length >= 2);
    assert.ok(words.some((w) => w.asset.css.includes('#FFE600'))); // emphasised "50%"
    assert.ok(words.every((w) => w.offset.y < 0)); // below centre, above TikTok's bottom UI
    assert.ok(pop.timeline.fonts.some((f) => f.src.includes('Kanit')));
    const none = buildShotstackEdit({ ...base, captionStyle: 'none' });
    assert.equal(none.timeline.tracks.flatMap((t) => t.clips).filter((c) => c.asset.css?.includes('Kanit')).length, 0);
    const clean = buildShotstackEdit({ ...base, captionStyle: 'clean' });
    assert.ok(clean.timeline.tracks.flatMap((t) => t.clips).some((c) => c.asset.css?.includes('background: rgba(0,0,0,0.55)')));
  });
});

describe('signed media URLs (unit)', () => {
  test('tokens verify, expire and resist tampering; keys cannot escape the folder', () => {
    const t = media.signToken('m', 5);
    assert.deepEqual({ k: media.verifyToken(t).k, id: media.verifyToken(t).id }, { k: 'm', id: 5 });
    assert.equal(media.verifyToken(media.signToken('m', 5, -10)), null);
    const [p, sig] = t.split('.');
    const forged = Buffer.from(JSON.stringify({ k: 'm', id: 6, exp: 9e9 })).toString('base64url');
    assert.equal(media.verifyToken(`${forged}.${sig}`), null);
    assert.equal(media.verifyToken(`${p}.x`), null);
    assert.equal(media.filePath('../../etc/passwd'), null);
    assert.equal(media.filePath('abc-0123456789abcdef01.mp4').startsWith(process.env.MEDIA_DIR), true);
  });
});

describe('own footage, hooks and variants', () => {
  let pid;
  const mp4 = Buffer.from('00000020667479706d703432', 'hex'); // fake but non-empty
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

  test('create with angle + caption style; prompt lists the angle; hooks stored', async () => {
    scriptCalls = [];
    mockScript();
    const res = await marketer.post('/api/videos', {
      productId: 16,
      tone: 'energetic',
      angle: 'unboxing',
      lengthSec: 15,
      visualMode: 'my_footage',
      captionStyle: 'clean',
    });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    pid = res.body.data.id;
    created.push(pid);
    assert.match(scriptCalls[0].messages[0].content[0].text, /แกะกล่อง/);
    assert.match(scriptCalls[0].system, /hooks 3 แบบ/);
    assert.equal(res.body.data.hooks.length, 3);
    assert.equal(res.body.data.captionStyle, 'clean');
    assert.equal(res.body.data.visualMode, 'my_footage');
    // no footage yet → scene media references dropped
    assert.ok(res.body.data.scenes.every((s) => s.media === null));
  });

  test('upload footage (raw body), validate, list, read back with auth only', async () => {
    assert.equal((await viewer.upload(`/api/videos/${pid}/media`, mp4, 'video/mp4')).status, 403);
    assert.equal((await marketer.upload(`/api/videos/${pid}/media`, Buffer.from('x'), 'application/pdf')).status, 400);
    const v1 = await marketer.upload(`/api/videos/${pid}/media?label=${encodeURIComponent('แกะกล่อง')}&durationMs=8000`, mp4, 'video/mp4');
    assert.equal(v1.status, 201, JSON.stringify(v1.body));
    assert.equal(v1.body.data.kind, 'video');
    assert.equal(v1.body.data.durationMs, 8000);
    const i1 = await marketer.upload(`/api/videos/${pid}/media?label=${encodeURIComponent('ใช้งานจริง')}`, png, 'image/png');
    assert.equal(i1.status, 201);
    const d = (await marketer.get(`/api/videos/${pid}`)).body.data;
    assert.deepEqual(
      d.media.map((m) => m.label),
      ['แกะกล่อง', 'ใช้งานจริง'],
    );
    const file = await marketer.get(d.media[0].url);
    assert.equal(file.status, 200);
    assert.equal(file.headers['content-type'], 'video/mp4');
    assert.equal((await request(app).get(d.media[0].url)).status, 401);
    const renamed = await marketer.patch(`/api/videos/${pid}/media/${d.media[1].id}`, { label: 'ใช้งานกลางแดด' });
    assert.equal(renamed.body.data.label, 'ใช้งานกลางแดด');
  });

  test('upload footage as multipart/form-data (what the web app sends; passes hosting firewalls)', async () => {
    const form = (buf, type, name) =>
      request(app).post(`/api/videos/${pid}/media?label=${encodeURIComponent('มัลติพาร์ต')}`).set('Cookie', marketer.cookie).attach('file', buf, { filename: name, contentType: type });
    const ok = await form(png, 'image/png', 'shot.png');
    assert.equal(ok.status, 201, JSON.stringify(ok.body));
    assert.deepEqual([ok.body.data.kind, ok.body.data.label, ok.body.data.mime], ['image', 'มัลติพาร์ต', 'image/png']);
    const saved = await marketer.get(ok.body.data.url);
    assert.ok(Buffer.from(saved.body).equals(png), 'stored bytes are the uploaded file');

    assert.equal((await form(Buffer.from('%PDF'), 'application/pdf', 'x.pdf')).status, 400);
    const big = await form(Buffer.alloc(media.MAX_IMAGE_BYTES + 1), 'image/png', 'big.png');
    assert.equal(big.status, 400);
    assert.match(big.body.error.message, /ใหญ่เกิน/);
    // keep the two files the next tests expect
    assert.equal((await marketer.delete(`/api/videos/${pid}/media/${ok.body.data.id}`)).status, 200);
  });

  test('AI rewrite sees footage labels and maps scenes to footage numbers', async () => {
    scriptCalls = [];
    mockScript();
    const r = await marketer.post(`/api/videos/${pid}/script`, {});
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.match(scriptCalls[0].messages[0].content[0].text, /1\) คลิป: แกะกล่อง\n2\) รูป: ใช้งานกลางแดด/);
    assert.deepEqual(
      r.body.data.scenes.map((s) => s.media),
      [2, null, null],
    ); // 9 is out of range
  });

  test('switch hook replaces the opening scene; variant copies the project and shares files', async () => {
    const h = await marketer.post(`/api/videos/${pid}/hook`, { index: 1 });
    assert.equal(h.status, 200);
    assert.equal(h.body.data.scenes[0].voiceover, 'เย็นทันทีใน 3 วินาที');
    assert.equal(h.body.data.scenes[0].caption, 'เย็นใน 3 วิ');
    assert.equal((await marketer.post(`/api/videos/${pid}/hook`, { index: 5 })).status, 400);
    const v = await marketer.post(`/api/videos/${pid}/variant`, { hookIndex: 2 });
    assert.equal(v.status, 201, JSON.stringify(v.body));
    created.push(v.body.data.id);
    assert.match(v.body.data.title, /คำถาม/);
    assert.equal(v.body.data.scenes[0].voiceover, 'พัดลมเล็กแค่นี้ แรงได้แค่ไหน');
    const vm = (await marketer.get(`/api/videos/${v.body.data.id}`)).body.data.media;
    assert.equal(vm.length, 2);
    // Deleting the variant keeps the original's files
    const keys = await db.query('SELECT storage_key FROM video_media WHERE video_project_id = :id', { id: pid });
    assert.equal((await marketer.delete(`/api/videos/${v.body.data.id}`)).status, 200);
    assert.ok(keys.every((k) => fs.existsSync(media.filePath(k.storage_key))));
  });

  test('generate needs PUBLIC_API_URL for own footage; render uses signed URLs, word captions and cover intro', async () => {
    env.PUBLIC_API_URL = undefined;
    const no = await marketer.post(`/api/videos/${pid}/generate`);
    assert.equal(no.status, 400);
    assert.match(no.body.error.message, /PUBLIC_API_URL/);

    env.PUBLIC_API_URL = 'https://api.example.com';
    process.env.SHOTSTACK_API_KEY = 'ss-key';
    // A ready portrait cover as the first frame
    const c = await db.query("INSERT INTO cover_projects (org_id, orientation, style, headline, status) VALUES (1, 'portrait', 'pop', :h, 'ready')", {
      h: `cover ${RUN}`,
    });
    coverIds.push(c.insertId);
    await db.query("INSERT INTO cover_assets (cover_id, kind, mime, data) VALUES (:id, 'final', 'image/png', :d)", { id: c.insertId, d: png });
    const d = (await marketer.get(`/api/videos/${pid}`)).body.data;
    const put = await marketer.put(`/api/videos/${pid}`, {
      title: d.title,
      scenes: d.scenes,
      postCaption: d.postCaption,
      hashtags: d.hashtags,
      visualMode: 'my_footage',
      captionStyle: 'pop',
      coverId: c.insertId,
      voiceProvider: 'minimax',
      voiceId: null,
    });
    assert.equal(put.status, 200, JSON.stringify(put.body));
    assert.equal(put.body.data.coverId, c.insertId);

    calls.length = 0;
    assert.equal((await marketer.post(`/api/videos/${pid}/generate`)).status, 202);
    await drain();
    await drain();
    const render = calls.find((x) => x.url.endsWith('/edit/stage/render'));
    assert.ok(render, 'render requested');
    const edit = JSON.parse(render.init.body);
    const clips = edit.timeline.tracks.flatMap((t) => t.clips);
    const signed = clips.filter((x) => String(x.asset.src ?? '').startsWith('https://api.example.com/api/media/'));
    assert.ok(signed.some((x) => x.asset.type === 'video'));
    const intro = clips.find((x) => x.start === 0 && x.length === 0.5 && x.asset.type === 'image');
    assert.ok(intro && intro.asset.src.startsWith('https://api.example.com/api/media/'));
    assert.ok(clips.filter((x) => x.asset.type !== 'html' && x.asset.type !== 'audio').every((x) => x.length <= MAX_SHOT_SEC));
    assert.ok(clips.some((x) => x.asset.css?.includes('Kanit')));

    // The renderer can fetch the signed URLs without logging in
    const pathOf = (u) => new URL(u).pathname;
    const vid = await request(app).get(pathOf(signed.find((x) => x.asset.type === 'video').asset.src));
    assert.equal(vid.status, 200);
    assert.equal(vid.headers['content-type'], 'video/mp4');
    const cov = await request(app).get(pathOf(intro.asset.src));
    assert.equal(cov.status, 200);
    assert.equal(cov.headers['content-type'], 'image/png');
    assert.equal((await request(app).get('/api/media/bogus.token')).status, 403);

    const v = await db.one('SELECT status FROM video_projects WHERE id = :id', { id: pid });
    assert.equal(v.status, 'ready');
  });

  test('delete footage clears out-of-range scene references; project delete removes files', async () => {
    const d = (await marketer.get(`/api/videos/${pid}`)).body.data;
    const keys = await db.query('SELECT storage_key FROM video_media WHERE video_project_id = :id', { id: pid });
    assert.equal((await marketer.delete(`/api/videos/${pid}/media/${d.media[1].id}`)).status, 200);
    const after1 = (await marketer.get(`/api/videos/${pid}`)).body.data;
    assert.ok(after1.scenes.every((s) => s.media === null || s.media <= 1));
    assert.equal((await marketer.delete(`/api/videos/${pid}`)).status, 200);
    assert.ok(keys.every((k) => !fs.existsSync(media.filePath(k.storage_key))));
  });
});
