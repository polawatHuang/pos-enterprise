'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { z } = require('zod');

// Local development: load backend/.env if present. On Plesk, variables are set in
// the Node.js panel ("Custom environment variables") and no .env file is needed.
const envFile = path.join(__dirname, '..', '..', '.env');
if (fs.existsSync(envFile) && typeof process.loadEnvFile === 'function') {
  process.loadEnvFile(envFile);
}

const bool = (def) =>
  z
    .enum(['true', 'false', '1', '0'])
    .default(def ? 'true' : 'false')
    .transform((v) => v === 'true' || v === '1');

const schema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  TRUST_PROXY: z.string().default('1'),

  DB_HOST: z.string().default('127.0.0.1'),
  DB_PORT: z.coerce.number().int().default(3306),
  DB_USER: z.string().min(1),
  DB_PASSWORD: z.string().default(''),
  DB_NAME: z.string().min(1),
  // Shared hosting limits concurrent MySQL connections per user; keep this small.
  DB_CONNECTION_LIMIT: z.coerce.number().int().positive().default(5),

  JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be at least 32 characters'),
  ACCESS_TOKEN_TTL_SEC: z.coerce.number().int().positive().default(900),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(14),

  // Comma-separated. Entries may contain "*" wildcards, e.g. https://*.vercel.app
  CORS_ORIGINS: z.string().default('http://localhost:3000'),
  COOKIE_DOMAIN: z.string().optional(),
  COOKIE_SAMESITE: z.enum(['lax', 'strict', 'none']).default('lax'),
  COOKIE_SECURE: bool(true),

  CRON_SECRET: z.string().min(16, 'CRON_SECRET must be at least 16 characters'),
  // 32 bytes, base64 — used to encrypt third-party OAuth tokens at rest
  APP_ENCRYPTION_KEY: z.string().optional(),
  // Business timezone offset used for "today"/"this month" in reports (no tz tables needed)
  APP_TZ_OFFSET: z
    .string()
    .regex(/^[+-]\d{2}:\d{2}$/)
    .default('+07:00'),
  // Public HTTPS origin of this API (e.g. https://api.example.com), shown as the webhook URL to paste
  // into LINE/Meta consoles. Needed because browsers reach the API through the Vercel rewrite.
  PUBLIC_API_URL: z.string().url().optional(),
  // Public origin of the web app (Vercel). OAuth callbacks redirect back here; defaults to the first CORS origin.
  APP_PUBLIC_URL: z.string().url().optional(),
  // Apply new files in database/migrations when the app starts (no phpMyAdmin import needed)
  AUTO_MIGRATE: bool(true),
  // "cron" = shared hosting (external trigger); "inprocess" = VPS with a long-running worker
  JOB_RUNNER: z.enum(['cron', 'inprocess']).default('cron'),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  const lines = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`);
  // eslint-disable-next-line no-console
  console.error(`Invalid environment configuration:\n${lines.join('\n')}`);
  throw Object.assign(new Error('Invalid environment configuration'), {
    issues: parsed.error.issues.map((i) => ({ name: i.path.join('.'), problem: process.env[i.path.join('.')] === undefined ? 'ยังไม่ได้ตั้งค่า' : i.message })),
  });
}

const env = parsed.data;

// Refuse to boot in production with the placeholder secrets from .env.example
if (env.NODE_ENV === 'production') {
  const weak = ['JWT_ACCESS_SECRET', 'CRON_SECRET'].filter((k) => /change-me|dev-only/i.test(env[k]));
  if (weak.length) {
    throw Object.assign(new Error(`Replace placeholder secrets before running in production: ${weak.join(', ')}`), {
      issues: weak.map((name) => ({ name, problem: 'ยังเป็นค่าตัวอย่างจาก .env.example ต้องสุ่มค่าใหม่' })),
    });
  }
}
env.isProd = env.NODE_ENV === 'production';
env.isTest = env.NODE_ENV === 'test';
env.corsOrigins = env.CORS_ORIGINS.split(',')
  .map((s) => s.trim())
  .filter(Boolean);

module.exports = env;
