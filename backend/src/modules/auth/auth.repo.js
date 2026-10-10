'use strict';

const db = require('../../db/pool');

async function findUserByEmail(email) {
  return db.one('SELECT * FROM users WHERE email = :email LIMIT 1', { email });
}

async function findUserById(id) {
  return db.one('SELECT * FROM users WHERE id = :id LIMIT 1', { id });
}

async function loadRolesAndPermissions(userId) {
  const roles = await db.query(
    `SELECT r.code FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = :userId`,
    { userId },
  );
  const perms = await db.query(
    `SELECT DISTINCT p.code FROM user_roles ur
       JOIN role_permissions rp ON rp.role_id = ur.role_id
       JOIN permissions p ON p.id = rp.permission_id
     WHERE ur.user_id = :userId
     ORDER BY p.code`,
    { userId },
  );
  return { roles: roles.map((r) => r.code), permissions: perms.map((p) => p.code) };
}

async function recordFailedLogin(userId, lockMinutes, maxAttempts) {
  await db.query(
    `UPDATE users
        -- assignments run left-to-right in MySQL/MariaDB, so compute the lock before incrementing
        SET locked_until = IF(failed_login_count + 1 >= :maxAttempts,
                              UTC_TIMESTAMP() + INTERVAL :lockMinutes MINUTE, locked_until),
            failed_login_count = IF(failed_login_count + 1 >= :maxAttempts, 0, failed_login_count + 1)
      WHERE id = :userId`,
    { userId, lockMinutes, maxAttempts },
  );
}

async function recordSuccessfulLogin(userId) {
  await db.query(
    `UPDATE users SET failed_login_count = 0, locked_until = NULL, last_login_at = UTC_TIMESTAMP() WHERE id = :userId`,
    { userId },
  );
}

async function insertRefreshToken(conn, { userId, tokenHash, familyId, ttlDays, userAgent, ip }) {
  const [res] = await conn.query(
    `INSERT INTO refresh_tokens (user_id, token_hash, family_id, expires_at, user_agent, ip)
     VALUES (:userId, :tokenHash, :familyId, UTC_TIMESTAMP() + INTERVAL :ttlDays DAY, :userAgent, :ip)`,
    { userId, tokenHash, familyId, ttlDays, userAgent: userAgent?.slice(0, 255) ?? null, ip },
  );
  return res.insertId;
}

async function findRefreshTokenForUpdate(conn, tokenHash) {
  const [rows] = await conn.query(
    `SELECT *, (expires_at < UTC_TIMESTAMP()) AS is_expired FROM refresh_tokens
      WHERE token_hash = :tokenHash LIMIT 1 FOR UPDATE`,
    { tokenHash },
  );
  return rows[0] || null;
}

async function revokeRefreshToken(conn, id, replacedBy = null) {
  await conn.query(
    `UPDATE refresh_tokens SET revoked_at = UTC_TIMESTAMP(), replaced_by = :replacedBy WHERE id = :id`,
    { id, replacedBy },
  );
}

async function revokeFamily(familyId) {
  await db.query(
    `UPDATE refresh_tokens SET revoked_at = UTC_TIMESTAMP() WHERE family_id = :familyId AND revoked_at IS NULL`,
    { familyId },
  );
}

async function revokeByHash(tokenHash) {
  await db.query(
    `UPDATE refresh_tokens SET revoked_at = UTC_TIMESTAMP() WHERE token_hash = :tokenHash AND revoked_at IS NULL`,
    { tokenHash },
  );
}

async function revokeAllForUser(userId) {
  await db.query(`UPDATE refresh_tokens SET revoked_at = UTC_TIMESTAMP() WHERE user_id = :userId AND revoked_at IS NULL`, {
    userId,
  });
}

async function updatePassword(userId, passwordHash) {
  await db.query(`UPDATE users SET password_hash = :passwordHash, must_change_password = 0 WHERE id = :userId`, {
    userId,
    passwordHash,
  });
}

module.exports = {
  findUserByEmail,
  findUserById,
  loadRolesAndPermissions,
  recordFailedLogin,
  recordSuccessfulLogin,
  insertRefreshToken,
  findRefreshTokenForUpdate,
  revokeRefreshToken,
  revokeFamily,
  revokeByHash,
  revokeAllForUser,
  updatePassword,
};
