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
 * ละคร AI engine. A project moves through six steps:
 *   setup → script → characters → cover → storyboard (images, then H3 clips) → export (voices, render)
 * Work runs as `drama.run` jobs that each do one small unit (one image, one voice shot, one poll…)
 * and queue the next, so every job fits the cron tick. `run_target` is the step to finish
 * (or 'all' for "ทำออโต้ที่ค้างต่อ"); finished work is never redone, so a run resumes where it stopped.
 * `run_token` ties jobs to the run that queued them: cancelling or starting again drops older jobs.
 * Files live in the video media folder and are served through signed URLs (kind 'd').
 */

const STEPS = ['setup', 'script', 'characters', 'cover', 'storyboard', 'export'];
const CLIP_POLL_MS = 30_000;
const RENDER_POLL_MS = 20_000;
const MAX_CLIP_POLLS = 40;
const MAX_RENDER_POLLS = 45;

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
  const shots = await db.query('SELECT * FROM drama_shots WHERE drama_project_id = :id ORDER BY seq', { id });
  return {
    ...p,
    characters: characters.map((c) => ({ ...c })),
    shots: shots.map((s) => ({ ...s, dialogue: parse(s.dialogue, []), characters: parse(s.characters, []), audio: parse(s.audio, []) })),
  };
}

const finished = (s) => s === 'done' || s === 'failed';

/** Status of each of the six steps, computed from the data (nothing to keep in sync). */
function stepStates(p) {
  const hasScript = p.shots.length > 0;
  const clipShots = p.shots.filter((s) => s.kind === 'clip');
  return {
    setup: 'done',
    script: hasScript ? 'done' : 'todo',
    characters: hasScript && p.characters.every((c) => finished(c.status)) ? 'done' : 'todo',
    cover: p.cover_key ? 'done' : 'todo',
    storyboard: hasScript && p.shots.every((s) => finished(s.image_status)) && clipShots.every((s) => finished(s.clip_status)) ? 'done' : 'todo',
    export: p.output_key ? 'done' : 'todo',
  };
}

/** The next unit of work in step order, or null when everything up to `target` is done. */
function nextUnit(p, target) {
  const last = target === 'all' ? STEPS.length - 1 : STEPS.indexOf(target);
  const states = stepStates(p);
  for (const step of STEPS.slice(1, last + 1)) {
    if (states[step] === 'done') continue;
    if (step === 'script') return { step, kind: 'script' };
    if (step === 'characters') {
      const c = p.characters.find((x) => !finished(x.status));
      return { step, kind: 'portrait', id: c.id };
    }
    if (step === 'cover') return { step, kind: 'cover' };
    if (step === 'storyboard') {
      const img = p.shots.find((s) => !finished(s.image_status));
      if (img) return { step, kind: 'image', id: img.id };
      // a clip is made as long as its shot's voice lines, so those are voiced first
      const unvoiced = p.shots.find((s) => s.kind === 'clip' && s.clip_status === 'pending' && !finished(s.audio_status));
      if (unvoiced) return { step, kind: 'voice', id: unvoiced.id };
      const start = p.shots.find((s) => s.kind === 'clip' && s.clip_status === 'pending');
      if (start) return { step, kind: 'clip_start', id: start.id };
      return { step, kind: 'clip_poll' };
    }
    if (step === 'export') {
      const voice = p.shots.find((s) => !finished(s.audio_status));
      if (voice) return { step, kind: 'voice', id: voice.id };
      return { step, kind: p.render_id ? 'render_poll' : 'render' };
    }
  }
  return null;
}

/* --------------------------------------------------------------- running */

/** Start (or resume) work up to `target` ('script' … 'export', or 'all'). */
async function start(projectId, target) {
  const token = crypto.randomBytes(12).toString('hex');
  await db.query('UPDATE drama_projects SET run_target = :target, run_token = :token, error = NULL, stage_detail = :d WHERE id = :id', {
    id: projectId,
    target,
    token,
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

/** Job handler: one unit, then queue the next (immediately, or later while waiting on a provider). */
async function run({ projectId, token }) {
  const p = await load(projectId);
  if (!p || !p.run_target || p.run_token !== token) return { status: 'stale' };
  const unit = nextUnit(p, p.run_target);
  if (!unit) {
    await db.query("UPDATE drama_projects SET run_target = NULL, run_token = NULL, stage_detail = 'เสร็จแล้ว' WHERE id = :id", { id: p.id });
    return { status: 'done' };
  }
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

/** Run an item's work; a failure marks only that item (the run continues with the next one). */
async function itemTry(fn, onFail) {
  try {
    await fn();
  } catch (err) {
    await onFail(String(err?.message ?? err).slice(0, 480));
  }
}

/* ------------------------------------------------------------------ script */

const SCRIPT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['title', 'logline', 'characters', 'shots'],
  properties: {
    title: { type: 'string', description: 'ชื่อเรื่องภาษาไทย สั้น ดึงดูด' },
    logline: { type: 'string', description: 'เรื่องย่อ 1-2 ประโยค' },
    characters: {
      type: 'array',
      description: '2-5 ตัวละครหลัก',
      items: {
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
      },
    },
    shots: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['scene', 'narration', 'dialogue', 'visual', 'camera', 'characters', 'key', 'product'],
        properties: {
          scene: { type: 'string', description: 'ชื่อฉากสั้น ๆ ภาษาไทย' },
          narration: { type: 'string', description: 'คำบรรยายของผู้เล่าเรื่อง ภาษาไทยแบบพูด 1-2 ประโยค (เว้นว่างได้ถ้ามีบทพูด)' },
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
          visual: { type: 'string', description: 'English image prompt: who (by look), action, setting, time, mood. No text in image.' },
          camera: { type: 'string', description: 'English camera/motion for video: e.g. slow push in, handheld, pan left' },
          characters: { type: 'array', items: { type: 'string' }, description: 'key ของตัวละครที่อยู่ในภาพ (ตัวหลักก่อน)' },
          key: { type: 'boolean', description: 'true ถ้าเป็นช็อตสำคัญ/ไคลแมกซ์ที่ควรเป็นคลิปเคลื่อนไหว' },
          product: { type: 'boolean', description: 'true เฉพาะช็อตที่ตัวละครหยิบ/ใช้/พูดถึงสินค้าที่ไทอิน (false ถ้าไม่มีไทอิน)' },
        },
      },
    },
  },
};

const SCRIPT_SYSTEM = `คุณเป็นนักเขียนบทละครสั้นแนวตั้งสำหรับ TikTok / Reels ภาษาไทย เล่าเรื่องให้ติดตามตั้งแต่ 3 วินาทีแรก
- เปิดด้วย hook ที่ชวนสงสัยหรือสะเทือนใจ ปิดด้วยหักมุมหรือข้อคิด
- ผู้บรรยายเล่าเรื่อง ตัวละครพูดสั้น ๆ เป็นธรรมชาติ ภาษาไทยที่คนดูทั่วไปเข้าใจ
- แต่ละช็อตยาวพูดจบใน 4-8 วินาที
- visual / look / camera เป็นภาษาอังกฤษ บรรยายหน้าตาตัวละครให้เหมือนกันทุกช็อต
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

async function writeScript(p) {
  await detail(p.id, 'AI กำลังเขียนบทละคร');
  const genre = catalog.genreOf(p.genre);
  const len = catalog.lengthOf(p.length_sec);
  const share = catalog.VISUAL_MODES.find((m) => m.id === p.visual_mode)?.clipShare ?? 0;
  const { data } = await ai.extractStructured({
    system: SCRIPT_SYSTEM,
    schema: SCRIPT_SCHEMA,
    toolName: 'submit_drama',
    toolDescription: 'ส่งบทละคร',
    maxTokens: 8000,
    content: [
      {
        type: 'text',
        text: [
          `แนวเรื่อง: ${genre.label}${p.substyle ? ` (${p.substyle})` : ''} — ${genre.tone}`,
          `สไตล์ภาพ: ${catalog.styleOf(p.style).label}`,
          `ความยาว: ${len.label} ประมาณ ${len.shots} ช็อต`,
          p.premise ? `ไอเดียเรื่องจากผู้ใช้: ${p.premise}` : 'ให้คิดเรื่องใหม่ที่น่าติดตามเอง',
          share > 0 && share < 1 ? `ทำเครื่องหมาย key=true ให้ช็อตสำคัญประมาณ ${Math.round(len.shots * share)} ช็อต` : '',
          p.tie_in
            ? [
                `ไทอินสินค้า (product placement): "${p.product_name || 'สินค้าของร้าน'}" — สิ่งที่ต้องพูดถึง: ${p.product_pitch}`,
                '- สอดสินค้าเข้าไปในเรื่องอย่างเป็นธรรมชาติ 1-2 ช็อต (ช่วงกลางเรื่องหรือก่อนจบ) ตัวละครหยิบ ใช้ หรือแนะนำสินค้าเหมือนเป็นส่วนหนึ่งของเหตุการณ์ ไม่ขายของโต้ง ๆ',
                '- บทพูดในช็อตนั้นต้องสื่อจุดเด่นตามที่ร้านบอก กระชับ เป็นภาษาพูด ห้ามอ้างสรรพคุณเกินจริงหรือรักษาโรค',
                '- ทำเครื่องหมาย product=true และ key=true ให้ช็อตไทอิน และให้ visual บรรยายตัวละครถือ/ใช้สินค้าให้เห็นชัด',
              ].join('\n')
            : 'ไม่มีไทอินสินค้า: ทุกช็อต product=false',
        ]
          .filter(Boolean)
          .join('\n'),
      },
    ],
  });
  const chars = (data.characters ?? []).slice(0, 6);
  const keys = new Set(chars.map((c) => String(c.key)));
  const shots = (data.shots ?? []).slice(0, len.shots + 6);
  if (!shots.length) throw new Error('AI ไม่ได้ส่งช็อตกลับมา ลองเขียนบทใหม่');
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
    for (const [i, c] of chars.entries()) {
      const voice = pickVoice(voices, c, used);
      if (voice) used.add(voice);
      await conn.query(
        `INSERT INTO drama_characters (drama_project_id, char_key, name, role, gender, age, description, look_prompt, voice_id, sort_order)
         VALUES (:id, :key, :name, :role, :gender, :age, :description, :look, :voice, :i)`,
        { id: p.id, key: String(c.key).slice(0, 40), name: c.name, role: c.role, gender: c.gender, age: c.age, description: c.description, look: c.look, voice, i },
      );
    }
    for (const [i, s] of shots.entries()) {
      // tie-in shots move whenever the project makes any clips
      const kind = p.visual_mode === 'clips' || (p.visual_mode === 'mixed' && (s.key || (p.tie_in && s.product))) ? 'clip' : 'still';
      await conn.query(
        `INSERT INTO drama_shots (drama_project_id, seq, scene_title, narration, dialogue, visual_prompt, camera, characters, kind, clip_status, is_product)
         VALUES (:id, :seq, :scene, :narration, :dialogue, :visual, :camera, :chars, :kind, :clipStatus, :isProduct)`,
        {
          id: p.id,
          seq: i + 1,
          scene: s.scene,
          narration: s.narration || null,
          dialogue: JSON.stringify((s.dialogue ?? []).filter((d) => keys.has(d.character) && d.line)),
          visual: s.visual,
          camera: s.camera,
          chars: JSON.stringify((s.characters ?? []).filter((k) => keys.has(k))),
          kind,
          clipStatus: kind === 'clip' ? 'pending' : 'done',
          isProduct: p.tie_in && s.product ? 1 : 0,
        },
      );
    }
    await conn.query('UPDATE drama_projects SET title = :title, logline = :logline, cover_key = NULL, output_key = NULL, render_id = NULL WHERE id = :id', {
      id: p.id,
      title: String(data.title || p.title).slice(0, 255),
      logline: data.logline ?? null,
    });
  });
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

async function shotImage(p, unit) {
  const s = p.shots.find((x) => x.id === unit.id);
  const done = p.shots.filter((x) => finished(x.image_status)).length;
  await detail(p.id, `กำลังสร้างภาพช็อต ${s.seq}/${p.shots.length} (เสร็จ ${done})`);
  const lead = s.characters.map((k) => p.characters.find((c) => c.char_key === k)).find((c) => c?.portrait_key);
  const looks = s.characters
    .map((k) => p.characters.find((c) => c.char_key === k))
    .filter(Boolean)
    .map((c) => `${c.name}: ${c.look_prompt}`)
    .join('; ');
  await itemTry(
    async () => {
      const img = await minimaxMedia.generateImage({
        prompt: styled(
          p,
          `${s.visual_prompt}${looks ? `. Characters — ${looks}` : ''}${s.is_product ? `. The character clearly holds and shows the product "${p.product_name || 'product'}" to the camera` : ''}. Vertical 9:16 frame`,
        ),
        aspectRatio: '9:16',
        subjectImage: lead ? dataUrl(lead.portrait_key) : null,
      });
      await db.query("UPDATE drama_shots SET image_key = :key, image_status = 'done', error = NULL WHERE id = :id", { id: s.id, key: saveFile(img.buffer, img.mime) });
    },
    (e) => db.query("UPDATE drama_shots SET image_status = 'failed', clip_status = IF(kind = 'clip', 'failed', clip_status), error = :e WHERE id = :id", { id: s.id, e }),
  );
}

/** Estimated seconds a shot's lines take (before the voices exist): ~12 Thai characters per second. */
const shotSeconds = (s) => {
  const chars = [s.narration, ...s.dialogue.map((d) => d.line)].join('').replace(/\s/g, '').length;
  return Math.max(4, Math.min(10, Math.ceil(chars / 12 + 1)));
};

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
    `Cinematic drama scene, continuous live action: ${s.visual_prompt}.${speaking} Characters${names.length ? '' : ' (if any)'} act with expressive faces, natural body language and believable movement; background life moves too. Camera: ${s.camera || 'slow cinematic push in'}. Keep the exact faces, costumes and setting of the first frame. Smooth motion, no cuts, no subtitles`,
  );
}

async function clipStart(p, unit) {
  const s = p.shots.find((x) => x.id === unit.id);
  await detail(p.id, `ส่งช็อต ${s.seq} ให้ MiniMax H3 สร้างคลิปวิดีโอ`);
  await itemTry(
    async () => {
      if (s.image_status !== 'done') throw new Error('ไม่มีภาพของช็อตนี้');
      const seconds = voicedSeconds(s);
      // A tie-in shot is made from references (the shot + the real product photo) so the product looks right;
      // H3 does not take a first frame and references together
      const productRef = s.is_product && p.product_image_key ? dataUrl(p.product_image_key) : null;
      const { taskId } = await minimaxMedia.createVideoV2({
        prompt: productRef
          ? `${motionPrompt(p, s)}. The character from reference image 1 presents the exact product from reference image 2 (same shape, colors and label), holding it clearly toward the camera`
          : motionPrompt(p, s),
        ...(productRef ? { references: [dataUrl(s.image_key), productRef] } : { firstFrame: dataUrl(s.image_key) }),
        duration: seconds,
        ratio: '9:16',
      });
      await db.query("UPDATE drama_shots SET clip_task_id = :taskId, clip_status = 'processing', clip_polls = 0, clip_sec = :seconds WHERE id = :id", {
        id: s.id,
        taskId,
        seconds,
      });
    },
    (e) => db.query("UPDATE drama_shots SET clip_status = 'failed', error = :e WHERE id = :id", { id: s.id, e }),
  );
}

async function clipPoll(p) {
  const pending = p.shots.filter((s) => s.clip_status === 'processing');
  for (const s of pending) {
    await itemTry(
      async () => {
        const q = await minimaxMedia.queryVideoV2(s.clip_task_id);
        if (q.status === 'ready') {
          const key = await download(q.url, 'video/mp4');
          await db.query("UPDATE drama_shots SET clip_key = :key, clip_status = 'done' WHERE id = :id", { id: s.id, key });
        } else if (q.status === 'failed') throw new Error(q.error || 'MiniMax สร้างคลิปไม่สำเร็จ');
        else if (s.clip_polls + 1 >= MAX_CLIP_POLLS) throw new Error('รอคลิปนานเกินไป');
        else await db.query('UPDATE drama_shots SET clip_polls = clip_polls + 1 WHERE id = :id', { id: s.id });
      },
      // the shot keeps its still image in the final video
      (e) => db.query("UPDATE drama_shots SET clip_status = 'failed', error = :e WHERE id = :id", { id: s.id, e: `คลิป: ${e}` }),
    );
  }
  const left = (await db.query("SELECT COUNT(*) AS n FROM drama_shots WHERE drama_project_id = :id AND clip_status = 'processing'", { id: p.id }))[0].n;
  if (Number(left)) {
    await detail(p.id, `MiniMax H3 กำลังสร้างคลิป เหลือ ${left} ช็อต`);
    return CLIP_POLL_MS;
  }
  return 0;
}

/* ----------------------------------------------------------------- export */

async function voice(p, unit) {
  const s = p.shots.find((x) => x.id === unit.id);
  await detail(p.id, `กำลังพากย์เสียงช็อต ${s.seq}/${p.shots.length}`);
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
      await db.query("UPDATE drama_shots SET audio = :audio, audio_status = 'done' WHERE id = :id", { id: s.id, audio: JSON.stringify(audio) });
    },
    (e) => db.query("UPDATE drama_shots SET audio_status = 'failed', error = :e WHERE id = :id", { id: s.id, e: `เสียง: ${e}` }),
  );
}

async function render(p) {
  if (!shotstack.isConfigured()) throw new Error('ยังไม่ได้ตั้งค่า Shotstack (ใช้ตัวเดียวกับ AI Video) — ตั้งที่หน้าการเชื่อมต่อ API');
  if (!env.PUBLIC_API_URL) throw new Error('ยังไม่ได้ตั้ง PUBLIC_API_URL — ตัวเรนเดอร์ต้องโหลดภาพและเสียงจาก backend');
  const usable = p.shots.filter((s) => s.image_key || s.clip_key);
  if (!usable.length) throw new Error('ยังไม่มีภาพของช็อตไหนเลย');
  await detail(p.id, 'กำลังประกอบละครและส่งเรนเดอร์');
  const { edit, srt, durationSec } = buildDramaEdit({
    title: p.title,
    coverUrl: fileUrl(p.cover_key),
    shots: usable.map((s) => ({
      image: fileUrl(s.image_key),
      clip: s.clip_key ? fileUrl(s.clip_key) : null,
      clipSec: s.clip_key ? (s.clip_sec ?? shotSeconds(s)) : null,
      lines: (s.audio_status === 'done' ? s.audio : []).map((a) => ({ ...a, url: fileUrl(a.key) })),
      product: s.is_product && p.product_image_key ? { url: fileUrl(p.product_image_key), name: p.product_name } : null,
    })),
    musicUrl: p.music ? process.env.DRAMA_MUSIC_URL || process.env.VIDEO_MUSIC_URL || null : null,
  });
  const { renderId } = await shotstack.render(edit);
  await db.query('UPDATE drama_projects SET render_id = :renderId, subtitle_srt = :srt, duration_sec = :d WHERE id = :id', { id: p.id, renderId, srt, d: durationSec });
  await detail(p.id, 'Shotstack กำลังเรนเดอร์วิดีโอ 9:16');
  return RENDER_POLL_MS;
}

async function renderPoll(p) {
  const r = await shotstack.getRender(p.render_id);
  if (r.status === 'processing') {
    const polls = Number(p.stage_detail?.match(/\((\d+)\)$/)?.[1] ?? 0) + 1;
    if (polls >= MAX_RENDER_POLLS) {
      await db.query('UPDATE drama_projects SET render_id = NULL WHERE id = :id', { id: p.id });
      throw new Error('Shotstack เรนเดอร์นานเกินไป ลองใหม่อีกครั้ง');
    }
    await detail(p.id, `Shotstack กำลังเรนเดอร์วิดีโอ 9:16 (${polls})`);
    return RENDER_POLL_MS;
  }
  if (r.status === 'failed') {
    await db.query('UPDATE drama_projects SET render_id = NULL WHERE id = :id', { id: p.id });
    throw new Error(`Shotstack: ${r.error}`);
  }
  const key = await download(r.url, 'video/mp4', 500 * 1024 * 1024);
  await db.query('UPDATE drama_projects SET output_key = :key, output_url = :url WHERE id = :id', { id: p.id, key, url: r.url });
  return 0;
}

const UNITS = {
  script: writeScript,
  portrait,
  cover,
  image: shotImage,
  clip_start: clipStart,
  clip_poll: clipPoll,
  voice,
  render,
  render_poll: renderPoll,
};

/* ------------------------------------------------------- redo & previews */

/** Redo one item: it goes back to pending and the next run makes it again. */
async function redo(p, what, id) {
  if (what === 'character') {
    await db.query("UPDATE drama_characters SET status = 'pending', error = NULL WHERE id = :id AND drama_project_id = :p", { id, p: p.id });
    // shots drawn from the old portrait stay as they are
  } else if (what === 'shot') {
    await db.query(
      `UPDATE drama_shots SET image_status = 'pending', clip_status = IF(kind = 'clip', 'pending', 'done'), clip_key = NULL, clip_task_id = NULL, error = NULL
        WHERE id = :id AND drama_project_id = :p`,
      { id, p: p.id },
    );
  } else if (what === 'cover') {
    await db.query('UPDATE drama_projects SET cover_key = NULL WHERE id = :id', { id: p.id });
  } else if (what === 'voices') {
    await db.query("UPDATE drama_shots SET audio_status = 'pending' WHERE drama_project_id = :id", { id: p.id });
  } else throw badRequest('ไม่รู้จักสิ่งที่จะสร้างใหม่');
  // anything that changes the picture invalidates the finished video
  await db.query('UPDATE drama_projects SET output_key = NULL, render_id = NULL WHERE id = :id', { id: p.id });
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

module.exports = { STEPS, load, stepStates, nextUnit, start, cancel, run, redo, previewStep, fileUrl, saveFile, estimateFor: catalog.estimate, pickVoice, shotSeconds, SCRIPT_SCHEMA };
