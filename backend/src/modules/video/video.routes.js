'use strict';

const express = require('express');
const { z } = require('zod');
const db = require('../../db/pool');
const { validate } = require('../../core/http');
const { authenticate, requirePermission } = require('../../core/auth');
const { audit } = require('../../core/audit');
const { AppError, notFound, badRequest, conflict } = require('../../core/errors');
const { enqueue, queueHealth } = require('../../jobs/queue');
const ai = require('../../integrations/ai');
const minimaxMedia = require('../../integrations/minimax-media');
const elevenlabs = require('../../integrations/elevenlabs');
const shotstack = require('../../integrations/shotstack');
const r2 = require('../../integrations/r2');
const { generateScript, productFacts, normalizeScene, TONES, ANGLES } = require('./script');
const media = require('./media');
const env = require('../../config/env');
const { VOICE_PROVIDERS } = require('./pipeline');
const runtime = require('../../config/runtime');
const { singleFile } = require('../../utils/multipart');

const router = express.Router();
router.use(authenticate, requirePermission('video:create'));

const idParam = z.object({ id: z.coerce.number().int().positive() });
const parseJson = (v) => (v == null ? null : typeof v === 'string' ? JSON.parse(v) : v);
const IN_PROGRESS = ['scripting', 'voicing', 'generating_clips', 'rendering_avatar', 'compositing'];

/** What can run right now, so the UI can explain before anyone spends money. */
function capabilities() {
  return {
    script: { configured: ai.isConfigured(), provider: ai.providerId() },
    voice: {
      minimax: { configured: minimaxMedia.isConfigured(), missing: minimaxMedia.missing(), defaultVoiceId: runtime.get('MINIMAX_VOICE_ID') || null },
      elevenlabs: {
        configured: elevenlabs.isConfigured() && r2.isConfigured(),
        missing: [...elevenlabs.missing(), ...r2.missing()],
        defaultVoiceId: runtime.get('ELEVENLABS_VOICE_ID') || null,
      },
    },
    clips: { configured: minimaxMedia.isConfigured(), missing: minimaxMedia.missing(), model: runtime.get('MINIMAX_VIDEO_MODEL') || 'MiniMax-Hailuo-2.3' },
    compose: { configured: shotstack.isConfigured(), missing: shotstack.missing(), env: runtime.get('SHOTSTACK_ENV') || 'stage' },
    storage: { configured: r2.isConfigured(), missing: r2.missing() },
    // Own footage and cover intro are fetched by the renderer from this server
    publicMedia: { configured: Boolean(env.PUBLIC_API_URL), missing: env.PUBLIC_API_URL ? [] : ['PUBLIC_API_URL'] },
  };
}

function mapProject(v) {
  const script = parseJson(v.script_json);
  return {
    id: v.id,
    title: v.title,
    productId: v.product_id,
    productName: v.product_name ?? null,
    trendId: v.trending_product_id,
    imageUrl: v.product_image ?? null,
    brief: parseJson(v.brief) ?? {},
    scenes: script?.scenes ?? [],
    postCaption: v.post_caption,
    hashtags: v.hashtags,
    voiceProvider: v.voice_provider ?? 'minimax',
    voiceId: v.voice_id,
    visualMode: v.visual_mode,
    captionStyle: v.caption_style ?? 'pop',
    coverId: v.cover_id ?? null,
    hooks: script?.hooks ?? [],
    status: v.status,
    stageDetail: v.stage_detail,
    error: v.error,
    outputUrl: v.output_url,
    durationSec: v.duration_sec,
    hasSubtitles: Boolean(v.subtitle_srt) || Boolean(v.has_srt),
    createdAt: v.created_at,
    updatedAt: v.updated_at,
  };
}

const SELECT = `SELECT v.*, pr.name AS product_name, COALESCE(pr.image_url, t.image_url) AS product_image
  FROM video_projects v LEFT JOIN products pr ON pr.id = v.product_id LEFT JOIN trending_products t ON t.id = v.trending_product_id`;

async function getProject(orgId, id) {
  const v = await db.one(`${SELECT} WHERE v.id = :id AND v.org_id = :orgId`, { id, orgId });
  if (!v) throw notFound('ไม่พบโปรเจกต์วิดีโอ');
  return v;
}

router.get('/meta', (req, res) => {
  res.json({ data: { capabilities: capabilities(), tones: TONES, angles: ANGLES, voiceProviders: Object.keys(VOICE_PROVIDERS) } });
});

// get_voice is slow-ish and the list rarely changes; keyed by the API key so a new key refetches
const VOICE_TTL_MS = 10 * 60_000;
let voiceCache = null;

router.get('/voices', validate({ query: z.object({ provider: z.enum(['minimax']).default('minimax') }) }), async (req, res) => {
  const { MINIMAX_API_KEY: key } = minimaxMedia.requireConfig();
  if (!voiceCache || voiceCache.key !== key || Date.now() - voiceCache.at > VOICE_TTL_MS) {
    voiceCache = { key, at: Date.now(), data: await minimaxMedia.listVoices() };
  }
  res.json({ data: voiceCache.data });
});

const mapMedia = (m) => ({
  id: m.id,
  kind: m.kind,
  mime: m.mime,
  sizeBytes: Number(m.size_bytes),
  durationMs: m.duration_ms,
  label: m.label,
  sortOrder: m.sort_order,
  url: `/api/videos/${m.video_project_id}/media/${m.id}/file`,
});
const listMedia = (projectId) => db.query('SELECT * FROM video_media WHERE video_project_id = :id ORDER BY sort_order, id', { id: projectId });

router.get('/', validate({ query: z.object({ status: z.enum(['all', 'in_progress', 'ready', 'draft']).default('all') }) }), async (req, res) => {
  const f = {
    all: '1=1',
    in_progress: `v.status IN (${IN_PROGRESS.map((s) => `'${s}'`).join(',')})`,
    ready: "v.status IN ('ready','parts_ready')",
    draft: "v.status IN ('draft','script_ready','failed')",
  }[req.valid.query.status];
  const rows = await db.query(
    `SELECT v.id, v.title, v.product_id, v.trending_product_id, v.brief, v.script_json, v.post_caption, v.hashtags, v.voice_provider, v.voice_id,
              v.visual_mode, v.caption_style, v.cover_id, v.status, v.stage_detail, v.error, v.output_url, v.duration_sec, v.subtitle_srt IS NOT NULL AS has_srt,
              v.created_at, v.updated_at, pr.name AS product_name, COALESCE(pr.image_url, t.image_url) AS product_image
         FROM video_projects v LEFT JOIN products pr ON pr.id = v.product_id LEFT JOIN trending_products t ON t.id = v.trending_product_id
        WHERE v.org_id = :orgId AND ${f} ORDER BY v.updated_at DESC, v.id DESC LIMIT 100`,
    { orgId: req.user.orgId },
  );
  res.json({ data: rows.map(mapProject) });
});

router.get('/:id', validate({ params: idParam }), async (req, res) => {
  const v = await getProject(req.user.orgId, req.valid.params.id);
  const assets = await db.query(
    'SELECT id, kind, scene_index, provider, status, duration_ms, external_url, error, created_at FROM video_assets WHERE video_project_id = :id ORDER BY kind, scene_index, id',
    { id: v.id },
  );
  const mediaRows = await listMedia(v.id);
  res.json({
    data: {
      ...mapProject(v),
      media: mediaRows.map(mapMedia),
      // Lets the page say "the background worker is not running" instead of waiting forever
      queue: IN_PROGRESS.includes(v.status) ? await queueHealth() : null,
      assets: assets.map((a) => ({
        id: a.id,
        kind: a.kind,
        sceneIndex: a.scene_index,
        provider: a.provider,
        status: a.status,
        durationMs: a.duration_ms,
        url: a.external_url,
        error: a.error,
      })),
    },
  });
});

/* ---------------------------------------------------------- create + script */

const briefSchema = z.object({
  tone: z.enum(Object.keys(TONES)).default('friendly'),
  angle: z.enum(Object.keys(ANGLES)).default('auto'),
  lengthSec: z.coerce
    .number()
    .int()
    .refine((n) => [15, 30, 45, 60].includes(n), 'ความยาว 15/30/45/60 วินาที')
    .default(30),
  audience: z.string().trim().max(200).optional(),
  notes: z.string().trim().max(1000).optional(),
});

async function writeScript(project, brief, orgId) {
  const facts = await productFacts(orgId, { productId: project.product_id, trendId: project.trending_product_id });
  if (!facts) throw badRequest('ไม่พบสินค้าของโปรเจกต์นี้');
  await db.query("UPDATE video_projects SET status = 'scripting', stage_detail = 'AI กำลังเขียนสคริปต์', error = NULL WHERE id = :id", { id: project.id });
  try {
    const footage = await listMedia(project.id);
    const s = await generateScript({ facts: facts.facts, brief, footage });
    await db.query('DELETE FROM video_assets WHERE video_project_id = :id', { id: project.id });
    await db.query(
      `UPDATE video_projects SET status = 'script_ready', stage_detail = NULL, script_json = :json, script = :plain, post_caption = :caption,
              hashtags = :tags, title = IF(:keepTitle, title, :title), output_url = NULL, subtitle_srt = NULL WHERE id = :id`,
      {
        id: project.id,
        json: JSON.stringify({ scenes: s.scenes, hooks: s.hooks, model: s.model, provider: s.provider }),
        plain: s.scenes.map((sc) => sc.voiceover).join('\n'),
        caption: s.postCaption,
        tags: s.hashtags.join(' ').slice(0, 500),
        keepTitle: Boolean(project.title_locked),
        title: s.title || facts.name,
      },
    );
  } catch (err) {
    await db.query("UPDATE video_projects SET status = 'draft', stage_detail = NULL, error = :e WHERE id = :id", {
      id: project.id,
      e: String(err.message).slice(0, 2000),
    });
    throw err;
  }
}

router.post(
  '/',
  validate({
    body: briefSchema
      .extend({
        productId: z.number().int().positive().optional(),
        trendId: z.number().int().positive().optional(),
        title: z.string().trim().max(200).optional(),
        visualMode: z.enum(['ai_clips', 'product_images', 'my_footage']).default('product_images'),
        captionStyle: z.enum(['pop', 'clean', 'none']).default('pop'),
        voiceProvider: z.enum(['minimax', 'elevenlabs']).default('minimax'),
        voiceId: z.string().trim().max(100).optional(),
      })
      .refine((b) => Boolean(b.productId) !== Boolean(b.trendId), 'เลือกสินค้าหรือสินค้าเทรนด์อย่างใดอย่างหนึ่ง'),
  }),
  async (req, res) => {
    const b = req.valid.body;
    ai.requireConfig(); // fail before creating a project when the script can't be written
    const facts = await productFacts(req.user.orgId, { productId: b.productId, trendId: b.trendId });
    if (!facts) throw notFound('ไม่พบสินค้า');
    const brief = { tone: b.tone, angle: b.angle, lengthSec: b.lengthSec, audience: b.audience, notes: b.notes };
    const r = await db.query(
      `INSERT INTO video_projects (org_id, product_id, trending_product_id, title, brief, voice_provider, voice_id, visual_mode, caption_style, status, created_by)
       VALUES (:orgId, :productId, :trendId, :title, :brief, :voiceProvider, :voiceId, :visualMode, :captionStyle, 'draft', :userId)`,
      {
        orgId: req.user.orgId,
        productId: b.productId ?? null,
        trendId: b.trendId ?? null,
        title: b.title || facts.name.slice(0, 200),
        brief: JSON.stringify(brief),
        voiceProvider: b.voiceProvider,
        voiceId: b.voiceId || null,
        visualMode: b.visualMode,
        captionStyle: b.captionStyle,
        userId: req.user.id,
      },
    );
    audit(req, 'video.create', 'video_project', r.insertId);
    const project = { id: r.insertId, product_id: b.productId ?? null, trending_product_id: b.trendId ?? null, title_locked: Boolean(b.title) };
    try {
      await writeScript(project, brief, req.user.orgId);
    } catch (err) {
      // The project exists; the UI shows the error and a "write script again" button
      return res.status(201).json({ data: mapProject(await getProject(req.user.orgId, r.insertId)), warning: err.message });
    }
    return res.status(201).json({ data: mapProject(await getProject(req.user.orgId, r.insertId)) });
  },
);

router.post('/:id/script', validate({ params: idParam, body: briefSchema.partial().default({}) }), async (req, res) => {
  const v = await getProject(req.user.orgId, req.valid.params.id);
  if (IN_PROGRESS.includes(v.status)) throw conflict('โปรเจกต์นี้กำลังประมวลผลอยู่');
  ai.requireConfig();
  const brief = { ...(parseJson(v.brief) ?? {}), ...req.valid.body };
  await db.query('UPDATE video_projects SET brief = :brief WHERE id = :id', { id: v.id, brief: JSON.stringify(brief) });
  await writeScript({ ...v, title_locked: true }, brief, req.user.orgId);
  audit(req, 'video.script', 'video_project', v.id);
  res.json({ data: mapProject(await getProject(req.user.orgId, v.id)) });
});

const sceneSchema = z.object({
  voiceover: z.string().trim().min(1, 'บทพากย์ว่าง').max(500),
  caption: z.string().trim().max(80).default(''),
  visual: z.string().trim().max(600).default(''),
  showProduct: z.boolean().default(false),
  durationSec: z.coerce.number().int().min(2).max(10).default(4),
  media: z.number().int().min(1).max(media.MAX_FILES).nullable().optional(),
});

/** Manual edits. Any change invalidates generated media (voice must match the words). */
router.put(
  '/:id',
  validate({
    params: idParam,
    body: z.object({
      title: z.string().trim().min(1).max(200),
      scenes: z.array(sceneSchema).min(1).max(8),
      postCaption: z.string().trim().max(2000).nullable(),
      hashtags: z.string().trim().max(500).nullable(),
      visualMode: z.enum(['ai_clips', 'product_images', 'my_footage']),
      captionStyle: z.enum(['pop', 'clean', 'none']).optional(),
      coverId: z.number().int().positive().nullable().optional(),
      voiceProvider: z.enum(['minimax', 'elevenlabs']),
      voiceId: z.string().trim().max(100).nullable(),
    }),
  }),
  async (req, res) => {
    const v = await getProject(req.user.orgId, req.valid.params.id);
    if (IN_PROGRESS.includes(v.status)) throw conflict('โปรเจกต์นี้กำลังประมวลผลอยู่');
    const b = req.valid.body;
    const mediaCount = (await listMedia(v.id)).length;
    const scenes = b.scenes.map((sc) => normalizeScene(sc, mediaCount));
    const old = parseJson(v.script_json);
    if (b.coverId) {
      const cover = await db.one("SELECT id FROM cover_projects WHERE id = :id AND org_id = :orgId AND status = 'ready'", {
        id: b.coverId,
        orgId: req.user.orgId,
      });
      if (!cover) throw badRequest('ไม่พบปกคลิปที่เลือก');
    }
    const captionStyle = b.captionStyle ?? v.caption_style ?? 'pop';
    const coverId = b.coverId === undefined ? v.cover_id : b.coverId;
    const looksChanged = captionStyle !== (v.caption_style ?? 'pop') || (coverId ?? null) !== (v.cover_id ?? null);
    const scriptChanged = JSON.stringify(old?.scenes ?? []) !== JSON.stringify(scenes);
    const voiceChanged = (v.voice_provider ?? 'minimax') !== b.voiceProvider || (v.voice_id ?? null) !== (b.voiceId || null);
    if (scriptChanged) await db.query('DELETE FROM video_assets WHERE video_project_id = :id', { id: v.id });
    else if (voiceChanged) await db.query("DELETE FROM video_assets WHERE video_project_id = :id AND kind IN ('voice','final')", { id: v.id });
    const reset = scriptChanged || voiceChanged || looksChanged || v.visual_mode !== b.visualMode;
    await db.query(
      `UPDATE video_projects SET title = :title, script_json = :json, script = :plain, post_caption = :caption, hashtags = :tags,
              visual_mode = :visualMode, caption_style = :captionStyle, cover_id = :coverId, voice_provider = :voiceProvider, voice_id = :voiceId,
              status = IF(:reset, 'script_ready', status), output_url = IF(:reset, NULL, output_url), error = IF(:reset, NULL, error)
        WHERE id = :id`,
      {
        id: v.id,
        title: b.title,
        json: JSON.stringify({ ...(old ?? {}), scenes }),
        plain: scenes.map((s) => s.voiceover).join('\n'),
        caption: b.postCaption,
        tags: b.hashtags,
        visualMode: b.visualMode,
        captionStyle,
        coverId: coverId ?? null,
        voiceProvider: b.voiceProvider,
        voiceId: b.voiceId || null,
        reset,
      },
    );
    audit(req, 'video.update', 'video_project', v.id, { scriptChanged });
    res.json({ data: mapProject(await getProject(req.user.orgId, v.id)) });
  },
);

/* ------------------------------------------------------------- generation */

/** Rough cost drivers shown before generating (provider prices change; see their pricing pages). */
function estimate(v, scenes) {
  const chars = scenes.reduce((n, s) => n + s.voiceover.length, 0);
  return {
    scenes: scenes.length,
    voiceCharacters: chars,
    aiClips: v.visual_mode === 'ai_clips' ? scenes.length : 0,
    estimatedSeconds: scenes.reduce((n, s) => n + s.durationSec, 0),
  };
}

router.post('/:id/generate', validate({ params: idParam }), async (req, res) => {
  const v = await getProject(req.user.orgId, req.valid.params.id);
  const scenes = parseJson(v.script_json)?.scenes ?? [];
  if (!scenes.length) throw badRequest('ยังไม่มีสคริปต์');
  if (IN_PROGRESS.includes(v.status)) throw conflict('โปรเจกต์นี้กำลังประมวลผลอยู่');
  const provider = v.voice_provider ?? 'minimax';
  if (provider === 'elevenlabs') {
    elevenlabs.requireConfig();
    r2.requireConfig(); // ElevenLabs returns raw audio that must be hosted for the renderer
  } else minimaxMedia.requireConfig();
  if (v.visual_mode === 'ai_clips') minimaxMedia.requireConfig();
  if (v.visual_mode === 'my_footage') {
    if (!(await listMedia(v.id)).length) throw badRequest('ยังไม่ได้อัปโหลดฟุตเทจ — เพิ่มคลิปหรือรูปที่ถ่ายเองก่อน');
    if (!env.PUBLIC_API_URL) throw badRequest('ต้องตั้ง PUBLIC_API_URL (โดเมน HTTPS ของ backend) ก่อน เพื่อให้ระบบตัดต่อดึงฟุตเทจได้');
  }
  await db.query("UPDATE video_projects SET status = 'voicing', stage_detail = 'เข้าคิวแล้ว', error = NULL, output_url = NULL WHERE id = :id", { id: v.id });
  await enqueue('video.voice', { projectId: v.id }, { orgId: req.user.orgId, maxAttempts: 1 });
  audit(req, 'video.generate', 'video_project', v.id, estimate(v, scenes));
  res.status(202).json({ data: { status: 'voicing', estimate: estimate(v, scenes) } });
});

router.get('/:id/subtitles.srt', validate({ params: idParam }), async (req, res) => {
  const v = await getProject(req.user.orgId, req.valid.params.id);
  if (!v.subtitle_srt) throw notFound('ยังไม่มีไฟล์ซับ (สร้างวิดีโอก่อน)');
  res.set('Content-Type', 'application/x-subrip; charset=utf-8');
  res.set('Content-Disposition', `attachment; filename="video-${v.id}.srt"`);
  res.send(`\uFEFF${v.subtitle_srt}`);
});

router.delete('/:id', validate({ params: idParam }), async (req, res) => {
  const v = await getProject(req.user.orgId, req.valid.params.id);
  if (IN_PROGRESS.includes(v.status)) throw conflict('โปรเจกต์นี้กำลังประมวลผลอยู่');
  const used = await db.one("SELECT COUNT(*) AS n FROM scheduled_posts WHERE video_project_id = :id AND status IN ('scheduled','publishing')", { id: v.id });
  if (Number(used.n)) throw conflict('วิดีโอนี้มีโพสต์ที่ตั้งเวลาไว้ ยกเลิกโพสต์ก่อน');
  const keys = (await listMedia(v.id)).map((m) => m.storage_key);
  await db.query('DELETE FROM video_projects WHERE id = :id', { id: v.id });
  await removeUnusedFiles(keys);
  audit(req, 'video.delete', 'video_project', v.id);
  res.json({ data: { ok: true } });
});

/* ------------------------------------------------------------ own footage */

/** Delete files no other project still points at (variants share footage). */
async function removeUnusedFiles(keys) {
  for (const key of new Set(keys)) {
    const used = await db.one('SELECT id FROM video_media WHERE storage_key = :key LIMIT 1', { key });
    if (!used) media.removeFile(key);
  }
}

const mediaParam = idParam.extend({ mediaId: z.coerce.number().int().positive() });
const rawUpload = express.raw({ type: Object.keys(media.TYPES), limit: media.MAX_VIDEO_BYTES });
const formUpload = singleFile('file', media.MAX_VIDEO_BYTES);

const durationMs = z.coerce
  .number()
  .int()
  .min(0)
  .max(30 * 60 * 1000)
  .optional();

/** Checks shared by every upload path: project editable, type supported, size and file count limits. */
async function checkUpload(req, projectId, mime, size) {
  const v = await getProject(req.user.orgId, projectId);
  if (IN_PROGRESS.includes(v.status)) throw conflict('โปรเจกต์นี้กำลังประมวลผลอยู่');
  const type = media.TYPES[mime];
  if (!type || !size) throw badRequest('รองรับคลิป MP4/MOV/WebM และรูป JPEG/PNG/WebP');
  if (type.kind === 'image' && size > media.MAX_IMAGE_BYTES) throw badRequest('รูปใหญ่เกิน 10 MB');
  if (size > media.MAX_VIDEO_BYTES) throw badRequest(`ไฟล์ใหญ่เกิน ${media.MAX_VIDEO_BYTES / 1024 / 1024} MB`);
  const count = await db.one('SELECT COUNT(*) AS n, COALESCE(MAX(sort_order), 0) AS maxSort FROM video_media WHERE video_project_id = :id', { id: v.id });
  if (Number(count.n) >= media.MAX_FILES) throw badRequest(`อัปโหลดได้สูงสุด ${media.MAX_FILES} ไฟล์ต่อโปรเจกต์`);
  return { v, type, maxSort: Number(count.maxSort) };
}

/** Store a complete file as project footage. */
async function addMedia(req, projectId, file, mime, { label, durationMs: duration }) {
  const { v, type, maxSort } = await checkUpload(req, projectId, mime, file.length);
  const key = media.saveFile(file, mime);
  const r = await db.query(
    `INSERT INTO video_media (video_project_id, kind, mime, storage_key, size_bytes, duration_ms, label, sort_order)
     VALUES (:id, :kind, :mime, :key, :size, :duration, :label, :sort)`,
    {
      id: v.id,
      kind: type.kind,
      mime,
      key,
      size: file.length,
      duration: type.kind === 'video' ? (duration ?? null) : null,
      label: label || null,
      sort: maxSort + 1,
    },
  );
  // New footage changes what the renderer will use
  await db.query(
    "UPDATE video_projects SET output_url = NULL, status = IF(status IN ('ready','parts_ready','failed'), 'script_ready', status) WHERE id = :id AND script_json IS NOT NULL",
    { id: v.id },
  );
  audit(req, 'video.media.upload', 'video_project', v.id, { kind: type.kind, size: file.length });
  return mapMedia(await db.one('SELECT * FROM video_media WHERE id = :id', { id: r.insertId }));
}

/**
 * Upload one clip/photo in a single request: multipart/form-data (field "file") or a raw body
 * with Content-Type = file type. ?label=…&durationMs=… The web app uses the chunked upload below,
 * which works where the hosting stack drops large request bodies.
 */
router.post(
  '/:id/media',
  formUpload,
  rawUpload,
  validate({
    params: idParam,
    query: z.object({ label: z.string().trim().max(100).optional(), size: z.coerce.number().int().min(0).optional(), durationMs }),
  }),
  async (req, res) => {
    const mime =
      req.upload?.mime ??
      String(req.headers['content-type'] ?? '')
        .split(';')[0]
        .trim()
        .toLowerCase();
    const file = req.upload?.buffer ?? req.body;
    if (!Buffer.isBuffer(file)) throw badRequest('รองรับคลิป MP4/MOV/WebM และรูป JPEG/PNG/WebP');
    res.status(201).json({ data: await addMedia(req, req.valid.params.id, file, mime, req.valid.query) });
  },
);

/* -------------------------------------------------------- chunked upload */

const uploadParam = idParam.extend({ uploadId: z.string().regex(/^[0-9a-f]{32}$/) });

/** The upload must belong to this user's org and this project. */
async function getUpload(req) {
  await getProject(req.user.orgId, req.valid.params.id);
  const u = media.readUpload(req.valid.params.uploadId);
  if (!u || u.orgId !== req.user.orgId || u.projectId !== req.valid.params.id) throw notFound('ไม่พบการอัปโหลดนี้ (อาจหมดอายุ) กรุณาอัปโหลดใหม่');
  return u;
}

/** Start: declare the file; returns uploadId and the chunk size to send. */
router.post(
  '/:id/media/uploads',
  validate({
    params: idParam,
    body: z.object({
      mime: z.string().max(50),
      size: z.number().int().positive(),
      label: z.string().trim().max(100).optional(),
      durationMs,
    }),
  }),
  async (req, res) => {
    const b = req.valid.body;
    const mime = b.mime.toLowerCase();
    await checkUpload(req, req.valid.params.id, mime, b.size);
    const uploadId = media.startUpload({
      orgId: req.user.orgId,
      projectId: req.valid.params.id,
      userId: req.user.id,
      mime,
      size: b.size,
      label: b.label ?? null,
      durationMs: b.durationMs ?? null,
    });
    res.status(201).json({ data: { uploadId, chunkSize: media.CHUNK_BYTES } });
  },
);

/** Append one base64 chunk at `offset`; resending a stored chunk is harmless. */
router.put(
  '/:id/media/uploads/:uploadId',
  validate({
    params: uploadParam,
    body: z.object({ offset: z.number().int().min(0), data: z.string().max(Math.ceil((media.MAX_CHUNK_BYTES * 4) / 3) + 4) }),
  }),
  async (req, res) => {
    const u = await getUpload(req);
    const bytes = Buffer.from(req.valid.body.data, 'base64');
    if (!bytes.length) throw badRequest('ข้อมูลว่าง');
    try {
      const received = media.appendChunk(u, req.valid.body.offset, bytes);
      res.json({ data: { received, size: u.size } });
    } catch (err) {
      if (err.code === 'BAD_OFFSET') throw new AppError(409, 'BAD_OFFSET', `ลำดับข้อมูลไม่ตรง (เซิร์ฟเวอร์มี ${err.received} ไบต์)`, { received: err.received });
      if (err.code === 'TOO_LARGE') throw badRequest('ข้อมูลเกินขนาดไฟล์ที่แจ้งไว้');
      throw err;
    }
  },
);

/** Finish: all bytes received -> saved as footage like a single-request upload. */
router.post('/:id/media/uploads/:uploadId/complete', validate({ params: uploadParam }), async (req, res) => {
  const u = await getUpload(req);
  if (u.received !== u.size) throw badRequest(`ไฟล์ยังมาไม่ครบ (${u.received.toLocaleString('en-US')} จาก ${u.size.toLocaleString('en-US')} ไบต์)`);
  const file = media.readUploadedFile(u);
  try {
    res.status(201).json({ data: await addMedia(req, u.projectId, file, u.mime, { label: u.label, durationMs: u.durationMs ?? undefined }) });
  } finally {
    media.dropUpload(u);
  }
});

router.get('/:id/media/:mediaId/file', validate({ params: mediaParam }), async (req, res) => {
  const v = await getProject(req.user.orgId, req.valid.params.id);
  const m = await db.one('SELECT * FROM video_media WHERE id = :mid AND video_project_id = :id', { mid: req.valid.params.mediaId, id: v.id });
  const p = m && media.filePath(m.storage_key);
  if (!p) throw notFound('ไม่พบไฟล์');
  res.set('Cache-Control', 'private, max-age=3600');
  res.type(m.mime).sendFile(p, (err) => {
    if (err && !res.headersSent) res.status(404).end();
  });
});

router.patch(
  '/:id/media/:mediaId',
  validate({
    params: mediaParam,
    body: z.object({ label: z.string().trim().max(100).nullable().optional(), sortOrder: z.number().int().min(0).max(1000).optional() }).strict(),
  }),
  async (req, res) => {
    const v = await getProject(req.user.orgId, req.valid.params.id);
    const m = await db.one('SELECT * FROM video_media WHERE id = :mid AND video_project_id = :id', { mid: req.valid.params.mediaId, id: v.id });
    if (!m) throw notFound('ไม่พบไฟล์');
    const b = req.valid.body;
    await db.query('UPDATE video_media SET label = IF(:labelSet, :label, label), sort_order = COALESCE(:sort, sort_order) WHERE id = :mid', {
      mid: m.id,
      labelSet: b.label !== undefined,
      label: b.label || null,
      sort: b.sortOrder ?? null,
    });
    res.json({ data: mapMedia(await db.one('SELECT * FROM video_media WHERE id = :mid', { mid: m.id })) });
  },
);

router.delete('/:id/media/:mediaId', validate({ params: mediaParam }), async (req, res) => {
  const v = await getProject(req.user.orgId, req.valid.params.id);
  if (IN_PROGRESS.includes(v.status)) throw conflict('โปรเจกต์นี้กำลังประมวลผลอยู่');
  const m = await db.one('SELECT * FROM video_media WHERE id = :mid AND video_project_id = :id', { mid: req.valid.params.mediaId, id: v.id });
  if (!m) throw notFound('ไม่พบไฟล์');
  await db.query('DELETE FROM video_media WHERE id = :mid', { mid: m.id });
  await removeUnusedFiles([m.storage_key]);
  // Scene footage numbers shift after a delete; drop references beyond the new count
  const left = (await listMedia(v.id)).length;
  const script = parseJson(v.script_json);
  if (script?.scenes) {
    const scenes = script.scenes.map((sc) => ({ ...sc, media: sc.media && sc.media <= left ? sc.media : null }));
    await db.query('UPDATE video_projects SET script_json = :json WHERE id = :id', { id: v.id, json: JSON.stringify({ ...script, scenes }) });
  }
  res.json({ data: { ok: true } });
});

/* ---------------------------------------------------------- hook variants */

function withHook(script, index) {
  const hook = script?.hooks?.[index];
  if (!hook || !script.scenes?.length) throw badRequest('ไม่พบ hook ที่เลือก');
  const [first, ...rest] = script.scenes;
  return { ...script, scenes: [{ ...first, voiceover: hook.voiceover, caption: hook.caption }, ...rest] };
}

/** Use another hook as the opening scene (voice/video must be regenerated). */
router.post('/:id/hook', validate({ params: idParam, body: z.object({ index: z.number().int().min(0).max(2) }) }), async (req, res) => {
  const v = await getProject(req.user.orgId, req.valid.params.id);
  if (IN_PROGRESS.includes(v.status)) throw conflict('โปรเจกต์นี้กำลังประมวลผลอยู่');
  const script = withHook(parseJson(v.script_json), req.valid.body.index);
  await db.query('DELETE FROM video_assets WHERE video_project_id = :id', { id: v.id });
  await db.query("UPDATE video_projects SET script_json = :json, script = :plain, status = 'script_ready', output_url = NULL, error = NULL WHERE id = :id", {
    id: v.id,
    json: JSON.stringify(script),
    plain: script.scenes.map((sc) => sc.voiceover).join('\n'),
  });
  audit(req, 'video.hook', 'video_project', v.id, { index: req.valid.body.index });
  res.json({ data: mapProject(await getProject(req.user.orgId, v.id)) });
});

/** Copy the project with another hook (same footage files) to A/B test openings. */
router.post('/:id/variant', validate({ params: idParam, body: z.object({ hookIndex: z.number().int().min(0).max(2) }) }), async (req, res) => {
  const v = await getProject(req.user.orgId, req.valid.params.id);
  const script = withHook(parseJson(v.script_json), req.valid.body.hookIndex);
  const hook = script.hooks[req.valid.body.hookIndex];
  const id = await db.tx(async (conn) => {
    const [r] = await conn.query(
      `INSERT INTO video_projects (org_id, product_id, trending_product_id, title, brief, script, script_json, post_caption, hashtags,
              voice_provider, voice_id, visual_mode, caption_style, cover_id, status, created_by)
       SELECT org_id, product_id, trending_product_id, LEFT(CONCAT(title, ' · ', :angle), 255), brief, :plain, :json, post_caption, hashtags,
              voice_provider, voice_id, visual_mode, caption_style, cover_id, 'script_ready', :userId
         FROM video_projects WHERE id = :id`,
      {
        id: v.id,
        angle: hook.angle || `hook ${req.valid.body.hookIndex + 1}`,
        plain: script.scenes.map((sc) => sc.voiceover).join('\n'),
        json: JSON.stringify(script),
        userId: req.user.id,
      },
    );
    await conn.query(
      `INSERT INTO video_media (video_project_id, kind, mime, storage_key, size_bytes, duration_ms, label, sort_order)
       SELECT :newId, kind, mime, storage_key, size_bytes, duration_ms, label, sort_order FROM video_media WHERE video_project_id = :id`,
      { newId: r.insertId, id: v.id },
    );
    return r.insertId;
  });
  audit(req, 'video.variant', 'video_project', id, { from: v.id, hookIndex: req.valid.body.hookIndex });
  res.status(201).json({ data: mapProject(await getProject(req.user.orgId, id)) });
});

module.exports = { router, capabilities };
