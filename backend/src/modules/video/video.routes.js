'use strict';

const express = require('express');
const { z } = require('zod');
const db = require('../../db/pool');
const { validate } = require('../../core/http');
const { authenticate, requirePermission } = require('../../core/auth');
const { audit } = require('../../core/audit');
const { notFound, badRequest, conflict } = require('../../core/errors');
const { enqueue } = require('../../jobs/queue');
const ai = require('../../integrations/ai');
const minimaxMedia = require('../../integrations/minimax-media');
const elevenlabs = require('../../integrations/elevenlabs');
const shotstack = require('../../integrations/shotstack');
const r2 = require('../../integrations/r2');
const { generateScript, productFacts, normalizeScene, TONES } = require('./script');
const { VOICE_PROVIDERS } = require('./pipeline');

const router = express.Router();
router.use(authenticate, requirePermission('video:create'));

const idParam = z.object({ id: z.coerce.number().int().positive() });
const parseJson = (v) => (v == null ? null : typeof v === 'string' ? JSON.parse(v) : v);
const IN_PROGRESS = ['scripting', 'voicing', 'generating_clips', 'rendering_avatar', 'compositing'];

const missing = (adapter) => adapter.meta.env.filter((e) => !e.optional && !process.env[e.name]).map((e) => e.name);

/** What can run right now, so the UI can explain before anyone spends money. */
function capabilities() {
  return {
    script: { configured: ai.isConfigured(), provider: ai.providerId() },
    voice: {
      minimax: { configured: minimaxMedia.isConfigured(), missing: missing(minimaxMedia), defaultVoiceId: process.env.MINIMAX_VOICE_ID || null },
      elevenlabs: { configured: elevenlabs.isConfigured() && r2.isConfigured(), missing: [...missing(elevenlabs), ...missing(r2)], defaultVoiceId: process.env.ELEVENLABS_VOICE_ID || null },
    },
    clips: { configured: minimaxMedia.isConfigured(), missing: missing(minimaxMedia), model: process.env.MINIMAX_VIDEO_MODEL || 'MiniMax-Hailuo-2.3' },
    compose: { configured: shotstack.isConfigured(), missing: missing(shotstack), env: process.env.SHOTSTACK_ENV || 'stage' },
    storage: { configured: r2.isConfigured(), missing: missing(r2) },
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
  res.json({ data: { capabilities: capabilities(), tones: TONES, voiceProviders: Object.keys(VOICE_PROVIDERS) } });
});

router.get(
  '/',
  validate({ query: z.object({ status: z.enum(['all', 'in_progress', 'ready', 'draft']).default('all') }) }),
  async (req, res) => {
    const f = { all: '1=1', in_progress: `v.status IN (${IN_PROGRESS.map((s) => `'${s}'`).join(',')})`, ready: "v.status IN ('ready','parts_ready')", draft: "v.status IN ('draft','script_ready','failed')" }[req.valid.query.status];
    const rows = await db.query(
      `SELECT v.id, v.title, v.product_id, v.trending_product_id, v.brief, v.script_json, v.post_caption, v.hashtags, v.voice_provider, v.voice_id,
              v.visual_mode, v.status, v.stage_detail, v.error, v.output_url, v.duration_sec, v.subtitle_srt IS NOT NULL AS has_srt,
              v.created_at, v.updated_at, pr.name AS product_name, COALESCE(pr.image_url, t.image_url) AS product_image
         FROM video_projects v LEFT JOIN products pr ON pr.id = v.product_id LEFT JOIN trending_products t ON t.id = v.trending_product_id
        WHERE v.org_id = :orgId AND ${f} ORDER BY v.updated_at DESC, v.id DESC LIMIT 100`,
      { orgId: req.user.orgId },
    );
    res.json({ data: rows.map(mapProject) });
  },
);

router.get('/:id', validate({ params: idParam }), async (req, res) => {
  const v = await getProject(req.user.orgId, req.valid.params.id);
  const assets = await db.query(
    'SELECT id, kind, scene_index, provider, status, duration_ms, external_url, error, created_at FROM video_assets WHERE video_project_id = :id ORDER BY kind, scene_index, id',
    { id: v.id },
  );
  res.json({
    data: {
      ...mapProject(v),
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
  lengthSec: z.coerce.number().int().refine((n) => [15, 30, 45, 60].includes(n), 'ความยาว 15/30/45/60 วินาที').default(30),
  audience: z.string().trim().max(200).optional(),
  notes: z.string().trim().max(1000).optional(),
});

async function writeScript(project, brief, orgId) {
  const facts = await productFacts(orgId, { productId: project.product_id, trendId: project.trending_product_id });
  if (!facts) throw badRequest('ไม่พบสินค้าของโปรเจกต์นี้');
  await db.query("UPDATE video_projects SET status = 'scripting', stage_detail = 'AI กำลังเขียนสคริปต์', error = NULL WHERE id = :id", { id: project.id });
  try {
    const s = await generateScript({ facts: facts.facts, brief });
    await db.query("DELETE FROM video_assets WHERE video_project_id = :id", { id: project.id });
    await db.query(
      `UPDATE video_projects SET status = 'script_ready', stage_detail = NULL, script_json = :json, script = :plain, post_caption = :caption,
              hashtags = :tags, title = IF(:keepTitle, title, :title), output_url = NULL, subtitle_srt = NULL WHERE id = :id`,
      {
        id: project.id,
        json: JSON.stringify({ scenes: s.scenes, model: s.model, provider: s.provider }),
        plain: s.scenes.map((sc) => sc.voiceover).join('\n'),
        caption: s.postCaption,
        tags: s.hashtags.join(' ').slice(0, 500),
        keepTitle: Boolean(project.title_locked),
        title: s.title || facts.name,
      },
    );
  } catch (err) {
    await db.query("UPDATE video_projects SET status = 'draft', stage_detail = NULL, error = :e WHERE id = :id", { id: project.id, e: String(err.message).slice(0, 2000) });
    throw err;
  }
}

router.post(
  '/',
  validate({
    body: briefSchema.extend({
      productId: z.number().int().positive().optional(),
      trendId: z.number().int().positive().optional(),
      title: z.string().trim().max(200).optional(),
      visualMode: z.enum(['ai_clips', 'product_images']).default('product_images'),
      voiceProvider: z.enum(['minimax', 'elevenlabs']).default('minimax'),
      voiceId: z.string().trim().max(100).optional(),
    }).refine((b) => Boolean(b.productId) !== Boolean(b.trendId), 'เลือกสินค้าหรือสินค้าเทรนด์อย่างใดอย่างหนึ่ง'),
  }),
  async (req, res) => {
    const b = req.valid.body;
    ai.requireConfig(); // fail before creating a project when the script can't be written
    const facts = await productFacts(req.user.orgId, { productId: b.productId, trendId: b.trendId });
    if (!facts) throw notFound('ไม่พบสินค้า');
    const brief = { tone: b.tone, lengthSec: b.lengthSec, audience: b.audience, notes: b.notes };
    const r = await db.query(
      `INSERT INTO video_projects (org_id, product_id, trending_product_id, title, brief, voice_provider, voice_id, visual_mode, status, created_by)
       VALUES (:orgId, :productId, :trendId, :title, :brief, :voiceProvider, :voiceId, :visualMode, 'draft', :userId)`,
      {
        orgId: req.user.orgId,
        productId: b.productId ?? null,
        trendId: b.trendId ?? null,
        title: b.title || facts.name.slice(0, 200),
        brief: JSON.stringify(brief),
        voiceProvider: b.voiceProvider,
        voiceId: b.voiceId || null,
        visualMode: b.visualMode,
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
      visualMode: z.enum(['ai_clips', 'product_images']),
      voiceProvider: z.enum(['minimax', 'elevenlabs']),
      voiceId: z.string().trim().max(100).nullable(),
    }),
  }),
  async (req, res) => {
    const v = await getProject(req.user.orgId, req.valid.params.id);
    if (IN_PROGRESS.includes(v.status)) throw conflict('โปรเจกต์นี้กำลังประมวลผลอยู่');
    const b = req.valid.body;
    const scenes = b.scenes.map(normalizeScene);
    const old = parseJson(v.script_json);
    const scriptChanged = JSON.stringify(old?.scenes ?? []) !== JSON.stringify(scenes);
    const voiceChanged = (v.voice_provider ?? 'minimax') !== b.voiceProvider || (v.voice_id ?? null) !== (b.voiceId || null);
    if (scriptChanged) await db.query('DELETE FROM video_assets WHERE video_project_id = :id', { id: v.id });
    else if (voiceChanged) await db.query("DELETE FROM video_assets WHERE video_project_id = :id AND kind IN ('voice','final')", { id: v.id });
    const reset = scriptChanged || voiceChanged || v.visual_mode !== b.visualMode;
    await db.query(
      `UPDATE video_projects SET title = :title, script_json = :json, script = :plain, post_caption = :caption, hashtags = :tags,
              visual_mode = :visualMode, voice_provider = :voiceProvider, voice_id = :voiceId,
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
  await db.query('DELETE FROM video_projects WHERE id = :id', { id: v.id });
  audit(req, 'video.delete', 'video_project', v.id);
  res.json({ data: { ok: true } });
});

module.exports = { router, capabilities };
