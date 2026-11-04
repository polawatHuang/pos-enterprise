'use strict';

// ละคร AI: a project goes through script → characters → cover → storyboard (stills + MiniMax H3
// clips) → voices → render in queued units; finished work is not redone; cancel stops the run;
// one failed shot does not fail the project. MiniMax, the AI writer and Shotstack are mocked.
process.env.NODE_ENV = 'test';
process.env.MEDIA_DIR = require('node:path').join(require('node:os').tmpdir(), `drama-test-${process.pid}`);
const savedPublicUrl = process.env.PUBLIC_API_URL;
process.env.PUBLIC_API_URL = 'https://api.shop.test'; // read when the config loads

const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { createApp } = require('../src/app');
const db = require('../src/db/pool');
const { runDue } = require('../src/jobs/runner');
const minimax = require('../src/integrations/minimax');
const shotstack = require('../src/integrations/shotstack');
const { buildDramaEdit } = require('../src/modules/drama/timeline');
const { pickVoice } = require('../src/modules/drama/drama.service');

const app = createApp();
const ENV = { MINIMAX_API_KEY: 'mm-key', AI_PROVIDER: 'minimax' };
const saved = Object.fromEntries([...Object.keys(ENV), 'ANTHROPIC_API_KEY'].map((k) => [k, process.env[k]]));
const originals = { fetch: global.fetch, create: minimax.createMessage, render: shotstack.render, getRender: shotstack.getRender, isConfigured: shotstack.isConfigured };
let calls = [];
let failImageNo = null;
let imageNo = 0;
let projectId;
let manager;

const PNG = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000', 'hex');
const json = (b) => new Response(JSON.stringify(b), { status: 200, headers: { 'content-type': 'application/json' } });

const SCRIPT = {
  title: 'ผีบ้านริมคลอง',
  logline: 'มะลิย้ายเข้าบ้านเก่าแล้วพบความลับของยาย',
  characters: [
    { key: 'mali', name: 'มะลิ', role: 'นางเอก', gender: 'female', age: 'young', description: 'สาวกล้า', look: 'young Thai woman, long black hair, white blouse' },
    { key: 'yai', name: 'ยายเพียร', role: 'ผีบ้าน', gender: 'female', age: 'elder', description: 'ยายผู้เฝ้าบ้าน', look: 'elderly Thai woman, grey bun, faded sarong' },
  ],
  shots: [
    { scene: 'ย้ายบ้าน', narration: 'คืนแรกในบ้านริมคลอง', dialogue: [], visual: 'old Thai house by a canal at night', camera: 'slow push in', characters: ['mali'], key: false },
    { scene: 'เสียงเรียก', narration: '', dialogue: [{ character: 'yai', line: 'หนูมาแล้วหรือลูก' }], visual: 'ghostly old woman in doorway', camera: 'handheld', characters: ['yai'], key: true },
    { scene: 'ความจริง', narration: 'มะลิรู้แล้วว่ายายรอเธอมาตลอด', dialogue: [{ character: 'mali', line: 'ยายคะ' }], visual: 'mali hugging the ghost', camera: 'pull out', characters: ['mali', 'yai'], key: true },
  ],
};

async function drain(rounds = 60) {
  for (let i = 0; i < rounds; i += 1) {
    await db.query("UPDATE jobs SET run_at = UTC_TIMESTAMP() WHERE status = 'queued' AND type LIKE 'drama.%'");
    await db.query("UPDATE jobs SET run_at = UTC_TIMESTAMP() + INTERVAL 1 DAY WHERE status = 'queued' AND type NOT LIKE 'drama.%'");
    await runDue({ maxJobs: 20 });
    const [{ n }] = await db.query("SELECT COUNT(*) AS n FROM jobs WHERE status = 'queued' AND type LIKE 'drama.%'");
    if (!Number(n)) return;
  }
}

before(async () => {
  Object.assign(process.env, ENV);
  delete process.env.ANTHROPIC_API_KEY;
  minimax.createMessage = async (params) => ({
    model: 'MiniMax-M3',
    stop_reason: 'tool_use',
    content: [{ type: 'tool_use', id: 't', name: params.tools[0].name, input: SCRIPT }],
  });
  shotstack.isConfigured = () => true;
  shotstack.render = async (edit) => {
    calls.push({ path: 'shotstack.render', body: edit });
    return { renderId: 'r-1' };
  };
  shotstack.getRender = async () => ({ status: 'ready', url: 'https://cdn.test/final.mp4' });
  global.fetch = async (url, init = {}) => {
    const u = new URL(String(url));
    const body = init.body ? JSON.parse(init.body) : null;
    calls.push({ path: u.pathname, body });
    if (u.pathname === '/v1/image_generation') {
      imageNo += 1;
      if (failImageNo === imageNo) return json({ base_resp: { status_code: 1026, status_msg: 'content blocked' } });
      return json({ data: { image_base64: [PNG.toString('base64')] }, base_resp: { status_code: 0 } });
    }
    if (u.pathname === '/v1/get_voice')
      return json({ system_voice: [{ voice_id: 'thai_female_1', voice_name: 'Thai female', description: ['Thai woman'] }, { voice_id: 'thai_male_1', voice_name: 'Thai male', description: ['Thai man'] }, { voice_id: 'thai_old_lady', voice_name: 'Thai elder female', description: ['old woman Thai'] }], base_resp: { status_code: 0 } });
    if (u.pathname === '/v1/t2a_v2') return json({ data: { audio: `https://cdn.test/a-${calls.length}.mp3` }, extra_info: { audio_length: 2000 }, base_resp: { status_code: 0 } });
    if (u.pathname === '/v2/video_generation') return json({ task_id: `task-${calls.length}`, base_resp: { status_code: 0 } });
    if (u.pathname.startsWith('/v2/query/video_generation/')) return json({ task: { status: 'Success', content: { url: 'https://cdn.test/clip.mp4' } }, base_resp: { status_code: 0 } });
    if (u.host === 'cdn.test') return new Response(Buffer.from('media-bytes'), { status: 200 });
    return json({ base_resp: { status_code: 0 } });
  };
  const res = await request(app).post('/api/auth/login').send({ email: 'admin@example.com', password: 'Admin@1234' });
  const cookie = res.headers['set-cookie'].map((c) => c.split(';')[0]).join('; ');
  manager = {
    get: (url) => request(app).get(url).set('Cookie', cookie),
    post: (url, body) => request(app).post(url).set('Cookie', cookie).send(body ?? {}),
    put: (url, body) => request(app).put(url).set('Cookie', cookie).send(body),
  };
});

after(async () => {
  global.fetch = originals.fetch;
  minimax.createMessage = originals.create;
  Object.assign(shotstack, { render: originals.render, getRender: originals.getRender, isConfigured: originals.isConfigured });
  if (savedPublicUrl === undefined) delete process.env.PUBLIC_API_URL;
  else process.env.PUBLIC_API_URL = savedPublicUrl;
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  await db.query("DELETE FROM jobs WHERE type LIKE 'drama.%'");
  if (projectId) await db.query('DELETE FROM drama_projects WHERE id = :id', { id: projectId });
  await db.query("DELETE FROM drama_style_previews WHERE genre = 'ghost'");
  require('node:fs').rmSync(process.env.MEDIA_DIR, { recursive: true, force: true });
  await db.pool.end();
});

describe('ละคร AI', () => {
  test('catalog lists genres, styles, lengths and visual modes', async () => {
    const r = await manager.get('/api/drama/catalog');
    assert.equal(r.status, 200);
    assert.ok(r.body.data.genres.some((g) => g.id === 'ghost'));
    assert.ok(r.body.data.styles.length >= 10);
    assert.deepEqual(
      r.body.data.lengths.map((l) => l.sec),
      [60, 120, 180],
    );
  });

  test('create in mixed mode → script: characters with voices, key shots become H3 clips', async () => {
    const r = await manager.post('/api/drama', { genre: 'ghost', style: 'cinematic', lengthSec: 60, visualMode: 'mixed', premise: 'ผีบ้านริมคลอง', narratorVoiceId: 'narrator_v', music: true });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    projectId = r.body.data.id;
    assert.equal(r.body.data.estimate.clips, 3);
    await manager.post(`/api/drama/${projectId}/run`, { target: 'script' });
    await drain();
    const d = (await manager.get(`/api/drama/${projectId}`)).body.data;
    assert.equal(d.title, 'ผีบ้านริมคลอง');
    assert.equal(d.steps.find((s) => s.key === 'script').status, 'done');
    assert.equal(d.characters.length, 2);
    assert.equal(d.characters[0].voiceId, 'thai_female_1');
    assert.equal(d.characters[1].voiceId, 'thai_old_lady');
    assert.deepEqual(
      d.shots.map((s) => s.kind),
      ['still', 'clip', 'clip'],
    );
    assert.equal(d.runTarget, null);
  });

  test('auto: one failed storyboard image does not fail the project; clips use H3 v2 with the shot as first frame', async () => {
    calls = [];
    imageNo = 0;
    failImageNo = 4; // 2 portraits, cover, then shot 1 fails
    await manager.post(`/api/drama/${projectId}/run`, { target: 'all' });
    await drain();
    const d = (await manager.get(`/api/drama/${projectId}`)).body.data;
    assert.equal(d.error, null, d.error);
    assert.ok(d.outputUrl, JSON.stringify({ stage: d.stageDetail, run: d.runTarget, steps: d.steps }));
    assert.ok(d.characters.every((c) => c.portraitUrl));
    assert.ok(d.coverUrl);
    assert.equal(d.shots[0].imageStatus, 'failed');
    assert.match(d.shots[0].error, /content blocked/);
    assert.ok(d.shots.slice(1).every((s) => s.imageStatus === 'done' && s.clipStatus === 'done' && s.clipUrl));
    // storyboard keeps the character's face: subject reference from the portrait
    const shotImages = calls.filter((c) => c.path === '/v1/image_generation').slice(3);
    assert.ok(shotImages.every((c) => c.body.subject_reference?.[0]?.image_file?.startsWith('data:image/')));
    const h3 = calls.filter((c) => c.path === '/v2/video_generation');
    assert.equal(h3.length, 2);
    assert.equal(h3[0].body.model, 'MiniMax-H3');
    assert.equal(h3[0].body.ratio, '9:16');
    assert.equal(h3[0].body.content[1].role, 'first_frame');
    assert.match(h3[0].body.content[1].image_url.url, /^data:image\//);
    // narrator and characters speak with their own voices
    const tts = calls.filter((c) => c.path === '/v1/t2a_v2').map((c) => [c.body.text, c.body.voice_setting.voice_id]);
    assert.deepEqual(tts, [
      ['คืนแรกในบ้านริมคลอง', 'narrator_v'],
      ['หนูมาแล้วหรือลูก', 'thai_old_lady'],
      ['มะลิรู้แล้วว่ายายรอเธอมาตลอด', 'narrator_v'],
      ['ยายคะ', 'thai_female_1'],
    ]);
    // the failed shot has no picture, so the render uses the other two
    const edit = calls.find((c) => c.path === 'shotstack.render').body;
    const visuals = edit.timeline.tracks.at(-1).clips;
    assert.ok(visuals.some((v) => v.asset.type === 'video'));
  });

  test('resume: finished work is not redone; redo one shot regenerates only that shot', async () => {
    calls = [];
    imageNo = 0;
    failImageNo = null;
    await manager.post(`/api/drama/${projectId}/run`, { target: 'all' });
    await drain();
    assert.equal(calls.filter((c) => c.path === '/v1/image_generation').length, 0, 'nothing left to draw');
    const d0 = (await manager.get(`/api/drama/${projectId}`)).body.data;
    calls = [];
    await manager.post(`/api/drama/${projectId}/redo`, { what: 'shot', itemId: d0.shots[0].id });
    await drain();
    const d = (await manager.get(`/api/drama/${projectId}`)).body.data;
    assert.equal(d.shots[0].imageStatus, 'done');
    assert.equal(calls.filter((c) => c.path === '/v1/image_generation').length, 1);
    assert.equal(calls.filter((c) => c.path === '/v2/video_generation').length, 0);
    assert.equal(d.outputUrl, null, 'the finished video is outdated after a redo');
  });

  test('cancel stops a queued run; editing a line re-voices only that shot', async () => {
    await manager.post(`/api/drama/${projectId}/run`, { target: 'all' });
    await manager.post(`/api/drama/${projectId}/cancel`);
    calls = [];
    await drain();
    assert.equal(calls.length, 0, 'stale jobs do nothing');
    const d0 = (await manager.get(`/api/drama/${projectId}`)).body.data;
    const r = await manager.put(`/api/drama/${projectId}/shots/${d0.shots[2].id}`, { narration: 'คำบรรยายใหม่' });
    assert.equal(r.status, 200);
    assert.equal(r.body.data.shots[2].audioStatus, 'pending');
    assert.equal(r.body.data.shots[1].audioStatus, 'done');
  });

  test('style previews: one image per style for the genre, cached', async () => {
    calls = [];
    const r = await manager.post('/api/drama/catalog/previews', { genre: 'ghost' });
    assert.equal(r.status, 202);
    await drain(30);
    const c = (await manager.get('/api/drama/catalog')).body.data;
    assert.equal(Object.values(c.previews.ghost).filter((p) => p.status === 'done' && p.url).length, c.styles.length);
    calls = [];
    await manager.post('/api/drama/catalog/previews', { genre: 'ghost' });
    await drain(5);
    assert.equal(calls.filter((x) => x.path === '/v1/image_generation').length, 0);
  });
});

test('timeline: title card, voices in order, captions, clip then still', () => {
  const { edit, srt, durationSec } = buildDramaEdit({
    title: 'เรื่องทดสอบ',
    coverUrl: 'https://x/cover.jpg',
    shots: [
      { image: 'https://x/1.jpg', clip: null, clipSec: null, lines: [{ speaker: 'narrator', text: 'กาลครั้งหนึ่ง', url: 'https://x/a1.mp3', ms: 2000 }] },
      { image: 'https://x/2.jpg', clip: 'https://x/2.mp4', clipSec: 2, lines: [{ speaker: 'mali', name: 'มะลิ', text: 'ยายคะ', url: 'https://x/a2.mp3', ms: 3000 }] },
    ],
  });
  const tracks = edit.timeline.tracks;
  const voice = tracks.find((t) => t.clips[0]?.asset.type === 'audio').clips;
  assert.equal(voice[0].start, 2.65);
  assert.ok(voice[1].start > voice[0].start + 2);
  const visuals = tracks.at(-1).clips;
  assert.equal(visuals[0].asset.src, 'https://x/cover.jpg');
  assert.deepEqual(
    visuals.slice(1).map((v) => v.asset.type),
    ['image', 'video', 'image'],
  );
  assert.match(srt, /มะลิ: ยายคะ/);
  assert.ok(durationSec >= 9);
});

test('pickVoice: Thai voices by gender, prefers an unused one', () => {
  const voices = [
    { id: 'en_m', name: 'English male', description: 'man' },
    { id: 'th_f', name: 'Thai female', description: 'woman' },
    { id: 'th_m', name: 'Thai male', description: 'man' },
  ];
  assert.equal(pickVoice(voices, { gender: 'male' }, new Set()), 'th_m');
  assert.equal(pickVoice(voices, { gender: 'female' }, new Set()), 'th_f');
  assert.equal(pickVoice([], { gender: 'female' }, new Set()), null);
});
