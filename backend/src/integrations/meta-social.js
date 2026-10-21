'use strict';

const { defineAdapter } = require('./define');
const runtime = require('../config/runtime');
const { AppError } = require('../core/errors');

const version = () => runtime.get('META_GRAPH_VERSION') || 'v23.0';
const graph = () => `https://graph.facebook.com/${version()}`;
const SCOPES = ['pages_show_list', 'pages_read_engagement', 'pages_manage_posts', 'business_management', 'instagram_basic', 'instagram_content_publish'];

async function call(path, { method = 'GET', params = {}, headers = {} } = {}) {
  const url = new URL(`${graph()}${path}`);
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
  const res = await fetch(url, { method, headers, signal: AbortSignal.timeout(30_000) });
  const json = await res.json().catch(() => null);
  if (!res.ok || json?.error) {
    throw new AppError(502, 'META_API_ERROR', `Meta: ${json?.error?.message ?? `HTTP ${res.status}`}`.slice(0, 300), { code: json?.error?.code });
  }
  return json;
}

/** Facebook Login + Page Reels + Instagram Reels (Graph API). Separate from the Messenger webhook adapter. */
const adapter = defineAdapter(
  {
    id: 'meta_social',
    name: 'Meta Graph API — โพสต์ Reels (Facebook Page / Instagram)',
    category: 'social',
    usedBy: ['social'],
    phase: 7,
    purpose: 'เชื่อมเพจ Facebook และ Instagram Business ด้วย Facebook Login แล้วโพสต์ Reels ตามเวลา',
    applyUrl: 'https://developers.facebook.com/apps/',
    env: [
      { name: 'META_APP_ID' },
      { name: 'META_APP_SECRET' },
      { name: 'META_REDIRECT_URI' },
      { name: 'META_GRAPH_VERSION', optional: true, default: 'v23.0' },
    ],
  },
  {
    getAuthorizeUrl(state) {
      const env = adapter.requireConfig();
      const q = new URLSearchParams({ client_id: env.META_APP_ID, redirect_uri: env.META_REDIRECT_URI, state, response_type: 'code', scope: SCOPES.join(',') });
      return `https://www.facebook.com/${version()}/dialog/oauth?${q}`;
    },

    /** code → long-lived user token (page tokens derived from it do not expire). */
    async exchangeCode(code) {
      const env = adapter.requireConfig();
      const short = await call('/oauth/access_token', {
        params: { client_id: env.META_APP_ID, client_secret: env.META_APP_SECRET, redirect_uri: env.META_REDIRECT_URI, code },
      });
      const long = await call('/oauth/access_token', {
        params: { grant_type: 'fb_exchange_token', client_id: env.META_APP_ID, client_secret: env.META_APP_SECRET, fb_exchange_token: short.access_token },
      });
      return { userToken: long.access_token, expiresIn: long.expires_in ?? null };
    },

    /** Pages the user manages, with page tokens and any linked Instagram professional account. */
    async listPages(userToken) {
      const r = await call('/me/accounts', {
        params: { access_token: userToken, fields: 'id,name,access_token,picture{url},instagram_business_account{id,username,profile_picture_url}', limit: 100 },
      });
      return (r.data ?? []).map((p) => ({
        id: p.id,
        name: p.name,
        token: p.access_token,
        picture: p.picture?.data?.url ?? null,
        instagram: p.instagram_business_account
          ? { id: p.instagram_business_account.id, username: p.instagram_business_account.username, picture: p.instagram_business_account.profile_picture_url ?? null }
          : null,
      }));
    },

    /* --------------------------------------------------- Facebook Page Reels */

    /** start → hosted upload (Meta pulls file_url) → finish+publish. Returns the video id. */
    async publishPageReel(pageToken, pageId, { videoUrl, description }) {
      const start = await call(`/${pageId}/video_reels`, { method: 'POST', params: { upload_phase: 'start', access_token: pageToken } });
      const upload = await fetch(start.upload_url ?? `https://rupload.facebook.com/video-upload/${version()}/${start.video_id}`, {
        method: 'POST',
        headers: { Authorization: `OAuth ${pageToken}`, file_url: videoUrl },
        signal: AbortSignal.timeout(60_000),
      });
      const up = await upload.json().catch(() => null);
      if (!upload.ok || up?.success === false) throw new AppError(502, 'META_API_ERROR', `Meta upload: ${up?.debug_info?.message ?? up?.error?.message ?? upload.status}`);
      await call(`/${pageId}/video_reels`, {
        method: 'POST',
        params: { upload_phase: 'finish', video_id: start.video_id, video_state: 'PUBLISHED', description: String(description ?? '').slice(0, 5000), access_token: pageToken },
      });
      return start.video_id;
    },

    /** @returns {{status:'processing'|'ready'|'failed', error?:string}} */
    async pageReelStatus(pageToken, videoId) {
      const r = await call(`/${videoId}`, { params: { fields: 'status', access_token: pageToken } });
      const s = r.status ?? {};
      if (s.video_status === 'error' || s.processing_phase?.status === 'error' || s.publishing_phase?.status === 'error') {
        return { status: 'failed', error: s.processing_phase?.errors?.[0]?.message ?? s.publishing_phase?.errors?.[0]?.message ?? 'Meta ประมวลผลวิดีโอไม่สำเร็จ' };
      }
      if (s.video_status === 'ready' || s.publishing_phase?.status === 'complete') return { status: 'ready' };
      return { status: 'processing' };
    },

    /* ------------------------------------------------------ Instagram Reels */

    async createIgReel(pageToken, igUserId, { videoUrl, caption }) {
      const r = await call(`/${igUserId}/media`, {
        method: 'POST',
        params: { media_type: 'REELS', video_url: videoUrl, caption: String(caption ?? '').slice(0, 2200), share_to_feed: true, access_token: pageToken },
      });
      return r.id;
    },

    /** Container status: FINISHED / IN_PROGRESS / ERROR / EXPIRED / PUBLISHED */
    async igContainerStatus(pageToken, containerId) {
      const r = await call(`/${containerId}`, { params: { fields: 'status_code,status', access_token: pageToken } });
      if (r.status_code === 'FINISHED' || r.status_code === 'PUBLISHED') return { status: 'ready' };
      if (r.status_code === 'ERROR' || r.status_code === 'EXPIRED') return { status: 'failed', error: r.status ?? r.status_code };
      return { status: 'processing' };
    },

    /** @returns {{mediaId:string, permalink:string|null}} */
    async publishIgContainer(pageToken, igUserId, containerId) {
      const r = await call(`/${igUserId}/media_publish`, { method: 'POST', params: { creation_id: containerId, access_token: pageToken } });
      const m = await call(`/${r.id}`, { params: { fields: 'permalink', access_token: pageToken } }).catch(() => ({}));
      return { mediaId: r.id, permalink: m.permalink ?? null };
    },
  },
);

module.exports = adapter;
