'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const env = require('../../config/env');

/**
 * User footage for AI videos (phone clips / photos of the real product). Files live on the
 * backend's disk (Plesk keeps it between restarts), and the renderer (Shotstack) fetches them
 * through short-lived signed URLs, so no object storage is needed.
 */
const MEDIA_DIR = process.env.MEDIA_DIR || path.join(__dirname, '..', '..', '..', 'storage', 'media');
const MAX_FILES = 10;
const MAX_VIDEO_BYTES = 60 * 1024 * 1024;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const TYPES = {
  'video/mp4': { kind: 'video', ext: 'mp4' },
  'video/quicktime': { kind: 'video', ext: 'mov' },
  'video/webm': { kind: 'video', ext: 'webm' },
  'image/jpeg': { kind: 'image', ext: 'jpg' },
  'image/png': { kind: 'image', ext: 'png' },
  'image/webp': { kind: 'image', ext: 'webp' },
};
const URL_TTL_SEC = 6 * 3600; // long enough for a render to fetch every file

function ensureDir() {
  fs.mkdirSync(MEDIA_DIR, { recursive: true });
}

function saveFile(buffer, mime) {
  const t = TYPES[mime];
  ensureDir();
  const key = `${Date.now().toString(36)}-${crypto.randomBytes(9).toString('hex')}.${t.ext}`;
  fs.writeFileSync(path.join(MEDIA_DIR, key), buffer);
  return key;
}

/** Only plain generated names, so a key can never point outside MEDIA_DIR. */
function filePath(key) {
  if (!/^[a-z0-9]+-[0-9a-f]{18}\.(mp4|mov|webm|jpg|png|webp)$/.test(key)) return null;
  return path.join(MEDIA_DIR, key);
}

function removeFile(key) {
  const p = filePath(key);
  if (p) fs.rmSync(p, { force: true });
}

const b64url = (s) => Buffer.from(s).toString('base64url');
const hmac = (data) => crypto.createHmac('sha256', `media:${env.JWT_ACCESS_SECRET}`).update(data).digest('base64url');

/** Signed token for a public, expiring media URL. kind: 'm' = video_media row, 'c' = cover image. */
function signToken(kind, id, ttlSec = URL_TTL_SEC) {
  const payload = b64url(JSON.stringify({ k: kind, id, exp: Math.floor(Date.now() / 1000) + ttlSec }));
  return `${payload}.${hmac(payload)}`;
}

function verifyToken(token) {
  const [payload, sig] = String(token).split('.');
  if (!payload || !sig) return null;
  const expected = hmac(payload);
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString());
    if (!data.exp || data.exp < Date.now() / 1000) return null;
    return data;
  } catch {
    return null;
  }
}

/** Absolute URL the renderer can reach (needs PUBLIC_API_URL, the backend's public HTTPS origin). */
function publicUrl(kind, id) {
  const base = (env.PUBLIC_API_URL || '').replace(/\/+$/, '');
  if (!base) return null;
  return `${base}/api/media/${signToken(kind, id)}`;
}

module.exports = { MEDIA_DIR, MAX_FILES, MAX_VIDEO_BYTES, MAX_IMAGE_BYTES, TYPES, saveFile, filePath, removeFile, signToken, verifyToken, publicUrl };
