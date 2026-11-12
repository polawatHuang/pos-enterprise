'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { verifySlipByImage } = require('../src/integrations/slip2go');

const imageBuffer = Buffer.from('fake image bytes');

test('Slip2Go slip verification sends exact amount and duplicate checks', async () => {
  const originalFetch = global.fetch;
  let request;
  global.fetch = async (url, options) => {
    request = { url, options, body: JSON.parse(options.body) };
    return Response.json({ code: '200200' });
  };
  try {
    const result = await verifySlipByImage({
      secretKey: 'slip2go-test-key',
      imageBuffer,
      mimeType: 'image/png',
      expectedAmount: 1069.3,
    });
    assert.equal(request.url, 'https://connect.slip2go.com/api/verify-slip/qr-base64/info');
    assert.equal(request.options.headers.Authorization, 'Bearer slip2go-test-key');
    assert.equal(request.body.payload.imageBase64, `data:image/png;base64,${imageBuffer.toString('base64')}`);
    assert.deepEqual(request.body.payload.checkCondition, {
      checkDuplicate: true,
      checkAmount: { type: 'eq', amount: '1069.30' },
    });
    assert.equal(result.verified, true);
  } finally {
    global.fetch = originalFetch;
  }
});

test('Slip2Go amount mismatch and duplicate slip are not treated as paid', async (t) => {
  const originalFetch = global.fetch;
  t.after(() => { global.fetch = originalFetch; });
  for (const [code, message] of [['200402', 'ยอดโอนเงินไม่ตรงกับรายการ'], ['200501', 'สลิปนี้ถูกใช้งานแล้ว']]) {
    global.fetch = async () => Response.json({ code });
    const result = await verifySlipByImage({
      secretKey: 'slip2go-test-key',
      imageBuffer,
      mimeType: 'image/jpeg',
      expectedAmount: 500,
    });
    assert.equal(result.verified, false);
    assert.equal(result.message, message);
  }
});

test('Slip2Go transport errors are surfaced without exposing credentials', async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => { throw new Error('network failure'); };
  try {
    await assert.rejects(
      verifySlipByImage({ secretKey: 'private-test-key', imageBuffer, mimeType: 'image/jpeg', expectedAmount: 500 }),
      (err) => err.code === 'SLIP2GO_UNAVAILABLE' && !err.message.includes('private-test-key'),
    );
  } finally {
    global.fetch = originalFetch;
  }
});
