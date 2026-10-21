'use strict';

/**
 * Integration settings that can be changed from the web UI ("การเชื่อมต่อ API").
 * Values saved there live encrypted in app_config and win over the server environment;
 * anything not saved falls back to process.env, so .env / Plesk variables stay the default.
 *
 * get() is synchronous (adapters read keys on every call), so overrides are kept in memory:
 * loaded before the first request, reloaded after every save, and re-read in the background
 * at most every 30 s so other Passenger processes pick up changes too.
 */
const db = require('../db/pool');
const logger = require('../core/logger');
const { encryptJson, decryptJson } = require('../utils/crypto');

const STALE_MS = 30_000;
let overrides = new Map();
let loadedAt = 0;
let loading = null;

async function readAll() {
  const rows = await db.query('SELECT name, value_enc FROM app_config');
  const next = new Map();
  for (const r of rows) {
    try {
      next.set(r.name, decryptJson(r.value_enc));
    } catch (err) {
      logger.error({ err: err.message, name: r.name }, 'cannot decrypt app_config value (APP_ENCRYPTION_KEY changed?)');
    }
  }
  return next;
}

/** (Re)load overrides from the database; on failure (e.g. table missing) keep using what we have. */
function load() {
  loading ??= readAll()
    .then((next) => {
      overrides = next;
    })
    .catch((err) => {
      if (err.code !== 'ER_NO_SUCH_TABLE') logger.warn({ err: err.message }, 'app_config load failed; using environment only');
    })
    .finally(() => {
      loadedAt = Date.now();
      loading = null;
    });
  return loading;
}

/** Express middleware: wait for the first load, then refresh in the background when stale. */
function middleware(req, res, next) {
  if (!loadedAt) return load().then(() => next());
  if (Date.now() - loadedAt > STALE_MS) void load();
  return next();
}

const get = (name) => (overrides.has(name) ? overrides.get(name) : process.env[name]);
const source = (name) => (overrides.has(name) ? 'db' : process.env[name] ? 'env' : null);

const isSecret = (name) => /KEY|SECRET|TOKEN|PASSWORD/.test(name);
/** What the UI may show: secrets only as their last 4 characters. */
function hint(name) {
  const v = get(name);
  if (!v) return null;
  if (!isSecret(name)) return v;
  return v.length > 8 ? `••••${v.slice(-4)}` : '••••';
}

/** values: { NAME: string | null } — null/"" removes the override (back to the environment value). */
async function save(values, userId) {
  const entries = Object.entries(values);
  if (entries.some(([, v]) => v)) encryptJson(''); // fails fast with a clear error when APP_ENCRYPTION_KEY is not set
  await db.tx(async (conn) => {
    for (const [name, value] of entries) {
      if (value) {
        await conn.query(
          `INSERT INTO app_config (name, value_enc, updated_by) VALUES (:name, :enc, :userId)
           ON DUPLICATE KEY UPDATE value_enc = VALUES(value_enc), updated_by = VALUES(updated_by)`,
          { name, enc: encryptJson(value), userId },
        );
      } else {
        await conn.query('DELETE FROM app_config WHERE name = :name', { name });
      }
    }
  });
  await load();
}

module.exports = { get, source, hint, isSecret, load, middleware, save };
