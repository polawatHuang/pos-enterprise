'use strict';

const express = require('express');
const fs = require('node:fs');
const db = require('../../db/pool');
const { verifyToken, filePath, tokenFromParam } = require('./media');

/**
 * Public, signed, expiring media URLs for the video renderer (no login — the token is the auth).
 * GET /api/media/:token[.ext]  → the file (Range requests supported for video).
 */
const router = express.Router();

router.get('/:token', async (req, res) => {
  const t = verifyToken(tokenFromParam(req.params.token));
  if (!t) return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'ลิงก์หมดอายุหรือไม่ถูกต้อง' } });
  res.set('Cache-Control', 'private, max-age=3600');
  res.set('X-Content-Type-Options', 'nosniff');
  if (t.k === 'm') {
    const m = await db.one('SELECT mime, storage_key FROM video_media WHERE id = :id', { id: t.id });
    const p = m && filePath(m.storage_key);
    if (!p || !fs.existsSync(p)) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'ไม่พบไฟล์' } });
    return res.type(m.mime).sendFile(p);
  }
  if (t.k === 'c') {
    const a = await db.one("SELECT mime, data FROM cover_assets WHERE cover_id = :id AND kind IN ('final','background') ORDER BY kind = 'final' DESC LIMIT 1", {
      id: t.id,
    });
    if (!a) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'ไม่พบไฟล์' } });
    return res.type(a.mime).send(Buffer.from(a.data));
  }
  return res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'ชนิดไฟล์ไม่รองรับ' } });
});

module.exports = { router };
