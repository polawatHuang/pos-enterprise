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
const shotstackGen = { n: 0, jobs: new Map(), refuse: null, fail: null };
const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const RUN = Date.now().toString(36);
const originalFetch = global.fetch;
const originalCreate = minimax.createMessage;
const ENV_KEYS = ['VIDEO_SCENE_AI', 'MINIMAX_API_KEY', 'MINIMAX_VOICE_ID', 'AI_PROVIDER', 'SHOTSTACK_API_KEY', 'SHOTSTACK_ENV', 'R2_ACCOUNT_ID'];
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
const JOBS = "('video.images','video.voice','video.clips_start','video.clips_poll','video.compose','video.compose_poll')";
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
    if (u.includes('/v1/image_generation')) return json({ data: { image_base64: [PNG_B64] }, base_resp: { status_code: 0 } });
    if (u.includes('/v1/video_generation')) {
      const body = JSON.parse(init.body);
      return json({ task_id: `t${calls.filter((c) => c.url.includes('/v1/video_generation')).length}-${body.duration}`, base_resp: { status_code: 0 } });
    }
    if (u.includes('/v1/query/video_generation')) return json({ status: 'Success', file_id: new URL(u).searchParams.get('task_id'), base_resp: { status_code: 0 } });
    if (u.includes('/v1/files/retrieve')) return json({ file: { download_url: `https://cdn.minimax.test/${new URL(u).searchParams.get('file_id')}.mp4` }, base_resp: { status_code: 0 } });
    if (u === 'https://img.example.com/p16.jpg') return new Response(Buffer.from(PNG_B64, 'base64'), { headers: { 'content-type': 'image/png' } });
    // Shotstack Edit API generation (models, /generate jobs) — shotstackGen lets a test fail a job or the request
    if (u.includes('api.shotstack.io/edit/stage/models/')) {
      const model = decodeURIComponent(u.split('/').pop());
      const video = model.includes('video');
      return json({
        model,
        type: video ? 'video' : 'image',
        available: true,
        options: { properties: video ? { startSrc: { type: 'string' }, aspectRatio: { enum: ['16:9', '9:16'] } } : { aspectRatio: { enum: ['1:1', '9:16'] } } },
      });
    }
    if (u.endsWith('api.shotstack.io/edit/stage/generate')) {
      const body = JSON.parse(init.body);
      if (shotstackGen.refuse?.(body)) return json({ error: 'Access to AI generation is not included', code: 'AiCapabilityNotIncluded' }, 403);
      const id = `g${(shotstackGen.n += 1)}`;
      shotstackGen.jobs.set(id, body);
      return json({ id, status: 'queued' }, 202);
    }
    if (u.includes('api.shotstack.io/edit/stage/generate/')) {
      const id = u.split('/').pop();
      const job = shotstackGen.jobs.get(id);
      if (shotstackGen.fail?.(job)) return json({ id, status: 'failed', error: 'content policy' });
      return json({ id, status: 'done', url: `https://shotstack.test/${id}.${job.asset.type === 'image' ? 'png' : 'mp4'}` });
    }
    if (u.startsWith('https://shotstack.test/g')) return new Response(Buffer.from(PNG_B64, 'base64'), { headers: { 'content-type': 'image/png' } });
    if (u.includes('/v1/get_voice'))
      return json({
        system_voice: [
          { voice_id: 'Thai_female_1', voice_name: 'Thai Female', description: ['ไทย', 'ผู้หญิง'] },
          { voice_id: 'English_Narrator', voice_name: 'Narrator', description: [] },
        ],
        voice_cloning: [{ voice_id: 'my_clone_01', description: ['ร้านเรา'], created_time: '2026-01-01' }],
        voice_generation: [{ voice_id: 'gen_02', description: 'deep' }, { voice_id: '' }],
        base_resp: { status_code: 0 },
      });
    if (u.includes('api.shotstack.io/edit/stage/render/'))
      return json({ success: true, response: { id: 'r1', status: 'done', url: 'https://shotstack.test/out.mp4' } });
    if (u.includes('api.shotstack.io/edit/stage/render')) return json({ success: true, response: { id: 'r1', message: 'queued' } });
    return new Response('not found', { status: 404 });
  };
  for (const k of ENV_KEYS) delete process.env[k];
  process.env.MINIMAX_API_KEY = 'mm-key';
  process.env.MINIMAX_VOICE_ID = 'Thai_female_1';
  process.env.VIDEO_SCENE_AI = 'minimax'; // the Shotstack path has its own test
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
    // publicUrl's extension is stripped before verifying; a signature tail is never mistaken for one
    assert.equal(media.tokenFromParam(`${t}.jpg`), t);
    assert.equal(media.tokenFromParam(t), t);
    assert.equal(media.tokenFromParam('abc.ik'), 'abc.ik');
    assert.equal(media.extOf('lx-0123456789abcdef01.webp'), 'webp');
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

  test('chunked JSON upload: resumable, ordered, size-checked, then saved like a normal upload', async () => {
    const file = require('node:crypto').randomBytes(900 * 1024); // 3 chunks of 384 KB
    const base = `/api/videos/${pid}/media/uploads`;
    assert.equal((await marketer.post(base, { mime: 'application/pdf', size: 10 })).status, 400);
    assert.equal((await marketer.post(base, { mime: 'image/png', size: media.MAX_IMAGE_BYTES + 1 })).status, 400);

    const start = await marketer.post(base, { mime: 'image/png', size: file.length, label: 'ทีละชิ้น' });
    assert.equal(start.status, 201, JSON.stringify(start.body));
    const { uploadId, chunkSize } = start.body.data;
    const put = (offset, buf) => marketer.put(`${base}/${uploadId}`, { offset, data: buf.toString('base64') });

    assert.equal((await put(0, file.subarray(0, chunkSize))).body.data.received, chunkSize);
    assert.equal((await put(0, file.subarray(0, chunkSize))).status, 200, 'a resent chunk is accepted');
    const gap = await put(chunkSize * 2, file.subarray(chunkSize * 2));
    assert.equal(gap.status, 409);
    assert.equal(gap.body.error.details.received, chunkSize);
    assert.equal((await marketer.post(`${base}/${uploadId}/complete`, {})).status, 400, 'not all bytes yet');

    await put(chunkSize, file.subarray(chunkSize, chunkSize * 2));
    const last = await put(chunkSize * 2, file.subarray(chunkSize * 2));
    assert.equal(last.body.data.received, file.length);
    assert.equal((await put(file.length, Buffer.from('x'))).status, 400, 'beyond the declared size');

    const done = await marketer.post(`${base}/${uploadId}/complete`, {});
    assert.equal(done.status, 201, JSON.stringify(done.body));
    assert.equal(done.body.data.label, 'ทีละชิ้น');
    const saved = await marketer.get(done.body.data.url);
    assert.ok(Buffer.from(saved.body).equals(file), 'reassembled byte for byte');
    assert.equal((await marketer.post(`${base}/${uploadId}/complete`, {})).status, 404, 'temporary files are gone');
    assert.equal((await marketer.put(`/api/videos/999999/media/uploads/${uploadId}`, { offset: 0, data: 'eA==' })).status, 404);
    assert.equal((await marketer.delete(`/api/videos/${pid}/media/${done.body.data.id}`)).status, 200);
  });

  test('AI rewrite writes one scene per scene picture, in order, and sees the images', async () => {
    scriptCalls = [];
    mockScript();
    const r = await marketer.post(`/api/videos/${pid}/script`, {});
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const content = scriptCalls[0].messages[0].content;
    assert.match(content[0].text, /ภาพฉากของผู้ใช้ 2 ภาพ — เขียน scenes 2 ฉากพอดี[^]*1\) คลิป: แกะกล่อง\n2\) รูป: ใช้งานกลางแดด/);
    // the photo goes to the model as an image; the video is described by its label
    const imgs = content.filter((b) => b.type === 'image');
    assert.equal(imgs.length, 1);
    assert.equal(imgs[0].source.media_type, 'image/png');
    assert.match(content[content.indexOf(imgs[0]) - 1].text, /ภาพที่ 2/);
    // 3 scenes from the model, 2 pictures → 2 scenes, shown in picture order
    assert.deepEqual(
      r.body.data.scenes.map((s) => s.media),
      [null, null],
    );
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
    for (let i = 0; i < 6 && (await db.one('SELECT status FROM video_projects WHERE id = :id', { id: pid })).status !== 'ready'; i += 1) await drain();
    // Scene 1 is the user's own video (played as is); scene 2's photo is animated by Hailuo as the first frame
    const hailuo = calls.filter((x) => x.url.includes('/v1/video_generation'));
    assert.equal(hailuo.length, 1);
    assert.match(JSON.parse(hailuo[0].init.body).first_frame_image, /^data:image\/png;base64,/);
    const render = calls.find((x) => x.url.endsWith('/edit/stage/render'));
    assert.ok(render, 'render requested');
    const edit = JSON.parse(render.init.body);
    const clips = edit.timeline.tracks.flatMap((t) => t.clips);
    const signed = clips.filter((x) => String(x.asset.src ?? '').startsWith('https://api.example.com/api/media/'));
    assert.ok(signed.some((x) => x.asset.type === 'video'));
    const intro = clips.find((x) => x.start === 0 && x.length === 0.5 && x.asset.type === 'image');
    assert.ok(intro && intro.asset.src.startsWith('https://api.example.com/api/media/'));
    // one shot per scene, in order: own video, then the AI clip
    const visual = clips.filter((x) => (x.asset.type === 'video' || x.asset.type === 'image') && x !== intro).sort((a, b) => a.start - b.start);
    assert.equal(visual.length, 2);
    assert.match(visual[0].asset.src, /^https:\/\/api\.example\.com\/api\/media\//);
    assert.match(visual[1].asset.src, /^https:\/\/cdn\.minimax\.test\/t1-6\.mp4$/);
    assert.ok(clips.some((x) => x.asset.css?.includes('Kanit')));

    // Shotstack reads the file type from the URL: every media src ends in the real extension
    const SHOTSTACK_EXT = /\.(jpg|jpeg|png|gif|webp|bmp|tiff|avif|svg|mp4|mov|webm|mp3)$/;
    const srcs = clips.map((x) => x.asset.src).filter(Boolean);
    assert.ok(srcs.every((u) => SHOTSTACK_EXT.test(new URL(u).pathname)), srcs.join(' '));
    assert.ok(signed.some((x) => x.asset.src.endsWith('.mp4')) && intro.asset.src.endsWith('.png'));

    // The renderer can fetch the signed URLs without logging in (with or without the extension)
    const pathOf = (u) => new URL(u).pathname;
    const vid = await request(app).get(pathOf(signed.find((x) => x.asset.type === 'video').asset.src));
    assert.equal(vid.status, 200);
    assert.equal((await request(app).get(pathOf(signed.find((x) => x.asset.type === 'video').asset.src).replace(/\.mp4$/, ''))).status, 200);
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

describe('scene pictures → AI video', () => {
  test('no pictures: AI draws each scene (product scene uses the real photo), then Hailuo animates them in order', async () => {
    mockScript();
    env.PUBLIC_API_URL = 'https://api.example.com';
    process.env.SHOTSTACK_API_KEY = 'ss-key';
    const before = (await db.one('SELECT image_url FROM products WHERE id = 16')).image_url;
    await db.query("UPDATE products SET image_url = 'https://img.example.com/p16.jpg' WHERE id = 16");
    try {
      const res = await marketer.post('/api/videos', { productId: 16, tone: 'friendly', lengthSec: 15, visualMode: 'my_footage' });
      assert.equal(res.status, 201, JSON.stringify(res.body));
      const id = res.body.data.id;
      created.push(id);
      calls.length = 0;
      const gen = await marketer.post(`/api/videos/${id}/generate`);
      assert.equal(gen.status, 202, JSON.stringify(gen.body));
      assert.equal(gen.body.data.status, 'generating_clips');
      assert.equal(gen.body.data.estimate.aiImages, 3);
      for (let i = 0; i < 10 && (await db.one('SELECT status FROM video_projects WHERE id = :id', { id })).status !== 'ready'; i += 1) await drain();
      const v = await db.one('SELECT status, error FROM video_projects WHERE id = :id', { id });
      assert.equal(v.status, 'ready', v.error);

      const files = await db.query('SELECT label, kind FROM video_media WHERE video_project_id = :id ORDER BY sort_order, id', { id });
      assert.deepEqual(
        files.map((f) => f.label),
        ['AI · ฉาก 1', 'รูปสินค้า · ฉาก 2', 'AI · ฉาก 3'],
      );
      assert.equal(calls.filter((c) => c.url.includes('/v1/image_generation')).length, 2);
      const hailuo = calls.filter((c) => c.url.includes('/v1/video_generation')).map((c) => JSON.parse(c.init.body));
      assert.equal(hailuo.length, 3);
      assert.ok(hailuo.every((b) => b.first_frame_image.startsWith('data:image/')));
      // the render plays the three AI clips in scene order
      const edit = JSON.parse(calls.find((x) => x.url.endsWith('/edit/stage/render')).init.body);
      const shots = edit.timeline.tracks
        .flatMap((t) => t.clips)
        .filter((x) => x.asset.type === 'video')
        .sort((a, b) => a.start - b.start);
      assert.deepEqual(
        shots.map((x) => x.asset.src.replace(/^.*\/(t\d)-\d+\.mp4$/, '$1')),
        ['t1', 't2', 't3'],
      );

      // A second run reuses the clips while the pictures are unchanged
      calls.length = 0;
      await marketer.post(`/api/videos/${id}/generate`);
      for (let i = 0; i < 6 && (await db.one('SELECT status FROM video_projects WHERE id = :id', { id })).status !== 'ready'; i += 1) await drain();
      assert.equal(calls.filter((c) => c.url.includes('/v1/video_generation') || c.url.includes('/v1/image_generation')).length, 0);
    } finally {
      await db.query('UPDATE products SET image_url = :u WHERE id = 16', { u: before });
      delete process.env.SHOTSTACK_API_KEY;
    }
  });
});

describe('scene pictures → AI video with Shotstack (VIDEO_SCENE_AI=shotstack)', () => {
  const statusOf = async (id) => db.one('SELECT status, error, stage_detail FROM video_projects WHERE id = :id', { id });
  async function run(id) {
    calls.length = 0;
    shotstackGen.jobs.clear();
    const gen = await marketer.post(`/api/videos/${id}/generate`);
    assert.equal(gen.status, 202, JSON.stringify(gen.body));
    for (let i = 0; i < 25 && !['ready', 'failed'].includes((await statusOf(id)).status); i += 1) await drain();
    return statusOf(id);
  }
  async function project() {
    mockScript();
    const res = await marketer.post('/api/videos', { productId: 16, tone: 'friendly', lengthSec: 15, visualMode: 'my_footage' });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    created.push(res.body.data.id);
    return res.body.data.id;
  }
  before(() => {
    env.PUBLIC_API_URL = 'https://api.example.com';
    process.env.SHOTSTACK_API_KEY = 'ss-key';
    process.env.VIDEO_SCENE_AI = 'shotstack';
  });
  after(() => {
    process.env.VIDEO_SCENE_AI = 'minimax';
    delete process.env.SHOTSTACK_API_KEY;
    Object.assign(shotstackGen, { refuse: null, fail: null });
  });

  test('pictures drawn and animated with /generate (image model, then image-to-video from each picture), clips played in order', async () => {
    const id = await project();
    const v = await run(id);
    assert.equal(v.status, 'ready', v.error);
    assert.equal(calls.filter((c) => c.url.includes('/v1/image_generation') || c.url.includes('/v1/video_generation')).length, 0);

    const gens = calls.filter((c) => c.url.endsWith('/edit/stage/generate')).map((c) => JSON.parse(c.init.body));
    const imgs = gens.filter((g) => g.asset.type === 'image');
    assert.equal(imgs.length, 3);
    assert.deepEqual(imgs[0].asset.options, { aspectRatio: '9:16' });
    assert.equal(imgs[0].asset.model, 'nano-banana-2');
    const files = await db.query('SELECT label FROM video_media WHERE video_project_id = :id ORDER BY sort_order, id', { id });
    assert.deepEqual(
      files.map((f) => f.label),
      ['AI · ฉาก 1', 'AI · ฉาก 2', 'AI · ฉาก 3'],
    );

    const vids = gens.filter((g) => g.asset.type === 'video');
    assert.equal(vids.length, 3);
    assert.equal(vids[0].asset.model, 'seedance-2.0-image-to-video');
    assert.match(vids[0].asset.options.startSrc, /^https:\/\/api\.example\.com\/api\/media\/[^/]+\.png$/);
    assert.equal(vids[0].asset.options.aspectRatio, '9:16');
    assert.ok(vids.every((g) => g.length > 1), 'clip length follows the scene');
    assert.ok(!calls.some((c) => c.url.includes('/create/')), 'no deprecated Create API');

    const edit = JSON.parse(calls.filter((x) => x.url.endsWith('/edit/stage/render')).at(-1).init.body);
    const shots = edit.timeline.tracks
      .flatMap((t) => t.clips)
      .filter((x) => x.asset.type === 'video')
      .sort((a, b) => a.start - b.start);
    assert.deepEqual(
      shots.map((x) => x.asset.src),
      ['g4', 'g5', 'g6'].map((g) => `https://shotstack.test/${g}.mp4`),
    );
  });

  test('plan without AI video: the project fails with the reason instead of rendering stills', async () => {
    shotstackGen.refuse = (body) => body.asset.type === 'video';
    try {
      const id = await project();
      const v = await run(id);
      assert.equal(v.status, 'failed');
      assert.match(v.error, /แพ็กเกจ Shotstack ของคุณไม่รวม AI generation/);
      assert.ok(!calls.some((c) => c.url.endsWith('/edit/stage/render')), 'nothing rendered');
    } finally {
      shotstackGen.refuse = null;
    }
  });

  test('a scene whose clip fails shows its picture, and the reason stays visible after the render', async () => {
    // the second scene's clip job fails
    shotstackGen.fail = (job) => job.asset.type === 'video' && job === [...shotstackGen.jobs.values()].filter((j) => j.asset.type === 'video')[1];
    try {
      const id = await project();
      const v = await run(id);
      assert.equal(v.status, 'ready', v.error);
      assert.match(v.stage_detail, /ฉาก 2 ใช้ภาพนิ่ง: Shotstack สร้างคลิปไม่สำเร็จ: content policy/);
      assert.ok(v.stage_detail.length <= 255);
    } finally {
      shotstackGen.fail = null;
    }
  });

  test('everything fails: the project fails with the reason', async () => {
    shotstackGen.fail = (job) => job.asset.type === 'video';
    try {
      const id = await project();
      const v = await run(id);
      assert.equal(v.status, 'failed');
      assert.match(v.error, /สร้างคลิป AI ไม่สำเร็จทุกฉาก — Shotstack สร้างคลิปไม่สำเร็จ: content policy/);
    } finally {
      shotstackGen.fail = null;
    }
  });
});

describe('Shotstack errors', () => {
  test('a Bad Request carries the validation details', async () => {
    const shotstack = require('../src/integrations/shotstack');
    const saved = global.fetch;
    process.env.SHOTSTACK_API_KEY = 'ss-key';
    try {
      global.fetch = async () =>
        json({ success: false, message: 'Bad Request', response: { error: { details: [{ message: '"output.size.width" must be a number' }] } } }, 400);
      await assert.rejects(shotstack.render({}), /Bad Request — "output\.size\.width" must be a number/);
      global.fetch = async () => json({ error: 'Insufficient generation credits.', available: 1.5 }, 402);
      await assert.rejects(shotstack.generate({ type: 'image', prompt: 'x' }), /HTTP 402 — Insufficient generation credits\.; เครดิต Shotstack ไม่พอ \(เหลือ 1\.5\)/);
    } finally {
      global.fetch = saved;
      delete process.env.SHOTSTACK_API_KEY;
    }
  });
});

describe('MiniMax voice list', () => {
  test('lists system, cloned and generated voices, cached, and needs video:create', async () => {
    const before = calls.filter((c) => c.url.includes('/v1/get_voice')).length;
    const res = await marketer.get('/api/videos/voices');
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.deepEqual(
      res.body.data.map((v) => [v.id, v.group]),
      [
        ['Thai_female_1', 'system'],
        ['English_Narrator', 'system'],
        ['my_clone_01', 'cloned'],
        ['gen_02', 'generated'],
      ],
    );
    assert.equal(res.body.data[0].name, 'Thai Female');
    assert.equal(res.body.data[0].description, 'ไทย ผู้หญิง');
    assert.equal(res.body.data[2].name, 'my_clone_01');
    assert.ok(!JSON.stringify(res.body).includes('mm-key'));

    assert.equal((await marketer.get('/api/videos/voices')).status, 200);
    assert.equal(calls.filter((c) => c.url.includes('/v1/get_voice')).length, before + 1);
    assert.equal(calls.find((c) => c.url.includes('/v1/get_voice')).init.headers.Authorization, 'Bearer mm-key');

    assert.equal((await viewer.get('/api/videos/voices')).status, 403);

    delete process.env.MINIMAX_API_KEY;
    try {
      const off = await marketer.get('/api/videos/voices');
      assert.equal(off.status, 503);
      assert.equal(off.body.error.code, 'INTEGRATION_NOT_CONFIGURED');
    } finally {
      process.env.MINIMAX_API_KEY = 'mm-key';
    }
  });
});
