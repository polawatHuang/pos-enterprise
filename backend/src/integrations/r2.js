'use strict';

const crypto = require('node:crypto');
const { defineAdapter } = require('./define');
const { AppError } = require('../core/errors');

const MAX_COPY_BYTES = 200 * 1024 * 1024;

const sha256 = (data) => crypto.createHash('sha256').update(data).digest('hex');
const hmac = (key, data) => crypto.createHmac('sha256', key).update(data).digest();
// S3 canonical URIs encode each path segment per RFC 3986 (keep "/")
const encodeKey = (key) => key.split('/').map((s) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)).join('/');

const adapter = defineAdapter(
  {
    id: 'r2',
    name: 'Cloudflare R2 Storage',
    category: 'storage',
    usedBy: ['video', 'social'],
    phase: 6,
    purpose: 'เก็บไฟล์วิดีโอ เสียง และซับถาวร (S3-compatible, ไม่มีค่า egress) — ลิงก์จาก MiniMax/Shotstack หมดอายุภายในไม่กี่ชั่วโมง',
    applyUrl: 'https://dash.cloudflare.com/?to=/:account/r2',
    env: [
      { name: 'R2_ACCOUNT_ID' },
      { name: 'R2_ACCESS_KEY_ID' },
      { name: 'R2_SECRET_ACCESS_KEY' },
      { name: 'R2_BUCKET' },
      { name: 'R2_PUBLIC_BASE_URL' },
    ],
  },
  {
    /** AWS Signature V4 headers for a single-chunk PUT (region "auto", service "s3"). */
    signPut({ key, body, contentType, now = new Date() }) {
      const env = adapter.requireConfig();
      const host = `${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`;
      const amzDate = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
      const day = amzDate.slice(0, 8);
      const payloadHash = sha256(body);
      const path = `/${env.R2_BUCKET}/${encodeKey(key)}`;
      const headers = { 'content-type': contentType, host, 'x-amz-content-sha256': payloadHash, 'x-amz-date': amzDate };
      const signed = Object.keys(headers).sort();
      const canonical = ['PUT', path, '', ...signed.map((h) => `${h}:${headers[h]}`), '', signed.join(';'), payloadHash].join('\n');
      const scope = `${day}/auto/s3/aws4_request`;
      const toSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256(canonical)].join('\n');
      let k = hmac(`AWS4${env.R2_SECRET_ACCESS_KEY}`, day);
      for (const part of ['auto', 's3', 'aws4_request']) k = hmac(k, part);
      const signature = crypto.createHmac('sha256', k).update(toSign).digest('hex');
      return {
        url: `https://${host}${path}`,
        headers: {
          ...headers,
          Authorization: `AWS4-HMAC-SHA256 Credential=${env.R2_ACCESS_KEY_ID}/${scope}, SignedHeaders=${signed.join(';')}, Signature=${signature}`,
        },
      };
    },

    publicUrl(key) {
      const { R2_PUBLIC_BASE_URL } = adapter.requireConfig();
      return `${R2_PUBLIC_BASE_URL.replace(/\/+$/, '')}/${encodeKey(key)}`;
    },

    /** Upload a buffer; returns its public URL. */
    async putObject(key, body, contentType) {
      const { url, headers } = adapter.signPut({ key, body, contentType });
      const sendHeaders = Object.fromEntries(Object.entries(headers).filter(([h]) => h !== 'host')); // fetch sets Host itself
      const res = await fetch(url, { method: 'PUT', headers: sendHeaders, body, signal: AbortSignal.timeout(120_000) });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new AppError(502, 'R2_ERROR', `อัปโหลดไฟล์ไป R2 ไม่สำเร็จ (${res.status}) ${text.slice(0, 200)}`);
      }
      return adapter.publicUrl(key);
    },

    /** Download a (short-lived) provider URL and store it permanently. */
    async copyFromUrl(sourceUrl, key, fallbackType = 'application/octet-stream') {
      const res = await fetch(sourceUrl, { signal: AbortSignal.timeout(120_000) });
      if (!res.ok) throw new AppError(502, 'R2_ERROR', `ดาวน์โหลดไฟล์ต้นทางไม่สำเร็จ (${res.status})`);
      const len = Number(res.headers.get('content-length') ?? 0);
      if (len > MAX_COPY_BYTES) throw new AppError(413, 'FILE_TOO_LARGE', 'ไฟล์ใหญ่เกิน 200 MB');
      const body = Buffer.from(await res.arrayBuffer());
      return { url: await adapter.putObject(key, body, res.headers.get('content-type') || fallbackType), size: body.length };
    },
  },
);

module.exports = adapter;
