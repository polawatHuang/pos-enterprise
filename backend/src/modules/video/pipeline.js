'use strict';

const db = require('../../db/pool');
const logger = require('../../core/logger');
const { enqueue } = require('../../jobs/queue');
const minimaxMedia = require('../../integrations/minimax-media');
const elevenlabs = require('../../integrations/elevenlabs');
const shotstack = require('../../integrations/shotstack');
const r2 = require('../../integrations/r2');
const { sceneTimings, buildSrt, buildShotstackEdit } = require('./timeline');

/**
 * Generation runs as a chain of queued jobs so each step fits the cron tick's time budget:
 *   video.voice → (video.clips_start → video.clips_poll …) → video.compose → video.compose_poll …
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
  if (p.visual_mode === 'ai_clips') {
    await setStage(p.id, 'generating_clips', 'กำลังสั่งสร้างคลิป AI');
    await enqueue('video.clips_start', { projectId: p.id }, { orgId: p.org_id, maxAttempts: 1 });
  } else {
    await setStage(p.id, 'compositing', 'กำลังเตรียมประกอบคลิป');
    await enqueue('video.compose', { projectId: p.id }, { orgId: p.org_id, maxAttempts: 1 });
  }
  return { status: 'ok', scenes: p.scenes.length };
});

/* ------------------------------------------------------------------- clips */

const clipsStart = step(async ({ projectId }) => {
  const p = await loadProject(projectId);
  if (!p || p.status !== 'generating_clips') return { status: 'skipped' };
  const existing = await assets(p.id, 'broll');
  const have = new Set(existing.filter((a) => a.status !== 'failed').map((a) => a.scene_index));
  await db.query("DELETE FROM video_assets WHERE video_project_id = :id AND kind = 'broll' AND status = 'failed'", { id: p.id });
  for (const [i, scene] of p.scenes.entries()) {
    if (have.has(i)) continue; // reuse clips from an earlier attempt of the same script
    const { taskId } = await minimaxMedia.createVideo({
      prompt: `${scene.visual}. Vertical 9:16 framing, smartphone ad style, no text.`,
      imageUrl: scene.showProduct ? p.product_image : null,
    });
    await db.query(
      `INSERT INTO video_assets (video_project_id, kind, scene_index, provider, external_id, status)
       VALUES (:id, 'broll', :i, 'minimax', :taskId, 'processing')`,
      { id: p.id, i, taskId },
    );
  }
  await db.query('UPDATE video_projects SET stage_detail = :d WHERE id = :id', { id: p.id, d: `กำลังสร้างคลิป AI ${p.scenes.length} ฉาก (ใช้เวลาหลายนาที)` });
  await enqueue('video.clips_poll', { projectId: p.id, polls: 1 }, { orgId: p.org_id, runAt: new Date(Date.now() + POLL_MS), maxAttempts: 3 });
  return { status: 'ok' };
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
  const timings = sceneTimings(p.scenes, voiceRows.map((v) => v.duration_ms));
  const srt = buildSrt(p.scenes, timings);
  const duration = Math.round(timings.at(-1).start + timings.at(-1).length);
  await db.query('UPDATE video_projects SET subtitle_srt = :srt, duration_sec = :duration WHERE id = :id', { id: p.id, srt, duration });

  const clips = byScene(p.visual_mode === 'ai_clips' ? await assets(p.id, 'broll') : []);
  const visuals = p.scenes.map((_, i) =>
    clips[i] ? { type: 'video', url: clips[i].external_url } : p.product_image ? { type: 'image', url: p.product_image } : null,
  );

  if (!shotstack.isConfigured()) {
    await setStage(p.id, 'parts_ready', 'ยังไม่ได้ตั้งค่า Shotstack — ดาวน์โหลดเสียง คลิป และซับไปตัดต่อเองได้');
    return { status: 'parts_ready' };
  }
  const edit = buildShotstackEdit({
    scenes: p.scenes,
    timings,
    voiceUrls: voiceRows.map((v) => v.external_url),
    visuals,
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
  await db.query(
    "UPDATE video_projects SET status = 'ready', output_url = :url, stage_detail = :d, error = NULL WHERE id = :id",
    { id: p.id, url: stored.url, d: stored.stored ? null : 'ลิงก์จาก Shotstack หมดอายุใน 24 ชม. — ตั้งค่า R2 เพื่อเก็บไฟล์ถาวร' },
  );
  return { status: 'ready', url: stored.url };
});

module.exports = { voice, clipsStart, clipsPoll, compose, composePoll, VOICE_PROVIDERS, loadProject };
