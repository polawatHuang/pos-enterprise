'use strict';

const express = require('express');
const { z } = require('zod');
const db = require('../../db/pool');
const env = require('../../config/env');
const { validate } = require('../../core/http');
const { requirePermission } = require('../../core/auth');
const { r2 } = require('./ledger.service');
const { money, sendCsv } = require('./csv');

const router = express.Router();
router.use(requirePermission('accounting:read'));

const range = z.object({ from: z.iso.date(), to: z.iso.date() });
const asOfQuery = z.object({ asOf: z.iso.date() });
const balanceSheetQuery = asOfQuery.extend({ compareTo: z.iso.date().optional() });

const TYPE_LABEL = { asset: 'สินทรัพย์', liability: 'หนี้สิน', equity: 'ส่วนของเจ้าของ', revenue: 'รายได้', expense: 'ค่าใช้จ่าย' };

/* ------------------------------------------------------------- report builders */

/** Profit & loss from the general ledger (posted journals, reversals included so voids net out). */
async function pnlReport(orgId, { from, to }) {
  const rows = await db.query(
    `SELECT a.code, a.name, a.type, COALESCE(SUM(l.debit), 0) AS dr, COALESCE(SUM(l.credit), 0) AS cr
       FROM journal_lines l
       JOIN journal_entries e ON e.id = l.entry_id
       JOIN chart_of_accounts a ON a.id = l.account_id
      WHERE e.org_id = :orgId AND e.status = 'posted' AND a.type IN ('revenue','expense')
        AND e.entry_date BETWEEN :from AND :to
      GROUP BY a.id, a.code, a.name, a.type
      ORDER BY a.code`,
    { orgId, from, to },
  );
  const lines = rows.map((r) => ({
    code: r.code,
    name: r.name,
    type: r.type,
    amount: r.type === 'revenue' ? r2(Number(r.cr) - Number(r.dr)) : r2(Number(r.dr) - Number(r.cr)),
  }));
  const revenue = lines.filter((l) => l.type === 'revenue');
  const cogs = lines.filter((l) => l.code === '5100');
  const expenses = lines.filter((l) => l.type === 'expense' && l.code !== '5100');
  const sum = (ls) => r2(ls.reduce((s, l) => s + l.amount, 0));
  const totalRevenue = sum(revenue);
  const grossProfit = r2(totalRevenue - sum(cogs));
  return {
    from,
    to,
    revenue,
    cogs,
    expenses,
    totals: { revenue: totalRevenue, cogs: sum(cogs), grossProfit, expenses: sum(expenses), netProfit: r2(grossProfit - sum(expenses)) },
  };
}

/** Trial balance as of a date: every account's cumulative debit/credit. Must always balance. */
async function trialBalanceReport(orgId, asOf) {
  const rows = await db.query(
    `SELECT a.code, a.name, a.type, COALESCE(SUM(l.debit), 0) AS dr, COALESCE(SUM(l.credit), 0) AS cr
       FROM chart_of_accounts a
       LEFT JOIN journal_lines l ON l.account_id = a.id
       LEFT JOIN journal_entries e ON e.id = l.entry_id
      WHERE a.org_id = :orgId AND (e.id IS NULL OR (e.status = 'posted' AND e.entry_date <= :asOf))
      GROUP BY a.id, a.code, a.name, a.type
     HAVING SUM(l.debit) <> 0 OR SUM(l.credit) <> 0
      ORDER BY a.code`,
    { orgId, asOf },
  );
  const accounts = rows.map((r) => {
    const bal = r2(Number(r.dr) - Number(r.cr));
    return { code: r.code, name: r.name, type: r.type, debit: bal > 0 ? bal : 0, credit: bal < 0 ? -bal : 0 };
  });
  const totalDebit = r2(accounts.reduce((s, a) => s + a.debit, 0));
  const totalCredit = r2(accounts.reduce((s, a) => s + a.credit, 0));
  return { asOf, accounts, totalDebit, totalCredit, balanced: totalDebit === totalCredit };
}

/**
 * Current vs. non-current by the Thai SME chart numbering (the chart has no grouping column):
 * 11xx–14xx current assets, 15xx+ non-current; 21xx–24xx current liabilities, 25xx+ non-current.
 */
const isCurrent = (type, code) => {
  const head = Number.parseInt(String(code).slice(0, 2), 10);
  if (Number.isNaN(head)) return true;
  return type === 'asset' ? head < 15 : head < 25;
};

/** Balances of balance-sheet accounts plus unclosed profit split at the fiscal-year start. */
async function ledgerPosition(orgId, asOf) {
  const yearStart = `${asOf.slice(0, 4)}-01-01`;
  const [accounts, profit] = await Promise.all([
    db.query(
      `SELECT a.code, a.name, a.type, COALESCE(SUM(l.debit), 0) AS dr, COALESCE(SUM(l.credit), 0) AS cr
         FROM journal_lines l
         JOIN journal_entries e ON e.id = l.entry_id
         JOIN chart_of_accounts a ON a.id = l.account_id
        WHERE e.org_id = :orgId AND e.status = 'posted' AND a.type IN ('asset','liability','equity') AND e.entry_date <= :asOf
        GROUP BY a.id, a.code, a.name, a.type`,
      { orgId, asOf },
    ),
    db.one(
      `SELECT COALESCE(SUM(CASE WHEN e.entry_date < :yearStart THEN l.credit - l.debit END), 0) AS prior,
              COALESCE(SUM(CASE WHEN e.entry_date >= :yearStart THEN l.credit - l.debit END), 0) AS current
         FROM journal_lines l
         JOIN journal_entries e ON e.id = l.entry_id
         JOIN chart_of_accounts a ON a.id = l.account_id
        WHERE e.org_id = :orgId AND e.status = 'posted' AND a.type IN ('revenue','expense') AND e.entry_date <= :asOf`,
      { orgId, asOf, yearStart },
    ),
  ]);
  const balances = new Map();
  for (const r of accounts) {
    // Natural sign: assets are debit balances, liabilities and equity credit balances
    const amount = r.type === 'asset' ? r2(Number(r.dr) - Number(r.cr)) : r2(Number(r.cr) - Number(r.dr));
    if (amount !== 0) balances.set(r.code, { code: r.code, name: r.name, type: r.type, amount });
  }
  return { yearStart, balances, priorProfit: r2(Number(profit.prior)), currentProfit: r2(Number(profit.current)) };
}

/**
 * Balance sheet (งบแสดงฐานะการเงิน) as of a date, optionally with a comparison date.
 * Equity = equity accounts + retained earnings not yet closed from earlier fiscal years + profit
 * of the current fiscal year to date (revenue − expense, fiscal year = calendar year).
 */
async function balanceSheetReport(orgId, asOf, compareTo) {
  const [cur, prev] = await Promise.all([ledgerPosition(orgId, asOf), compareTo ? ledgerPosition(orgId, compareTo) : null]);
  const codes = [...new Set([...cur.balances.keys(), ...(prev ? prev.balances.keys() : [])])].sort();
  const meta = (code) => cur.balances.get(code) ?? prev.balances.get(code);
  const line = (code) => {
    const m = meta(code);
    return { code, name: m.name, amount: cur.balances.get(code)?.amount ?? 0, previous: prev ? (prev.balances.get(code)?.amount ?? 0) : null };
  };
  const section = (lines) => ({
    lines,
    total: r2(lines.reduce((s, l) => s + l.amount, 0)),
    previousTotal: prev ? r2(lines.reduce((s, l) => s + l.previous, 0)) : null,
  });
  const group = (type) => {
    const lines = codes.filter((c) => meta(c).type === type).map(line);
    const current = section(lines.filter((l) => isCurrent(type, l.code)));
    const nonCurrent = section(lines.filter((l) => !isCurrent(type, l.code)));
    return {
      current,
      nonCurrent,
      total: r2(current.total + nonCurrent.total),
      previousTotal: prev ? r2(current.previousTotal + nonCurrent.previousTotal) : null,
    };
  };

  const assets = group('asset');
  const liabilities = group('liability');
  const equityLines = codes.filter((c) => meta(c).type === 'equity').map(line);
  const retained = { code: null, name: 'กำไร (ขาดทุน) สะสมที่ยังไม่ปิดบัญชีจากปีก่อน', amount: cur.priorProfit, previous: prev ? prev.priorProfit : null };
  const profit = { code: null, name: 'กำไร (ขาดทุน) สุทธิงวดปีปัจจุบัน', amount: cur.currentProfit, previous: prev ? prev.currentProfit : null };
  const equity = section([...equityLines, retained, profit]);
  const liabilitiesAndEquity = r2(liabilities.total + equity.total);
  const difference = r2(assets.total - liabilitiesAndEquity);

  let comparison = null;
  if (prev) {
    const prevLe = r2(liabilities.previousTotal + equity.previousTotal);
    const prevDiff = r2(assets.previousTotal - prevLe);
    comparison = { asOf: compareTo, difference: prevDiff, balanced: Math.abs(prevDiff) < 0.01 };
  }
  return {
    asOf,
    compareTo: compareTo ?? null,
    fiscalYearStart: cur.yearStart,
    assets,
    liabilities,
    equity: { lines: equityLines, retainedEarnings: retained, currentProfit: profit, total: equity.total, previousTotal: equity.previousTotal },
    totals: { assets: assets.total, liabilities: liabilities.total, equity: equity.total, liabilitiesAndEquity },
    difference,
    balanced: Math.abs(difference) < 0.01,
    comparison,
  };
}

/** Journal entries (newest first) with their lines; omit limit for every entry in the range. */
async function journalEntries(orgId, { from, to, limit, offset = 0 }) {
  const params = { orgId, from: from ?? null, to: to ?? null, limit: limit ?? null, offset };
  const where = 'e.org_id = :orgId AND (:from IS NULL OR e.entry_date >= :from) AND (:to IS NULL OR e.entry_date <= :to)';
  const entries = await db.query(
    `SELECT e.id, e.entry_no, DATE_FORMAT(e.entry_date, '%Y-%m-%d') AS entry_date, e.description, e.ref_type, e.ref_id, e.status
       FROM journal_entries e WHERE ${where} ORDER BY e.entry_date DESC, e.id DESC${limit ? ' LIMIT :limit OFFSET :offset' : ''}`,
    params,
  );
  const total = await db.one(`SELECT COUNT(*) AS n FROM journal_entries e WHERE ${where}`, params);
  const ids = entries.map((e) => e.id);
  const lines = ids.length
    ? await db.query(
        `SELECT l.entry_id, a.code, a.name, l.debit, l.credit FROM journal_lines l JOIN chart_of_accounts a ON a.id = l.account_id
          WHERE l.entry_id IN (:ids) ORDER BY l.entry_id, l.debit DESC, l.id`,
        { ids },
      )
    : [];
  const byEntry = new Map();
  for (const l of lines) {
    if (!byEntry.has(l.entry_id)) byEntry.set(l.entry_id, []);
    byEntry.get(l.entry_id).push({ code: l.code, name: l.name, debit: Number(l.debit), credit: Number(l.credit) });
  }
  return {
    total: Number(total.n),
    entries: entries.map((e) => ({
      id: e.id,
      entryNo: e.entry_no,
      date: e.entry_date,
      description: e.description,
      refType: e.ref_type,
      refId: e.ref_id,
      status: e.status,
      lines: byEntry.get(e.id) ?? [],
    })),
  };
}

/* ------------------------------------------------------------------- JSON */

router.get('/pnl', validate({ query: range }), async (req, res) => {
  res.json({ data: await pnlReport(req.user.orgId, req.valid.query) });
});

router.get('/trial-balance', validate({ query: asOfQuery }), async (req, res) => {
  res.json({ data: await trialBalanceReport(req.user.orgId, req.valid.query.asOf) });
});

router.get('/balance-sheet', validate({ query: balanceSheetQuery }), async (req, res) => {
  const { asOf, compareTo } = req.valid.query;
  res.json({ data: await balanceSheetReport(req.user.orgId, asOf, compareTo) });
});

/** General journal (สมุดรายวันทั่วไป), newest first, optionally limited to a date range. */
router.get(
  '/journal',
  validate({
    query: range.partial().extend({
      page: z.coerce.number().int().min(1).default(1),
      pageSize: z.coerce.number().int().min(1).max(100).default(20),
    }),
  }),
  async (req, res) => {
    const f = req.valid.query;
    const { entries, total } = await journalEntries(req.user.orgId, { from: f.from, to: f.to, limit: f.pageSize, offset: (f.page - 1) * f.pageSize });
    res.json({ data: entries, meta: { page: f.page, pageSize: f.pageSize, total } });
  },
);

/* -------------------------------------------------------------------- CSV */

router.get('/pnl.csv', validate({ query: range }), async (req, res) => {
  const d = await pnlReport(req.user.orgId, req.valid.query);
  const rows = [['หมวด', 'รหัสบัญชี', 'ชื่อบัญชี', 'จำนวนเงิน']];
  const block = (title, lines, totalLabel, total) => {
    for (const l of lines) rows.push([title, l.code, l.name, money(l.amount)]);
    if (totalLabel) rows.push([totalLabel, '', '', money(total)]);
  };
  block('รายได้', d.revenue, 'รวมรายได้', d.totals.revenue);
  block('ต้นทุนขาย', d.cogs, 'รวมต้นทุนขาย', d.totals.cogs);
  rows.push(['กำไรขั้นต้น', '', '', money(d.totals.grossProfit)]);
  block('ค่าใช้จ่ายในการขายและบริหาร', d.expenses, 'รวมค่าใช้จ่าย', d.totals.expenses);
  rows.push([d.totals.netProfit >= 0 ? 'กำไรสุทธิ' : 'ขาดทุนสุทธิ', '', '', money(d.totals.netProfit)]);
  sendCsv(res, `pnl-${d.from}-${d.to}.csv`, rows);
});

router.get('/trial-balance.csv', validate({ query: asOfQuery }), async (req, res) => {
  const d = await trialBalanceReport(req.user.orgId, req.valid.query.asOf);
  const rows = [
    ['รหัสบัญชี', 'ชื่อบัญชี', 'ประเภท', 'เดบิต', 'เครดิต'],
    ...d.accounts.map((a) => [a.code, a.name, TYPE_LABEL[a.type] ?? a.type, a.debit ? money(a.debit) : '', a.credit ? money(a.credit) : '']),
    ['รวม', '', '', money(d.totalDebit), money(d.totalCredit)],
  ];
  sendCsv(res, `trial-balance-${d.asOf}.csv`, rows);
});

router.get('/balance-sheet.csv', validate({ query: balanceSheetQuery }), async (req, res) => {
  const { asOf, compareTo } = req.valid.query;
  const d = await balanceSheetReport(req.user.orgId, asOf, compareTo);
  const cmp = Boolean(d.compareTo);
  const row = (group, code, name, amount, previous) =>
    cmp ? [group, code ?? '', name, money(amount), money(previous)] : [group, code ?? '', name, money(amount)];
  const rows = [
    cmp ? ['หมวด', 'รหัสบัญชี', 'ชื่อบัญชี', `ณ วันที่ ${d.asOf}`, `ณ วันที่ ${d.compareTo}`] : ['หมวด', 'รหัสบัญชี', 'ชื่อบัญชี', `ณ วันที่ ${d.asOf}`],
  ];
  const section = (group, s, totalLabel) => {
    for (const l of s.lines) rows.push(row(group, l.code, l.name, l.amount, l.previous));
    rows.push(row(totalLabel, '', '', s.total, s.previousTotal));
  };
  section('สินทรัพย์หมุนเวียน', d.assets.current, 'รวมสินทรัพย์หมุนเวียน');
  section('สินทรัพย์ไม่หมุนเวียน', d.assets.nonCurrent, 'รวมสินทรัพย์ไม่หมุนเวียน');
  rows.push(row('รวมสินทรัพย์', '', '', d.assets.total, d.assets.previousTotal));
  section('หนี้สินหมุนเวียน', d.liabilities.current, 'รวมหนี้สินหมุนเวียน');
  section('หนี้สินไม่หมุนเวียน', d.liabilities.nonCurrent, 'รวมหนี้สินไม่หมุนเวียน');
  rows.push(row('รวมหนี้สิน', '', '', d.liabilities.total, d.liabilities.previousTotal));
  section('ส่วนของเจ้าของ', { ...d.equity, lines: [...d.equity.lines, d.equity.retainedEarnings, d.equity.currentProfit] }, 'รวมส่วนของเจ้าของ');
  rows.push(row('รวมหนี้สินและส่วนของเจ้าของ', '', '', d.totals.liabilitiesAndEquity, cmp ? r2(d.liabilities.previousTotal + d.equity.previousTotal) : null));
  rows.push(
    cmp ? ['ผลต่าง (ต้องเป็นศูนย์)', '', '', money(d.difference), money(d.comparison.difference)] : ['ผลต่าง (ต้องเป็นศูนย์)', '', '', money(d.difference)],
  );
  sendCsv(res, `balance-sheet-${d.asOf}.csv`, rows);
});

/** Every journal line in a date range (one CSV row per line), oldest first for bookkeeping. */
router.get('/journal.csv', validate({ query: range }), async (req, res) => {
  const { from, to } = req.valid.query;
  const { entries } = await journalEntries(req.user.orgId, { from, to });
  const rows = [['เลขที่รายการ', 'วันที่', 'คำอธิบาย', 'อ้างอิง', 'สถานะ', 'รหัสบัญชี', 'ชื่อบัญชี', 'เดบิต', 'เครดิต']];
  for (const e of entries.reverse()) {
    const ref = e.refType ? `${e.refType}${e.refId ? ` #${e.refId}` : ''}` : '';
    for (const l of e.lines)
      rows.push([e.entryNo, e.date, e.description, ref, e.status, l.code, l.name, l.debit ? money(l.debit) : '', l.credit ? money(l.credit) : '']);
  }
  sendCsv(res, `journal-${from}-${to}.csv`, rows);
});

/* --------------------------------------------------------------- overview */

/** Overview numbers for the accounting landing page (business-timezone month). */
router.get('/overview', async (req, res) => {
  const TZ = env.APP_TZ_OFFSET;
  const params = { orgId: req.user.orgId };
  const monthStart = `DATE_FORMAT(CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', '${TZ}'), '%Y-%m-01')`;
  const [ledger, receivable, wht] = await Promise.all([
    db.one(
      `SELECT COALESCE(SUM(CASE WHEN a.type = 'revenue' THEN l.credit - l.debit END), 0) AS revenue,
              COALESCE(SUM(CASE WHEN a.type = 'expense' THEN l.debit - l.credit END), 0) AS expense,
              COALESCE(SUM(CASE WHEN a.code = '2200' THEN l.credit - l.debit END), 0) AS output_vat,
              COALESCE(SUM(CASE WHEN a.code = '1400' THEN l.debit - l.credit END), 0) AS input_vat
         FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id JOIN chart_of_accounts a ON a.id = l.account_id
        WHERE e.org_id = :orgId AND e.status = 'posted' AND e.entry_date >= ${monthStart}`,
      params,
    ),
    db.one(
      `SELECT COUNT(*) AS n, COALESCE(SUM(total), 0) AS amount,
              SUM(due_date < DATE(CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', '${TZ}'))) AS overdue
         FROM documents WHERE org_id = :orgId AND status = 'issued' AND doc_type IN ('invoice','tax_invoice')`,
      params,
    ),
    db.one(
      `SELECT COALESCE(SUM(wht_amount), 0) AS amount FROM transactions
        WHERE org_id = :orgId AND status = 'posted' AND type = 'expense' AND txn_date >= ${monthStart}`,
      params,
    ),
  ]);
  const revenue = Number(ledger.revenue);
  const expense = Number(ledger.expense);
  res.json({
    data: {
      month: { revenue: r2(revenue), expense: r2(expense), netProfit: r2(revenue - expense) },
      vat: { output: r2(Number(ledger.output_vat)), input: r2(Number(ledger.input_vat)), estimatedPayable: r2(Number(ledger.output_vat) - Number(ledger.input_vat)) },
      receivables: { count: Number(receivable.n), amount: Number(receivable.amount), overdue: Number(receivable.overdue ?? 0) },
      whtToRemit: Number(wht.amount),
    },
  });
});

module.exports = { router, pnlReport, trialBalanceReport, balanceSheetReport };
