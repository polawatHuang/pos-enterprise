'use strict';

const db = require('../../db/pool');
const ai = require('../../integrations/ai');
const { conflict } = require('../../core/errors');
const { enqueue } = require('../../jobs/queue');
const { webSearchTool, searchHits, normUrl } = require('./ai-search');
const { rescore } = require('./trends.service');

/**
 * "ให้ AI ค้นข้อมูลร้าน/รีวิวจากเว็บ": the AI searches the web for one trend product's listing and shop
 * pages and reports the checklist facts Kalodata does not have (rating, reviews, shop rating, chat
 * response, shipping within 48 h, flash sale). Every value must name the page it was read from;
 * values whose page the search did not actually return are dropped, and only empty fields are
 * filled — data from Kalodata or typed by a person is never overwritten.
 * Runs as `trend.facts` jobs (one model call each), so a slow search never blocks a request.
 */

const SEARCH_TIMEOUT_MS = 150_000;
const MAX_CONTINUATIONS = 3;
const KIND = 'webfacts';

/** checklist fact → column, allowed range and Thai label */
const FIELDS = {
  rating: { col: 'rating', label: 'ดาวสินค้าเฉลี่ย', check: (v) => typeof v === 'number' && v >= 0 && v <= 5 },
  reviewCount: { col: 'review_count', label: 'จำนวนรีวิว', check: (v) => Number.isInteger(v) && v >= 0 },
  positiveReviewPct: { col: 'positive_review_pct', label: 'รีวิว 4–5 ดาว (%)', check: (v) => typeof v === 'number' && v >= 0 && v <= 100 },
  mediaReviewCount: { col: 'media_review_count', label: 'รีวิวที่มีรูป/วิดีโอ', check: (v) => Number.isInteger(v) && v >= 0 },
  shopRating: { col: 'shop_rating', label: 'คะแนนร้าน', check: (v) => typeof v === 'number' && v >= 0 && v <= 5 },
  shopResponseRate: { col: 'shop_response_rate', label: 'อัตราตอบแชต (%)', check: (v) => typeof v === 'number' && v >= 0 && v <= 100 },
  shopShip48Rate: { col: 'shop_ship48_rate', label: 'ส่งภายใน 48 ชม. (%)', check: (v) => typeof v === 'number' && v >= 0 && v <= 100 },
  hasFlashSale: { col: 'has_flash_sale', label: 'มีแฟลชเซล', check: (v) => typeof v === 'boolean' },
};

const SUBMIT_TOOL = {
  name: 'submit_facts',
  description: 'ส่งข้อมูลสินค้า/ร้านที่พบจากหน้าเว็บ พร้อม URL ที่อ่านค่ามา',
  input_schema: {
    type: 'object',
    required: ['facts'],
    properties: {
      facts: {
        type: 'array',
        items: {
          type: 'object',
          required: ['field', 'value', 'sourceUrl'],
          properties: {
            field: { type: 'string', enum: Object.keys(FIELDS) },
            value: { description: 'ตัวเลข (หรือ true/false สำหรับ hasFlashSale) ตามที่หน้าเว็บแสดง' },
            sourceUrl: { type: 'string', description: 'URL ของหน้าที่เห็นค่านี้ ต้องมาจากผลค้นเว็บจริง' },
            note: { type: 'string', description: 'บอกสั้น ๆ ว่าเห็นตรงไหน เช่น "หน้าสินค้า TikTok Shop" / "หน้าร้าน Shopee ของแบรนด์เดียวกัน"' },
          },
        },
      },
      summary: { type: 'string', description: 'สรุป 1–2 ประโยคว่าค้นเจออะไร/ไม่เจออะไร' },
    },
  },
};

const SYSTEM = `คุณเป็นผู้ช่วยหาข้อมูลสินค้าออนไลน์ในไทย ค้นเว็บหาข้อมูลจริงของสินค้า/ร้านที่ระบุ เพื่อใช้ประเมินก่อนรับมาขายหรือทำคลิป affiliate
- ใช้ web_search ค้นหน้าสินค้าและหน้าร้านของสินค้านี้บน TikTok Shop ก่อน ถ้าไม่เจอให้ดูหน้าร้านเดียวกันบน Shopee/Lazada
- รายงานเฉพาะค่าที่เห็นบนหน้าเว็บจริง พร้อม URL ของหน้านั้น ห้ามเดาหรือประมาณ ถ้าไม่เจอให้ข้ามข้อนั้น
- rating = ดาวเฉลี่ยของสินค้า, reviewCount = จำนวนรีวิว, positiveReviewPct = % รีวิว 4–5 ดาว (คำนวณได้ถ้าหน้าแสดงจำนวนแยกตามดาว),
  mediaReviewCount = จำนวนรีวิวที่มีรูป/วิดีโอ, shopRating = คะแนนร้าน, shopResponseRate = อัตราตอบแชต (%),
  shopShip48Rate = % คำสั่งซื้อที่ส่งภายใน 48 ชม., hasFlashSale = ช่วงนี้สินค้า/ร้านมีแฟลชเซลหรือไม่
- ถ้าค่ามาจากแพลตฟอร์มอื่นหรือรุ่นใกล้เคียง ให้ระบุใน note
- ส่งผลด้วยเครื่องมือ submit_facts ครั้งเดียว`;

const parse = (v) => (v == null ? null : typeof v === 'string' ? JSON.parse(v) : v);

async function saveState(trendId, data, userId = null) {
  await db.query(
    `INSERT INTO trend_product_extras (trending_product_id, kind, data, credits, fetched_by, fetched_at) VALUES (:id, :kind, :data, 0, :userId, UTC_TIMESTAMP())
     ON DUPLICATE KEY UPDATE data = VALUES(data), fetched_by = COALESCE(VALUES(fetched_by), fetched_by), fetched_at = VALUES(fetched_at)`,
    { id: trendId, kind: KIND, data: JSON.stringify(data), userId },
  );
}

function prompt(t) {
  const lines = [
    `สินค้า: ${t.title}`,
    t.shop_name && `ร้าน: ${t.shop_name}`,
    t.url && `ลิงก์สินค้า: ${t.url}`,
    `แพลตฟอร์ม: ${t.platform === 'kalodata' ? 'TikTok Shop ประเทศไทย' : t.platform}`,
    t.price != null && `ราคาประมาณ: ${Number(t.price)} บาท`,
    t.category && `หมวด: ${t.category}`,
  ].filter(Boolean);
  return `${lines.join('\n')}\n\nหาข้อมูล: ดาวสินค้า, จำนวนรีวิว, % รีวิว 4–5 ดาว, รีวิวที่มีรูป/วิดีโอ, คะแนนร้าน, อัตราตอบแชต, % ส่งภายใน 48 ชม., แฟลชเซล`;
}

/** Start a search for one product. */
async function start(trend, userId) {
  ai.requireConfig();
  const cur = await db.one('SELECT data, fetched_at FROM trend_product_extras WHERE trending_product_id = :id AND kind = :kind', { id: trend.id, kind: KIND });
  const prev = parse(cur?.data);
  // a search still running from the last 10 minutes: do not start a second one
  if (prev?.status === 'running' && cur.fetched_at > new Date(Date.now() - 10 * 60_000)) throw conflict('AI กำลังค้นข้อมูลสินค้านี้อยู่');
  const state = { status: 'running', step: 'research', startedAt: new Date().toISOString() };
  await saveState(trend.id, state, userId);
  await enqueue(
    'trend.facts',
    { trendId: trend.id, step: 'research', messages: [{ role: 'user', content: prompt(trend) }], hits: [], searches: 0, continuations: 0 },
    { orgId: trend.org_id, maxAttempts: 1 },
  );
  return state;
}

/** Keep facts with a known field, a value in range and a source page the search returned. */
function verify(facts, hits) {
  const seen = new Set(hits.map((h) => normUrl(h.url)).filter(Boolean));
  const kept = [];
  const dropped = [];
  const used = new Set();
  for (const f of Array.isArray(facts) ? facts : []) {
    const def = FIELDS[f?.field];
    let value = f?.value;
    if (def && typeof value === 'string') value = f.field === 'hasFlashSale' ? /^(true|yes|มี|ใช่)$/i.test(value.trim()) : Number(value.replace(/[,%\s]/g, ''));
    if (def && ['reviewCount', 'mediaReviewCount'].includes(f.field) && typeof value === 'number') value = Math.round(value);
    const reason = !def
      ? 'ไม่รู้จักข้อมูลนี้'
      : !def.check(value)
        ? 'ค่าไม่อยู่ในช่วงที่เป็นไปได้'
        : !seen.has(normUrl(f.sourceUrl))
          ? 'ไม่มีหน้าเว็บยืนยัน'
          : used.has(f.field)
            ? 'ซ้ำ'
            : null;
    if (reason) dropped.push({ field: f?.field ?? null, value: f?.value ?? null, reason });
    else {
      used.add(f.field);
      kept.push({ field: f.field, label: def.label, value, sourceUrl: f.sourceUrl, sourceTitle: hits.find((h) => normUrl(h.url) === normUrl(f.sourceUrl))?.title ?? null, note: f.note ?? null });
    }
  }
  return { kept, dropped };
}

/** Fill only empty columns, then rescore (phase, checklist, scores). */
async function apply(trendId, kept) {
  const t = await db.one('SELECT * FROM trending_products WHERE id = :id', { id: trendId });
  for (const f of kept) {
    const col = FIELDS[f.field].col;
    f.applied = t[col] == null;
    if (f.applied) await db.query(`UPDATE trending_products SET ${col} = :v WHERE id = :id`, { id: trendId, v: f.field === 'hasFlashSale' ? Number(f.value) : f.value });
  }
  await db.tx((conn) => rescore(conn, trendId));
}

/** Job handler: one model call; continue on pause_turn, finish on submit_facts. */
async function step(payload) {
  const { trendId } = payload;
  try {
    const res = await ai.createMessage({
      system: SYSTEM,
      messages: payload.messages,
      tools: [webSearchTool(), SUBMIT_TOOL],
      maxTokens: 4000,
      timeoutMs: SEARCH_TIMEOUT_MS,
      maxRetries: 0, // a retry would search (and bill) again
    });
    const hits = [...payload.hits, ...searchHits(res.content)];
    const searches = payload.searches + (res.content ?? []).filter((b) => b?.type === 'server_tool_use').length;
    const submit = (res.content ?? []).find((b) => b.type === 'tool_use' && b.name === 'submit_facts');
    if (!submit && res.stop_reason === 'pause_turn' && payload.continuations < MAX_CONTINUATIONS) {
      await enqueue(
        'trend.facts',
        { ...payload, messages: [...payload.messages, { role: 'assistant', content: res.content }], hits, searches, continuations: payload.continuations + 1 },
        { maxAttempts: 1 },
      );
      return { continued: true };
    }
    const { kept, dropped } = verify(submit?.input?.facts, hits);
    await apply(trendId, kept);
    const text = ai
      .textOf(res)
      .replace(/<think>[\s\S]*?<\/think>/g, '')
      .trim();
    await saveState(trendId, {
      status: 'done',
      facts: kept,
      dropped,
      summary: submit?.input?.summary ?? (text.slice(0, 500) || null),
      searches,
      sources: hits.length,
      provider: ai.providerId(),
      model: res.model ?? null,
      finishedAt: new Date().toISOString(),
    });
    return { kept: kept.length, dropped: dropped.length };
  } catch (err) {
    const msg = String(err?.message ?? err);
    const reason =
      err?.status === 400 && /web_search|server.?tool|tool/i.test(msg)
        ? `ผู้ให้บริการ AI ยังไม่รองรับการค้นเว็บสำหรับ key/รุ่นนี้ (${ai.providerId()})`
        : /timed? ?out|ETIMEDOUT|aborted/i.test(msg)
          ? 'AI ค้นเว็บนานเกินไป ลองใหม่อีกครั้ง'
          : msg.slice(0, 300);
    // keep what an earlier search found (its values are already in the product)
    const prev = parse((await db.one('SELECT data FROM trend_product_extras WHERE trending_product_id = :id AND kind = :kind', { id: trendId, kind: KIND }))?.data);
    await saveState(trendId, { facts: prev?.facts ?? [], status: 'failed', error: reason, finishedAt: new Date().toISOString() });
    return { failed: reason };
  }
}

module.exports = { FIELDS, start, step, verify, SUBMIT_TOOL, SYSTEM };
