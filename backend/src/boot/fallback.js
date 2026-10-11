'use strict';

/**
 * Boot failure fallback. When app.js cannot start (missing env vars, dependencies not installed),
 * Passenger on shared hosting only shows a generic 500 page. Instead we serve a 503 JSON that names
 * what is wrong — variable/package NAMES only, never values. Uses node:http only, because the
 * failure may be that node_modules is missing.
 */
/* eslint-disable no-console -- the logger may be the thing that failed to load */
const http = require('node:http');

/** @returns {{ code: string, message: string, missing?: string[], issues?: {name: string, problem: string}[] }} */
function describeBootError(err) {
  if (err?.code === 'MODULE_NOT_FOUND') {
    const name = /Cannot find module '([^']+)'/.exec(String(err.message))?.[1] ?? 'unknown';
    // Only report package names, not absolute paths on the server
    const pkg = name.startsWith('.') || name.startsWith('/') ? 'a local file' : name;
    return {
      code: 'DEPENDENCIES_MISSING',
      message: `ไม่พบแพ็กเกจ ${pkg} — กด "NPM install" ในหน้า Node.js ของ Plesk แล้ว Restart App`,
      missing: [pkg],
    };
  }
  if (Array.isArray(err?.issues)) {
    const issues = err.issues.map((i) => ({ name: String(i.name), problem: String(i.problem) }));
    return {
      code: 'MISCONFIGURED',
      message: 'ตั้งค่า environment variables ไม่ครบหรือไม่ถูกต้อง — เพิ่มใน Plesk → Node.js → Custom environment variables แล้ว Restart App',
      missing: issues.map((i) => i.name),
      issues,
    };
  }
  return { code: 'BOOT_FAILED', message: 'เริ่มระบบไม่สำเร็จ ดูรายละเอียดใน Logs ของโดเมน (Plesk → Logs)' };
}

function startFallbackServer(err, port = Number(process.env.PORT) || 4000) {
  const body = JSON.stringify({ error: describeBootError(err) });
  console.error('Boot failed, serving 503 diagnostics:', err);
  const server = http.createServer((req, res) => {
    res.writeHead(503, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    res.end(body);
  });
  server.listen(port);
  return server;
}

module.exports = { describeBootError, startFallbackServer };
