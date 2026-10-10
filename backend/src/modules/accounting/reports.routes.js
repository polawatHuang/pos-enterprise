'use strict';

const express = require('express');
const { z } = require('zod');
const db = require('../../db/pool');
const env = require('../../config/env');
const { validate } = require('../../core/http');
const { requirePermission } = require('../../core/auth');
const { r2 } = require('./ledger.service');

const router = express.Router();
router.use(requirePermission('accounting:read'));

const range = z.object({ from: z.iso.date(), to: z.iso.date() });

/** Profit & loss from the general ledger (posted journals, reversals included so voids net out). */
router.get('/pnl', validate({ query: range }), async (req, res) => {
  const rows = await db.query(
    `SELECT a.code, a.name, a.type, COALESCE(SUM(l.debit), 0) AS dr, COALESCE(SUM(l.credit), 0) AS cr
       FROM journal_lines l
       JOIN journal_entries e ON e.id = l.entry_id
       JOIN chart_of_accounts a ON a.id = l.account_id
      WHERE e.org_id = :orgId AND e.status = 'posted' AND a.type IN ('revenue','expense')
        AND e.entry_date BETWEEN :from AND :to
      GROUP BY a.id, a.code, a.name, a.type
      ORDER BY a.code`,
    { orgId: req.user.orgId, ...req.valid.query },
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
  res.json({
    data: {
      ...req.valid.query,
      revenue,
      cogs,
      expenses,
      totals: { revenue: totalRevenue, cogs: sum(cogs), grossProfit, expenses: sum(expenses), netProfit: r2(grossProfit - sum(expenses)) },
    },
  });
});

/** Trial balance as of a date: every account's cumulative debit/credit. Must always balance. */
router.get('/trial-balance', validate({ query: z.object({ asOf: z.iso.date() }) }), async (req, res) => {
  const rows = await db.query(
    `SELECT a.code, a.name, a.type, COALESCE(SUM(l.debit), 0) AS dr, COALESCE(SUM(l.credit), 0) AS cr
       FROM chart_of_accounts a
       LEFT JOIN journal_lines l ON l.account_id = a.id
       LEFT JOIN journal_entries e ON e.id = l.entry_id
      WHERE a.org_id = :orgId AND (e.id IS NULL OR (e.status = 'posted' AND e.entry_date <= :asOf))
      GROUP BY a.id, a.code, a.name, a.type
     HAVING SUM(l.debit) <> 0 OR SUM(l.credit) <> 0
      ORDER BY a.code`,
    { orgId: req.user.orgId, asOf: req.valid.query.asOf },
  );
  const accounts = rows.map((r) => {
    const bal = r2(Number(r.dr) - Number(r.cr));
    return { code: r.code, name: r.name, type: r.type, debit: bal > 0 ? bal : 0, credit: bal < 0 ? -bal : 0 };
  });
  const totalDebit = r2(accounts.reduce((s, a) => s + a.debit, 0));
  const totalCredit = r2(accounts.reduce((s, a) => s + a.credit, 0));
  res.json({ data: { asOf: req.valid.query.asOf, accounts, totalDebit, totalCredit, balanced: totalDebit === totalCredit } });
});

/** General journal (สมุดรายวันทั่วไป), newest first. */
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
    const params = { orgId: req.user.orgId, from: f.from ?? null, to: f.to ?? null, limit: f.pageSize, offset: (f.page - 1) * f.pageSize };
    const where = 'e.org_id = :orgId AND (:from IS NULL OR e.entry_date >= :from) AND (:to IS NULL OR e.entry_date <= :to)';
    const entries = await db.query(
      `SELECT e.id, e.entry_no, DATE_FORMAT(e.entry_date, '%Y-%m-%d') AS entry_date, e.description, e.ref_type, e.ref_id
         FROM journal_entries e WHERE ${where} ORDER BY e.entry_date DESC, e.id DESC LIMIT :limit OFFSET :offset`,
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
    res.json({
      data: entries.map((e) => ({
        id: e.id,
        entryNo: e.entry_no,
        date: e.entry_date,
        description: e.description,
        refType: e.ref_type,
        refId: e.ref_id,
        lines: lines
          .filter((l) => l.entry_id === e.id)
          .map((l) => ({ code: l.code, name: l.name, debit: Number(l.debit), credit: Number(l.credit) })),
      })),
      meta: { page: f.page, pageSize: f.pageSize, total: Number(total.n) },
    });
  },
);

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

module.exports = { router };
