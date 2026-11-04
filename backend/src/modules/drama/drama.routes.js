'use strict';

const express = require('express');
const { z } = require('zod');
const db = require('../../db/pool');
const { validate } = require('../../core/http');
const { authenticate, requirePermission } = require('../../core/auth');
const { audit } = require('../../core/audit');
const { notFound, badRequest } = require('../../core/errors');
const { enqueue } = require('../../jobs/queue');
const minimaxMedia = require('../../integrations/minimax-media');
const media = require('../video/media');
const catalog = require('./catalog');
const drama = require('./drama.service');

/** ละคร AI: projects, the six-step studio and the style gallery. */
const router = express.Router();
router.use(authenticate, requirePermission('video:create'));

const idParam = z.object({ id: z.coerce.number().int().positive() });
const GENRE_IDS = catalog.GENRES.map((g) => g.id);
const STYLE_IDS = catalog.STYLES.map((s) => s.id);

const settingsBody = z.object({
  title: z.string().trim().max(255).optional(),
  genre: z.enum(GENRE_IDS),
  substyle: z.string().trim().max(60).nullish(),
  style: z.enum(STYLE_IDS),
  lengthSec: z.coerce.number().int().refine((v) => catalog.LENGTHS.some((l) => l.sec === v), 'ความยาวไม่รองรับ'),
  // every shot is a moving clip now; older clients still send this
  visualMode: z.enum(['stills', 'mixed', 'clips']).optional(),
  episodesTotal: z.coerce.number().int().min(1).max(catalog.MAX_EPISODES).default(1),
  premise: z.string().trim().max(2000).nullish(),
  narratorVoiceId: z.string().trim().max(100).nullish(),
  music: z.boolean().default(true),
  // product tie-in: the shop's product is woven into the story
  tieIn: z.boolean().default(false),
  productName: z.string().trim().max(191).nullish(),
  productPitch: z.string().trim().max(1500).nullish(),
});

async function own(req) {
  const p = await drama.load(req.valid.params.id, req.user.orgId);
  if (!p) throw notFound('ไม่พบโปรเจกต์ละคร');
  return p;
}

/** The episode the studio shows: asked for, or the one being worked on, or the first unfinished one. */
function pickEpisode(p, asked) {
  const n = Number(asked);
  if (Number.isInteger(n) && n >= 1 && n <= p.episodes_total) return n;
  if (p.run_target && p.run_episode) return Math.min(p.run_episode, p.episodes_total);
  return (drama.hasOutline(p) && drama.nextEpisode(p)) || 1;
}

/** Everything the studio shows for one episode (plus the series), with signed file URLs. */
function present(p, asked = null) {
  const ep = pickEpisode(p, asked);
  const states = drama.stepStates(p, ep);
  const runEp = p.run_target ? (p.run_target === 'series' ? (drama.hasOutline(p) ? drama.nextEpisode(p) : 1) : p.run_episode || 1) : null;
  const runUnit = p.run_target && runEp ? drama.nextUnit(p, p.run_target, runEp) : null;
  // series-wide steps show as running from any episode; episode steps only on the episode being made
  const seriesStep = runUnit && ['script', 'characters', 'cover'].includes(runUnit.step) && runUnit.kind !== 'episode_script';
  const running = runUnit && (runEp === ep || seriesStep) ? runUnit.step : null;
  const e = drama.episodeOf(p, ep);
  return {
    id: p.id,
    title: p.title,
    genre: p.genre,
    substyle: p.substyle,
    style: p.style,
    lengthSec: p.length_sec,
    visualMode: 'clips',
    episodesTotal: p.episodes_total,
    episode: ep,
    premise: p.premise,
    narratorVoiceId: p.narrator_voice_id,
    music: Boolean(p.music),
    tieIn: Boolean(p.tie_in),
    productName: p.product_name,
    productPitch: p.product_pitch,
    productImageUrl: drama.fileUrl(p.product_image_key),
    logline: p.logline,
    coverUrl: drama.fileUrl(p.cover_key),
    hasOutline: drama.hasOutline(p),
    episodes: Array.from({ length: p.episodes_total }, (_, i) => {
      const no = i + 1;
      const row = drama.episodeOf(p, no);
      const shots = drama.shotsOf(p, no);
      const status = drama.episodeStatus(p, no);
      return {
        no,
        title: row?.title ?? null,
        summary: row?.summary ?? null,
        cliffhanger: row?.cliffhanger ?? null,
        shots: shots.length,
        clipsDone: shots.filter((s) => s.clip_status === 'done' && s.clip_key).length,
        status: p.run_target && runEp === no && status !== 'done' ? 'running' : status,
        outputUrl: status === 'done' ? drama.fileUrl(row?.output_key) : null,
        durationSec: row?.duration_sec ?? null,
        hasSubtitles: Boolean(row?.subtitle_srt),
      };
    }),
    outputUrl: states.export === 'done' ? drama.fileUrl(e?.output_key) : null,
    durationSec: e?.duration_sec ?? null,
    hasSubtitles: Boolean(e?.subtitle_srt),
    runTarget: p.run_target,
    runEpisode: runEp,
    runningStep: running,
    stageDetail: p.stage_detail,
    error: p.error,
    steps: drama.STEPS.map((key) => ({ key, status: running === key ? 'running' : states[key] })),
    characters: p.characters.map((c) => ({
      id: c.id,
      key: c.char_key,
      name: c.name,
      role: c.role,
      gender: c.gender,
      age: c.age,
      description: c.description,
      lookPrompt: c.look_prompt,
      voiceId: c.voice_id,
      portraitUrl: drama.fileUrl(c.portrait_key),
      status: c.status,
      error: c.error,
    })),
    shots: drama.shotsOf(p, ep).map((s) => ({
      id: s.id,
      episodeNo: s.episode_no,
      seq: s.seq,
      scene: s.scene_title,
      narration: s.narration,
      dialogue: s.dialogue,
      visualPrompt: s.visual_prompt,
      camera: s.camera,
      characters: s.characters,
      kind: 'clip',
      isProduct: Boolean(s.is_product),
      imageUrl: drama.fileUrl(s.image_key),
      imageStatus: s.image_status,
      clipUrl: drama.fileUrl(s.clip_key),
      clipStatus: s.clip_status,
      clipAttempts: s.clip_attempts ?? 0,
      audio: s.audio.map((a) => ({ speaker: a.speaker, name: a.name, text: a.text, ms: a.ms, url: drama.fileUrl(a.key) })),
      audioStatus: s.audio_status,
      error: s.error,
    })),
    estimate: catalog.estimate({ lengthSec: p.length_sec, episodes: p.episodes_total, shots: drama.shotsOf(p, ep).length || null, characters: p.characters.length || 4 }),
    updatedAt: p.updated_at,
  };
}

const epQuery = z.object({ episode: z.coerce.number().int().positive().optional() });

/* ----------------------------------------------------------------- catalog */

router.get('/catalog', async (req, res) => {
  const rows = await db.query('SELECT genre, style, image_key, status, error FROM drama_style_previews WHERE org_id = :orgId', { orgId: req.user.orgId });
  const previews = {};
  for (const r of rows) (previews[r.genre] ??= {})[r.style] = { status: r.status, url: drama.fileUrl(r.image_key), error: r.error ?? null };
  res.json({
    data: {
      genres: catalog.GENRES.map(({ id, label, hint, substyles }) => ({ id, label, hint, substyles })),
      styles: catalog.STYLES.map(({ id, label, hint }) => ({ id, label, hint })),
      lengths: catalog.LENGTHS,
      episodePresets: catalog.EPISODE_PRESETS,
      maxEpisodes: catalog.MAX_EPISODES,
      visualModes: catalog.VISUAL_MODES,
      previews,
      configured: {
        minimax: minimaxMedia.isConfigured(),
        shotstack: require('../../integrations/shotstack').isConfigured(),
        publicApiUrl: Boolean(require('../../config/env').PUBLIC_API_URL),
        defaultVoiceId: require('../../config/runtime').get('MINIMAX_VOICE_ID') || null,
      },
    },
  });
});

/** Make the style gallery's sample pictures for one genre (one image per job, cached per shop). */
router.post('/catalog/previews', validate({ body: z.object({ genre: z.enum(GENRE_IDS) }) }), async (req, res) => {
  minimaxMedia.requireConfig();
  const { genre } = req.valid.body;
  for (const s of catalog.STYLES) {
    await db.query(
      `INSERT INTO drama_style_previews (org_id, genre, style, status) VALUES (:orgId, :genre, :style, 'pending')
       ON DUPLICATE KEY UPDATE status = IF(status = 'done', 'done', 'pending')`,
      { orgId: req.user.orgId, genre, style: s.id },
    );
  }
  await enqueue('drama.preview', { orgId: req.user.orgId, genre }, { orgId: req.user.orgId, maxAttempts: 1 });
  res.status(202).json({ data: { ok: true } });
});

/* ---------------------------------------------------------------- projects */

router.get('/', async (req, res) => {
  const rows = await db.query(
    `SELECT p.*, (SELECT COUNT(*) FROM drama_shots s WHERE s.drama_project_id = p.id) AS shot_count,
            (SELECT COUNT(*) FROM drama_episodes e WHERE e.drama_project_id = p.id AND e.output_key IS NOT NULL AND e.episode_no <= p.episodes_total) AS episodes_done
       FROM drama_projects p WHERE p.org_id = :orgId ORDER BY p.updated_at DESC LIMIT 100`,
    { orgId: req.user.orgId },
  );
  res.json({
    data: rows.map((p) => ({
      id: p.id,
      title: p.title,
      genre: p.genre,
      style: p.style,
      lengthSec: p.length_sec,
      visualMode: 'clips',
      episodesTotal: Number(p.episodes_total ?? 1),
      episodesDone: Number(p.episodes_done),
      shots: Number(p.shot_count),
      coverUrl: drama.fileUrl(p.cover_key),
      done: Number(p.episodes_done) >= Number(p.episodes_total ?? 1),
      running: Boolean(p.run_target),
      error: p.error,
      updatedAt: p.updated_at,
    })),
  });
});

router.post('/', validate({ body: settingsBody }), async (req, res) => {
  const b = req.valid.body;
  const r = await db.query(
    `INSERT INTO drama_projects (org_id, title, genre, substyle, style, length_sec, visual_mode, episodes_total, premise, narrator_voice_id, music, tie_in, product_name, product_pitch, created_by)
     VALUES (:orgId, :title, :genre, :substyle, :style, :lengthSec, 'clips', :episodes, :premise, :voice, :music, :tieIn, :productName, :productPitch, :userId)`,
    {
      orgId: req.user.orgId,
      title: b.title || `ละคร${catalog.genreOf(b.genre).label}`,
      genre: b.genre,
      substyle: b.substyle ?? null,
      style: b.style,
      lengthSec: b.lengthSec,
      episodes: b.episodesTotal,
      premise: b.premise ?? null,
      voice: b.narratorVoiceId ?? null,
      music: b.music ? 1 : 0,
      tieIn: b.tieIn ? 1 : 0,
      productName: b.productName || null,
      productPitch: b.productPitch || null,
      userId: req.user.id,
    },
  );
  audit(req, 'drama.create', 'drama_project', r.insertId, { genre: b.genre, style: b.style, episodes: b.episodesTotal });
  res.status(201).json({ data: present(await drama.load(r.insertId)) });
});

router.get('/:id', validate({ params: idParam, query: epQuery }), async (req, res) => res.json({ data: present(await own(req), req.valid.query.episode) }));

router.put('/:id/settings', validate({ params: idParam, query: epQuery, body: settingsBody }), async (req, res) => {
  const p = await own(req);
  const b = req.valid.body;
  if (b.episodesTotal !== p.episodes_total && p.shots.length) {
    throw badRequest('เปลี่ยนจำนวนตอนได้ก่อนเขียนบทตอนแรกเท่านั้น — ถ้าต้องการเปลี่ยน ให้เขียนเรื่องใหม่ทั้งหมดที่ขั้น 02');
  }
  await db.query(
    `UPDATE drama_projects SET title = COALESCE(:title, title), genre = :genre, substyle = :substyle, style = :style, length_sec = :lengthSec,
            visual_mode = 'clips', episodes_total = :episodes, premise = :premise, narrator_voice_id = :voice, music = :music,
            tie_in = :tieIn, product_name = :productName, product_pitch = :productPitch WHERE id = :id`,
    {
      id: p.id,
      title: b.title || null,
      genre: b.genre,
      substyle: b.substyle ?? null,
      style: b.style,
      lengthSec: b.lengthSec,
      episodes: b.episodesTotal,
      premise: b.premise ?? null,
      voice: b.narratorVoiceId ?? null,
      music: b.music ? 1 : 0,
      tieIn: b.tieIn ? 1 : 0,
      productName: b.productName || null,
      productPitch: b.productPitch || null,
    },
  );
  // a new number of episodes needs a new outline (nothing is written yet)
  if (b.episodesTotal !== p.episodes_total) await drama.redo(p, 'outline');
  if (b.narratorVoiceId !== p.narrator_voice_id) {
    // every episode's narration needs the new voice
    await db.query("UPDATE drama_shots SET audio_status = 'pending' WHERE drama_project_id = :id", { id: p.id });
    await db.query('UPDATE drama_episodes SET output_key = NULL, render_id = NULL WHERE drama_project_id = :id', { id: p.id });
  }
  res.json({ data: present(await drama.load(p.id), req.valid.query.episode) });
});

const shotBody = z.object({
  narration: z.string().trim().max(1000).nullish(),
  dialogue: z.array(z.object({ character: z.string().max(40), line: z.string().trim().min(1).max(500) })).max(4).optional(),
  visualPrompt: z.string().trim().max(2000).optional(),
  camera: z.string().trim().max(255).nullish(),
});

router.put('/:id/shots/:sid', validate({ params: idParam.extend({ sid: z.coerce.number().int().positive() }), body: shotBody }), async (req, res) => {
  const p = await own(req);
  const s = p.shots.find((x) => x.id === req.valid.params.sid);
  if (!s) throw notFound('ไม่พบช็อต');
  const b = req.valid.body;
  const textChanged =
    (b.narration !== undefined && (b.narration || null) !== s.narration) || (b.dialogue !== undefined && JSON.stringify(b.dialogue) !== JSON.stringify(s.dialogue));
  await db.query(
    `UPDATE drama_shots SET narration = :narration, dialogue = :dialogue, visual_prompt = :visual, camera = :camera,
            audio_status = IF(:textChanged, 'pending', audio_status) WHERE id = :sid`,
    {
      sid: s.id,
      narration: b.narration === undefined ? s.narration : b.narration || null,
      dialogue: JSON.stringify(b.dialogue ?? s.dialogue),
      visual: b.visualPrompt ?? s.visual_prompt,
      camera: b.camera === undefined ? s.camera : b.camera || null,
      textChanged: textChanged ? 1 : 0,
    },
  );
  if (textChanged) await drama.outdated(p.id, s.episode_no);
  res.json({ data: present(await drama.load(p.id), s.episode_no) });
});

const characterBody = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  role: z.string().trim().max(255).nullish(),
  lookPrompt: z.string().trim().max(2000).optional(),
  voiceId: z.string().trim().max(100).nullish(),
});

router.put('/:id/characters/:cid', validate({ params: idParam.extend({ cid: z.coerce.number().int().positive() }), query: epQuery, body: characterBody }), async (req, res) => {
  const p = await own(req);
  const c = p.characters.find((x) => x.id === req.valid.params.cid);
  if (!c) throw notFound('ไม่พบตัวละคร');
  const b = req.valid.body;
  await db.query('UPDATE drama_characters SET name = :name, role = :role, look_prompt = :look, voice_id = :voice WHERE id = :id', {
    id: c.id,
    name: b.name ?? c.name,
    role: b.role === undefined ? c.role : b.role || null,
    look: b.lookPrompt ?? c.look_prompt,
    voice: b.voiceId === undefined ? c.voice_id : b.voiceId || null,
  });
  // this character's lines need the new voice
  if (b.voiceId !== undefined && (b.voiceId || null) !== c.voice_id) {
    for (const s of p.shots.filter((x) => x.dialogue.some((d) => d.character === c.char_key))) {
      await db.query("UPDATE drama_shots SET audio_status = 'pending' WHERE id = :id", { id: s.id });
      await drama.outdated(p.id, s.episode_no);
    }
  }
  res.json({ data: present(await drama.load(p.id), req.valid.query.episode) });
});

const episodeNo = z.number().int().positive().optional();

/**
 * Run one step ('script' … 'export') of an episode, everything left of it ('all' = ทำออโต้ตอนนี้),
 * or every episode in order ('series' = ทำทุกตอนต่อเนื่อง).
 */
router.post(
  '/:id/run',
  validate({ params: idParam, body: z.object({ target: z.enum([...drama.STEPS.slice(1), 'all', 'series']), episode: episodeNo }) }),
  async (req, res) => {
    const p = await own(req);
    const { target } = req.valid.body;
    const ep = Math.min(req.valid.body.episode ?? 1, p.episodes_total);
    const shots = drama.shotsOf(p, ep);
    if ((target === 'script' || ((target === 'all' || target === 'series') && !p.shots.length)) && p.tie_in && (!p.product_pitch || !p.product_image_key)) {
      throw badRequest('เปิดไทอินสินค้าแล้ว — ใส่รูปสินค้าและสิ่งที่อยากให้ตัวละครพูดก่อน (ขั้น 01)');
    }
    // writing the script again starts this episode over (the outline and other episodes stay)
    if (target === 'script' && shots.length) await drama.redo(p, 'episode', null, ep);
    if ((target === 'storyboard' || target === 'export') && !shots.length) throw badRequest(`ต้องมีบทของตอนที่ ${ep} ก่อน — ไปขั้น 02 บทบรรยาย`);
    if ((target === 'characters' || target === 'cover') && !drama.hasOutline(p)) throw badRequest('ต้องมีโครงเรื่องก่อน — ไปขั้น 02 บทบรรยาย');
    await drama.start(p.id, target, ep);
    audit(req, 'drama.run', 'drama_project', p.id, { target, episode: ep });
    res.status(202).json({ data: present(await drama.load(p.id), ep) });
  },
);

router.post('/:id/cancel', validate({ params: idParam, query: epQuery }), async (req, res) => {
  const p = await own(req);
  await drama.cancel(p.id);
  res.json({ data: present(await drama.load(p.id), req.valid.query.episode) });
});

router.post(
  '/:id/redo',
  validate({
    params: idParam,
    body: z.object({ what: z.enum(['character', 'shot', 'clip', 'cover', 'voices', 'episode', 'outline']), itemId: z.number().int().positive().optional(), episode: episodeNo }),
  }),
  async (req, res) => {
    const p = await own(req);
    const { what, itemId } = req.valid.body;
    if (['character', 'shot', 'clip'].includes(what) && !itemId) throw badRequest('ระบุรายการที่จะสร้างใหม่');
    const shot = itemId && (what === 'shot' || what === 'clip') ? p.shots.find((s) => s.id === itemId) : null;
    const ep = shot?.episode_no ?? Math.min(req.valid.body.episode ?? 1, p.episodes_total);
    await drama.redo(p, what, itemId, ep);
    const step = { character: 'characters', shot: 'storyboard', clip: 'storyboard', cover: 'cover', voices: 'export', episode: 'script', outline: 'script' }[what];
    await drama.start(p.id, step, what === 'outline' ? 1 : ep);
    audit(req, 'drama.redo', 'drama_project', p.id, { what, episode: ep });
    res.status(202).json({ data: present(await drama.load(p.id), what === 'outline' ? 1 : ep) });
  },
);

/** Edit an episode in the outline (before its script is written, this steers it). */
router.put(
  '/:id/episodes/:no',
  validate({
    params: idParam.extend({ no: z.coerce.number().int().positive() }),
    body: z.object({ title: z.string().trim().min(1).max(255).optional(), summary: z.string().trim().max(3000).nullish(), cliffhanger: z.string().trim().max(1500).nullish() }),
  }),
  async (req, res) => {
    const p = await own(req);
    const e = drama.episodeOf(p, req.valid.params.no);
    if (!e) throw notFound('ไม่พบตอนนี้');
    const b = req.valid.body;
    await db.query('UPDATE drama_episodes SET title = :title, summary = :summary, cliffhanger = :cliff WHERE id = :id', {
      id: e.id,
      title: b.title ?? e.title,
      summary: b.summary === undefined ? e.summary : b.summary || null,
      cliff: b.cliffhanger === undefined ? e.cliffhanger : b.cliffhanger || null,
    });
    res.json({ data: present(await drama.load(p.id), e.episode_no) });
  },
);

/* -------------------------------------------------------- tie-in product */

const IMAGE_MIME = { 'image/jpeg': true, 'image/png': true, 'image/webp': true };
const MAX_PRODUCT_IMAGE = 6 * 1024 * 1024;

/** The tie-in product photo, as a data URL (the browser shrinks it first). */
router.post('/:id/product-image', validate({ params: idParam, query: epQuery, body: z.object({ image: z.string().max(10_000_000) }) }), async (req, res) => {
  const p = await own(req);
  const m = /^data:(image\/(?:jpeg|png|webp));base64,(.+)$/.exec(req.valid.body.image);
  if (!m || !IMAGE_MIME[m[1]]) throw badRequest('รองรับรูป JPG, PNG หรือ WebP');
  const buffer = Buffer.from(m[2], 'base64');
  if (!buffer.length || buffer.length > MAX_PRODUCT_IMAGE) throw badRequest('รูปใหญ่เกิน 6 MB');
  const key = drama.saveFile(buffer, m[1]);
  await db.query('UPDATE drama_projects SET product_image_key = :key WHERE id = :id', { id: p.id, key });
  if (p.product_image_key) media.removeFile(p.product_image_key);
  res.json({ data: present(await drama.load(p.id), req.valid.query.episode) });
});

router.delete('/:id/product-image', validate({ params: idParam, query: epQuery }), async (req, res) => {
  const p = await own(req);
  await db.query('UPDATE drama_projects SET product_image_key = NULL WHERE id = :id', { id: p.id });
  if (p.product_image_key) media.removeFile(p.product_image_key);
  res.json({ data: present(await drama.load(p.id), req.valid.query.episode) });
});

router.get('/:id/subtitles.srt', validate({ params: idParam, query: epQuery }), async (req, res) => {
  const p = await own(req);
  const ep = req.valid.query.episode ?? 1;
  const e = drama.episodeOf(p, ep);
  if (!e?.subtitle_srt) throw notFound('ยังไม่มีคำบรรยาย');
  res.type('application/x-subrip').attachment(p.episodes_total > 1 ? `drama-${p.id}-ep${ep}.srt` : `drama-${p.id}.srt`).send(e.subtitle_srt);
});

router.delete('/:id', validate({ params: idParam }), async (req, res) => {
  const p = await own(req);
  const keys = [p.cover_key, p.output_key, p.product_image_key, ...p.episodes.map((e) => e.output_key), ...p.characters.map((c) => c.portrait_key), ...p.shots.flatMap((s) => [s.image_key, s.clip_key, ...s.audio.map((a) => a.key)])];
  await db.query('DELETE FROM drama_projects WHERE id = :id', { id: p.id });
  for (const k of keys.filter(Boolean)) media.removeFile(k);
  audit(req, 'drama.delete', 'drama_project', p.id, {});
  res.json({ data: { ok: true } });
});

module.exports = { router, present };
