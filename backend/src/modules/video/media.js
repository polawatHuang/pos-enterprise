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

/* ----------------------------------------------------- chunked uploads */

/**
 * Uploads arrive as small JSON chunks: on shared hosting (Apache + ModSecurity + Passenger) a
 * large raw or multipart request body may never reach Node, while small JSON requests always do.
 * Parts are appended to MEDIA_DIR/tmp/<id>.part; <id>.json holds who is uploading what.
 */
const TMP_DIR = path.join(MEDIA_DIR, 'tmp');
const CHUNK_BYTES = 384 * 1024;
const MAX_CHUNK_BYTES = 768 * 1024;
const STALE_MS = 24 * 3600 * 1000;
const uploadFiles = (id) => {
  if (!/^[0-9a-f]{32}$/.test(id)) return null;
  return { part: path.join(TMP_DIR, `${id}.part`), meta: path.join(TMP_DIR, `${id}.json`) };
};

function removeStaleUploads() {
  try {
    for (const name of fs.readdirSync(TMP_DIR)) {
      const f = path.join(TMP_DIR, name);
      if (Date.now() - fs.statSync(f).mtimeMs > STALE_MS) fs.rmSync(f, { force: true });
    }
  } catch {
    /* nothing to clean yet */
  }
}

function startUpload(meta) {
  fs.mkdirSync(TMP_DIR, { recursive: true });
  removeStaleUploads();
  const id = crypto.randomBytes(16).toString('hex');
  const f = uploadFiles(id);
  fs.writeFileSync(f.part, Buffer.alloc(0));
  fs.writeFileSync(f.meta, JSON.stringify({ ...meta, received: 0, startedAt: Date.now() }));
  return id;
}

function readUpload(id) {
  const f = uploadFiles(String(id));
  if (!f || !fs.existsSync(f.meta)) return null;
  return { ...JSON.parse(fs.readFileSync(f.meta, 'utf8')), files: f };
}

/**
 * Append bytes at `offset`. A retried chunk that is already stored (offset + length <= received)
 * is accepted as-is, so the client can safely resend after a dropped connection.
 * Returns the new received count, or throws { code } for the route to map to an HTTP error.
 */
function appendChunk(upload, offset, bytes) {
  const { received, size } = upload;
  if (offset + bytes.length <= received) return received;
  if (offset !== received) throw Object.assign(new Error('offset'), { code: 'BAD_OFFSET', received });
  if (received + bytes.length > size) throw Object.assign(new Error('size'), { code: 'TOO_LARGE' });
  fs.appendFileSync(upload.files.part, bytes);
  const next = received + bytes.length;
  const { files, ...meta } = upload;
  fs.writeFileSync(files.meta, JSON.stringify({ ...meta, received: next }));
  return next;
}

function readUploadedFile(upload) {
  return fs.readFileSync(upload.files.part);
}

function dropUpload(upload) {
  fs.rmSync(upload.files.part, { force: true });
  fs.rmSync(upload.files.meta, { force: true });
}

/**
 * Which file (0-based position in the project's list) each scene shows: the editor's explicit pick,
 * otherwise the file at the same position, so uploads play in order. null = no file for that scene.
 */
function sceneMediaIndex(scenes, count) {
  return scenes.map((sc, i) => (Number.isInteger(sc?.media) && sc.media >= 1 && sc.media <= count ? sc.media - 1 : i < count ? i : null));
}

const AI_IMAGE_MAX_BYTES = 4 * 1024 * 1024;
/** Image bytes for the script writer to look at; videos and very large files are described by label only. */
function imageForAi(row) {
  if (row.kind !== 'image' || Number(row.size_bytes) > AI_IMAGE_MAX_BYTES) return null;
  const p = filePath(row.storage_key);
  if (!p || !fs.existsSync(p)) return null;
  return { mime: row.mime, data: fs.readFileSync(p).toString('base64') };
}

module.exports = {
  sceneMediaIndex,
  imageForAi,
  CHUNK_BYTES,
  MAX_CHUNK_BYTES,
  startUpload,
  readUpload,
  appendChunk,
  readUploadedFile,
  dropUpload,
  MEDIA_DIR,
  MAX_FILES,
  MAX_VIDEO_BYTES,
  MAX_IMAGE_BYTES,
  TYPES,
  saveFile,
  filePath,
  removeFile,
  signToken,
  verifyToken,
  publicUrl,
};
