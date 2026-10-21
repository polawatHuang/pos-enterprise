'use strict';

const express = require('express');
const { z } = require('zod');
const db = require('../../db/pool');
const env = require('../../config/env');
const { validate } = require('../../core/http');
const { authenticate, requirePermission } = require('../../core/auth');
const { badRequest } = require('../../core/errors');

const router = express.Router();
router.use(authenticate, requirePermission('audit:read'));

const PAGE_MAX = 200;
const CSV_MAX = 10_000;
const MASK = '••••••';
// Metadata is free-form: anything whose key looks like a credential is never sent back.
const SECRET_KEY = /token|secret|password|key/i;
// Values that are credentials whatever their key is called (JWTs, bearer tokens, API keys)
const SECRET_VALUE = /^(Bearer\s+\S+|eyJ[\w-]+\.[\w-]+\.[\w-]+|sk-[\w-]{10,})$/;

function maskSecrets(value, depth = 0) {
  if (depth > 8) return MASK;
  if (Array.isArray(value)) return value.map((v) => maskSecrets(v, depth + 1));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, SECRET_KEY.test(k) && v != null ? MASK : maskSecrets(v, depth + 1)]));
  }
  if (typeof value === 'string' && SECRET_VALUE.test(value.trim())) return MASK;
  return value;
}

function parseMetadata(raw) {
  if (raw == null) return null;
  let value = raw;
  if (typeof raw === 'string') {
    try {
      value = JSON.parse(raw);
    } catch {
      return { value: SECRET_VALUE.test(raw.trim()) ? MASK : raw };
    }
  }
  return maskSecrets(value);
}

/** "YYYY-MM-DD" business date (APP_TZ_OFFSET, e.g. Bangkok) -> UTC instant of its local midnight. */
const localMidnight = (ymd, addDays = 0) => new Date(new Date(`${ymd}T00:00:00${env.APP_TZ_OFFSET}`).getTime() + addDays * 86_400_000);

function tzOffsetMs() {
  const [, sign, hh, mm] = env.APP_TZ_OFFSET.match(/^([+-])(\d{2}):(\d{2})$/);
  return (sign === '-' ? -1 : 1) * (Number(hh) * 60 + Number(mm)) * 60_000;
}
/** Local wall-clock "YYYY-MM-DD HH:MM:SS" for the CSV (Excel has no timezone notion). */
const localStamp = (d) => new Date(new Date(d).getTime() + tzOffsetMs()).toISOString().slice(0, 19).replace('T', ' ');

const likeEscape = (s) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

const filterSchema = z.object({
  userId: z.union([z.literal('system'), z.coerce.number().int().positive()]).optional(),
  module: z
    .string()
    .trim()
    .regex(/^[a-z_]{1,50}$/, 'module ไม่ถูกต้อง')
    .optional(),
  action: z.string().trim().min(1).max(100).optional(),
  entityType: z.string().trim().min(1).max(50).optional(),
  entityId: z.string().trim().min(1).max(64).optional(),
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
  q: z.string().trim().min(1).max(100).optional(),
});

/** WHERE clause + params for the filters shared by the list and the CSV export. */
function buildFilter(orgId, f) {
  if (f.from && f.to && f.from > f.to) throw badRequest('วันที่เริ่มต้องไม่หลังวันที่สิ้นสุด');
  const where = ['a.org_id = :orgId'];
  const params = { orgId };
  if (f.userId === 'system') where.push('a.user_id IS NULL');
  else if (f.userId) {
    where.push('a.user_id = :userId');
    params.userId = f.userId;
  }
  if (f.module) {
    where.push('a.action LIKE :modulePrefix');
    params.modulePrefix = `${likeEscape(f.module)}.%`;
  }
  if (f.action) {
    where.push('a.action LIKE :actionPrefix');
    params.actionPrefix = `${likeEscape(f.action)}%`;
  }
  if (f.entityType) {
    where.push('a.entity_type = :entityType');
    params.entityType = f.entityType;
  }
  if (f.entityId) {
    where.push('a.entity_id = :entityId');
    params.entityId = f.entityId;
  }
  // Business dates converted to UTC bounds here, so the (org_id, created_at) index still applies
  if (f.from) {
    where.push('a.created_at >= :fromAt');
    params.fromAt = localMidnight(f.from);
  }
  if (f.to) {
    where.push('a.created_at < :toAt');
    params.toAt = localMidnight(f.to, 1);
  }
  if (f.q) {
    where.push('(a.action LIKE :q OR a.entity_type LIKE :q OR a.entity_id LIKE :q OR CAST(a.metadata AS CHAR) LIKE :q)');
    params.q = `%${likeEscape(f.q)}%`;
  }
  return { where: where.join(' AND '), params };
}

const SELECT = `SELECT a.id, a.user_id, a.action, a.entity_type, a.entity_id, a.metadata, a.ip, a.created_at,
                       u.full_name AS user_name, u.email AS user_email
                  FROM audit_logs a
                  LEFT JOIN users u ON u.id = a.user_id`;

function mapRow(r) {
  return {
    id: r.id,
    action: r.action,
    module: r.action.split('.')[0],
    entityType: r.entity_type,
    entityId: r.entity_id,
    metadata: parseMetadata(r.metadata),
    ip: r.ip,
    createdAt: r.created_at,
    user: r.user_id ? { id: r.user_id, name: r.user_name ?? `ผู้ใช้ #${r.user_id}`, email: r.user_email ?? null } : null,
  };
}

/** Newest first, keyset-paginated by id (pass meta.nextCursor back as ?cursor=). */
router.get(
  '/',
  validate({
    query: filterSchema.extend({
      cursor: z.coerce.number().int().positive().optional(),
      limit: z.coerce.number().int().min(1).max(PAGE_MAX).default(50),
    }),
  }),
  async (req, res) => {
    const { cursor, limit, ...filters } = req.valid.query;
    const { where, params } = buildFilter(req.user.orgId, filters);
    const rows = await db.query(
      `${SELECT}
        WHERE ${where} ${cursor ? 'AND a.id < :cursor' : ''}
        ORDER BY a.id DESC
        LIMIT ${limit + 1}`,
      { ...params, cursor: cursor ?? null },
    );
    const page = rows.slice(0, limit);
    res.json({ data: page.map(mapRow), meta: { nextCursor: rows.length > limit ? page[page.length - 1].id : null, limit } });
  },
);

/** Options for the filter dropdowns: who appears in the log and which modules (action prefixes). */
router.get('/facets', async (req, res) => {
  const orgId = req.user.orgId;
  const [users, modules, entityTypes] = await Promise.all([
    db.query(
      `SELECT a.user_id, u.full_name, u.email, COUNT(*) AS n, MAX(a.created_at) AS last_at
         FROM audit_logs a
         LEFT JOIN users u ON u.id = a.user_id
        WHERE a.org_id = :orgId
        GROUP BY a.user_id, u.full_name, u.email
        ORDER BY (a.user_id IS NULL), u.full_name`,
      { orgId },
    ),
    db.query(
      `SELECT SUBSTRING_INDEX(action, '.', 1) AS module, COUNT(*) AS n
         FROM audit_logs WHERE org_id = :orgId
        GROUP BY module ORDER BY module`,
      { orgId },
    ),
    db.query(
      `SELECT entity_type, COUNT(*) AS n FROM audit_logs
        WHERE org_id = :orgId AND entity_type IS NOT NULL
        GROUP BY entity_type ORDER BY entity_type`,
      { orgId },
    ),
  ]);
  res.json({
    data: {
      users: users.map((u) => ({
        id: u.user_id ?? null,
        name: u.user_id ? (u.full_name ?? `ผู้ใช้ #${u.user_id}`) : 'ระบบ',
        email: u.email ?? null,
        count: Number(u.n),
        lastAt: u.last_at,
      })),
      modules: modules.map((m) => ({ module: m.module, count: Number(m.n) })),
      entityTypes: entityTypes.map((e) => ({ entityType: e.entity_type, count: Number(e.n) })),
    },
  });
});

const csvCell = (v) => {
  const s = v == null ? '' : String(v);
  // Neutralise spreadsheet formula injection and quote every cell
  const safe = /^[=+\-@]/.test(s) ? `'${s}` : s;
  return `"${safe.replace(/"/g, '""')}"`;
};

/** The current filter as CSV (UTF-8 with BOM so Excel shows Thai), newest first, capped at CSV_MAX rows. */
router.get('/export.csv', validate({ query: filterSchema }), async (req, res) => {
  const { where, params } = buildFilter(req.user.orgId, req.valid.query);
  const rows = await db.query(`${SELECT} WHERE ${where} ORDER BY a.id DESC LIMIT ${CSV_MAX + 1}`, params);
  const truncated = rows.length > CSV_MAX;
  const header = [`เวลา (UTC${env.APP_TZ_OFFSET})`, 'ผู้ใช้', 'อีเมล', 'โมดูล', 'การกระทำ', 'ประเภทข้อมูล', 'รหัสข้อมูล', 'IP', 'รายละเอียด'];
  const lines = rows.slice(0, CSV_MAX).map((raw) => {
    const r = mapRow(raw);
    return [
      localStamp(r.createdAt),
      r.user ? r.user.name : 'ระบบ',
      r.user?.email,
      r.module,
      r.action,
      r.entityType,
      r.entityId,
      r.ip,
      r.metadata == null ? '' : JSON.stringify(r.metadata),
    ];
  });
  const csv = [header, ...lines].map((r) => r.map(csvCell).join(',')).join('\r\n');
  const stamp = localStamp(new Date()).slice(0, 10);
  res.set('Content-Type', 'text/csv; charset=utf-8');
  res.set('Content-Disposition', `attachment; filename="audit-log-${stamp}.csv"`);
  res.set('X-Export-Rows', String(lines.length));
  if (truncated) res.set('X-Export-Truncated', String(CSV_MAX));
  res.send(`\uFEFF${csv}\r\n`);
});

module.exports = { router, maskSecrets };
