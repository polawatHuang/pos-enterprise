'use strict';

const db = require('../../db/pool');
const logger = require('../../core/logger');
const ai = require('../../integrations/ai');
const minimaxMedia = require('../../integrations/minimax-media');

/**
 * "AI ปกคลิป": the AI designs the cover (art direction, layout, colors, font) and generates a
 * text-free background image; the browser then draws the Thai text on top (canvas), so spelling
 * is always right and text stays editable without paying for a new image.
 */

const LAYOUTS = ['top-title', 'bottom-band', 'split-left', 'center-burst'];
const FONTS = ['kanit', 'prompt', 'mitr', 'chakra'];
const HEX = { type: 'string', pattern: '^#[0-9a-fA-F]{6}$' };

const DESIGN_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['imagePrompt', 'layout', 'palette', 'font'],
  properties: {
    imagePrompt: {
      type: 'string',
      description:
        'English prompt for the background image. Describe scene, subject, lighting, colors, mood. MUST leave clean empty space where the title goes. NO text, letters or logos.',
    },
    layout: {
      type: 'string',
      enum: LAYOUTS,
      description:
        'top-title=title at top, bottom-band=title on a band at bottom, split-left=title on the left half (landscape), center-burst=big title in the middle',
    },
    palette: {
      type: 'object',
      additionalProperties: false,
      required: ['primary', 'accent', 'text', 'stroke'],
      properties: { primary: HEX, accent: HEX, text: HEX, stroke: HEX },
      description: 'title colors: text fill, stroke/outline, accent for the highlighted word and badge, primary for bands',
    },
    font: { type: 'string', enum: FONTS, description: 'kanit=bold modern, prompt=clean, mitr=friendly rounded, chakra=techy/sporty' },
    emphasisWord: { type: ['string', 'null'], description: 'one word/phrase copied exactly from the headline to highlight, or null' },
    mood: { type: 'string', description: 'short Thai note on the visual idea (1 sentence)' },
  },
};

const SYSTEM = `คุณเป็นอาร์ตไดเรกเตอร์ออกแบบปกคลิป TikTok/YouTube/Reels ที่ดึงสายตาและคนอยากกดดู
ออกแบบจาก style ข้อความ และรูปที่ผู้ใช้ให้มา
- imagePrompt เป็นภาษาอังกฤษ ละเอียด ภาพคมชัด สีสด คอนทราสต์สูง จัดองค์ประกอบสำหรับปกคลิป
- ภาพพื้นหลังต้องไม่มีตัวหนังสือ ตัวอักษร โลโก้ หรือลายน้ำเลย ระบบจะวางหัวข้อภาษาไทยทับเอง ต้องเว้นที่ว่างตามตำแหน่งของ layout
- ถ้ามีรูปสินค้า ระบบจะวางรูปสินค้าทับเอง ให้ภาพพื้นหลังเป็นฉาก/บรรยากาศที่ส่งเสริมสินค้า ไม่ต้องวาดสินค้าซ้ำ
- เลือกสีตัวหนังสือที่อ่านง่ายบนภาพ (ตัดกับพื้นหลัง) และ emphasisWord ต้องคัดลอกจากหัวข้อตรงตัว`;

const ASPECT = { portrait: '9:16', landscape: '16:9' };
const parseJson = (v) => (v == null ? null : typeof v === 'string' ? JSON.parse(v) : v);

function designPrompt(c) {
  return [
    `แนวภาพ: ${c.orientation === 'portrait' ? 'แนวตั้ง 9:16 (TikTok/Reels/Shorts)' : 'แนวนอน 16:9 (YouTube)'}`,
    `style: ${c.style}`,
    `หัวข้อ: ${c.headline}`,
    c.subtext ? `ข้อความรอง: ${c.subtext}` : '',
    c.badge ? `ป้าย: ${c.badge}` : '',
    c.upload_kind === 'product' ? 'มีรูปสินค้าแนบมา ระบบจะวางทับในภาพ' : '',
    c.upload_kind === 'person' ? 'มีรูปบุคคลแนบมา ใช้เป็นตัวละครหลักในภาพ (คงหน้าตาเดิม)' : '',
  ]
    .filter(Boolean)
    .join('\n');
}

/** Keep only values the canvas can use; fall back to safe defaults. */
function cleanDesign(d, c) {
  const hex = (v, def) => (typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v) ? v : def);
  const p = d?.palette ?? {};
  let layout = LAYOUTS.includes(d?.layout) ? d.layout : 'top-title';
  if (layout === 'split-left' && c.orientation === 'portrait') layout = 'top-title';
  const emphasis = typeof d?.emphasisWord === 'string' && c.headline.includes(d.emphasisWord) ? d.emphasisWord : null;
  return {
    layout,
    font: FONTS.includes(d?.font) ? d.font : 'kanit',
    palette: { primary: hex(p.primary, '#111827'), accent: hex(p.accent, '#facc15'), text: hex(p.text, '#ffffff'), stroke: hex(p.stroke, '#111111') },
    emphasisWord: emphasis,
    mood: typeof d?.mood === 'string' ? d.mood.slice(0, 300) : null,
    imagePrompt: String(d?.imagePrompt ?? '').slice(0, 1500),
  };
}

async function saveAsset(coverId, kind, mime, buffer) {
  await db.query(
    `INSERT INTO cover_assets (cover_id, kind, mime, data) VALUES (:coverId, :kind, :mime, :data)
     ON DUPLICATE KEY UPDATE mime = VALUES(mime), data = VALUES(data), created_at = CURRENT_TIMESTAMP`,
    { coverId, kind, mime, data: buffer },
  );
}

function explain(err) {
  const msg = String(err?.message ?? err);
  if (err?.code === 'INTEGRATION_NOT_CONFIGURED') return msg;
  if (/timed? ?out|aborted/i.test(msg)) return 'MiniMax สร้างภาพนานเกินไป ลองใหม่อีกครั้ง';
  if (/sensitive|safety|1026|1027/i.test(msg)) return 'MiniMax ปฏิเสธการสร้างภาพนี้ (เนื้อหาอาจไม่ผ่านนโยบาย) ลองปรับ style หรือข้อความ';
  return `สร้างปกไม่สำเร็จ: ${msg.slice(0, 300)}`;
}

/** Job `cover.generate`: design (unless only the background is redone) → image → ready. */
async function generateCover({ coverId, redesign = true }) {
  const c = await db.one('SELECT * FROM cover_projects WHERE id = :id', { id: coverId });
  if (!c || c.status !== 'generating') return { status: 'skipped' };
  try {
    let design = parseJson(c.design);
    let provider = c.provider;
    let model = c.model;
    if (redesign || !design?.imagePrompt) {
      const r = await ai.extractStructured({
        system: SYSTEM,
        schema: DESIGN_SCHEMA,
        toolName: 'submit_cover_design',
        toolDescription: 'ส่งการออกแบบปกคลิป',
        maxTokens: 2000,
        content: [{ type: 'text', text: designPrompt(c) }],
      });
      // Keep the user's own edits (position/size) when re-designing
      design = { ...(design?.user ? { user: design.user } : {}), ...cleanDesign(r.data, c) };
      provider = r.provider;
      model = r.model;
    }
    let subjectImage = null;
    if (c.upload_kind === 'person') {
      const up = await db.one("SELECT mime, data FROM cover_assets WHERE cover_id = :id AND kind = 'upload'", { id: c.id });
      if (up) subjectImage = `data:${up.mime};base64,${Buffer.from(up.data).toString('base64')}`;
    }
    const image = await minimaxMedia.generateImage({
      prompt: `${design.imagePrompt}. Absolutely no text, letters, words, numbers, logos or watermarks anywhere in the image.`,
      aspectRatio: ASPECT[c.orientation],
      subjectImage,
    });
    await saveAsset(c.id, 'background', image.mime, image.buffer);
    await db.query("UPDATE cover_projects SET status = 'ready', error = NULL, design = :design, provider = :provider, model = :model WHERE id = :id", {
      id: c.id,
      design: JSON.stringify(design),
      provider,
      model,
    });
    return { status: 'ready' };
  } catch (err) {
    logger.warn({ err: err.message, coverId }, 'cover generation failed');
    await db.query("UPDATE cover_projects SET status = 'failed', error = :error WHERE id = :id", { id: c.id, error: explain(err).slice(0, 1000) });
    return { status: 'failed' };
  }
}

module.exports = { generateCover, cleanDesign, designPrompt, DESIGN_SCHEMA, SYSTEM, LAYOUTS, FONTS, ASPECT };
