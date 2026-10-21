'use strict';

const Busboy = require('busboy');
const { AppError, badRequest } = require('../core/errors');
const logger = require('../core/logger');

/**
 * Express middleware reading ONE file field of a multipart/form-data upload into memory:
 * req.upload = { buffer, mime, filename }. Other requests pass through untouched.
 *
 * Uploads go as multipart rather than a raw body because shared-hosting web firewalls
 * (ModSecurity on Plesk) cap non-multipart request bodies at ~128 KB but allow files sent
 * as form data, so a raw image/video body is cut off before it reaches the app.
 */
function singleFile(field, maxBytes) {
  return (req, res, next) => {
    if (!req.is('multipart/form-data')) return next();
    let bb;
    try {
      bb = Busboy({ headers: req.headers, limits: { files: 1, fileSize: maxBytes, fields: 20 } });
    } catch {
      return next(badRequest('ข้อมูลอัปโหลดไม่ถูกต้อง'));
    }
    // Bytes that actually arrived vs what the client sent: a proxy or firewall that cuts the body
    // short shows up as received < expected
    // ?size= is the file size the browser sent; Content-Length may already be the proxy's shortened one
    const fileSize = Number(req.query?.size) || null;
    const expected = Number(req.headers['content-length']) || null;
    let received = 0;
    req.on('data', (c) => {
      received += c.length;
    });
    const sizes = () =>
      `ได้รับ ${received.toLocaleString('en-US')} ไบต์${fileSize ? ` จากไฟล์ ${fileSize.toLocaleString('en-US')} ไบต์` : expected ? ` จาก ${expected.toLocaleString('en-US')}` : ''}`;
    let done = false;
    const finish = (err) => {
      if (done) return;
      done = true;
      req.unpipe(bb);
      req.resume(); // drain the rest of an oversized/aborted body
      next(err);
    };
    bb.on('file', (name, stream, info) => {
      if (name !== field) return stream.resume();
      const chunks = [];
      stream.on('data', (c) => chunks.push(c));
      stream.on('limit', () => finish(new AppError(413, 'FILE_TOO_LARGE', `ไฟล์ใหญ่เกิน ${Math.round(maxBytes / 1024 / 1024)} MB`)));
      stream.on('end', () => {
        if (!stream.truncated) req.upload = { buffer: Buffer.concat(chunks), mime: String(info.mimeType || '').toLowerCase(), filename: info.filename ?? null };
      });
    });
    bb.on('error', (err) => {
      const cut = (fileSize && received < fileSize) || (expected && received < expected);
      logger.warn({ err: err.message, received, expected, fileSize, path: req.path }, 'multipart upload incomplete');
      finish(
        badRequest(
          cut
            ? `อัปโหลดไม่สำเร็จ: ไฟล์มาไม่ครบ (${sizes()}) — เซิร์ฟเวอร์หรือไฟร์วอลล์ตัดข้อมูลระหว่างทาง`
            : `อัปโหลดไม่สำเร็จ (ข้อมูลไม่ครบ, ${sizes()})`,
          { received, expected, fileSize },
        ),
      );
    });
    bb.on('close', () => finish());
    req.pipe(bb);
  };
}

module.exports = { singleFile };
