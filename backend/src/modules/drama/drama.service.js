'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const db = require('../../db/pool');
const logger = require('../../core/logger');
const { badRequest } = require('../../core/errors');
const { enqueue } = require('../../jobs/queue');
const ai = require('../../integrations/ai');
const minimaxMedia = require('../../integrations/minimax-media');
const shotstack = require('../../integrations/shotstack');
const env = require('../../config/env');
const media = require('../video/media');
const catalog = require('./catalog');
const { buildDramaEdit } = require('./timeline');

/**
 * ละคร AI engine. A project is a series of N episodes (1 = a single short film). It moves through six steps:
 *   setup → script → characters → cover → storyboard (images, then H3 clips) → export (voices, render)
 * The series outline (characters + one summary per episode), the characters and the cover are made
 * once; script, storyboard and export are per episode, each episode its own 9:16 video.
 * Every shot is a moving MiniMax H3 clip: a shot without a clip is retried, and if it still fails the
 * run stops and says which shot — a still picture never stands in for a clip.
 * Work runs as `drama.run` jobs that each do one small unit (one image, one voice shot, one poll…)
 * and queue the next, so every job fits the cron tick. `run_target` is the step to finish
 * ('all' = everything for `run_episode`, 'series' = every episode in order); finished work is never
 * redone, so a run resumes where it stopped. `run_token` ties jobs to the run that queued them.
 * Files live in the video media folder and are served through signed URLs (kind 'd').
 */

const STEPS = ['setup', 'script', 'characters', 'cover', 'storyboard', 'export'];
const CLIP_POLL_MS = 30_000;
const RENDER_POLL_MS = 20_000;
const MAX_CLIP_POLLS = 40;
const MAX_RENDER_POLLS = 45;
/** H3 attempts per shot (image + clip) before the run stops and asks the user. */
const MAX_ATTEMPTS = 3;
/** A shot speaks at most this long, so it fits one AI clip (Hailuo makes 6 or 10 s, H3 up to 15 s). */
const MAX_SHOT_SEC = 9;

const parse = (v, fallback = null) => {
  if (v == null) return fallback;
  if (typeof v !== 'string') return v;
  try {
    return JSON.parse(v);
  } catch {
    return fallback;
  }
};

/* ------------------------------------------------------------------ files */

const EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'video/mp4': 'mp4', 'audio/mpeg': 'mp3' };

function saveFile(buffer, mime) {
  fs.mkdirSync(media.MEDIA_DIR, { recursive: true });
  const key = `${Date.now().toString(36)}-${crypto.randomBytes(9).toString('hex')}.${EXT[mime] ?? 'jpg'}`;
  fs.writeFileSync(path.join(media.MEDIA_DIR, key), buffer);
  return key;
}

/** Signed public URL (renderer, browser) for a stored key; null without PUBLIC_API_URL. */
const fileUrl = (key) => (key ? media.publicUrl('d', key, media.extOf(key)) : null);

/** Data URL of a stored image, for MiniMax inputs (no need for our server to be reachable). */
function dataUrl(key) {
  const p = key && media.filePath(key);
  if (!p || !fs.existsSync(p)) return null;
  const ext = media.extOf(key);
  return `data:${ext === 'png' ? 'image/png' : 'image/jpeg'};base64,${fs.readFileSync(p).toString('base64')}`;
}

async function download(url, mime, maxBytes = 200 * 1024 * 1024) {
  const res = await fetch(url, { signal: AbortSignal.timeout(120_000) });
  if (!res.ok) throw new Error(`ดาวน์โหลดไฟล์ไม่สำเร็จ (HTTP ${res.status})`);
  const buffer = Buffer.from(await res.arrayBuffer());
  if (!buffer.length || buffer.length > maxBytes) throw new Error('ไฟล์ที่ได้ว่างหรือใหญ่เกินไป');
  return saveFile(buffer, mime);
}

/* --------------------------------------------------------------- loading */

async function load(id, orgId = null) {
  const p = await db.one(`SELECT * FROM drama_projects WHERE id = :id ${orgId ? 'AND org_id = :orgId' : ''}`, { id, orgId });
  if (!p) return null;
  const characters = await db.query('SELECT * FROM drama_characters WHERE drama_project_id = :id ORDER BY sort_order, id', { id });
  const shots = await db.query('SELECT * FROM drama_shots WHERE drama_project_id = :id ORDER BY episode_no, seq', { id });
  const episodes = await db.query('SELECT * FROM drama_episodes WHERE drama_project_id = :id ORDER BY episode_no', { id });
  return {
    ...p,
    episodes_total: Number(p.episodes_total ?? 1),
    characters: characters.map((c) => ({ ...c })),
    episodes: episodes.map((e) => ({ ...e })),
    shots: shots.map((s) => ({ ...s, dialogue: parse(s.dialogue, []), characters: parse(s.characters, []), audio: parse(s.audio, []) })),
  };
}

const finished = (s) => s === 'done' || s === 'failed';
const shotsOf = (p, ep) => p.shots.filter((s) => s.episode_no === ep);
const episodeOf = (p, ep) => p.episodes.find((e) => e.episode_no === ep) ?? null;
/** The outline exists: characters and a summary row for every episode. */
const hasOutline = (p) => p.characters.length > 0 && p.episodes.filter((e) => e.episode_no <= p.episodes_total).length >= p.episodes_total;
const shotFailed = (s) => s.image_status === 'failed' || s.clip_status === 'failed';
const shotReady = (s) => s.image_status === 'done' && s.clip_status === 'done' && Boolean(s.clip_key);

/** Status of each of the six steps for one episode, computed from the data (nothing to keep in sync). */
function stepStates(p, ep = 1) {
  const shots = shotsOf(p, ep);
  const outline = hasOutline(p);
  const storyboard = shots.length > 0 && shots.every(shotReady);
  return {
    setup: 'done',
    script: outline && shots.length > 0 ? 'done' : 'todo',
    characters: outline && p.characters.every((c) => finished(c.status)) ? 'done' : 'todo',
    cover: p.cover_key ? 'done' : 'todo',
    storyboard: storyboard ? 'done' : 'todo',
    export: storyboard && episodeOf(p, ep)?.output_key ? 'done' : 'todo',
  };
}

/** One episode at a glance (the episode list / picker). */
function episodeStatus(p, ep) {
  const shots = shotsOf(p, ep);
  const states = stepStates(p, ep);
  if (states.export === 'done') return 'done';
  if (shots.some(shotFailed)) return 'failed';
  if (shots.length) return 'progress';
  return 'todo';
}

/** First episode whose video is not finished (null when the whole series is done). */
function nextEpisode(p) {
  for (let ep = 1; ep <= p.episodes_total; ep += 1) if (stepStates(p, ep).export !== 'done') return ep;
  return null;
}

/** Run target that remakes one shot only ("สร้างช็อตนี้ใหม่" / "สร้างคลิปใหม่"): 'shot:<id>'. */
const shotTarget = (id) => `shot:${id}`;
const targetShotId = (target) => (/^shot:\d+$/.test(String(target ?? '')) ? Number(String(target).slice(5)) : null);

/** The next unit for a one-shot run: its picture, its voice, its clip — nothing of the other shots. */
function shotUnit(p, id) {
  const s = p.shots.find((x) => x.id === id);
  if (!s) return null;
  const step = 'storyboard';
  if (s.image_status === 'pending') return { step, kind: 'image', id: s.id };
  if (s.clip_status === 'pending' && s.image_status === 'done' && !finished(s.audio_status)) return { step, kind: 'voice', id: s.id };
  if (s.clip_status === 'pending' && s.image_status === 'done') return { step, kind: 'clip_start', id: s.id };
  if (s.clip_status === 'processing') return { step, kind: 'clip_poll', ep: s.episode_no };
  if (shotFailed(s)) return { step, kind: 'blocked', ep: s.episode_no, ids: [s.id] };
  return null;
}

/** The next unit of work in step order for episode `ep`, or null when everything up to `target` is done. */
function nextUnit(p, target, ep = 1) {
  const only = targetShotId(target);
  if (only) return shotUnit(p, only);
  const last = target === 'all' || target === 'series' ? STEPS.length - 1 : STEPS.indexOf(target);
  const states = stepStates(p, ep);
  const shots = shotsOf(p, ep);
  for (const step of STEPS.slice(1, last + 1)) {
    if (states[step] === 'done') continue;
    if (step === 'script') return hasOutline(p) ? { step, kind: 'episode_script', ep } : { step, kind: 'outline' };
    if (step === 'characters') {
      const c = p.characters.find((x) => !finished(x.status));
      return { step, kind: 'portrait', id: c.id };
    }
    if (step === 'cover') return { step, kind: 'cover' };
    if (step === 'storyboard') {
      const img = shots.find((s) => s.image_status === 'pending');
      if (img) return { step, kind: 'image', id: img.id };
      // a clip is made as long as its shot's voice lines, so those are voiced first
      const unvoiced = shots.find((s) => s.clip_status === 'pending' && s.image_status === 'done' && !finished(s.audio_status));
      if (unvoiced) return { step, kind: 'voice', id: unvoiced.id };
      const start = shots.find((s) => s.clip_status === 'pending' && s.image_status === 'done');
      if (start) return { step, kind: 'clip_start', id: start.id };
      if (shots.some((s) => s.clip_status === 'processing')) return { step, kind: 'clip_poll', ep };
      // what is left failed every attempt: stop and say which shots (never fall back to a still)
      return { step, kind: 'blocked', ep, ids: shots.filter((s) => !shotReady(s)).map((s) => s.id) };
    }
    if (step === 'export') {
      const voice = shots.find((s) => !finished(s.audio_status));
      if (voice) return { step, kind: 'voice', id: voice.id };
      return { step, kind: episodeOf(p, ep)?.render_id ? 'render_poll' : 'render', ep };
    }
  }
  return null;
}

/* --------------------------------------------------------------- running */

/** Start (or resume) work up to `target` ('script' … 'export', 'all', or 'series') for an episode. */
async function start(projectId, target, episode = 1) {
  const token = crypto.randomBytes(12).toString('hex');
  await db.query('UPDATE drama_projects SET run_target = :target, run_token = :token, run_episode = :episode, error = NULL, stage_detail = :d WHERE id = :id', {
    id: projectId,
    target,
    token,
    episode,
    d: 'เข้าคิวแล้ว',
  });
  const p = await db.one('SELECT org_id FROM drama_projects WHERE id = :id', { id: projectId });
  await enqueue('drama.run', { projectId, token }, { orgId: p.org_id, maxAttempts: 1 });
  return { target };
}

async function cancel(projectId) {
  await db.query("UPDATE drama_projects SET run_target = NULL, run_token = NULL, stage_detail = 'หยุดงานแล้ว' WHERE id = :id", { id: projectId });
}

const detail = (id, text) => db.query('UPDATE drama_projects SET stage_detail = :d WHERE id = :id', { id, d: String(text).slice(0, 250) });

/** Which episode the run works on now ('series' moves on to the next unfinished episode by itself). */
function runEpisode(p) {
  if (p.run_target !== 'series') return p.run_episode || 1;
  if (!hasOutline(p)) return 1;
  return nextEpisode(p);
}

/** Job handler: one unit, then queue the next (immediately, or later while waiting on a provider). */
async function run({ projectId, token }) {
  const p = await load(projectId);
  if (!p || !p.run_target || p.run_token !== token) return { status: 'stale' };
  const ep = runEpisode(p);
  const unit = ep ? nextUnit(p, p.run_target, ep) : null;
  if (!unit) {
    await db.query("UPDATE drama_projects SET run_target = NULL, run_token = NULL, stage_detail = 'เสร็จแล้ว' WHERE id = :id", { id: p.id });
    return { status: 'done' };
  }
  if (ep !== p.run_episode) await db.query('UPDATE drama_projects SET run_episode = :ep WHERE id = :id', { id: p.id, ep });
  let delayMs;
  try {
    delayMs = (await UNITS[unit.kind](p, unit)) || 0;
  } catch (err) {
    // Whole-project steps stop the run with the reason; per-item failures are recorded on the item
    const message = String(err?.message ?? err).slice(0, 1000);
    logger.warn({ projectId: p.id, unit: unit.kind, err: message }, 'drama step failed');
    await db.query('UPDATE drama_projects SET run_target = NULL, run_token = NULL, error = :message, stage_detail = NULL WHERE id = :id', { id: p.id, message });
    return { status: 'failed', error: message };
  }
  await enqueue('drama.run', { projectId: p.id, token }, { orgId: p.org_id, maxAttempts: 1, ...(delayMs ? { runAt: new Date(Date.now() + delayMs) } : {}) });
  return { status: 'ok', unit: unit.kind };
}

/**
 * Run an item's work; a failure marks only that item (the run continues with the next one).
 * An empty MiniMax balance (402) fails every item the same way: stop the whole run with that message
 * instead (the item stays pending and no attempt is used up), so topping up and pressing auto resumes.
 */
async function itemTry(fn, onFail) {
  try {
    await fn();
  } catch (err) {
    if (err?.code === 'MINIMAX_PAYMENT_REQUIRED') throw err;
    await onFail(String(err?.message ?? err).slice(0, 480));
  }
}

/* ------------------------------------------------------------------ script */

const CHARACTER_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['key', 'name', 'role', 'gender', 'age', 'description', 'look'],
  properties: {
    key: { type: 'string', description: 'รหัสภาษาอังกฤษสั้น เช่น mali, somchai' },
    name: { type: 'string', description: 'ชื่อตัวละครภาษาไทย' },
    role: { type: 'string', description: 'บทบาทในเรื่อง เช่น นางเอก ผีแม่นาค' },
    gender: { type: 'string', enum: ['male', 'female', 'other'] },
    age: { type: 'string', enum: ['child', 'young', 'adult', 'elder'] },
    description: { type: 'string', description: 'นิสัยและเบื้องหลังภาษาไทย 1 ประโยค' },
    look: { type: 'string', description: 'English: face, hair, age, clothing, distinctive features — consistent across shots' },
  },
};

const OUTLINE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['title', 'logline', 'characters', 'episodes'],
  properties: {
    title: { type: 'string', description: 'ชื่อเรื่องภาษาไทย สั้น ดึงดูด' },
    logline: { type: 'string', description: 'เรื่องย่อทั้งเรื่อง 1-2 ประโยค' },
    characters: { type: 'array', description: 'ตัวละครหลักและตัวละครที่กลับมาหลายตอน 2-8 ตัว', items: CHARACTER_SCHEMA },
    episodes: {
      type: 'array',
      description: 'โครงเรื่องทีละตอน ครบทุกตอนตามลำดับ',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['title', 'summary', 'cliffhanger'],
        properties: {
          title: { type: 'string', description: 'ชื่อตอนภาษาไทยสั้น ๆ' },
          summary: { type: 'string', description: 'เหตุการณ์ในตอนนี้ 2-4 ประโยค' },
          cliffhanger: { type: 'string', description: 'ฉากจบตอนที่ทำให้อยากดูตอนต่อไป (ตอนสุดท้าย: บทสรุปของเรื่อง)' },
        },
      },
    },
  },
};

const SHOT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['scene', 'narration', 'dialogue', 'visual', 'camera', 'characters', 'product'],
  properties: {
    scene: { type: 'string', description: 'ชื่อฉากสั้น ๆ ภาษาไทย' },
    narration: { type: 'string', description: 'คำบรรยายของผู้เล่าเรื่อง ภาษาไทยแบบพูด 1-2 ประโยคสั้น (เว้นว่างได้ถ้ามีบทพูด)' },
    dialogue: {
      type: 'array',
      description: 'บทพูดของตัวละครในช็อตนี้ 0-2 ประโยค',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['character', 'line'],
        properties: { character: { type: 'string', description: 'key ของตัวละคร' }, line: { type: 'string', description: 'บทพูดภาษาไทยสั้น ๆ' } },
      },
    },
    visual: { type: 'string', description: 'English video prompt: who (by look), action and movement, setting, time, mood. No text in image.' },
    camera: { type: 'string', description: 'English camera/motion for video: e.g. slow push in, handheld, pan left' },
    characters: { type: 'array', items: { type: 'string' }, description: 'key ของตัวละครที่อยู่ในภาพ (ตัวหลักก่อน)' },
    product: { type: 'boolean', description: 'true เฉพาะช็อตที่ตัวละครหยิบ/ใช้/พูดถึงสินค้าที่ไทอิน (false ถ้าไม่มีไทอิน)' },
  },
};

const EPISODE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['shots'],
  properties: { shots: { type: 'array', items: SHOT_SCHEMA } },
};

const WRITER_SYSTEM = `คุณเป็นนักเขียนบทละครสั้นแนวตั้ง (ซีรีส์ TikTok / Reels / ReelShort) ภาษาไทย มือหนึ่ง เขียนให้คนดูหยุดนิ้วตั้งแต่ 3 วินาทีแรกและดูจนจบ
จังหวะเรื่อง (สำคัญที่สุด):
- ช็อตแรกคือ hook: เปิดกลางเหตุการณ์ที่ตึงที่สุด (ความลับ การหักหลัง การเผชิญหน้า ภาพที่ชวนสงสัย) ห้ามเปิดด้วยการแนะนำตัวละครหรือบรรยายฉากเฉย ๆ
- ทุก 2-3 ช็อตต้องมีอะไรเปลี่ยน: ข้อมูลใหม่ อารมณ์พลิก หรือการตัดสินใจ — ไม่มีช็อตเติมเวลา
- ให้ตัวละครพูดและแสดงมากกว่าผู้บรรยายเล่า (show, don't tell) ผู้บรรยายใช้เฉพาะเชื่อมเรื่องหรือเปิดปม
- บทพูดสั้น คม มีอารมณ์ชัด เป็นภาษาพูดไทยจริง มีประโยคเด็ดที่คนอยากคอมเมนต์หรือแชร์
- ช็อตท้ายจบด้วยหักมุมหรือจุดค้างที่ทำให้อยากดูต่อ
ภาพ (visual) ต้องตรงกับเนื้อเรื่องของช็อตนั้นเสมอ:
- ทุกช็อตเป็นวิดีโอเคลื่อนไหว: บรรยายการกระทำ ท่าทาง และสีหน้าที่ตรงกับคำบรรยาย/บทพูดของช็อตนั้น ไม่ใช่ภาพนิ่ง
- visual ของแต่ละช็อตต้องอ่านเข้าใจได้เอง (โมเดลภาพไม่เห็นช็อตอื่น): ระบุสถานที่ เวลา (กลางวัน/กลางคืน) ใครอยู่ในภาพ ทำอะไร อารมณ์อะไร ทุกครั้ง
- ช็อตในฉากเดียวกันใช้สถานที่ แสง และเสื้อผ้าเดิม เปลี่ยนแค่มุมกล้องและการกระทำ
- ใช้มุมกล้องหลากหลายแบบภาพยนตร์ (close-up สีหน้าตอนพูดประโยคสำคัญ, wide shot เปิดฉาก, over-the-shoulder ตอนคุยกัน)
รูปแบบ:
- แต่ละช็อตพูดจบใน 4-10 วินาที (คำบรรยาย + บทพูดรวมกันไม่เกินประมาณ 100 ตัวอักษร)
- visual / look / camera เป็นภาษาอังกฤษ บรรยายหน้าตาตัวละครให้เหมือนกันทุกช็อตทุกตอน
- ห้ามเนื้อหาลามก ความรุนแรงเกินเหตุ หรือหมิ่นสถาบัน`;

/** Pick a MiniMax voice for a character from the account's voices (Thai first, by gender / age words). */
function pickVoice(voices, c, used) {
  if (!voices.length) return null;
  const text = (v) => `${v.id} ${v.name} ${v.description}`.toLowerCase();
  const thai = voices.filter((v) => /thai|ไทย/.test(text(v)));
  const pool = thai.length ? thai : voices;
  const want = c.gender === 'female' ? /female|woman|girl|lady|หญิง/ : c.gender === 'male' ? /\bmale\b|\bman\b|boy|gentleman|ชาย/ : /./;
  const elder = c.age === 'elder' ? /old|elder|grand|senior|แก่|ชรา/ : null;
  const ranked = pool
    .filter((v) => want.test(text(v)) && !(c.gender === 'male' && /female|woman/.test(text(v))))
    .sort((a, b) => (elder ? Number(elder.test(text(b))) - Number(elder.test(text(a))) : 0));
  return (ranked.find((v) => !used.has(v.id)) ?? ranked[0] ?? pool.find((v) => !used.has(v.id)) ?? pool[0]).id;
}

const storyBrief = (p) => {
  const genre = catalog.genreOf(p.genre);
  return [
    `แนวเรื่อง: ${genre.label}${p.substyle ? ` (${p.substyle})` : ''} — ${genre.tone}`,
    `สไตล์ภาพ: ${catalog.styleOf(p.style).label}`,
    p.premise ? `ไอเดียเรื่องจากผู้ใช้: ${p.premise}` : 'ให้คิดเรื่องใหม่ที่น่าติดตามเอง',
  ];
};

/** Series outline: title, characters (with voices) and one summary per episode. */
async function writeOutline(p) {
  const total = p.episodes_total;
  await detail(p.id, total > 1 ? `AI กำลังวางโครงเรื่อง ${total} ตอน` : 'AI กำลังวางโครงเรื่อง');
  const { data } = await ai.extractStructured({
    system: WRITER_SYSTEM,
    schema: OUTLINE_SCHEMA,
    toolName: 'submit_outline',
    toolDescription: 'ส่งโครงเรื่องละคร',
    maxTokens: Math.min(16000, 3000 + total * 400),
    content: [
      {
        type: 'text',
        text: [
          total > 1
            ? `วางโครงละครซีรีส์ ${total} ตอนจบ ความยาวตอนละ ${catalog.lengthOf(p.length_sec).label} — episodes ต้องมี ${total} รายการพอดี`
            : `วางโครงละครสั้นจบในตอนเดียว ความยาว ${catalog.lengthOf(p.length_sec).label} — episodes มี 1 รายการ`,
          ...storyBrief(p),
          total > 1
            ? '- ทุกตอนเปิดด้วย hook และจบด้วยจุดค้างให้อยากดูตอนต่อไป เรื่องเดินหน้าทุกตอน ไม่ซ้ำเดิม ตอนสุดท้ายคลี่คลายและปิดเรื่องให้ครบ'
            : '- เปิดด้วย hook ที่ชวนสงสัยหรือสะเทือนใจ ปิดด้วยหักมุมหรือข้อคิด',
          p.tie_in ? `- มีไทอินสินค้า "${p.product_name || 'สินค้าของร้าน'}" ทุกตอน ให้มีตัวละครที่เกี่ยวข้องกับสินค้าได้อย่างเป็นธรรมชาติ` : '',
        ]
          .filter(Boolean)
          .join('\n'),
      },
    ],
  });
  const chars = (data.characters ?? []).slice(0, 8);
  if (!chars.length) throw new Error('AI ไม่ได้ส่งตัวละครกลับมา ลองใหม่อีกครั้ง');
  const episodes = (data.episodes ?? []).slice(0, total);
  let voices = [];
  try {
    voices = await minimaxMedia.listVoices();
  } catch {
    /* voices are picked later (or the default voice is used) */
  }
  const used = new Set([p.narrator_voice_id].filter(Boolean));
  await db.tx(async (conn) => {
    await conn.query('DELETE FROM drama_characters WHERE drama_project_id = :id', { id: p.id });
    await conn.query('DELETE FROM drama_shots WHERE drama_project_id = :id', { id: p.id });
    await conn.query('DELETE FROM drama_episodes WHERE drama_project_id = :id', { id: p.id });
    for (const [i, c] of chars.entries()) {
      const voice = pickVoice(voices, c, used);
      if (voice) used.add(voice);
      await conn.query(
        `INSERT INTO drama_characters (drama_project_id, char_key, name, role, gender, age, description, look_prompt, voice_id, sort_order)
         VALUES (:id, :key, :name, :role, :gender, :age, :description, :look, :voice, :i)
         ON DUPLICATE KEY UPDATE name = VALUES(name)`,
        { id: p.id, key: String(c.key).slice(0, 40), name: c.name, role: c.role, gender: c.gender, age: c.age, description: c.description, look: c.look, voice, i },
      );
    }
    for (let n = 1; n <= total; n += 1) {
      const e = episodes[n - 1] ?? {};
      await conn.query('INSERT INTO drama_episodes (drama_project_id, episode_no, title, summary, cliffhanger) VALUES (:id, :n, :title, :summary, :cliff)', {
        id: p.id,
        n,
        title: String(e.title || `ตอนที่ ${n}`).slice(0, 255),
        summary: e.summary || null,
        cliff: e.cliffhanger || null,
      });
    }
    await conn.query('UPDATE drama_projects SET title = :title, logline = :logline, cover_key = NULL WHERE id = :id', {
      id: p.id,
      title: String(data.title || p.title).slice(0, 255),
      logline: data.logline ?? null,
    });
  });
}

/** Estimated seconds a shot's lines take (before the voices exist): ~12 Thai characters per second. */
const speechSeconds = (narration, dialogue) => [narration, ...dialogue.map((d) => d.line)].join('').replace(/\s/g, '').length / 12 + 1;
const shotSeconds = (s) => Math.max(4, Math.min(10, Math.ceil(speechSeconds(s.narration, s.dialogue))));

/**
 * A shot that speaks longer than MAX_SHOT_SEC becomes several shots of the same moment (narration
 * split at spaces, dialogue lines kept whole), so each clip fits H3's 15 seconds and nothing freezes.
 */
function splitLongShot(s) {
  const dialogue = s.dialogue ?? [];
  if (speechSeconds(s.narration, dialogue) <= MAX_SHOT_SEC) return [s];
  const pieces = [];
  const words = String(s.narration || '').split(/\s+/).filter(Boolean);
  let cur = '';
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (cur && speechSeconds(next, []) > MAX_SHOT_SEC - 1) {
      pieces.push({ narration: cur, dialogue: [] });
      cur = w;
    } else cur = next;
  }
  if (cur) pieces.push({ narration: cur, dialogue: [] });
  for (const d of dialogue) {
    const last = pieces.at(-1);
    if (last && speechSeconds(last.narration, [...last.dialogue, d]) <= MAX_SHOT_SEC) last.dialogue.push(d);
    else pieces.push({ narration: '', dialogue: [d] });
  }
  return pieces.map((x, i) => ({
    ...s,
    narration: x.narration,
    dialogue: x.dialogue,
    visual: i ? `${s.visual}. The scene continues from a different camera angle` : s.visual,
    product: Boolean(s.product) && i === pieces.length - 1,
  }));
}

/** Script of one episode: its shots, written from the series outline and what came before. */
async function writeEpisode(p, unit) {
  const ep = unit.ep;
  const total = p.episodes_total;
  const len = catalog.lengthOf(p.length_sec);
  const e = episodeOf(p, ep);
  await detail(p.id, total > 1 ? `AI กำลังเขียนบทตอนที่ ${ep}/${total}` : 'AI กำลังเขียนบทละคร');
  const prevShots = shotsOf(p, ep - 1).slice(-3);
  const brief = [
    ...storyBrief(p),
    `เรื่อง: ${p.title}${p.logline ? ` — ${p.logline}` : ''}`,
    `ตัวละคร (ใช้ key เหล่านี้เท่านั้น): ${p.characters.map((c) => `${c.char_key} = ${c.name} (${c.role ?? ''}) ${c.description ?? ''}`).join('; ')}`,
    total > 1 ? `โครงเรื่องทั้ง ${total} ตอน:\n${p.episodes.map((x) => `ตอนที่ ${x.episode_no}: ${x.title ?? ''} — ${x.summary ?? ''}`).join('\n')}` : '',
    total > 1 ? `\nเขียนบท "ตอนที่ ${ep}: ${e?.title ?? ''}" เท่านั้น: ${e?.summary ?? ''}` : `เขียนบทเรื่องนี้: ${e?.summary ?? p.logline ?? ''}`,
    e?.cliffhanger ? (ep < total ? `จบตอนด้วย: ${e.cliffhanger}` : `ตอนจบของเรื่อง: ${e.cliffhanger}`) : '',
    ep > 1 ? `ตอนที่แล้วจบที่: ${episodeOf(p, ep - 1)?.cliffhanger ?? ''}${prevShots.length ? ` (ช็อตท้าย: ${prevShots.map((s) => s.narration || s.dialogue.map((d) => d.line).join(' ')).join(' / ')})` : ''} — เปิดตอนนี้ต่อจากตรงนั้น` : '',
    ep < total ? `ตอนถัดไปจะเป็นเรื่อง: ${episodeOf(p, ep + 1)?.summary ?? ''} (อย่าเล่าล่วงหน้า)` : '',
    `ความยาว ${len.label}: ต้องมี ${len.shots} ช็อตพอดี`,
    p.tie_in
      ? [
          `ไทอินสินค้า (product placement): "${p.product_name || 'สินค้าของร้าน'}" — สิ่งที่ต้องพูดถึง: ${p.product_pitch}`,
          '- สอดสินค้าเข้าไปในเรื่องอย่างเป็นธรรมชาติ 1 ช็อตในตอนนี้ ตัวละครหยิบ ใช้ หรือแนะนำสินค้าเหมือนเป็นส่วนหนึ่งของเหตุการณ์ ไม่ขายของโต้ง ๆ',
          '- บทพูดในช็อตนั้นต้องสื่อจุดเด่นตามที่ร้านบอก กระชับ เป็นภาษาพูด ห้ามอ้างสรรพคุณเกินจริงหรือรักษาโรค',
          '- ทำเครื่องหมาย product=true ให้ช็อตไทอิน และให้ visual บรรยายตัวละครถือ/ใช้สินค้าให้เห็นชัด',
        ].join('\n')
      : 'ไม่มีไทอินสินค้า: ทุกช็อต product=false',
  ]
    .filter(Boolean)
    .join('\n');
  const ask = async (extra = '') =>
    (
      await ai.extractStructured({
        system: WRITER_SYSTEM,
        schema: EPISODE_SCHEMA,
        toolName: 'submit_episode',
        toolDescription: 'ส่งบทของตอนนี้',
        maxTokens: 10000,
        content: [{ type: 'text', text: `${brief}${extra}` }],
      })
    ).data.shots ?? [];
  let shots = await ask();
  // a short script makes long shots that clips cannot cover: ask once more for the full count
  if (shots.length < Math.ceil(len.shots * 0.8)) {
    const again = await ask(`\n\nรอบที่แล้วได้แค่ ${shots.length} ช็อต ไม่พอ — ต้องมี ${len.shots} ช็อต แต่ละช็อตสั้น`);
    if (again.length > shots.length) shots = again;
  }
  if (!shots.length) throw new Error('AI ไม่ได้ส่งช็อตกลับมา ลองเขียนบทใหม่');
  const keys = new Set(p.characters.map((c) => c.char_key));
  const clean = shots.slice(0, len.shots + 8).map((s) => ({
    ...s,
    dialogue: (s.dialogue ?? []).filter((d) => keys.has(d.character) && d.line),
    characters: (s.characters ?? []).filter((k) => keys.has(k)),
  }));
  const planned = clean.flatMap(splitLongShot);
  await db.tx(async (conn) => {
    await conn.query('DELETE FROM drama_shots WHERE drama_project_id = :id AND episode_no = :ep', { id: p.id, ep });
    for (const [i, s] of planned.entries()) {
      await conn.query(
        `INSERT INTO drama_shots (drama_project_id, episode_no, seq, scene_title, narration, dialogue, visual_prompt, camera, characters, kind, clip_status, is_product)
         VALUES (:id, :ep, :seq, :scene, :narration, :dialogue, :visual, :camera, :chars, 'clip', 'pending', :isProduct)`,
        {
          id: p.id,
          ep,
          seq: i + 1,
          scene: s.scene,
          narration: s.narration || null,
          dialogue: JSON.stringify(s.dialogue),
          visual: s.visual,
          camera: s.camera,
          chars: JSON.stringify(s.characters),
          isProduct: p.tie_in && s.product ? 1 : 0,
        },
      );
    }
    await conn.query('UPDATE drama_episodes SET output_key = NULL, render_id = NULL WHERE drama_project_id = :id AND episode_no = :ep', { id: p.id, ep });
  });
}

const SHOT_REWRITE_SCHEMA = { type: 'object', additionalProperties: false, required: ['shot'], properties: { shot: SHOT_SCHEMA } };

/**
 * "ให้ AI แก้ช็อตนี้": rewrite one shot of the storyboard from the user's direction, in the context of
 * the story and the shots around it. With keepLines the user's narration and dialogue stay exactly
 * as they are (only the picture, camera and who is in it change). Returns the new fields; saving them
 * is up to the caller.
 */
async function rewriteShot(p, s, { instruction = '', keepLines = true } = {}) {
  const shots = shotsOf(p, s.episode_no);
  const i = shots.findIndex((x) => x.id === s.id);
  const line = (x) => `#${x.seq} [${x.scene_title ?? ''}] ${x.narration ?? ''} ${x.dialogue.map((d) => `${d.character}: ${d.line}`).join(' / ')} — visual: ${x.visual_prompt ?? ''}`;
  const e = episodeOf(p, s.episode_no);
  const brief = [
    ...storyBrief(p),
    `เรื่อง: ${p.title}${p.logline ? ` — ${p.logline}` : ''}`,
    e?.summary ? `ตอนนี้: ${e.summary}` : '',
    `ตัวละคร (ใช้ key เหล่านี้เท่านั้น): ${p.characters.map((c) => `${c.char_key} = ${c.name} (${c.role ?? ''}) look: ${c.look_prompt ?? ''}`).join('; ')}`,
    `ช็อตก่อนหน้า: ${shots.slice(Math.max(0, i - 2), i).map(line).join('\n') || '(ไม่มี — นี่คือช็อตแรก ต้องเป็น hook)'}`,
    `ช็อตที่ต้องแก้: ${line(s)}`,
    `ช็อตถัดไป: ${shots.slice(i + 1, i + 3).map(line).join('\n') || '(ไม่มี — นี่คือช็อตท้าย)'}`,
    instruction ? `ผู้ใช้ต้องการ: ${instruction}` : 'ผู้ใช้บอกว่าภาพช็อตนี้ไม่เข้ากับเนื้อเรื่อง — เขียน visual ใหม่ให้ตรงกับคำบรรยาย บทพูด และฉากรอบข้าง',
    keepLines
      ? `ห้ามเปลี่ยนคำบรรยายและบทพูด — ใช้ตามนี้ทุกตัวอักษร: narration="${s.narration ?? ''}" dialogue=${JSON.stringify(s.dialogue)}`
      : 'ปรับคำบรรยายและบทพูดได้ถ้าจำเป็น ให้สั้นและต่อเนื่องกับช็อตรอบข้าง',
    p.tie_in && s.is_product ? `ช็อตนี้เป็นช็อตไทอินสินค้า "${p.product_name || 'สินค้า'}" — product=true` : 'product=false',
  ]
    .filter(Boolean)
    .join('\n');
  const { data } = await ai.extractStructured({
    system: WRITER_SYSTEM,
    schema: SHOT_REWRITE_SCHEMA,
    toolName: 'submit_shot',
    toolDescription: 'ส่งช็อตที่แก้แล้ว',
    maxTokens: 2000,
    content: [{ type: 'text', text: brief }],
  });
  const out = data?.shot;
  if (!out?.visual) throw new Error('AI ไม่ได้ส่งช็อตกลับมา ลองใหม่อีกครั้ง');
  const keys = new Set(p.characters.map((c) => c.char_key));
  return {
    scene: String(out.scene || s.scene_title || '').slice(0, 255) || null,
    visual: String(out.visual).slice(0, 2000),
    camera: out.camera ? String(out.camera).slice(0, 255) : s.camera,
    characters: (out.characters ?? []).filter((k) => keys.has(k)),
    narration: keepLines ? s.narration : out.narration || null,
    dialogue: keepLines ? s.dialogue : (out.dialogue ?? []).filter((d) => keys.has(d.character) && d.line).slice(0, 4),
  };
}

/* --------------------------------------------------------- images & clips */

const styled = (p, text) => `${text}. ${catalog.styleOf(p.style).prompt}. ${catalog.genreOf(p.genre).tone}. No text, letters, captions or watermark.`;

async function portrait(p, unit) {
  const c = p.characters.find((x) => x.id === unit.id);
  await detail(p.id, `กำลังวาดตัวละคร ${c.name}`);
  await itemTry(
    async () => {
      const img = await minimaxMedia.generateImage({ prompt: styled(p, `Character portrait, upper body, facing camera: ${c.look_prompt || c.description}`), aspectRatio: '3:4' });
      const key = saveFile(img.buffer, img.mime);
      await db.query("UPDATE drama_characters SET portrait_key = :key, status = 'done', error = NULL WHERE id = :id", { id: c.id, key });
    },
    (e) => db.query("UPDATE drama_characters SET status = 'failed', error = :e WHERE id = :id", { id: c.id, e }),
  );
}

async function cover(p) {
  await detail(p.id, 'กำลังสร้างภาพปก');
  const lead = p.characters.find((c) => c.portrait_key);
  const img = await minimaxMedia.generateImage({
    prompt: styled(p, `Dramatic movie poster key art for "${p.logline || p.title}". ${lead ? `Main character: ${lead.look_prompt}` : ''} Leave empty space at the top for a title`),
    aspectRatio: '9:16',
    subjectImage: lead ? dataUrl(lead.portrait_key) : null,
  });
  await db.query('UPDATE drama_projects SET cover_key = :key WHERE id = :id', { id: p.id, key: saveFile(img.buffer, img.mime) });
}

/** MiniMax refused the content (its safety filter), as opposed to a passing error. */
const MODERATION = /moderat|sensitive|blocked|1026|safety|inappropriate/i;
/** The last attempt on this shot was refused by the content filter: try again more gently. */
const gentle = (s) => (s.clip_attempts ?? 0) > 0 && MODERATION.test(s.error ?? '');

/**
 * A failed image or clip is tried again (up to MAX_ATTEMPTS), then marked failed for the user.
 * A clip refused by the content filter is retried with a plain, neutral prompt; refused again, the
 * picture itself is drawn again (gently) before the last try, as the first frame may be what trips it.
 */
function shotFailure(s, what, e) {
  const attempts = (s.clip_attempts ?? 0) + 1;
  const giveUp = attempts >= MAX_ATTEMPTS;
  const status = giveUp ? 'failed' : 'pending';
  const moderation = MODERATION.test(e);
  const redraw = what === 'clip' && moderation && !giveUp && attempts >= 2;
  const sets = what === 'image' || redraw ? `image_status = '${status}', clip_status = '${status}'` : `clip_status = '${status}'`;
  const why = moderation ? `MiniMax ปฏิเสธเนื้อหา (moderation: ${e})${giveUp ? '' : ' — ลองใหม่ด้วยคำสั่งที่นุ่มลง'}${redraw ? ' และวาดภาพตั้งต้นใหม่' : ''}` : e;
  return db.query(`UPDATE drama_shots SET ${sets}, clip_attempts = :attempts, clip_task_id = NULL, error = :e WHERE id = :id`, {
    id: s.id,
    attempts,
    e: `${what === 'image' ? 'ภาพ' : 'คลิป'} (ครั้งที่ ${attempts}/${MAX_ATTEMPTS}): ${why}`.slice(0, 500),
  });
}

async function shotImage(p, unit) {
  const s = p.shots.find((x) => x.id === unit.id);
  const shots = shotsOf(p, s.episode_no);
  const done = shots.filter((x) => x.image_status === 'done').length;
  await detail(p.id, `${p.episodes_total > 1 ? `ตอนที่ ${s.episode_no}: ` : ''}กำลังสร้างภาพช็อต ${s.seq}/${shots.length} (เสร็จ ${done})`);
  const lead = s.characters.map((k) => p.characters.find((c) => c.char_key === k)).find((c) => c?.portrait_key);
  const looks = s.characters
    .map((k) => p.characters.find((c) => c.char_key === k))
    .filter(Boolean)
    .map((c) => `${c.name}: ${c.look_prompt}`)
    .join('; ');
  const soft = gentle(s);
  const product = s.is_product ? `. The character clearly holds and shows the product "${p.product_name || 'product'}" to the camera` : '';
  await itemTry(
    async () => {
      const img = await minimaxMedia.generateImage({
        prompt: soft
          ? // refused before: the same moment told plainly, without the genre's dark tone or the characters' long descriptions
            `${String(s.visual_prompt ?? '').slice(0, 300)}${product}. Calm, family-friendly everyday scene, adults fully clothed, soft natural light, ${catalog.styleOf(p.style).prompt}. Vertical 9:16 frame. No text`
          : styled(p, `${s.visual_prompt}${looks ? `. Characters — ${looks}` : ''}${product}. Vertical 9:16 frame`),
        aspectRatio: '9:16',
        subjectImage: lead ? dataUrl(lead.portrait_key) : null,
      });
      // a gentle redraw keeps the refusal note, so its clip is asked for gently too
      await db.query("UPDATE drama_shots SET image_key = :key, image_status = 'done', error = IF(:keep, error, NULL) WHERE id = :id", {
        id: s.id,
        key: saveFile(img.buffer, img.mime),
        keep: soft ? 1 : 0,
      });
    },
    (e) => shotFailure(s, 'image', e),
  );
}

/** Seconds the shot lasts in the final video: its voice lines plus the timeline's gaps (see timeline.js). */
function voicedSeconds(s) {
  if (s.audio_status !== 'done' || !s.audio.length) return shotSeconds(s);
  const ms = s.audio.reduce((sum, a) => sum + (a.ms ?? 0), 0);
  return Math.max(4, Math.min(15, Math.ceil(ms / 1000 + 0.25 * s.audio.length + 0.5)));
}

/** Motion prompt: the shot as live action — characters act, speak and move; the first frame fixes faces and costumes. */
function motionPrompt(p, s) {
  const names = s.characters.map((k) => p.characters.find((c) => c.char_key === k)?.name).filter(Boolean);
  const speaking = s.dialogue.length
    ? ` ${s.dialogue.map((d) => p.characters.find((c) => c.char_key === d.character)?.look_prompt?.split(',')[0] || 'the character').join(' and ')} speaks with natural lip movement and emotion.`
    : '';
  return styled(
    p,
    `Cinematic drama scene, continuous live action: ${s.visual_prompt}.${speaking} Characters${names.length ? '' : ' (if any)'} act with expressive faces, natural body language and believable movement; background life moves too. Camera: ${s.camera || 'slow cinematic push in'}. Keep the exact faces, costumes and setting of the first frame. Smooth motion the whole time, no freeze, no cuts, no subtitles`,
  );
}

/** Plain, neutral motion prompt for a shot the content filter refused: the first frame carries the scene. */
const safeMotionPrompt = (p, s) =>
  `Gentle cinematic live action of the scene in the first frame: the people move and talk naturally, calm everyday mood, ${s.camera || 'subtle camera push in'}. ${catalog.styleOf(p.style).prompt}. Family-friendly, fully clothed adults, no violence, no blood, no text`;

async function clipStart(p, unit) {
  const s = p.shots.find((x) => x.id === unit.id);
  await detail(p.id, `${p.episodes_total > 1 ? `ตอนที่ ${s.episode_no}: ` : ''}ส่งช็อต ${s.seq} ให้ MiniMax สร้างคลิปวิดีโอ`);
  await itemTry(
    async () => {
      // A tie-in shot is made from references (the shot + the real product photo) when the clip model takes them
      // (H3, which does not take a first frame and references together); otherwise from the shot, which shows the product
      const productRef = s.is_product && p.product_image_key && minimaxMedia.clipTakesReferences() ? dataUrl(p.product_image_key) : null;
      const motion = gentle(s) ? safeMotionPrompt(p, s) : motionPrompt(p, s);
      const { taskId, seconds } = await minimaxMedia.startClip({
        prompt: productRef
          ? `${motion}. The character from reference image 1 presents the exact product from reference image 2 (same shape, colors and label), holding it clearly toward the camera`
          : motion,
        ...(productRef ? { references: [dataUrl(s.image_key), productRef] } : { firstFrame: dataUrl(s.image_key) }),
        duration: voicedSeconds(s),
        ratio: '9:16',
      });
      await db.query("UPDATE drama_shots SET clip_task_id = :taskId, clip_status = 'processing', clip_polls = 0, clip_sec = :seconds WHERE id = :id", {
        id: s.id,
        taskId,
        seconds,
      });
    },
    (e) => shotFailure(s, 'clip', e),
  );
}

async function clipPoll(p, unit) {
  const pending = shotsOf(p, unit.ep).filter((s) => s.clip_status === 'processing');
  for (const s of pending) {
    await itemTry(
      async () => {
        const q = await minimaxMedia.pollClip(s.clip_task_id);
        if (q.status === 'ready') {
          const key = await download(q.url, 'video/mp4');
          await db.query("UPDATE drama_shots SET clip_key = :key, clip_status = 'done', error = NULL WHERE id = :id", { id: s.id, key });
        } else if (q.status === 'failed') throw new Error(q.error || 'MiniMax สร้างคลิปไม่สำเร็จ');
        else if (s.clip_polls + 1 >= MAX_CLIP_POLLS) throw new Error('รอคลิปนานเกินไป');
        else await db.query('UPDATE drama_shots SET clip_polls = clip_polls + 1 WHERE id = :id', { id: s.id });
      },
      (e) => shotFailure(s, 'clip', e),
    );
  }
  const left = (await db.query("SELECT COUNT(*) AS n FROM drama_shots WHERE drama_project_id = :id AND episode_no = :ep AND clip_status = 'processing'", { id: p.id, ep: unit.ep }))[0].n;
  if (Number(left)) {
    await detail(p.id, `MiniMax กำลังสร้างคลิป เหลือ ${left} ช็อต`);
    return CLIP_POLL_MS;
  }
  return 0;
}

/** Every attempt failed for some shots: stop and say which (the video is never made with a still instead). */
async function blocked(p, unit) {
  const bad = p.shots.filter((s) => unit.ids.includes(s.id));
  const reason = bad.find((s) => s.error)?.error ?? '';
  throw new Error(
    `${p.episodes_total > 1 ? `ตอนที่ ${unit.ep}: ` : ''}ช็อต ${bad.map((s) => s.seq).join(', ')} สร้างวิดีโอไม่สำเร็จหลังลอง ${MAX_ATTEMPTS} ครั้ง${reason ? ` (${reason})` : ''} — แก้คำบรรยายภาพของช็อตนั้นแล้วกด "สร้างใหม่"`,
  );
}

/* ----------------------------------------------------------------- export */

/** Whether a stored shot row still has the narration and dialogue that `s` was loaded with. */
const sameLines = (row, s) => (row.narration || null) === (s.narration || null) && JSON.stringify(parse(row.dialogue, [])) === JSON.stringify(s.dialogue ?? []);

async function voice(p, unit) {
  const s = p.shots.find((x) => x.id === unit.id);
  await detail(p.id, `${p.episodes_total > 1 ? `ตอนที่ ${s.episode_no}: ` : ''}กำลังพากย์เสียงช็อต ${s.seq}/${shotsOf(p, s.episode_no).length}`);
  const lines = [
    ...(s.narration ? [{ speaker: 'narrator', text: s.narration, voiceId: p.narrator_voice_id }] : []),
    ...s.dialogue.map((d) => {
      const c = p.characters.find((x) => x.char_key === d.character);
      return { speaker: d.character, name: c?.name ?? null, text: d.line, voiceId: c?.voice_id || p.narrator_voice_id };
    }),
  ];
  await itemTry(
    async () => {
      const audio = [];
      for (const l of lines) {
        const r = await minimaxMedia.synthesize(l.text, { voiceId: l.voiceId || undefined });
        audio.push({ speaker: l.speaker, name: l.name ?? null, text: l.text, key: await download(r.url, 'audio/mpeg', 20 * 1024 * 1024), ms: r.durationMs });
      }
      // the user may have edited the lines while they were being voiced: keep the voices only if the text is still the same
      // (otherwise the shot stays pending and is voiced again from the edited lines)
      const now = await db.one('SELECT narration, dialogue FROM drama_shots WHERE id = :id', { id: s.id });
      if (!now || !sameLines(now, s)) return;
      await db.query("UPDATE drama_shots SET audio = :audio, audio_status = 'done' WHERE id = :id", { id: s.id, audio: JSON.stringify(audio) });
    },
    (e) => db.query("UPDATE drama_shots SET audio_status = 'failed', error = :e WHERE id = :id", { id: s.id, e: `เสียง: ${e}` }),
  );
}

async function render(p, unit) {
  const ep = unit.ep;
  if (!shotstack.isConfigured()) throw new Error('ยังไม่ได้ตั้งค่า Shotstack (ใช้ตัวเดียวกับ AI Video) — ตั้งที่หน้าการเชื่อมต่อ API');
  if (!env.PUBLIC_API_URL) throw new Error('ยังไม่ได้ตั้ง PUBLIC_API_URL — ตัวเรนเดอร์ต้องโหลดคลิปและเสียงจาก backend');
  const shots = shotsOf(p, ep);
  const missing = shots.filter((s) => !s.clip_key);
  if (!shots.length || missing.length) throw new Error(`ช็อต ${missing.map((s) => s.seq).join(', ')} ยังไม่มีคลิปวิดีโอ — ทำขั้นสตอรีบอร์ดให้ครบก่อน`);
  const e = episodeOf(p, ep);
  await detail(p.id, `${p.episodes_total > 1 ? `ตอนที่ ${ep}: ` : ''}กำลังประกอบละครและส่งเรนเดอร์`);
  const series = p.episodes_total > 1;
  const { edit, srt, durationSec } = buildDramaEdit({
    title: p.title,
    subtitle: series ? `ตอนที่ ${ep}${e?.title ? ` ${e.title}` : ''}` : null,
    endText: series ? (ep < p.episodes_total ? `ติดตามตอนที่ ${ep + 1}` : 'จบบริบูรณ์') : null,
    shots: shots.map((s) => ({
      clip: fileUrl(s.clip_key),
      clipSec: s.clip_sec ?? shotSeconds(s),
      lines: (s.audio_status === 'done' ? s.audio : []).map((a) => ({ ...a, url: fileUrl(a.key) })),
      product: s.is_product && p.product_image_key ? { url: fileUrl(p.product_image_key), name: p.product_name } : null,
    })),
    musicUrl: p.music ? process.env.DRAMA_MUSIC_URL || process.env.VIDEO_MUSIC_URL || null : null,
  });
  const { renderId } = await shotstack.render(edit);
  await db.query(
    'UPDATE drama_episodes SET render_id = :renderId, subtitle_srt = :srt, duration_sec = :d WHERE drama_project_id = :id AND episode_no = :ep',
    { id: p.id, ep, renderId, srt, d: durationSec },
  );
  await detail(p.id, `${series ? `ตอนที่ ${ep}: ` : ''}Shotstack กำลังเรนเดอร์วิดีโอ 9:16`);
  return RENDER_POLL_MS;
}

async function renderPoll(p, unit) {
  const ep = unit.ep;
  const e = episodeOf(p, ep);
  const clear = () => db.query('UPDATE drama_episodes SET render_id = NULL WHERE id = :id', { id: e.id });
  const r = await shotstack.getRender(e.render_id);
  if (r.status === 'processing') {
    const polls = Number(p.stage_detail?.match(/\((\d+)\)$/)?.[1] ?? 0) + 1;
    if (polls >= MAX_RENDER_POLLS) {
      await clear();
      throw new Error('Shotstack เรนเดอร์นานเกินไป ลองใหม่อีกครั้ง');
    }
    await detail(p.id, `${p.episodes_total > 1 ? `ตอนที่ ${ep}: ` : ''}Shotstack กำลังเรนเดอร์วิดีโอ 9:16 (${polls})`);
    return RENDER_POLL_MS;
  }
  if (r.status === 'failed') {
    await clear();
    throw new Error(`Shotstack: ${r.error}`);
  }
  const key = await download(r.url, 'video/mp4', 500 * 1024 * 1024);
  if (e.output_key && e.output_key !== key) media.removeFile(e.output_key);
  await db.query('UPDATE drama_episodes SET output_key = :key, output_url = :url WHERE id = :id', { id: e.id, key, url: r.url });
  return 0;
}

const UNITS = {
  outline: writeOutline,
  episode_script: writeEpisode,
  portrait,
  cover,
  image: shotImage,
  clip_start: clipStart,
  clip_poll: clipPoll,
  blocked,
  voice,
  render,
  render_poll: renderPoll,
};

/* ------------------------------------------------------- redo & previews */

/** The episode's finished video no longer matches its shots: render again. */
const outdated = (projectId, ep) => db.query('UPDATE drama_episodes SET output_key = NULL, render_id = NULL WHERE drama_project_id = :id AND episode_no = :ep', { id: projectId, ep });

/** Redo one item: it goes back to pending and the next run makes it again. */
async function redo(p, what, id, ep = 1) {
  if (what === 'character') {
    await db.query("UPDATE drama_characters SET status = 'pending', error = NULL WHERE id = :id AND drama_project_id = :p", { id, p: p.id });
    // shots drawn from the old portrait stay as they are
    return;
  }
  if (what === 'cover') {
    await db.query('UPDATE drama_projects SET cover_key = NULL WHERE id = :id', { id: p.id });
    return;
  }
  if (what === 'outline') {
    // the whole story starts over
    await db.query('DELETE FROM drama_shots WHERE drama_project_id = :id', { id: p.id });
    await db.query('DELETE FROM drama_characters WHERE drama_project_id = :id', { id: p.id });
    await db.query('DELETE FROM drama_episodes WHERE drama_project_id = :id', { id: p.id });
    return;
  }
  if (what === 'shot') {
    const s = p.shots.find((x) => x.id === id);
    if (!s) throw badRequest('ไม่พบช็อต');
    await db.query(
      `UPDATE drama_shots SET image_status = 'pending', clip_status = 'pending', clip_key = NULL, clip_task_id = NULL, clip_attempts = 0, error = NULL
        WHERE id = :id AND drama_project_id = :p`,
      { id, p: p.id },
    );
    await outdated(p.id, s.episode_no);
  } else if (what === 'clip') {
    const s = p.shots.find((x) => x.id === id);
    if (!s) throw badRequest('ไม่พบช็อต');
    await db.query(
      `UPDATE drama_shots SET image_status = IF(image_key IS NULL, 'pending', 'done'), clip_status = 'pending', clip_key = NULL, clip_task_id = NULL, clip_attempts = 0, error = NULL
        WHERE id = :id AND drama_project_id = :p`,
      { id, p: p.id },
    );
    await outdated(p.id, s.episode_no);
  } else if (what === 'voices') {
    await db.query("UPDATE drama_shots SET audio_status = 'pending' WHERE drama_project_id = :id AND episode_no = :ep", { id: p.id, ep });
    await outdated(p.id, ep);
  } else if (what === 'episode') {
    await db.query('DELETE FROM drama_shots WHERE drama_project_id = :id AND episode_no = :ep', { id: p.id, ep });
    await outdated(p.id, ep);
  } else throw badRequest('ไม่รู้จักสิ่งที่จะสร้างใหม่');
}

/** Style gallery previews for one genre: one image per job until every style has one. */
async function previewStep({ orgId, genre }) {
  const row = await db.one("SELECT * FROM drama_style_previews WHERE org_id = :orgId AND genre = :genre AND status = 'pending' ORDER BY id LIMIT 1", { orgId, genre });
  if (!row) return { status: 'done' };
  try {
    const img = await minimaxMedia.generateImage({ prompt: catalog.previewPrompt(genre, row.style), aspectRatio: '3:4' });
    await db.query("UPDATE drama_style_previews SET image_key = :key, status = 'done', error = NULL WHERE id = :id", { id: row.id, key: saveFile(img.buffer, img.mime) });
  } catch (err) {
    await db.query("UPDATE drama_style_previews SET status = 'failed', error = :e WHERE id = :id", { id: row.id, e: String(err.message).slice(0, 480) });
  }
  await enqueue('drama.preview', { orgId, genre }, { orgId, maxAttempts: 1 });
  return { status: 'ok', style: row.style };
}

module.exports = {
  STEPS,
  shotTarget,
  targetShotId,
  MAX_ATTEMPTS,
  load,
  stepStates,
  episodeStatus,
  nextEpisode,
  nextUnit,
  hasOutline,
  shotsOf,
  episodeOf,
  start,
  cancel,
  run,
  redo,
  outdated,
  rewriteShot,
  sameLines,
  previewStep,
  fileUrl,
  saveFile,
  pickVoice,
  shotSeconds,
  splitLongShot,
  OUTLINE_SCHEMA,
  EPISODE_SCHEMA,
};
