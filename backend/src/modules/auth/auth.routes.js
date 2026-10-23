'use strict';

const express = require('express');
const { rateLimit, ipKeyGenerator } = require('express-rate-limit');
const { z } = require('zod');
const env = require('../../config/env');
const { validate } = require('../../core/http');
const { authenticate, setAuthCookies, clearAuthCookies, REFRESH_COOKIE } = require('../../core/auth');
const { audit } = require('../../core/audit');
const { forbidden } = require('../../core/errors');
const service = require('./auth.service');

const router = express.Router();

const passwordSchema = z
  .string()
  .min(8, 'รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร')
  .max(128)
  .regex(/[A-Za-z]/, 'ต้องมีตัวอักษรภาษาอังกฤษอย่างน้อย 1 ตัว')
  .regex(/\d/, 'ต้องมีตัวเลขอย่างน้อย 1 ตัว');

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: env.isTest ? 1000 : 20,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  // Key by IP *and* email: behind the Vercel rewrite many users can share an upstream IP,
  // so an IP-only key would let one user's typos lock out everyone. Per-account lockout
  // in auth.service still stops password guessing against a single account.
  keyGenerator: (req) => `${ipKeyGenerator(req.ip ?? '')}|${String(req.body?.email ?? '').toLowerCase().slice(0, 191)}`,
  message: { error: { code: 'RATE_LIMITED', message: 'พยายามเข้าสู่ระบบบ่อยเกินไป กรุณารอสักครู่' } },
});

const meta = (req) => ({ userAgent: req.get('user-agent'), ip: req.ip });

// Refresh token is read from the httpOnly cookie, or from the body for non-browser clients.
const readRefresh = (req) => req.cookies?.[REFRESH_COOKIE] || req.body?.refreshToken || null;

router.post(
  '/login',
  loginLimiter,
  validate({ body: z.object({ email: z.email('อีเมลไม่ถูกต้อง'), password: z.string().min(1).max(128) }) }),
  async (req, res) => {
    const { email, password } = req.valid.body;
    const result = await service.login(email, password, meta(req));
    setAuthCookies(res, result.accessToken, result.refreshToken);
    req.user = result.user;
    audit(req, 'auth.login', 'user', result.user.id);
    res.json({ data: { user: result.user, accessToken: result.accessToken, expiresIn: env.ACCESS_TOKEN_TTL_SEC } });
  },
);

router.post('/refresh', async (req, res) => {
  try {
    const result = await service.refresh(readRefresh(req), meta(req));
    setAuthCookies(res, result.accessToken, result.refreshToken);
    res.json({ data: { user: result.user, accessToken: result.accessToken, expiresIn: env.ACCESS_TOKEN_TTL_SEC } });
  } catch (err) {
    clearAuthCookies(res);
    throw err;
  }
});

router.post('/logout', async (req, res) => {
  await service.logout(readRefresh(req));
  clearAuthCookies(res);
  res.json({ data: { ok: true } });
});

router.get('/me', authenticate, async (req, res) => {
  res.json({ data: { user: await service.me(req.user.id) } });
});

router.post(
  '/change-password',
  authenticate,
  validate({ body: z.object({ currentPassword: z.string().min(1), newPassword: passwordSchema }) }),
  async (req, res) => {
    const { currentPassword, newPassword } = req.valid.body;
    const result = await service.changePassword(req.user.id, currentPassword, newPassword, meta(req));
    setAuthCookies(res, result.accessToken, result.refreshToken);
    audit(req, 'auth.change_password', 'user', req.user.id);
    res.json({ data: { user: result.user } });
  },
);

/** A manager's own 4-6 digit PIN for approving refunds, voids and overrides on a cashier's till. */
router.put(
  '/pin',
  authenticate,
  validate({ body: z.object({ currentPassword: z.string().min(1), pin: z.string().regex(/^\d{4,6}$/, 'PIN เป็นตัวเลข 4-6 หลัก') }) }),
  async (req, res) => {
    if (!req.user.permissions.includes('pos:manage')) throw forbidden('PIN ใช้สำหรับผู้จัดการที่อนุมัติงานหน้าร้าน');
    await service.verifyPassword(req.user.id, req.valid.body.currentPassword);
    await require('../pos/approvals').setPin(req.user.id, req.valid.body.pin);
    audit(req, 'auth.set_pin', 'user', req.user.id);
    res.json({ data: { ok: true } });
  },
);

module.exports = { router, passwordSchema };
