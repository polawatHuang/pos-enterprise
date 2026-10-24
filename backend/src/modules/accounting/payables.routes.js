'use strict';

// เจ้าหนี้ (accounts payable):
//   * ตั้งหนี้ผู้ขาย — a supplier's invoice / tax invoice is booked when it arrives (Dr stock or expense
//     + input VAT / Cr accounts payable); the supplier's credit note is the same, reversed
//   * ใบสำคัญจ่าย — paying one supplier's open bills (less their credit notes) in one go: Dr AP /
//     Cr bank or cash / Cr withholding tax, which then shows on ภ.ง.ด.3/53 and can get a 50 ทวิ
//   * เงินสดย่อย — topping up the petty-cash box (expenses paid from it use payment method petty_cash)

const express = require('express');
const { z } = require('zod');
const db = require('../../db/pool');
const { validate } = require('../../core/http');
const { requirePermission } = require('../../core/auth');
const { audit } = require('../../core/audit');
const { badRequest, conflict, notFound } = require('../../core/errors');
const { thaiBahtText } = require('../../utils/thai-baht-text');
const { ACC, r2, nextNumber, paymentAccount, postJournal, reverseJournalsFor } = require('./ledger.service');
const { getTaxSettings } = require('../org/tax');

const router = express.Router();
const idParam = z.object({ id: z.coerce.number().int().positive() });
const METHODS = ['cash', 'transfer', 'cheque', 'promptpay', 'card', 'petty_cash'];

/** What a bill can be booked to: stock bought for sale, or an expense account. */
const BILL_ACCOUNTS = [
  { code: '1300', name: 'ซื้อสินค้าเข้าสต๊อก' },
  { code: '5300', name: 'ค่าเช่า' },
  { code: '5400', name: 'ค่าโฆษณาและการตลาด' },
  { code: '5500', name: 'ค่าขนส่ง' },
  { code: '5700', name: 'ค่าสาธารณูปโภค' },
  { code: '5800', name: 'ค่าบริการซอฟต์แวร์/AI' },
  { code: '5900', name: 'ค่าใช้จ่ายอื่น' },
];

const signed = (b) => (b.kind === 'credit_note' ? -Number(b.total) : Number(b.total));
const signedBase = (b) => (b.kind === 'credit_note' ? -Number(b.amount) : Number(b.amount));

/* ------------------------------------------------------------------ bills */

const BILL_SELECT = `SELECT b.*, DATE_FORMAT(b.bill_date, '%Y-%m-%d') AS bill_day, DATE_FORMAT(b.due_date, '%Y-%m-%d') AS due_day,
                            s.name AS supplier_name, s.tax_id AS supplier_tax_id, po.po_no, sd.doc_no AS gr_no,
                            (SELECT v.pv_no FROM payment_voucher_items vi JOIN payment_vouchers v ON v.id = vi.voucher_id
                              WHERE vi.bill_id = b.id AND v.status = 'posted' LIMIT 1) AS pv_no,
                            (SELECT v.id FROM payment_voucher_items vi JOIN payment_vouchers v ON v.id = vi.voucher_id
                              WHERE vi.bill_id = b.id AND v.status = 'posted' LIMIT 1) AS pv_id
                       FROM supplier_bills b
                       JOIN suppliers s ON s.id = b.supplier_id
                       LEFT JOIN purchase_orders po ON po.id = b.purchase_order_id
                       LEFT JOIN stock_documents sd ON sd.id = b.stock_document_id`;

const mapBill = (b) => ({
  id: b.id,
  kind: b.kind,
  billNo: b.bill_no,
  supplierId: b.supplier_id,
  supplierName: b.supplier_name,
  supplierTaxId: b.supplier_tax_id,
  supplierDocNo: b.supplier_doc_no,
  billDate: b.bill_day,
  dueDate: b.due_day,
  accountCode: b.account_code,
  amount: Number(b.amount),
  vatAmount: Number(b.vat_amount),
  vatClaimable: Boolean(b.vat_claimable),
  total: Number(b.total),
  signedTotal: signed(b),
  purchaseOrderId: b.purchase_order_id,
  poNo: b.po_no ?? null,
  stockDocumentId: b.stock_document_id,
  grNo: b.gr_no ?? null,
  status: b.status,
  voucherId: b.pv_id ?? null,
  voucherNo: b.pv_no ?? null,
  note: b.note,
  createdAt: b.created_at,
});

router.get('/meta', requirePermission('accounting:read'), (req, res) => {
  res.json({ data: { accounts: BILL_ACCOUNTS, methods: METHODS } });
});

router.get(
  '/bills',
  requirePermission('accounting:read'),
  validate({
    query: z.object({
      status: z.enum(['unpaid', 'paid', 'void']).optional(),
      supplierId: z.coerce.number().int().positive().optional(),
      q: z.string().trim().max(100).optional(),
      limit: z.coerce.number().int().min(1).max(500).default(200),
    }),
  }),
  async (req, res) => {
    const f = req.valid.query;
    const rows = await db.query(
      `${BILL_SELECT} WHERE b.org_id = :orgId AND (:status IS NULL OR b.status = :status) AND (:supplierId IS NULL OR b.supplier_id = :supplierId)
         AND (:q IS NULL OR b.bill_no LIKE :q OR b.supplier_doc_no LIKE :q OR s.name LIKE :q)
       ORDER BY b.bill_date DESC, b.id DESC LIMIT :limit`,
      { orgId: req.user.orgId, status: f.status ?? null, supplierId: f.supplierId ?? null, q: f.q ? `%${f.q}%` : null, limit: f.limit },
    );
    res.json({ data: rows.map(mapBill) });
  },
);

/** Who is owed money: one row per supplier with open bills (credit notes netted). */
router.get('/bills/owed', requirePermission('accounting:read'), async (req, res) => {
  const rows = await db.query(
    `SELECT b.supplier_id, s.name, COUNT(*) AS n, SUM(CASE WHEN b.kind = 'credit_note' THEN -b.total ELSE b.total END) AS amount,
            MIN(CASE WHEN b.kind = 'bill' THEN b.due_date END) AS first_due
       FROM supplier_bills b JOIN suppliers s ON s.id = b.supplier_id
      WHERE b.org_id = :orgId AND b.status = 'unpaid'
      GROUP BY b.supplier_id, s.name ORDER BY MIN(CASE WHEN b.kind = 'bill' THEN b.due_date END) IS NULL, 5, s.name`,
    { orgId: req.user.orgId },
  );
  res.json({
    data: rows.map((r) => ({
      supplierId: r.supplier_id,
      supplierName: r.name,
      count: Number(r.n),
      amount: Number(r.amount),
      firstDue: r.first_due ? new Date(r.first_due).toISOString().slice(0, 10) : null,
    })),
  });
});

router.get('/bills/:id', requirePermission('accounting:read'), validate({ params: idParam }), async (req, res) => {
  const b = await db.one(`${BILL_SELECT} WHERE b.id = :id AND b.org_id = :orgId`, { id: req.valid.params.id, orgId: req.user.orgId });
  if (!b) throw notFound('ไม่พบรายการตั้งหนี้');
  res.json({ data: mapBill(b) });
});

/** The journal of a bill: Dr stock/expense (+ input VAT when claimable) / Cr AP; a credit note is the mirror. */
function billLines(b) {
  const debit = b.vatClaimable ? b.amount : r2(b.amount + b.vat);
  const lines = [
    { account: b.accountCode, debit },
    { account: ACC.INPUT_VAT, debit: b.vatClaimable ? b.vat : 0 },
    { account: ACC.AP, credit: b.total },
  ];
  return b.kind === 'credit_note' ? lines.map((l) => ({ account: l.account, debit: l.credit ?? 0, credit: l.debit ?? 0 })) : lines;
}

router.post(
  '/bills',
  requirePermission('accounting:write'),
  validate({
    body: z.object({
      kind: z.enum(['bill', 'credit_note']).default('bill'),
      supplierId: z.number().int().positive(),
      supplierDocNo: z.string().trim().max(60).nullable().optional(),
      billDate: z.iso.date(),
      dueDate: z.iso.date().nullable().optional(),
      accountCode: z.enum(BILL_ACCOUNTS.map((a) => a.code)).default('1300'),
      amount: z.coerce.number().positive().max(999_999_999),
      /** 'exclusive' = amount is before VAT; 'inclusive' = amount already includes VAT; 'none' = no VAT */
      vatMode: z.enum(['exclusive', 'inclusive', 'none']).default('exclusive'),
      vatClaimable: z.boolean().default(true),
      purchaseOrderId: z.number().int().positive().nullable().optional(),
      stockDocumentId: z.number().int().positive().nullable().optional(),
      note: z.string().trim().max(255).nullable().optional(),
    }),
  }),
  async (req, res) => {
    const b = req.valid.body;
    const { orgId, id: userId } = req.user;
    const { vatRate } = await getTaxSettings(orgId);
    let amount = r2(b.amount);
    let vat = 0;
    if (b.vatMode === 'exclusive') vat = r2((amount * vatRate) / 100);
    if (b.vatMode === 'inclusive') {
      vat = r2((amount * vatRate) / (100 + vatRate));
      amount = r2(amount - vat);
    }
    const total = r2(amount + vat);
    const vatClaimable = b.vatMode !== 'none' && b.vatClaimable;
    const id = await db.tx(async (conn) => {
      const [[s]] = await conn.query('SELECT id, name FROM suppliers WHERE id = :id AND org_id = :orgId', { id: b.supplierId, orgId });
      if (!s) throw notFound('ไม่พบผู้ขาย');
      if (b.purchaseOrderId) {
        const [[po]] = await conn.query('SELECT supplier_id FROM purchase_orders WHERE id = :id AND org_id = :orgId', { id: b.purchaseOrderId, orgId });
        if (!po) throw notFound('ไม่พบใบสั่งซื้อ');
      }
      if (b.stockDocumentId) {
        const [[gr]] = await conn.query("SELECT id FROM stock_documents WHERE id = :id AND org_id = :orgId AND doc_type = 'goods_receipt'", {
          id: b.stockDocumentId,
          orgId,
        });
        if (!gr) throw notFound('ไม่พบใบรับสินค้า');
      }
      if (b.supplierDocNo) {
        const [[dup]] = await conn.query(
          "SELECT bill_no FROM supplier_bills WHERE org_id = :orgId AND supplier_id = :sid AND supplier_doc_no = :no AND kind = :kind AND status <> 'void' LIMIT 1",
          { orgId, sid: b.supplierId, no: b.supplierDocNo, kind: b.kind },
        );
        if (dup) throw conflict(`ใบนี้ของผู้ขายถูกบันทึกแล้ว (${dup.bill_no})`);
      }
      const billNo = await nextNumber(conn, orgId, b.kind === 'credit_note' ? 'supplier_credit' : 'supplier_bill', b.billDate);
      const [ins] = await conn.query(
        `INSERT INTO supplier_bills (org_id, kind, bill_no, supplier_id, supplier_doc_no, bill_date, due_date, account_code, amount, vat_amount, vat_claimable,
                                     total, purchase_order_id, stock_document_id, note, created_by)
         VALUES (:orgId, :kind, :billNo, :supplierId, :docNo, :billDate, :dueDate, :account, :amount, :vat, :claimable, :total, :po, :gr, :note, :userId)`,
        {
          orgId,
          kind: b.kind,
          billNo,
          supplierId: b.supplierId,
          docNo: b.supplierDocNo ?? null,
          billDate: b.billDate,
          dueDate: b.dueDate ?? null,
          account: b.accountCode,
          amount,
          vat,
          claimable: vatClaimable ? 1 : 0,
          total,
          po: b.purchaseOrderId ?? null,
          gr: b.stockDocumentId ?? null,
          note: b.note ?? null,
          userId,
        },
      );
      await postJournal(conn, {
        orgId,
        date: b.billDate,
        description: `${b.kind === 'credit_note' ? 'ใบลดหนี้จาก' : 'ตั้งหนี้'} ${s.name}${b.supplierDocNo ? ` (${b.supplierDocNo})` : ''}`,
        refType: 'supplier_bill',
        refId: ins.insertId,
        userId,
        lines: billLines({ kind: b.kind, accountCode: b.accountCode, amount, vat, total, vatClaimable }),
      });
      return ins.insertId;
    });
    audit(req, 'bill.create', 'supplier_bill', id, { kind: b.kind, total });
    const row = await db.one(`${BILL_SELECT} WHERE b.id = :id`, { id });
    res.status(201).json({ data: mapBill(row) });
  },
);

router.post(
  '/bills/:id/void',
  requirePermission('accounting:write'),
  validate({ params: idParam, body: z.object({ reason: z.string().trim().min(1).max(200) }) }),
  async (req, res) => {
    const { id } = req.valid.params;
    await db.tx(async (conn) => {
      const [[b]] = await conn.query('SELECT * FROM supplier_bills WHERE id = :id AND org_id = :orgId FOR UPDATE', { id, orgId: req.user.orgId });
      if (!b) throw notFound('ไม่พบรายการตั้งหนี้');
      if (b.status === 'void') throw conflict('ยกเลิกไปแล้ว');
      if (b.status === 'paid') throw conflict('จ่ายเงินไปแล้ว — ยกเลิกใบสำคัญจ่ายก่อน');
      await conn.query("UPDATE supplier_bills SET status = 'void', note = CONCAT(COALESCE(note, ''), :r) WHERE id = :id", {
        id,
        r: ` [ยกเลิก] ${req.valid.body.reason}`.slice(0, 255),
      });
      await reverseJournalsFor(conn, { orgId: req.user.orgId, refType: 'supplier_bill', refId: id, reason: req.valid.body.reason, userId: req.user.id });
    });
    audit(req, 'bill.void', 'supplier_bill', id, { reason: req.valid.body.reason });
    res.json({ data: { ok: true } });
  },
);

/* --------------------------------------------------------------- vouchers */

const PV_SELECT = `SELECT v.*, DATE_FORMAT(v.pay_date, '%Y-%m-%d') AS pay_day, s.name AS supplier_name, s.tax_id AS supplier_tax_id,
                          s.address AS supplier_address, u.full_name AS created_by_name,
                          (SELECT d.id FROM documents d WHERE d.payment_voucher_id = v.id AND d.doc_type = 'wht_certificate' AND d.status <> 'void' LIMIT 1) AS cert_id
                     FROM payment_vouchers v JOIN suppliers s ON s.id = v.supplier_id LEFT JOIN users u ON u.id = v.created_by`;

const mapPv = (v) => ({
  id: v.id,
  pvNo: v.pv_no,
  supplierId: v.supplier_id,
  supplierName: v.supplier_name,
  supplierTaxId: v.supplier_tax_id,
  supplierAddress: v.supplier_address,
  payDate: v.pay_day,
  paymentMethod: v.payment_method,
  payeeType: v.payee_type,
  gross: Number(v.gross),
  whtBase: Number(v.wht_base),
  whtRate: v.wht_rate == null ? null : Number(v.wht_rate),
  whtIncomeType: v.wht_income_type,
  whtAmount: Number(v.wht_amount),
  netPaid: Number(v.net_paid),
  amountText: thaiBahtText(v.net_paid),
  reference: v.reference,
  status: v.status,
  note: v.note,
  certificateId: v.cert_id ?? null,
  createdBy: v.created_by_name,
  createdAt: v.created_at,
});

router.get(
  '/vouchers',
  requirePermission('accounting:read'),
  validate({ query: z.object({ supplierId: z.coerce.number().int().positive().optional(), limit: z.coerce.number().int().min(1).max(500).default(200) }) }),
  async (req, res) => {
    const rows = await db.query(
      `${PV_SELECT} WHERE v.org_id = :orgId AND (:supplierId IS NULL OR v.supplier_id = :supplierId) ORDER BY v.pay_date DESC, v.id DESC LIMIT :limit`,
      { orgId: req.user.orgId, supplierId: req.valid.query.supplierId ?? null, limit: req.valid.query.limit },
    );
    res.json({ data: rows.map(mapPv) });
  },
);

async function loadVoucher(orgId, id) {
  const v = await db.one(`${PV_SELECT} WHERE v.id = :id AND v.org_id = :orgId`, { id, orgId });
  if (!v) throw notFound('ไม่พบใบสำคัญจ่าย');
  const bills = await db.query(`${BILL_SELECT} JOIN payment_voucher_items vi ON vi.bill_id = b.id WHERE vi.voucher_id = :id ORDER BY b.bill_date, b.id`, { id });
  const org = await db.one('SELECT name, legal_name, tax_id, address, phone FROM organizations WHERE id = :orgId', { orgId });
  return { ...mapPv(v), bills: bills.map(mapBill), org: { name: org.name, legalName: org.legal_name, taxId: org.tax_id, address: org.address, phone: org.phone } };
}

router.get('/vouchers/:id', requirePermission('accounting:read'), validate({ params: idParam }), async (req, res) => {
  res.json({ data: await loadVoucher(req.user.orgId, req.valid.params.id) });
});

router.post(
  '/vouchers',
  requirePermission('accounting:write'),
  validate({
    body: z
      .object({
        supplierId: z.number().int().positive(),
        payDate: z.iso.date(),
        paymentMethod: z.enum(METHODS),
        billIds: z.array(z.number().int().positive()).min(1, 'เลือกรายการที่จะจ่าย').max(200),
        payeeType: z.enum(['company', 'individual']).default('company'),
        whtRate: z.coerce.number().min(0).max(15).optional(),
        whtIncomeType: z.string().trim().max(20).optional(),
        reference: z.string().trim().max(100).nullable().optional(),
        note: z.string().trim().max(255).nullable().optional(),
      })
      .refine((b) => !b.whtRate || b.whtIncomeType, { message: 'ระบุประเภทเงินได้ของภาษีหัก ณ ที่จ่าย', path: ['whtIncomeType'] }),
  }),
  async (req, res) => {
    const b = req.valid.body;
    const { orgId, id: userId } = req.user;
    const ids = [...new Set(b.billIds)];
    const id = await db.tx(async (conn) => {
      const [bills] = await conn.query(
        "SELECT * FROM supplier_bills WHERE org_id = :orgId AND id IN (:ids) AND status = 'unpaid' FOR UPDATE",
        { orgId, ids },
      );
      if (bills.length !== ids.length) throw badRequest('มีรายการที่จ่ายแล้ว ยกเลิกแล้ว หรือไม่พบ');
      if (bills.some((x) => Number(x.supplier_id) !== b.supplierId)) throw badRequest('ใบสำคัญจ่ายหนึ่งใบจ่ายได้เฉพาะผู้ขายรายเดียว');
      if (!bills.some((x) => x.kind === 'bill')) throw badRequest('ต้องมีรายการตั้งหนี้อย่างน้อย 1 ใบ');
      const gross = r2(bills.reduce((s, x) => s + signed(x), 0));
      if (gross <= 0) throw badRequest('ยอดจ่ายต้องมากกว่า 0');
      const whtBase = b.whtRate ? r2(bills.reduce((s, x) => s + signedBase(x), 0)) : 0;
      const wht = b.whtRate ? r2((whtBase * b.whtRate) / 100) : 0;
      const net = r2(gross - wht);
      const pvNo = await nextNumber(conn, orgId, 'payment_voucher', b.payDate);
      const [ins] = await conn.query(
        `INSERT INTO payment_vouchers (org_id, pv_no, supplier_id, pay_date, payment_method, payee_type, gross, wht_base, wht_rate, wht_income_type, wht_amount,
                                       net_paid, reference, note, created_by)
         VALUES (:orgId, :pvNo, :supplierId, :payDate, :method, :payeeType, :gross, :whtBase, :whtRate, :whtType, :wht, :net, :reference, :note, :userId)`,
        {
          orgId,
          pvNo,
          supplierId: b.supplierId,
          payDate: b.payDate,
          method: b.paymentMethod,
          payeeType: b.payeeType,
          gross,
          whtBase,
          whtRate: b.whtRate || null,
          whtType: b.whtRate ? b.whtIncomeType : null,
          wht,
          net,
          reference: b.reference ?? null,
          note: b.note ?? null,
          userId,
        },
      );
      for (const x of bills) {
        await conn.query('INSERT INTO payment_voucher_items (voucher_id, bill_id, amount) VALUES (:v, :b, :a)', { v: ins.insertId, b: x.id, a: signed(x) });
      }
      await conn.query("UPDATE supplier_bills SET status = 'paid' WHERE id IN (:ids)", { ids });
      const [[s]] = await conn.query('SELECT name FROM suppliers WHERE id = :id', { id: b.supplierId });
      await postJournal(conn, {
        orgId,
        date: b.payDate,
        description: `จ่ายเงิน ${s.name} ตาม ${pvNo}`,
        refType: 'payment_voucher',
        refId: ins.insertId,
        userId,
        lines: [
          { account: ACC.AP, debit: gross },
          { account: paymentAccount(b.paymentMethod), credit: net },
          { account: ACC.WHT_PAYABLE, credit: wht },
        ],
      });
      return ins.insertId;
    });
    audit(req, 'voucher.create', 'payment_voucher', id, { bills: ids.length });
    res.status(201).json({ data: await loadVoucher(orgId, id) });
  },
);

router.post(
  '/vouchers/:id/void',
  requirePermission('accounting:write'),
  validate({ params: idParam, body: z.object({ reason: z.string().trim().min(1).max(200) }) }),
  async (req, res) => {
    const { id } = req.valid.params;
    const orgId = req.user.orgId;
    await db.tx(async (conn) => {
      const [[v]] = await conn.query('SELECT * FROM payment_vouchers WHERE id = :id AND org_id = :orgId FOR UPDATE', { id, orgId });
      if (!v) throw notFound('ไม่พบใบสำคัญจ่าย');
      if (v.status === 'void') throw conflict('ยกเลิกไปแล้ว');
      const [[cert]] = await conn.query("SELECT doc_no FROM documents WHERE payment_voucher_id = :id AND doc_type = 'wht_certificate' AND status <> 'void' LIMIT 1", { id });
      if (cert) throw badRequest(`ยกเลิกหนังสือรับรอง ${cert.doc_no} ก่อน`);
      await conn.query("UPDATE payment_vouchers SET status = 'void', note = CONCAT(COALESCE(note, ''), :r) WHERE id = :id", {
        id,
        r: ` [ยกเลิก] ${req.valid.body.reason}`.slice(0, 255),
      });
      // what it paid is owed again
      await conn.query("UPDATE supplier_bills SET status = 'unpaid' WHERE status = 'paid' AND id IN (SELECT bill_id FROM payment_voucher_items WHERE voucher_id = :id)", { id });
      await reverseJournalsFor(conn, { orgId, refType: 'payment_voucher', refId: id, reason: req.valid.body.reason, userId: req.user.id });
    });
    audit(req, 'voucher.void', 'payment_voucher', id, { reason: req.valid.body.reason });
    res.json({ data: await loadVoucher(orgId, id) });
  },
);

/** 50 ทวิ for the tax withheld on a payment voucher. */
router.post('/vouchers/:id/wht-certificate', requirePermission('accounting:write'), validate({ params: idParam }), async (req, res) => {
  const { id } = req.valid.params;
  const { orgId, id: userId } = req.user;
  const docId = await db.tx(async (conn) => {
    const [[v]] = await conn.query(
      'SELECT v.*, DATE_FORMAT(v.pay_date, \'%Y-%m-%d\') AS pay_day, s.name, s.tax_id, s.address FROM payment_vouchers v JOIN suppliers s ON s.id = v.supplier_id WHERE v.id = :id AND v.org_id = :orgId FOR UPDATE',
      { id, orgId },
    );
    if (!v) throw notFound('ไม่พบใบสำคัญจ่าย');
    if (v.status !== 'posted') throw conflict('ใบสำคัญจ่ายนี้ถูกยกเลิกแล้ว');
    if (!(Number(v.wht_amount) > 0)) throw badRequest('ใบสำคัญจ่ายนี้ไม่มีภาษีหัก ณ ที่จ่าย');
    const [[existing]] = await conn.query("SELECT id FROM documents WHERE payment_voucher_id = :id AND doc_type = 'wht_certificate' AND status <> 'void'", { id });
    if (existing) return existing.id;
    const docNo = await nextNumber(conn, orgId, 'wht_certificate', v.pay_day);
    const [ins] = await conn.query(
      `INSERT INTO documents (org_id, doc_type, doc_no, doc_date, supplier_id, party_name, party_tax_id, party_address, subtotal, wht_amount, total, status,
                              payment_voucher_id, note, created_by)
       VALUES (:orgId, 'wht_certificate', :docNo, :date, :sid, :name, :taxId, :address, :base, :wht, :base, 'issued', :pv, :note, :userId)`,
      {
        orgId,
        docNo,
        date: v.pay_day,
        sid: v.supplier_id,
        name: v.name,
        taxId: v.tax_id,
        address: v.address,
        base: v.wht_base,
        wht: v.wht_amount,
        pv: id,
        note: `อ้างอิง ${v.pv_no}`,
        userId,
      },
    );
    return ins.insertId;
  });
  audit(req, 'voucher.wht_certificate', 'payment_voucher', id, { documentId: docId });
  res.status(201).json({ data: { documentId: docId } });
});

/* ------------------------------------------------------------- petty cash */

/** Balance of the petty-cash account, recent top-ups and what was paid from it. */
router.get('/petty-cash', requirePermission('accounting:read'), async (req, res) => {
  const orgId = req.user.orgId;
  const [bal, topups, spent] = await Promise.all([
    db.one(
      `SELECT COALESCE(SUM(l.debit - l.credit), 0) AS balance FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id
         JOIN chart_of_accounts a ON a.id = l.account_id WHERE e.org_id = :orgId AND a.code = :code`,
      { orgId, code: ACC.PETTY_CASH },
    ),
    db.query(
      `SELECT t.id, t.topup_no, DATE_FORMAT(t.topup_date, '%Y-%m-%d') AS day, t.amount, t.from_method, t.note, t.status, u.full_name
         FROM petty_cash_topups t LEFT JOIN users u ON u.id = t.created_by WHERE t.org_id = :orgId ORDER BY t.topup_date DESC, t.id DESC LIMIT 50`,
      { orgId },
    ),
    db.query(
      `SELECT x.id, DATE_FORMAT(x.txn_date, '%Y-%m-%d') AS day, x.category, x.description, x.counterparty, x.amount + x.vat_amount - x.wht_amount AS paid, x.status,
              x.document_id
         FROM transactions x WHERE x.org_id = :orgId AND x.type = 'expense' AND x.payment_method = 'petty_cash'
        ORDER BY x.txn_date DESC, x.id DESC LIMIT 100`,
      { orgId },
    ),
  ]);
  res.json({
    data: {
      balance: r2(bal.balance),
      topups: topups.map((t) => ({ id: t.id, topupNo: t.topup_no, date: t.day, amount: Number(t.amount), fromMethod: t.from_method, note: t.note, status: t.status, by: t.full_name })),
      expenses: spent.map((x) => ({ id: x.id, date: x.day, category: x.category, description: x.description, counterparty: x.counterparty, paid: Number(x.paid), status: x.status })),
    },
  });
});

router.post(
  '/petty-cash/topups',
  requirePermission('accounting:write'),
  validate({
    body: z.object({
      date: z.iso.date(),
      amount: z.coerce.number().positive().max(10_000_000),
      fromMethod: z.enum(['cash', 'transfer']).default('cash'),
      note: z.string().trim().max(255).nullable().optional(),
    }),
  }),
  async (req, res) => {
    const b = req.valid.body;
    const { orgId, id: userId } = req.user;
    const id = await db.tx(async (conn) => {
      const no = await nextNumber(conn, orgId, 'petty_cash_topup', b.date);
      const [ins] = await conn.query(
        'INSERT INTO petty_cash_topups (org_id, topup_no, topup_date, amount, from_method, note, created_by) VALUES (:orgId, :no, :date, :amount, :from, :note, :userId)',
        { orgId, no, date: b.date, amount: r2(b.amount), from: b.fromMethod, note: b.note ?? null, userId },
      );
      await postJournal(conn, {
        orgId,
        date: b.date,
        description: `เติมเงินสดย่อย ${no}`,
        refType: 'petty_cash_topup',
        refId: ins.insertId,
        userId,
        lines: [
          { account: ACC.PETTY_CASH, debit: r2(b.amount) },
          { account: paymentAccount(b.fromMethod), credit: r2(b.amount) },
        ],
      });
      return ins.insertId;
    });
    audit(req, 'petty_cash.topup', 'petty_cash_topup', id, { amount: b.amount });
    res.status(201).json({ data: { id } });
  },
);

router.post(
  '/petty-cash/topups/:id/void',
  requirePermission('accounting:write'),
  validate({ params: idParam, body: z.object({ reason: z.string().trim().min(1).max(200) }) }),
  async (req, res) => {
    const { id } = req.valid.params;
    await db.tx(async (conn) => {
      const [[t]] = await conn.query('SELECT status FROM petty_cash_topups WHERE id = :id AND org_id = :orgId FOR UPDATE', { id, orgId: req.user.orgId });
      if (!t) throw notFound('ไม่พบรายการเติมเงิน');
      if (t.status === 'void') throw conflict('ยกเลิกไปแล้ว');
      await conn.query("UPDATE petty_cash_topups SET status = 'void' WHERE id = :id", { id });
      await reverseJournalsFor(conn, { orgId: req.user.orgId, refType: 'petty_cash_topup', refId: id, reason: req.valid.body.reason, userId: req.user.id });
    });
    audit(req, 'petty_cash.topup_void', 'petty_cash_topup', id);
    res.json({ data: { ok: true } });
  },
);

module.exports = { router, BILL_ACCOUNTS };
