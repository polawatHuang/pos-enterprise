'use strict';

const express = require('express');
const { z } = require('zod');
const db = require('../../db/pool');
const env = require('../../config/env');
const { validate } = require('../../core/http');
const { requirePermission } = require('../../core/auth');
const { audit } = require('../../core/audit');
const { r2 } = require('./ledger.service');
const { money, sendCsv } = require('./csv');

const router = express.Router();
const TZ = env.APP_TZ_OFFSET;

const period = z.object({
  year: z.coerce.number().int().min(2000).max(2100),
  month: z.coerce.number().int().min(1).max(12),
});
const monthRange = ({ year, month }) => {
  const from = `${year}-${String(month).padStart(2, '0')}-01`;
  const next = month === 12 ? `${year + 1}-01-01` : `${year}-${String(month + 1).padStart(2, '0')}-01`;
  return { from, next };
};

/**
 * ภ.พ.30 (monthly VAT return) draft.
 * Output VAT: every completed sale (POS + marketplace orders) + issued tax invoices not tied to an order
 * + other income recorded with VAT, minus credit notes. Input VAT: posted expenses backed by a full tax invoice.
 */
async function pp30(orgId, p) {
  const { from, next } = monthRange(p);
  const params = { orgId, from, next };
  const [orders, docs, credits, input, otherIncome] = await Promise.all([
    db.one(
      `SELECT COALESCE(SUM(total - vat_amount), 0) AS base, COALESCE(SUM(vat_amount), 0) AS vat, COUNT(*) AS n
         FROM sales_orders
        WHERE org_id = :orgId AND status NOT IN ('cancelled','refunded')
          AND CONVERT_TZ(ordered_at, '+00:00', '${TZ}') >= :from AND CONVERT_TZ(ordered_at, '+00:00', '${TZ}') < :next`,
      params,
    ),
    db.one(
      `SELECT COALESCE(SUM(total - vat_amount), 0) AS base, COALESCE(SUM(vat_amount), 0) AS vat, COUNT(*) AS n
         FROM documents
        WHERE org_id = :orgId AND doc_type IN ('tax_invoice','tax_invoice_receipt') AND status IN ('issued','paid')
          AND order_id IS NULL AND doc_date >= :from AND doc_date < :next`,
      params,
    ),
    db.one(
      `SELECT COALESCE(SUM(total - vat_amount), 0) AS base, COALESCE(SUM(vat_amount), 0) AS vat, COUNT(*) AS n
         FROM documents
        WHERE org_id = :orgId AND doc_type = 'credit_note' AND status IN ('issued','paid') AND doc_date >= :from AND doc_date < :next`,
      params,
    ),
    db.one(
      `SELECT COALESCE(SUM(amount), 0) AS base, COALESCE(SUM(vat_amount), 0) AS vat, COUNT(*) AS n,
              COALESCE(SUM(CASE WHEN vat_claimable = 0 THEN vat_amount END), 0) AS unclaimable
         FROM transactions
        WHERE org_id = :orgId AND type = 'expense' AND status = 'posted' AND vat_amount > 0
          AND txn_date >= :from AND txn_date < :next`,
      params,
    ),
    db.one(
      `SELECT COALESCE(SUM(amount), 0) AS base, COALESCE(SUM(vat_amount), 0) AS vat, COUNT(*) AS n
         FROM transactions
        WHERE org_id = :orgId AND type = 'income' AND status = 'posted' AND vat_amount > 0
          AND txn_date >= :from AND txn_date < :next`,
      params,
    ),
  ]);
  const salesBase = r2(Number(orders.base) + Number(docs.base) + Number(otherIncome.base) - Number(credits.base));
  const outputVat = r2(Number(orders.vat) + Number(docs.vat) + Number(otherIncome.vat) - Number(credits.vat));
  const inputVat = r2(Number(input.vat) - Number(input.unclaimable));
  const net = r2(outputVat - inputVat);
  return {
    period: p,
    sales: {
      base: salesBase,
      vat: outputVat,
      breakdown: {
        orders: { count: Number(orders.n), base: Number(orders.base), vat: Number(orders.vat) },
        taxInvoices: { count: Number(docs.n), base: Number(docs.base), vat: Number(docs.vat) },
        otherIncome: { count: Number(otherIncome.n), base: Number(otherIncome.base), vat: Number(otherIncome.vat) },
        creditNotes: { count: Number(credits.n), base: Number(credits.base), vat: Number(credits.vat) },
      },
    },
    purchases: { base: Number(input.base), vat: inputVat, unclaimableVat: Number(input.unclaimable), count: Number(input.n) },
    vatPayable: net > 0 ? net : 0,
    vatCredit: net < 0 ? -net : 0,
    // Paper filing is due the 15th of the next month; e-Filing gets an extension (commonly the 23rd).
    dueNote: 'ยื่นภายในวันที่ 15 ของเดือนถัดไป (ยื่นออนไลน์ขยายได้ถึงประมาณวันที่ 23)',
  };
}

/** ภ.ง.ด.3 (individuals) / ภ.ง.ด.53 (juristic persons): tax we withheld from payees in the month. */
async function whtReport(orgId, form, p) {
  const { from, next } = monthRange(p);
  const rows = await db.query(
    `SELECT id, DATE_FORMAT(txn_date, '%Y-%m-%d') AS txn_date, counterparty, counterparty_tax_id, counterparty_type,
            wht_income_type, wht_rate, amount, wht_amount, description, document_id
       FROM transactions
      WHERE org_id = :orgId AND type = 'expense' AND status = 'posted' AND wht_amount > 0
        AND txn_date >= :from AND txn_date < :next
        AND ${form === 'PND3' ? "counterparty_type = 'individual'" : "(counterparty_type = 'company' OR counterparty_type IS NULL)"}
      ORDER BY txn_date, id`,
    { orgId, from, next },
  );
  const items = rows.map((r, i) => ({
    seq: i + 1,
    transactionId: r.id,
    date: r.txn_date,
    payee: r.counterparty,
    taxId: r.counterparty_tax_id,
    counterpartyType: r.counterparty_type,
    incomeType: r.wht_income_type,
    rate: r.wht_rate == null ? null : Number(r.wht_rate),
    amount: Number(r.amount),
    wht: Number(r.wht_amount),
    description: r.description,
    certificateId: r.document_id,
  }));
  return {
    form,
    period: p,
    items,
    totals: { count: items.length, amount: r2(items.reduce((s, i) => s + i.amount, 0)), wht: r2(items.reduce((s, i) => s + i.wht, 0)) },
    warnings: items.filter((i) => !i.taxId).map((i) => `รายการ #${i.seq} (${i.payee ?? 'ไม่ระบุชื่อ'}) ไม่มีเลขผู้เสียภาษี`),
    dueNote: 'นำส่งภายในวันที่ 7 ของเดือนถัดไป (ยื่นออนไลน์ขยายได้ถึงประมาณวันที่ 15)',
  };
}

async function savedStatus(orgId, formType, p) {
  return db.one(
    `SELECT status, DATE_FORMAT(filed_at, '%Y-%m-%d') AS filed_at FROM tax_reports
      WHERE org_id = :orgId AND form_type = :formType AND period_year = :year AND period_month = :month`,
    { orgId, formType, year: p.year, month: p.month },
  );
}

router.get('/pp30', requirePermission('accounting:read'), validate({ query: period }), async (req, res) => {
  const data = await pp30(req.user.orgId, req.valid.query);
  res.json({ data: { ...data, saved: await savedStatus(req.user.orgId, 'PP30', req.valid.query) } });
});

router.get(
  '/wht',
  requirePermission('accounting:read'),
  validate({ query: period.extend({ form: z.enum(['PND3', 'PND53']) }) }),
  async (req, res) => {
    const { form, ...p } = req.valid.query;
    const data = await whtReport(req.user.orgId, form, p);
    res.json({ data: { ...data, saved: await savedStatus(req.user.orgId, form, p) } });
  },
);

/** CSV for the accountant / RD e-Filing preparation (UTF-8 with BOM so Excel shows Thai). */
router.get('/wht.csv', requirePermission('accounting:read'), validate({ query: period.extend({ form: z.enum(['PND3', 'PND53']) }) }), async (req, res) => {
  const { form, ...p } = req.valid.query;
  const data = await whtReport(req.user.orgId, form, p);
  const header = ['ลำดับ', 'เลขประจำตัวผู้เสียภาษี', 'ชื่อผู้มีเงินได้', 'วันที่จ่าย', 'ประเภทเงินได้', 'อัตราภาษี(%)', 'จำนวนเงินที่จ่าย', 'ภาษีที่หัก'];
  const lines = data.items.map((i) => [i.seq, i.taxId, i.payee, i.date, i.incomeType, i.rate, money(i.amount), money(i.wht)]);
  sendCsv(res, `${form}-${p.year}-${String(p.month).padStart(2, '0')}.csv`, [header, ...lines]);
});

/** ภ.พ.30 summary as CSV: output VAT by source, input VAT, and the net payable / credit. */
router.get('/pp30.csv', requirePermission('accounting:read'), validate({ query: period }), async (req, res) => {
  const d = await pp30(req.user.orgId, req.valid.query);
  const b = d.sales.breakdown;
  const rows = [
    ['หมวด', 'รายการ', 'จำนวน', 'มูลค่าก่อนภาษี', 'ภาษีมูลค่าเพิ่ม'],
    ['ภาษีขาย', 'ยอดขายหน้าร้านและออนไลน์ (ออร์เดอร์)', b.orders.count, money(b.orders.base), money(b.orders.vat)],
    ['ภาษีขาย', 'ใบกำกับภาษีที่ออก', b.taxInvoices.count, money(b.taxInvoices.base), money(b.taxInvoices.vat)],
    ['ภาษีขาย', 'รายได้อื่นที่มี VAT', b.otherIncome.count, money(b.otherIncome.base), money(b.otherIncome.vat)],
    ['ภาษีขาย', 'หัก ใบลดหนี้', b.creditNotes.count, money(-b.creditNotes.base), money(-b.creditNotes.vat)],
    ['ภาษีขาย', 'รวมภาษีขาย', '', money(d.sales.base), money(d.sales.vat)],
    ['ภาษีซื้อ', 'ค่าใช้จ่ายที่มีใบกำกับภาษี', d.purchases.count, money(d.purchases.base), money(d.purchases.vat)],
    ['ภาษีซื้อ', 'VAT ที่ขอคืนไม่ได้ (ไม่ใช่ใบกำกับเต็มรูป)', '', '', money(d.purchases.unclaimableVat)],
    ['สรุป', 'ภาษีที่ต้องชำระ', '', '', money(d.vatPayable)],
    ['สรุป', 'ภาษีชำระเกิน (เครดิตยกไป)', '', '', money(d.vatCredit)],
  ];
  sendCsv(res, `PP30-${d.period.year}-${String(d.period.month).padStart(2, '0')}.csv`, rows);
});

/** Record the filing status of a form (snapshot of the computed figures is kept for audit). */
router.post(
  '/reports',
  requirePermission('tax:file'),
  validate({ body: period.extend({ formType: z.enum(['PP30', 'PND3', 'PND53']), status: z.enum(['draft', 'ready', 'filed']) }) }),
  async (req, res) => {
    const { formType, status, ...p } = req.valid.body;
    const snapshot = formType === 'PP30' ? await pp30(req.user.orgId, p) : await whtReport(req.user.orgId, formType, p);
    await db.query(
      `INSERT INTO tax_reports (org_id, form_type, period_year, period_month, data, status, filed_at)
       VALUES (:orgId, :formType, :year, :month, :data, :status, IF(:status = 'filed', UTC_TIMESTAMP(), NULL))
       ON DUPLICATE KEY UPDATE data = VALUES(data), status = VALUES(status), filed_at = VALUES(filed_at)`,
      { orgId: req.user.orgId, formType, year: p.year, month: p.month, data: JSON.stringify(snapshot), status },
    );
    audit(req, 'tax.report.status', 'tax_report', `${formType}-${p.year}-${p.month}`, { status });
    res.json({ data: await savedStatus(req.user.orgId, formType, p) });
  },
);

module.exports = { router, pp30, whtReport };
