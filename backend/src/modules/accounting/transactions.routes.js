'use strict';

const express = require('express');
const { z } = require('zod');
const db = require('../../db/pool');
const { validate } = require('../../core/http');
const { requirePermission } = require('../../core/auth');
const { audit } = require('../../core/audit');
const { notFound, conflict, badRequest } = require('../../core/errors');
const { r2, postJournal, reverseJournalsFor, transactionLines } = require('./ledger.service');
const { getTaxSettings } = require('../org/tax');
const env = require('../../config/env');
const { getOrder } = require('../pos/pos.service');

const router = express.Router();

/** Standard categories mapped to chart-of-accounts codes (shown as a dropdown, also used by AI). */
const CATEGORIES = {
  expense: [
    { name: 'ซื้อสินค้า', account: '1300' },
    { name: 'เงินเดือน', account: '5200' },
    { name: 'ค่าเช่า', account: '5300' },
    { name: 'ค่าโฆษณา', account: '5400' },
    { name: 'ค่าขนส่ง', account: '5500' },
    { name: 'ค่าธรรมเนียมแพลตฟอร์ม', account: '5600' },
    { name: 'ค่าสาธารณูปโภค', account: '5700' },
    { name: 'ค่าซอฟต์แวร์/AI', account: '5800' },
    { name: 'ค่าใช้จ่ายอื่น', account: '5900' },
  ],
  income: [
    { name: 'ขายสินค้า/บริการ', account: '4100' },
    { name: 'ค่าคอมมิชชัน Affiliate', account: '4200' },
    { name: 'รายได้อื่น', account: '4900' },
  ],
};
const accountFor = (type, category) =>
  CATEGORIES[type].find((c) => c.name === category)?.account ?? (type === 'expense' ? '5900' : '4900');

/** Common Thai withholding-tax types (Revenue Code section 40) with their usual rates. */
const WHT_TYPES = [
  { code: '40(2)', label: 'ค่าจ้างทำของ/ค่านายหน้า (บุคคล)', rate: 3 },
  { code: '40(5)', label: 'ค่าเช่า', rate: 5 },
  { code: '40(6)', label: 'ค่าวิชาชีพอิสระ', rate: 3 },
  { code: '40(8)-service', label: 'ค่าบริการ/ค่าจ้างทำของ', rate: 3 },
  { code: '40(8)-ads', label: 'ค่าโฆษณา', rate: 2 },
  { code: '40(8)-transport', label: 'ค่าขนส่ง', rate: 1 },
];

router.get('/meta', requirePermission('accounting:read'), (req, res) => {
  res.json({ data: { categories: CATEGORIES, whtTypes: WHT_TYPES } });
});

/**
 * Splits an entered amount into base/VAT/WHT.
 * vatMode: none | exclusive (VAT added on top) | inclusive (entered amount already contains VAT)
 * WHT is always computed on the pre-VAT base, as required by the Revenue Department.
 * vatRate is the shop's VAT rate (Settings > ภาษีมูลค่าเพิ่ม).
 */
function computeAmounts({ amount, vatMode, whtRate }, vatRate = 7) {
  const base = vatMode === 'inclusive' ? r2((amount * 100) / (100 + vatRate)) : r2(amount);
  const vat = vatMode === 'none' ? 0 : vatMode === 'inclusive' ? r2(amount - base) : r2((base * vatRate) / 100);
  const wht = whtRate ? r2((base * whtRate) / 100) : 0;
  return { base, vat, wht, net: r2(base + vat - wht) };
}

const txnBody = z
  .object({
    type: z.enum(['income', 'expense']),
    category: z.string().trim().min(1).max(100),
    amount: z.coerce.number().positive().max(999_999_999),
    vatMode: z.enum(['none', 'exclusive', 'inclusive']).default('none'),
    vatClaimable: z.boolean().default(true),
    whtRate: z.coerce.number().min(0).max(15).default(0),
    whtIncomeType: z.string().trim().max(20).nullable().optional(),
    txnDate: z.iso.date(),
    description: z.string().trim().min(1, 'กรุณาระบุรายละเอียด').max(500),
    counterparty: z.string().trim().max(191).nullable().optional(),
    counterpartyTaxId: z
      .string()
      .trim()
      .regex(/^\d{13}$/, 'เลขผู้เสียภาษีต้องมี 13 หลัก')
      .nullable()
      .optional()
      .or(z.literal('').transform(() => null)),
    counterpartyType: z.enum(['individual', 'company']).nullable().optional(),
    paymentMethod: z.enum(['cash', 'transfer', 'card', 'promptpay', 'cheque']).default('transfer'),
    branchId: z.number().int().positive().nullable().optional(),
    aiExtracted: z.boolean().default(false),
  })
  .refine((b) => !b.whtRate || (b.counterparty && b.counterpartyType), {
    message: 'รายการที่หัก ณ ที่จ่ายต้องระบุชื่อคู่ค้าและประเภท (บุคคล/นิติบุคคล) เพื่อออก 50 ทวิ และยื่น ภ.ง.ด.',
    path: ['counterpartyType'],
  });

function mapTxn(r) {
  return {
    id: r.id,
    // 'txn' = entered here; 'sale' = a POS/online order (read-only here, posted by the sale itself)
    source: r.source ?? 'txn',
    orderNo: r.order_no ?? null,
    channel: r.channel ?? null,
    itemCount: r.item_count == null ? null : Number(r.item_count),
    type: r.type,
    category: r.category,
    amount: Number(r.amount),
    vatAmount: Number(r.vat_amount),
    vatClaimable: Boolean(r.vat_claimable),
    whtAmount: Number(r.wht_amount),
    whtRate: r.wht_rate == null ? null : Number(r.wht_rate),
    whtIncomeType: r.wht_income_type,
    netAmount: r2(Number(r.amount) + Number(r.vat_amount) - Number(r.wht_amount)),
    txnDate: r.txn_date_str,
    description: r.description,
    counterparty: r.counterparty,
    counterpartyTaxId: r.counterparty_tax_id,
    counterpartyType: r.counterparty_type,
    paymentMethod: r.payment_method,
    status: r.status,
    aiExtracted: Boolean(r.ai_extracted),
    whtCertificateId: r.wht_certificate_id ?? null,
    createdBy: r.created_by_name ?? null,
    createdAt: r.created_at,
  };
}

const SELECT_TXN = `
  SELECT t.*, DATE_FORMAT(t.txn_date, '%Y-%m-%d') AS txn_date_str, u.full_name AS created_by_name,
         (SELECT d.id FROM documents d WHERE d.transaction_id = t.id AND d.doc_type = 'wht_certificate' AND d.status <> 'void' LIMIT 1) AS wht_certificate_id
    FROM transactions t LEFT JOIN users u ON u.id = t.created_by`;

/**
 * Income/expense entries plus every sale (POS and online orders), one row per order, so the list
 * shows all money in and out. Sales are already in the ledger via their own journal entries;
 * this only merges them into the view (stored data and VAT reports are unchanged).
 */
const ENTRIES = `(
  SELECT 'txn' AS source, t.id, t.type, t.category, t.amount, t.vat_amount, t.vat_claimable, t.wht_amount, t.wht_rate, t.wht_income_type,
         t.txn_date, t.description, t.counterparty, t.counterparty_tax_id, t.counterparty_type, t.payment_method, t.status, t.ai_extracted,
         t.created_by, t.created_at, NULL AS order_no, NULL AS channel, NULL AS item_count
    FROM transactions t WHERE t.org_id = :orgId
  UNION ALL
  SELECT 'sale', so.id, 'income', 'ยอดขาย', so.total - so.vat_amount, so.vat_amount, 0, 0, NULL, NULL,
         DATE(CONVERT_TZ(so.ordered_at, '+00:00', :tz)), CONCAT('ขาย ', so.order_no), c.name, NULL, NULL,
         (SELECT p.method FROM payments p WHERE p.order_id = so.id ORDER BY p.amount DESC LIMIT 1),
         CASE WHEN so.status IN ('cancelled', 'refunded') THEN 'void' ELSE 'posted' END, 0,
         so.created_by, so.ordered_at, so.order_no, so.channel, (SELECT COUNT(*) FROM sales_order_items i WHERE i.order_id = so.id)
    FROM sales_orders so LEFT JOIN customers c ON c.id = so.customer_id
   WHERE so.org_id = :orgId AND so.status <> 'pending'
) e`;

router.get(
  '/',
  requirePermission('accounting:read'),
  validate({
    query: z.object({
      type: z.enum(['income', 'expense']).optional(),
      category: z.string().max(100).optional(),
      from: z.iso.date().optional(),
      to: z.iso.date().optional(),
      q: z.string().trim().max(100).optional(),
      includeVoid: z.enum(['true', 'false']).optional(),
      source: z.enum(['txn', 'sale']).optional(),
      page: z.coerce.number().int().min(1).default(1),
      pageSize: z.coerce.number().int().min(1).max(200).default(25),
    }),
  }),
  async (req, res) => {
    const f = req.valid.query;
    const params = {
      orgId: req.user.orgId,
      tz: env.APP_TZ_OFFSET,
      source: f.source ?? null,
      type: f.type ?? null,
      category: f.category || null,
      from: f.from ?? null,
      to: f.to ?? null,
      q: f.q ? `%${f.q}%` : null,
      limit: f.pageSize,
      offset: (f.page - 1) * f.pageSize,
    };
    const where = `(:source IS NULL OR e.source = :source)
      AND (:type IS NULL OR e.type = :type) AND (:category IS NULL OR e.category = :category)
      AND (:from IS NULL OR e.txn_date >= :from) AND (:to IS NULL OR e.txn_date <= :to)
      AND (:q IS NULL OR e.description LIKE :q OR e.counterparty LIKE :q)
      ${f.includeVoid === 'true' ? '' : "AND e.status = 'posted'"}`;
    const rows = await db.query(
      `SELECT e.*, DATE_FORMAT(e.txn_date, '%Y-%m-%d') AS txn_date_str, u.full_name AS created_by_name,
              CASE WHEN e.source = 'txn' THEN (SELECT d.id FROM documents d WHERE d.transaction_id = e.id AND d.doc_type = 'wht_certificate' AND d.status <> 'void' LIMIT 1) END AS wht_certificate_id
         FROM ${ENTRIES} LEFT JOIN users u ON u.id = e.created_by
        WHERE ${where} ORDER BY e.txn_date DESC, e.created_at DESC, e.id DESC LIMIT :limit OFFSET :offset`,
      params,
    );
    const sum = await db.one(
      `SELECT COUNT(*) AS n,
              COALESCE(SUM(CASE WHEN e.type = 'income' THEN e.amount END), 0) AS income,
              COALESCE(SUM(CASE WHEN e.type = 'expense' THEN e.amount END), 0) AS expense
         FROM ${ENTRIES} WHERE ${where}`,
      params,
    );
    res.json({
      data: rows.map(mapTxn),
      meta: { page: f.page, pageSize: f.pageSize, total: Number(sum.n), income: Number(sum.income), expense: Number(sum.expense) },
    });
  },
);

/** What a sale row contains (items, payments) for accounting users, who may not have POS access. */
router.get('/sales/:id', requirePermission('accounting:read'), validate({ params: z.object({ id: z.coerce.number().int().positive() }) }), async (req, res) => {
  res.json({ data: await getOrder(req.user.orgId, req.valid.params.id) });
});

router.post('/', requirePermission('accounting:write'), validate({ body: txnBody }), async (req, res) => {
  const b = req.valid.body;
  const { base, vat, wht } = computeAmounts(b, (await getTaxSettings(req.user.orgId)).vatRate);
  const id = await db.tx(async (conn) => {
    const [ins] = await conn.query(
      `INSERT INTO transactions (org_id, branch_id, type, category, amount, vat_amount, vat_claimable, wht_amount, wht_rate, wht_income_type,
                                 txn_date, description, counterparty, counterparty_tax_id, counterparty_type, payment_method, ai_extracted, created_by)
       VALUES (:orgId, :branchId, :type, :category, :base, :vat, :vatClaimable, :wht, :whtRate, :whtIncomeType,
               :txnDate, :description, :counterparty, :taxId, :counterpartyType, :paymentMethod, :aiExtracted, :userId)`,
      {
        orgId: req.user.orgId,
        branchId: b.branchId ?? req.user.branchId ?? null,
        type: b.type,
        category: b.category,
        base,
        vat,
        vatClaimable: b.vatClaimable ? 1 : 0,
        wht,
        whtRate: b.whtRate || null,
        whtIncomeType: b.whtRate ? b.whtIncomeType ?? null : null,
        txnDate: b.txnDate,
        description: b.description,
        counterparty: b.counterparty ?? null,
        taxId: b.counterpartyTaxId ?? null,
        counterpartyType: b.counterpartyType ?? null,
        paymentMethod: b.paymentMethod,
        aiExtracted: b.aiExtracted ? 1 : 0,
        userId: req.user.id,
      },
    );
    await postJournal(conn, {
      orgId: req.user.orgId,
      date: b.txnDate,
      description: `${b.type === 'expense' ? 'จ่าย' : 'รับ'}${b.category}: ${b.description}`,
      refType: 'transaction',
      refId: ins.insertId,
      userId: req.user.id,
      lines: transactionLines({
        type: b.type,
        account: accountFor(b.type, b.category),
        amount: base,
        vat,
        vatClaimable: b.vatClaimable,
        wht,
        method: b.paymentMethod,
      }),
    });
    return ins.insertId;
  });
  audit(req, 'transaction.create', 'transaction', id, { type: b.type, amount: base });
  const row = await db.one(`${SELECT_TXN} WHERE t.id = :id`, { id });
  res.status(201).json({ data: mapTxn(row) });
});

router.post(
  '/:id/void',
  requirePermission('accounting:write'),
  validate({ params: z.object({ id: z.coerce.number().int().positive() }), body: z.object({ reason: z.string().trim().min(1).max(200) }) }),
  async (req, res) => {
    const { id } = req.valid.params;
    await db.tx(async (conn) => {
      const [[t]] = await conn.query('SELECT * FROM transactions WHERE id = :id AND org_id = :orgId FOR UPDATE', { id, orgId: req.user.orgId });
      if (!t) throw notFound('ไม่พบรายการ');
      if (t.status === 'void') throw conflict('รายการนี้ถูกยกเลิกแล้ว');
      const [[cert]] = await conn.query(
        "SELECT doc_no FROM documents WHERE transaction_id = :id AND doc_type = 'wht_certificate' AND status <> 'void' LIMIT 1",
        { id },
      );
      if (cert) throw badRequest(`ยกเลิกหนังสือรับรอง ${cert.doc_no} ก่อน`);
      await conn.query("UPDATE transactions SET status = 'void' WHERE id = :id", { id });
      await reverseJournalsFor(conn, {
        orgId: req.user.orgId,
        refType: 'transaction',
        refId: id,
        reason: req.valid.body.reason,
        userId: req.user.id,
      });
    });
    audit(req, 'transaction.void', 'transaction', id, { reason: req.valid.body.reason });
    res.json({ data: { ok: true } });
  },
);

module.exports = { router, CATEGORIES, WHT_TYPES, computeAmounts };
