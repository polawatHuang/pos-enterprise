'use strict';

const crypto = require('node:crypto');
const env = require('../config/env');

// AES-256-GCM for third-party OAuth tokens stored in integration_credentials.
function key() {
  if (!env.APP_ENCRYPTION_KEY) throw new Error('APP_ENCRYPTION_KEY is not set');
  const buf = Buffer.from(env.APP_ENCRYPTION_KEY, 'base64');
  if (buf.length !== 32) throw new Error('APP_ENCRYPTION_KEY must be 32 bytes (base64)');
  return buf;
}

function encryptJson(obj) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const enc = Buffer.concat([cipher.update(JSON.stringify(obj), 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), enc].map((b) => b.toString('base64')).join('.');
}

function decryptJson(payload) {
  const [iv, tag, enc] = payload.split('.').map((s) => Buffer.from(s, 'base64'));
  const decipher = crypto.createDecipheriv('aes-256-gcm', key(), iv);
  decipher.setAuthTag(tag);
  return JSON.parse(Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8'));
}

module.exports = { encryptJson, decryptJson };
