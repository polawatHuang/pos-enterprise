'use strict';

const db = require('../../db/pool');
const logger = require('../../core/logger');
const ai = require('../../integrations/ai');
const shopeeAffiliate = require('../../integrations/shopee-affiliate');
const { enqueue } = require('../../jobs/queue');
const { upsertItems } = require('./trends.service');

/**
 * "AI ค้นหาสินค้าขายดี": the AI provider searches the web (server-side web_search tool on MiniMax or
 * Claude) for products trending in Thailand, then we keep only findings backed by a page the search
 * actually returned, and import them as trend items. Runs as a chain of `scrape.ai` jobs so one
 * long model call never shares a cron tick with the next step:
 *   research (→ research … on pause_turn) → [extract when the model answered in prose] → import
 * Numbers in articles are not verified data, so candidates are imported without sold/price figures;
 * when Shopee Affiliate is configured each finding is looked up there to get real listings.
 */

const SEARCH_TIMEOUT_MS = 150_000;
const MAX_CONTINUATIONS = 3;
const MAX_SEARCHES = 5;
const DEFAULT_COUNT = 8;
const SHOPEE_PER_PRODUCT = 5;
const STAGES = { research: 'searching', extract: 'summarizing', import: 'importing' };

const PLATFORM_LABEL = { shopee: 'Shopee', tiktok_shop: 'TikTok Shop', lazada: 'Lazada', any: 'ทุกแพลตฟอร์ม' };
const TREND_STAGES = ['emerging', 'rising', 'peak', 'declining'];

const parseJson = (v) => (v == null ? null : typeof v === 'string' ? JSON.parse(v) : v);
const cut = (v, n) => (v == null ? null : String(v).trim().slice(0, n) || null);

/** Lets the sources list treat AI search like other adapters (configured / missing env of the active provider). */
const aiAdapter = {
  get meta() {
    return ai.active().meta;
  },
  isConfigured: () => ai.isConfigured(),
  requireConfig: () => ai.requireConfig(),
};

/** Server-side web search. MiniMax gets the bare declaration: optional fields are not confirmed there. */
function webSearchTool(provider = ai.providerId()) {
  const base = { type: 'web_search_20250305', name: 'web_search' };
  if (provider !== 'anthropic') return base;
  return { ...base, max_uses: MAX_SEARCHES, user_location: { type: 'approximate', country: 'TH', timezone: 'Asia/Bangkok' } };
}

const str = (description, max) => ({ type: 'string', description, ...(max ? { maxLength: max } : {}) });
const PRODUCTS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['products'],
  properties: {
    products: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['title', 'category', 'searchKeywords', 'whyTrending', 'trendStage', 'evidence'],
        properties: {
          title: str('ชื่อสินค้าแบบทั่วไป (ไม่ใช่ชื่อร้าน/ลิงก์เฉพาะ) เช่น "พัดลมพกพาคล้องคอ"'),
          category: str('หมวดสินค้า'),
          searchKeywords: { type: 'array', items: { type: 'string' }, description: 'คำค้นภาษาไทย 1-3 คำ ใช้ค้นใน Shopee/TikTok Shop ได้จริง' },
          whyTrending: str('ทำไมกำลังขายดี/มาแรง 1-2 ประโยค อ้างจากแหล่ง'),
          trendStage: { type: 'string', enum: TREND_STAGES, description: 'emerging=เริ่มมา, rising=กำลังขึ้น, peak=พีก/อิ่มตัว, declining=ขาลง' },
          platforms: { type: 'array', items: { type: 'string' }, description: 'แพลตฟอร์มที่แหล่งพูดถึง เช่น Shopee, TikTok Shop' },
          evidence: {
            type: 'array',
            description: 'แหล่งอ้างอิงจากผลค้นเว็บ ต้องเป็น URL ที่ค้นเจอจริงเท่านั้น',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['url'],
              properties: { url: str('URL ของหน้าที่ค้นเจอ'), title: str('ชื่อหน้า'), quote: str('ข้อความสั้นๆ จากหน้านั้นที่สนับสนุน') },
            },
          },
          soldHint: { type: ['string', 'null'], description: 'ตัวเลขยอดขายตามที่แหล่งเขียนไว้ตรงตัว (ถ้ามี) ห้ามคำนวณหรือเดา' },
          priceHint: { type: ['string', 'null'], description: 'ช่วงราคาตามที่แหล่งเขียนไว้ (ถ้ามี)' },
          risks: { type: 'array', items: { type: 'string' }, description: 'ข้อควรระวัง เช่น ต้องมี อย. เคลมเกินจริง ของปลอม คู่แข่งเยอะ' },
        },
      },
    },
  },
};
const SUBMIT_TOOL = { name: 'submit_products', description: 'ส่งรายการสินค้าที่ค้นพบพร้อมแหล่งอ้างอิง', input_schema: PRODUCTS_SCHEMA };

const SYSTEM = `คุณเป็นนักวิจัยตลาดอีคอมเมิร์ซไทย ช่วยนายหน้า (affiliate) หา "สินค้าที่กำลังจะเป็นกระแส" บน Shopee / TikTok Shop
หลักการเลือก (จากหนังสือคู่มือทำนายหน้า):
- สินค้ากระแสไม่เท่ากับสินค้าขายดี: เลือกสินค้าที่ความต้องการกำลังขึ้น (emerging/rising) มากกว่าตัวที่ทุกคนขายอยู่แล้ว (peak)
- หลีกเลี่ยงสินค้าอันดับต้นๆ ที่ตลาดอิ่มตัว ถ้าเจอให้ระบุ trendStage เป็น peak ตามจริง
- หลีกเลี่ยงสินค้าที่ขายได้ด้วยการเคลมสรรพคุณทางการแพทย์ อาหารเสริมลดน้ำหนัก หรือสินค้าผิดกฎหมาย
วิธีทำงาน:
- ใช้เครื่องมือ web_search ค้นหลายมุม (ข่าว/บทความสินค้าขายดี, เทรนด์ TikTok, สินค้ามาแรงเดือนนี้) เน้นข้อมูลล่าสุด
- ทุกสินค้าต้องมี evidence เป็น URL ที่ค้นเจอจริงจากเครื่องมือเท่านั้น ห้ามแต่ง URL
- ห้ามแต่งตัวเลข ถ้าแหล่งไม่ได้ระบุยอดขาย/ราคาให้ใส่ null
- เมื่อค้นพอแล้ว เรียกเครื่องมือ submit_products ครั้งเดียวพร้อมรายการทั้งหมด เขียนภาษาไทย`;

function buildPrompt({ config, profile, today }) {
  const count = clampCount(config.count);
  const platform = PLATFORM_LABEL[config.platformFocus] ?? PLATFORM_LABEL.any;
  const lines = [`วันนี้คือ ${today} ค้นหาสินค้าที่กำลังขายดี/มาแรงในไทยช่วง 30 วันล่าสุด จำนวน ${count} รายการ`, `แพลตฟอร์มที่สนใจ: ${platform}`];
  if (config.focus) lines.push(`เน้นหมวด/คำค้น: ${config.focus}`);
  if (profile) {
    const interests = parseJson(profile.interests) ?? [];
    lines.push(
      `ช่องของเรา "${profile.name}" ${profile.on_camera ? '' : '(ไม่ออกหน้ากล้อง)'}: ${profile.persona}`,
      interests.length ? `ความสนใจของช่อง: ${interests.join(', ')} — ให้น้ำหนักสินค้าที่เข้ากับช่อง` : '',
    );
  }
  return lines.filter(Boolean).join('\n');
}

const clampCount = (v) => Math.min(15, Math.max(3, Math.round(Number(v) || DEFAULT_COUNT)));

/* ------------------------------------------------------------- verification */

/** host + path, lower-case, no www/query/fragment/trailing slash — enough to match a cited page to a search hit. */
function normUrl(u) {
  try {
    const x = new URL(String(u));
    if (!/^https?:$/.test(x.protocol)) return null;
    return `${x.hostname.replace(/^www\./, '')}${x.pathname.replace(/\/+$/, '')}`.toLowerCase();
  } catch {
    return null;
  }
}

/** Search hits from server-side web_search result blocks (Anthropic Messages format). */
function searchHits(content) {
  const hits = [];
  for (const block of content ?? []) {
    if (block?.type !== 'web_search_tool_result' || !Array.isArray(block.content)) continue;
    for (const r of block.content) if (r?.url) hits.push({ url: String(r.url), title: cut(r.title, 300) });
  }
  return hits;
}
const countSearches = (content) => (content ?? []).filter((b) => b?.type === 'server_tool_use').length;

/**
 * Keep only evidence whose page the search really returned, drop findings left without any,
 * dedupe by title and cap the count. Returns what was dropped and why, for the run summary.
 */
function verifyFindings(products, hits, count) {
  const byUrl = new Map(hits.map((h) => [normUrl(h.url), h]).filter(([k]) => k));
  const seen = new Set();
  const kept = [];
  const dropped = [];
  for (const p of Array.isArray(products) ? products : []) {
    const title = cut(p?.title, 200);
    if (!title) continue;
    const key = title.toLowerCase().replace(/\s+/g, ' ');
    if (seen.has(key)) continue;
    const evidence = [];
    for (const e of Array.isArray(p.evidence) ? p.evidence : []) {
      const hit = byUrl.get(normUrl(e?.url));
      if (hit && !evidence.some((x) => x.url === hit.url)) evidence.push({ url: hit.url, title: cut(e.title, 300) ?? hit.title, quote: cut(e.quote, 500) });
    }
    if (!evidence.length) {
      dropped.push({ title, reason: 'ไม่มีแหล่งอ้างอิงที่ตรงกับผลค้นเว็บจริง' });
      continue;
    }
    seen.add(key);
    kept.push({
      title,
      category: cut(p.category, 191),
      searchKeywords: (Array.isArray(p.searchKeywords) ? p.searchKeywords : [])
        .map((k) => cut(k, 100))
        .filter(Boolean)
        .slice(0, 3),
      whyTrending: cut(p.whyTrending, 1000),
      trendStage: TREND_STAGES.includes(p.trendStage) ? p.trendStage : null,
      platforms: (Array.isArray(p.platforms) ? p.platforms : [])
        .map((x) => cut(x, 40))
        .filter(Boolean)
        .slice(0, 4),
      evidence: evidence.slice(0, 5),
      soldHint: cut(p.soldHint, 200),
      priceHint: cut(p.priceHint, 200),
      risks: (Array.isArray(p.risks) ? p.risks : [])
        .map((r) => cut(r, 300))
        .filter(Boolean)
        .slice(0, 5),
    });
  }
  const capped = kept.slice(0, count);
  for (const p of kept.slice(count)) dropped.push({ title: p.title, reason: 'เกินจำนวนที่ขอ' });
  return { kept: capped, dropped };
}

/* ------------------------------------------------------------------ import */

/**
 * Findings → trend items. With Shopee Affiliate, real listings for each finding's keyword (with
 * numbers and links); otherwise one "AI พบ" candidate per finding with no figures and no product URL
 * (an article link is not a listing, so the affiliate-link action stays off).
 */
async function toItems(products, { runId, config }) {
  const useShopee = config.enrich !== false && shopeeAffiliate.isConfigured();
  const platform = ['shopee', 'tiktok_shop', 'lazada'].includes(config.platformFocus) ? config.platformFocus : 'other';
  const items = [];
  let enriched = 0;
  for (const p of products) {
    const aiSearch = { runId, ...p, foundAt: new Date().toISOString() };
    if (useShopee) {
      try {
        const keyword = p.searchKeywords[0] ?? p.title;
        const r = await shopeeAffiliate.productOfferList({ keyword, sortType: 'sales', page: 1, limit: SHOPEE_PER_PRODUCT });
        if (r.items.length) {
          enriched += 1;
          for (const it of r.items)
            items.push({ ...it, category: it.category ?? p.category, raw: { ...(it.raw ?? {}), aiSearch: { ...aiSearch, verified: true, keyword } } });
          continue;
        }
      } catch (err) {
        logger.warn({ err: err.message, runId }, 'ai search: shopee lookup failed, importing as candidate');
      }
    }
    items.push({ platform, title: p.title, category: p.category, raw: { aiSearch: { ...aiSearch, verified: false } } });
  }
  return { items, enriched };
}

/* ------------------------------------------------------------------- steps */

const setRun = (id, fields) => {
  const sets = Object.keys(fields).map((k) => `${k} = :${k}`);
  const params = { id, ...fields };
  if ('state' in fields) params.state = JSON.stringify(fields.state);
  return db.query(`UPDATE scrape_runs SET ${sets.join(', ')} WHERE id = :id`, params);
};

async function next(runId, step, state) {
  await setRun(runId, { stage: STAGES[step], state: { ...state, step } });
  await enqueue('scrape.ai', { runId, step }, { maxAttempts: 1 });
}

/** Called by executeRun for an ai_search source: validate and queue the first step. */
async function startAiRun(run, source) {
  ai.requireConfig();
  const config = parseJson(source.config) ?? {};
  const profile = config.channelProfileId
    ? await db.one('SELECT * FROM channel_profiles WHERE id = :id AND org_id = :orgId', { id: config.channelProfileId, orgId: source.org_id })
    : await db.one('SELECT * FROM channel_profiles WHERE org_id = :orgId AND is_default = 1 LIMIT 1', { orgId: source.org_id });
  const today = new Date().toLocaleDateString('th-TH', { dateStyle: 'long', timeZone: 'Asia/Bangkok' });
  const prompt = buildPrompt({ config, profile, today });
  await next(run.id, 'research', {
    config: { ...config, count: clampCount(config.count) },
    profile: profile ? { id: profile.id, name: profile.name } : null,
    messages: [{ role: 'user', content: prompt }],
    hits: [],
    searches: 0,
    continuations: 0,
  });
  return { status: 'waiting', step: 'research' };
}

/** Human-readable reason for provider errors (the search tool is beta on MiniMax). */
function explain(err) {
  const msg = String(err?.message ?? err);
  if (err?.code === 'INTEGRATION_NOT_CONFIGURED') return msg;
  if (err?.status === 400 && /web_search|server.?tool|tool|function name/i.test(msg)) {
    return `ผู้ให้บริการ AI ยังไม่รองรับการค้นเว็บสำหรับ key/รุ่นนี้ (${ai.providerId()}): ${msg.slice(0, 300)}`;
  }
  if (/timed? ?out|ETIMEDOUT|aborted/i.test(msg)) return 'AI ค้นเว็บนานเกินไป ลองใหม่อีกครั้ง หรือลดจำนวนสินค้า/ระบุหมวดให้แคบลง';
  return msg;
}

async function research(run, state) {
  const res = await ai.createMessage({
    system: SYSTEM,
    messages: state.messages,
    tools: [webSearchTool(), SUBMIT_TOOL],
    maxTokens: 8000,
    timeoutMs: SEARCH_TIMEOUT_MS,
    maxRetries: 0, // a retry would search (and bill) again
  });
  const hits = [...state.hits, ...searchHits(res.content)];
  const searches = state.searches + countSearches(res.content);
  const model = res.model ?? state.model ?? null;
  const submit = (res.content ?? []).find((b) => b.type === 'tool_use' && b.name === 'submit_products');
  if (submit) return next(run.id, 'import', { ...state, messages: null, hits, searches, model, products: submit.input?.products ?? [] });
  if (res.stop_reason === 'pause_turn' && state.continuations < MAX_CONTINUATIONS) {
    // Long server-side search loop: send the turn back unchanged so the provider resumes it
    return next(run.id, 'research', {
      ...state,
      messages: [...state.messages, { role: 'assistant', content: res.content }],
      hits,
      searches,
      model,
      continuations: state.continuations + 1,
    });
  }
  const text = ai
    .textOf(res)
    .replace(/<think>[\s\S]*?<\/think>/g, '')
    .trim();
  if (!text) throw new Error('AI ไม่ได้ส่งผลการค้นหากลับมา ลองใหม่อีกครั้ง');
  return next(run.id, 'extract', { ...state, messages: null, hits, searches, model, transcript: text.slice(0, 20_000) });
}

async function extract(run, state) {
  const sources = state.hits.map((h) => `- ${h.title ?? ''} ${h.url}`).join('\n');
  const { data } = await ai.extractStructured({
    system: 'แปลงสรุปผลการค้นหาสินค้าให้เป็นรายการตาม schema ใช้เฉพาะข้อมูลในข้อความ ห้ามแต่งเพิ่ม evidence ต้องเป็น URL จากรายการแหล่งที่ค้นเจอเท่านั้น',
    schema: PRODUCTS_SCHEMA,
    toolName: 'submit_products',
    toolDescription: SUBMIT_TOOL.description,
    maxTokens: 6000,
    content: [{ type: 'text', text: `สรุปผลการค้นหา:\n${state.transcript}\n\nแหล่งที่ค้นเจอ:\n${sources || '-'}` }],
  });
  return next(run.id, 'import', { ...state, transcript: null, products: data.products ?? [] });
}

async function importFindings(run, source, state) {
  const { finishRun } = require('./sources');
  if (!state.hits.length) {
    throw new Error(
      state.searches ? 'ค้นเว็บแล้วแต่ไม่ได้ผลลัพธ์ ลองเปลี่ยนคำค้น' : 'AI ไม่ได้ค้นเว็บ — ผู้ให้บริการ AI อาจยังไม่เปิดการค้นเว็บ (beta) สำหรับ key นี้',
    );
  }
  const { kept, dropped } = verifyFindings(state.products, state.hits, state.config.count);
  const { items, enriched } = await toItems(kept, { runId: run.id, config: state.config });
  const stats = items.length ? await upsertItems({ orgId: source.org_id, sourceId: source.id, items }) : { found: 0, created: 0, skipped: 0 };
  const summary = {
    products: kept.map((p) => ({ title: p.title, category: p.category, whyTrending: p.whyTrending, trendStage: p.trendStage, evidence: p.evidence })),
    dropped,
    searches: state.searches,
    sources: new Set(state.hits.map((h) => normUrl(h.url))).size,
    enriched,
    imported: stats.found,
    created: stats.created,
    profile: state.profile,
    provider: ai.providerId(),
    model: state.model,
  };
  await setRun(run.id, { stage: 'done', state: { step: 'done', config: state.config, summary } });
  return finishRun(run, source, stats);
}

/** Job handler for `scrape.ai`. Never throws: failures end the run with a readable message. */
async function runStep(runId, step) {
  const run = await db.one('SELECT * FROM scrape_runs WHERE id = :runId', { runId });
  if (!run || run.status !== 'running') return { status: 'skipped' };
  const source = await db.one('SELECT * FROM scrape_sources WHERE id = :id', { id: run.source_id });
  const state = parseJson(run.state) ?? {};
  if (state.step !== step) return { status: 'skipped', reason: 'stale step' };
  try {
    if (step === 'research') return await research(run, state);
    if (step === 'extract') return await extract(run, state);
    if (step === 'import') return await importFindings(run, source, state);
    throw new Error(`unknown step ${step}`);
  } catch (err) {
    logger.warn({ err: err.message, runId, step }, 'ai search step failed');
    const { failRun } = require('./sources');
    // Keep config for the UI, drop the (possibly large) conversation
    await setRun(run.id, { state: { step: 'failed', config: state.config, failedStep: step } });
    return failRun(run, source, new Error(explain(err)));
  }
}

module.exports = {
  aiAdapter,
  webSearchTool,
  buildPrompt,
  verifyFindings,
  searchHits,
  normUrl,
  toItems,
  startAiRun,
  runStep,
  PRODUCTS_SCHEMA,
  SYSTEM,
  STAGES,
};
