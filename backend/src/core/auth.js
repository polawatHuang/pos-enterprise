'use strict';

const crypto = require('node:crypto');
const jwt = require('jsonwebtoken');
const env = require('../config/env');
const { unauthorized, forbidden } = require('./errors');

const ACCESS_COOKIE = 'pe_at';
const REFRESH_COOKIE = 'pe_rt';
// Refresh cookie is only sent to auth endpoints (path survives the Vercel rewrite /api/* -> backend /api/*)
const REFRESH_COOKIE_PATH = '/api/auth';

function signAccessToken(user) {
  return jwt.sign(
    { org: user.orgId, roles: user.roles, perms: user.permissions, name: user.fullName },
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
}

function clearAuthCookies(res) {
  const base = { domain: env.COOKIE_DOMAIN || undefined, secure: env.COOKIE_SECURE, sameSite: env.COOKIE_SAMESITE };
  res.clearCookie(ACCESS_COOKIE, { ...base, path: '/' });
  res.clearCookie(REFRESH_COOKIE, { ...base, path: REFRESH_COOKIE_PATH });
}

function readAccessToken(req) {
  const header = req.get('authorization');
  if (header && header.startsWith('Bearer ')) return header.slice(7);
  return req.cookies?.[ACCESS_COOKIE] || null;
}

/** Requires a valid access token; sets req.user = { id, orgId, roles, permissions, name } */
function authenticate(req, res, next) {
  const token = readAccessToken(req);
  if (!token) return next(unauthorized());
  try {
    const payload = jwt.verify(token, env.JWT_ACCESS_SECRET, { issuer: 'pos-enterprise' });
    req.user = {
      id: Number(payload.sub),
      orgId: payload.org,
      roles: payload.roles || [],
      permissions: payload.perms || [],
      name: payload.name,
    };
    return next();
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
