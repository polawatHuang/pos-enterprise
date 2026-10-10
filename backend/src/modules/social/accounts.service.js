'use strict';

const crypto = require('node:crypto');
const db = require('../../db/pool');
const env = require('../../config/env');
const { AppError, badRequest } = require('../../core/errors');
const { encryptJson, decryptJson } = require('../../utils/crypto');
const tiktok = require('../../integrations/tiktok');

const STATE_TTL_MS = 15 * 60_000;
const REFRESH_MARGIN_MS = 5 * 60_000;

/* ------------------------------------------------------------ OAuth state */

/** Signed, short-lived state so the callback (a plain browser redirect) knows the org and user. */
function signState(payload) {
  const body = Buffer.from(JSON.stringify({ ...payload, n: crypto.randomBytes(8).toString('hex'), exp: Date.now() + STATE_TTL_MS })).toString('base64url');
  const sig = crypto.createHmac('sha256', env.JWT_ACCESS_SECRET).update(`oauth-state.${body}`).digest('base64url');
  return `${body}.${sig}`;
}

function verifyState(state) {
  const [body, sig] = String(state ?? '').split('.');
  if (!body || !sig) return null;
  const expected = crypto.createHmac('sha256', env.JWT_ACCESS_SECRET).update(`oauth-state.${body}`).digest('base64url');
  const a = Buffer.from(expected);
  const b = Buffer.from(sig);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    return p.exp > Date.now() ? p : null;
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------ credentials */

function requireEncryption() {
  if (!env.APP_ENCRYPTION_KEY) throw badRequest('ต้องตั้งค่า APP_ENCRYPTION_KEY บนเซิร์ฟเวอร์ก่อนเชื่อมบัญชีโซเชียล');
}

/** Upsert the encrypted token and the account row; returns the account id. */
async function saveAccount({ orgId, platform, externalId, displayName, avatarUrl, credential, expiresAt = null, meta = null }) {
  requireEncryption();
  return db.tx(async (conn) => {
    await conn.query(
      `INSERT INTO integration_credentials (org_id, provider, account_ref, data_encrypted, expires_at)
       VALUES (:orgId, :provider, :ref, :data, :expiresAt)
       ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id), data_encrypted = VALUES(data_encrypted), expires_at = VALUES(expires_at)`,
      { orgId, provider: platform, ref: externalId, data: encryptJson(credential), expiresAt },
    );
    const [[cred]] = await conn.query('SELECT LAST_INSERT_ID() AS id');
    await conn.query(
      `INSERT INTO social_accounts (org_id, platform, external_id, display_name, avatar_url, credential_id, status, token_expires_at, last_error, meta, is_active)
       VALUES (:orgId, :platform, :externalId, :displayName, :avatarUrl, :credId, 'connected', :expiresAt, NULL, :meta, 1)
       ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id), display_name = VALUES(display_name), avatar_url = VALUES(avatar_url),
         credential_id = VALUES(credential_id), status = 'connected', token_expires_at = VALUES(token_expires_at), last_error = NULL,
         meta = VALUES(meta), is_active = 1`,
      {
        orgId,
        platform,
        externalId,
        displayName: displayName?.slice(0, 191) ?? null,
        avatarUrl: avatarUrl?.slice(0, 1000) ?? null,
        credId: cred.id,
        expiresAt,
        meta: meta ? JSON.stringify(meta) : null,
      },
    );
    const [[acc]] = await conn.query('SELECT LAST_INSERT_ID() AS id');
    return acc.id;
  });
}

async function markAccount(accountId, status, error) {
  await db.query('UPDATE social_accounts SET status = :status, last_error = :error WHERE id = :id', {
    id: accountId,
    status,
    error: error ? String(error).slice(0, 2000) : null,
  });
}

/**
 * Usable credential for an account, refreshing TikTok's 24-hour access token when needed.
 * Marks the account expired (and throws) when the user must reconnect.
 */
async function credentialFor(account) {
  if (!account.credential_id) throw new AppError(409, 'ACCOUNT_NOT_CONNECTED', 'บัญชีนี้ยังไม่ได้เชื่อมต่อ กดเชื่อมต่อใหม่ในหน้าบัญชีโซเชียล');
  const row = await db.one('SELECT data_encrypted FROM integration_credentials WHERE id = :id', { id: account.credential_id });
  if (!row) throw new AppError(409, 'ACCOUNT_NOT_CONNECTED', 'ไม่พบ token ของบัญชีนี้ กรุณาเชื่อมต่อใหม่');
  let data;
  try {
    data = decryptJson(row.data_encrypted);
  } catch {
    throw new AppError(500, 'TOKEN_DECRYPT_FAILED', 'ถอดรหัส token ไม่ได้ (APP_ENCRYPTION_KEY เปลี่ยนไป?) กรุณาเชื่อมต่อบัญชีใหม่');
  }
  if (account.platform !== 'tiktok') return data;
  if (data.expiresAt && Date.now() < data.expiresAt - REFRESH_MARGIN_MS) return data;
  try {
    const t = await tiktok.refreshToken(data.refreshToken);
    const next = {
      accessToken: t.accessToken,
      refreshToken: t.refreshToken ?? data.refreshToken,
      expiresAt: Date.now() + t.expiresIn * 1000,
      refreshExpiresAt: t.refreshExpiresIn ? Date.now() + t.refreshExpiresIn * 1000 : data.refreshExpiresAt,
    };
    await db.query('UPDATE integration_credentials SET data_encrypted = :d, expires_at = :e WHERE id = :id', {
      id: account.credential_id,
      d: encryptJson(next),
      e: new Date(next.expiresAt),
    });
    await db.query("UPDATE social_accounts SET token_expires_at = :e, status = 'connected', last_error = NULL WHERE id = :id", {
      id: account.id,
      e: new Date(next.expiresAt),
    });
    return next;
  } catch (err) {
    await markAccount(account.id, 'expired', `ต่ออายุ token ไม่สำเร็จ: ${err.message} — กรุณาเชื่อมต่อใหม่`);
    throw new AppError(409, 'ACCOUNT_EXPIRED', 'token ของ TikTok หมดอายุ กรุณาเชื่อมต่อบัญชีใหม่');
  }
}

module.exports = { signState, verifyState, saveAccount, credentialFor, markAccount, requireEncryption };
