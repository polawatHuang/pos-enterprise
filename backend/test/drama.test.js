'use strict';

// ละคร AI: a series (1–30 episodes) goes through outline → characters → cover → per episode: script →
// storyboard (a MiniMax H3 clip for every shot) → voices → render in queued units; finished work is not
// redone; cancel stops the run; failed images/clips are retried, then the run stops (never a still
// slide). MiniMax, the AI writer and Shotstack are mocked.
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
const { pickVoice, splitLongShot, cleanShot } = require('../src/modules/drama/drama.service');

const app = createApp();
const ENV = { MINIMAX_API_KEY: 'mm-key', AI_PROVIDER: 'minimax', MINIMAX_CLIP_MODEL: 'MiniMax-H3' }; // the default Hailuo Fast path has its own test
const saved = Object.fromEntries([...Object.keys(ENV), 'ANTHROPIC_API_KEY'].map((k) => [k, process.env[k]]));
const originals = { fetch: global.fetch, create: minimax.createMessage, render: shotstack.render, getRender: shotstack.getRender, isConfigured: shotstack.isConfigured };
let calls = [];
let failImageNo = null;
let imageNo = 0;
let projectId;
let manager;

const PNG = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000', 'hex');
const json = (b) => new Response(JSON.stringify(b), { status: 200, headers: { 'content-type': 'application/json' } });

const CHARACTERS = [
  { key: 'mali', name: 'มะลิ', role: 'นางเอก', gender: 'female', age: 'young', description: 'สาวกล้า', look: 'young Thai woman, long black hair, white blouse' },
  { key: 'yai', name: 'ยายเพียร', role: 'ผีบ้าน', gender: 'female', age: 'elder', description: 'ยายผู้เฝ้าบ้าน', look: 'elderly Thai woman, grey bun, faded sarong' },
];
const outlineOf = (n) => ({
  title: 'ผีบ้านริมคลอง',
  logline: 'มะลิย้ายเข้าบ้านเก่าแล้วพบความลับของยาย',
  characters: CHARACTERS,
  episodes: Array.from({ length: n }, (_, i) => ({ title: `คืนที่ ${i + 1}`, summary: `เหตุการณ์ตอน ${i + 1}`, cliffhanger: `จุดค้างตอน ${i + 1}` })),
});
const SHOTS = [
  { scene: 'ย้ายบ้าน', narration: 'คืนแรกในบ้านริมคลอง', dialogue: [], visual: 'old Thai house by a canal at night', camera: 'slow push in', characters: ['mali'], product: false },
  { scene: 'เสียงเรียก', narration: '', dialogue: [{ character: 'yai', line: 'หนูมาแล้วหรือลูก' }], visual: 'ghostly old woman in doorway', camera: 'handheld', characters: ['yai'], product: false },
  { scene: 'ความจริง', narration: 'มะลิรู้แล้วว่ายายรอเธอมาตลอด', dialogue: [{ character: 'mali', line: 'ยายคะ' }], visual: 'mali hugging the ghost', camera: 'pull out', characters: ['mali', 'yai'], product: true },
];
let episodesInOutline = 1;
let duringVoice = null; // runs once while a line is being voiced (the user edits meanwhile)
let failClipShot = null; // every H3 attempt whose prompt contains this text fails
let noBalance = false; // MiniMax answers 402 Payment Required
let moderate = null; // { text, times }: H3 tasks whose prompt contains text are refused by moderation, the first `times` times

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
  minimax.createMessage = async (params) => {
    const name = params.tools[0].name;
    calls.push({ path: 'ai', tool: name, body: params });
    const input =
      name === 'submit_outline'
        ? outlineOf(episodesInOutline)
        : name === 'submit_shot'
          ? { shot: { ...SHOTS[1], scene: 'ฉากที่ AI แก้', narration: 'AI อยากเปลี่ยนคำบรรยาย', dialogue: [{ character: 'yai', line: 'AI เปลี่ยนบท' }], visual: 'rewritten: mali opens the creaking door at night', characters: ['mali'] } }
          : { shots: SHOTS };
    return { model: 'MiniMax-M3', stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 't', name, input }] };
  };
  shotstack.isConfigured = () => true;
  shotstack.render = async (edit) => {
    calls.push({ path: 'shotstack.render', body: edit });
    return { renderId: 'r-1' };
  };
  shotstack.getRender = async () => ({ status: 'ready', url: 'https://cdn.test/final.mp4' });
  global.fetch = async (url, init = {}) => {
    const u = new URL(String(url));
    const body = init.body ? JSON.parse(init.body) : null;
    calls.push({ path: u.pathname, body, auth: init.headers?.Authorization });
    if (u.pathname === '/v1/image_generation') {
      imageNo += 1;
      if (failImageNo === imageNo) return json({ base_resp: { status_code: 1026, status_msg: 'content blocked' } });
      return json({ data: { image_base64: [PNG.toString('base64')] }, base_resp: { status_code: 0 } });
    }
    if (u.pathname === '/v1/get_voice')
      return json({ system_voice: [{ voice_id: 'thai_female_1', voice_name: 'Thai female', description: ['Thai woman'] }, { voice_id: 'thai_male_1', voice_name: 'Thai male', description: ['Thai man'] }, { voice_id: 'thai_old_lady', voice_name: 'Thai elder female', description: ['old woman Thai'] }], base_resp: { status_code: 0 } });
    if (u.pathname === '/v1/t2a_v2' && duringVoice) {
      const fn = duringVoice;
      duringVoice = null;
      await fn(body);
    }
    if (u.pathname === '/v1/t2a_v2') return json({ data: { audio: `https://cdn.test/a-${calls.length}.mp3` }, extra_info: { audio_length: 2000 }, base_resp: { status_code: 0 } });
    if (u.pathname === '/v2/video_generation') {
      if (noBalance) return new Response(JSON.stringify({ base_resp: { status_code: 1008, status_msg: 'insufficient balance' } }), { status: 402 });
      const refused = moderate && moderate.times > 0 && body.content[0].text.includes(moderate.text);
      if (refused) {
        moderate.times -= 1;
        return json({ task_id: `mod-${calls.length}`, base_resp: { status_code: 0 } });
      }
      const bad = failClipShot && body.content[0].text.includes(failClipShot);
      return json({ task_id: `${bad ? 'bad' : 'task'}-${calls.length}`, base_resp: { status_code: 0 } });
    }
    if (u.pathname.startsWith('/v2/query/video_generation/')) {
      if (u.pathname.includes('/mod-')) return json({ task: { status: 'Fail', message: 'content blocked by moderation' }, base_resp: { status_code: 0 } });
      if (u.pathname.includes('/bad-')) return json({ task: { status: 'Fail', message: 'internal error' }, base_resp: { status_code: 0 } });
      return json({ task: { status: 'Success', content: { url: 'https://cdn.test/clip.mp4' } }, base_resp: { status_code: 0 } });
    }
    // Hailuo (video generation v1)
    if (u.pathname === '/v1/video_generation') return json({ task_id: `h-${calls.length}`, base_resp: { status_code: 0 } });
    if (u.pathname === '/v1/query/video_generation') return json({ status: 'Success', file_id: `f-${u.searchParams.get('task_id')}`, base_resp: { status_code: 0 } });
    if (u.pathname === '/v1/files/retrieve') return json({ file: { download_url: 'https://cdn.test/hailuo.mp4' }, base_resp: { status_code: 0 } });
    if (u.host === 'cdn.test') return new Response(Buffer.from('media-bytes'), { status: 200 });
    return json({ base_resp: { status_code: 0 } });
  };
  const res = await request(app).post('/api/auth/login').send({ email: 'admin@example.com', password: 'Admin@1234' });
  const cookie = res.headers['set-cookie'].map((c) => c.split(';')[0]).join('; ');
  manager = {
    get: (url) => request(app).get(url).set('Cookie', cookie),
    post: (url, body) => request(app).post(url).set('Cookie', cookie).send(body ?? {}),
    put: (url, body) => request(app).put(url).set('Cookie', cookie).send(body),
    del: (url) => request(app).delete(url).set('Cookie', cookie),
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
  test('catalog lists genres, styles, lengths and series sizes; only moving clips are offered', async () => {
    const r = await manager.get('/api/drama/catalog');
    assert.equal(r.status, 200);
    assert.ok(r.body.data.genres.some((g) => g.id === 'ghost'));
    assert.ok(r.body.data.styles.length >= 10);
    assert.deepEqual(
      r.body.data.lengths.map((l) => l.sec),
      [60, 120, 180],
    );
    assert.ok(r.body.data.episodePresets.includes(16));
    assert.deepEqual(
      r.body.data.visualModes.map((m) => m.id),
      ['clips'],
    );
  });

  test('single film → outline then script: characters with voices, every shot is an H3 clip', async () => {
    calls = [];
    episodesInOutline = 1;
    const r = await manager.post('/api/drama', { genre: 'ghost', style: 'cinematic', lengthSec: 60, visualMode: 'stills', premise: 'ผีบ้านริมคลอง', narratorVoiceId: 'narrator_v', music: true });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    projectId = r.body.data.id;
    assert.equal(r.body.data.episodesTotal, 1);
    assert.equal(r.body.data.estimate.clips, 10, 'every planned shot is a clip');
    await manager.post(`/api/drama/${projectId}/run`, { target: 'script' });
    await drain();
    const d = (await manager.get(`/api/drama/${projectId}`)).body.data;
    assert.equal(d.title, 'ผีบ้านริมคลอง');
    assert.equal(d.steps.find((s) => s.key === 'script').status, 'done');
    assert.equal(d.characters.length, 2);
    assert.equal(d.characters[0].voiceId, 'thai_female_1');
    assert.equal(d.characters[1].voiceId, 'thai_old_lady');
    assert.equal(d.episodes.length, 1);
    assert.ok(d.shots.every((s) => s.kind === 'clip' && s.clipStatus === 'pending'));
    // 3 shots for a 1-minute film is too few: the writer was asked once more for the full count
    assert.deepEqual(
      calls.filter((c) => c.path === 'ai').map((c) => c.tool),
      ['submit_outline', 'submit_episode', 'submit_episode'],
    );
    assert.equal(d.runTarget, null);
  });

  test('auto: a failed image is retried; every shot becomes an H3 clip from its first frame; the video has no stills', async () => {
    calls = [];
    imageNo = 0;
    failImageNo = 4; // 2 portraits, cover, then shot 1's first attempt fails
    await manager.post(`/api/drama/${projectId}/run`, { target: 'all', episode: 1 });
    await drain();
    const d = (await manager.get(`/api/drama/${projectId}`)).body.data;
    assert.equal(d.error, null, d.error);
    assert.ok(d.outputUrl, JSON.stringify({ stage: d.stageDetail, run: d.runTarget, steps: d.steps }));
    assert.ok(d.characters.every((c) => c.portraitUrl));
    assert.ok(d.coverUrl);
    assert.ok(d.shots.every((s) => s.imageStatus === 'done' && s.clipStatus === 'done' && s.clipUrl));
    assert.equal(d.shots[0].clipAttempts, 1, 'the image was made on the second try');
    const shotImages = calls.filter((c) => c.path === '/v1/image_generation').slice(3);
    assert.ok(shotImages.every((c) => c.body.subject_reference?.[0]?.image_file?.startsWith('data:image/')));
    const h3 = calls.filter((c) => c.path === '/v2/video_generation');
    assert.equal(h3.length, 3);
    assert.equal(h3[0].body.model, 'MiniMax-H3');
    assert.equal(h3[0].body.ratio, '9:16');
    assert.equal(h3[0].body.content[1].role, 'first_frame');
    assert.match(h3[0].body.content[1].image_url.url, /^data:image\//);
    const tts = calls.filter((c) => c.path === '/v1/t2a_v2').map((c) => [c.body.text, c.body.voice_setting.voice_id]);
    assert.deepEqual(tts, [
      ['คืนแรกในบ้านริมคลอง', 'narrator_v'],
      ['หนูมาแล้วหรือลูก', 'thai_old_lady'],
      ['มะลิรู้แล้วว่ายายรอเธอมาตลอด', 'narrator_v'],
      ['ยายคะ', 'thai_female_1'],
    ]);
    assert.deepEqual(
      h3.map((c) => c.body.duration),
      [4, 4, 5],
    );
    assert.match(h3[1].body.content[0].text, /speaks with natural lip movement/);
    const edit = calls.find((c) => c.path === 'shotstack.render').body;
    const visuals = edit.timeline.tracks.at(-1).clips;
    assert.ok(visuals.length >= 3 && visuals.every((v) => v.asset.type === 'video'), 'only moving clips, no still slides');
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
    assert.equal(calls.filter((c) => c.path === '/v2/video_generation').length, 1, 'its clip is made again too');
    assert.equal(d.outputUrl, null, 'the finished video is outdated after a redo');
  });

  test('"สร้างช็อตนี้ใหม่" remakes only that shot, even while other shots are still unfinished', async () => {
    const d0 = (await manager.get(`/api/drama/${projectId}`)).body.data;
    // shot 3 waits for a new clip (unfinished), then the user redoes shot 1
    await manager.post(`/api/drama/${projectId}/redo`, { what: 'clip', itemId: d0.shots[2].id });
    await manager.post(`/api/drama/${projectId}/cancel`);
    calls = [];
    const r = await manager.post(`/api/drama/${projectId}/redo`, { what: 'shot', itemId: d0.shots[0].id });
    assert.equal(r.body.data.runShotId, d0.shots[0].id);
    await drain();
    const d = (await manager.get(`/api/drama/${projectId}`)).body.data;
    assert.equal(d.error, null, d.error);
    assert.equal(calls.filter((c) => c.path === '/v1/image_generation').length, 1);
    const h3 = calls.filter((c) => c.path === '/v2/video_generation');
    assert.equal(h3.length, 1, 'only shot 1 got a new clip');
    assert.match(h3[0].body.content[0].text, /old Thai house by a canal/);
    assert.ok(d.shots[0].clipUrl);
    assert.equal(d.shots[2].clipStatus, 'pending', 'shot 3 waits for auto');
    assert.equal(d.runTarget, null);
    // auto finishes the rest
    await manager.post(`/api/drama/${projectId}/run`, { target: 'all' });
    await drain();
    assert.ok((await manager.get(`/api/drama/${projectId}`)).body.data.shots.every((s) => s.clipUrl));
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

  test('edited lines are kept: an edit made while the shot is being voiced is voiced again, never reverted', async () => {
    const d0 = (await manager.get(`/api/drama/${projectId}`)).body.data;
    const shot = d0.shots[1];
    // clearing a line drops it (autosave mid-edit never fails); unknown speakers are dropped
    let r = await manager.put(`/api/drama/${projectId}/shots/${shot.id}`, {
      dialogue: [{ character: 'yai', line: 'ยายรอหนูมานานแล้ว' }, { character: 'mali', line: '' }, { character: 'nobody', line: 'x' }],
    });
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.data.shots[1].dialogue, [{ character: 'yai', line: 'ยายรอหนูมานานแล้ว' }]);
    // the user edits the same line again while its voice is being made
    duringVoice = async () => {
      await manager.put(`/api/drama/${projectId}/shots/${shot.id}`, { dialogue: [{ character: 'yai', line: 'บทที่ผู้ใช้แก้ล่าสุด' }] });
    };
    await manager.post(`/api/drama/${projectId}/run`, { target: 'export' });
    await drain();
    const d = (await manager.get(`/api/drama/${projectId}`)).body.data;
    assert.deepEqual(d.shots[1].dialogue, [{ character: 'yai', line: 'บทที่ผู้ใช้แก้ล่าสุด' }]);
    assert.equal(d.shots[1].audioStatus, 'done');
    assert.deepEqual(
      d.shots[1].audio.map((a) => a.text),
      ['บทที่ผู้ใช้แก้ล่าสุด'],
      'the voice is the latest edit, not the line from before',
    );
  });

  test('storyboard editing: edit the picture prompt, AI rewrites a shot keeping the user lines, add / move / delete shots', async () => {
    let d = (await manager.get(`/api/drama/${projectId}`)).body.data;
    const n = d.shots.length;
    const target = d.shots[1];
    // edit the storyboard directly; "regenerate" remakes only this shot's picture and clip
    calls = [];
    let r = await manager.put(`/api/drama/${projectId}/shots/${target.id}`, { scene: 'ประตูลั่น', visualPrompt: 'mali at the creaking door, candle light', camera: 'close-up', characters: ['mali'], regenerate: true });
    assert.equal(r.status, 200);
    assert.equal(r.body.data.shots[1].visualPrompt, 'mali at the creaking door, candle light');
    assert.equal(r.body.data.shots[1].scene, 'ประตูลั่น');
    assert.deepEqual(r.body.data.shots[1].characters, ['mali']);
    assert.equal(r.body.data.runShotId, target.id);
    await drain();
    assert.equal(calls.filter((c) => c.path === '/v1/image_generation').length, 1);
    assert.match(calls.find((c) => c.path === '/v1/image_generation').body.prompt, /creaking door, candle light/);

    // AI rewrites the shot from a Thai direction, the user's lines stay word for word
    const before = (await manager.get(`/api/drama/${projectId}`)).body.data.shots[1];
    r = await manager.post(`/api/drama/${projectId}/shots/${target.id}/rewrite`, { instruction: 'ให้มะลิเปิดประตูตอนกลางคืน' });
    assert.equal(r.status, 200);
    const s = r.body.data.shots[1];
    assert.equal(s.visualPrompt, 'rewritten: mali opens the creaking door at night');
    assert.deepEqual(s.dialogue, before.dialogue, 'keepLines: dialogue untouched');
    assert.equal(s.narration, before.narration);
    const ask = calls.findLast((c) => c.tool === 'submit_shot').body.messages[0].content[0].text;
    assert.match(ask, /ให้มะลิเปิดประตูตอนกลางคืน/);
    assert.match(ask, /ห้ามเปลี่ยนคำบรรยายและบทพูด/);

    // add a shot after shot 1 (AI writes it from the direction), move it, delete it
    r = await manager.post(`/api/drama/${projectId}/shots`, { episode: 1, after: d.shots[0].id, instruction: 'ภาพบ้านจากมุมสูง' });
    assert.equal(r.status, 201);
    d = r.body.data;
    assert.equal(d.shots.length, n + 1);
    assert.deepEqual(d.shots.map((x) => x.seq), Array.from({ length: n + 1 }, (_, i) => i + 1));
    const added = d.shots[1];
    assert.equal(added.imageStatus, 'pending');
    assert.equal(added.visualPrompt, 'rewritten: mali opens the creaking door at night');
    assert.equal(d.outputUrl, null, 'the finished video is outdated');
    r = await manager.post(`/api/drama/${projectId}/shots/${added.id}/move`, { by: 1 });
    assert.equal(r.body.data.shots[2].id, added.id);
    // structural edits wait for the run to stop
    await manager.post(`/api/drama/${projectId}/run`, { target: 'storyboard' });
    assert.equal((await manager.del(`/api/drama/${projectId}/shots/${added.id}`)).status, 409);
    await manager.post(`/api/drama/${projectId}/cancel`);
    r = await manager.del(`/api/drama/${projectId}/shots/${added.id}`);
    assert.equal(r.status, 200);
    assert.equal(r.body.data.shots.length, n);
    assert.deepEqual(r.body.data.shots.map((x) => x.seq), Array.from({ length: n }, (_, i) => i + 1));
    // put shot 2 back as it was written and finish the storyboard again for the tests below
    await manager.put(`/api/drama/${projectId}/shots/${target.id}`, {
      scene: SHOTS[1].scene,
      dialogue: SHOTS[1].dialogue,
      visualPrompt: SHOTS[1].visual,
      camera: SHOTS[1].camera,
      characters: SHOTS[1].characters,
      regenerate: true,
    });
    await drain();
    await manager.post(`/api/drama/${projectId}/run`, { target: 'all' });
    await drain();
  });

  test('a clip that keeps failing is retried 3 times, then the run stops and names the shot (no still instead)', async () => {
    const d0 = (await manager.get(`/api/drama/${projectId}`)).body.data;
    await manager.post(`/api/drama/${projectId}/redo`, { what: 'clip', itemId: d0.shots[1].id });
    await manager.post(`/api/drama/${projectId}/cancel`);
    calls = [];
    failClipShot = 'ghostly old woman';
    try {
      await manager.post(`/api/drama/${projectId}/run`, { target: 'all' });
      await drain();
    } finally {
      failClipShot = null;
    }
    const d = (await manager.get(`/api/drama/${projectId}`)).body.data;
    assert.equal(calls.filter((c) => c.path === '/v2/video_generation').length, 3);
    assert.equal(d.shots[1].clipStatus, 'failed');
    assert.match(d.error, /ช็อต 2 สร้างวิดีโอไม่สำเร็จ/);
    assert.equal(calls.filter((c) => c.path === 'shotstack.render').length, 0, 'not rendered without the clip');
    assert.equal(d.outputUrl, null);
    // "สร้างคลิปใหม่" after fixing it finishes the episode
    await manager.post(`/api/drama/${projectId}/redo`, { what: 'clip', itemId: d0.shots[1].id });
    await drain();
    await manager.post(`/api/drama/${projectId}/run`, { target: 'all' });
    await drain();
    const d2 = (await manager.get(`/api/drama/${projectId}`)).body.data;
    assert.equal(d2.error, null, d2.error);
    assert.ok(d2.outputUrl);
  });

  test('moderation: a refused clip is retried with a plain prompt; refused twice, the picture is redrawn gently first', async () => {
    const d0 = (await manager.get(`/api/drama/${projectId}`)).body.data;
    // refused once → the second, plain prompt (without the shot's own words) goes through
    await manager.post(`/api/drama/${projectId}/redo`, { what: 'clip', itemId: d0.shots[1].id });
    await manager.post(`/api/drama/${projectId}/cancel`);
    calls = [];
    moderate = { text: 'ghostly old woman', times: 1 };
    await manager.post(`/api/drama/${projectId}/run`, { target: 'all' });
    await drain();
    let d = (await manager.get(`/api/drama/${projectId}`)).body.data;
    assert.equal(d.error, null, d.error);
    let h3 = calls.filter((c) => c.path === '/v2/video_generation').map((c) => c.body.content[0].text);
    assert.equal(h3.length, 2);
    assert.match(h3[1], /Family-friendly/);
    assert.doesNotMatch(h3[1], /ghostly old woman/);
    assert.equal(calls.filter((c) => c.path === '/v1/image_generation').length, 0, 'the picture is kept');
    assert.ok(d.shots[1].clipUrl);

    // refused twice → the picture is drawn again gently, then the clip goes through on the third try
    await manager.post(`/api/drama/${projectId}/redo`, { what: 'clip', itemId: d0.shots[1].id });
    await manager.post(`/api/drama/${projectId}/cancel`);
    calls = [];
    // the style words are in both prompts: the first two tries are refused, the third (after a redraw) passes
    moderate = { text: 'cinematic film still', times: 2 };
    try {
      await manager.post(`/api/drama/${projectId}/run`, { target: 'all' });
      await drain();
    } finally {
      moderate = null;
    }
    d = (await manager.get(`/api/drama/${projectId}`)).body.data;
    assert.equal(d.error, null, d.error);
    h3 = calls.filter((c) => c.path === '/v2/video_generation');
    assert.equal(h3.length, 3, JSON.stringify(h3.map((c) => c.body.content[0].text.slice(0, 40))));
    const redraw = calls.filter((c) => c.path === '/v1/image_generation');
    assert.equal(redraw.length, 1, 'the shot picture was drawn again');
    assert.match(redraw[0].body.prompt, /family-friendly/);
    assert.ok(d.shots[1].clipUrl);
  });

  test('MiniMax 402 (no balance): the run stops at once with how to fix it; no attempt is used up', async () => {
    const d0 = (await manager.get(`/api/drama/${projectId}`)).body.data;
    await manager.post(`/api/drama/${projectId}/redo`, { what: 'clip', itemId: d0.shots[0].id });
    await manager.post(`/api/drama/${projectId}/cancel`);
    calls = [];
    noBalance = true;
    try {
      await manager.post(`/api/drama/${projectId}/run`, { target: 'all' });
      await drain();
    } finally {
      noBalance = false;
    }
    const d = (await manager.get(`/api/drama/${projectId}`)).body.data;
    assert.equal(calls.filter((c) => c.path === '/v2/video_generation').length, 1, 'not retried');
    assert.match(d.error, /HTTP 402: insufficient balance, code 1008/, 'shows MiniMax\'s own reason');
    assert.match(d.error, /Balance/);
    assert.equal(d.shots[0].clipStatus, 'pending');
    assert.equal(d.shots[0].clipAttempts, 0);
    assert.equal(d.runTarget, null);
    // after topping up, auto carries on
    await manager.post(`/api/drama/${projectId}/run`, { target: 'all' });
    await drain();
    const d2 = (await manager.get(`/api/drama/${projectId}`)).body.data;
    assert.equal(d2.error, null, d2.error);
    assert.ok(d2.outputUrl);
  });

  test('MINIMAX_MEDIA_API_KEY (pay-as-you-go) is used for images, speech and video; chat keeps the shared key', async () => {
    process.env.MINIMAX_MEDIA_API_KEY = 'payg-key';
    try {
      calls = [];
      await require('../src/integrations/minimax-media').synthesize('ทดสอบ', { voiceId: 'v1' });
      assert.equal(calls.find((c) => c.path === '/v1/t2a_v2').auth, 'Bearer payg-key');
    } finally {
      delete process.env.MINIMAX_MEDIA_API_KEY;
    }
    calls = [];
    await require('../src/integrations/minimax-media').synthesize('ทดสอบ', { voiceId: 'v1' });
    assert.equal(calls.find((c) => c.path === '/v1/t2a_v2').auth, 'Bearer mm-key');
  });

  test('default clip model: Hailuo 2.3 Fast 768P from the shot picture, 6 or 10 s clips (the cheapest)', async () => {
    delete process.env.MINIMAX_CLIP_MODEL;
    const created = await manager.post('/api/drama', { genre: 'ghost', style: 'cinematic', lengthSec: 60, narratorVoiceId: 'narrator_v' });
    const fid = created.body.data.id;
    try {
      calls = [];
      imageNo = 0;
      await manager.post(`/api/drama/${fid}/run`, { target: 'all' });
      await drain();
      const d = (await manager.get(`/api/drama/${fid}`)).body.data;
      assert.equal(d.error, null, d.error);
      assert.ok(d.outputUrl);
      assert.equal(calls.filter((c) => c.path === '/v2/video_generation').length, 0, 'no H3');
      const hailuo = calls.filter((c) => c.path === '/v1/video_generation').map((c) => c.body);
      assert.equal(hailuo.length, 3);
      assert.ok(hailuo.every((b) => b.model === 'MiniMax-Hailuo-2.3-Fast' && b.resolution === '768P' && [6, 10].includes(b.duration)));
      assert.ok(hailuo.every((b) => b.first_frame_image.startsWith('data:image/')));
      assert.ok(d.shots.every((s) => s.clipUrl));
    } finally {
      process.env.MINIMAX_CLIP_MODEL = 'MiniMax-H3';
      await db.query('DELETE FROM drama_projects WHERE id = :id', { id: fid });
    }
  });

  test('series: 3 episodes share characters and cover; each is written from the outline and gets its own video', async () => {
    episodesInOutline = 3;
    const created = await manager.post('/api/drama', { genre: 'ghost', style: 'cinematic', lengthSec: 60, episodesTotal: 3, narratorVoiceId: 'narrator_v' });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    const sid = created.body.data.id;
    try {
      assert.equal(created.body.data.episodesTotal, 3);
      assert.equal(created.body.data.estimate.clips, 30);
      calls = [];
      imageNo = 0;
      await manager.post(`/api/drama/${sid}/run`, { target: 'all', episode: 1 });
      await drain();
      let d = (await manager.get(`/api/drama/${sid}?episode=1`)).body.data;
      assert.equal(d.error, null, d.error);
      assert.deepEqual(
        d.episodes.map((e) => [e.no, e.title, e.status]),
        [
          [1, 'คืนที่ 1', 'done'],
          [2, 'คืนที่ 2', 'todo'],
          [3, 'คืนที่ 3', 'todo'],
        ],
      );
      assert.ok(d.episodes[0].outputUrl);
      const ep1Html = JSON.stringify(calls.find((c) => c.path === 'shotstack.render').body);
      assert.match(ep1Html, /ตอนที่ 1 คืนที่ 1/);
      assert.match(ep1Html, /ติดตามตอนที่ 2/);

      // the rest in one go: episode 2 then 3; characters and cover are not made again
      calls = [];
      imageNo = 0;
      await manager.post(`/api/drama/${sid}/run`, { target: 'series' });
      await drain(150);
      d = (await manager.get(`/api/drama/${sid}?episode=3`)).body.data;
      assert.equal(d.error, null, d.error);
      assert.ok(
        d.episodes.every((e) => e.status === 'done' && e.outputUrl),
        JSON.stringify(d.episodes),
      );
      assert.equal(d.episode, 3);
      assert.ok(d.shots.every((s) => s.episodeNo === 3));
      assert.equal(calls.filter((c) => c.path === '/v1/image_generation').length, 6, 'only the shots of episodes 2 and 3');
      const ep2Brief = JSON.stringify(calls.find((c) => c.tool === 'submit_episode').body.messages);
      assert.match(ep2Brief, /ตอนที่ 2: คืนที่ 2/);
      assert.match(ep2Brief, /ตอนที่แล้วจบที่: จุดค้างตอน 1/);
      assert.match(JSON.stringify(calls.filter((c) => c.path === 'shotstack.render').at(-1).body), /จบบริบูรณ์/);
      const srt = await manager.get(`/api/drama/${sid}/subtitles.srt?episode=2`);
      assert.equal(srt.status, 200);
      // the number of episodes is fixed once a script is written
      const locked = await manager.put(`/api/drama/${sid}/settings`, { genre: 'ghost', style: 'cinematic', lengthSec: 60, episodesTotal: 5 });
      assert.equal(locked.status, 400);
      const list = (await manager.get('/api/drama')).body.data.find((x) => x.id === sid);
      assert.equal(list.episodesDone, 3);
      assert.equal(list.done, true);
    } finally {
      await db.query('DELETE FROM drama_projects WHERE id = :id', { id: sid });
      episodesInOutline = 1;
    }
  });

  test('tie-in: needs the product first; the tie-in shot is made from the product photo and shows it in the video', async () => {
    const created = await manager.post('/api/drama', {
      genre: 'drama',
      style: 'cinematic',
      lengthSec: 60,
      tieIn: true,
      productName: 'เซรั่มหน้าใส',
      productPitch: 'ซึมไว ไม่เหนียว หน้าฉ่ำใน 7 วัน',
      narratorVoiceId: 'narrator_v',
    });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    const tid = created.body.data.id;
    try {
      const blocked = await manager.post(`/api/drama/${tid}/run`, { target: 'all' });
      assert.equal(blocked.status, 400);
      assert.match(blocked.body.error.message, /รูปสินค้า/);
      const up = await manager.post(`/api/drama/${tid}/product-image`, { image: `data:image/png;base64,${PNG.toString('base64')}` });
      assert.equal(up.status, 200, JSON.stringify(up.body));
      assert.ok(up.body.data.productImageUrl);
      calls = [];
      imageNo = 0;
      failImageNo = null;
      await manager.post(`/api/drama/${tid}/run`, { target: 'all' });
      await drain();
      const d = (await manager.get(`/api/drama/${tid}`)).body.data;
      assert.equal(d.error, null, d.error);
      // the writer was told about the product and what to say
      const brief = JSON.stringify(calls.find((c) => c.tool === 'submit_episode').body.messages);
      assert.match(brief, /เซรั่มหน้าใส/);
      assert.match(brief, /ซึมไว ไม่เหนียว/);
      const tie = d.shots.find((x) => x.isProduct);
      assert.ok(tie, 'the tie-in shot is marked');
      const h3 = calls.filter((c) => c.path === '/v2/video_generation');
      const productClip = h3.find((c) => c.body.content.filter((x) => x.role === 'reference_image').length === 2);
      assert.ok(productClip, 'made from the shot + the product photo');
      assert.ok(!productClip.body.content.some((x) => x.role === 'first_frame'));
      assert.match(productClip.body.content[0].text, /exact product from reference image 2/);
      const edit = calls.find((c) => c.path === 'shotstack.render').body;
      const cards = edit.timeline.tracks.flatMap((t) => t.clips).filter((c) => c.asset.type === 'image' && c.scale === 0.32);
      assert.equal(cards.length, 1, 'the product card shows during the tie-in shot');
    } finally {
      await db.query('DELETE FROM drama_projects WHERE id = :id', { id: tid });
    }
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

test('timeline: title on the first clip, voices in order, captions; a short clip keeps moving instead of freezing', () => {
  const { edit, srt, durationSec } = buildDramaEdit({
    title: 'เรื่องทดสอบ',
    subtitle: 'ตอนที่ 1 คืนแรก',
    endText: 'ติดตามตอนที่ 2',
    shots: [
      { clip: 'https://x/1.mp4', clipSec: 4, lines: [{ speaker: 'narrator', text: 'กาลครั้งหนึ่ง', url: 'https://x/a1.mp3', ms: 2000 }] },
      { clip: 'https://x/2.mp4', clipSec: 2, lines: [{ speaker: 'mali', name: 'มะลิ', text: 'ยายคะ', url: 'https://x/a2.mp3', ms: 3000 }] },
      { clip: 'https://x/3.mp4', clipSec: 6, lines: [{ speaker: 'narrator', text: 'จบแล้ว', url: 'https://x/a3.mp3', ms: 4000 }] },
    ],
  });
  const tracks = edit.timeline.tracks;
  const voice = tracks.find((t) => t.clips[0]?.asset.type === 'audio').clips;
  assert.equal(voice[0].start, 1.2, 'the first line waits for the title');
  assert.ok(voice[1].start > voice[0].start + 2);
  const visuals = tracks.at(-1).clips;
  assert.ok(visuals.every((v) => v.asset.type === 'video'));
  // shot 2 lasts ~3.6s but its clip is 2s: the clip's end plays again (trimmed), not a still
  const second = visuals.filter((v) => v.asset.src === 'https://x/2.mp4');
  assert.ok(second.length >= 2);
  assert.ok(second[1].asset.trim > 0);
  const html = JSON.stringify(tracks.flatMap((t) => t.clips).map((c) => c.asset.html ?? ''));
  assert.match(html, /เรื่องทดสอบ/);
  assert.match(html, /ตอนที่ 1 คืนแรก/);
  assert.match(html, /ติดตามตอนที่ 2/);
  assert.match(srt, /มะลิ: ยายคะ/);
  assert.ok(durationSec >= 10);
});

test('splitLongShot: a long narration becomes several shots that each fit one clip', () => {
  const long = 'กาลครั้งหนึ่งนานมาแล้ว '.repeat(12).trim();
  const parts = splitLongShot({ scene: 'x', narration: long, dialogue: [{ character: 'mali', line: 'ยายคะ' }], visual: 'v', camera: 'c', characters: [], product: true });
  assert.ok(parts.length >= 2);
  assert.equal(
    parts
      .map((p) => p.narration)
      .filter(Boolean)
      .join(' '),
    long,
  );
  assert.ok(parts.every((p) => [p.narration, ...p.dialogue.map((d) => d.line)].join('').replace(/\s/g, '').length / 12 + 1 <= 12));
  assert.deepEqual(parts.at(-1).dialogue, [{ character: 'mali', line: 'ยายคะ' }]);
  assert.equal(parts.filter((p) => p.product).length, 1);
  const short = { narration: 'สั้น', dialogue: [], visual: 'v' };
  assert.deepEqual(splitLongShot(short), [short]);
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

test('cleanShot: a camera direction in the narration is not voiced; "cut to" becomes one shot per picture', () => {
  const [a] = cleanShot({ scene: 'x', narration: 'เปิดด้วยมือที่กำลังเขียน…และมือที่กำลังสั่น', dialogue: [], visual: 'Close-up of hands', characters: [], product: false });
  assert.equal(a.narration, '');
  assert.match(a.visual, /Close-up of hands\. Scene: เปิดด้วยมือที่กำลังเขียน/);
  const parts = cleanShot({
    scene: 'x',
    narration: 'ข้อความสั้น ๆ ที่อาจเปลี่ยนทุกอย่าง',
    dialogue: [{ character: 'ton', line: 'ส่งแล้ว' }],
    visual: "Extreme close-up of a girl's hands typing on a pink phone. Cut to a window-side silhouette of a boy, phone trembling in his hand",
    characters: ['ton'],
    product: false,
  });
  assert.equal(parts.length, 2);
  assert.match(parts[0].visual, /^Extreme close-up of a girl's hands typing on a pink phone$/);
  assert.match(parts[1].visual, /^A window-side silhouette of a boy/);
  assert.equal(parts[0].narration, 'ข้อความสั้น ๆ ที่อาจเปลี่ยนทุกอย่าง');
  assert.deepEqual(parts[1].dialogue, []);
  const plain = { narration: 'เธอไม่เคยลืมวันนั้น', dialogue: [], visual: 'A girl by the window at dusk' };
  assert.deepEqual(cleanShot(plain), [plain]);
});
