'use strict';

const runtime = require('../config/runtime');

// Registry of all third-party adapters (see docs/API_KEYS.md for how to obtain each key)
const adapters = [
  require('./minimax'),
  require('./anthropic'),
  require('./minimax-media'),
  require('./tiktok'),
  require('./tiktok-shop'),
  require('./shopee'),
  require('./shopee-affiliate'),
  require('./meta'),
  require('./meta-social'),
  require('./line'),
  require('./heygen'),
  require('./elevenlabs'),
  require('./shotstack'),
  require('./r2'),
  require('./apify'),
  require('./kalodata'),
];

/** Settings the web UI may change: every adapter's variables plus the AI provider switch. Nothing else (DB, JWT, cron secrets stay server-only). */
const EDITABLE = new Set(['AI_PROVIDER', ...adapters.flatMap((a) => a.meta.env.map((e) => e.name))]);

// Never includes a secret's value: secrets are reduced to their last 4 characters by runtime.hint().
function status() {
  return adapters.map((a) => ({
    ...a.meta,
    env: a.meta.env.map((e) => ({
      name: e.name,
      optional: Boolean(e.optional),
      default: e.default ?? null,
      set: Boolean(runtime.get(e.name)),
      source: runtime.source(e.name),
      secret: runtime.isSecret(e.name),
      hint: runtime.hint(e.name),
      envDefault: Boolean(process.env[e.name]),
    })),
    configured: a.isConfigured(),
    testable: TESTABLE.has(a.meta.id),
    // Adapters whose API calls are not built yet (marketplace partner APIs, HeyGen)
    available: !a.meta.planned,
  }));
}

/** Services the settings page can test with a live request (see integrations.routes TESTS). */
const TESTABLE = new Set(['minimax', 'anthropic', 'minimax_media', 'shotstack', 'line', 'elevenlabs', 'meta', 'meta_social', 'kalodata']);

module.exports = { adapters, status, EDITABLE, TESTABLE };
