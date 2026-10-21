'use strict';

const { AppError } = require('../core/errors');
const runtime = require('../config/runtime');

/**
 * Every third-party service is wrapped in an adapter with the same shape:
 *   meta          — what it is, which env vars it needs, where to apply for keys
 *   isConfigured  — true when all required env vars are present
 *   missing       — names of required env vars that are not set
 *   requireConfig — returns the env values or throws a clear 503
 * Values come from config/runtime: saved from the web UI first, then the server environment.
 * Module code only talks to adapters, so swapping a provider means writing one new file.
 */
function defineAdapter(meta, impl = {}) {
  const required = meta.env.filter((e) => !e.optional).map((e) => e.name);
  const missing = () => required.filter((name) => !runtime.get(name));
  const isConfigured = () => missing().length === 0;
  const requireConfig = () => {
    const absent = missing();
    if (absent.length) {
      throw new AppError(503, 'INTEGRATION_NOT_CONFIGURED', `${meta.name} ยังไม่ได้ตั้งค่า (${absent.join(', ')})`, {
        provider: meta.id,
        missing: absent,
      });
    }
    return Object.fromEntries(meta.env.map((e) => [e.name, runtime.get(e.name) || e.default]));
  };
  return { meta, isConfigured, missing, requireConfig, ...impl };
}

module.exports = { defineAdapter };
