'use strict';

/** Structured output for reading a Thai bank transfer / PromptPay slip. */
const nullable = (type, description) => ({ type: [type, 'null'], ...(description ? { description } : {}) });

const SLIP_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['isSlip', 'transRef', 'amount', 'paidAt', 'bank', 'receiverName', 'receiverAccount', 'confidence'],
  properties: {
    isSlip: { type: 'boolean', description: 'true only for a bank / PromptPay transfer confirmation slip' },
    transRef: nullable('string', 'transaction reference number (เลขที่รายการ / รหัสอ้างอิง), exactly as printed'),
    amount: nullable('number', 'transferred amount in baht'),
    paidAt: nullable('string', 'date and time as YYYY-MM-DD HH:MM in the Gregorian calendar (Buddhist Era minus 543)'),
    bank: nullable('string', 'sending bank or app name'),
    receiverName: nullable('string'),
    receiverAccount: nullable('string', 'receiver account / PromptPay number as printed, masked digits kept as x'),
    confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
  },
};

const SLIP_SYSTEM = `คุณตรวจสลิปโอนเงินของธนาคารไทยและ PromptPay ให้ร้านค้า
- อ่านเฉพาะสิ่งที่ปรากฏในรูป ถ้าไม่มีหรืออ่านไม่ออกให้ใส่ null ห้ามเดา
- transRef คือเลขที่รายการหรือรหัสอ้างอิงของธนาคาร คัดลอกตรงตามที่พิมพ์
- ปี พ.ศ. ให้แปลงเป็น ค.ศ. (ลบ 543)
- isSlip = false ถ้าไม่ใช่สลิปโอนเงิน หรือเป็นภาพหน้าจอที่ดูถูกตัดต่อ
- confidence = low ถ้ารูปไม่ชัด`;

module.exports = { SLIP_SCHEMA, SLIP_SYSTEM };
