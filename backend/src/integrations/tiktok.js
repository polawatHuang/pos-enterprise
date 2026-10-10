'use strict';

const { defineAdapter } = require('./define');
const { AppError } = require('../core/errors');

const API = 'https://open.tiktokapis.com/v2';
const SCOPES = 'user.info.basic,video.publish';

/** TikTok returns { data, error: { code: "ok" | ..., message, log_id } } */
async function call(path, { token, body, form } = {}) {
  const res = await fetch(`${API}${path}`, {
    method: 'POST',
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      'Content-Type': form ? 'application/x-www-form-urlencoded' : 'application/json; charset=UTF-8',
    },
    body: form ? new URLSearchParams(form).toString() : JSON.stringify(body ?? {}),
    signal: AbortSignal.timeout(20_000),
  });
  const json = await res.json().catch(() => null);
  const code = json?.error?.code ?? (json?.error && typeof json.error === 'string' ? json.error : null);
  if (!res.ok || (code && code !== 'ok')) {
    const msg = json?.error?.message || json?.error_description || code || `HTTP ${res.status}`;
    throw new AppError(502, 'TIKTOK_API_ERROR', `TikTok: ${msg}`.slice(0, 300), { code, status: res.status });
  }
  return json;
}

const adapter = defineAdapter(
  {
    id: 'tiktok',
    name: 'TikTok Login Kit + Content Posting API',
    category: 'social',
    usedBy: ['social'],
    phase: 7,
    purpose: 'เชื่อมบัญชี TikTok (OAuth) และโพสต์วิดีโอตามเวลาที่ตั้งไว้ (Direct Post, ดึงไฟล์จาก URL ที่ verify โดเมนแล้ว)',
    applyUrl: 'https://developers.tiktok.com/',
    env: [
      { name: 'TIKTOK_CLIENT_KEY' },
      { name: 'TIKTOK_CLIENT_SECRET' },
      { name: 'TIKTOK_REDIRECT_URI' },
    ],
  },
  {
    getAuthorizeUrl(state) {
      const env = adapter.requireConfig();
      const q = new URLSearchParams({ client_key: env.TIKTOK_CLIENT_KEY, scope: SCOPES, response_type: 'code', redirect_uri: env.TIKTOK_REDIRECT_URI, state });
      return `https://www.tiktok.com/v2/auth/authorize/?${q}`;
    },

    /** @returns {{accessToken, refreshToken, openId, expiresIn, refreshExpiresIn, scope}} */
    async exchangeCode(code) {
      const env = adapter.requireConfig();
      const r = await call('/oauth/token/', {
        form: { client_key: env.TIKTOK_CLIENT_KEY, client_secret: env.TIKTOK_CLIENT_SECRET, code, grant_type: 'authorization_code', redirect_uri: env.TIKTOK_REDIRECT_URI },
      });
      return adapter.mapToken(r);
    },

    async refreshToken(refreshToken) {
      const env = adapter.requireConfig();
      const r = await call('/oauth/token/', {
        form: { client_key: env.TIKTOK_CLIENT_KEY, client_secret: env.TIKTOK_CLIENT_SECRET, grant_type: 'refresh_token', refresh_token: refreshToken },
      });
      return adapter.mapToken(r);
    },

    mapToken(r) {
      if (!r?.access_token) throw new AppError(502, 'TIKTOK_API_ERROR', 'TikTok ไม่ส่ง access token กลับมา');
      return {
        accessToken: r.access_token,
        refreshToken: r.refresh_token,
        openId: r.open_id,
        expiresIn: Number(r.expires_in) || 86400,
        refreshExpiresIn: Number(r.refresh_expires_in) || null,
        scope: r.scope,
      };
    },

    async getUser(token) {
      const res = await fetch(`${API}/user/info/?fields=open_id,display_name,avatar_url`, {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(15_000),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || (json?.error?.code && json.error.code !== 'ok')) throw new AppError(502, 'TIKTOK_API_ERROR', `TikTok: ${json?.error?.message ?? res.status}`);
      return json.data.user;
    },

    /** Required before every Direct Post: allowed privacy levels and interaction settings. */
    async queryCreatorInfo(token) {
      return (await call('/post/publish/creator_info/query/', { token })).data;
    },

    /**
     * Direct Post from a URL (the domain must be verified in the TikTok developer portal).
     * @returns {string} publish_id
     */
    async initDirectPost(token, { videoUrl, title, privacyLevel, disableComment, disableDuet, disableStitch, brandContent, brandOrganic, isAigc }) {
      const r = await call('/post/publish/video/init/', {
        token,
        body: {
          post_info: {
            title: String(title ?? '').slice(0, 2200),
            privacy_level: privacyLevel,
            disable_comment: Boolean(disableComment),
            disable_duet: Boolean(disableDuet),
            disable_stitch: Boolean(disableStitch),
            brand_content_toggle: Boolean(brandContent),
            brand_organic_toggle: Boolean(brandOrganic),
            is_aigc: Boolean(isAigc),
          },
          source_info: { source: 'PULL_FROM_URL', video_url: videoUrl },
        },
      });
      return r.data.publish_id;
    },

    /** @returns {{status:string, postIds:string[], failReason:string|null}} */
    async fetchPostStatus(token, publishId) {
      const r = await call('/post/publish/status/fetch/', { token, body: { publish_id: publishId } });
      return {
        status: r.data.status,
        postIds: (r.data.publicaly_available_post_id ?? r.data.publicly_available_post_id ?? []).map(String),
        failReason: r.data.fail_reason ?? null,
      };
    },
  },
);

module.exports = adapter;
