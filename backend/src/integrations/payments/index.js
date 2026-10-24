'use strict';

// Payment providers that can confirm a PromptPay payment by themselves. A provider is one file with
// the same shape (see opn.js); adding another (2C2P, KBank...) means writing that file
// and listing it here. Per-shop keys are kept encrypted in integration_credentials.

const crypto = require('node:crypto');
const env = require('../../config/env');
const db = require('../../db/pool');
const { badRequest } = require('../../core/errors');
const { encryptJson, decryptJson } = require('../../utils/crypto');

const PROVIDERS = { opn: require('./opn'), gbprimepay: require('./gbprimepay'), mock: require('./mock') };
const credProvider = (id) => `payment:${id}`;

const available = () => Object.values(PROVIDERS).filter((p) => !p.devOnly || !env.isProd);

function provider(id) {
  const p = PROVIDERS[id];
  if (!p || (p.devOnly && env.isProd)) throw badRequest('ไม่รู้จักผู้ให้บริการชำระเงินนี้');
  return p;
}

/** The shop's saved keys for a provider (decrypted), with the webhook key that identifies the shop. */
async function credentials(orgId, id) {
  const row = await db.one('SELECT account_ref, data_encrypted FROM integration_credentials WHERE org_id = :orgId AND provider = :p', { orgId, p: credProvider(id) });
  if (!row) return null;
  try {
    return { webhookKey: row.account_ref, ...decryptJson(row.data_encrypted) };
  } catch {
    return null; // APP_ENCRYPTION_KEY changed: keys must be entered again
  }
}

async function saveCredentials(orgId, id, creds) {
  if (!env.APP_ENCRYPTION_KEY) throw badRequest('ต้องตั้งค่า APP_ENCRYPTION_KEY บนเซิร์ฟเวอร์ก่อนบันทึกคีย์');
  const existing = await db.one('SELECT account_ref FROM integration_credentials WHERE org_id = :orgId AND provider = :p', { orgId, p: credProvider(id) });
  const webhookKey = existing?.account_ref ?? `wh_${crypto.randomBytes(18).toString('base64url')}`;
  await db.query(
    `INSERT INTO integration_credentials (org_id, provider, account_ref, data_encrypted) VALUES (:orgId, :p, :ref, :data)
     ON DUPLICATE KEY UPDATE data_encrypted = VALUES(data_encrypted)`,
    { orgId, p: credProvider(id), ref: webhookKey, data: encryptJson(creds) },
  );
  return webhookKey;
}

/**
 * The public HTTPS URL a provider can POST to for this shop, or null when the server does not know its
 * own address (then the till's status checks still close the bill, a little later).
 */
function webhookUrl(id, key) {
  const origin = (env.PUBLIC_API_URL || env.APP_PUBLIC_URL || '').replace(/\/+$/, '');
  if (!key || !/^https:\/\//.test(origin)) return null;
  return `${origin}/api/public/payments/${id}/${key}`;
}

/** Which shop (and provider) a webhook URL belongs to. */
async function orgForWebhookKey(id, key) {
  const row = await db.one('SELECT org_id FROM integration_credentials WHERE provider = :p AND account_ref = :key', { p: credProvider(id), key });
  return row?.org_id ?? null;
}

module.exports = { available, provider, credentials, saveCredentials, orgForWebhookKey, credProvider, webhookUrl };
