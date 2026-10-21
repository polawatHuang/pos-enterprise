'use strict';

const express = require('express');
const { z } = require('zod');
const { validate } = require('../../core/http');
const { requirePermission } = require('../../core/auth');
const { audit } = require('../../core/audit');
const { badRequest } = require('../../core/errors');
const ai = require('../../integrations/ai');
const { CATEGORIES, WHT_TYPES } = require('./transactions.routes');
const { getTaxSettings } = require('../org/tax');

const router = express.Router();

const MAX_BYTES = 4 * 1024 * 1024;

/** Structured-output schema: the model must return exactly these fields (null when unreadable). */
const nullable = (type) => ({ type: [type, 'null'] });
const RECEIPT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [
    'vendorName',
    'vendorTaxId',
    'isFullTaxInvoice',
    'documentNo',
    'date',
    'subtotal',
    'vatAmount',
    'whtAmount',
    'total',
    'category',
    'description',
    'confidence',
  ],
  properties: {
    vendorName: nullable('string'),
    vendorTaxId: { type: ['string', 'null'], description: '13-digit Thai tax ID, digits only' },
    isFullTaxInvoice: { type: 'boolean', description: 'true only for a full tax invoice (ใบกำกับภาษีเต็มรูป) showing the buyer name' },
    documentNo: nullable('string'),
    date: { type: ['string', 'null'], description: 'YYYY-MM-DD in the Gregorian calendar (convert Buddhist Era years by subtracting 543)' },
    subtotal: { type: ['number', 'null'], description: 'amount before VAT' },
    vatAmount: nullable('number'),
    whtAmount: nullable('number'),
    total: { type: ['number', 'null'], description: 'grand total actually charged' },
    category: { type: 'string', enum: CATEGORIES.expense.map((c) => c.name) },
    description: { type: 'string', description: 'short Thai description of what was purchased' },
    confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
  },
};

const system = (vatRate) => `คุณเป็นผู้ช่วยนักบัญชีไทย อ่านรูปใบเสร็จ/ใบกำกับภาษี/บิลค่าใช้จ่าย แล้วดึงข้อมูลเพื่อบันทึกรายจ่าย
- อ่านเฉพาะสิ่งที่ปรากฏในเอกสาร ถ้าอ่านไม่ออกหรือไม่มี ให้ใส่ null ห้ามเดา
- ปี พ.ศ. ให้แปลงเป็น ค.ศ. (ลบ 543)
- ถ้ามีแค่ยอดรวมที่รวม VAT แล้ว ให้คำนวณ subtotal = total * 100/${100 + vatRate} และ vatAmount = total - subtotal เฉพาะเมื่อเอกสารระบุว่ามี VAT
- isFullTaxInvoice = true เฉพาะใบกำกับภาษีเต็มรูปที่มีเลขผู้เสียภาษีผู้ขายและชื่อผู้ซื้อ (ใบกำกับอย่างย่อ/บิลเงินสด = false)
- เลือก category ที่ใกล้เคียงที่สุดจากรายการที่กำหนด
- confidence = low ถ้ารูปไม่ชัดหรือไม่ใช่เอกสารการเงิน`;

const body = z.object({
  mediaType: z.enum(['image/jpeg', 'image/png', 'image/webp', 'application/pdf']),
  data: z.string().min(100).max(Math.ceil((MAX_BYTES * 4) / 3) + 16, 'ไฟล์ใหญ่เกิน 4 MB'),
});

/**
 * Reads a receipt photo/PDF and returns suggested expense fields. Nothing is saved here:
 * the user reviews the pre-filled form and saves it through POST /transactions.
 */
router.post('/extract-receipt', requirePermission('accounting:write'), validate({ body }), async (req, res) => {
  ai.requireConfig(); // 503 INTEGRATION_NOT_CONFIGURED for the active provider (MiniMax by default)
  const { mediaType, data } = req.valid.body;
  if (!/^[A-Za-z0-9+/]+=*$/.test(data)) throw badRequest('ไฟล์ไม่ถูกต้อง (ต้องเป็น base64)');

  const source = { type: 'base64', media_type: mediaType, data };
  const fileBlock = mediaType === 'application/pdf' ? { type: 'document', source } : { type: 'image', source };
  const { data: parsed, model, provider } = await ai.extractStructured({
    system: system((await getTaxSettings(req.user.orgId)).vatRate),
    schema: RECEIPT_SCHEMA,
    toolName: 'submit_receipt',
    toolDescription: 'ส่งข้อมูลที่อ่านได้จากใบเสร็จ',
    content: [fileBlock, { type: 'text', text: 'ดึงข้อมูลจากเอกสารนี้' }],
  });

  // Suggest a WHT type from the category (the user confirms it in the form)
  const whtHint = { ค่าเช่า: '40(5)', ค่าโฆษณา: '40(8)-ads', ค่าขนส่ง: '40(8)-transport' }[parsed.category] ?? null;
  audit(req, 'ai.extract_receipt', 'transaction', null, { confidence: parsed.confidence, model, provider });
  res.json({
    data: {
      ...parsed,
      vendorTaxId: parsed.vendorTaxId ? String(parsed.vendorTaxId).replace(/\D/g, '') || null : null,
      suggestedWhtType: whtHint ? WHT_TYPES.find((w) => w.code === whtHint) : null,
      model,
      provider,
    },
  });
});

module.exports = { router, RECEIPT_SCHEMA, MAX_BYTES };
