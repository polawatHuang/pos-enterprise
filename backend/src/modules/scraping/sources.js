'use strict';

const db = require('../../db/pool');
const logger = require('../../core/logger');
const { badRequest } = require('../../core/errors');
const { enqueue } = require('../../jobs/queue');
const shopeeAffiliate = require('../../integrations/shopee-affiliate');
const apify = require('../../integrations/apify');
const { upsertItems } = require('./trends.service');

const USER_AGENT = 'POSEnterpriseBot/1.0 (+product research; respects robots.txt)';
const MAX_PAGE_BYTES = 2 * 1024 * 1024;
const APIFY_POLL_MS = 60_000;
const APIFY_MAX_POLLS = 60;

/** Which platforms can run, and what each needs. TikTok Shop's official API only exposes your own shop. */
const PLATFORMS = {
  shopee_affiliate: { method: 'official_api', adapter: shopeeAffiliate, runnable: true },
  apify: { method: 'scraping_service', adapter: apify, runnable: true },
  custom_url: { method: 'http_fetch', adapter: null, runnable: true },
  tiktok_shop: {
    method: 'official_api',
    adapter: null,
    runnable: false,
    reason: 'TikTok Shop Partner API ให้ข้อมูลเฉพาะสินค้าของร้านตัวเอง ไม่มีข้อมูลสินค้าขายดีของตลาด ใช้การนำเข้า CSV จากเครื่องมือวิเคราะห์แทน',
  },
  shopee: {
    method: 'official_api',
    adapter: null,
    runnable: false,
    reason: 'Shopee Open Platform ให้ข้อมูลเฉพาะร้านตัวเอง ใช้ Shopee Affiliate (ค่าคอม/ยอดขายทั้งตลาด) แทน',
  },
};

const parseJson = (v) => (v == null ? {} : typeof v === 'string' ? JSON.parse(v) : v);

/* --------------------------------------------------------- custom_url (JSON-LD) */

/** Minimal robots.txt check for our user agent (falls back to the "*" group). */
async function robotsAllows(url) {
  const u = new URL(url);
  let text;
  try {
    const res = await fetch(`${u.origin}/robots.txt`, { headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(8000) });
    if (res.status >= 500) return false; // server error: treat the whole site as disallowed (Google does the same)
    if (!res.ok) return true; // no robots.txt
    text = await res.text();
  } catch {
    return false;
  }
  const groups = [];
  let current = null;
  for (const line of text.split(/\r?\n/)) {
    const [k, ...rest] = line.replace(/#.*/, '').split(':');
    const key = k.trim().toLowerCase();
    const value = rest.join(':').trim();
    if (key === 'user-agent') {
      if (!current || current.rules.length) groups.push((current = { agents: [], rules: [] }));
      current.agents.push(value.toLowerCase());
    } else if ((key === 'allow' || key === 'disallow') && current) current.rules.push({ allow: key === 'allow', path: value });
  }
  const mine = groups.find((g) => g.agents.some((a) => a !== '*' && USER_AGENT.toLowerCase().startsWith(a))) ?? groups.find((g) => g.agents.includes('*'));
  if (!mine) return true;
  const path = `${u.pathname}${u.search}`;
  let best = null;
  for (const r of mine.rules) {
    if (!r.path) continue;
    const prefix = r.path.replace(/\*.*$/, '').replace(/\$$/, '');
    if (path.startsWith(prefix) && (!best || prefix.length > best.len || (prefix.length === best.len && r.allow))) best = { len: prefix.length, allow: r.allow };
  }
  return best ? best.allow : true;
}

/** schema.org Product objects from <script type="application/ld+json"> blocks (incl. @graph and arrays). */
function extractJsonLdProducts(html) {
  const out = [];
  const re = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  const visit = (node) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) return node.forEach(visit);
    const type = [].concat(node['@type'] ?? []);
    if (type.includes('Product')) out.push(node);
    if (node['@graph']) visit(node['@graph']);
  };
  let m;
  while ((m = re.exec(html))) {
    try {
      visit(JSON.parse(m[1].trim()));
    } catch {
      /* ignore malformed blocks */
    }
  }
  return out;
}

function jsonLdToItem(p, pageUrl) {
  const offer = [].concat(p.offers ?? [])[0] ?? {};
  const price = offer.price ?? offer.lowPrice ?? null;
  const image = [].concat(p.image ?? [])[0];
  return {
    platform: new URL(pageUrl).hostname.replace(/^www\./, '').slice(0, 30),
    externalId: p.sku ?? p.productID ?? p.mpn ?? p.url ?? pageUrl,
    title: p.name,
    url: p.url ?? pageUrl,
    imageUrl: typeof image === 'string' ? image : image?.url ?? null,
    shopName: p.brand?.name ?? (typeof p.brand === 'string' ? p.brand : null),
    price,
    rating: p.aggregateRating?.ratingValue ?? null,
    soldCount: null,
    category: typeof p.category === 'string' ? p.category : null,
  };
}

async function fetchProductPage(url) {
  if (!/^https?:\/\//i.test(url)) throw badRequest(`URL ไม่ถูกต้อง: ${url}`);
  const host = new URL(url).hostname;
  if (/(^|\.)(shopee\.|tiktok\.com|lazada\.)/i.test(host)) {
    throw badRequest(`${host} ไม่อนุญาตให้ดึงข้อมูลด้วยบอท ใช้ API ทางการหรือนำเข้า CSV แทน`);
  }
  if (!(await robotsAllows(url))) throw badRequest(`robots.txt ของ ${host} ไม่อนุญาตให้ดึงหน้านี้`);
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT, Accept: 'text/html' }, signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw badRequest(`โหลด ${url} ไม่สำเร็จ (HTTP ${res.status})`);
  const len = Number(res.headers.get('content-length') ?? 0);
  if (len > MAX_PAGE_BYTES) throw badRequest(`หน้า ${url} ใหญ่เกิน 2 MB`);
  const html = (await res.text()).slice(0, MAX_PAGE_BYTES);
  return extractJsonLdProducts(html).map((p) => jsonLdToItem(p, url));
}

/* ------------------------------------------------------------------- Apify */

/** Map Apify dataset items using config.fieldMap ({title:'name', price:'price.value', ...}). */
function mapApifyItems(items, config) {
  const fm = { title: 'title', externalId: 'id', url: 'url', imageUrl: 'image', shopName: 'shopName', price: 'price', soldCount: 'sold', rating: 'rating', commissionRate: 'commission', category: 'category', ...(config.fieldMap ?? {}) };
  const get = (obj, path) => String(path).split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
  return items.map((it) => ({
    platform: config.platform ?? 'apify',
    ...Object.fromEntries(Object.entries(fm).map(([field, path]) => [field, get(it, path) ?? null])),
  }));
}

/* ------------------------------------------------------------------- runs */

async function startRun(sourceId, userId = null) {
  const r = await db.query("INSERT INTO scrape_runs (source_id, status, triggered_by) VALUES (:sourceId, 'running', :userId)", { sourceId, userId });
  await enqueue('scrape.run', { runId: r.insertId }, { maxAttempts: 2 });
  return r.insertId;
}

async function finishRun(run, source, stats) {
  await db.query(
    "UPDATE scrape_runs SET status = 'succeeded', items_found = :found, items_new = :created, finished_at = UTC_TIMESTAMP() WHERE id = :id",
    { id: run.id, found: stats.found, created: stats.created },
  );
  await db.query('UPDATE scrape_sources SET last_run_at = UTC_TIMESTAMP(), last_error = NULL WHERE id = :id', { id: source.id });
  return { status: 'succeeded', ...stats };
}

async function failRun(run, source, err) {
  const message = String(err?.message ?? err).slice(0, 2000);
  await db.query("UPDATE scrape_runs SET status = 'failed', error = :message, finished_at = UTC_TIMESTAMP() WHERE id = :id", { id: run.id, message });
  await db.query('UPDATE scrape_sources SET last_run_at = UTC_TIMESTAMP(), last_error = :message WHERE id = :id', { id: source.id, message });
  return { status: 'failed', error: message };
}

async function loadRun(runId) {
  const run = await db.one('SELECT * FROM scrape_runs WHERE id = :runId', { runId });
  if (!run) return {};
  const source = await db.one('SELECT * FROM scrape_sources WHERE id = :id', { id: run.source_id });
  return { run, source };
}

/**
 * Job: execute one run. Errors are recorded on the run (not rethrown) except transient
 * network failures on the first attempt, which the queue retries.
 */
async function executeRun(runId) {
  const { run, source } = await loadRun(runId);
  if (!run || run.status !== 'running') return { status: 'skipped' };
  const config = parseJson(source.config);
  const platform = PLATFORMS[source.platform];
  try {
    if (!platform?.runnable) throw badRequest(platform?.reason ?? `ไม่รองรับแหล่งข้อมูล ${source.platform}`);
    if (source.platform === 'shopee_affiliate') {
      const pages = Math.min(5, Math.max(1, Number(config.pages) || 1));
      const items = [];
      for (let page = 1; page <= pages; page += 1) {
        const r = await shopeeAffiliate.productOfferList({ keyword: config.keyword || null, sortType: config.sortType ?? 'sales', page, limit: config.limit ?? 50 });
        items.push(...r.items);
        if (!r.hasNextPage) break;
      }
      return finishRun(run, source, await upsertItems({ orgId: source.org_id, sourceId: source.id, items }));
    }
    if (source.platform === 'custom_url') {
      const urls = [].concat(config.urls ?? []).slice(0, 10);
      if (!urls.length) throw badRequest('ยังไม่ได้ใส่ URL ในการตั้งค่าแหล่งข้อมูล');
      const items = [];
      for (const url of urls) items.push(...(await fetchProductPage(url)));
      if (!items.length) throw badRequest('ไม่พบข้อมูลสินค้า (schema.org Product) ในหน้าที่ระบุ');
      return finishRun(run, source, await upsertItems({ orgId: source.org_id, sourceId: source.id, items }));
    }
    if (source.platform === 'apify') {
      if (!config.actorId) throw badRequest('ยังไม่ได้ระบุ actorId ของ Apify');
      const started = await apify.runActor(config.actorId, config.input ?? {});
      await db.query('UPDATE scrape_runs SET external_run_id = :ext WHERE id = :id', { id: run.id, ext: started.runId });
      await enqueue('scrape.poll', { runId: run.id, polls: 1 }, { runAt: new Date(Date.now() + APIFY_POLL_MS), maxAttempts: 3 });
      return { status: 'waiting', externalRunId: started.runId };
    }
    throw badRequest(`ไม่รองรับแหล่งข้อมูล ${source.platform}`);
  } catch (err) {
    logger.warn({ err: err.message, runId }, 'scrape run failed');
    return failRun(run, source, err);
  }
}

/** Job: check an Apify run; re-queue itself until it finishes. */
async function pollRun(runId, polls = 1) {
  const { run, source } = await loadRun(runId);
  if (!run || run.status !== 'running' || !run.external_run_id) return { status: 'skipped' };
  try {
    const r = await apify.getRun(run.external_run_id);
    if (['READY', 'RUNNING'].includes(r.status)) {
      if (polls >= APIFY_MAX_POLLS) throw new Error(`Apify run ยังไม่เสร็จหลัง ${APIFY_MAX_POLLS} นาที`);
      await enqueue('scrape.poll', { runId, polls: polls + 1 }, { runAt: new Date(Date.now() + APIFY_POLL_MS), maxAttempts: 3 });
      return { status: 'waiting', apifyStatus: r.status };
    }
    if (r.status !== 'SUCCEEDED') throw new Error(`Apify run จบด้วยสถานะ ${r.status}`);
    const items = mapApifyItems(await apify.getDatasetItems(r.datasetId), parseJson(source.config));
    return finishRun(run, source, await upsertItems({ orgId: source.org_id, sourceId: source.id, items }));
  } catch (err) {
    return failRun(run, source, err);
  }
}

/** Recurring: queue a run for every active source whose interval has elapsed (one open run at a time). */
async function scheduleDueSources() {
  const due = await db.query(
    `SELECT s.id FROM scrape_sources s
      WHERE s.is_active = 1 AND s.interval_hours IS NOT NULL
        AND (s.last_run_at IS NULL OR s.last_run_at <= UTC_TIMESTAMP() - INTERVAL s.interval_hours HOUR)
        AND NOT EXISTS (SELECT 1 FROM scrape_runs r WHERE r.source_id = s.id AND r.status = 'running'
                         AND r.started_at > UTC_TIMESTAMP() - INTERVAL 2 HOUR)`,
  );
  for (const s of due) await startRun(s.id);
  return due.length;
}

module.exports = {
  PLATFORMS,
  startRun,
  executeRun,
  pollRun,
  scheduleDueSources,
  robotsAllows,
  extractJsonLdProducts,
  mapApifyItems,
  USER_AGENT,
};
