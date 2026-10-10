'use strict';

const crypto = require('node:crypto');
const db = require('../../db/pool');

/**
 * Tools the sales agent may call. Every tool is scoped to the conversation's org/customer and
 * enforces business limits server-side — the model can ask, but cannot exceed policy.
 * Schemas are strict (all properties required, nullable where optional) so inputs always validate.
 */
const str = (description) => ({ type: 'string', description });
const nullableStr = (description) => ({ type: ['string', 'null'], description });

const TOOLS = [
  {
    name: 'search_products',
    description:
      'ค้นหาสินค้าในร้านจากคำค้น (ชื่อ ประเภท ปัญหาที่ลูกค้าต้องการแก้) คืนรายการสินค้าพร้อมราคาและสต๊อก ใช้ก่อนแนะนำสินค้าทุกครั้ง',
    strict: true,
    input_schema: {
      type: 'object',
      additionalProperties: false,
      required: ['query'],
      properties: { query: str('คำค้นภาษาไทยหรืออังกฤษ') },
    },
  },
  {
    name: 'get_product_details',
    description: 'ดูรายละเอียด จุดขาย สต๊อก และคำถามที่พบบ่อย (FAQ) ของสินค้า ใช้ก่อนตอบคำถามเชิงลึกเกี่ยวกับสินค้า',
    strict: true,
    input_schema: {
      type: 'object',
      additionalProperties: false,
      required: ['product_id'],
      properties: { product_id: { type: 'integer' } },
    },
  },
  {
    name: 'lookup_orders',
    description: 'ดูสถานะออร์เดอร์ของลูกค้าในแชตนี้ หรือค้นด้วยเลขที่ออร์เดอร์ที่ลูกค้าให้มา',
    strict: true,
    input_schema: {
      type: 'object',
      additionalProperties: false,
      required: ['order_no'],
      properties: { order_no: nullableStr('เลขที่ออร์เดอร์ ถ้าลูกค้าไม่ได้ให้มาให้ส่ง null เพื่อดูออร์เดอร์ล่าสุดของลูกค้า') },
    },
  },
  {
    name: 'create_discount_code',
    description:
      'สร้างโค้ดส่วนลดเฉพาะลูกค้ารายนี้ ใช้เพื่อปิดการขายหรือชดเชยเมื่อร้านผิดพลาด ห้ามเกินเพดานที่ร้านกำหนด ถ้าเกินระบบจะส่งให้ผู้จัดการอนุมัติ',
    strict: true,
    input_schema: {
      type: 'object',
      additionalProperties: false,
      required: ['percent', 'reason'],
      properties: {
        percent: { type: 'number', description: 'เปอร์เซ็นต์ส่วนลด 1-100' },
        reason: str('เหตุผลสั้นๆ เช่น ปิดการขาย 2 ชิ้น, ชดเชยสินค้าเสียหาย'),
      },
    },
  },
  {
    name: 'open_return_request',
    description: 'เปิดเรื่องคืน/เปลี่ยนสินค้าหรือข้อร้องเรียน เมื่อลูกค้าแจ้งปัญหาเกี่ยวกับสินค้าที่ได้รับ',
    strict: true,
    input_schema: {
      type: 'object',
      additionalProperties: false,
      required: ['order_no', 'reason', 'preferred_resolution'],
      properties: {
        order_no: nullableStr('เลขที่ออร์เดอร์ถ้ามี'),
        reason: str('ปัญหาที่ลูกค้าแจ้ง'),
        preferred_resolution: { type: 'string', enum: ['refund', 'exchange', 'discount', 'store_credit'] },
      },
    },
  },
  {
    name: 'escalate_to_human',
    description: 'ส่งต่อให้แอดมิน เมื่อลูกค้าขอคุยกับคน ไม่พอใจมาก ข่มขู่ทางกฎหมาย หรือเป็นเรื่องที่ตอบจากข้อมูลไม่ได้',
    strict: true,
    input_schema: {
      type: 'object',
      additionalProperties: false,
      required: ['reason'],
      properties: { reason: str('เหตุผลที่ส่งต่อ') },
    },
  },
];

const money = (n) => Math.round(Number(n) * 100) / 100;

async function searchProducts(ctx, { query }) {
  const like = `%${String(query).trim().slice(0, 100)}%`;
  const rows = await db.query(
    `SELECT p.id, p.name, p.price, p.unit, LEFT(COALESCE(p.selling_points, p.description, ''), 200) AS highlight,
            COALESCE((SELECT SUM(sl.quantity) FROM stock_levels sl WHERE sl.product_id = p.id), 0) AS stock
       FROM products p
      WHERE p.org_id = :orgId AND p.status = 'active'
        AND (p.name LIKE :like OR p.description LIKE :like OR p.selling_points LIKE :like OR p.sku = :q)
      ORDER BY stock > 0 DESC, p.name
      LIMIT 6`,
    { orgId: ctx.orgId, like, q: String(query).trim() },
  );
  if (!rows.length) return { results: [], note: 'ไม่พบสินค้าตรงคำค้น ลองคำอื่นที่กว้างขึ้น หรือบอกลูกค้าตามจริง' };
  return {
    results: rows.map((r) => ({ id: r.id, name: r.name, price: Number(r.price), unit: r.unit, in_stock: Number(r.stock), highlight: r.highlight })),
  };
}

async function getProductDetails(ctx, { product_id: id }) {
  const p = await db.one(
    `SELECT p.id, p.name, p.description, p.selling_points, p.price, p.unit,
            COALESCE((SELECT SUM(sl.quantity) FROM stock_levels sl WHERE sl.product_id = p.id), 0) AS stock
       FROM products p WHERE p.id = :id AND p.org_id = :orgId AND p.status = 'active'`,
    { id, orgId: ctx.orgId },
  );
  if (!p) return { error: 'ไม่พบสินค้านี้หรือเลิกขายแล้ว' };
  const faq = await db.query('SELECT question, answer FROM product_knowledge WHERE product_id = :id ORDER BY id LIMIT 20', { id });
  return {
    id: p.id,
    name: p.name,
    price: Number(p.price),
    unit: p.unit,
    in_stock: Number(p.stock),
    description: p.description,
    selling_points: p.selling_points,
    faq: faq.map((f) => ({ q: f.question, a: f.answer })),
  };
}

/** Only orders of this chat's customer, or an exact order number the customer supplied. No personal data is returned. */
async function lookupOrders(ctx, { order_no: orderNo }) {
  const rows = await db.query(
    `SELECT so.id, so.order_no, so.channel, so.status, so.total, DATE_FORMAT(so.ordered_at, '%Y-%m-%d') AS ordered_on
       FROM sales_orders so
      WHERE so.org_id = :orgId AND ${orderNo ? 'so.order_no = :orderNo' : 'so.customer_id = :customerId'}
      ORDER BY so.ordered_at DESC LIMIT 5`,
    { orgId: ctx.orgId, orderNo: orderNo ? String(orderNo).trim() : null, customerId: ctx.customerId ?? 0 },
  );
  if (!rows.length) return { orders: [], note: orderNo ? 'ไม่พบเลขที่ออร์เดอร์นี้ ให้ลูกค้าตรวจเลขอีกครั้ง' : 'ยังไม่พบออร์เดอร์ของลูกค้าในแชตนี้ ขอเลขที่ออร์เดอร์จากลูกค้า' };
  const items = await db.query('SELECT order_id, name, quantity FROM sales_order_items WHERE order_id IN (:ids)', { ids: rows.map((r) => r.id) });
  return {
    orders: rows.map((r) => ({
      order_no: r.order_no,
      channel: r.channel,
      status: r.status,
      total: Number(r.total),
      ordered_on: r.ordered_on,
      items: items.filter((i) => i.order_id === r.id).map((i) => `${i.name} x${Number(i.quantity)}`),
    })),
  };
}

/** Discount within the profile cap is issued immediately; above it, an offer waits for a manager. */
async function createDiscountCode(ctx, { percent, reason }) {
  const pct = Math.max(1, Math.min(100, Math.round(Number(percent) * 100) / 100));
  const existing = await db.one(
    "SELECT COUNT(*) AS n FROM ai_offers WHERE conversation_id = :id AND offer_type = 'discount_code' AND status IN ('proposed','accepted','needs_approval')",
    { id: ctx.conversationId },
  );
  if (existing.n > 0) return { error: 'แชตนี้ได้รับข้อเสนอส่วนลดไปแล้ว ห้ามออกซ้ำ' };
  if (pct > ctx.maxDiscountPct) {
    await db.query(
      `INSERT INTO ai_offers (org_id, conversation_id, offer_type, value, rationale, status)
       VALUES (:orgId, :conversationId, 'discount_code', :pct, :reason, 'needs_approval')`,
      { orgId: ctx.orgId, conversationId: ctx.conversationId, pct, reason },
    );
    return {
      status: 'needs_approval',
      note: `ส่วนลด ${pct}% เกินเพดาน ${ctx.maxDiscountPct}% ส่งให้ผู้จัดการอนุมัติแล้ว แจ้งลูกค้าว่าจะยืนยันให้เร็วที่สุด ห้ามสัญญาว่าจะได้แน่นอน`,
    };
  }
  const code = `AI${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
  const r = await db.query(
    `INSERT INTO discount_codes (org_id, code, type, value, max_uses, customer_id, issued_by, expires_at)
     VALUES (:orgId, :code, 'percent', :pct, 1, :customerId, 'ai_agent', UTC_TIMESTAMP() + INTERVAL 14 DAY)`,
    { orgId: ctx.orgId, code, pct, customerId: ctx.customerId ?? null },
  );
  await db.query(
    `INSERT INTO ai_offers (org_id, conversation_id, offer_type, value, discount_code_id, rationale, status)
     VALUES (:orgId, :conversationId, 'discount_code', :pct, :codeId, :reason, 'proposed')`,
    { orgId: ctx.orgId, conversationId: ctx.conversationId, pct, codeId: r.insertId, reason },
  );
  return { status: 'issued', code, percent: pct, valid_days: 14, single_use: true };
}

async function openReturnRequest(ctx, { order_no: orderNo, reason, preferred_resolution: resolution }) {
  let order = null;
  if (orderNo) order = await db.one('SELECT id, total FROM sales_orders WHERE org_id = :orgId AND order_no = :no', { orgId: ctx.orgId, no: String(orderNo).trim() });
  const r = await db.query(
    `INSERT INTO returns (org_id, order_id, conversation_id, customer_id, reason, detail, resolution, status)
     VALUES (:orgId, :orderId, :conversationId, :customerId, :reason, :detail, 'pending', 'requested')`,
    {
      orgId: ctx.orgId,
      orderId: order?.id ?? null,
      conversationId: ctx.conversationId,
      customerId: ctx.customerId ?? null,
      reason: String(reason).slice(0, 100),
      detail: `ลูกค้าต้องการ: ${resolution}${orderNo && !order ? ` (เลขออร์เดอร์ ${orderNo} ไม่พบในระบบ)` : ''}`,
    },
  );
  await db.query("UPDATE conversations SET intent = 'return' WHERE id = :id", { id: ctx.conversationId });
  return {
    return_id: r.insertId,
    status: 'requested',
    order_found: Boolean(order),
    note: 'บันทึกเรื่องแล้ว ทีมงานจะตรวจสอบ แจ้งลูกค้าขั้นตอนถัดไปตามนโยบายร้าน (เช่น ขอรูปสินค้า) และขอโทษอย่างจริงใจ',
  };
}

async function escalateToHuman(ctx, { reason }) {
  ctx.escalated = String(reason).slice(0, 255);
  return { status: 'escalated', note: 'แจ้งลูกค้าสั้นๆ ว่าจะมีแอดมินมาดูแลต่อโดยเร็ว' };
}

const EXECUTORS = {
  search_products: searchProducts,
  get_product_details: getProductDetails,
  lookup_orders: lookupOrders,
  create_discount_code: createDiscountCode,
  open_return_request: openReturnRequest,
  escalate_to_human: escalateToHuman,
};

async function runTool(ctx, name, input) {
  const fn = EXECUTORS[name];
  if (!fn) return { error: `unknown tool ${name}` };
  return fn(ctx, input ?? {});
}

module.exports = { TOOLS, runTool, money };
