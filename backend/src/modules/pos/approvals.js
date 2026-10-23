'use strict';

// Manager PIN approval at the till: a manager types their PIN on the cashier's screen and the
// cashier gets a short-lived ticket for ONE kind of action (a refund, a void, a price/discount
// override). The ticket is bound to the cashier, the org and the action, and lives 5 minutes.

const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const env = require('../../config/env');
const db = require('../../db/pool');
const { AppError, badRequest } = require('../../core/errors');

const ACTIONS = ['refund', 'void', 'override'];
const HEADER = 'x-manager-approval';
const TTL_SEC = 300;
const AUDIENCE = 'pos-approval';
const MAX_FAILS = 5;
const LOCK_MS = 5 * 60 * 1000;
const fails = new Map(); // cashier id -> { n, until }

const needApproval = () => new AppError(403, 'MANAGER_APPROVAL', 'ต้องให้ผู้จัดการอนุมัติ — ให้ผู้จัดการกรอก PIN');

/** Active users of the org who may approve (pos:manage) and have set a PIN. */
function approvers(orgId) {
  return db.query(
    `SELECT DISTINCT u.id, u.full_name, u.pos_pin_hash
       FROM users u
       JOIN user_roles ur ON ur.user_id = u.id
       JOIN role_permissions rp ON rp.role_id = ur.role_id
       JOIN permissions p ON p.id = rp.permission_id
      WHERE u.org_id = :orgId AND u.status = 'active' AND u.pos_pin_hash IS NOT NULL AND p.code = 'pos:manage'`,
    { orgId },
  );
}

async function approve(user, pin, action) {
  const f = fails.get(user.id);
  if (f && f.until > Date.now()) throw badRequest('กรอก PIN ผิดหลายครั้ง ลองใหม่ในอีก 5 นาที');
  for (const m of await approvers(user.orgId)) {
    if (m.id === user.id) continue;
    if (await bcrypt.compare(pin, m.pos_pin_hash)) {
      fails.delete(user.id);
      const token = jwt.sign({ org: user.orgId, by: user.id, act: action, name: m.full_name }, env.JWT_ACCESS_SECRET, {
        subject: String(m.id),
        expiresIn: TTL_SEC,
        issuer: 'pos-enterprise',
        audience: AUDIENCE,
      });
      return { token, managerId: m.id, managerName: m.full_name, expiresInSec: TTL_SEC };
    }
  }
  const n = (f && f.until > Date.now() ? 0 : (f?.n ?? 0)) + 1;
  fails.set(user.id, { n: n >= MAX_FAILS ? 0 : n, until: n >= MAX_FAILS ? Date.now() + LOCK_MS : 0 });
  throw badRequest(n >= MAX_FAILS ? 'กรอก PIN ผิดหลายครั้ง ลองใหม่ในอีก 5 นาที' : 'PIN ไม่ถูกต้อง หรือผู้จัดการยังไม่ได้ตั้ง PIN');
}

/** The approving manager behind this request's ticket, or null. */
function ticketFor(req, action) {
  const token = req.get(HEADER);
  if (!token) return null;
  try {
    const t = jwt.verify(token, env.JWT_ACCESS_SECRET, { issuer: 'pos-enterprise', audience: AUDIENCE });
    if (t.org !== req.user.orgId || t.by !== req.user.id || t.act !== action) return null;
    return { managerId: Number(t.sub), managerName: t.name };
  } catch {
    return null;
  }
}

/** pos:manage, or a manager's PIN ticket for this action (recorded on req.approval for the audit log). */
function managerOr(action) {
  return (req, res, next) => {
    if (req.user.permissions.includes('pos:manage')) return next();
    const t = ticketFor(req, action);
    if (!t) return next(needApproval());
    req.approval = t;
    return next();
  };
}

async function setPin(userId, pin) {
  await db.query('UPDATE users SET pos_pin_hash = :hash WHERE id = :userId', { userId, hash: await bcrypt.hash(pin, 10) });
}

module.exports = { ACTIONS, HEADER, approve, ticketFor, managerOr, setPin, _fails: fails };
