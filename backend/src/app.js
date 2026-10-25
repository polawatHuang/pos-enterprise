'use strict';

const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const env = require('./config/env');
const db = require('./db/pool');
const runtime = require('./config/runtime');
const { queueHealth } = require('./jobs/queue');
const { notFoundHandler, errorHandler } = require('./core/http');

/** "https://*.vercel.app" -> /^https:\/\/[^.]+\.vercel\.app$/ */
function originMatcher(patterns) {
  const regexes = patterns.map((p) => new RegExp(`^${p.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^.]+')}$`));
  return (origin) => regexes.some((r) => r.test(origin));
}

/** What to check for common MySQL connection errors (shown by /api/health). */
const DB_HINTS = {
  ER_ACCESS_DENIED_ERROR: 'DB_USER หรือ DB_PASSWORD ไม่ถูกต้อง หรือ user ยังไม่มีสิทธิ์ในฐานข้อมูลนี้ — ตรวจใน Plesk → Databases → User Management',
  ER_DBACCESS_DENIED_ERROR: 'user นี้ไม่มีสิทธิ์เข้าฐานข้อมูล DB_NAME — ผูก user กับฐานข้อมูลใน Plesk → Databases',
  ER_BAD_DB_ERROR: 'ไม่พบฐานข้อมูลตาม DB_NAME — ใส่ชื่อเต็มรวม prefix ตามที่แสดงใน Plesk → Databases',
  ECONNREFUSED: 'ต่อ MySQL ไม่ได้ — ใช้ DB_HOST=localhost (หรือ 127.0.0.1) และ DB_PORT=3306',
  ENOTFOUND: 'ไม่พบ host ตาม DB_HOST — ใช้ DB_HOST=localhost',
  ETIMEDOUT: 'เชื่อมต่อ MySQL หมดเวลา — ตรวจ DB_HOST/DB_PORT',
  ER_CON_COUNT_ERROR: 'การเชื่อมต่อ MySQL เต็ม — ลด DB_CONNECTION_LIMIT (เช่น 5) แล้ว Restart App',
  UNKNOWN: 'ตรวจค่า DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_NAME แล้ว Restart App',
};

/** Automatic migrations: what is still missing and why (no secrets). */
function schemaHealth() {
  const { status } = require('./db/migrate');
  return { state: status.state, pending: status.pending, applied: status.applied, ...(status.error ? { error: status.error } : {}) };
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
  // Integration keys saved from the web UI (loaded before the first request, refreshed when stale)
  app.use(runtime.middleware);
  // Platform webhooks need the raw body for signature checks, so they go before the JSON parser.
  app.use('/webhooks', require('./modules/inbox/webhooks.routes').router);

  // Receipt photos for AI extraction are sent as base64 JSON; everything else stays small.
  const jsonSmall = express.json({ limit: '1mb' });
  const jsonLarge = express.json({ limit: '8mb' });
  // Image uploads (receipt photos, cover images) come as base64 JSON
  const LARGE_BODY = /^\/api\/(accounting\/ai\/extract-receipt|covers(\/\d+\/final)?)$/;
  app.use((req, res, next) => (LARGE_BODY.test(req.path) ? jsonLarge : jsonSmall)(req, res, next));
  app.use(cookieParser());

  app.get('/api/health', async (req, res) => {
    let database = 'ok';
    let dbError = null;
    try {
      await db.query('SELECT 1');
    } catch (err) {
      database = 'error';
      // Error code only (no host, user or message), so a misconfigured deploy can be fixed from this page
      dbError = typeof err?.code === 'string' ? err.code : 'UNKNOWN';
    }
    // Background queue: due jobs waiting > 3 min = the Plesk Scheduled Task (cron tick) is not running
    const jobs = database === 'ok' ? await queueHealth().catch(() => null) : null;
    res.status(database === 'ok' ? 200 : 503).json({
      data: {
        status: database === 'ok' ? 'ok' : 'degraded',
        database,
        ...(jobs ? { jobs } : {}),
        schema: schemaHealth(),
        ...(dbError ? { databaseError: dbError, hint: DB_HINTS[dbError] ?? DB_HINTS.UNKNOWN } : {}),
        time: new Date().toISOString(),
        version: '0.1.0',
      },
    });
  });

  app.use('/api/auth', require('./modules/auth/auth.routes').router);
  app.use('/api/users', require('./modules/users/users.routes').router);
  app.use('/api/audit', require('./modules/audit/audit.routes').router);
  app.use('/api/org', require('./modules/org/org.routes').router);
  app.use('/api/dashboard', require('./modules/dashboard/dashboard.routes').router);
  app.use('/api/integrations', require('./modules/integrations/integrations.routes').router);
  app.use('/api/products', require('./modules/products/products.routes').router);
  app.use('/api/inventory/expiry', require('./modules/inventory/expiry.routes').router);
  app.use('/api/inventory/counts', require('./modules/inventory/counts.routes').router);
  app.use('/api/inventory/welfare', require('./modules/inventory/welfare.routes').router);
  app.use('/api/inventory', require('./modules/inventory/inventory.routes').router);
  app.use('/api/purchasing/requests', require('./modules/purchasing/requests.routes').router);
  app.use('/api/purchasing', require('./modules/purchasing/purchasing.routes').router);
  app.use('/api/search', require('./modules/search/search.routes').router);
  app.use('/api/notifications', require('./modules/notifications/notifications.routes').router);
  app.use('/api/public/r', require('./modules/public/receipt.routes').router);
  app.use('/api/public/payments', require('./modules/public/payments.routes').router);
  app.use('/api/public/legal', require('./modules/public/legal.routes').router);
  app.use('/api/documents', require('./modules/documents-hub/hub.routes').router);
  app.use('/api/hr', require('./modules/hr').router);
  app.use('/api/pos', require('./modules/pos/pos.routes').router);
  app.use('/api/customers', require('./modules/customers/customers.routes').router);
  app.use('/api/accounting', require('./modules/accounting').router);
  app.use('/api/inbox', require('./modules/inbox/inbox.routes').router);
  app.use('/api/inbox', require('./modules/inbox/aftersales.routes').router);
  app.use('/api/scraping', require('./modules/scraping/scraping.routes').router);
  app.use('/api/videos', require('./modules/video/video.routes').router);
  app.use('/api/covers', require('./modules/covers/covers.routes').router);
  app.use('/api/media', require('./modules/video/media.routes').router);
  app.use('/api/social', require('./modules/social/social.routes').router);

  app.use('/internal', require('./routes/internal').router);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}

module.exports = { createApp };
