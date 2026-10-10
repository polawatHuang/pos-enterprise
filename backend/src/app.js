'use strict';

const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const env = require('./config/env');
const db = require('./db/pool');
const { notFoundHandler, errorHandler } = require('./core/http');
const { moduleStub } = require('./modules/_stubs/module-stub');

/** "https://*.vercel.app" -> /^https:\/\/[^.]+\.vercel\.app$/ */
function originMatcher(patterns) {
  const regexes = patterns.map(
    (p) => new RegExp(`^${p.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^.]+')}$`),
  );
  return (origin) => regexes.some((r) => r.test(origin));
}

function createApp() {
  const app = express();
  const allowOrigin = originMatcher(env.corsOrigins);

  // Behind Plesk's nginx/Apache (and Vercel's proxy): trust X-Forwarded-* for req.ip / req.secure
  app.set('trust proxy', /^\d+$/.test(env.TRUST_PROXY) ? Number(env.TRUST_PROXY) : env.TRUST_PROXY);
  app.disable('x-powered-by');

  app.use(helmet({ crossOriginResourcePolicy: { policy: 'same-site' } }));
  app.use(
    cors({
      // Requests without Origin (server-to-server, Vercel rewrite, cron, webhooks) are allowed;
      // browser requests must come from an allow-listed frontend origin.
      origin: (origin, cb) => cb(null, !origin || allowOrigin(origin)),
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
      maxAge: 600,
    }),
  );
  // Receipt photos for AI extraction are sent as base64 JSON; everything else stays small.
  const jsonSmall = express.json({ limit: '1mb' });
  const jsonLarge = express.json({ limit: '6mb' });
  app.use((req, res, next) => (req.path === '/api/accounting/ai/extract-receipt' ? jsonLarge : jsonSmall)(req, res, next));
  app.use(cookieParser());

  app.get('/api/health', async (req, res) => {
    let database = 'ok';
    try {
      await db.query('SELECT 1');
    } catch {
      database = 'error';
    }
    res.status(database === 'ok' ? 200 : 503).json({
      data: { status: database === 'ok' ? 'ok' : 'degraded', database, time: new Date().toISOString(), version: '0.1.0' },
    });
  });

  app.use('/api/auth', require('./modules/auth/auth.routes').router);
  app.use('/api/users', require('./modules/users/users.routes').router);
  app.use('/api/org', require('./modules/org/org.routes').router);
  app.use('/api/dashboard', require('./modules/dashboard/dashboard.routes').router);
  app.use('/api/integrations', require('./modules/integrations/integrations.routes').router);
  app.use('/api/products', require('./modules/products/products.routes').router);
  app.use('/api/inventory', require('./modules/inventory/inventory.routes').router);
  app.use('/api/pos', require('./modules/pos/pos.routes').router);
  app.use('/api/accounting', require('./modules/accounting').router);

  // Planned modules: URL + permission contract fixed now, implementation in later phases.
  const stubs = [
    { path: 'inbox', name: 'inbox', phase: 4, permission: 'inbox:read', integrations: ['anthropic', 'meta', 'line', 'shopee', 'tiktok_shop'] },
    { path: 'scraping', name: 'scraping', phase: 5, permission: 'scraping:read', integrations: ['tiktok_shop', 'shopee', 'shopee_affiliate', 'apify'] },
    { path: 'videos', name: 'video', phase: 6, permission: 'video:create', integrations: ['anthropic', 'elevenlabs', 'heygen', 'shotstack', 'r2'] },
    { path: 'social', name: 'social', phase: 7, permission: 'social:read', integrations: ['tiktok', 'meta', 'shopee_affiliate'] },
  ];
  for (const s of stubs) app.use(`/api/${s.path}`, moduleStub(s));

  app.use('/internal', require('./routes/internal').router);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}

module.exports = { createApp };
