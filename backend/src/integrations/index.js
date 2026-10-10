'use strict';

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
  require('./line'),
  require('./heygen'),
  require('./elevenlabs'),
  require('./shotstack'),
  require('./r2'),
  require('./apify'),
];

function status() {
  return adapters.map((a) => ({
    ...a.meta,
    env: a.meta.env.map((e) => ({ name: e.name, optional: Boolean(e.optional), set: Boolean(process.env[e.name]) })),
    configured: a.isConfigured(),
  }));
}

module.exports = { adapters, status };
