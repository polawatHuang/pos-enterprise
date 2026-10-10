'use strict';

const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const env = require('./config/env');
const db = require('./db/pool');
const { notFoundHandler, errorHandler } = require('./core/http');

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
  // Platform webhooks need the raw body for signature checks, so they go before the JSON parser.
  app.use('/webhooks', require('./modules/inbox/webhooks.routes').router);

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
  app.use('/api/inbox', require('./modules/inbox/inbox.routes').router);
  app.use('/api/inbox', require('./modules/inbox/aftersales.routes').router);
  app.use('/api/scraping', require('./modules/scraping/scraping.routes').router);
  app.use('/api/videos', require('./modules/video/video.routes').router);
  app.use('/api/social', require('./modules/social/social.routes').router);

  app.use('/internal', require('./routes/internal').router);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}

module.exports = { createApp };
