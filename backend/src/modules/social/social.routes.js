'use strict';

const express = require('express');
const { z } = require('zod');
const db = require('../../db/pool');
const env = require('../../config/env');
const logger = require('../../core/logger');
const { validate } = require('../../core/http');
const { authenticate, requirePermission } = require('../../core/auth');
const { audit } = require('../../core/audit');
const { notFound, badRequest, conflict } = require('../../core/errors');
const tiktok = require('../../integrations/tiktok');
const metaSocial = require('../../integrations/meta-social');
const shopeeAffiliate = require('../../integrations/shopee-affiliate');
const { signState, verifyState, saveAccount, credentialFor, requireEncryption } = require('./accounts.service');
const { buildCaption, DEFAULT_PLACEMENT } = require('./publish');
const { connectInboxPages } = require('../inbox/channels.service');

const router = express.Router();

const idParam = z.object({ id: z.coerce.number().int().positive() });
const parseJson = (v) => (v == null ? null : typeof v === 'string' ? JSON.parse(v) : v);
const appUrl = () => (env.APP_PUBLIC_URL || env.corsOrigins.find((o) => !o.includes('*')) || 'http://localhost:3000').replace(/\/+$/, '');

/* ----------------------------------------------------------------- OAuth */

/**
 * The callback is a plain browser redirect from TikTok/Facebook. It is authenticated by the signed
 * state (org + user, 15 minutes) rather than the session cookie, then redirects back to the app.
 */
router.get('/oauth/:platform/callback', async (req, res) => {
  const platform = req.params.platform;
  const state = verifyState(req.query.state);
  // The same Meta callback serves Facebook Login for the inbox (state k = 'inbox')
  const inboxLogin = state?.k === 'inbox';
  const back = (params) =>
    res.redirect(`${appUrl()}${inboxLogin ? '/inbox/settings?tab=channels&' : '/social/accounts?'}${new URLSearchParams(params)}`);
  if (!state || state.p !== platform) return back({ error: 'ลิงก์เชื่อมต่อหมดอายุหรือไม่ถูกต้อง กรุณาลองใหม่' });
  if (req.query.error) return back({ error: String(req.query.error_description ?? req.query.error).slice(0, 200) });
  if (!req.query.code) return back({ error: 'ไม่ได้รับรหัสยืนยันจากแพลตฟอร์ม' });
  try {
    let connected = 0;
    if (platform === 'tiktok') {
      const t = await tiktok.exchangeCode(String(req.query.code));
      if (!String(t.scope ?? '').includes('video.publish')) return back({ error: 'ต้องอนุญาตสิทธิ์โพสต์วิดีโอ (video.publish)' });
      const user = await tiktok.getUser(t.accessToken).catch(() => null);
      const expiresAt = Date.now() + t.expiresIn * 1000;
      await saveAccount({
        orgId: state.o,
        platform: 'tiktok',
        externalId: t.openId,
        displayName: user?.display_name ?? 'TikTok',
        avatarUrl: user?.avatar_url ?? null,
        credential: { accessToken: t.accessToken, refreshToken: t.refreshToken, expiresAt, refreshExpiresAt: t.refreshExpiresIn ? Date.now() + t.refreshExpiresIn * 1000 : null },
        expiresAt: new Date(expiresAt),
      });
      connected = 1;
    } else if (platform === 'meta' && inboxLogin) {
      const { userToken } = await metaSocial.exchangeCode(String(req.query.code));
      const r = await connectInboxPages(state.o, await metaSocial.listPages(userToken));
      if (!r.connected) return back({ error: 'ไม่พบเพจที่บัญชีนี้ดูแล (ต้องเป็นแอดมินของเพจ)' });
      audit({ user: { orgId: state.o, id: state.u }, ip: req.ip }, 'inbox.channel.connect', 'channel', null, r);
      return back({ connected: 'meta', count: String(r.connected), ...(r.warnings.length ? { warning: r.warnings.join(' · ').slice(0, 300) } : {}) });
    } else if (platform === 'meta') {
      const { userToken } = await metaSocial.exchangeCode(String(req.query.code));
      const pages = await metaSocial.listPages(userToken);
      for (const page of pages) {
        await saveAccount({ orgId: state.o, platform: 'facebook', externalId: page.id, displayName: page.name, avatarUrl: page.picture, credential: { pageToken: page.token } });
        connected += 1;
        if (page.instagram) {
          await saveAccount({
            orgId: state.o,
            platform: 'instagram',
            externalId: page.instagram.id,
            displayName: page.instagram.username ? `@${page.instagram.username}` : page.name,
            avatarUrl: page.instagram.picture,
            credential: { pageToken: page.token, pageId: page.id },
            meta: { pageId: page.id, pageName: page.name },
          });
          connected += 1;
        }
      }
      if (!connected) return back({ error: 'ไม่พบเพจที่บัญชีนี้ดูแล (ต้องเป็นแอดมินของเพจ)' });
    } else return back({ error: 'แพลตฟอร์มไม่ถูกต้อง' });
    audit({ user: { orgId: state.o, id: state.u }, ip: req.ip }, 'social.connect', 'social_account', null, { platform, connected });
    return back({ connected: platform, count: String(connected) });
  } catch (err) {
    logger.warn({ err: err.message, platform }, 'social OAuth callback failed');
    return back({ error: err.message.slice(0, 200) });
  }
});

router.use(authenticate);

router.get('/oauth/:platform/start', requirePermission('social:publish'), (req, res) => {
  const platform = req.params.platform;
  const adapter = { tiktok, meta: metaSocial }[platform];
  if (!adapter) throw badRequest('แพลตฟอร์มไม่ถูกต้อง');
  adapter.requireConfig();
  requireEncryption();
  res.json({ data: { url: adapter.getAuthorizeUrl(signState({ o: req.user.orgId, u: req.user.id, p: platform })) } });
});

/* -------------------------------------------------------------- accounts */

router.get('/accounts', requirePermission('social:read'), async (req, res) => {
  const rows = await db.query(
    `SELECT sa.*, (SELECT COUNT(*) FROM scheduled_posts sp WHERE sp.social_account_id = sa.id AND sp.status = 'scheduled') AS scheduled_count
       FROM social_accounts sa WHERE sa.org_id = :orgId ORDER BY FIELD(sa.platform, 'tiktok', 'facebook', 'instagram'), sa.id`,
    { orgId: req.user.orgId },
  );
  res.json({
    data: rows.map((a) => ({
      id: a.id,
      platform: a.platform,
      externalId: a.external_id,
      displayName: a.display_name,
      avatarUrl: a.avatar_url,
      status: a.credential_id ? a.status : a.status === 'connected' ? 'expired' : a.status,
      lastError: a.last_error,
      tokenExpiresAt: a.token_expires_at,
      isActive: Boolean(a.is_active),
      scheduledCount: Number(a.scheduled_count),
      meta: parseJson(a.meta),
    })),
    meta: {
      tiktok: { configured: tiktok.isConfigured(), missing: tiktok.missing() },
      meta: { configured: metaSocial.isConfigured(), missing: metaSocial.missing() },
      encryption: Boolean(env.APP_ENCRYPTION_KEY),
      callbackUrls: { tiktok: `${appUrl()}/api/social/oauth/tiktok/callback`, meta: `${appUrl()}/api/social/oauth/meta/callback` },
    },
  });
});

router.patch('/accounts/:id', requirePermission('social:publish'), validate({ params: idParam, body: z.object({ isActive: z.boolean() }) }), async (req, res) => {
  const r = await db.query('UPDATE social_accounts SET is_active = :a WHERE id = :id AND org_id = :orgId', { id: req.valid.params.id, orgId: req.user.orgId, a: req.valid.body.isActive ? 1 : 0 });
  if (!r.affectedRows) throw notFound();
  res.json({ data: { ok: true } });
});

/** Disconnect: forget the token. The account row stays so post history keeps its name. */
router.delete('/accounts/:id', requirePermission('social:publish'), validate({ params: idParam }), async (req, res) => {
  const a = await db.one('SELECT * FROM social_accounts WHERE id = :id AND org_id = :orgId', { id: req.valid.params.id, orgId: req.user.orgId });
  if (!a) throw notFound();
  await db.tx(async (conn) => {
    await conn.query("UPDATE social_accounts SET credential_id = NULL, status = 'expired', last_error = 'ยกเลิกการเชื่อมต่อแล้ว', is_active = 0 WHERE id = :id", { id: a.id });
    if (a.credential_id) await conn.query('DELETE FROM integration_credentials WHERE id = :id', { id: a.credential_id });
    await conn.query("UPDATE scheduled_posts SET status = 'draft' WHERE social_account_id = :id AND status = 'scheduled'", { id: a.id });
  });
  audit(req, 'social.disconnect', 'social_account', a.id);
  res.json({ data: { ok: true } });
});

/** TikTok requires showing the creator's nickname and allowed privacy options before posting. */
router.get('/accounts/:id/creator-info', requirePermission('social:publish'), validate({ params: idParam }), async (req, res) => {
  const a = await db.one('SELECT * FROM social_accounts WHERE id = :id AND org_id = :orgId', { id: req.valid.params.id, orgId: req.user.orgId });
  if (!a) throw notFound();
  if (a.platform !== 'tiktok') throw badRequest('ใช้ได้เฉพาะบัญชี TikTok');
  const cred = await credentialFor(a);
  const info = await tiktok.queryCreatorInfo(cred.accessToken);
  res.json({
    data: {
      nickname: info.creator_nickname,
      username: info.creator_username,
      avatarUrl: info.creator_avatar_url,
      privacyOptions: info.privacy_level_options ?? [],
      commentDisabled: Boolean(info.comment_disabled),
      duetDisabled: Boolean(info.duet_disabled),
      stitchDisabled: Boolean(info.stitch_disabled),
      maxDurationSec: info.max_video_post_duration_sec ?? null,
    },
  });
});

/* ----------------------------------------------------------------- posts */

function mapPost(p) {
  return {
    id: p.id,
    accountId: p.social_account_id,
    platform: p.platform,
    accountName: p.display_name,
    accountStatus: p.account_status,
    videoProjectId: p.video_project_id,
    videoTitle: p.video_title ?? null,
    videoStatus: p.video_status ?? null,
    mediaUrl: p.media_url,
    caption: p.caption,
    hashtags: p.hashtags,
    affiliateLinkId: p.affiliate_link_id,
    affiliateUrl: p.short_url ?? p.original_url ?? null,
    linkPlacement: p.link_placement,
    scheduledAt: p.scheduled_at,
    privacy: p.privacy,
    platformOptions: parseJson(p.platform_options),
    isAiGenerated: Boolean(p.is_ai_generated),
    status: p.status,
    error: p.error,
    publishedAt: p.published_at,
    permalink: p.permalink ?? null,
    finalCaption: buildCaption({ caption: p.caption, hashtags: p.hashtags, linkUrl: p.short_url ?? p.original_url, placement: p.link_placement }),
  };
}

const POST_SELECT = `SELECT sp.*, sa.platform, sa.display_name, sa.status AS account_status, vp.title AS video_title, vp.status AS video_status,
       al.short_url, al.original_url,
       (SELECT pr.permalink FROM post_results pr WHERE pr.scheduled_post_id = sp.id ORDER BY pr.id DESC LIMIT 1) AS permalink
  FROM scheduled_posts sp JOIN social_accounts sa ON sa.id = sp.social_account_id
  LEFT JOIN video_projects vp ON vp.id = sp.video_project_id LEFT JOIN affiliate_links al ON al.id = sp.affiliate_link_id`;

async function getPost(orgId, id) {
  const p = await db.one(`${POST_SELECT} WHERE sp.id = :id AND sp.org_id = :orgId`, { id, orgId });
  if (!p) throw notFound('ไม่พบโพสต์');
  return p;
}

router.get(
  '/posts',
  requirePermission('social:read'),
  validate({
    query: z.object({
      from: z.iso.datetime({ offset: true }).optional(),
      to: z.iso.datetime({ offset: true }).optional(),
      status: z.enum(['draft', 'scheduled', 'publishing', 'published', 'failed', 'cancelled']).optional(),
      accountId: z.coerce.number().int().positive().optional(),
    }),
  }),
  async (req, res) => {
    const q = req.valid.query;
    const rows = await db.query(
      `${POST_SELECT}
        WHERE sp.org_id = :orgId AND (:from IS NULL OR sp.scheduled_at >= :from) AND (:to IS NULL OR sp.scheduled_at < :to)
          AND (:status IS NULL OR sp.status = :status) AND (:accountId IS NULL OR sp.social_account_id = :accountId)
        ORDER BY sp.scheduled_at LIMIT 500`,
      {
        orgId: req.user.orgId,
        from: q.from ? new Date(q.from) : null,
        to: q.to ? new Date(q.to) : null,
        status: q.status ?? null,
        accountId: q.accountId ?? null,
      },
    );
    res.json({ data: rows.map(mapPost) });
  },
);

const tiktokOptions = z
  .object({
    privacyLevel: z.enum(['PUBLIC_TO_EVERYONE', 'MUTUAL_FOLLOW_FRIENDS', 'FOLLOWER_OF_CREATOR', 'SELF_ONLY']),
    disableComment: z.boolean().default(false),
    disableDuet: z.boolean().default(false),
    disableStitch: z.boolean().default(false),
    brandContent: z.boolean().default(false),
    brandOrganic: z.boolean().default(false),
  })
  .refine((o) => !(o.brandContent && o.privacyLevel === 'SELF_ONLY'), 'โพสต์ Branded content ตั้งเป็น "เฉพาะฉัน" ไม่ได้');

const postBody = z.object({
  accountIds: z.array(z.number().int().positive()).min(1).max(10),
  videoProjectId: z.number().int().positive().nullable().optional(),
  mediaUrl: z.string().trim().url().regex(/^https:\/\//, 'ลิงก์วิดีโอต้องเป็น https').max(1000).nullable().optional(),
  caption: z.string().trim().max(2000).default(''),
  hashtags: z.string().trim().max(500).default(''),
  affiliateLinkId: z.number().int().positive().nullable().optional(),
  linkPlacement: z.enum(['caption', 'bio', 'none']).optional(),
  scheduledAt: z.iso.datetime({ offset: true }).nullable().optional(),
  asDraft: z.boolean().default(false),
  tiktok: tiktokOptions.optional(),
  isAiGenerated: z.boolean().default(true),
});

async function resolveMedia(orgId, b) {
  if (b.videoProjectId) {
    const v = await db.one('SELECT id, status, output_url FROM video_projects WHERE id = :id AND org_id = :orgId', { id: b.videoProjectId, orgId });
    if (!v) throw notFound('ไม่พบวิดีโอ');
    if (!b.asDraft && (v.status !== 'ready' || !v.output_url)) throw badRequest('วิดีโอนี้ยังไม่เสร็จ (ต้องมีไฟล์ MP4 ที่ประกอบแล้ว)');
    return v;
  }
  if (!b.mediaUrl && !b.asDraft) throw badRequest('เลือกวิดีโอจาก AI Video หรือใส่ลิงก์ไฟล์ MP4');
  return null;
}

/** A tracking short link per post (sub id = platform + post id), so each post's sales can be told apart. */
async function trackingLink(orgId, baseLinkId, platform, postId) {
  const base = await db.one('SELECT * FROM affiliate_links WHERE id = :id AND org_id = :orgId', { id: baseLinkId, orgId });
  if (!base) throw notFound('ไม่พบลิงก์ affiliate');
  if (base.platform !== 'shopee' || !shopeeAffiliate.isConfigured()) return base.id;
  const subId = `${platform}${postId}`;
  try {
    const shortUrl = await shopeeAffiliate.generateShortLink(base.original_url, [subId]);
    const r = await db.query(
      `INSERT INTO affiliate_links (org_id, product_id, label, platform, original_url, short_url, sub_id)
       VALUES (:orgId, :productId, :label, 'shopee', :url, :shortUrl, :subId)`,
      { orgId, productId: base.product_id, label: `${base.label ?? 'ลิงก์'} · ${platform} #${postId}`.slice(0, 191), url: base.original_url, shortUrl, subId },
    );
    return r.insertId;
  } catch (err) {
    logger.warn({ err: err.message }, 'per-post affiliate link failed; using the base link');
    return base.id;
  }
}

router.post('/posts', requirePermission('social:publish'), validate({ body: postBody }), async (req, res) => {
  const b = req.valid.body;
  const accounts = await db.query('SELECT * FROM social_accounts WHERE id IN (:ids) AND org_id = :orgId', { ids: b.accountIds, orgId: req.user.orgId });
  if (accounts.length !== new Set(b.accountIds).size) throw notFound('ไม่พบบัญชีที่เลือก');
  if (accounts.some((a) => a.platform === 'tiktok') && !b.tiktok) throw badRequest('โพสต์ TikTok ต้องเลือกการตั้งค่าความเป็นส่วนตัว');
  const when = b.scheduledAt ? new Date(b.scheduledAt) : new Date();
  if (b.scheduledAt && when.getTime() < Date.now() - 60_000) throw badRequest('เวลาโพสต์ต้องไม่อยู่ในอดีต');
  if (b.affiliateLinkId) {
    const ok = await db.one('SELECT id FROM affiliate_links WHERE id = :id AND org_id = :orgId', { id: b.affiliateLinkId, orgId: req.user.orgId });
    if (!ok) throw notFound('ไม่พบลิงก์ affiliate');
  }
  await resolveMedia(req.user.orgId, b);
  const created = [];
  for (const a of accounts) {
    const r = await db.query(
      `INSERT INTO scheduled_posts (org_id, social_account_id, video_project_id, media_url, caption, hashtags, affiliate_link_id, link_placement,
                                    scheduled_at, privacy, platform_options, is_ai_generated, status, created_by)
       VALUES (:orgId, :accountId, :videoId, :mediaUrl, :caption, :hashtags, :linkId, :placement, :when, :privacy, :options, :aigc, :status, :userId)`,
      {
        orgId: req.user.orgId,
        accountId: a.id,
        videoId: b.videoProjectId ?? null,
        mediaUrl: b.videoProjectId ? null : b.mediaUrl ?? null,
        caption: b.caption,
        hashtags: b.hashtags,
        linkId: b.affiliateLinkId ?? null,
        placement: b.affiliateLinkId ? b.linkPlacement ?? DEFAULT_PLACEMENT[a.platform] : 'none',
        when,
        privacy: a.platform === 'tiktok' ? b.tiktok.privacyLevel : 'PUBLIC_TO_EVERYONE',
        options: a.platform === 'tiktok' ? JSON.stringify(b.tiktok) : null,
        aigc: b.isAiGenerated ? 1 : 0,
        status: b.asDraft ? 'draft' : 'scheduled',
        userId: req.user.id,
      },
    );
    if (b.affiliateLinkId) {
      const linkId = await trackingLink(req.user.orgId, b.affiliateLinkId, a.platform, r.insertId);
      if (linkId !== b.affiliateLinkId) await db.query('UPDATE scheduled_posts SET affiliate_link_id = :l WHERE id = :id', { id: r.insertId, l: linkId });
    }
    created.push(r.insertId);
  }
  audit(req, 'social.schedule', 'scheduled_post', null, { ids: created, at: when.toISOString() });
  res.status(201).json({ data: { ids: created, warnings: accounts.filter((a) => a.status !== 'connected' || !a.credential_id).map((a) => `${a.display_name}: บัญชียังไม่ได้เชื่อมต่อ โพสต์จะรอจนกว่าจะเชื่อมต่อ`) } });
});

router.patch(
  '/posts/:id',
  requirePermission('social:publish'),
  validate({
    params: idParam,
    body: z.object({
      scheduledAt: z.iso.datetime({ offset: true }).optional(),
      caption: z.string().trim().max(2000).optional(),
      hashtags: z.string().trim().max(500).optional(),
      linkPlacement: z.enum(['caption', 'bio', 'none']).optional(),
      tiktok: tiktokOptions.optional(),
      status: z.enum(['draft', 'scheduled']).optional(),
    }),
  }),
  async (req, res) => {
    const p = await getPost(req.user.orgId, req.valid.params.id);
    if (!['draft', 'scheduled', 'failed'].includes(p.status)) throw conflict('แก้ไขได้เฉพาะโพสต์ที่ยังไม่ได้เผยแพร่');
    const b = req.valid.body;
    const when = b.scheduledAt ? new Date(b.scheduledAt) : null;
    if (when && when.getTime() < Date.now() - 60_000) throw badRequest('เวลาโพสต์ต้องไม่อยู่ในอดีต');
    if (b.status === 'scheduled' && !p.media_url && !(p.video_status === 'ready')) throw badRequest('วิดีโอนี้ยังไม่เสร็จ ตั้งเวลาไม่ได้');
    await db.query(
      `UPDATE scheduled_posts SET scheduled_at = COALESCE(:when, scheduled_at), caption = COALESCE(:caption, caption), hashtags = COALESCE(:hashtags, hashtags),
              link_placement = COALESCE(:placement, link_placement), platform_options = COALESCE(:options, platform_options),
              privacy = COALESCE(:privacy, privacy), status = COALESCE(:status, IF(status = 'failed', 'scheduled', status)), error = NULL
        WHERE id = :id`,
      {
        id: p.id,
        when,
        caption: b.caption ?? null,
        hashtags: b.hashtags ?? null,
        placement: b.linkPlacement ?? null,
        options: b.tiktok ? JSON.stringify(b.tiktok) : null,
        privacy: b.tiktok?.privacyLevel ?? null,
        status: b.status ?? null,
      },
    );
    audit(req, 'social.update', 'scheduled_post', p.id);
    res.json({ data: mapPost(await getPost(req.user.orgId, p.id)) });
  },
);

router.post('/posts/:id/cancel', requirePermission('social:publish'), validate({ params: idParam }), async (req, res) => {
  const r = await db.query("UPDATE scheduled_posts SET status = 'cancelled' WHERE id = :id AND org_id = :orgId AND status IN ('draft','scheduled','failed')", {
    id: req.valid.params.id,
    orgId: req.user.orgId,
  });
  if (!r.affectedRows) throw conflict('ยกเลิกได้เฉพาะโพสต์ที่ยังไม่ได้เผยแพร่');
  audit(req, 'social.cancel', 'scheduled_post', req.valid.params.id);
  res.json({ data: { ok: true } });
});

/** Publish now (or retry a failed post): queue it for the next cron tick. */
router.post('/posts/:id/publish-now', requirePermission('social:publish'), validate({ params: idParam }), async (req, res) => {
  const p = await getPost(req.user.orgId, req.valid.params.id);
  if (!['draft', 'scheduled', 'failed'].includes(p.status)) throw conflict('โพสต์นี้เผยแพร่แล้วหรือกำลังเผยแพร่');
  if (p.account_status !== 'connected') throw conflict('บัญชียังไม่ได้เชื่อมต่อ');
  if (!p.media_url && p.video_status !== 'ready') throw badRequest('วิดีโอนี้ยังไม่เสร็จ');
  await db.query("UPDATE scheduled_posts SET status = 'scheduled', scheduled_at = UTC_TIMESTAMP(), error = NULL WHERE id = :id", { id: p.id });
  audit(req, 'social.publish_now', 'scheduled_post', p.id);
  res.json({ data: { ok: true } });
});

/* ------------------------------------------------------- affiliate links */

router.get('/affiliate-links', requirePermission('social:read'), async (req, res) => {
  const rows = await db.query(
    `SELECT al.*, p.name AS product_name, (SELECT COUNT(*) FROM scheduled_posts sp WHERE sp.affiliate_link_id = al.id) AS post_count
       FROM affiliate_links al LEFT JOIN products p ON p.id = al.product_id
      WHERE al.org_id = :orgId ORDER BY al.id DESC LIMIT 200`,
    { orgId: req.user.orgId },
  );
  res.json({
    data: rows.map((l) => ({
      id: l.id,
      label: l.label,
      productId: l.product_id,
      productName: l.product_name,
      platform: l.platform,
      originalUrl: l.original_url,
      shortUrl: l.short_url,
      subId: l.sub_id,
      clicks: l.clicks,
      conversions: l.conversions,
      commission: Number(l.commission),
      postCount: Number(l.post_count),
      createdAt: l.created_at,
    })),
    meta: { shopeeConfigured: shopeeAffiliate.isConfigured(), missing: shopeeAffiliate.missing() },
  });
});

router.post(
  '/affiliate-links',
  requirePermission('social:publish'),
  validate({
    body: z.object({
      originalUrl: z.string().trim().url().max(1000),
      label: z.string().trim().max(191).optional(),
      productId: z.number().int().positive().nullable().optional(),
      subId: z.string().trim().regex(/^[A-Za-z0-9]{0,50}$/, 'sub id ใช้ได้เฉพาะ a-z, 0-9').optional(),
    }),
  }),
  async (req, res) => {
    const b = req.valid.body;
    const host = new URL(b.originalUrl).hostname;
    const platform = /(^|\.)shopee\.|shope\.ee$/.test(host) ? 'shopee' : /lazada\./.test(host) ? 'lazada' : /tiktok\.com$/.test(host) ? 'tiktok_shop' : 'other';
    let shortUrl = null;
    if (platform === 'shopee') {
      shopeeAffiliate.requireConfig(); // 503 naming the keys: a plain Shopee link earns no commission
      shortUrl = await shopeeAffiliate.generateShortLink(b.originalUrl, b.subId ? [b.subId] : []);
    }
    const r = await db.query(
      `INSERT INTO affiliate_links (org_id, product_id, label, platform, original_url, short_url, sub_id)
       VALUES (:orgId, :productId, :label, :platform, :url, :shortUrl, :subId)`,
      { orgId: req.user.orgId, productId: b.productId ?? null, label: b.label ?? null, platform, url: b.originalUrl, shortUrl, subId: b.subId || null },
    );
    audit(req, 'social.affiliate_link', 'affiliate_link', r.insertId, { platform });
    res.status(201).json({ data: { id: r.insertId, shortUrl, platform } });
  },
);

router.delete('/affiliate-links/:id', requirePermission('social:publish'), validate({ params: idParam }), async (req, res) => {
  const used = await db.one("SELECT COUNT(*) AS n FROM scheduled_posts WHERE affiliate_link_id = :id AND status IN ('scheduled','publishing')", { id: req.valid.params.id });
  if (Number(used.n)) throw conflict('ลิงก์นี้ใช้อยู่ในโพสต์ที่ตั้งเวลาไว้');
  const r = await db.query('DELETE FROM affiliate_links WHERE id = :id AND org_id = :orgId', { id: req.valid.params.id, orgId: req.user.orgId });
  if (!r.affectedRows) throw notFound();
  res.json({ data: { ok: true } });
});

module.exports = { router };
