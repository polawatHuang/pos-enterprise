'use strict';

/**
 * Entry point. Plesk's Node.js extension (Phusion Passenger) loads this file as the
 * "Application Startup File"; Passenger intercepts listen() and supplies the socket.
 * Locally: `npm run dev` -> http://localhost:4000
 */
function boot() {
  const env = require('./src/config/env');
  const logger = require('./src/core/logger');
  const { createApp } = require('./src/app');
  const { pool } = require('./src/db/pool');
  const { startInProcessLoop } = require('./src/jobs/runner');

  const app = createApp();

  const server = app.listen(env.PORT, () => {
    logger.info({ port: env.PORT, env: env.NODE_ENV, jobRunner: env.JOB_RUNNER }, 'API listening');
  });

  if (env.JOB_RUNNER === 'inprocess') startInProcessLoop();

  function shutdown(signal) {
    logger.info({ signal }, 'shutting down');
    server.close(() => pool.end().finally(() => process.exit(0)));
    setTimeout(() => process.exit(1), 10_000).unref();
  }
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
  return app;
}

let app = null;
try {
  app = boot();
} catch (err) {
  // Missing env vars / npm install: answer 503 with the reason instead of Passenger's blank 500
  require('./src/boot/fallback').startFallbackServer(err);
}

module.exports = app;
