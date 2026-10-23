'use strict';

/**
 * Daily sales summary pushed to LINE OA (a Flex card in the style of LINE MAN's merchant report):
 * net sales vs yesterday / last week, bills, average bill, profit, payment methods, sales by hour,
 * branches, top products and the day's income/expenses. Sent once a day at the configured time.
 */
const db = require('../../db/pool');
const env = require('../../config/env');
const logger = require('../../core/logger');
const runtime = require('../../config/runtime');
const { localDate, localTime } = require('../../utils/dates');
const { notify } = require('../notifications/notify');

const TZ = env.APP_TZ_OFFSET;
const local = (col) => `CONVERT_TZ(${col}, '+00:00', '${TZ}')`;
const r2 = (n) => Math.round(Number(n) * 100) / 100;

const SETTINGS_KEY = 'notify.sales_daily';
const SENT_KEY = 'notify.sales_daily_on';
const DEFAULTS = { enabled: false, time: '18:00', to: [], branchId: null };

const METHODS = {
  cash: { label: 'เงินสด', color: '#00B14F' },
  promptpay: { label: 'PromptPay', color: '#1E88E5' },
  transfer: { label: 'โอนเงิน', color: '#7E57C2' },
  card: { label: 'บัตร', color: '#F4511E' },
  ewallet: { label: 'e-Wallet', color: '#00ACC1' },
  platform: { label: 'แพลตฟอร์ม', color: '#FB8C00' },
  cod: { label: 'เก็บปลายทาง', color: '#8D6E63' },
  other: { label: 'อื่นๆ', color: '#9E9E9E' },
};

const parse = (v) => {
  if (typeof v !== 'string') return v ?? null;
  try {
    return JSON.parse(v);
  } catch {
    return v;
  }
};

async function getSettings(orgId) {
  const row = await db.one('SELECT value FROM settings WHERE org_id = :orgId AND setting_key = :key', { orgId, key: SETTINGS_KEY });
  return { ...DEFAULTS, ...(parse(row?.value) ?? {}) };
}

async function saveSetting(orgId, key, value) {
  await db.query(
    `INSERT INTO settings (org_id, setting_key, value) VALUES (:orgId, :key, :value)
     ON DUPLICATE KEY UPDATE value = VALUES(value)`,
    { orgId, key, value: JSON.stringify(value) },
  );
}

/** Local date the report was last sent (or null). */
async function lastSentOn(orgId) {
  const row = await db.one('SELECT value FROM settings WHERE org_id = :orgId AND setting_key = :key', { orgId, key: SENT_KEY });
  return parse(row?.value) ?? null;
}

/** YYYY-MM-DD shifted by n days. */
const addDays = (ymd, n) => new Date(Date.parse(`${ymd}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/** Net sales of a local-time window [from, to): cancelled bills out, refunds taken off. */
async function salesWindow(orgId, branchId, from, to) {
  const r = await db.one(
    `SELECT COALESCE(SUM(CASE WHEN so.status = 'refunded' THEN 0 ELSE so.total - so.refunded_amount END), 0) AS net,
            COALESCE(SUM(CASE WHEN so.status = 'refunded' THEN 0 ELSE 1 END), 0) AS bills
       FROM sales_orders so
      WHERE so.org_id = :orgId AND (:branchId IS NULL OR so.branch_id = :branchId) AND so.status <> 'cancelled'
        AND ${local('so.ordered_at')} >= :from AND ${local('so.ordered_at')} < :to`,
    { orgId, branchId, from, to },
  );
  return { net: r2(r.net), bills: Number(r.bills) };
}

const pct = (now, before) => (before > 0 ? r2(((now - before) / before) * 100) : null);

/**
 * The report for local date `date`. For today it covers 00:00 up to `until` ("HH:MM") and compares
 * with yesterday and last week up to the same time; a past date covers the whole day.
 */
async function buildDailyReport(orgId, { date = localDate(), until = null, branchId = null } = {}) {
  const end = until ? `${date} ${until}:00` : `${addDays(date, 1)} 00:00:00`;
  const endOf = (d) => (until ? `${d} ${until}:00` : `${addDays(d, 1)} 00:00:00`);
  const from = `${date} 00:00:00`;
  const p = { orgId, branchId, from, to: end };
  const W = `so.org_id = :orgId AND (:branchId IS NULL OR so.branch_id = :branchId)
             AND ${local('so.ordered_at')} >= :from AND ${local('so.ordered_at')} < :to`;

  const [org, branch, main, cancelled, methods, hours, branches, top, returns, txns, yesterday, lastWeek] = await Promise.all([
    db.one('SELECT name FROM organizations WHERE id = :orgId', { orgId }),
    branchId ? db.one('SELECT name FROM branches WHERE id = :branchId AND org_id = :orgId', { branchId, orgId }) : null,
    db.one(
      `SELECT COALESCE(SUM(CASE WHEN so.status = 'refunded' THEN 0 ELSE so.total - so.refunded_amount END), 0) AS net,
              COALESCE(SUM(CASE WHEN so.status = 'refunded' THEN 0 ELSE 1 END), 0) AS bills,
              COALESCE(SUM(so.total), 0) AS gross,
              COALESCE(SUM(CASE WHEN so.status = 'refunded' OR so.total = 0 THEN 0
                           ELSE (so.total - so.shipping_fee - so.vat_amount - so.cost_total - so.platform_fee) * (1 - so.refunded_amount / so.total) END), 0) AS profit,
              COALESCE(SUM(so.promo_discount), 0) AS promo,
              COALESCE(SUM(so.discount), 0) AS bill_discount
         FROM sales_orders so WHERE ${W} AND so.status <> 'cancelled'`,
      p,
    ),
    db.one(`SELECT COUNT(*) AS n, COALESCE(SUM(so.total), 0) AS amount FROM sales_orders so WHERE ${W} AND so.status = 'cancelled'`, p),
    db.query(
      `SELECT pm.method, SUM(pm.amount) AS amount FROM payments pm JOIN sales_orders so ON so.id = pm.order_id
        WHERE ${W} AND so.status <> 'cancelled' GROUP BY pm.method HAVING SUM(pm.amount) > 0 ORDER BY amount DESC`,
      p,
    ),
    db.query(
      `SELECT HOUR(${local('so.ordered_at')}) AS h, SUM(CASE WHEN so.status = 'refunded' THEN 0 ELSE so.total - so.refunded_amount END) AS amount
         FROM sales_orders so WHERE ${W} AND so.status <> 'cancelled' GROUP BY h ORDER BY h`,
      p,
    ),
    db.query(
      `SELECT b.id, b.name, SUM(CASE WHEN so.status = 'refunded' THEN 0 ELSE so.total - so.refunded_amount END) AS net, COUNT(*) AS bills
         FROM sales_orders so JOIN branches b ON b.id = so.branch_id
        WHERE ${W} AND so.status <> 'cancelled' GROUP BY b.id, b.name ORDER BY net DESC`,
      p,
    ),
    db.query(
      `SELECT i.name, SUM(i.quantity - i.returned_qty) AS qty, SUM(i.line_total * (i.quantity - i.returned_qty) / i.quantity) AS amount
         FROM sales_order_items i JOIN sales_orders so ON so.id = i.order_id
        WHERE ${W} AND so.status NOT IN ('cancelled','refunded') AND i.quantity > 0
        GROUP BY i.product_id, i.name HAVING qty > 0 ORDER BY amount DESC LIMIT 5`,
      p,
    ),
    db
      .one(
        `SELECT COUNT(*) AS n, COALESCE(SUM(r.refund_amount), 0) AS amount FROM sales_returns r JOIN sales_orders so ON so.id = r.order_id
          WHERE r.org_id = :orgId AND (:branchId IS NULL OR so.branch_id = :branchId) AND r.voided_at IS NULL
            AND ${local('r.created_at')} >= :from AND ${local('r.created_at')} < :to`,
        p,
      )
      .catch(() => ({ n: 0, amount: 0 })), // sales_returns before migration 016/020
    db.one(
      `SELECT COALESCE(SUM(CASE WHEN type = 'income' THEN amount END), 0) AS income,
              COALESCE(SUM(CASE WHEN type = 'expense' THEN amount END), 0) AS expense
         FROM transactions WHERE org_id = :orgId AND (:branchId IS NULL OR branch_id = :branchId) AND status = 'posted' AND txn_date = :date`,
      { orgId, branchId, date },
    ),
    salesWindow(orgId, branchId, `${addDays(date, -1)} 00:00:00`, endOf(addDays(date, -1))),
    salesWindow(orgId, branchId, `${addDays(date, -7)} 00:00:00`, endOf(addDays(date, -7))),
  ]);

  const net = r2(main.net);
  const bills = Number(main.bills);
  const methodTotal = methods.reduce((s, m) => s + Number(m.amount), 0);
  const income = r2(txns.income);
  const expense = r2(txns.expense);
  return {
    shopName: org?.name ?? 'ร้านของฉัน',
    branchName: branch?.name ?? null,
    date,
    until,
    net,
    bills,
    avgBill: bills ? r2(net / bills) : 0,
    profit: r2(main.profit),
    promoDiscount: r2(main.promo),
    billDiscount: r2(main.bill_discount),
    vsYesterday: { net: yesterday.net, pct: pct(net, yesterday.net) },
    vsLastWeek: { net: lastWeek.net, pct: pct(net, lastWeek.net) },
    cancelled: { count: Number(cancelled.n), amount: r2(cancelled.amount) },
    refunds: { count: Number(returns.n), amount: r2(returns.amount) },
    methods: methods.map((m) => ({
      method: m.method,
      label: METHODS[m.method]?.label ?? m.method,
      color: METHODS[m.method]?.color ?? '#9E9E9E',
      amount: r2(m.amount),
      share: methodTotal ? r2((Number(m.amount) / methodTotal) * 100) : 0,
    })),
    hours: hours.map((h) => ({ hour: Number(h.h), amount: r2(h.amount) })),
    branches: branches.map((b) => ({ id: b.id, name: b.name, net: r2(b.net), bills: Number(b.bills) })),
    topProducts: top.map((t) => ({ name: t.name, qty: Number(t.qty), amount: r2(t.amount) })),
    income,
    expense,
    // what is left from the day: net sales + other income - expenses
    balance: r2(net + income - expense),
  };
}

/* ------------------------------------------------------------------ Flex */

const THAI_MONTHS = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
const THAI_DAYS = ['อาทิตย์', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์'];
function thaiDate(ymd) {
  const [y, m, d] = ymd.split('-').map(Number);
  const wd = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return `วัน${THAI_DAYS[wd]}ที่ ${d} ${THAI_MONTHS[m - 1]} ${y + 543}`;
}
const money = (n) => `฿${Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const short = (n) => `฿${Number(n).toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
const clip = (s, n) => (String(s).length > n ? `${String(s).slice(0, n - 1)}…` : String(s));

const GREEN = '#00B14F';
const RED = '#E53935';
const GREY = '#8C8C8C';
const INK = '#1F2328';
const SOFT = '#F4F6F8';

const txt = (text, o = {}) => ({ type: 'text', text: String(text), size: 'sm', color: INK, wrap: false, ...o });
const box = (layout, contents, o = {}) => ({ type: 'box', layout, contents, ...o });
const sep = (margin = 'lg') => ({ type: 'separator', margin, color: '#E6E8EB' });
const title = (t) => txt(t, { weight: 'bold', size: 'sm', color: INK, margin: 'xl' });
const row = (label, value, o = {}) =>
  box('horizontal', [txt(label, { color: GREY, flex: 3, ...o.label }), txt(value, { align: 'end', flex: 4, ...o.value })], { margin: 'sm' });

function change(label, c) {
  if (c.pct == null) return txt(`${label}: ยังไม่มีข้อมูลเปรียบเทียบ`, { size: 'xs', color: GREY });
  const up = c.pct >= 0;
  return box('baseline', [
    txt(`${up ? '▲' : '▼'} ${Math.abs(c.pct).toFixed(1)}%`, { size: 'xs', weight: 'bold', color: up ? GREEN : RED, flex: 0 }),
    txt(`${label} (${short(c.net)})`, { size: 'xs', color: GREY, margin: 'sm' }),
  ]);
}

function stat(label, value) {
  return box('vertical', [txt(label, { size: 'xxs', color: GREY }), txt(value, { size: 'md', weight: 'bold', margin: 'xs' })], {
    backgroundColor: SOFT,
    cornerRadius: '10px',
    paddingAll: '10px',
    flex: 1,
  });
}

/** A horizontal bar: `share` percent filled. */
const bar = (share, color) =>
  box('horizontal', [box('vertical', [], { width: `${Math.max(2, Math.min(100, share))}%`, backgroundColor: color, height: '6px', cornerRadius: '3px' })], {
    backgroundColor: '#EDEFF2',
    height: '6px',
    cornerRadius: '3px',
    margin: 'xs',
  });

function hourChart(hours) {
  if (!hours.length) return null;
  const first = Math.min(...hours.map((h) => h.hour));
  const last = Math.max(...hours.map((h) => h.hour));
  const lo = Math.max(0, Math.min(first, last - 5));
  const hi = Math.min(23, Math.max(last, lo + 5));
  const max = Math.max(...hours.map((h) => h.amount), 1);
  const peak = hours.reduce((a, b) => (b.amount > a.amount ? b : a));
  const cols = [];
  for (let h = lo; h <= hi; h++) {
    const amount = hours.find((x) => x.hour === h)?.amount ?? 0;
    const height = Math.max(4, Math.round((amount / max) * 56));
    cols.push(
      box(
        'vertical',
        [
          box('vertical', [], { flex: 1 }),
          box('vertical', [], { height: `${height}px`, backgroundColor: h === peak.hour ? GREEN : '#A5D6A7', cornerRadius: '2px' }),
          txt(String(h), { size: 'xxs', color: GREY, align: 'center', margin: 'xs' }),
        ],
        { flex: 1, height: '76px', paddingStart: '1px', paddingEnd: '1px' },
      ),
    );
  }
  return [
    title(`ช่วงเวลาขายดี · พีค ${String(peak.hour).padStart(2, '0')}:00–${String(peak.hour + 1).padStart(2, '0')}:00`),
    box('horizontal', cols, { margin: 'md' }),
  ];
}

/** The LINE Flex message for a report (one "giga" bubble, well under LINE's size limits). */
function renderFlex(report, { appUrl = null, scheduleTime = null } = {}) {
  const r = report;
  const body = [
    txt('ยอดขายสุทธิ', { size: 'xs', color: GREY }),
    txt(money(r.net), { size: '3xl', weight: 'bold', margin: 'xs' }),
    box('vertical', [change(r.until ? 'เทียบเมื่อวานเวลาเดียวกัน' : 'เทียบเมื่อวาน', r.vsYesterday), change('เทียบสัปดาห์ก่อน', r.vsLastWeek)], {
      margin: 'sm',
      spacing: 'xs',
    }),
    box('horizontal', [stat('บิล', r.bills.toLocaleString('en-US')), stat('เฉลี่ย/บิล', short(r.avgBill)), stat('กำไรขั้นต้น', short(r.profit))], {
      margin: 'lg',
      spacing: 'sm',
    }),
  ];

  if (!r.bills) {
    body.push(txt(r.until ? 'วันนี้ยังไม่มียอดขาย' : 'วันนี้ไม่มียอดขาย', { color: GREY, align: 'center', margin: 'xl' }));
  }

  if (r.methods.length) {
    body.push(sep('xl'), title('ช่องทางชำระเงิน'));
    for (const m of r.methods.slice(0, 6)) {
      body.push(
        box('vertical', [
          box('horizontal', [txt(m.label, { flex: 3 }), txt(`${money(m.amount)}  ${m.share.toFixed(0)}%`, { align: 'end', flex: 5, color: GREY, size: 'xs' })]),
          bar(m.share, m.color),
        ], { margin: 'md' }),
      );
    }
  }

  const chart = hourChart(r.hours);
  if (chart) body.push(sep('xl'), ...chart);

  if (r.branches.length > 1) {
    body.push(sep('xl'), title('แยกตามสาขา'));
    const maxB = Math.max(...r.branches.map((b) => b.net), 1);
    for (const b of r.branches.slice(0, 6)) {
      body.push(
        box('vertical', [
          box('horizontal', [txt(clip(b.name, 22), { flex: 4 }), txt(`${money(b.net)} · ${b.bills} บิล`, { align: 'end', flex: 5, size: 'xs', color: GREY })]),
          bar((b.net / maxB) * 100, '#26A69A'),
        ], { margin: 'md' }),
      );
    }
  }

  if (r.topProducts.length) {
    body.push(sep('xl'), title('สินค้าขายดี'));
    r.topProducts.forEach((t, i) => {
      body.push(
        box('horizontal', [
          txt(String(i + 1), { flex: 0, size: 'xs', weight: 'bold', color: i === 0 ? GREEN : GREY }),
          txt(clip(t.name, 28), { flex: 6, margin: 'md' }),
          txt(`×${t.qty.toLocaleString('en-US')}`, { flex: 2, align: 'end', size: 'xs', color: GREY }),
          txt(short(t.amount), { flex: 3, align: 'end' }),
        ], { margin: 'sm' }),
      );
    });
  }

  body.push(
    sep('xl'),
    title('รายรับ-รายจ่ายวันนี้'),
    row('ยอดขายสุทธิ', money(r.net)),
    row('รายรับอื่น', money(r.income)),
    row('รายจ่าย', `-${money(r.expense)}`, { value: { color: r.expense ? RED : INK } }),
  );
  if (r.promoDiscount) body.push(row('ส่วนลดโปรโมชั่น', money(r.promoDiscount), { value: { color: GREY } }));
  if (r.refunds.count) body.push(row(`คืนสินค้า ${r.refunds.count} รายการ`, `-${money(r.refunds.amount)}`, { value: { color: GREY } }));
  if (r.cancelled.count) body.push(row(`ยกเลิกบิล ${r.cancelled.count} ใบ`, money(r.cancelled.amount), { value: { color: GREY } }));
  body.push(
    box('horizontal', [txt('คงเหลือสุทธิ', { weight: 'bold', flex: 3 }), txt(money(r.balance), { weight: 'bold', align: 'end', flex: 4, color: r.balance >= 0 ? GREEN : RED })], {
      margin: 'md',
      paddingAll: '10px',
      backgroundColor: SOFT,
      cornerRadius: '8px',
    }),
  );

  const footer = [];
  if (appUrl) {
    footer.push({ type: 'button', style: 'primary', color: GREEN, height: 'sm', action: { type: 'uri', label: 'ดูรายงานเต็ม', uri: `${appUrl.replace(/\/+$/, '')}/dashboard` } });
  }
  footer.push(
    txt(scheduleTime ? `ส่งอัตโนมัติทุกวัน ${scheduleTime} น. · ปิดได้ที่ ตั้งค่า › แจ้งเตือน LINE` : 'POS Enterprise', {
      size: 'xxs',
      color: GREY,
      align: 'center',
      wrap: true,
      margin: 'md',
    }),
  );

  const arrow = r.vsYesterday.pct == null ? '' : ` (${r.vsYesterday.pct >= 0 ? '▲' : '▼'}${Math.abs(r.vsYesterday.pct).toFixed(0)}%)`;
  const [, m, d] = r.date.split('-').map(Number);
  return {
    type: 'flex',
    altText: clip(`สรุปยอดขาย ${d} ${THAI_MONTHS[m - 1]} ${money(r.net)}${arrow} · ${r.bills} บิล`, 400),
    contents: {
      type: 'bubble',
      size: 'giga',
      header: box(
        'vertical',
        [
          txt(clip(r.branchName ? `${r.shopName} · ${r.branchName}` : r.shopName, 40), { color: '#FFFFFF', weight: 'bold', size: 'md' }),
          txt(`สรุปยอดขาย${r.until ? ` (ถึง ${r.until} น.)` : 'ทั้งวัน'}`, { color: '#E8F5E9', size: 'xs', margin: 'xs' }),
          txt(thaiDate(r.date), { color: '#E8F5E9', size: 'xs' }),
        ],
        { backgroundColor: GREEN, paddingAll: '18px' },
      ),
      body: box('vertical', body, { paddingAll: '18px' }),
      footer: box('vertical', footer, { paddingAll: '14px', paddingTop: '0px' }),
      styles: { footer: { separator: false } },
    },
  };
}

/* ------------------------------------------------------------------ sending */

/** The shop's public web address for the "ดูรายงานเต็ม" button (APP_URL, else the first https CORS origin). */
function appUrl() {
  const set = runtime.get('APP_URL');
  if (set) return set;
  return env.corsOrigins.find((o) => o.startsWith('https://')) ?? null;
}

/** Push the report for `date` (default: today up to now) to the given LINE targets. */
async function sendReport(orgId, settings, { now = new Date(), push = null } = {}) {
  const { lineToken } = require('../inventory/alerts');
  const token = await lineToken(orgId);
  if (!token) throw new Error('ยังไม่ได้เชื่อม LINE OA (ตั้งค่าที่หน้า Inbox หรือ การเชื่อมต่อ API)');
  const report = await buildDailyReport(orgId, { date: localDate(now), until: localTime(now), branchId: settings.branchId ?? null });
  const message = renderFlex(report, { appUrl: appUrl(), scheduleTime: settings.time });
  const send = push ?? ((to, msgs) => require('../../integrations/line').pushMessages(token, to, msgs));
  let sent = 0;
  for (const to of settings.to) {
    await send(to, [message]);
    sent += 1;
  }
  return { sent, report };
}

/** Cron job (every few minutes): send today's report once, at or after the set time. */
async function runDue({ now = new Date(), push = null } = {}) {
  const orgs = await db.query('SELECT id FROM organizations');
  const out = {};
  for (const { id: orgId } of orgs) {
    const s = await getSettings(orgId);
    if (!s.enabled || !s.to.length || localTime(now) < s.time) continue;
    const today = localDate(now);
    if ((await lastSentOn(orgId)) === today) continue;
    // mark first: a failing LINE call must not resend every few minutes all evening
    await saveSetting(orgId, SENT_KEY, today);
    try {
      out[orgId] = (await sendReport(orgId, s, { now, push })).sent;
    } catch (err) {
      out[orgId] = 0;
      logger.warn({ err, orgId }, 'daily sales LINE report failed');
      await notify({
        orgId,
        type: 'line_report_failed',
        severity: 'warning',
        title: 'ส่งสรุปยอดขายทาง LINE ไม่สำเร็จ',
        body: String(err.message).slice(0, 250),
        link: '/settings/notifications',
        permission: 'settings:manage',
        refKey: `line-report-failed:${today}`,
      }).catch(() => {});
    }
  }
  return out;
}

module.exports = { buildDailyReport, renderFlex, sendReport, runDue, getSettings, saveSetting, lastSentOn, SETTINGS_KEY, SENT_KEY, DEFAULTS, addDays, appUrl };
