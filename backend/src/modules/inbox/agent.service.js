'use strict';

const db = require('../../db/pool');
const logger = require('../../core/logger');
const ai = require('../../integrations/ai');
const { TOOLS, runTool } = require('./agent.tools');
const inbox = require('./inbox.service');

const MAX_TOOL_ROUNDS = 6;
const HISTORY_LIMIT = 24;
const LOCK_SECONDS = 120;

async function loadProfile(orgId) {
  return (
    (await db.one('SELECT * FROM ai_agent_profiles WHERE org_id = :orgId ORDER BY is_default DESC, id LIMIT 1', { orgId })) ?? {
      name: 'แอดมิน',
      persona: 'สุภาพ เป็นกันเอง',
      sales_rules: null,
      max_discount_pct: 10,
      handoff_keywords: null,
    }
  );
}

async function storeKnowledge(orgId) {
  const rows = await db.query(
    'SELECT question, answer FROM product_knowledge WHERE org_id = :orgId AND product_id IS NULL ORDER BY id LIMIT 30',
    { orgId },
  );
  return rows.map((r) => `- ${r.question ? `${r.question}: ` : ''}${r.answer}`).join('\n');
}

/** Stable per-store system prompt (kept identical between turns so providers can cache it). */
function buildSystem(profile, org, knowledge) {
  return `คุณคือ "${profile.name}" แอดมินแชตของร้าน ${org.name} คุยกับลูกค้าทางแชต
บุคลิก: ${profile.persona || 'สุภาพ เป็นกันเอง'}

เป้าหมาย: ช่วยลูกค้าเลือกสินค้าที่ตรงความต้องการจริงและปิดการขายอย่างเป็นธรรมชาติ ดูแลปัญหาหลังการขายให้ลูกค้ารู้สึกได้รับการใส่ใจและอยากกลับมาซื้ออีก

วิธีตอบ:
- ตอบสั้นแบบคนพิมพ์แชต 1-3 ประโยค เป็นภาษาไทยธรรมชาติ ไม่ใช้ markdown หัวข้อ หรือ bullet ยาว
- ข้อมูลสินค้า ราคา สต๊อก โปรโมชัน และนโยบาย ต้องมาจากเครื่องมือหรือฐานความรู้ด้านล่างเท่านั้น ห้ามเดาหรือแต่งเอง ถ้าไม่รู้ให้บอกว่าจะเช็กให้หรือส่งต่อแอดมิน
- ใช้ search_products ก่อนแนะนำสินค้า และ get_product_details ก่อนตอบคำถามเชิงลึก
- ถามคำถามสั้นๆ เพื่อเข้าใจความต้องการก่อนแนะนำ เสนอทางเลือกไม่เกิน 2-3 ตัว
- ใช้ส่วนลดเฉพาะเมื่อช่วยปิดการขายหรือชดเชยความผิดพลาดของร้าน และไม่เกิน ${Number(profile.max_discount_pct)}%
- ลูกค้ามีปัญหาสินค้า/ขอคืน: ขอโทษอย่างจริงใจ ถามรายละเอียดและเลขออร์เดอร์ ใช้ open_return_request แล้วเสนอทางแก้ (เปลี่ยน คืนเงิน หรือส่วนลดครั้งถัดไป) ตามนโยบาย
- ลูกค้าขอคุยกับคน ไม่พอใจมาก หรือเป็นเรื่องกฎหมาย/ความปลอดภัย: ใช้ escalate_to_human
- ห้ามขอข้อมูลบัตรเครดิตหรือรหัสผ่าน ถ้าลูกค้าถามว่าคุยกับ AI หรือไม่ ให้ตอบตามจริง
${profile.sales_rules ? `\nกฎการขายของร้าน:\n${profile.sales_rules}\n` : ''}
${knowledge ? `ฐานความรู้ของร้าน (นโยบาย การจัดส่ง การคืนสินค้า):\n${knowledge}` : ''}`.trim();
}

/** Customer/staff history as alternating user/assistant turns, starting with the customer. */
async function buildHistory(conversationId) {
  const rows = await db.query(
    `SELECT sender_type, content FROM messages
      WHERE conversation_id = :id AND sender_type <> 'system' AND content IS NOT NULL
      ORDER BY id DESC LIMIT ${HISTORY_LIMIT}`,
    { id: conversationId },
  );
  const turns = [];
  for (const r of rows.reverse()) {
    const role = r.sender_type === 'customer' ? 'user' : 'assistant';
    const last = turns[turns.length - 1];
    if (last && last.role === role) last.content += `\n${r.content}`;
    else turns.push({ role, content: r.content });
  }
  while (turns.length && turns[0].role !== 'user') turns.shift();
  return turns;
}

/** Atomic claim so a webhook-triggered reply and the queued fallback never both answer. */
async function claim(conversationId) {
  const r = await db.query(
    `UPDATE conversations SET ai_lock_until = UTC_TIMESTAMP() + INTERVAL ${LOCK_SECONDS} SECOND
      WHERE id = :id AND (ai_lock_until IS NULL OR ai_lock_until < UTC_TIMESTAMP())`,
    { id: conversationId },
  );
  return r.affectedRows === 1;
}
const release = (conversationId) => db.query('UPDATE conversations SET ai_lock_until = NULL WHERE id = :id', { id: conversationId });

/**
 * Generate and send the AI reply for the newest customer message of a conversation.
 * Safe to call repeatedly: it does nothing when AI is off, the last message is already
 * answered, or another worker holds the claim.
 * @returns {Promise<{status:string, reply?:string, tools?:string[]}>}
 */
async function replyToConversation(conversationId, { replyToken } = {}) {
  const conv = await db.one('SELECT * FROM conversations WHERE id = :id', { id: conversationId });
  if (!conv) return { status: 'missing' };
  const channel = await db.one('SELECT * FROM channels WHERE id = :id', { id: conv.channel_id });
  if (conv.mode !== 'ai' || !channel.ai_enabled) return { status: 'ai_off' };

  const last = await db.one('SELECT sender_type, content FROM messages WHERE conversation_id = :id AND sender_type <> \'system\' ORDER BY id DESC LIMIT 1', { id: conversationId });
  if (!last || last.sender_type !== 'customer') return { status: 'already_answered' };

  if (!(await claim(conversationId))) return { status: 'busy' };
  try {
    const profile = await loadProfile(conv.org_id);
    const keywords = String(profile.handoff_keywords ?? '')
      .split(',')
      .map((k) => k.trim())
      .filter(Boolean);
    const hit = keywords.find((k) => String(last.content).includes(k));
    if (hit) {
      await inbox.handoff(conversationId, `ลูกค้าพิมพ์คำว่า "${hit}"`);
      await inbox.sendReply({ conversationId, text: 'รับทราบค่ะ เดี๋ยวแอดมินจะเข้ามาดูแลต่อให้นะคะ 🙏', senderType: 'ai', replyToken });
      return { status: 'handoff' };
    }
    if (!ai.isConfigured()) {
      await inbox.handoff(conversationId, `AI ยังไม่ได้ตั้งค่า (${ai.providerId()} API key)`);
      return { status: 'not_configured' };
    }

    const org = await db.one('SELECT name FROM organizations WHERE id = :id', { id: conv.org_id });
    const system = buildSystem(profile, org, await storeKnowledge(conv.org_id));
    const messages = await buildHistory(conversationId);
    const ctx = {
      orgId: conv.org_id,
      conversationId,
      customerId: conv.customer_id,
      maxDiscountPct: Number(profile.max_discount_pct),
      escalated: null,
    };
    const used = [];
    let response;
    let usage = { input_tokens: 0, output_tokens: 0 };
    for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
      response = await ai.createMessage({ system, messages, tools: TOOLS, maxTokens: 2000, effort: 'low' });
      usage = {
        input_tokens: usage.input_tokens + (response.usage?.input_tokens ?? 0),
        output_tokens: usage.output_tokens + (response.usage?.output_tokens ?? 0),
      };
      if (response.stop_reason !== 'tool_use') break;
      // Keep the full assistant turn (incl. thinking blocks) so the provider can continue its reasoning
      messages.push({ role: 'assistant', content: response.content });
      const results = [];
      for (const block of response.content.filter((b) => b.type === 'tool_use')) {
        used.push(block.name);
        let output;
        try {
          output = await runTool(ctx, block.name, block.input);
        } catch (err) {
          logger.warn({ err: err.message, tool: block.name }, 'agent tool failed');
          output = { error: 'เครื่องมือขัดข้อง ให้ขอโทษลูกค้าและส่งต่อแอดมินถ้าจำเป็น' };
        }
        results.push({ type: 'tool_result', tool_use_id: block.id, content: JSON.stringify(output), ...(output?.error ? { is_error: true } : {}) });
      }
      messages.push({ role: 'user', content: results });
    }

    const text = ai.textOf(response).replace(/<think>[\s\S]*?<\/think>/g, '').trim();
    if (response.stop_reason === 'refusal' || !text) {
      await inbox.handoff(conversationId, 'AI ตอบไม่ได้ในข้อความนี้');
      return { status: 'handoff', tools: used };
    }
    await inbox.sendReply({
      conversationId,
      text,
      senderType: 'ai',
      replyToken,
      aiMeta: { provider: ai.providerId(), model: response.model, usage, tools: used },
    });
    if (ctx.escalated) await inbox.handoff(conversationId, ctx.escalated);
    return { status: 'replied', reply: text, tools: used };
  } catch (err) {
    logger.error({ err, conversationId }, 'AI reply failed');
    // Leave it to the queued retry; after repeated failures the job handler hands off to a human
    throw err;
  } finally {
    await release(conversationId);
  }
}

module.exports = { replyToConversation, buildSystem, buildHistory };
