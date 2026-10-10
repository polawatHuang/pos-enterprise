'use strict';

const { defineAdapter } = require('./define');
const { notImplemented } = require('../core/errors');

// Interface is fixed now so modules can be built against it; bodies land in phase 7.
const planned = (method) => () => {
  adapter.requireConfig();
  throw notImplemented(`TikTok Login Kit + Content Posting API: ${method} จะเปิดใช้งานในเฟสที่ 7`);
};

const adapter = defineAdapter(
  {
    id: 'tiktok',
    name: 'TikTok Login Kit + Content Posting API',
    category: 'social',
    usedBy: ['social'],
    phase: 7,
    purpose: 'เชื่อมบัญชี TikTok (OAuth) และโพสต์วิดีโอตามเวลาที่ตั้งไว้ (Direct Post)',
    applyUrl: 'https://developers.tiktok.com/',
    env: [
      { name: 'TIKTOK_CLIENT_KEY' },
      { name: 'TIKTOK_CLIENT_SECRET' },
      { name: 'TIKTOK_REDIRECT_URI' },
    ],
  },
  {
    /** Build https://www.tiktok.com/v2/auth/authorize/ URL with scopes user.info.basic,video.publish,video.upload */
    getAuthorizeUrl: planned('getAuthorizeUrl'),
    /** POST https://open.tiktokapis.com/v2/oauth/token/ (grant_type=authorization_code) */
    exchangeCode: planned('exchangeCode'),
    /** POST https://open.tiktokapis.com/v2/oauth/token/ (grant_type=refresh_token) */
    refreshToken: planned('refreshToken'),
    /** POST https://open.tiktokapis.com/v2/post/publish/creator_info/query/ (required before every Direct Post) */
    queryCreatorInfo: planned('queryCreatorInfo'),
    /** POST https://open.tiktokapis.com/v2/post/publish/video/init/ (source=PULL_FROM_URL from a verified domain) */
    initDirectPost: planned('initDirectPost'),
    /** POST https://open.tiktokapis.com/v2/post/publish/status/fetch/ */
    fetchPostStatus: planned('fetchPostStatus'),
  },
);

module.exports = adapter;
