'use strict';

// Phase 7 integration tests: social accounts (OAuth), scheduling, publishing to TikTok / Facebook /
// Instagram and Shopee affiliate links. All platform APIs are mocked. Requires schema + seed + migrations.
process.env.NODE_ENV = 'test';
// Tokens are stored encrypted; the env module reads this at load time
process.env.APP_ENCRYPTION_KEY = process.env.APP_ENCRYPTION_KEY || Buffer.alloc(32, 7).toString('base64');

const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { createApp } = require('../src/app');
const db = require('../src/db/pool');
const { runDue } = require('../src/jobs/runner');
const { signState, verifyState } = require('../src/modules/social/accounts.service');
const { buildCaption } = require('../src/modules/social/publish');
const { decryptJson } = require('../src/utils/crypto');

const app = createApp();
const RUN = Date.now().toString(36);
const originalFetch = global.fetch;
const ENV = {
  TIKTOK_CLIENT_KEY: 'tt-key',
  TIKTOK_CLIENT_SECRET: 'tt-secret',
  TIKTOK_REDIRECT_URI: 'https://app.test/api/social/oauth/tiktok/callback',
  META_APP_ID: 'meta-app',
  META_APP_SECRET: 'meta-secret',
  META_REDIRECT_URI: 'https://app.test/api/social/oauth/meta/callback',
};
const ENV_KEYS = [...Object.keys(ENV), 'SHOPEE_AFFILIATE_APP_ID', 'SHOPEE_AFFILIATE_SECRET'];
const savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
let routes = {};
const calls = [];
const created = { accounts: [], links: [], videos: [] };
let marketer;
let viewer;
let cashier;
let videoId;

async function cookie(email) {
  const res = await request(app).post('/api/auth/login').send({ email, password: 'Admin@1234' });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  return res.headers['set-cookie'].map((c) => c.split(';')[0]).join('; ');
}
const as = (c) => ({
  get: (url) => request(app).get(url).set('Cookie', c),
  post: (url, body) => request(app).post(url).set('Cookie', c).send(body),
  patch: (url, body) => request(app).patch(url).set('Cookie', c).send(body),
  delete: (url) => request(app).delete(url).set('Cookie', c),
});
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const JOBS = "('social.publish','social.status')";

async function drain() {
  const { dispatchDue } = require('../src/modules/social/publish');
  await dispatchDue();
  await db.query(`UPDATE jobs SET run_at = UTC_TIMESTAMP() WHERE status = 'queued' AND type IN ${JOBS}`);
  await db.query(`UPDATE jobs SET run_at = UTC_TIMESTAMP() + INTERVAL 1 DAY WHERE status = 'queued' AND type NOT IN ${JOBS}`);
  return runDue({ maxJobs: 50 });
}
const post = (id) => db.one('SELECT * FROM scheduled_posts WHERE id = :id', { id });
const inMinutes = (m) => new Date(Date.now() + m * 60_000).toISOString();

let ttStatus = 'PROCESSING_DOWNLOAD';
let igStatus = 'IN_PROGRESS';
function mockPlatforms() {
  routes = {
    'open.tiktokapis.com/v2/oauth/token/': (url, init) => {
      const form = new URLSearchParams(init.body);
      if (form.get('grant_type') === 'refresh_token') return json({ access_token: 'tt-access-2', refresh_token: 'tt-refresh-2', open_id: `tt-${RUN}`, expires_in: 86400, scope: 'user.info.basic,video.publish' });
      return json({ access_token: 'tt-access-1', refresh_token: 'tt-refresh-1', open_id: `tt-${RUN}`, expires_in: 86400, refresh_expires_in: 31536000, scope: 'user.info.basic,video.publish' });
    },
    'open.tiktokapis.com/v2/user/info/': () => json({ data: { user: { open_id: `tt-${RUN}`, display_name: 'shopdemo', avatar_url: 'https://p.tiktokcdn.test/a.jpg' } }, error: { code: 'ok' } }),
    'open.tiktokapis.com/v2/post/publish/creator_info/query/': () =>
      json({ data: { creator_nickname: 'Shop Demo', creator_username: 'shopdemo', privacy_level_options: ['PUBLIC_TO_EVERYONE', 'SELF_ONLY'], comment_disabled: false, duet_disabled: true, stitch_disabled: false, max_video_post_duration_sec: 600 }, error: { code: 'ok' } }),
    'open.tiktokapis.com/v2/post/publish/video/init/': () => json({ data: { publish_id: 'v_pub_1' }, error: { code: 'ok' } }),
    'open.tiktokapis.com/v2/post/publish/status/fetch/': () =>
      json({ data: { status: ttStatus, publicaly_available_post_id: ttStatus === 'PUBLISH_COMPLETE' ? ['7300000000001'] : [] }, error: { code: 'ok' } }),
    'graph.facebook.com/v23.0/oauth/access_token': (url) =>
      json({ access_token: new URL(url).searchParams.get('grant_type') === 'fb_exchange_token' ? 'fb-long' : 'fb-short', expires_in: 5183944 }),
    'graph.facebook.com/v23.0/me/accounts': () =>
      json({ data: [{ id: `page-${RUN}`, name: 'ร้านเดโม Page', access_token: 'page-token', instagram_business_account: { id: `ig-${RUN}`, username: 'demo.ig' } }] }),
    [`graph.facebook.com/v23.0/page-${RUN}/video_reels`]: (url) =>
      new URL(url).searchParams.get('upload_phase') === 'start' ? json({ video_id: 'fbv1', upload_url: 'https://rupload.facebook.com/video-upload/v23.0/fbv1' }) : json({ success: true }),
    'rupload.facebook.com/video-upload/v23.0/fbv1': () => json({ success: true }),
    'graph.facebook.com/v23.0/fbv1': () => json({ id: 'fbv1', status: { video_status: 'ready', publishing_phase: { status: 'complete' } } }),
    [`graph.facebook.com/v23.0/ig-${RUN}/media_publish`]: () => json({ id: 'igm1' }),
    [`graph.facebook.com/v23.0/ig-${RUN}/media`]: () => json({ id: 'igc1' }),
    'graph.facebook.com/v23.0/igc1': () => json({ id: 'igc1', status_code: igStatus }),
    'graph.facebook.com/v23.0/igm1': () => json({ id: 'igm1', permalink: 'https://www.instagram.com/reel/abc/' }),
    'open-api.affiliate.shopee.co.th/graphql': (url, init) => {
      const sub = JSON.parse(init.body).variables.input.subIds[0] ?? 'none';
      return json({ data: { generateShortLink: { shortLink: `https://s.shopee.co.th/${sub}` } } });
    },
  };
}

async function connect(platform) {
  const start = await marketer.get(`/api/social/oauth/${platform}/start`);
  assert.equal(start.status, 200, JSON.stringify(start.body));
  const state = new URL(start.body.data.url).searchParams.get('state');
  const cb = await request(app).get(`/api/social/oauth/${platform}/callback`).query({ code: 'the-code', state });
  assert.equal(cb.status, 302);
  return cb.headers.location;
}
async function account(platform) {
  return db.one('SELECT * FROM social_accounts WHERE platform = :platform AND external_id LIKE :ext', { platform, ext: `%${RUN}` });
}

before(async () => {
  global.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    const key = Object.keys(routes).filter((k) => String(url).includes(k)).sort((a, b) => b.length - a.length)[0];
    if (!key) return new Response('not found', { status: 404 });
    return routes[key](String(url), init);
  };
  for (const k of ENV_KEYS) delete process.env[k];
  marketer = as(await cookie('marketer@example.com'));
  viewer = as(await cookie('viewer@example.com'));
  cashier = as(await cookie('cashier@example.com'));
  const v = await db.query(
    "INSERT INTO video_projects (org_id, product_id, title, status, output_url, duration_sec) VALUES (1, 1, :t, 'ready', 'https://media.example.com/v.mp4', 20)",
    { t: `T7 ${RUN}` },
  );
  videoId = v.insertId;
  created.videos.push(videoId);
});

after(async () => {
  global.fetch = originalFetch;
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
  await db.query(`DELETE FROM jobs WHERE type IN ${JOBS}`);
  await db.query("UPDATE jobs SET run_at = UTC_TIMESTAMP() WHERE status = 'queued' AND run_at > UTC_TIMESTAMP() + INTERVAL 20 HOUR");
  const accs = await db.query('SELECT id, credential_id FROM social_accounts WHERE external_id LIKE :e', { e: `%${RUN}` });
  if (accs.length) {
    await db.query('DELETE FROM scheduled_posts WHERE social_account_id IN (:ids)', { ids: accs.map((a) => a.id) });
    await db.query('DELETE FROM social_accounts WHERE id IN (:ids)', { ids: accs.map((a) => a.id) });
  }
  await db.query('DELETE FROM integration_credentials WHERE account_ref LIKE :e', { e: `%${RUN}` });
  await db.query('DELETE FROM scheduled_posts WHERE video_project_id IN (:ids)', { ids: created.videos });
  await db.query('DELETE FROM affiliate_links WHERE label LIKE :l OR original_url LIKE :u', { l: `%T7${RUN}%`, u: `%t7${RUN}%` });
  await db.query('DELETE FROM video_projects WHERE id IN (:ids)', { ids: created.videos });
  await db.pool.end();
});

describe('helpers (unit)', () => {
  test('OAuth state is signed, tamper-proof and expires', () => {
    const s = signState({ o: 1, u: 2, p: 'tiktok' });
    assert.deepEqual({ ...verifyState(s), n: undefined, exp: undefined }, { o: 1, u: 2, p: 'tiktok', n: undefined, exp: undefined });
    const [body, sig] = s.split('.');
    const forged = Buffer.from(JSON.stringify({ o: 99, u: 2, p: 'tiktok', exp: Date.now() + 1e6 })).toString('base64url');
    assert.equal(verifyState(`${forged}.${sig}`), null);
    // Flip the first character to a different one (a fixed 'x' would be a no-op when the signature starts with 'x')
    assert.equal(verifyState(`${body}.${sig[0] === 'x' ? 'y' : 'x'}${sig.slice(1)}`), null);
    assert.equal(verifyState('garbage'), null);
  });

  test('caption: Facebook gets the clickable link, TikTok/IG point to the bio', () => {
    const fb = buildCaption({ caption: 'ของดี', hashtags: '#รีวิว', linkUrl: 'https://s.shopee.co.th/x', placement: 'caption' });
    assert.equal(fb, 'ของดี\n\n#รีวิว\n\n🛒 สั่งซื้อ: https://s.shopee.co.th/x (ลิงก์ affiliate)');
    const tt = buildCaption({ caption: 'ของดี', hashtags: '', linkUrl: 'https://s.shopee.co.th/x', placement: 'bio' });
    assert.match(tt, /ลิงก์สั่งซื้ออยู่ในโปรไฟล์/);
    assert.doesNotMatch(tt, /https/);
    assert.equal(buildCaption({ caption: 'a', hashtags: '', linkUrl: null, placement: 'caption' }), 'a');
  });
});

describe('connecting accounts', () => {
  test('start refuses without app keys and names them', async () => {
    const res = await marketer.get('/api/social/oauth/tiktok/start');
    assert.equal(res.status, 503);
    assert.match(JSON.stringify(res.body), /TIKTOK_CLIENT_KEY/);
    assert.equal((await viewer.get('/api/social/oauth/tiktok/start')).status, 403);
    assert.equal((await cashier.get('/api/social/accounts')).status, 403);
  });

  test('TikTok OAuth stores an encrypted token and the account', async () => {
    Object.assign(process.env, ENV);
    mockPlatforms();
    const start = await marketer.get('/api/social/oauth/tiktok/start');
    const url = new URL(start.body.data.url);
    assert.equal(url.origin + url.pathname, 'https://www.tiktok.com/v2/auth/authorize/');
    assert.equal(url.searchParams.get('scope'), 'user.info.basic,video.publish');
    assert.equal(url.searchParams.get('redirect_uri'), ENV.TIKTOK_REDIRECT_URI);
    const location = await connect('tiktok');
    assert.match(location, /\/social\/accounts\?connected=tiktok/);
    const a = await account('tiktok');
    assert.equal(a.display_name, 'shopdemo');
    assert.equal(a.status, 'connected');
    const cred = await db.one('SELECT data_encrypted FROM integration_credentials WHERE id = :id', { id: a.credential_id });
    assert.doesNotMatch(cred.data_encrypted, /tt-access-1/);
    assert.equal(decryptJson(cred.data_encrypted).accessToken, 'tt-access-1');
    const tokenCall = calls.find((c) => c.url.includes('/oauth/token/'));
    assert.equal(new URLSearchParams(tokenCall.init.body).get('client_secret'), 'tt-secret');
  });

  test('bad or reused state is rejected without calling TikTok', async () => {
    calls.length = 0;
    const cb = await request(app).get('/api/social/oauth/tiktok/callback').query({ code: 'x', state: 'forged.state' });
    assert.equal(cb.status, 302);
    assert.match(decodeURIComponent(cb.headers.location), /error=/);
    assert.equal(calls.length, 0);
    const metaState = signState({ o: 1, u: 5, p: 'meta' });
    const wrong = await request(app).get('/api/social/oauth/tiktok/callback').query({ code: 'x', state: metaState });
    assert.match(decodeURIComponent(wrong.headers.location), /error=/);
  });

  test('Facebook Login connects the page and its Instagram account', async () => {
    const location = await connect('meta');
    assert.match(location, /connected=meta&count=2/);
    const fb = await account('facebook');
    const ig = await account('instagram');
    assert.equal(fb.display_name, 'ร้านเดโม Page');
    assert.equal(ig.display_name, '@demo.ig');
    assert.equal((typeof ig.meta === 'string' ? JSON.parse(ig.meta) : ig.meta).pageId, `page-${RUN}`);
    assert.ok(calls.some((c) => c.url.includes('grant_type=fb_exchange_token')));
    const list = await viewer.get('/api/social/accounts');
    assert.equal(list.status, 200);
    assert.ok(list.body.data.some((x) => x.platform === 'instagram' && x.status === 'connected'));
    assert.equal(list.body.data.find((x) => x.externalId === 'tt_open_id_demo').status, 'expired'); // demo account
    assert.equal(list.body.meta.callbackUrls.tiktok.endsWith('/api/social/oauth/tiktok/callback'), true);
  });

  test('TikTok creator info is exposed for the posting form', async () => {
    const a = await account('tiktok');
    const res = await marketer.get(`/api/social/accounts/${a.id}/creator-info`);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.deepEqual(res.body.data.privacyOptions, ['PUBLIC_TO_EVERYONE', 'SELF_ONLY']);
    assert.equal(res.body.data.duetDisabled, true);
  });
});

describe('scheduling and publishing', () => {
  test('validation: TikTok options required, video must be ready, no past times', async () => {
    const tt = await account('tiktok');
    const base = { accountIds: [tt.id], videoProjectId: videoId, caption: 'x', scheduledAt: inMinutes(30) };
    assert.equal((await marketer.post('/api/social/posts', base)).status, 400);
    const opts = { privacyLevel: 'PUBLIC_TO_EVERYONE' };
    assert.equal((await marketer.post('/api/social/posts', { ...base, tiktok: opts, scheduledAt: inMinutes(-30) })).status, 400);
    assert.equal((await marketer.post('/api/social/posts', { ...base, tiktok: { privacyLevel: 'SELF_ONLY', brandContent: true } })).status, 400);
    await db.query("UPDATE video_projects SET status = 'parts_ready' WHERE id = :id", { id: videoId });
    assert.equal((await marketer.post('/api/social/posts', { ...base, tiktok: opts })).status, 400);
    await db.query("UPDATE video_projects SET status = 'ready' WHERE id = :id", { id: videoId });
    assert.equal((await marketer.post('/api/social/posts', { ...base, accountIds: [tt.id], mediaUrl: 'http://insecure.test/v.mp4', videoProjectId: null, tiktok: opts })).status, 400);
    assert.equal((await viewer.post('/api/social/posts', { ...base, tiktok: opts })).status, 403);
  });

  test('one request schedules all three platforms with per-post affiliate links', async () => {
    process.env.SHOPEE_AFFILIATE_APP_ID = 'aff';
    process.env.SHOPEE_AFFILIATE_SECRET = 'aff-secret';
    const link = await marketer.post('/api/social/affiliate-links', { originalUrl: `https://shopee.co.th/product/1/t7${RUN}`, label: `T7${RUN}`, subId: 'base' });
    assert.equal(link.status, 201, JSON.stringify(link.body));
    assert.equal(link.body.data.shortUrl, 'https://s.shopee.co.th/base');
    const [tt, fb, ig] = [await account('tiktok'), await account('facebook'), await account('instagram')];
    const res = await marketer.post('/api/social/posts', {
      accountIds: [tt.id, fb.id, ig.id],
      videoProjectId: videoId,
      caption: 'เซรั่มตัวนี้ดีจริง',
      hashtags: '#รีวิว',
      affiliateLinkId: link.body.data.id,
      scheduledAt: inMinutes(5),
      tiktok: { privacyLevel: 'PUBLIC_TO_EVERYONE', brandContent: true },
    });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(res.body.data.ids.length, 3);
    const posts = await viewer.get(`/api/social/posts?from=${encodeURIComponent(inMinutes(-1))}&to=${encodeURIComponent(inMinutes(10))}`);
    const mine = posts.body.data.filter((p) => res.body.data.ids.includes(p.id));
    assert.equal(mine.length, 3);
    const byPlatform = Object.fromEntries(mine.map((p) => [p.platform, p]));
    assert.equal(byPlatform.facebook.linkPlacement, 'caption');
    assert.equal(byPlatform.tiktok.linkPlacement, 'bio');
    assert.match(byPlatform.facebook.affiliateUrl, new RegExp(`s\\.shopee\\.co\\.th/facebook${byPlatform.facebook.id}$`));
    assert.match(byPlatform.facebook.finalCaption, /สั่งซื้อ: https:\/\/s\.shopee\.co\.th\/facebook/);
  });

  test('due posts publish: TikTok direct post, Facebook reel, Instagram reel → published with permalinks', async () => {
    const ids = (await db.query('SELECT sp.id, sa.platform FROM scheduled_posts sp JOIN social_accounts sa ON sa.id = sp.social_account_id WHERE sa.external_id LIKE :e', { e: `%${RUN}` }));
    await db.query('UPDATE scheduled_posts SET scheduled_at = UTC_TIMESTAMP() - INTERVAL 1 MINUTE WHERE id IN (:ids)', { ids: ids.map((r) => r.id) });
    // Expire the TikTok token to exercise the refresh
    const tt = await account('tiktok');
    const { encryptJson } = require('../src/utils/crypto');
    await db.query('UPDATE integration_credentials SET data_encrypted = :d WHERE id = :id', {
      id: tt.credential_id,
      d: encryptJson({ accessToken: 'old', refreshToken: 'tt-refresh-1', expiresAt: Date.now() - 1000 }),
    });
    calls.length = 0;
    ttStatus = 'PROCESSING_DOWNLOAD';
    igStatus = 'IN_PROGRESS';
    await drain(); // publish all three; status polls queued
    const init = calls.find((c) => c.url.includes('/post/publish/video/init/'));
    assert.equal(init.init.headers.Authorization, 'Bearer tt-access-2');
    const body = JSON.parse(init.init.body);
    assert.equal(body.source_info.video_url, 'https://media.example.com/v.mp4');
    assert.equal(body.post_info.privacy_level, 'PUBLIC_TO_EVERYONE');
    assert.equal(body.post_info.brand_content_toggle, true);
    assert.equal(body.post_info.is_aigc, true);
    assert.equal(body.post_info.disable_duet, true); // creator setting wins
    assert.match(body.post_info.title, /ลิงก์สั่งซื้ออยู่ในโปรไฟล์/);
    const upload = calls.find((c) => c.url.includes('rupload.facebook.com'));
    assert.equal(upload.init.headers.file_url, 'https://media.example.com/v.mp4');
    assert.equal(upload.init.headers.Authorization, 'OAuth page-token');
    const igCreate = calls.find((c) => c.url.includes(`ig-${RUN}/media`) && !c.url.includes('media_publish'));
    assert.equal(new URL(igCreate.url).searchParams.get('media_type'), 'REELS');

    const status = async (platform) => (await post(ids.find((r) => r.platform === platform).id)).status;
    assert.equal(await status('tiktok'), 'publishing');
    ttStatus = 'PUBLISH_COMPLETE';
    igStatus = 'FINISHED';
    await drain(); // status polls
    for (const platform of ['tiktok', 'facebook', 'instagram']) assert.equal(await status(platform), 'published', platform);
    const results = await db.query('SELECT pr.permalink FROM post_results pr JOIN scheduled_posts sp ON sp.id = pr.scheduled_post_id WHERE sp.id IN (:ids)', { ids: ids.map((r) => r.id) });
    const links = results.map((r) => r.permalink).sort();
    assert.deepEqual(links, ['https://www.facebook.com/reel/fbv1', 'https://www.instagram.com/reel/abc/', 'https://www.tiktok.com/@shopdemo/video/7300000000001']);
    const cred = await db.one('SELECT data_encrypted FROM integration_credentials WHERE id = :id', { id: tt.credential_id });
    assert.equal(decryptJson(cred.data_encrypted).refreshToken, 'tt-refresh-2');
  });

  test('a platform error fails the post (no auto-retry); retry via publish-now', async () => {
    const tt = await account('tiktok');
    const res = await marketer.post('/api/social/posts', {
      accountIds: [tt.id], videoProjectId: videoId, caption: 'retry', scheduledAt: inMinutes(1), tiktok: { privacyLevel: 'PUBLIC_TO_EVERYONE' },
    });
    const id = res.body.data.ids[0];
    await db.query('UPDATE scheduled_posts SET scheduled_at = UTC_TIMESTAMP() - INTERVAL 1 MINUTE WHERE id = :id', { id });
    routes['open.tiktokapis.com/v2/post/publish/video/init/'] = () => json({ error: { code: 'spam_risk_too_many_posts', message: 'too many posts' } }, 403);
    await drain();
    let p = await post(id);
    assert.equal(p.status, 'failed');
    assert.match(p.error, /too many posts/);
    await drain();
    assert.equal(calls.filter((c) => c.url.includes('/video/init/')).length >= 1, true);
    assert.equal((await post(id)).attempts, 1); // not re-dispatched by itself
    mockPlatforms();
    ttStatus = 'PUBLISH_COMPLETE';
    assert.equal((await marketer.post(`/api/social/posts/${id}/publish-now`)).status, 200);
    await drain();
    await drain();
    p = await post(id);
    assert.equal(p.status, 'published');
    assert.equal(p.attempts, 2);
  });

  test('privacy not allowed by the creator is refused before posting', async () => {
    const tt = await account('tiktok');
    const res = await marketer.post('/api/social/posts', {
      accountIds: [tt.id], videoProjectId: videoId, caption: 'priv', scheduledAt: inMinutes(1), tiktok: { privacyLevel: 'FOLLOWER_OF_CREATOR' },
    });
    const id = res.body.data.ids[0];
    await db.query('UPDATE scheduled_posts SET scheduled_at = UTC_TIMESTAMP() - INTERVAL 1 MINUTE WHERE id = :id', { id });
    calls.length = 0;
    await drain();
    const p = await post(id);
    assert.equal(p.status, 'failed');
    assert.match(p.error, /FOLLOWER_OF_CREATOR/);
    assert.equal(calls.some((c) => c.url.includes('/video/init/')), false);
  });

  test('posts for demo (unconnected) accounts wait; reschedule, cancel and disconnect', async () => {
    const res = await marketer.post('/api/social/posts', { accountIds: [2], videoProjectId: videoId, caption: 'demo', scheduledAt: inMinutes(1) });
    assert.equal(res.status, 201);
    assert.equal(res.body.data.warnings.length, 1);
    const id = res.body.data.ids[0];
    await db.query('UPDATE scheduled_posts SET scheduled_at = UTC_TIMESTAMP() - INTERVAL 1 MINUTE WHERE id = :id', { id });
    await drain();
    assert.equal((await post(id)).status, 'scheduled'); // never dispatched
    assert.equal((await marketer.post(`/api/social/posts/${id}/publish-now`)).status, 409);
    const moved = await marketer.patch(`/api/social/posts/${id}`, { scheduledAt: inMinutes(120), caption: 'ใหม่' });
    assert.equal(moved.status, 200);
    assert.equal(moved.body.data.caption, 'ใหม่');
    assert.equal((await marketer.post(`/api/social/posts/${id}/cancel`)).status, 200);
    assert.equal((await post(id)).status, 'cancelled');
    assert.equal((await marketer.patch(`/api/social/posts/${id}`, { caption: 'x' })).status, 409);

    const fb = await account('facebook');
    const later = await marketer.post('/api/social/posts', { accountIds: [fb.id], videoProjectId: videoId, caption: 'later', scheduledAt: inMinutes(300) });
    assert.equal((await marketer.delete(`/api/social/accounts/${fb.id}`)).status, 200);
    const after = await account('facebook');
    assert.equal(after.credential_id, null);
    assert.equal(after.status, 'expired');
    assert.equal((await post(later.body.data.ids[0])).status, 'draft');
  });

  test('affiliate links: Shopee needs keys; other links stored as-is', async () => {
    delete process.env.SHOPEE_AFFILIATE_APP_ID;
    const shopee = await marketer.post('/api/social/affiliate-links', { originalUrl: `https://shopee.co.th/product/2/t7${RUN}` });
    assert.equal(shopee.status, 503);
    const other = await marketer.post('/api/social/affiliate-links', { originalUrl: `https://brand.example.com/t7${RUN}`, label: `T7${RUN} other` });
    assert.equal(other.status, 201);
    assert.equal(other.body.data.platform, 'other');
    assert.equal(other.body.data.shortUrl, null);
    const list = await viewer.get('/api/social/affiliate-links');
    assert.ok(list.body.data.some((l) => l.id === other.body.data.id));
    assert.equal((await marketer.delete(`/api/social/affiliate-links/${other.body.data.id}`)).status, 200);
  });
});
