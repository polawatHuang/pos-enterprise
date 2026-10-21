'use strict';

const db = require('../../db/pool');
const ai = require('../../integrations/ai');

const SCRIPT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['title', 'hooks', 'scenes', 'postCaption', 'hashtags'],
  properties: {
    title: { type: 'string', description: 'ชื่อโปรเจกต์สั้นๆ' },
    hooks: {
      type: 'array',
      description: 'hook เปิดคลิป 3 แบบ คนละมุม (เช่น ปัญหา / ผลลัพธ์ / ความสงสัย) ใช้แทนฉากแรกได้ทันที',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['angle', 'voiceover', 'caption'],
        properties: {
          angle: { type: 'string', description: 'ชื่อมุม hook สั้นๆ เช่น ปัญหา, ผลลัพธ์, คำถาม' },
          voiceover: { type: 'string', description: 'บทพากย์ hook 1 ประโยคสั้น พูดจบใน 3 วินาที' },
          caption: { type: 'string', description: 'ข้อความบนจอ ไม่เกิน 6 คำ' },
        },
      },
    },
    scenes: {
      type: 'array',
      description: '3-6 ฉาก เรียง hook → ปัญหา → ทางแก้/สินค้า → หลักฐาน → CTA',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['voiceover', 'caption', 'visual', 'showProduct', 'durationSec'],
        properties: {
          voiceover: { type: 'string', description: 'บทพากย์ภาษาไทยแบบพูด ไม่เกิน 2 ประโยค' },
          caption: { type: 'string', description: 'ข้อความบนจอภาษาไทย ไม่เกิน 6 คำ' },
          visual: {
            type: 'string',
            description: 'English prompt for a 6-second vertical video shot (subject, action, setting, lighting, camera). No text, no logos.',
          },
          showProduct: { type: 'boolean', description: 'true เมื่อฉากนี้ควรเห็นตัวสินค้าจริง (ใช้รูปสินค้าเป็นเฟรมแรก)' },
          durationSec: { type: 'integer', minimum: 2, maximum: 10 },
        },
      },
    },
    postCaption: { type: 'string', description: 'แคปชันโพสต์ภาษาไทย 1-2 บรรทัด' },
    hashtags: { type: 'array', items: { type: 'string' }, description: '3-6 แฮชแท็กภาษาไทย/อังกฤษ ขึ้นต้นด้วย #' },
  },
};

const MAX_SCENES = 8;

const TONES = {
  friendly: 'เป็นกันเอง เหมือนเพื่อนแนะนำ',
  energetic: 'สนุก กระฉับกระเฉง จังหวะเร็ว',
  premium: 'หรูหรา สุภาพ น่าเชื่อถือ',
  funny: 'ตลก มีมุก แต่ไม่หยาบ',
  expert: 'แบบผู้เชี่ยวชาญ ให้ข้อมูลชัด',
};

/** Story templates that work for TikTok Shop / Shopee Video. */
const ANGLES = {
  auto: 'เลือกมุมที่เหมาะกับสินค้าที่สุดเอง',
  problem_solution: 'ปัญหา → สินค้าช่วยแก้ → ผลลัพธ์ → CTA',
  unboxing: 'แกะกล่อง → ของในกล่อง → ลองใช้ครั้งแรก → ความรู้สึก → CTA',
  before_after: 'ก่อนใช้ → ระหว่างใช้ → หลังใช้ (ห้ามเคลมเกินจริง) → CTA',
  top3: '3 เหตุผลที่ต้องมี (นับ 1-2-3) → CTA',
  pov: 'POV: สถานการณ์ในชีวิตประจำวันที่สินค้าเข้ามาช่วย → CTA',
  comparison: 'เทียบแบบเดิม/ของทั่วไป กับสินค้านี้ (ไม่พาดพิงแบรนด์อื่น) → CTA',
};

const SYSTEM = `คุณเป็นครีเอเตอร์คลิปรีวิวสินค้าแนวตั้ง (TikTok/Reels) ภาษาไทยที่ขายของเก่ง
เขียนสคริปต์คลิปสั้นจากข้อมูลสินค้าที่ให้เท่านั้น
- 3 วินาทีแรกต้องหยุดนิ้วคนดู (hook ด้วยปัญหาหรือผลลัพธ์ที่เห็นภาพ) และต้องเห็น/พูดถึงสินค้าภายในวินาทีที่ 6
- เขียน hooks 3 แบบคนละมุม โดยฉากแรกของ scenes ใช้ hook แบบแรก
- ประโยคสั้น กระชับ ฉากละ 2-5 วินาที จังหวะเร็วแบบคลิปสั้น
- ถ้าผู้ใช้ให้ภาพฉากมา ให้เขียนฉากละภาพตามลำดับพอดี (ฉากที่ 1 = ภาพที่ 1 …) บทพากย์และข้อความบนจอต้องเข้ากับสิ่งที่เห็นในภาพนั้น
- บทพากย์เป็นภาษาพูดธรรมชาติ ประโยคสั้น อ่านออกเสียงได้ลื่น ไม่ใช้อีโมจิในบทพากย์
- ห้ามเคลมเกินจริงหรือผิดกฎหมายโฆษณาไทย (เช่น รักษาหาย ขาวถาวร ลดน้ำหนักได้ X กิโล) ห้ามอ้างรีวิว/ตัวเลขที่ไม่มีในข้อมูล
- ปิดท้ายด้วย CTA ให้กดลิงก์/ตะกร้า
- ความยาวรวมของฉาก (durationSec) ใกล้เคียงความยาวที่ขอ (คิดจากบทพากย์ไทยประมาณ 4 คำต่อวินาที)
- visual เป็นภาษาอังกฤษ บรรยายภาพที่ถ่ายได้จริง ไม่มีตัวหนังสือในภาพ`;

/** Facts about the product (or trend item) that the script may use. */
async function productFacts(orgId, { productId, trendId }) {
  if (productId) {
    const p = await db.one('SELECT id, name, description, selling_points, price, image_url FROM products WHERE id = :id AND org_id = :orgId', {
      id: productId,
      orgId,
    });
    if (!p) return null;
    const faq = await db.query('SELECT question, answer FROM product_knowledge WHERE product_id = :id ORDER BY id LIMIT 8', { id: p.id });
    return {
      name: p.name,
      imageUrl: p.image_url,
      facts: {
        สินค้า: p.name,
        ราคา: Number(p.price),
        รายละเอียด: p.description,
        จุดขาย: p.selling_points,
        คำถามที่พบบ่อย: faq.map((f) => `${f.question}: ${f.answer}`),
      },
    };
  }
  if (trendId) {
    const t = await db.one('SELECT * FROM trending_products WHERE id = :id AND org_id = :orgId', { id: trendId, orgId });
    if (!t) return null;
    const a = t.ai_analysis ? (typeof t.ai_analysis === 'string' ? JSON.parse(t.ai_analysis) : t.ai_analysis) : null;
    return {
      name: t.title,
      imageUrl: t.image_url,
      facts: {
        สินค้า: t.title,
        ราคา: t.price == null ? null : Number(t.price),
        ยอดขาย: t.sold_count == null ? null : Number(t.sold_count),
        คะแนนรีวิว: t.rating == null ? null : Number(t.rating),
        จุดขายจากการวิเคราะห์: a?.sellingPoints ?? null,
        มุมเล่าเรื่องที่แนะนำ: a?.contentAngle ?? null,
        hookที่แนะนำ: a?.videoHooks ?? null,
        ข้อควรระวัง: a?.risks ?? null,
      },
    };
  }
  return null;
}

/**
 * @param {{facts:object, brief:{tone:string, lengthSec:number, audience?:string, notes?:string}}} input
 * @returns {Promise<{title:string, scenes:object[], postCaption:string, hashtags:string[], model:string, provider:string}>}
 */
async function generateScript({ facts, brief, footage = [] }) {
  // Scene images: one scene per image, in order. The model sees the pictures when it can.
  const sceneCount = Math.min(footage.length, MAX_SCENES);
  const seesImages = Boolean(ai.active().capabilities?.images);
  const pictures = seesImages
    ? footage.slice(0, sceneCount).flatMap((f, i) =>
        f.image
          ? [
              { type: 'text', text: `ภาพที่ ${i + 1}${f.label ? ` (${f.label})` : ''}:` },
              { type: 'image', source: { type: 'base64', media_type: f.image.mime, data: f.image.data } },
            ]
          : [],
      )
    : [];
  const { data, model, provider } = await ai.extractStructured({
    system: SYSTEM,
    schema: SCRIPT_SCHEMA,
    toolName: 'submit_script',
    toolDescription: 'ส่งสคริปต์คลิป',
    maxTokens: 4000,
    content: [
      {
        type: 'text',
        text: [
          `ความยาวคลิป: ประมาณ ${brief.lengthSec} วินาที`,
          `โทน: ${TONES[brief.tone] ?? brief.tone}`,
          `โครงเรื่อง: ${ANGLES[brief.angle] ?? ANGLES.auto}`,
          sceneCount
            ? `ภาพฉากของผู้ใช้ ${sceneCount} ภาพ — เขียน scenes ${sceneCount} ฉากพอดี เรียงตามลำดับภาพ:\n${footage
                .slice(0, sceneCount)
                .map((f, i) => `${i + 1}) ${f.kind === 'video' ? 'คลิป' : 'รูป'}: ${f.label || 'ไม่ระบุ'}`)
                .join('\n')}`
            : null,
          brief.audience ? `กลุ่มเป้าหมาย: ${brief.audience}` : null,
          brief.notes ? `สิ่งที่ต้องการเพิ่มเติม: ${brief.notes}` : null,
          '',
          `ข้อมูลสินค้า:\n${JSON.stringify(facts, null, 2)}`,
        ]
          .filter((l) => l !== null)
          .join('\n'),
      },
      ...pictures,
    ],
  });
  const scenes = (Array.isArray(data.scenes) ? data.scenes : [])
    .slice(0, sceneCount || MAX_SCENES)
    // Scene i shows image i (media null = follow the image order)
    .map((sc) => normalizeScene({ ...sc, media: null }, footage.length))
    .filter((sc) => sc.voiceover);
  const hooks = (Array.isArray(data.hooks) ? data.hooks : [])
    .map((h) => ({
      angle: String(h?.angle ?? '')
        .trim()
        .slice(0, 40),
      voiceover: String(h?.voiceover ?? '')
        .trim()
        .slice(0, 500),
      caption: String(h?.caption ?? '')
        .trim()
        .slice(0, 80),
    }))
    .filter((h) => h.voiceover)
    .slice(0, 3);
  if (!scenes.length) {
    const { AppError } = require('../../core/errors');
    throw new AppError(502, 'AI_BAD_OUTPUT', 'AI ไม่ได้ส่งฉากของสคริปต์กลับมา กรุณาลองใหม่');
  }
  return {
    title: String(data.title ?? '').slice(0, 200),
    scenes,
    hooks,
    postCaption: String(data.postCaption ?? '').slice(0, 2000),
    hashtags: (Array.isArray(data.hashtags) ? data.hashtags : [])
      .map((h) => `#${String(h).replace(/^#+/, '').replace(/\s+/g, '')}`)
      .filter((h) => h.length > 1)
      .slice(0, 10),
    model,
    provider,
  };
}

function normalizeScene(s, footageCount = 0) {
  const m = Number(s?.media);
  return {
    voiceover: String(s?.voiceover ?? '')
      .trim()
      .slice(0, 500),
    caption: String(s?.caption ?? '')
      .trim()
      .slice(0, 80),
    visual: String(s?.visual ?? '')
      .trim()
      .slice(0, 600),
    showProduct: Boolean(s?.showProduct),
    durationSec: Math.max(2, Math.min(10, Math.round(Number(s?.durationSec) || 4))),
    // 1-based footage number from the AI / editor; kept only when it points at an existing file
    media: Number.isInteger(m) && m >= 1 && m <= footageCount ? m : null,
  };
}

module.exports = { generateScript, productFacts, normalizeScene, SCRIPT_SCHEMA, TONES, ANGLES };
