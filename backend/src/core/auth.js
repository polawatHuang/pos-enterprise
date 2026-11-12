'use strict';

const crypto = require('node:crypto');
const jwt = require('jsonwebtoken');
const env = require('../config/env');
const { AppError, unauthorized, forbidden } = require('./errors');
const db = require('../db/pool');
const { runWithOrg } = require('../modules/saas/credit-context');

const ACCESS_COOKIE = 'pe_at';
const REFRESH_COOKIE = 'pe_rt';
// Refresh cookie is only sent to auth endpoints (path survives the Vercel rewrite /api/* -> backend /api/*)
const REFRESH_COOKIE_PATH = '/api/auth';
// Non-secret marker readable by the frontend's proxy.ts on page requests (the refresh cookie is
// path-scoped to /api/auth, so page navigations never carry it). Grants nothing by itself.
const SESSION_HINT_COOKIE = 'pe_session';

function signAccessToken(user) {
  return jwt.sign(
    {
      org: user.orgId,
      br: user.branchId ?? null,
      roles: user.roles,
      perms: user.permissions,
      name: user.fullName,
      platformAdmin: Boolean(user.platformAdmin),
    },
    env.JWT_ACCESS_SECRET,
    { subject: String(user.id), expiresIn: env.ACCESS_TOKEN_TTL_SEC, issuer: 'pos-enterprise' },
  );
}

function newOpaqueToken() {
  return crypto.randomBytes(48).toString('base64url');
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function cookieOptions(maxAgeMs, path = '/') {
  return {
    httpOnly: true,
    secure: env.COOKIE_SECURE,
    sameSite: env.COOKIE_SAMESITE,
    // Leave domain unset when the browser talks to us through the Vercel rewrite:
    // the cookie then belongs to the frontend's own origin (first-party).
    domain: env.COOKIE_DOMAIN || undefined,
    path,
    maxAge: maxAgeMs,
  };
}

function setAuthCookies(res, accessToken, refreshToken) {
  res.cookie(ACCESS_COOKIE, accessToken, cookieOptions(env.ACCESS_TOKEN_TTL_SEC * 1000));
  res.cookie(
    REFRESH_COOKIE,
    refreshToken,
    cookieOptions(env.REFRESH_TOKEN_TTL_DAYS * 86400 * 1000, REFRESH_COOKIE_PATH),
  );
  res.cookie(SESSION_HINT_COOKIE, '1', cookieOptions(env.REFRESH_TOKEN_TTL_DAYS * 86400 * 1000));
}

function clearAuthCookies(res) {
  const base = { domain: env.COOKIE_DOMAIN || undefined, secure: env.COOKIE_SECURE, sameSite: env.COOKIE_SAMESITE };
  res.clearCookie(ACCESS_COOKIE, { ...base, path: '/' });
  res.clearCookie(REFRESH_COOKIE, { ...base, path: REFRESH_COOKIE_PATH });
  res.clearCookie(SESSION_HINT_COOKIE, { ...base, path: '/' });
}

function readAccessToken(req) {
  const header = req.get('authorization');
  if (header && header.startsWith('Bearer ')) return header.slice(7);
  return req.cookies?.[ACCESS_COOKIE] || null;
}

/** Requires a valid access token; sets req.user = { id, orgId, branchId, roles, permissions, name } */
function authenticate(req, res, next) {
  const token = readAccessToken(req);
  if (!token) return next(unauthorized());
  try {
    const payload = jwt.verify(token, env.JWT_ACCESS_SECRET, { issuer: 'pos-enterprise' });
    req.user = {
      id: Number(payload.sub),
      orgId: payload.org,
      branchId: payload.br ?? null,
      roles: payload.roles || [],
      permissions: payload.perms || [],
      name: payload.name,
      platformAdmin: payload.platformAdmin === true,
    };
    const requestPath = req.originalUrl.split('?')[0];
    const billingAccess = requestPath.startsWith('/api/saas/') || requestPath === '/api/saas' || requestPath.startsWith('/api/auth/');
    const check = async () => {
      if (!billingAccess) {
        const subscription = await db.one(
          `SELECT status,
                  (trial_ends_at IS NOT NULL AND trial_ends_at > UTC_TIMESTAMP()) AS trial_valid,
                  (current_period_end IS NULL OR current_period_end > UTC_TIMESTAMP()) AS period_valid
             FROM saas_subscriptions WHERE org_id = :orgId LIMIT 1`,
          { orgId: req.user.orgId },
        );
        const allowed =
          req.user.platformAdmin ||
          subscription?.status === 'legacy' ||
          (subscription?.status === 'trialing' && Boolean(subscription.trial_valid)) ||
          (subscription?.status === 'active' && Boolean(subscription.period_valid));
        if (!allowed) {
          throw new AppError(402, 'SUBSCRIPTION_REQUIRED', 'ช่วงทดลองใช้หรือแพ็กเกจหมดอายุแล้ว กรุณาต่ออายุเพื่อใช้งานต่อ');
        }
      }
      return next();
    };
    return runWithOrg(
      { orgId: req.user.orgId, platformAdmin: req.user.platformAdmin, userId: req.user.id },
      () => check().catch(next),
    );
  } catch (err) {
    const msg = err.name === 'TokenExpiredError' ? 'เซสชันหมดอายุ' : 'โทเคนไม่ถูกต้อง';
    return next(Object.assign(unauthorized(msg), { code: 'TOKEN_INVALID' }));
  }
}

/** Requires ALL listed permissions. */
function requirePermission(...codes) {
  return (req, res, next) => {
    if (!req.user) return next(unauthorized());
    const missing = codes.filter((c) => !req.user.permissions.includes(c));
    if (missing.length) return next(forbidden(`ต้องมีสิทธิ์: ${missing.join(', ')}`));
    return next();
  };
}

module.exports = {
  ACCESS_COOKIE,
  REFRESH_COOKIE,
  signAccessToken,
  newOpaqueToken,
  sha256,
  setAuthCookies,
  clearAuthCookies,
  authenticate,
  requirePermission,
};
