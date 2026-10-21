'use strict';

const fs = require('node:fs');
const db = require('../../db/pool');
const logger = require('../../core/logger');
const { enqueue } = require('../../jobs/queue');
const minimaxMedia = require('../../integrations/minimax-media');
const elevenlabs = require('../../integrations/elevenlabs');
const shotstack = require('../../integrations/shotstack');
const r2 = require('../../integrations/r2');
const { sceneTimings, buildSrt, buildShotstackEdit } = require('./timeline');
const media = require('./media');

/**
 * Generation runs as a chain of queued jobs so each step fits the cron tick's time budget:
 *   (video.images …) → video.voice → (video.clips_start → video.clips_poll …) → video.compose → video.compose_poll …
 * Provider URLs expire, so finished files are copied to R2 when it is configured.
 */
const POLL_MS = 60_000;
const MAX_CLIP_POLLS = 40;
const MAX_RENDER_POLLS = 30;

const VOICE_PROVIDERS = {
  minimax: { adapter: minimaxMedia, needsR2: false, label: 'MiniMax Speech' },
  elevenlabs: { adapter: elevenlabs, needsR2: true, label: 'ElevenLabs' },
};

const parseJson = (v) => (v == null ? null : typeof v === 'string' ? JSON.parse(v) : v);

async function loadProject(id) {
  const p = await db.one(
    `SELECT v.*, COALESCE(pr.image_url, t.image_url) AS product_image
       FROM video_projects v LEFT JOIN products pr ON pr.id = v.product_id LEFT JOIN trending_products t ON t.id = v.trending_product_id
      WHERE v.id = :id`,
    { id },
  );
  if (!p) return null;
  return { ...p, scenes: parseJson(p.script_json)?.scenes ?? [] };
}

const setStage = (id, status, detail = null) =>
  db.query('UPDATE video_projects SET status = :status, stage_detail = :detail, error = NULL WHERE id = :id', { id, status, detail });

async function fail(id, err) {
  const message = String(err?.message ?? err).slice(0, 2000);
  logger.warn({ projectId: id, err: message }, 'video generation failed');
  await db.query("UPDATE video_projects SET status = 'failed', stage_detail = NULL, error = :message WHERE id = :id", { id, message });
  return { status: 'failed', error: message };
}

/** Keep a provider file: copy to R2 when configured, else keep the (expiring) provider URL. */
async function persist(url, key, type) {
  if (!r2.isConfigured()) return { url, stored: false };
  const r = await r2.copyFromUrl(url, key, type);
  return { url: r.url, stored: true };
}
const keyFor = (p, name) => `videos/${p.org_id}/${p.id}/${Date.now().toString(36)}-${name}`;

async function assets(projectId, kind) {
  return db.query('SELECT * FROM video_assets WHERE video_project_id = :id AND kind = :kind ORDER BY scene_index, id', { id: projectId, kind });
}

/** Run a step; any error marks the project failed (no automatic retry of paid generations). */
const step = (fn) => async (payload) => {
  try {
    return await fn(payload);
  } catch (err) {
    return fail(payload.projectId, err);
  }
};

/* ------------------------------------------------------------ scene images */

const mediaRows = (projectId) => db.query('SELECT * FROM video_media WHERE video_project_id = :id ORDER BY sort_order, id', { id: projectId });

/** Scenes (my_footage) that have no picture yet; the images step creates one for each. */
async function missingSceneImages(p) {
  if (p.visual_mode !== 'my_footage') return [];
  const rows = await mediaRows(p.id);
  return media
    .sceneMediaIndex(p.scenes, rows.length)
    .map((k, i) => (k === null ? i : null))
    .filter((i) => i !== null);
}

/** The product's own photo, when it can be downloaded as a supported image. */
async function productPhoto(url) {
  if (!/^https?:\/\//.test(url ?? '')) return null;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
    const mime = String(res.headers.get('content-type') || '')
      .split(';')[0]
      .trim();
    if (!res.ok || media.TYPES[mime]?.kind !== 'image') return null;
    const buffer = Buffer.from(await res.arrayBuffer());
    return buffer.length && buffer.length <= media.MAX_IMAGE_BYTES ? { buffer, mime } : null;
  } catch {
    return null;
  }
}

/**
 * One missing scene picture per run (each image takes a while), appended to the project's files so
 * it plays at that scene's position and the user can see or replace it. Product scenes use the real
 * product photo; the rest are drawn by MiniMax image-01 from the scene's visual prompt.
 */
const images = step(async ({ projectId }) => {
  const p = await loadProject(projectId);
  if (!p || p.status !== 'generating_clips' || p.visual_mode !== 'my_footage') return { status: 'skipped' };
  const missing = await missingSceneImages(p);
  if (!missing.length) {
    await setStage(p.id, 'voicing', 'เข้าคิวสร้างเสียงพากย์');
    await enqueue('video.voice', { projectId: p.id }, { orgId: p.org_id, maxAttempts: 1 });
    return { status: 'ok' };
  }
  const i = missing[0];
  const scene = p.scenes[i];
  await db.query('UPDATE video_projects SET stage_detail = :d WHERE id = :id', {
    id: p.id,
    d: `กำลังสร้างภาพฉาก ${i + 1} (เหลือ ${missing.length} ภาพ)`,
  });
  let file = scene.showProduct ? await productPhoto(p.product_image) : null;
  let label = `รูปสินค้า · ฉาก ${i + 1}`;
  if (!file) {
    const img = await minimaxMedia.generateImage({
      prompt: `${scene.visual || scene.caption || scene.voiceover}. Vertical 9:16 realistic smartphone photo for a product review video. No text, letters, logos or watermarks.`,
      aspectRatio: '9:16',
    });
    file = { buffer: img.buffer, mime: media.TYPES[img.mime] ? img.mime : 'image/jpeg' };
    label = `AI · ฉาก ${i + 1}`;
  }
  const key = media.saveFile(file.buffer, file.mime);
  await db.query(
    `INSERT INTO video_media (video_project_id, kind, mime, storage_key, size_bytes, label, sort_order)
     SELECT :id, 'image', :mime, :key, :size, :label, COALESCE(MAX(sort_order), 0) + 1 FROM video_media WHERE video_project_id = :id`,
    { id: p.id, mime: file.mime, key, size: file.buffer.length, label },
  );
  await enqueue('video.images', { projectId: p.id }, { orgId: p.org_id, maxAttempts: 1 });
  return { status: 'ok', scene: i };
});

/* ------------------------------------------------------------------- voice */

const voice = step(async ({ projectId }) => {
  const p = await loadProject(projectId);
  if (!p || p.status !== 'voicing') return { status: 'skipped' };
  await db.query("DELETE FROM video_assets WHERE video_project_id = :id AND kind = 'voice'", { id: p.id });
  for (const [i, scene] of p.scenes.entries()) {
    await db.query('UPDATE video_projects SET stage_detail = :d WHERE id = :id', { id: p.id, d: `กำลังสร้างเสียงพากย์ ฉาก ${i + 1}/${p.scenes.length}` });
    let url;
    let durationMs;
    if (p.voice_provider === 'elevenlabs') {
      const r = await elevenlabs.synthesize(scene.voiceover, { voiceId: p.voice_id });
      url = await r2.putObject(keyFor(p, `voice-${i}.mp3`), r.audio, 'audio/mpeg');
      durationMs = r.durationMs;
    } else {
      const r = await minimaxMedia.synthesize(scene.voiceover, { voiceId: p.voice_id });
      url = (await persist(r.url, keyFor(p, `voice-${i}.mp3`), 'audio/mpeg')).url;
      durationMs = r.durationMs;
    }
    await db.query(
      `INSERT INTO video_assets (video_project_id, kind, scene_index, provider, status, duration_ms, external_url)
       VALUES (:id, 'voice', :i, :provider, 'ready', :ms, :url)`,
      { id: p.id, i, provider: p.voice_provider ?? 'minimax', ms: durationMs, url },
    );
  }
  if (p.visual_mode === 'ai_clips' || p.visual_mode === 'my_footage') {
    await setStage(p.id, 'generating_clips', 'กำลังสั่งสร้างคลิป AI');
    await enqueue('video.clips_start', { projectId: p.id }, { orgId: p.org_id, maxAttempts: 1 });
  } else {
    await setStage(p.id, 'compositing', 'กำลังเตรียมประกอบคลิป');
    await enqueue('video.compose', { projectId: p.id }, { orgId: p.org_id, maxAttempts: 1 });
  }
  return { status: 'ok', scenes: p.scenes.length };
});

/* ------------------------------------------------------------------- clips */

/** Hailuo makes 6s or 10s clips: pick 10s when the scene's voice-over would outlast a 6s clip. */
const clipSeconds = (voiceMs) => (voiceMs && voiceMs / 1000 + 0.3 > 6 ? 10 : 6);

/** A scene picture as a data URL, so MiniMax gets it without fetching from this server. */
function imageDataUrl(row) {
  const file = row && row.kind === 'image' ? media.filePath(row.storage_key) : null;
  if (!file || !fs.existsSync(file)) return null;
  return `data:${row.mime};base64,${fs.readFileSync(file).toString('base64')}`;
}

/**
 * AI clips per scene. ai_clips: text-to-video (product photo as first frame on product scenes).
 * my_footage: image-to-video, each scene's picture animated as the first frame; scenes whose file is
 * already a video keep it. A clip is reused only while its scene still has the same picture.
 */
const clipsStart = step(async ({ projectId }) => {
  const p = await loadProject(projectId);
  if (!p || p.status !== 'generating_clips') return { status: 'skipped' };
  const fromImages = p.visual_mode === 'my_footage';
  const rows = fromImages ? await mediaRows(p.id) : [];
  const pictureOf = fromImages ? media.sceneMediaIndex(p.scenes, rows.length).map((k) => (k === null ? null : rows[k])) : [];
  const voiceMs = new Map((await assets(p.id, 'voice')).map((a) => [a.scene_index, a.duration_ms]));
  const existing = await assets(p.id, 'broll');
  const keep = new Set();
  for (const a of existing) {
    const source = parseJson(a.meta)?.source ?? null;
    const current = fromImages ? (pictureOf[a.scene_index]?.storage_key ?? null) : null;
    if (a.status !== 'failed' && a.scene_index < p.scenes.length && source === current) keep.add(a.scene_index);
    else await db.query('DELETE FROM video_assets WHERE id = :id', { id: a.id });
  }
  let started = 0;
  for (const [i, scene] of p.scenes.entries()) {
    if (keep.has(i)) continue; // reuse clips from an earlier attempt of the same scene
    const picture = pictureOf[i] ?? null;
    if (fromImages && picture?.kind !== 'image') continue; // the user's own video plays as is
    const imageUrl = fromImages ? imageDataUrl(picture) : scene.showProduct ? p.product_image : null;
    if (fromImages && !imageUrl) continue;
    const { taskId } = await minimaxMedia.createVideo({
      prompt: fromImages
        ? `${scene.visual || scene.caption}. Animate this exact scene with natural, subtle motion; keep the same person, product and framing. No text.`
        : `${scene.visual}. Vertical 9:16 framing, smartphone ad style, no text.`,
      imageUrl,
      duration: clipSeconds(voiceMs.get(i)),
    });
    await db.query(
      `INSERT INTO video_assets (video_project_id, kind, scene_index, provider, external_id, status, meta)
       VALUES (:id, 'broll', :i, 'minimax', :taskId, 'processing', :meta)`,
      { id: p.id, i, taskId, meta: JSON.stringify({ source: picture?.storage_key ?? null }) },
    );
    started += 1;
  }
  if (!started && !(await assets(p.id, 'broll')).some((a) => a.status === 'processing')) {
    await setStage(p.id, 'compositing', 'กำลังเตรียมประกอบคลิป');
    await enqueue('video.compose', { projectId: p.id }, { orgId: p.org_id, maxAttempts: 1 });
    return { status: 'ok', started };
  }
  await db.query('UPDATE video_projects SET stage_detail = :d WHERE id = :id', {
    id: p.id,
    d: `กำลังสร้างคลิป AI ${started || p.scenes.length} ฉาก (ใช้เวลาหลายนาที)`,
  });
  await enqueue('video.clips_poll', { projectId: p.id, polls: 1 }, { orgId: p.org_id, runAt: new Date(Date.now() + POLL_MS), maxAttempts: 3 });
  return { status: 'ok', started };
});

const clipsPoll = step(async ({ projectId, polls = 1 }) => {
  const p = await loadProject(projectId);
  if (!p || p.status !== 'generating_clips') return { status: 'skipped' };
  const clips = await assets(p.id, 'broll');
  for (const a of clips.filter((c) => c.status === 'processing')) {
    const q = await minimaxMedia.queryVideo(a.external_id);
    if (q.status === 'ready') {
      const url = (await persist(await minimaxMedia.fileUrl(q.fileId), keyFor(p, `clip-${a.scene_index}.mp4`), 'video/mp4')).url;
      await db.query("UPDATE video_assets SET status = 'ready', external_url = :url WHERE id = :id", { id: a.id, url });
    } else if (q.status === 'failed' || polls >= MAX_CLIP_POLLS) {
      // The scene falls back to the product image instead of failing the whole video
      await db.query("UPDATE video_assets SET status = 'failed', error = :e WHERE id = :id", {
        id: a.id,
        e: q.status === 'failed' ? 'MiniMax สร้างคลิปไม่สำเร็จ' : 'รอนานเกินไป',
      });
    }
  }
  const after = await assets(p.id, 'broll');
  const pending = after.filter((a) => a.status === 'processing').length;
  if (pending) {
    await db.query('UPDATE video_projects SET stage_detail = :d WHERE id = :id', {
      id: p.id,
      d: `สร้างคลิป AI เสร็จ ${after.length - pending}/${after.length} ฉาก`,
    });
    await enqueue('video.clips_poll', { projectId: p.id, polls: polls + 1 }, { orgId: p.org_id, runAt: new Date(Date.now() + POLL_MS), maxAttempts: 3 });
    return { status: 'waiting', pending };
  }
  await setStage(p.id, 'compositing', 'กำลังเตรียมประกอบคลิป');
  await enqueue('video.compose', { projectId: p.id }, { orgId: p.org_id, maxAttempts: 1 });
  return { status: 'ok' };
});

/* ----------------------------------------------------------------- compose */

const compose = step(async ({ projectId }) => {
  const p = await loadProject(projectId);
  if (!p || p.status !== 'compositing') return { status: 'skipped' };
  const voices = await assets(p.id, 'voice');
  const byScene = (list) => p.scenes.map((_, i) => list.find((a) => a.scene_index === i && a.status === 'ready') ?? null);
  const voiceRows = byScene(voices);
  if (voiceRows.some((v) => !v)) throw new Error('ไฟล์เสียงพากย์ไม่ครบทุกฉาก');
  const timings = sceneTimings(
    p.scenes,
    voiceRows.map((v) => v.duration_ms),
  );
  const srt = buildSrt(p.scenes, timings);
  const duration = Math.round(timings.at(-1).start + timings.at(-1).length);
  await db.query('UPDATE video_projects SET subtitle_srt = :srt, duration_sec = :duration WHERE id = :id', { id: p.id, srt, duration });

  const clips = byScene(p.visual_mode !== 'product_images' ? await assets(p.id, 'broll') : []);
  // Own footage / extra photos, served to the renderer through signed URLs
  const own = (await db.query('SELECT * FROM video_media WHERE video_project_id = :id ORDER BY sort_order, id', { id: p.id }))
    .map((m) => ({ type: m.kind, url: media.publicUrl('m', m.id), durationSec: m.duration_ms ? m.duration_ms / 1000 : null }))
    .filter((m) => m.url);
  const productImage = p.product_image ? { type: 'image', url: p.product_image } : null;
  let visuals;
  let pool;
  const single = p.visual_mode === 'my_footage';
  if (single) {
    // Scenes in order: the AI clip made from the scene's picture, else the picture / own video itself
    visuals = media
      .sceneMediaIndex(p.scenes, own.length)
      .map((k, i) =>
        clips[i] ? { type: 'video', url: clips[i].external_url, durationSec: clipSeconds(voiceRows[i]?.duration_ms) } : k === null ? productImage : own[k],
      );
    pool = [];
  } else {
    visuals = p.scenes.map((_, i) => (clips[i] ? { type: 'video', url: clips[i].external_url } : productImage));
    pool = own.filter((m) => m.type === 'image');
    if (pool.length && productImage) pool.push(productImage);
  }
  let introUrl = null;
  if (p.cover_id) {
    const cover = await db.one("SELECT orientation FROM cover_projects WHERE id = :id AND org_id = :orgId AND status = 'ready'", {
      id: p.cover_id,
      orgId: p.org_id,
    });
    if (cover?.orientation === 'portrait') introUrl = media.publicUrl('c', p.cover_id);
  }

  if (!shotstack.isConfigured()) {
    await setStage(p.id, 'parts_ready', 'ยังไม่ได้ตั้งค่า Shotstack — ดาวน์โหลดเสียง คลิป และซับไปตัดต่อเองได้');
    return { status: 'parts_ready' };
  }
  const edit = buildShotstackEdit({
    scenes: p.scenes,
    timings,
    voiceUrls: voiceRows.map((v) => v.external_url),
    visuals,
    pool,
    single,
    captionStyle: p.caption_style || 'pop',
    introUrl,
    fontUrl: process.env.SHOTSTACK_FONT_URL || undefined,
    musicUrl: process.env.VIDEO_MUSIC_URL || null,
  });
  const { renderId } = await shotstack.render(edit);
  await db.query("DELETE FROM video_assets WHERE video_project_id = :id AND kind = 'final'", { id: p.id });
  await db.query(
    `INSERT INTO video_assets (video_project_id, kind, provider, external_id, status, duration_ms)
     VALUES (:id, 'final', 'shotstack', :renderId, 'processing', :ms)`,
    { id: p.id, renderId, ms: duration * 1000 },
  );
  await db.query('UPDATE video_projects SET stage_detail = :d WHERE id = :id', { id: p.id, d: 'กำลังเรนเดอร์คลิป 9:16 (Shotstack)' });
  await enqueue('video.compose_poll', { projectId: p.id, polls: 1 }, { orgId: p.org_id, runAt: new Date(Date.now() + POLL_MS / 2), maxAttempts: 3 });
  return { status: 'rendering', renderId };
});

const composePoll = step(async ({ projectId, polls = 1 }) => {
  const p = await loadProject(projectId);
  if (!p || p.status !== 'compositing') return { status: 'skipped' };
  const [final] = await assets(p.id, 'final');
  if (!final) throw new Error('ไม่พบงานเรนเดอร์');
  const r = await shotstack.getRender(final.external_id);
  if (r.status === 'processing') {
    if (polls >= MAX_RENDER_POLLS) throw new Error('Shotstack เรนเดอร์นานเกินไป');
    await enqueue('video.compose_poll', { projectId: p.id, polls: polls + 1 }, { orgId: p.org_id, runAt: new Date(Date.now() + POLL_MS / 2), maxAttempts: 3 });
    return { status: 'waiting' };
  }
  if (r.status === 'failed') throw new Error(`Shotstack: ${r.error}`);
  const stored = await persist(r.url, keyFor(p, 'final.mp4'), 'video/mp4');
  await db.query("UPDATE video_assets SET status = 'ready', external_url = :url WHERE id = :id", { id: final.id, url: stored.url });
  await db.query("UPDATE video_projects SET status = 'ready', output_url = :url, stage_detail = :d, error = NULL WHERE id = :id", {
    id: p.id,
    url: stored.url,
    d: stored.stored ? null : 'ลิงก์จาก Shotstack หมดอายุใน 24 ชม. — ตั้งค่า R2 เพื่อเก็บไฟล์ถาวร',
  });
  return { status: 'ready', url: stored.url };
});

module.exports = { images, missingSceneImages, voice, clipsStart, clipsPoll, compose, composePoll, VOICE_PROVIDERS, loadProject };
