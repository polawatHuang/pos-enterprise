'use strict';

const { defineAdapter } = require('./define');
const { notImplemented } = require('../core/errors');

// Interface is fixed now so modules can be built against it; bodies land in phase 3.
const planned = (method) => () => {
  adapter.requireConfig();
  throw notImplemented(`Cloudflare R2 Storage: ${method} จะเปิดใช้งานในเฟสที่ 3`);
};

const adapter = defineAdapter(
  {
    id: 'r2',
    name: 'Cloudflare R2 Storage',
    category: 'storage',
    usedBy: ['video','accounting','social'],
    phase: 3,
    purpose: 'เก็บไฟล์วิดีโอ รูปสินค้า ใบเสร็จ และเอกสาร PDF (S3-compatible, ไม่มีค่า egress)',
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
    /** S3 PUT presigned URL (AWS SigV4, region "auto") — browser uploads directly, bypassing the host */
    presignUpload: planned('presignUpload'),
    /** R2_PUBLIC_BASE_URL + key (custom domain; verify it in TikTok for PULL_FROM_URL) */
    publicUrl: planned('publicUrl'),
  },
);

module.exports = adapter;
