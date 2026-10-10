'use strict';

const db = require('../../db/pool');
const logger = require('../../core/logger');
const { enqueue } = require('../../jobs/queue');
const tiktok = require('../../integrations/tiktok');
const metaSocial = require('../../integrations/meta-social');
const { credentialFor, markAccount } = require('./accounts.service');

/**
 * Due posts → social.publish (one job per post) → social.status (poll until the platform has
 * processed the video). Publishing is never retried automatically: a retry after an unclear
 * error could post the same video twice. The user retries from the UI.
 */
const STATUS_POLL_MS = 30_000;
const MAX_STATUS_POLLS = 40;

const parseJson = (v) => (v == null ? null : typeof v === 'string' ? JSON.parse(v) : v);

/** Caption + hashtags + affiliate line. Only Facebook makes caption links clickable. */
function buildCaption({ caption, hashtags, linkUrl, placement }) {
  const parts = [String(caption ?? '').trim(), String(hashtags ?? '').trim()].filter(Boolean);
  if (linkUrl && placement === 'caption') parts.push(`🛒 สั่งซื้อ: ${linkUrl} (ลิงก์ affiliate)`);
  if (linkUrl && placement === 'bio') parts.push('🛒 ลิงก์สั่งซื้ออยู่ในโปรไฟล์ (ลิงก์ affiliate)');
  return parts.join('\n\n');
}

const DEFAULT_PLACEMENT = { facebook: 'caption', tiktok: 'bio', instagram: 'bio' };

async function loadPost(id) {
  return db.one(
    `SELECT sp.*, sa.platform, sa.external_id AS account_ref, sa.display_name, sa.credential_id, sa.status AS account_status, sa.meta AS account_meta,
            sa.id AS account_id, vp.output_url AS video_url, vp.status AS video_status, vp.duration_sec, al.short_url, al.original_url
       FROM scheduled_posts sp
       JOIN social_accounts sa ON sa.id = sp.social_account_id
       LEFT JOIN video_projects vp ON vp.id = sp.video_project_id
       LEFT JOIN affiliate_links al ON al.id = sp.affiliate_link_id
      WHERE sp.id = :id`,
    { id },
  );
}

async function fail(postId, err) {
  const message = String(err?.message ?? err).slice(0, 2000);
  logger.warn({ postId, err: message }, 'social publish failed');
  await db.query("UPDATE scheduled_posts SET status = 'failed', error = :message WHERE id = :id", { id: postId, message });
  return { status: 'failed', error: message };
}

/** Claim due posts of connected accounts and queue one publish job each. */
async function dispatchDue(limit = 20) {
  const ids = await db.tx(async (conn) => {
    const [rows] = await conn.query(
      `SELECT sp.id FROM scheduled_posts sp JOIN social_accounts sa ON sa.id = sp.social_account_id
        WHERE sp.status = 'scheduled' AND sp.scheduled_at <= UTC_TIMESTAMP() AND sa.status = 'connected' AND sa.is_active = 1
        ORDER BY sp.scheduled_at LIMIT ${Number(limit)} FOR UPDATE SKIP LOCKED`,
    );
    if (rows.length) {
      await conn.query("UPDATE scheduled_posts SET status = 'publishing', attempts = attempts + 1, error = NULL WHERE id IN (:ids)", { ids: rows.map((r) => r.id) });
    }
    return rows.map((r) => r.id);
  });
  for (const id of ids) await enqueue('social.publish', { postId: id }, { maxAttempts: 1 });
  return ids.length;
}

async function publish({ postId }) {
  const p = await loadPost(postId);
  if (!p || p.status !== 'publishing') return { status: 'skipped' };
  try {
    const videoUrl = p.media_url || p.video_url;
    if (!videoUrl) throw new Error('ไม่มีไฟล์วิดีโอ (วิดีโอยังไม่เสร็จหรือไม่ได้ใส่ลิงก์ MP4)');
    const placement = p.link_placement ?? DEFAULT_PLACEMENT[p.platform];
    const caption = buildCaption({ caption: p.caption, hashtags: p.hashtags, linkUrl: p.short_url || p.original_url, placement });
    const account = { id: p.account_id, platform: p.platform, credential_id: p.credential_id };
    let cred;
    try {
      cred = await credentialFor(account);
    } catch (err) {
      return fail(p.id, err);
    }
    const opts = parseJson(p.platform_options) ?? {};
    let externalId;
    if (p.platform === 'tiktok') {
      const creator = await tiktok.queryCreatorInfo(cred.accessToken);
      const privacy = opts.privacyLevel ?? p.privacy;
      if (creator?.privacy_level_options && !creator.privacy_level_options.includes(privacy)) {
        throw new Error(`บัญชี TikTok นี้ไม่รองรับระดับความเป็นส่วนตัว ${privacy} (ที่ใช้ได้: ${creator.privacy_level_options.join(', ')})`);
      }
      if (creator?.max_video_post_duration_sec && p.duration_sec && p.duration_sec > creator.max_video_post_duration_sec) {
        throw new Error(`วิดีโอยาวเกินที่บัญชีนี้โพสต์ได้ (${creator.max_video_post_duration_sec} วินาที)`);
      }
      externalId = await tiktok.initDirectPost(cred.accessToken, {
        videoUrl,
        title: caption,
        privacyLevel: privacy,
        disableComment: opts.disableComment || creator?.comment_disabled,
        disableDuet: opts.disableDuet || creator?.duet_disabled,
        disableStitch: opts.disableStitch || creator?.stitch_disabled,
        brandContent: opts.brandContent,
        brandOrganic: opts.brandOrganic,
        isAigc: Boolean(p.is_ai_generated),
      });
    } else if (p.platform === 'facebook') {
      externalId = await metaSocial.publishPageReel(cred.pageToken, p.account_ref, { videoUrl, description: caption });
    } else if (p.platform === 'instagram') {
      externalId = await metaSocial.createIgReel(cred.pageToken, p.account_ref, { videoUrl, caption });
    } else {
      throw new Error(`ไม่รองรับแพลตฟอร์ม ${p.platform}`);
    }
    await db.query('DELETE FROM post_results WHERE scheduled_post_id = :id', { id: p.id });
    await db.query("INSERT INTO post_results (scheduled_post_id, external_post_id, status) VALUES (:id, :ext, 'PROCESSING')", { id: p.id, ext: String(externalId) });
    await enqueue('social.status', { postId: p.id, polls: 1 }, { runAt: new Date(Date.now() + STATUS_POLL_MS), maxAttempts: 3 });
    return { status: 'processing', externalId };
  } catch (err) {
    // Invalid/revoked tokens: flag the account so the user sees 'reconnect' instead of retrying blindly
    if ([190, 'access_token_invalid', 'scope_not_authorized'].includes(err?.details?.code)) await markAccount(p.account_id, 'error', err.message);
    return fail(p.id, err);
  }
}

async function checkStatus({ postId, polls = 1 }) {
  const p = await loadPost(postId);
  if (!p || p.status !== 'publishing') return { status: 'skipped' };
  const result = await db.one('SELECT * FROM post_results WHERE scheduled_post_id = :id ORDER BY id DESC LIMIT 1', { id: p.id });
  if (!result) return fail(p.id, 'ไม่พบงานโพสต์ที่ส่งไป');
  try {
    const cred = await credentialFor({ id: p.account_id, platform: p.platform, credential_id: p.credential_id });
    let state;
    let permalink = null;
    let providerStatus;
    if (p.platform === 'tiktok') {
      const s = await tiktok.fetchPostStatus(cred.accessToken, result.external_post_id);
      providerStatus = s.status;
      if (s.status === 'PUBLISH_COMPLETE') {
        state = 'ready';
        const username = String(p.display_name ?? '').replace(/^@/, '');
        if (s.postIds[0]) permalink = username ? `https://www.tiktok.com/@${username}/video/${s.postIds[0]}` : null;
      } else if (s.status === 'FAILED') state = { failed: s.failReason ?? 'TikTok ประมวลผลไม่สำเร็จ' };
      else state = 'processing';
    } else if (p.platform === 'facebook') {
      const s = await metaSocial.pageReelStatus(cred.pageToken, result.external_post_id);
      providerStatus = s.status;
      state = s.status === 'failed' ? { failed: s.error } : s.status;
      if (state === 'ready') permalink = `https://www.facebook.com/reel/${result.external_post_id}`;
    } else {
      const s = await metaSocial.igContainerStatus(cred.pageToken, result.external_post_id);
      providerStatus = s.status;
      state = s.status === 'failed' ? { failed: s.error } : s.status;
      if (state === 'ready') {
        const pub = await metaSocial.publishIgContainer(cred.pageToken, p.account_ref, result.external_post_id);
        await db.query('UPDATE post_results SET external_post_id = :ext WHERE id = :id', { id: result.id, ext: pub.mediaId });
        permalink = pub.permalink;
      }
    }
    if (state === 'processing') {
      await db.query('UPDATE post_results SET status = :s, fetched_at = UTC_TIMESTAMP() WHERE id = :id', { id: result.id, s: String(providerStatus).slice(0, 40) });
      if (polls >= MAX_STATUS_POLLS) return fail(p.id, 'แพลตฟอร์มประมวลผลวิดีโอนานเกินไป ตรวจสอบในแอปของแพลตฟอร์ม');
      await enqueue('social.status', { postId: p.id, polls: polls + 1 }, { runAt: new Date(Date.now() + STATUS_POLL_MS), maxAttempts: 3 });
      return { status: 'processing' };
    }
    if (state?.failed) {
      await db.query("UPDATE post_results SET status = 'FAILED' WHERE id = :id", { id: result.id });
      return fail(p.id, state.failed);
    }
    await db.query("UPDATE post_results SET status = 'PUBLISHED', permalink = :permalink, fetched_at = UTC_TIMESTAMP() WHERE id = :id", { id: result.id, permalink });
    await db.query("UPDATE scheduled_posts SET status = 'published', published_at = UTC_TIMESTAMP(), error = NULL WHERE id = :id", { id: p.id });
    return { status: 'published', permalink };
  } catch (err) {
    return fail(p.id, err);
  }
}

module.exports = { buildCaption, dispatchDue, publish, checkStatus, DEFAULT_PLACEMENT };
