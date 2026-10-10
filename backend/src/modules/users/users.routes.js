'use strict';

const express = require('express');
const bcrypt = require('bcryptjs');
const { z } = require('zod');
const db = require('../../db/pool');
const { validate } = require('../../core/http');
const { authenticate, requirePermission } = require('../../core/auth');
const { audit } = require('../../core/audit');
const { notFound, conflict, forbidden } = require('../../core/errors');
const { passwordSchema } = require('../auth/auth.routes');

const router = express.Router();
router.use(authenticate);

const idParam = z.object({ id: z.coerce.number().int().positive() });

async function setUserRoles(conn, userId, roleCodes) {
  await conn.query('DELETE FROM user_roles WHERE user_id = :userId', { userId });
  if (!roleCodes.length) return;
  const [roles] = await conn.query('SELECT id, code FROM roles WHERE code IN (:codes)', { codes: roleCodes });
  for (const r of roles) {
    await conn.query('INSERT INTO user_roles (user_id, role_id) VALUES (:userId, :roleId)', { userId, roleId: r.id });
  }
}

async function getUser(orgId, id) {
  const row = await db.one(
    `SELECT u.id, u.email, u.full_name, u.phone, u.status, u.branch_id, b.name AS branch_name,
            u.last_login_at, u.created_at, GROUP_CONCAT(r.code ORDER BY r.code) AS roles
       FROM users u
       LEFT JOIN branches b ON b.id = u.branch_id
       LEFT JOIN user_roles ur ON ur.user_id = u.id
       LEFT JOIN roles r ON r.id = ur.role_id
      WHERE u.org_id = :orgId AND u.id = :id
      GROUP BY u.id`,
    { orgId, id },
  );
  return row ? mapUser(row) : null;
}

function mapUser(r) {
  return {
    id: r.id,
    email: r.email,
    fullName: r.full_name,
    phone: r.phone,
    status: r.status,
    branchId: r.branch_id,
    branchName: r.branch_name,
    roles: r.roles ? r.roles.split(',') : [],
    lastLoginAt: r.last_login_at,
    createdAt: r.created_at,
  };
}

// Only an owner may grant or modify the owner role.
function assertCanAssign(req, roleCodes, targetRoles = []) {
  const isOwner = req.user.roles.includes('owner');
  if (!isOwner && (roleCodes.includes('owner') || targetRoles.includes('owner'))) {
    throw forbidden('เฉพาะเจ้าของระบบ (owner) เท่านั้นที่จัดการบัญชี owner ได้');
  }
}

router.get(
  '/',
  requirePermission('users:read'),
  validate({
    query: z.object({
      q: z.string().trim().max(100).optional(),
      page: z.coerce.number().int().min(1).default(1),
      pageSize: z.coerce.number().int().min(1).max(100).default(20),
    }),
  }),
  async (req, res) => {
    const { q, page, pageSize } = req.valid.query;
    const params = { orgId: req.user.orgId, q: q ? `%${q}%` : null, limit: pageSize, offset: (page - 1) * pageSize };
    const where = `u.org_id = :orgId AND (:q IS NULL OR u.email LIKE :q OR u.full_name LIKE :q)`;
    const rows = await db.query(
      `SELECT u.id, u.email, u.full_name, u.phone, u.status, u.branch_id, b.name AS branch_name,
              u.last_login_at, u.created_at, GROUP_CONCAT(r.code ORDER BY r.code) AS roles
         FROM users u
         LEFT JOIN branches b ON b.id = u.branch_id
         LEFT JOIN user_roles ur ON ur.user_id = u.id
         LEFT JOIN roles r ON r.id = ur.role_id
        WHERE ${where}
        GROUP BY u.id
        ORDER BY u.created_at DESC
        LIMIT :limit OFFSET :offset`,
      params,
    );
    const total = await db.one(`SELECT COUNT(*) AS n FROM users u WHERE ${where}`, params);
    res.json({ data: rows.map(mapUser), meta: { page, pageSize, total: total.n } });
  },
);

router.get('/:id', requirePermission('users:read'), validate({ params: idParam }), async (req, res) => {
  const user = await getUser(req.user.orgId, req.valid.params.id);
  if (!user) throw notFound();
  res.json({ data: user });
});

const roleList = z.array(z.string().min(1).max(50)).min(1, 'ต้องเลือกอย่างน้อย 1 บทบาท');

router.post(
  '/',
  requirePermission('users:write'),
  validate({
    body: z.object({
      email: z.email(),
      fullName: z.string().trim().min(1).max(191),
      phone: z.string().trim().max(50).optional(),
      password: passwordSchema,
      roles: roleList,
      branchId: z.number().int().positive().nullable().optional(),
    }),
  }),
  async (req, res) => {
    const b = req.valid.body;
    assertCanAssign(req, b.roles);
    const email = b.email.toLowerCase();
    if (await db.one('SELECT id FROM users WHERE email = :email', { email })) throw conflict('อีเมลนี้ถูกใช้แล้ว');
    const passwordHash = await bcrypt.hash(b.password, 12);
    const id = await db.tx(async (conn) => {
      const [r] = await conn.query(
        `INSERT INTO users (org_id, branch_id, email, password_hash, full_name, phone, must_change_password)
         VALUES (:orgId, :branchId, :email, :passwordHash, :fullName, :phone, 1)`,
        { orgId: req.user.orgId, branchId: b.branchId ?? null, email, passwordHash, fullName: b.fullName, phone: b.phone ?? null },
      );
      await setUserRoles(conn, r.insertId, b.roles);
      return r.insertId;
    });
    audit(req, 'user.create', 'user', id, { roles: b.roles });
    res.status(201).json({ data: await getUser(req.user.orgId, id) });
  },
);

router.patch(
  '/:id',
  requirePermission('users:write'),
  validate({
    params: idParam,
    body: z.object({
      fullName: z.string().trim().min(1).max(191).optional(),
      phone: z.string().trim().max(50).nullable().optional(),
      status: z.enum(['active', 'disabled']).optional(),
      roles: roleList.optional(),
      branchId: z.number().int().positive().nullable().optional(),
      password: passwordSchema.optional(),
    }),
  }),
  async (req, res) => {
    const { id } = req.valid.params;
    const b = req.valid.body;
    const existing = await getUser(req.user.orgId, id);
    if (!existing) throw notFound();
    assertCanAssign(req, b.roles || [], existing.roles);
    if (id === req.user.id && (b.status === 'disabled' || b.roles)) {
      throw forbidden('ไม่สามารถระงับหรือเปลี่ยนบทบาทของบัญชีตัวเองได้');
    }
    const passwordHash = b.password ? await bcrypt.hash(b.password, 12) : null;
    await db.tx(async (conn) => {
      await conn.query(
        `UPDATE users SET
           full_name = COALESCE(:fullName, full_name),
           phone = IF(:phoneSet, :phone, phone),
           status = COALESCE(:status, status),
           branch_id = IF(:branchSet, :branchId, branch_id),
           password_hash = COALESCE(:passwordHash, password_hash),
           must_change_password = IF(:passwordHash IS NULL, must_change_password, 1)
         WHERE id = :id AND org_id = :orgId`,
        {
          id,
          orgId: req.user.orgId,
          fullName: b.fullName ?? null,
          phoneSet: b.phone !== undefined,
          phone: b.phone ?? null,
          status: b.status ?? null,
          branchSet: b.branchId !== undefined,
          branchId: b.branchId ?? null,
          passwordHash,
        },
      );
      if (b.roles) await setUserRoles(conn, id, b.roles);
      // Disabling a user or resetting their password ends their sessions immediately.
      if (b.status === 'disabled' || passwordHash) {
        await conn.query('UPDATE refresh_tokens SET revoked_at = UTC_TIMESTAMP() WHERE user_id = :id AND revoked_at IS NULL', { id });
      }
    });
    audit(req, 'user.update', 'user', id, { fields: Object.keys(b).filter((k) => k !== 'password') });
    res.json({ data: await getUser(req.user.orgId, id) });
  },
);

module.exports = { router };
