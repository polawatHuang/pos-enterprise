'use strict';

const express = require('express');
const { rateLimit, ipKeyGenerator } = require('express-rate-limit');
const { z } = require('zod');
const env = require('../../config/env');
const { validate } = require('../../core/http');
const { authenticate, setAuthCookies } = require('../../core/auth');
const { audit } = require('../../core/audit');
const { forbidden } = require('../../core/errors');
const authService = require('../auth/auth.service');
const service = require('./saas.service');
const { passwordSchema } = require('../auth/auth.routes');

const router = express.Router();
const meta = (req) => ({ userAgent: req.get('user-agent'), ip: req.ip });

const signupLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: env.isTest ? 1000 : 8,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  keyGenerator: (req) => ipKeyGenerator(req.ip ?? ''),
  message: { error: { code: 'RATE_LIMITED', message: 'สมัครใช้งานบ่อยเกินไป กรุณาลองใหม่ภายหลัง' } },
});

const verifySlipLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: env.isTest ? 1000 : 10,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  keyGenerator: (req) => ipKeyGenerator(req.ip ?? ''),
  message: { error: { code: 'RATE_LIMITED', message: 'ตรวจสอบสลิปบ่อยเกินไป กรุณารอสักครู่แล้วลองใหม่' } },
});

router.get('/plans', async (_req, res) => {
  res.json({ data: { plans: await service.plans(), trialDays: service.TRIAL_DAYS } });
});

router.post(
  '/signup',
  signupLimiter,
  validate({
    body: z.object({
      organizationName: z.string().trim().min(2, 'ชื่อกิจการต้องมีอย่างน้อย 2 ตัวอักษร').max(191),
      fullName: z.string().trim().min(1).max(191),
      email: z.email('อีเมลไม่ถูกต้อง').transform((v) => v.trim().toLowerCase()),
      password: passwordSchema,
      acceptTerms: z.literal(true, 'กรุณายอมรับข้อกำหนดการใช้บริการและนโยบายความเป็นส่วนตัว'),
    }),
  }),
  async (req, res) => {
    const account = await service.createTenant({ ...req.valid.body, meta: meta(req) });
    const session = await authService.login(req.valid.body.email, req.valid.body.password, meta(req));
    setAuthCookies(res, session.accessToken, session.refreshToken);
    req.user = session.user;
    audit(req, 'saas.signup', 'organization', session.user.orgId, { trialDays: service.TRIAL_DAYS });
    res.status(201).json({
      data: {
        user: account.user,
        accessToken: session.accessToken,
        expiresIn: env.ACCESS_TOKEN_TTL_SEC,
        trialDays: service.TRIAL_DAYS,
      },
    });
  },
);

router.get('/me', authenticate, async (req, res) => {
  res.json({ data: await service.overview(req.user.orgId) });
});

router.get('/credits/ledger', authenticate, validate({ query: z.object({ page: z.coerce.number().int().min(1).default(1) }) }), async (req, res) => {
  res.json({ data: await service.creditHistory(req.user.orgId, req.valid.query.page) });
});

router.post(
  '/checkout',
  authenticate,
  validate({
    body: z
      .object({
        planCode: z.enum(['starter', 'growth', 'business']).optional(),
        credits: z.coerce.number().int().positive().optional(),
      })
      .refine((body) => Number(Boolean(body.planCode)) + Number(body.credits != null) === 1, {
        message: 'เลือกแพ็กเกจสมาชิกหรือเครดิต AI อย่างใดอย่างหนึ่ง',
      }),
  }),
  async (req, res) => {
    const checkout = await service.createCheckout(req.user.orgId, req.valid.body);
    audit(req, 'saas.checkout.create', 'saas_payment_order', checkout.id, { type: checkout.type, amount: checkout.amount });
    res.status(201).json({ data: checkout });
  },
);

router.get('/orders/:id', authenticate, validate({ params: z.object({ id: z.uuid() }) }), async (req, res) => {
  res.json({ data: await service.reconcileOrder(req.user.orgId, req.valid.params.id) });
});

router.post(
  '/orders/:id/verify-slip',
  authenticate,
  verifySlipLimiter,
  validate({
    params: z.object({ id: z.uuid() }),
    body: z.object({
      mimeType: z.enum(['image/jpeg', 'image/png', 'image/webp']),
      imageBase64: z.string().min(1).max(7_000_000).regex(/^[A-Za-z0-9+/]+={0,2}$/, 'รูปสลิปไม่ถูกต้อง'),
    }),
  }),
  async (req, res) => {
    const result = await service.verifyOrderSlip(req.user.orgId, req.valid.params.id, req.valid.body);
    audit(req, 'saas.checkout.verify-slip', 'saas_payment_order', req.valid.params.id, {
      verified: result.verified,
      status: result.status,
      code: result.code,
    });
    res.json({ data: result });
  },
);

router.get('/admin/organizations', authenticate, async (req, res) => {
  if (!req.user.platformAdmin) throw forbidden('เฉพาะ platform super-admin เท่านั้น');
  res.json({ data: await service.adminOrganizations() });
});

module.exports = { router };
