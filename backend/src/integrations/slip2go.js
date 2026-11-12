'use strict';

const { AppError } = require('../core/errors');

const BASE_URL = 'https://connect.slip2go.com';
const SUCCESS_CODES = new Set(['200000', '200001', '200200']);
const CODE_MESSAGES = {
  '200000': 'พบข้อมูลสลิปในระบบธนาคาร',
  '200001': 'ขอข้อมูลสำเร็จ',
  '200200': 'สลิปถูกต้อง',
  '200401': 'บัญชีผู้รับไม่ถูกต้อง',
  '200402': 'ยอดโอนเงินไม่ตรงกับรายการ',
  '200403': 'วันที่โอนไม่ตรงเงื่อนไข',
  '200404': 'ไม่พบข้อมูลสลิปในระบบธนาคาร',
  '200500': 'สลิปเสียหายหรือไม่ถูกต้อง',
  '200501': 'สลิปนี้ถูกใช้งานแล้ว',
  '500500': 'ระบบธนาคารขัดข้อง กรุณาลองใหม่ภายหลัง',
};

async function verifySlipByImage({ secretKey, imageBuffer, mimeType, expectedAmount }) {
  if (!secretKey) throw new AppError(503, 'BILLING_NOT_CONFIGURED', 'ยังไม่ได้ตั้งค่า SLIP2GO_SECRET_KEY สำหรับตรวจสอบการชำระเงิน');
  if (!Buffer.isBuffer(imageBuffer) || !imageBuffer.length) throw new AppError(400, 'INVALID_SLIP_IMAGE', 'ไม่พบรูปสลิป');

  const imageBase64 = `data:${mimeType};base64,${imageBuffer.toString('base64')}`;
  let response;
  try {
    response = await fetch(`${BASE_URL}/api/verify-slip/qr-base64/info`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${secretKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        payload: {
          imageBase64,
          checkCondition: {
            checkDuplicate: true,
            checkAmount: { type: 'eq', amount: Number(expectedAmount).toFixed(2) },
          },
        },
      }),
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    throw new AppError(502, 'SLIP2GO_UNAVAILABLE', 'เชื่อมต่อ Slip2Go ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง');
  }

  let body;
  try {
    body = await response.json();
  } catch {
    throw new AppError(502, 'SLIP2GO_INVALID_RESPONSE', 'Slip2Go ส่งผลตรวจสอบกลับมาไม่ถูกต้อง');
  }
  if (!response.ok) {
    throw new AppError(502, 'SLIP2GO_REQUEST_FAILED', `Slip2Go ตรวจสอบสลิปไม่สำเร็จ (HTTP ${response.status})`);
  }

  const code = String(body?.code ?? '');
  const verified = SUCCESS_CODES.has(code);
  return {
    verified,
    code,
    message: CODE_MESSAGES[code] ?? (verified ? 'ตรวจสอบสลิปสำเร็จ' : 'สลิปไม่ผ่านการตรวจสอบ'),
  };
}

module.exports = { verifySlipByImage };
