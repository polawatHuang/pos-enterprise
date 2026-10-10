'use strict';

// Phase 4 integration tests: unified inbox, webhooks, AI sales agent (MiniMax mocked), after-sales.
// Requires schema.sql + seed.sql (+ migrations) imported.
process.env.NODE_ENV = 'test';

const crypto = require('node:crypto');
const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { createApp } = require('../src/app');
const db = require('../src/db/pool');
const minimax = require('../src/integrations/minimax');

const app = createApp();
const RUN = Date.now().toString(36);
const createdConvs = [];
const fetchCalls = [];
let manager;
let support;
let viewer;
let cashier;
const originalFetch = global.fetch;
const originalCreate = minimax.createMessage;

async function cookie(email) {
  const res = await request(app).post('/api/auth/login').send({ email, password: 'Admin@1234' });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  return res.headers['set-cookie'].map((c) => c.split(';')[0]).join('; ');
}
const as = (c) => ({
  get: (url) => request(app).get(url).set('Cookie', c),
  post: (url, body) => request(app).post(url).set('Cookie', c).send(body),
  patch: (url, body) => request(app).patch(url).set('Cookie', c).send(body),
  put: (url, body) => request(app).put(url).set('Cookie', c).send(body),
  delete: (url) => request(app).delete(url).set('Cookie', c),
});

/** Scripted MiniMax: each call returns the next response; records requests. */
function script(responses) {
  const calls = [];
  minimax.createMessage = async (params) => {
    calls.push(JSON.parse(JSON.stringify(params)));
    const next = responses[Math.min(calls.length - 1, responses.length - 1)];
    return { model: 'MiniMax-M3', usage: { input_tokens: 10, output_tokens: 5 }, ...next };
  };
  return calls;
}
const say = (text) => ({ stop_reason: 'end_turn', content: [{ type: 'text', text }] });
const useTool = (name, input, id = `tu_${name}`) => ({ stop_reason: 'tool_use', content: [{ type: 'tool_use', id, name, input }] });

async function simulate(text, threadId) {
  const res = await manager.post('/api/inbox/simulate', { text, threadId, customerName: 'ลูกค้าเทส' });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  if (!createdConvs.includes(res.body.data.conversationId)) createdConvs.push(res.body.data.conversationId);
  return res.body.data;
}
const convRow = (id) => db.one('SELECT * FROM conversations WHERE id = :id', { id });
async function waitFor(fn, ms = 3000) {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) return v;
    await new Promise((r) => setTimeout(r, 50));
  }
}

before(async () => {
  process.env.MINIMAX_API_KEY = 'test-key';
  delete process.env.AI_PROVIDER;
  global.fetch = async (url, init = {}) => {
    fetchCalls.push({ url: String(url), method: init.method ?? 'GET', body: init.body ? JSON.parse(init.body) : null });
    if (String(url).includes('/profile/')) return new Response(JSON.stringify({ displayName: 'คุณไลน์' }), { status: 200 });
    return new Response('{}', { status: 200 });
  };
  manager = as(await cookie('manager@example.com'));
  support = as(await cookie('support@example.com'));
  viewer = as(await cookie('viewer@example.com'));
  cashier = as(await cookie('cashier@example.com'));
});

after(async () => {
  global.fetch = originalFetch;
  minimax.createMessage = originalCreate;
  for (const k of ['MINIMAX_API_KEY', 'LINE_CHANNEL_SECRET', 'LINE_CHANNEL_ACCESS_TOKEN', 'META_APP_SECRET', 'META_WEBHOOK_VERIFY_TOKEN', 'META_PAGE_ACCESS_TOKEN']) {
    delete process.env[k];
  }
  // Let fire-and-forget webhook replies settle before tearing down
  await new Promise((r) => setTimeout(r, 300));
  if (createdConvs.length) {
    const convs = await db.query('SELECT customer_id FROM conversations WHERE id IN (:ids)', { ids: createdConvs });
    await db.query('DELETE FROM discount_codes WHERE id IN (SELECT discount_code_id FROM ai_offers WHERE conversation_id IN (:ids))', { ids: createdConvs });
    await db.query('DELETE FROM ai_offers WHERE conversation_id IN (:ids)', { ids: createdConvs });
    await db.query('DELETE FROM returns WHERE conversation_id IN (:ids)', { ids: createdConvs });
    await db.query('DELETE FROM disputes WHERE conversation_id IN (:ids)', { ids: createdConvs });
    await db.query('DELETE FROM messages WHERE conversation_id IN (:ids)', { ids: createdConvs });
    await db.query('DELETE FROM conversations WHERE id IN (:ids)', { ids: createdConvs });
    const custIds = convs.map((c) => c.customer_id).filter(Boolean);
    if (custIds.length) await db.query('DELETE FROM customers WHERE id IN (:ids)', { ids: custIds });
  }
  await db.query("DELETE FROM jobs WHERE type = 'inbox.ai_reply'");
  await db.query("DELETE FROM product_knowledge WHERE org_id = 1 AND product_id IS NULL AND answer LIKE 'TEST-%'");
  await db.query("DELETE FROM channels WHERE external_id LIKE 'test-%'");
  await db.pool.end();
});

describe('AI sales agent (MiniMax by default)', () => {
  test('answers via the tool loop: search_products -> final text, using real product data', async () => {
    const calls = script([useTool('search_products', { query: 'เสื้อ' }), say('มีเสื้อโอเวอร์ไซซ์ราคา 390 บาทค่ะ สนใจไซซ์ไหนคะ')]);
    const r = await simulate('มีเสื้อไหมคะ', `sim-${RUN}-1`);
    assert.equal(r.status, 'replied');
    assert.deepEqual(r.tools, ['search_products']);
    assert.equal(calls.length, 2);
    // second call carries the tool result with products from the DB
    const toolResult = calls[1].messages.at(-1).content[0];
    assert.equal(toolResult.type, 'tool_result');
    assert.match(toolResult.content, /เสื้อโอเวอร์ไซซ์/);
    assert.match(calls[0].system, /น้องเดโม/); // seeded agent persona
    assert.ok(calls[0].tools.some((t) => t.name === 'create_discount_code'));

    const detail = await support.get(`/api/inbox/conversations/${r.conversationId}`);
    assert.equal(detail.status, 200);
    const out = detail.body.data.messages.filter((m) => m.senderType === 'ai');
    assert.equal(out.length, 1);
    assert.equal(out[0].aiMeta.provider, 'minimax');
    assert.equal(out[0].deliveryStatus, 'sent'); // website channel: stored, not pushed
  });

  test('strips <think> blocks and keeps context across turns', async () => {
    const thread = `sim-${RUN}-2`;
    script([say('<think>ลูกค้าถามราคา</think>สวัสดีค่ะ ยินดีให้บริการค่ะ')]);
    const first = await simulate('สวัสดีค่ะ', thread);
    assert.equal(first.reply, 'สวัสดีค่ะ ยินดีให้บริการค่ะ');
    const calls = script([say('ได้เลยค่ะ')]);
    const second = await simulate('ขอดูสินค้าหน่อย', thread);
    assert.equal(second.conversationId, first.conversationId);
    assert.deepEqual(
      calls[0].messages.map((m) => m.role),
      ['user', 'assistant', 'user'],
    );
  });

  test('discount within the cap is issued as a single-use code', async () => {
    script([useTool('create_discount_code', { percent: 5, reason: 'ลูกค้าลังเลเรื่องราคา' }), say('ให้โค้ดส่วนลด 5% ค่ะ')]);
    const r = await simulate('ลดได้ไหมคะ', `sim-${RUN}-3`);
    const offer = await db.one('SELECT o.*, d.code, d.max_uses FROM ai_offers o JOIN discount_codes d ON d.id = o.discount_code_id WHERE o.conversation_id = :id', { id: r.conversationId });
    assert.equal(offer.status, 'proposed');
    assert.match(offer.code, /^AI[0-9A-F]{6}$/);
    assert.equal(offer.max_uses, 1);

    // A second discount in the same chat is refused server-side
    const calls = script([useTool('create_discount_code', { percent: 5, reason: 'ขออีก' }), say('ขออภัยค่ะ')]);
    await simulate('ขอลดอีกได้ไหม', `sim-${RUN}-3`);
    assert.match(calls[1].messages.at(-1).content[0].content, /ห้ามออกซ้ำ/);
    assert.equal(calls[1].messages.at(-1).content[0].is_error, true);
  });

  test('discount above the cap waits for manager approval; approving sends the code', async () => {
    script([useTool('create_discount_code', { percent: 30, reason: 'ลูกค้าซื้อจำนวนมาก' }), say('ขอเช็กกับผู้จัดการก่อนนะคะ')]);
    const r = await simulate('ซื้อ 20 ชิ้นลด 30% ได้ไหม', `sim-${RUN}-4`);
    const offer = await db.one('SELECT * FROM ai_offers WHERE conversation_id = :id', { id: r.conversationId });
    assert.equal(offer.status, 'needs_approval');
    assert.equal(offer.discount_code_id, null);

    assert.equal((await support.post(`/api/inbox/offers/${offer.id}/approve`)).status, 403);
    const ok = await manager.post(`/api/inbox/offers/${offer.id}/approve`);
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    const again = await manager.post(`/api/inbox/offers/${offer.id}/approve`);
    assert.equal(again.status, 409);
    const msg = await db.one("SELECT content FROM messages WHERE conversation_id = :id AND sender_type = 'agent' ORDER BY id DESC LIMIT 1", { id: r.conversationId });
    assert.ok(msg.content.includes(ok.body.data.code));
  });

  test('return request is recorded and listed for after-sales', async () => {
    script([
      useTool('open_return_request', { order_no: 'NOPE-0000', reason: 'สินค้าชำรุด', preferred_resolution: 'exchange' }),
      say('ขอโทษด้วยนะคะ บันทึกเรื่องเปลี่ยนสินค้าให้แล้วค่ะ'),
    ]);
    const r = await simulate('ได้ของมาขาดค่ะ', `sim-${RUN}-5`);
    const conv = await convRow(r.conversationId);
    assert.equal(conv.intent, 'return');
    const list = await support.get('/api/inbox/returns?status=requested');
    const ret = list.body.data.find((x) => x.conversationId === r.conversationId);
    assert.ok(ret);
    assert.match(ret.detail, /ไม่พบในระบบ/);
    assert.equal((await support.patch(`/api/inbox/returns/${ret.id}`, { status: 'approved' })).status, 403);
    const upd = await manager.patch(`/api/inbox/returns/${ret.id}`, { status: 'approved', resolution: 'exchange', resolutionNote: 'ส่งของใหม่', notifyCustomer: 'อนุมัติการเปลี่ยนสินค้าแล้วค่ะ' });
    assert.equal(upd.status, 200);
    const row = await db.one('SELECT status, resolution_note FROM returns WHERE id = :id', { id: ret.id });
    assert.equal(row.status, 'approved');
    assert.equal(row.resolution_note, 'ส่งของใหม่');
  });

  test('escalate_to_human replies, then hands the chat to a human', async () => {
    script([useTool('escalate_to_human', { reason: 'ลูกค้าโกรธมาก' }), say('เดี๋ยวแอดมินจะมาดูแลต่อนะคะ')]);
    const r = await simulate('แย่มาก', `sim-${RUN}-6`);
    assert.equal(r.status, 'replied');
    const conv = await convRow(r.conversationId);
    assert.equal(conv.mode, 'human');
    assert.equal(conv.handoff_reason, 'ลูกค้าโกรธมาก');

    // AI stays quiet in human mode
    const calls = script([say('ไม่ควรตอบ')]);
    const next = await simulate('ยังรออยู่นะ', `sim-${RUN}-6`);
    assert.equal(next.status, 'ai_off');
    assert.equal(calls.length, 0);
  });

  test('handoff keyword skips the model entirely', async () => {
    const calls = script([say('ไม่ควรถูกเรียก')]);
    const r = await simulate('ขอคุยกับคนหน่อย', `sim-${RUN}-7`);
    assert.equal(r.status, 'handoff');
    assert.equal(calls.length, 0);
    assert.equal((await convRow(r.conversationId)).mode, 'human');
  });

  test('without a MiniMax key the chat is handed to a human', async () => {
    delete process.env.MINIMAX_API_KEY;
    try {
      const r = await simulate('สวัสดี', `sim-${RUN}-8`);
      assert.equal(r.status, 'not_configured');
      const conv = await convRow(r.conversationId);
      assert.equal(conv.mode, 'human');
      assert.match(conv.handoff_reason, /minimax/);
    } finally {
      process.env.MINIMAX_API_KEY = 'test-key';
    }
  });

  test('a model error is reported by the simulator and the lock is released', async () => {
    minimax.createMessage = async () => {
      throw new Error('upstream 529');
    };
    const r = await simulate('มีของไหม', `sim-${RUN}-9`);
    assert.equal(r.status, 'error');
    assert.equal((await convRow(r.conversationId)).ai_lock_until, null);
  });
});

describe('inbox API', () => {
  test('staff reply pauses the AI; switching back to AI is logged', async () => {
    script([say('สวัสดีค่ะ')]);
    const r = await simulate('สวัสดี', `sim-${RUN}-10`);
    const reply = await support.post(`/api/inbox/conversations/${r.conversationId}/messages`, { text: 'แอดมินมาแล้วค่ะ' });
    assert.equal(reply.status, 201, JSON.stringify(reply.body));
    assert.equal((await convRow(r.conversationId)).mode, 'human');

    const back = await support.patch(`/api/inbox/conversations/${r.conversationId}`, { mode: 'ai', status: 'resolved' });
    assert.equal(back.status, 200);
    assert.equal(back.body.data.mode, 'ai');
    assert.equal(back.body.data.status, 'resolved');
    const note = await db.one("SELECT content FROM messages WHERE conversation_id = :id AND sender_type = 'system' ORDER BY id DESC LIMIT 1", { id: r.conversationId });
    assert.match(note.content, /AI/);

    // A new customer message reopens the resolved chat
    script([say('ยินดีค่ะ')]);
    await simulate('ขอบคุณค่ะ', `sim-${RUN}-10`);
    assert.equal((await convRow(r.conversationId)).status, 'open');
  });

  test('list views, summary and read marker', async () => {
    const list = await viewer.get('/api/inbox/conversations?view=all&limit=100');
    assert.equal(list.status, 200);
    assert.ok(list.body.data.length >= 5);
    const human = await viewer.get('/api/inbox/conversations?view=human');
    assert.ok(human.body.data.every((c) => c.mode === 'human'));
    const summary = await viewer.get('/api/inbox/summary');
    assert.equal(summary.body.data.aiProvider, 'minimax');
    assert.equal(summary.body.data.aiConfigured, true);
    const id = createdConvs[0];
    assert.equal((await viewer.post(`/api/inbox/conversations/${id}/read`)).status, 200);
    assert.equal(Number((await convRow(id)).unread_count), 0);
  });

  test('permissions: viewer cannot reply, cashier has no inbox access', async () => {
    assert.equal((await viewer.post(`/api/inbox/conversations/${createdConvs[0]}/messages`, { text: 'x' })).status, 403);
    assert.equal((await cashier.get('/api/inbox/conversations')).status, 403);
    assert.equal((await support.post('/api/inbox/simulate', { text: 'x' })).status, 403);
    assert.equal((await support.put('/api/inbox/agent', { name: 'x', persona: null, salesRules: null, maxDiscountPct: 5, handoffKeywords: null })).status, 403);
  });

  test('agent profile and store knowledge feed the system prompt', async () => {
    const before = (await manager.get('/api/inbox/agent')).body.data;
    const k = await manager.post('/api/inbox/knowledge', { kind: 'policy', question: 'ส่งกี่วัน', answer: 'TEST-ส่งภายใน 2 วันทำการ' });
    assert.equal(k.status, 201);
    const put = await manager.put('/api/inbox/agent', { ...before, maxDiscountPct: 7 });
    assert.equal(put.status, 200);
    try {
      const calls = script([say('ส่งภายใน 2 วันค่ะ')]);
      await simulate('ส่งกี่วันคะ', `sim-${RUN}-11`);
      assert.match(calls[0].system, /TEST-ส่งภายใน 2 วันทำการ/);
      assert.match(calls[0].system, /ไม่เกิน 7%/);
    } finally {
      await manager.put('/api/inbox/agent', { name: before.name, persona: before.persona, salesRules: before.salesRules, maxDiscountPct: before.maxDiscountPct, handoffKeywords: before.handoffKeywords });
      assert.equal((await manager.delete(`/api/inbox/knowledge/${k.body.data.id}`)).status, 200);
    }
  });

  test('channels list exposes webhook URLs; duplicate channel is rejected', async () => {
    const res = await manager.get('/api/inbox/channels');
    assert.equal(res.status, 200);
    const lineCh = res.body.data.find((c) => c.platform === 'line');
    assert.match(lineCh.webhookUrl, /\/webhooks\/line$/);
    const body = { platform: 'website', name: 'เว็บทดสอบ', externalId: `test-${RUN}` };
    assert.equal((await manager.post('/api/inbox/channels', body)).status, 201);
    assert.equal((await manager.post('/api/inbox/channels', body)).status, 409);
  });

  test('disputes: create, list, resolve', async () => {
    const c = await support.post('/api/inbox/disputes', { conversationId: createdConvs[0], platform: 'shopee', category: 'ไม่ได้รับสินค้า', severity: 'high' });
    assert.equal(c.status, 201);
    const list = await support.get('/api/inbox/disputes');
    assert.ok(list.body.data.some((d) => d.id === c.body.data.id));
    const upd = await manager.patch(`/api/inbox/disputes/${c.body.data.id}`, { status: 'resolved', resolutionNote: 'คืนเงินแล้ว' });
    assert.equal(upd.status, 200);
    const row = await db.one('SELECT status, resolved_at FROM disputes WHERE id = :id', { id: c.body.data.id });
    assert.equal(row.status, 'resolved');
    assert.ok(row.resolved_at);
  });
});

describe('webhooks', () => {
  const lineSecret = 'line-secret-test';
  const metaSecret = 'meta-secret-test';

  test('return 503 when the platform is not configured', async () => {
    delete process.env.LINE_CHANNEL_SECRET;
    const res = await request(app).post('/webhooks/line').set('Content-Type', 'application/json').send('{}');
    assert.equal(res.status, 503);
  });

  test('LINE: rejects a bad signature', async () => {
    process.env.LINE_CHANNEL_SECRET = lineSecret;
    const res = await request(app).post('/webhooks/line').set('Content-Type', 'application/json').set('x-line-signature', 'bad').send('{"events":[]}');
    assert.equal(res.status, 401);
  });

  test('LINE: signed message is ingested once, answered with the reply token', async () => {
    process.env.LINE_CHANNEL_SECRET = lineSecret;
    process.env.LINE_CHANNEL_ACCESS_TOKEN = 'line-token';
    script([say('สวัสดีค่ะ คุณไลน์')]);
    fetchCalls.length = 0;
    const userId = `U${RUN}`;
    const payload = JSON.stringify({
      destination: 'line_demo',
      events: [
        {
          type: 'message',
          webhookEventId: `ev-${RUN}`,
          replyToken: 'rt-1',
          source: { type: 'user', userId },
          message: { type: 'text', id: `m-${RUN}`, text: 'สวัสดีค่ะ' },
        },
      ],
    });
    const sig = crypto.createHmac('sha256', lineSecret).update(payload).digest('base64');
    const send = () => request(app).post('/webhooks/line').set('Content-Type', 'application/json').set('x-line-signature', sig).send(payload);
    assert.equal((await send()).status, 200);

    const conv = await waitFor(() => db.one("SELECT c.* FROM conversations c JOIN channels ch ON ch.id = c.channel_id WHERE ch.platform = 'line' AND c.external_thread_id = :t", { t: userId }));
    assert.ok(conv, 'conversation created');
    createdConvs.push(conv.id);
    assert.equal(conv.customer_name, 'คุณไลน์');
    const ai = await waitFor(() => db.one("SELECT * FROM messages WHERE conversation_id = :id AND sender_type = 'ai'", { id: conv.id }));
    assert.ok(ai, 'AI replied');
    assert.equal(ai.delivery_status, 'delivered');
    const replyCall = fetchCalls.find((c) => c.url.endsWith('/message/reply'));
    assert.equal(replyCall.body.replyToken, 'rt-1');
    assert.equal(replyCall.body.messages[0].text, 'สวัสดีค่ะ คุณไลน์');
    const job = await db.one("SELECT id FROM jobs WHERE type = 'inbox.ai_reply' AND JSON_EXTRACT(payload, '$.conversationId') = :id", { id: conv.id });
    assert.ok(job, 'fallback job queued');

    // Redelivery of the same event is ignored
    assert.equal((await send()).status, 200);
    await new Promise((r) => setTimeout(r, 200));
    const count = await db.one("SELECT COUNT(*) AS n FROM messages WHERE conversation_id = :id AND sender_type = 'customer'", { id: conv.id });
    assert.equal(Number(count.n), 1);

    // The queued fallback is a no-op once answered
    const { replyToConversation } = require('../src/modules/inbox/agent.service');
    assert.equal((await replyToConversation(conv.id)).status, 'already_answered');
  });

  test('Meta: verification challenge and signed message within the 24h window', async () => {
    process.env.META_APP_SECRET = metaSecret;
    process.env.META_WEBHOOK_VERIFY_TOKEN = 'verify-me';
    process.env.META_PAGE_ACCESS_TOKEN = 'page-token';
    const ch = await request(app).get('/webhooks/meta').query({ 'hub.mode': 'subscribe', 'hub.verify_token': 'verify-me', 'hub.challenge': '12345' });
    assert.equal(ch.status, 200);
    assert.equal(ch.text, '12345');
    assert.equal((await request(app).get('/webhooks/meta').query({ 'hub.mode': 'subscribe', 'hub.verify_token': 'nope', 'hub.challenge': '1' })).status, 403);

    script([say('สวัสดีค่ะ จากเพจ')]);
    fetchCalls.length = 0;
    const psid = `P${RUN}`;
    const payload = JSON.stringify({
      object: 'page',
      entry: [
        {
          id: 'page_demo',
          messaging: [
            { sender: { id: 'page_demo' }, recipient: { id: psid }, message: { mid: `echo-${RUN}`, text: 'echo', is_echo: true } },
            { sender: { id: psid }, recipient: { id: 'page_demo' }, message: { mid: `mid-${RUN}`, text: 'มีสินค้าไหม' } },
          ],
        },
      ],
    });
    const bad = await request(app).post('/webhooks/meta').set('Content-Type', 'application/json').set('x-hub-signature-256', 'sha256=00').send(payload);
    assert.equal(bad.status, 401);
    const sig = `sha256=${crypto.createHmac('sha256', metaSecret).update(payload).digest('hex')}`;
    assert.equal((await request(app).post('/webhooks/meta').set('Content-Type', 'application/json').set('x-hub-signature-256', sig).send(payload)).status, 200);

    const conv = await waitFor(() => db.one("SELECT c.* FROM conversations c JOIN channels ch ON ch.id = c.channel_id WHERE ch.platform = 'facebook' AND c.external_thread_id = :t", { t: psid }));
    assert.ok(conv);
    createdConvs.push(conv.id);
    const ai = await waitFor(() => db.one("SELECT * FROM messages WHERE conversation_id = :id AND sender_type = 'ai'", { id: conv.id }));
    assert.equal(ai?.delivery_status, 'delivered');
    const sent = fetchCalls.find((c) => c.url.includes('/me/messages'));
    assert.equal(sent.body.recipient.id, psid);
    assert.equal(sent.body.messaging_type, 'RESPONSE');
    const echoes = await db.one('SELECT COUNT(*) AS n FROM messages WHERE external_message_id = :mid', { mid: `echo-${RUN}` });
    assert.equal(Number(echoes.n), 0);

    // Outside the 24h window a staff reply is recorded as failed, not sent
    await db.query('UPDATE conversations SET last_customer_message_at = UTC_TIMESTAMP() - INTERVAL 25 HOUR WHERE id = :id', { id: conv.id });
    const late = await support.post(`/api/inbox/conversations/${conv.id}/messages`, { text: 'ตามงานค่ะ' });
    assert.equal(late.status, 201);
    assert.equal(late.body.data.deliveryStatus, 'failed');
    assert.match(late.body.data.error, /24/);
  });
});
