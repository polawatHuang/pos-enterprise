'use strict';

const crypto = require('node:crypto');
const bcrypt = require('bcryptjs');
const env = require('../../config/env');
const db = require('../../db/pool');
const { signAccessToken, newOpaqueToken, sha256 } = require('../../core/auth');
const { unauthorized, badRequest } = require('../../core/errors');
const repo = require('./auth.repo');

const MAX_FAILED_ATTEMPTS = 5;
const LOCK_MINUTES = 15;
// Constant-time-ish path when the email does not exist (prevents user enumeration by timing)
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 10);

function toPublicUser(row, rp) {
  return {
    id: row.id,
    orgId: row.org_id,
    branchId: row.branch_id,
    email: row.email,
    fullName: row.full_name,
    avatarUrl: row.avatar_url,
    mustChangePassword: Boolean(row.must_change_password),
    hasPosPin: row.pos_pin_hash != null,
    roles: rp.roles,
    permissions: rp.permissions,
  };
}

async function issueTokens(user, meta, conn, familyId = crypto.randomUUID()) {
  const refreshToken = newOpaqueToken();
  const id = await repo.insertRefreshToken(conn, {
    userId: user.id,
    tokenHash: sha256(refreshToken),
    familyId,
    ttlDays: env.REFRESH_TOKEN_TTL_DAYS,
    userAgent: meta.userAgent,
    ip: meta.ip,
  });
  return { accessToken: signAccessToken(user), refreshToken, refreshTokenId: id };
}

async function login(email, password, meta) {
  const row = await repo.findUserByEmail(email.toLowerCase().trim());
  if (!row) {
    await bcrypt.compare(password, DUMMY_HASH);
    throw unauthorized('อีเมลหรือรหัสผ่านไม่ถูกต้อง');
  }
  if (row.status !== 'active') throw unauthorized('บัญชีนี้ถูกระงับการใช้งาน');
  if (row.locked_until && new Date(row.locked_until) > new Date()) {
    throw unauthorized(`บัญชีถูกล็อกชั่วคราวเนื่องจากใส่รหัสผิดหลายครั้ง กรุณาลองใหม่ใน ${LOCK_MINUTES} นาที`);
  }
  const ok = await bcrypt.compare(password, row.password_hash);
  if (!ok) {
    await repo.recordFailedLogin(row.id, LOCK_MINUTES, MAX_FAILED_ATTEMPTS);
    throw unauthorized('อีเมลหรือรหัสผ่านไม่ถูกต้อง');
  }
  await repo.recordSuccessfulLogin(row.id);
  const user = toPublicUser(row, await repo.loadRolesAndPermissions(row.id));
  const tokens = await db.tx((conn) => issueTokens(user, meta, conn));
  return { user, ...tokens };
}

/**
 * Rotating refresh tokens. Presenting an already-rotated token means it was stolen
 * (or replayed) -> revoke the whole family so both parties must log in again.
 */
async function refresh(rawToken, meta) {
  if (!rawToken) throw unauthorized();
  const tokenHash = sha256(rawToken);
  const outcome = await db.tx(async (conn) => {
    const rt = await repo.findRefreshTokenForUpdate(conn, tokenHash);
    if (!rt) return { error: 'missing' };
    if (rt.revoked_at) return { error: 'reused', familyId: rt.family_id };
    if (rt.is_expired) return { error: 'expired' };

    const row = await repo.findUserById(rt.user_id);
    if (!row || row.status !== 'active') return { error: 'inactive' };
    const user = toPublicUser(row, await repo.loadRolesAndPermissions(row.id));
    const tokens = await issueTokens(user, meta, conn, rt.family_id);
    await repo.revokeRefreshToken(conn, rt.id, tokens.refreshTokenId);
    return { user, ...tokens };
  });

  if (outcome.error === 'reused') await repo.revokeFamily(outcome.familyId);
  if (outcome.error) throw unauthorized('เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่');
  return outcome;
}

async function logout(rawToken) {
  if (rawToken) await repo.revokeByHash(sha256(rawToken));
}

async function me(userId) {
  const row = await repo.findUserById(userId);
  if (!row || row.status !== 'active') throw unauthorized();
  return toPublicUser(row, await repo.loadRolesAndPermissions(row.id));
}

/** Throws unless `password` is the user's current one (a re-check before a sensitive change). */
async function verifyPassword(userId, password) {
  const row = await repo.findUserById(userId);
  if (!row) throw unauthorized();
  if (!(await bcrypt.compare(password, row.password_hash))) throw badRequest('รหัสผ่านปัจจุบันไม่ถูกต้อง');
}

/** Changes the password, signs out every session, and starts a fresh one for the caller. */
async function changePassword(userId, currentPassword, newPassword, meta) {
  const row = await repo.findUserById(userId);
  if (!row) throw unauthorized();
  if (!(await bcrypt.compare(currentPassword, row.password_hash))) throw badRequest('รหัสผ่านปัจจุบันไม่ถูกต้อง');
  if (currentPassword === newPassword) throw badRequest('รหัสผ่านใหม่ต้องไม่ซ้ำกับรหัสเดิม');
  await repo.updatePassword(userId, await bcrypt.hash(newPassword, 12));
  await repo.revokeAllForUser(userId);
  const user = await me(userId);
  const tokens = await db.tx((conn) => issueTokens(user, meta, conn));
  return { user, ...tokens };
}

module.exports = { login, refresh, logout, me, changePassword, verifyPassword, toPublicUser };
