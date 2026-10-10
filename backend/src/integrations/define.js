'use strict';

const { AppError } = require('../core/errors');

/**
 * Every third-party service is wrapped in an adapter with the same shape:
 *   meta          — what it is, which env vars it needs, where to apply for keys
 *   isConfigured  — true when all required env vars are present
 *   requireConfig — returns the env values or throws a clear 503
 * Module code only talks to adapters, so swapping a provider means writing one new file.
 */
function defineAdapter(meta, impl = {}) {
  const required = meta.env.filter((e) => !e.optional).map((e) => e.name);
  const isConfigured = () => required.every((name) => Boolean(process.env[name]));
  const requireConfig = () => {
    const missing = required.filter((name) => !process.env[name]);
    if (missing.length) {
      throw new AppError(503, 'INTEGRATION_NOT_CONFIGURED', `${meta.name} ยังไม่ได้ตั้งค่า (${missing.join(', ')})`, {
        provider: meta.id,
        missing,
      });
    }
    return Object.fromEntries(meta.env.map((e) => [e.name, process.env[e.name] ?? e.default]));
  };
  return { meta, isConfigured, requireConfig, ...impl };
}

module.exports = { defineAdapter };
