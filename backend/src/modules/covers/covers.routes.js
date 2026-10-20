'use strict';

const express = require('express');
const { z } = require('zod');
const db = require('../../db/pool');
const { validate } = require('../../core/http');
const { authenticate, requirePermission } = require('../../core/auth');
const { audit } = require('../../core/audit');
const { notFound, badRequest, conflict } = require('../../core/errors');
const ai = require('../../integrations/ai');
const minimaxMedia = require('../../integrations/minimax-media');
const { enqueue } = require('../../jobs/queue');
const { LAYOUTS, FONTS } = require('./covers.service');

const router = express.Router();
router.use(authenticate, requirePermission('video:create'));

const MAX_UPLOAD = 5 * 1024 * 1024;
const MAX_FINAL = 4 * 1024 * 1024;
const idParam = z.object({ id: z.coerce.number().int().positive() });
const parseJson = (v) => (v == null ? null : typeof v === 'string' ? JSON.parse(v) : v);

/** data:image/png;base64,… → { mime, buffer } (png/jpeg/webp only). */
function decodeImage(dataUrl, max, label) {
  const m = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=\s]+)$/.exec(String(dataUrl));
  if (!m) throw badRequest(`${label}ต้องเป็นรูป PNG, JPEG หรือ WebP`);
  const buffer = Buffer.from(m[2], 'base64');
  if (!buffer.length) throw badRequest(`${label}ว่างเปล่า`);
  if (buffer.length > max) throw badRequest(`${label}ใหญ่เกิน ${Math.round(max / 1024 / 1024)} MB`);
  return { mime: m[1], buffer };
}

function mapCover(c) {
  const v = c.updated_at ? new Date(c.updated_at).getTime() : 0;
  const asset = (kind) => (c[`has_${kind}`] ? `/api/covers/${c.id}/assets/${kind}?v=${v}` : null);
  return {
    id: c.id,
    orientation: c.orientation,
    style: c.style,
    headline: c.headline,
    subtext: c.subtext,
    badge: c.badge,
    uploadKind: c.upload_kind,
    design: parseJson(c.design),
    status: c.status,
    error: c.error,
    provider: c.provider,
    model: c.model,
    uploadUrl: asset('upload'),
    backgroundUrl: asset('background'),
    finalUrl: asset('final'),
    createdAt: c.created_at,
    updatedAt: c.updated_at,
  };
}

const SELECT = `SELECT c.*,
    EXISTS(SELECT 1 FROM cover_assets a WHERE a.cover_id = c.id AND a.kind = 'upload') AS has_upload,
    EXISTS(SELECT 1 FROM cover_assets a WHERE a.cover_id = c.id AND a.kind = 'background') AS has_background,
    EXISTS(SELECT 1 FROM cover_assets a WHERE a.cover_id = c.id AND a.kind = 'final') AS has_final
  FROM cover_projects c`;

async function getCover(orgId, id) {
  const c = await db.one(`${SELECT} WHERE c.id = :id AND c.org_id = :orgId`, { id, orgId });
  if (!c) throw notFound('ไม่พบปกคลิป');
  return c;
}

function requireProviders() {
  ai.requireConfig();
  minimaxMedia.requireConfig();
}

router.get('/', async (req, res) => {
  const rows = await db.query(`${SELECT} WHERE c.org_id = :orgId ORDER BY c.id DESC LIMIT 60`, { orgId: req.user.orgId });
  res.json({ data: rows.map(mapCover) });
});

const createBody = z.object({
  orientation: z.enum(['portrait', 'landscape']),
  style: z.string().trim().min(2, 'ระบุ style').max(200),
  headline: z.string().trim().min(1, 'ใส่หัวข้อ').max(80),
  subtext: z.string().trim().max(120).nullable().optional(),
  badge: z.string().trim().max(30).nullable().optional(),
  image: z
    .string()
    .max(8 * 1024 * 1024)
    .nullable()
    .optional(),
  imageKind: z.enum(['product', 'person']).default('product'),
});

router.post('/', validate({ body: createBody }), async (req, res) => {
  requireProviders();
  const b = req.valid.body;
  const upload = b.image ? decodeImage(b.image, MAX_UPLOAD, 'รูปที่แนบ') : null;
  const id = await db.tx(async (conn) => {
    const [r] = await conn.query(
      `INSERT INTO cover_projects (org_id, created_by, orientation, style, headline, subtext, badge, upload_kind)
       VALUES (:orgId, :userId, :orientation, :style, :headline, :subtext, :badge, :uploadKind)`,
      {
        orgId: req.user.orgId,
        userId: req.user.id,
        orientation: b.orientation,
        style: b.style,
        headline: b.headline,
        subtext: b.subtext || null,
        badge: b.badge || null,
        uploadKind: upload ? b.imageKind : null,
      },
    );
    if (upload) {
      await conn.query("INSERT INTO cover_assets (cover_id, kind, mime, data) VALUES (:id, 'upload', :mime, :data)", {
        id: r.insertId,
        mime: upload.mime,
        data: upload.buffer,
      });
    }
    return r.insertId;
  });
  await enqueue('cover.generate', { coverId: id, redesign: true }, { orgId: req.user.orgId, maxAttempts: 1 });
  audit(req, 'covers.create', 'cover_project', id, { orientation: b.orientation, hasImage: Boolean(upload) });
  res.status(202).json({ data: { id } });
});

router.get('/:id', validate({ params: idParam }), async (req, res) => {
  res.json({ data: mapCover(await getCover(req.user.orgId, req.valid.params.id)) });
});

router.get('/:id/assets/:kind', validate({ params: idParam.extend({ kind: z.enum(['upload', 'background', 'final']) }) }), async (req, res) => {
  const { id, kind } = req.valid.params;
  const a = await db.one(
    `SELECT a.mime, a.data FROM cover_assets a JOIN cover_projects c ON c.id = a.cover_id
      WHERE a.cover_id = :id AND a.kind = :kind AND c.org_id = :orgId`,
    { id, kind, orgId: req.user.orgId },
  );
  if (!a) throw notFound('ไม่พบไฟล์ภาพ');
  res.set({ 'Content-Type': a.mime, 'Cache-Control': 'private, max-age=86400', 'X-Content-Type-Options': 'nosniff' });
  res.send(Buffer.from(a.data));
});

const userDesign = z
  .object({
    font: z.enum(FONTS).optional(),
    layout: z.enum(LAYOUTS).optional(),
    textColor: z
      .string()
      .regex(/^#[0-9a-fA-F]{6}$/)
      .optional(),
    accentColor: z
      .string()
      .regex(/^#[0-9a-fA-F]{6}$/)
      .optional(),
    titleScale: z.number().min(0.5).max(1.6).optional(),
    emphasisWord: z.string().max(80).nullable().optional(),
    imageX: z.number().min(0).max(1).optional(),
    imageY: z.number().min(0).max(1).optional(),
    imageScale: z.number().min(0.2).max(1).optional(),
  })
  .strict();

router.patch(
  '/:id',
  validate({
    params: idParam,
    body: z
      .object({
        headline: z.string().trim().min(1).max(80).optional(),
        subtext: z.string().trim().max(120).nullable().optional(),
        badge: z.string().trim().max(30).nullable().optional(),
        user: userDesign.optional(),
      })
      .strict(),
  }),
  async (req, res) => {
    const c = await getCover(req.user.orgId, req.valid.params.id);
    const b = req.valid.body;
    const design = parseJson(c.design) ?? {};
    if (b.user) design.user = { ...(design.user ?? {}), ...b.user };
    await db.query(
      `UPDATE cover_projects SET headline = COALESCE(:headline, headline),
              subtext = IF(:subtextSet, :subtext, subtext), badge = IF(:badgeSet, :badge, badge), design = :design WHERE id = :id`,
      {
        id: c.id,
        headline: b.headline ?? null,
        subtextSet: b.subtext !== undefined,
        subtext: b.subtext || null,
        badgeSet: b.badge !== undefined,
        badge: b.badge || null,
        design: JSON.stringify(design),
      },
    );
    res.json({ data: mapCover(await getCover(req.user.orgId, c.id)) });
  },
);

router.post('/:id/final', validate({ params: idParam, body: z.object({ image: z.string().max(6 * 1024 * 1024) }) }), async (req, res) => {
  const c = await getCover(req.user.orgId, req.valid.params.id);
  const img = decodeImage(req.valid.body.image, MAX_FINAL, 'ภาพปก');
  await db.query(
    `INSERT INTO cover_assets (cover_id, kind, mime, data) VALUES (:id, 'final', :mime, :data)
     ON DUPLICATE KEY UPDATE mime = VALUES(mime), data = VALUES(data), created_at = CURRENT_TIMESTAMP`,
    { id: c.id, mime: img.mime, data: img.buffer },
  );
  await db.query('UPDATE cover_projects SET updated_at = CURRENT_TIMESTAMP WHERE id = :id', { id: c.id });
  audit(req, 'covers.save', 'cover_project', c.id);
  res.json({ data: mapCover(await getCover(req.user.orgId, c.id)) });
});

router.post(
  '/:id/regenerate',
  validate({ params: idParam, body: z.object({ style: z.string().trim().min(2).max(200).optional(), redesign: z.boolean().default(false) }).default({}) }),
  async (req, res) => {
    requireProviders();
    const c = await getCover(req.user.orgId, req.valid.params.id);
    if (c.status === 'generating') throw conflict('กำลังสร้างภาพอยู่');
    const b = req.valid.body;
    await db.query("UPDATE cover_projects SET status = 'generating', error = NULL, style = COALESCE(:style, style) WHERE id = :id", {
      id: c.id,
      style: b.style ?? null,
    });
    await enqueue('cover.generate', { coverId: c.id, redesign: b.redesign || Boolean(b.style) }, { orgId: req.user.orgId, maxAttempts: 1 });
    audit(req, 'covers.regenerate', 'cover_project', c.id);
    res.status(202).json({ data: { id: c.id } });
  },
);

router.delete('/:id', validate({ params: idParam }), async (req, res) => {
  const c = await getCover(req.user.orgId, req.valid.params.id);
  await db.query('DELETE FROM cover_projects WHERE id = :id', { id: c.id });
  audit(req, 'covers.delete', 'cover_project', c.id);
  res.json({ data: { ok: true } });
});

module.exports = { router, decodeImage };
