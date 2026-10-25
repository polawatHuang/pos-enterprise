'use strict';

// Public legal pages (/terms, /privacy, /data-deletion — also the URLs given to Meta / TikTok app
// review): who provides the service, and data-subject requests under the PDPA (sections 30–36).
// No login: anyone, including people who only chatted with the shop, can send a request.

const crypto = require('node:crypto');
const express = require('express');
const { rateLimit, ipKeyGenerator } = require('express-rate-limit');
const { z } = require('zod');
const env = require('../../config/env');
const db = require('../../db/pool');
const { validate } = require('../../core/http');
const { notFound } = require('../../core/errors');
const { notify } = require('../notifications/notify');

const router = express.Router();

const limiter = (limit) =>
  rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: env.isTest ? 1000 : limit,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    keyGenerator: (req) => ipKeyGenerator(req.ip ?? ''),
    message: { error: { code: 'RATE_LIMITED', message: 'ส่งคำขอบ่อยเกินไป กรุณารอสักครู่' } },
  });

/** PDPA: answer within 30 days of receiving the request. */
const ANSWER_DAYS = 30;
const KIND_TH = { delete: 'ลบข้อมูล', access: 'ขอสำเนาข้อมูล', correct: 'แก้ไขข้อมูล', object: 'คัดค้านการประมวลผล', withdraw: 'ถอนความยินยอม' };

/** The service provider: the first organization (single-shop install). */
const provider = () =>
  db.one('SELECT id, name, legal_name AS legalName, tax_id AS taxId, address, phone, email FROM organizations ORDER BY id LIMIT 1');

router.get('/', limiter(120), async (req, res) => {
  const org = await provider();
  if (!org) throw notFound();
  const data = { ...org };
  delete data.id;
  res.json({ data });
});

const requestBody = z.object({
  kind: z.enum(['delete', 'access', 'correct', 'object', 'withdraw']),
  name: z.string().trim().min(1, 'กรอกชื่อ').max(191),
  contact: z.string().trim().min(5, 'กรอกอีเมลหรือเบอร์โทรที่ติดต่อกลับได้').max(191),
  platform: z.enum(['facebook', 'instagram', 'line', 'tiktok', 'shop', 'other']).default('other'),
  detail: z.string().trim().max(2000).optional(),
});

/** e.g. DR-2610-7KQ3MZ (year-month + 6 random letters/digits, no look-alikes). */
function refCode() {
  const now = new Date();
  const ym = `${String(now.getFullYear()).slice(2)}${String(now.getMonth() + 1).padStart(2, '0')}`;
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const rand = [...crypto.randomBytes(6)].map((b) => alphabet[b % alphabet.length]).join('');
  return `DR-${ym}-${rand}`;
}

router.post('/data-requests', limiter(5), validate({ body: requestBody }), async (req, res) => {
  const org = await provider();
  if (!org) throw notFound();
  const b = req.valid.body;
  const ref = refCode();
  const r = await db.query(
    `INSERT INTO data_requests (org_id, ref_code, kind, requester_name, contact, platform, detail, ip)
     VALUES (:orgId, :ref, :kind, :name, :contact, :platform, :detail, :ip)`,
    { orgId: org.id, ref, kind: b.kind, name: b.name, contact: b.contact, platform: b.platform, detail: b.detail || null, ip: req.ip ?? null },
  );
  const due = new Date(Date.now() + ANSWER_DAYS * 86_400_000);
  await notify({
    orgId: org.id,
    type: 'privacy.request',
    severity: 'warning',
    title: `คำขอ${KIND_TH[b.kind]}ส่วนบุคคล ${ref}`,
    body: `${b.name} · ${b.contact} — ต้องตอบภายใน ${due.toLocaleDateString('th-TH', { timeZone: 'Asia/Bangkok' })}`,
    link: '/settings/data',
    permission: 'settings:manage',
    refKey: `data_request:${r.insertId}`,
  });
  res.status(201).json({ data: { ref, answerDays: ANSWER_DAYS } });
});

module.exports = { router, KIND_TH, ANSWER_DAYS };
