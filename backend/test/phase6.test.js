'use strict';

// Phase 6 integration tests: AI video projects (script → voice → clips → composition).
// MiniMax (chat + media), Shotstack, ElevenLabs and R2 are mocked. Requires schema + seed + migrations.
process.env.NODE_ENV = 'test';

const crypto = require('node:crypto');
const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { createApp } = require('../src/app');
const db = require('../src/db/pool');
const { runDue } = require('../src/jobs/runner');
const minimax = require('../src/integrations/minimax');
const r2 = require('../src/integrations/r2');
const { sceneTimings, buildSrt, buildShotstackEdit, estimateMs } = require('../src/modules/video/timeline');

const app = createApp();
const originalFetch = global.fetch;
const originalCreate = minimax.createMessage;
const ENV_KEYS = ['MINIMAX_API_KEY', 'AI_PROVIDER', 'MINIMAX_VOICE_ID', 'MINIMAX_GROUP_ID', 'SHOTSTACK_API_KEY', 'SHOTSTACK_ENV',
  'R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET', 'R2_PUBLIC_BASE_URL', 'ELEVENLABS_API_KEY', 'ELEVENLABS_VOICE_ID', 'VIDEO_MUSIC_URL'];
const savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
const created = [];
let routes = {};
const calls = [];
let marketer;
let accountant;

async function cookie(email) {
  const res = await request(app).post('/api/auth/login').send({ email, password: 'Admin@1234' });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  return res.headers['set-cookie'].map((c) => c.split(';')[0]).join('; ');
}
const as = (c) => ({
  get: (url) => request(app).get(url).set('Cookie', c),
  post: (url, body) => request(app).post(url).set('Cookie', c).send(body),
  put: (url, body) => request(app).put(url).set('Cookie', c).send(body),
  delete: (url) => request(app).delete(url).set('Cookie', c),
});
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const VIDEO_JOBS = "('video.voice','video.clips_start','video.clips_poll','video.compose','video.compose_poll')";

async function drain() {
  await db.query(`UPDATE jobs SET run_at = UTC_TIMESTAMP() WHERE status = 'queued' AND type IN ${VIDEO_JOBS}`);
  await db.query(`UPDATE jobs SET run_at = UTC_TIMESTAMP() + INTERVAL 1 DAY WHERE status = 'queued' AND type NOT IN ${VIDEO_JOBS}`);
  return runDue({ maxJobs: 50 });
}
const project = (id) => db.one('SELECT * FROM video_projects WHERE id = :id', { id });

const SCRIPT = {
  title: 'เสื้อคอตตอนใส่สบาย',
  scenes: [
    { voiceover: 'ร้อนแบบนี้ ใส่เสื้ออะไรดี', caption: 'ร้อนจัด!', visual: 'person fanning themselves on a hot street', showProduct: false, durationSec: 3 },
    { voiceover: 'เสื้อโอเวอร์ไซซ์ผ้าคอตตอนตัวนี้ ระบายอากาศดีมาก ใส่แล้วไม่ย้วย', caption: 'คอตตอน 100%', visual: 'oversized cotton t-shirt on a hanger, soft light', showProduct: true, durationSec: 6 },
    { voiceover: 'กดตะกร้าได้เลย', caption: 'กดตะกร้าเลย', visual: 'hand tapping a phone screen', showProduct: false, durationSec: 3 },
  ],
  postCaption: 'เสื้อที่ใส่แล้วไม่อยากถอด',
  hashtags: ['เสื้อยืด', '#cotton'],
};
function mockScript(script = SCRIPT) {
  const seen = [];
  minimax.createMessage = async (params) => {
    seen.push(params);
    return { model: 'MiniMax-M3', stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 't1', name: 'submit_script', input: script }] };
  };
  return seen;
}

/** MiniMax media + Shotstack + R2 + downloads */
function mockProviders({ clipStatus = () => 'Success', renderStatus = () => 'done' } = {}) {
  let task = 0;
  routes = {
    '/v1/t2a_v2': (url, init) => {
      const body = JSON.parse(init.body);
      return json({ data: { audio: `https://cdn.minimax.test/voice-${body.text.length}.mp3` }, extra_info: { audio_length: 2000 + body.text.length * 10 }, base_resp: { status_code: 0 } });
    },
    '/v1/video_generation': () => json({ task_id: `task${(task += 1)}`, base_resp: { status_code: 0 } }),
    '/v1/query/video_generation': (url) => {
      const id = new URL(url).searchParams.get('task_id');
      const s = clipStatus(id);
      return json({ task_id: id, status: s, file_id: s === 'Success' ? `file-${id}` : undefined, base_resp: { status_code: 0 } });
    },
    '/v1/files/retrieve': (url) => json({ file: { download_url: `https://cdn.minimax.test/${new URL(url).searchParams.get('file_id')}.mp4` }, base_resp: { status_code: 0 } }),
    'api.shotstack.io/edit/stage/render/': () => {
      const s = renderStatus();
      return json({ success: true, response: { id: 'rnd1', status: s, url: s === 'done' ? 'https://shotstack.test/out.mp4' : undefined, error: s === 'failed' ? 'bad asset' : undefined } });
    },
    'api.shotstack.io/edit/stage/render': () => json({ success: true, response: { id: 'rnd1', message: 'Render Successfully Queued' } }),
    'cdn.minimax.test': () => new Response(Buffer.from('media'), { headers: { 'content-type': 'audio/mpeg' } }),
    'shotstack.test': () => new Response(Buffer.from('mp4'), { headers: { 'content-type': 'video/mp4' } }),
    'r2.cloudflarestorage.com': () => new Response('', { status: 200 }),
    'api.elevenlabs.io': () => json({ audio_base64: Buffer.from('eleven').toString('base64'), alignment: { character_end_times_seconds: [0.5, 1.75] } }),
  };
}

async function newProject(body = {}) {
  const res = await marketer.post('/api/videos', { productId: 16, tone: 'friendly', lengthSec: 15, ...body });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  created.push(res.body.data.id);
  return res.body.data;
}

before(async () => {
  global.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    // longest matching key wins (render/ vs render)
    const key = Object.keys(routes).filter((k) => String(url).includes(k)).sort((a, b) => b.length - a.length)[0];
    if (!key) return new Response('not found', { status: 404 });
    return routes[key](String(url), init);
  };
  for (const k of ENV_KEYS) delete process.env[k];
  process.env.MINIMAX_API_KEY = 'mm-key';
  process.env.MINIMAX_VOICE_ID = 'Thai_female_1';
  marketer = as(await cookie('marketer@example.com'));
  accountant = as(await cookie('accountant@example.com'));
});

after(async () => {
  global.fetch = originalFetch;
  minimax.createMessage = originalCreate;
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
  await db.query(`DELETE FROM jobs WHERE type IN ${VIDEO_JOBS}`);
  await db.query("UPDATE jobs SET run_at = UTC_TIMESTAMP() WHERE status = 'queued' AND run_at > UTC_TIMESTAMP() + INTERVAL 20 HOUR");
  if (created.length) await db.query('DELETE FROM video_projects WHERE id IN (:ids)', { ids: created });
  await db.pool.end();
});

describe('timeline builders (unit)', () => {
  test('scene timings follow the voice length, with an estimate fallback', () => {
    const t = sceneTimings([{ voiceover: 'a' }, { voiceover: 'สวัสดีครับทุกคน' }], [2000, null]);
    assert.deepEqual(t[0], { start: 0, length: 2.3 });
    assert.equal(t[1].start, 2.3);
    assert.equal(t[1].length, Math.round((estimateMs('สวัสดีครับทุกคน') / 1000 + 0.3) * 100) / 100);
  });

  test('SRT splits long voice-overs into timed lines', () => {
    const scenes = [{ voiceover: 'หนึ่ง สอง สาม สี่ ห้า หก เจ็ด แปด เก้า สิบ สิบเอ็ด สิบสอง' }];
    const srt = buildSrt(scenes, [{ start: 1, length: 4 }], 20);
    const blocks = srt.trim().split('\n\n');
    assert.ok(blocks.length >= 2);
    assert.match(blocks[0], /^1\n00:00:01,000 --> 00:00:0\d,\d{3}\n/);
    assert.match(blocks.at(-1), /--> 00:00:05,000\n/);
  });

  test('Shotstack edit: 9:16 output, AI label, captions escaped, image zoom and video clips muted', () => {
    const edit = buildShotstackEdit({
      scenes: [{ caption: 'ลด <50%>' }, { caption: '' }],
      timings: [{ start: 0, length: 2 }, { start: 2, length: 3 }],
      voiceUrls: ['https://a/1.mp3', 'https://a/2.mp3'],
      visuals: [{ type: 'image', url: 'https://img/p.jpg' }, { type: 'video', url: 'https://v/c.mp4' }],
    });
    assert.deepEqual(edit.output, { format: 'mp4', resolution: '1080', aspectRatio: '9:16', fps: 30 });
    const all = edit.timeline.tracks.flatMap((t) => t.clips);
    assert.ok(all.some((c) => c.asset.html?.includes('สร้างด้วย AI') && c.length === 5));
    assert.ok(all.some((c) => c.asset.html === '<p>ลด &lt;50%&gt;</p>'));
    assert.equal(all.filter((c) => c.asset.type === 'html' && c.asset.html !== '<p>สร้างด้วย AI</p>').length, 1); // empty caption skipped
    assert.equal(all.find((c) => c.asset.type === 'video').asset.volume, 0);
    assert.equal(all.find((c) => c.asset.type === 'image').effect, 'zoomInFast'); // hook opens with a quick zoom
    assert.equal(all.filter((c) => c.asset.type === 'audio').length, 2);
  });

  test('R2 SigV4 signature matches an independent computation', () => {
    Object.assign(process.env, { R2_ACCOUNT_ID: 'acc', R2_ACCESS_KEY_ID: 'AK', R2_SECRET_ACCESS_KEY: 'SK', R2_BUCKET: 'b', R2_PUBLIC_BASE_URL: 'https://cdn.example.com/' });
    try {
      const now = new Date('2026-10-10T12:00:00Z');
      const { url, headers } = r2.signPut({ key: 'videos/1/a b.mp4', body: Buffer.from('x'), contentType: 'video/mp4', now });
      assert.equal(url, 'https://acc.r2.cloudflarestorage.com/b/videos/1/a%20b.mp4');
      const h = (d) => crypto.createHash('sha256').update(d).digest('hex');
      const canonical = `PUT\n/b/videos/1/a%20b.mp4\n\ncontent-type:video/mp4\nhost:acc.r2.cloudflarestorage.com\nx-amz-content-sha256:${h('x')}\nx-amz-date:20261010T120000Z\n\ncontent-type;host;x-amz-content-sha256;x-amz-date\n${h('x')}`;
      const toSign = `AWS4-HMAC-SHA256\n20261010T120000Z\n20261010/auto/s3/aws4_request\n${h(canonical)}`;
      let k = crypto.createHmac('sha256', 'AWS4SK').update('20261010').digest();
      for (const p of ['auto', 's3', 'aws4_request']) k = crypto.createHmac('sha256', k).update(p).digest();
      const sig = crypto.createHmac('sha256', k).update(toSign).digest('hex');
      assert.equal(headers.Authorization, `AWS4-HMAC-SHA256 Credential=AK/20261010/auto/s3/aws4_request, SignedHeaders=content-type;host;x-amz-content-sha256;x-amz-date, Signature=${sig}`);
      assert.equal(r2.publicUrl('videos/1/a b.mp4'), 'https://cdn.example.com/videos/1/a%20b.mp4');
    } finally {
      for (const k of ['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET', 'R2_PUBLIC_BASE_URL']) delete process.env[k];
    }
  });
});

describe('projects and scripts', () => {
  test('permissions: accountant cannot use video', async () => {
    assert.equal((await accountant.get('/api/videos')).status, 403);
  });

  test('meta reports what is configured', async () => {
    const res = await marketer.get('/api/videos/meta');
    assert.equal(res.status, 200);
    const c = res.body.data.capabilities;
    assert.equal(c.script.provider, 'minimax');
    assert.equal(c.voice.minimax.configured, true);
    assert.equal(c.compose.configured, false);
    assert.deepEqual(c.compose.missing, ['SHOTSTACK_API_KEY']);
    assert.equal(c.voice.elevenlabs.configured, false);
  });

  test('create writes the script with MiniMax from the product facts', async () => {
    const seen = mockScript();
    const p = await newProject({ notes: 'เน้นหน้าร้อน' });
    assert.equal(p.status, 'script_ready');
    assert.equal(p.scenes.length, 3);
    assert.equal(p.title, 'เสื้อคอตตอนใส่สบาย');
    assert.equal(p.hashtags, '#เสื้อยืด #cotton');
    assert.deepEqual(seen[0].toolChoice, { type: 'tool', name: 'submit_script' });
    assert.match(seen[0].messages[0].content[0].text, /เสื้อโอเวอร์ไซซ์ผ้าคอตตอน/);
    assert.match(seen[0].messages[0].content[0].text, /เน้นหน้าร้อน/);
    assert.match(seen[0].messages[0].content[0].text, /15 วินาที/);
  });

  test('create from a trend item and validation of the source', async () => {
    mockScript();
    const p = await newProject({ productId: undefined, trendId: 2 });
    assert.equal(p.trendId, 2);
    assert.equal((await marketer.post('/api/videos', { productId: 16, trendId: 2 })).status, 400);
    assert.equal((await marketer.post('/api/videos', { productId: 999999 })).status, 404);
  });

  test('without an AI key no project is created', async () => {
    delete process.env.MINIMAX_API_KEY;
    try {
      const res = await marketer.post('/api/videos', { productId: 16 });
      assert.equal(res.status, 503);
      assert.match(JSON.stringify(res.body), /MINIMAX_API_KEY/);
    } finally {
      process.env.MINIMAX_API_KEY = 'mm-key';
    }
  });

  test('an AI failure keeps the project as a draft with the error', async () => {
    minimax.createMessage = async () => ({ model: 'MiniMax-M3', stop_reason: 'end_turn', content: [{ type: 'text', text: 'ขอโทษค่ะ' }] });
    const res = await marketer.post('/api/videos', { productId: 16 });
    assert.equal(res.status, 201);
    created.push(res.body.data.id);
    assert.equal(res.body.data.status, 'draft');
    assert.ok(res.body.warning);
    mockScript();
    const again = await marketer.post(`/api/videos/${res.body.data.id}/script`, { tone: 'funny' });
    assert.equal(again.status, 200, JSON.stringify(again.body));
    assert.equal(again.body.data.status, 'script_ready');
    assert.equal(again.body.data.brief.tone, 'funny');
  });

  test('editing scenes is validated and resets generated media', async () => {
    mockScript();
    const p = await newProject();
    await db.query("INSERT INTO video_assets (video_project_id, kind, scene_index, status, external_url) VALUES (:id, 'voice', 0, 'ready', 'x')", { id: p.id });
    const body = { title: 'แก้แล้ว', scenes: [{ voiceover: 'ใหม่', caption: 'ใหม่' }], postCaption: null, hashtags: null, visualMode: 'product_images', voiceProvider: 'minimax', voiceId: null };
    const res = await marketer.put(`/api/videos/${p.id}`, body);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.data.scenes[0].durationSec, 4);
    const n = await db.one('SELECT COUNT(*) AS n FROM video_assets WHERE video_project_id = :id', { id: p.id });
    assert.equal(Number(n.n), 0);
    assert.equal((await marketer.put(`/api/videos/${p.id}`, { ...body, scenes: [] })).status, 400);
  });
});

describe('generation pipeline', () => {
  test('product images: voice per scene → Shotstack render → R2 copy → ready, with SRT', async () => {
    mockScript();
    mockProviders();
    Object.assign(process.env, {
      SHOTSTACK_API_KEY: 'ss-key',
      R2_ACCOUNT_ID: 'acc',
      R2_ACCESS_KEY_ID: 'AK',
      R2_SECRET_ACCESS_KEY: 'SK',
      R2_BUCKET: 'media',
      R2_PUBLIC_BASE_URL: 'https://media.example.com',
    });
    await db.query("UPDATE products SET image_url = 'https://img.example.com/p16.jpg' WHERE id = 16");
    try {
      const p = await newProject();
      calls.length = 0;
      const gen = await marketer.post(`/api/videos/${p.id}/generate`);
      assert.equal(gen.status, 202, JSON.stringify(gen.body));
      assert.equal(gen.body.data.estimate.aiClips, 0);
      assert.equal((await marketer.post(`/api/videos/${p.id}/generate`)).status, 409);

      await drain(); // voice → compose (queued immediately)
      let v = await project(p.id);
      assert.equal(v.status, 'compositing');
      const tts = calls.filter((c) => c.url.includes('/v1/t2a_v2'));
      assert.equal(tts.length, 3);
      const ttsBody = JSON.parse(tts[0].init.body);
      assert.equal(ttsBody.voice_setting.voice_id, 'Thai_female_1');
      assert.equal(ttsBody.output_format, 'url');
      assert.equal(tts[0].init.headers.Authorization, 'Bearer mm-key');
      const render = calls.find((c) => c.url.endsWith('/edit/stage/render'));
      assert.equal(render.init.headers['x-api-key'], 'ss-key');
      const edit = JSON.parse(render.init.body);
      const clips = edit.timeline.tracks.flatMap((t) => t.clips);
      // Fast cuts: each scene is split into ≤1.8s shots of the product photo
      const images = clips.filter((c) => c.asset.type === 'image');
      assert.ok(images.length >= 3, String(images.length));
      assert.ok(images.every((c) => c.length <= 1.8));
      assert.ok(clips.filter((c) => c.asset.type === 'audio').every((c) => c.asset.src.startsWith('https://media.example.com/videos/')));
      assert.ok(v.subtitle_srt.includes('-->'));

      await drain(); // compose_poll → done
      v = await project(p.id);
      assert.equal(v.status, 'ready', v.error);
      assert.match(v.output_url, /^https:\/\/media\.example\.com\/videos\/\d+\/\d+\/[a-z0-9]+-final\.mp4$/);
      assert.ok(calls.some((c) => c.url.includes('r2.cloudflarestorage.com') && c.init.method === 'PUT'));

      const srt = await marketer.get(`/api/videos/${p.id}/subtitles.srt`);
      assert.equal(srt.status, 200);
      assert.match(srt.text, /^\uFEFF1\n00:00:00,000 --> /);
      const detail = await marketer.get(`/api/videos/${p.id}`);
      assert.equal(detail.body.data.assets.filter((a) => a.kind === 'voice').length, 3);
      assert.equal(detail.body.data.outputUrl, v.output_url);
    } finally {
      await db.query('UPDATE products SET image_url = NULL WHERE id = 16');
      for (const k of ['SHOTSTACK_API_KEY', 'R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET', 'R2_PUBLIC_BASE_URL']) delete process.env[k];
    }
  });

  test('AI clips: Hailuo tasks polled until done; a failed clip falls back; no Shotstack → parts ready', async () => {
    mockScript();
    let round = 0;
    mockProviders({ clipStatus: (id) => (round < 1 ? 'Processing' : id === 'task2' ? 'Fail' : 'Success') });
    const p = await newProject();
    const put = await marketer.put(`/api/videos/${p.id}`, {
      title: p.title, scenes: p.scenes, postCaption: p.postCaption, hashtags: p.hashtags, visualMode: 'ai_clips', voiceProvider: 'minimax', voiceId: 'Thai_male_2',
    });
    assert.equal(put.status, 200);
    calls.length = 0;
    assert.equal((await marketer.post(`/api/videos/${p.id}/generate`)).status, 202);
    await drain(); // voice → clips_start → (poll scheduled +1 min)
    assert.equal((await project(p.id)).status, 'generating_clips');
    const created = calls.filter((c) => c.url.includes('/v1/video_generation'));
    assert.equal(created.length, 3);
    assert.equal(JSON.parse(created[0].init.body).first_frame_image, undefined); // scene 1 has no product shot
    assert.equal(JSON.parse(calls.find((c) => c.url.includes('/v1/t2a_v2')).init.body).voice_setting.voice_id, 'Thai_male_2');
    await drain(); // poll #1: still processing
    assert.equal((await project(p.id)).status, 'generating_clips');
    round = 1;
    await drain(); // poll #2: two ready, one failed → compose → parts_ready
    const v = await project(p.id);
    assert.equal(v.status, 'parts_ready', v.error);
    assert.match(v.stage_detail, /Shotstack/);
    const assets = await db.query("SELECT scene_index, status, external_url FROM video_assets WHERE video_project_id = :id AND kind = 'broll' ORDER BY scene_index", { id: p.id });
    assert.deepEqual(assets.map((a) => a.status), ['ready', 'failed', 'ready']);
    assert.equal(assets[0].external_url, 'https://cdn.minimax.test/file-task1.mp4'); // no R2: provider URL kept

    // Regenerating reuses the finished clips and only re-creates the failed one
    calls.length = 0;
    await marketer.post(`/api/videos/${p.id}/generate`);
    await drain();
    assert.equal(calls.filter((c) => c.url.includes('/v1/video_generation')).length, 1);
  });

  test('parts ready → compose reuses the existing voice (no new speech), refused once provider links expire', async () => {
    mockScript();
    mockProviders();
    const p = await newProject();
    assert.equal((await marketer.post(`/api/videos/${p.id}/compose`)).status, 409); // nothing generated yet
    await marketer.post(`/api/videos/${p.id}/generate`);
    await drain();
    assert.equal((await project(p.id)).status, 'parts_ready');
    assert.equal((await marketer.post(`/api/videos/${p.id}/compose`)).status, 503); // no Shotstack yet

    process.env.SHOTSTACK_API_KEY = 'ss-key';
    try {
      assert.equal((await accountant.post(`/api/videos/${p.id}/compose`)).status, 403);
      calls.length = 0;
      const res = await marketer.post(`/api/videos/${p.id}/compose`);
      assert.equal(res.status, 202, JSON.stringify(res.body));
      for (let i = 0; i < 3 && (await project(p.id)).status !== 'ready'; i += 1) await drain();
      const v = await project(p.id);
      assert.equal(v.status, 'ready', v.error);
      assert.equal(calls.filter((c) => c.url.includes('/v1/t2a_v2')).length, 0);
      assert.ok(calls.some((c) => c.url.endsWith('/edit/stage/render')));

      // Without R2 the MiniMax audio links die after ~24h: ask for a full regenerate instead
      await db.query('UPDATE video_assets SET created_at = UTC_TIMESTAMP() - INTERVAL 21 HOUR WHERE video_project_id = :id', { id: p.id });
      const old = await marketer.post(`/api/videos/${p.id}/compose`);
      assert.equal(old.status, 409);
      assert.match(old.body.error.message, /หมดอายุ/);
    } finally {
      delete process.env.SHOTSTACK_API_KEY;
    }
  });

  test('provider errors mark the project failed with the message', async () => {
    mockScript();
    mockProviders();
    routes['/v1/t2a_v2'] = () => json({ base_resp: { status_code: 1004, status_msg: 'authentication failed' } });
    const p = await newProject();
    await marketer.post(`/api/videos/${p.id}/generate`);
    await drain();
    const v = await project(p.id);
    assert.equal(v.status, 'failed');
    assert.match(v.error, /authentication failed/);
  });

  test('ElevenLabs needs R2 and uploads the returned audio', async () => {
    mockScript();
    mockProviders();
    const p = await newProject();
    const body = { title: p.title, scenes: p.scenes, postCaption: null, hashtags: null, visualMode: 'product_images', voiceProvider: 'elevenlabs', voiceId: 'el-voice' };
    await marketer.put(`/api/videos/${p.id}`, body);
    process.env.ELEVENLABS_API_KEY = 'el-key';
    const blocked = await marketer.post(`/api/videos/${p.id}/generate`);
    assert.equal(blocked.status, 503);
    assert.match(JSON.stringify(blocked.body), /R2_/);
    Object.assign(process.env, { R2_ACCOUNT_ID: 'acc', R2_ACCESS_KEY_ID: 'AK', R2_SECRET_ACCESS_KEY: 'SK', R2_BUCKET: 'media', R2_PUBLIC_BASE_URL: 'https://media.example.com' });
    try {
      calls.length = 0;
      assert.equal((await marketer.post(`/api/videos/${p.id}/generate`)).status, 202);
      await drain();
      const v = await project(p.id);
      assert.equal(v.status, 'parts_ready', v.error);
      const el = calls.find((c) => c.url.includes('api.elevenlabs.io'));
      assert.match(el.url, /\/text-to-speech\/el-voice\/with-timestamps/);
      const voice = await db.one("SELECT duration_ms, external_url FROM video_assets WHERE video_project_id = :id AND kind = 'voice' AND scene_index = 0", { id: p.id });
      assert.equal(voice.duration_ms, 1750);
      assert.match(voice.external_url, /^https:\/\/media\.example\.com\//);
    } finally {
      for (const k of ['ELEVENLABS_API_KEY', 'R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET', 'R2_PUBLIC_BASE_URL']) delete process.env[k];
    }
  });

  test('delete is refused while processing or when posts are scheduled', async () => {
    mockScript();
    const p = await newProject();
    await db.query("UPDATE video_projects SET status = 'voicing' WHERE id = :id", { id: p.id });
    assert.equal((await marketer.delete(`/api/videos/${p.id}`)).status, 409);
    await db.query("UPDATE video_projects SET status = 'ready' WHERE id = :id", { id: p.id });
    assert.equal((await marketer.delete(`/api/videos/${p.id}`)).status, 200);
    assert.equal(await project(p.id), null);
  });
});
