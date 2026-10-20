'use strict';

const db = require('../../db/pool');
const logger = require('../../core/logger');
const { localDate, localTime } = require('../../utils/dates');
const { notify } = require('../notifications/notify');
const { salesStats, daysCover } = require('./analytics');

/** Days-of-cover below this counts as "running out" even before the reorder point. */
const COVER_DAYS = 3;
const MAX_URGENT = 20;

// mysql2 may hand back JSON columns already decoded (a bare string) or as raw JSON text
const parse = (v) => {
  if (typeof v !== 'string') return v ?? null;
  try {
    return JSON.parse(v);
  } catch {
    return v;
  }
};

const LINE_DEFAULTS = { enabled: false, to: [], digestTime: '08:00' };

async function getLineSettings(orgId) {
  const row = await db.one("SELECT value FROM settings WHERE org_id = :orgId AND setting_key = 'notify.line'", { orgId });
  return { ...LINE_DEFAULTS, ...(parse(row?.value) ?? {}) };
}

async function saveSetting(orgId, key, value) {
  await db.query(
    `INSERT INTO settings (org_id, setting_key, value) VALUES (:orgId, :key, :value)
     ON DUPLICATE KEY UPDATE value = VALUES(value)`,
    { orgId, key, value: JSON.stringify(value) },
  );
}

/** Token of the org's active LINE OA (saved in Inbox settings, or LINE_CHANNEL_ACCESS_TOKEN). */
async function lineToken(orgId) {
  const ch = await db.one("SELECT * FROM channels WHERE org_id = :orgId AND platform = 'line' AND is_active = 1 ORDER BY id LIMIT 1", { orgId });
  if (!ch) return process.env.LINE_CHANNEL_ACCESS_TOKEN || null;
  return require('../inbox/inbox.service').channelToken(ch);
}

/** Push one text to every configured LINE target. Returns how many pushes succeeded. */
async function pushLine(orgId, text, settings = null) {
  const s = settings ?? (await getLineSettings(orgId));
  if (!s.enabled || !s.to.length) return 0;
  const token = await lineToken(orgId);
  if (!token) throw new Error('ยังไม่ได้เชื่อม LINE OA (ตั้งค่าที่หน้า Inbox)');
  const line = require('../../integrations/line');
  let sent = 0;
  for (const to of s.to) {
    await line.push(token, to, text);
    sent += 1;
  }
  return sent;
}

/**
 * Scan every warehouse of an org and raise:
 *  - out of stock (per product, once a day, pushed to LINE immediately) for items that sell or have a reorder point
 *  - running low (one roll-up per warehouse per day): at/below reorder point or under COVER_DAYS of sales left
 * plus a morning LINE digest (low, out, slow movers) at the configured time.
 */
async function checkOrg(orgId, { now = new Date() } = {}) {
  const today = localDate(now);
  const warehouses = await db.query('SELECT id, name FROM warehouses WHERE org_id = :orgId ORDER BY id', { orgId });
  const urgent = [];
  const digest = [];
  let outCount = 0;
  let lowCount = 0;
  let slowCount = 0;

  for (const wh of warehouses) {
    const rows = await db.query(
      `SELECT p.id, p.name, p.unit, COALESCE(sl.quantity, 0) AS qty, COALESCE(sl.reorder_point, p.reorder_point) AS reorder
         FROM products p
         LEFT JOIN stock_levels sl ON sl.product_id = p.id AND sl.variant_id = 0 AND sl.warehouse_id = :warehouseId
        WHERE p.org_id = :orgId AND p.status = 'active'
        ORDER BY p.id`,
      { orgId, warehouseId: wh.id },
    );
    const stats = await salesStats({ orgId, warehouseId: wh.id, sparkDays: 0 });
    const low = [];
    const out = [];
    for (const r of rows) {
      const qty = Number(r.qty);
      const reorder = Number(r.reorder);
      const st = stats.get(r.id);
      const avg = st?.avgDaily ?? 0;
      // Only items this warehouse actually stocks or sells are worth an alert
      const relevant = reorder > 0 || (st && st.sold28 > 0);
      if (!relevant) continue;
      if (qty <= 0) out.push({ ...r, avg });
      else if (qty <= reorder || (avg > 0 && qty / avg < COVER_DAYS)) low.push({ ...r, qty, avg, cover: daysCover(qty, avg) });
      else if (!st || st.sold28 === 0) slowCount += 1;
    }
    outCount += out.length;
    lowCount += low.length;

    for (const r of out.slice(0, MAX_URGENT)) {
      const created = await notify({
        orgId,
        type: 'stock.out',
        severity: 'danger',
        title: `สินค้าหมด: ${r.name}`,
        body: `${wh.name}${r.avg > 0 ? ` · ปกติขายวันละ ${r.avg.toFixed(1)} ${r.unit}` : ''}`,
        link: `/inventory?warehouseId=${wh.id}&status=out`,
        permission: 'inventory:read',
        refKey: `out:${wh.id}:${r.id}:${today}`,
      });
      if (created) urgent.push(`- ${r.name} (${wh.name})`);
    }
    if (low.length) {
      low.sort((a, b) => (a.cover ?? 999) - (b.cover ?? 999));
      await notify({
        orgId,
        type: 'stock.low',
        severity: 'warning',
        title: `สินค้าใกล้หมด ${low.length} รายการ · ${wh.name}`,
        body: low
          .slice(0, 6)
          .map((r) => `${r.name} เหลือ ${r.qty} ${r.unit}${r.cover != null ? ` (~${r.cover} วัน)` : ''}`)
          .join('\n'),
        link: `/inventory?warehouseId=${wh.id}&status=low`,
        permission: 'inventory:read',
        refKey: `low:${wh.id}:${today}`,
      });
      digest.push(
        `📦 ${wh.name}: ใกล้หมด ${low.length} รายการ`,
        ...low.slice(0, 5).map((r) => `  • ${r.name} เหลือ ${r.qty}${r.cover != null ? ` (~${r.cover} วัน)` : ''}`),
      );
    }
    if (out.length) digest.push(`⛔ ${wh.name}: หมด ${out.length} รายการ`);
  }

  // LINE: urgent out-of-stock right away, the roll-up once a day after the digest time
  let pushed = 0;
  let lineError = null;
  const line = await getLineSettings(orgId);
  if (line.enabled && line.to.length) {
    try {
      if (urgent.length) {
        const more = outCount > MAX_URGENT ? `\n...และอีก ${outCount - MAX_URGENT} รายการ` : '';
        pushed += await pushLine(orgId, `⚠️ สินค้าหมดสต๊อก\n${urgent.join('\n')}${more}`, line);
      }
      const sentOn = await db.one("SELECT value FROM settings WHERE org_id = :orgId AND setting_key = 'notify.line_digest_on'", { orgId });
      if (localTime(now) >= line.digestTime && parse(sentOn?.value) !== today) {
        const text = digest.length
          ? `สรุปสต๊อกเช้านี้ ${today}\n${digest.join('\n')}${slowCount ? `\n🐢 ไม่มียอดขาย 30 วัน: ${slowCount} รายการ` : ''}`
          : `สรุปสต๊อกเช้านี้ ${today}\n✅ สต๊อกพอขายทุกรายการ`;
        pushed += await pushLine(orgId, text, line);
        await saveSetting(orgId, 'notify.line_digest_on', today);
      }
    } catch (err) {
      lineError = err.message;
      logger.warn({ err, orgId }, 'stock alert LINE push failed');
    }
  }
  return { out: outCount, low: lowCount, slow: slowCount, newUrgent: urgent.length, pushed, lineError };
}

/** Job handler: every org (the cron tick runs this hourly). */
async function runAlerts() {
  const orgs = await db.query('SELECT id FROM organizations');
  const out = {};
  for (const o of orgs) out[o.id] = await checkOrg(o.id);
  return out;
}

module.exports = { checkOrg, runAlerts, getLineSettings, saveSetting, pushLine, LINE_DEFAULTS, COVER_DAYS };
