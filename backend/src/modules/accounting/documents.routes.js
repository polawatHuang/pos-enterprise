'use strict';

const express = require('express');
const { z } = require('zod');
const db = require('../../db/pool');
const { validate } = require('../../core/http');
const { requirePermission } = require('../../core/auth');
const { audit } = require('../../core/audit');
const { badRequest, conflict, notFound } = require('../../core/errors');
const { localDate } = require('../../utils/dates');
const { thaiBahtText } = require('../../utils/thai-baht-text');
const { ACC, r2, nextNumber, paymentAccount, postJournal, reverseJournalsFor } = require('./ledger.service');

const router = express.Router();

const SALES_TYPES = ['quotation', 'invoice', 'tax_invoice', 'receipt', 'tax_invoice_receipt', 'credit_note'];
/** Issued as a sale on credit -> receivable until paid. */
const CREDIT_TYPES = ['invoice', 'tax_invoice'];
/** Issued and paid at once (cash sale). */
const PAID_ON_ISSUE = ['receipt', 'tax_invoice_receipt'];
const VAT_RATE = 7;

const idParam = z.object({ id: z.coerce.number().int().positive() });
const money = z.coerce.number().min(0).max(999_999_999);

const docBody = z.object({
  docType: z.enum(SALES_TYPES),
  docDate: z.iso.date(),
  dueDate: z.iso.date().nullable().optional(),
  customerId: z.number().int().positive().nullable().optional(),
  partyName: z.string().trim().max(191).nullable().optional(),
  partyTaxId: z.string().trim().max(20).nullable().optional(),
  partyAddress: z.string().trim().max(1000).nullable().optional(),
  refDocId: z.number().int().positive().nullable().optional(),
  discount: money.default(0),
  note: z.string().trim().max(2000).nullable().optional(),
  items: z
    .array(
      z.object({
        productId: z.number().int().positive().nullable().optional(),
        description: z.string().trim().min(1, 'กรุณาระบุรายการ').max(500),
        quantity: z.coerce.number().positive().max(1_000_000),
        unitPrice: money,
        discount: money.default(0),
        vatType: z.enum(['vat7', 'exempt', 'zero']).default('vat7'),
      }),
    )
    .min(1, 'ต้องมีอย่างน้อย 1 รายการ')
    .max(200),
});

/**
 * B2B documents are priced EXCLUSIVE of VAT (Thai invoice convention), unlike POS retail prices.
 * VAT applies to vat7 lines after spreading the bill discount proportionally.
 */
function computeDocTotals(items, billDiscount) {
  const lines = items.map((i) => ({ ...i, lineTotal: r2(i.quantity * i.unitPrice - (i.discount ?? 0)) }));
  if (lines.some((l) => l.lineTotal < 0)) throw badRequest('ส่วนลดรายการมากกว่าราคา');
  const subtotal = r2(lines.reduce((s, l) => s + l.lineTotal, 0));
  if (billDiscount > subtotal) throw badRequest('ส่วนลดมากกว่ายอดรวม');
  const net = r2(subtotal - billDiscount);
  const ratio = subtotal ? net / subtotal : 0;
  const vatable = lines.filter((l) => l.vatType === 'vat7').reduce((s, l) => s + l.lineTotal, 0);
  const vat = r2((vatable * ratio * VAT_RATE) / 100);
  return { lines, subtotal, discount: r2(billDiscount), net, vat, total: r2(net + vat) };
}

async function loadDocument(orgId, id) {
  const d = await db.one(
    `SELECT d.*, DATE_FORMAT(d.doc_date, '%Y-%m-%d') AS doc_date_str, DATE_FORMAT(d.due_date, '%Y-%m-%d') AS due_date_str,
            r.doc_no AS ref_doc_no, r.doc_type AS ref_doc_type, u.full_name AS created_by_name
       FROM documents d
       LEFT JOIN documents r ON r.id = d.ref_doc_id
       LEFT JOIN users u ON u.id = d.created_by
      WHERE d.id = :id AND d.org_id = :orgId`,
    { id, orgId },
  );
  if (!d) throw notFound('ไม่พบเอกสาร');
  const items = await db.query('SELECT * FROM document_items WHERE document_id = :id ORDER BY id', { id });
  return { d, items };
}

function mapDocument(d, items) {
  return {
    id: d.id,
    docType: d.doc_type,
    docNo: d.doc_no,
    isDraft: d.status === 'draft',
    docDate: d.doc_date_str,
    dueDate: d.due_date_str,
    customerId: d.customer_id,
    partyName: d.party_name,
    partyTaxId: d.party_tax_id,
    partyAddress: d.party_address,
    subtotal: Number(d.subtotal),
    discount: Number(d.discount),
    vatAmount: Number(d.vat_amount),
    whtAmount: Number(d.wht_amount),
    total: Number(d.total),
    amountText: thaiBahtText(d.doc_type === 'wht_certificate' ? d.wht_amount : d.total),
    status: d.status,
    paidAt: d.paid_at,
    paymentMethod: d.payment_method,
    refDocId: d.ref_doc_id,
    refDocNo: d.ref_doc_no ?? null,
    refDocType: d.ref_doc_type ?? null,
    transactionId: d.transaction_id,
    note: d.note,
    createdBy: d.created_by_name ?? null,
    createdAt: d.created_at,
    items: (items ?? []).map((i) => ({
      id: i.id,
      productId: i.product_id,
      description: i.description,
      quantity: Number(i.quantity),
      unitPrice: Number(i.unit_price),
      discount: Number(i.discount),
      vatType: i.vat_type,
      lineTotal: Number(i.line_total),
    })),
  };
}

/* ------------------------------------------------------------------- list */

router.get(
  '/',
  requirePermission('accounting:read'),
  validate({
    query: z.object({
      docType: z.enum([...SALES_TYPES, 'wht_certificate']).optional(),
      status: z.enum(['draft', 'issued', 'paid', 'void', 'unpaid']).optional(),
      q: z.string().trim().max(100).optional(),
      page: z.coerce.number().int().min(1).default(1),
      pageSize: z.coerce.number().int().min(1).max(100).default(25),
    }),
  }),
  async (req, res) => {
    const f = req.valid.query;
    const params = {
      orgId: req.user.orgId,
      docType: f.docType ?? null,
      status: f.status ?? null,
      q: f.q ? `%${f.q}%` : null,
      limit: f.pageSize,
      offset: (f.page - 1) * f.pageSize,
    };
    const statusSql =
      f.status === 'unpaid' ? "AND d.status = 'issued' AND d.doc_type IN ('invoice','tax_invoice')" : 'AND (:status IS NULL OR d.status = :status)';
    const where = `d.org_id = :orgId AND (:docType IS NULL OR d.doc_type = :docType) ${statusSql}
      AND (:q IS NULL OR d.doc_no LIKE :q OR d.party_name LIKE :q)`;
    const rows = await db.query(
      `SELECT d.*, DATE_FORMAT(d.doc_date, '%Y-%m-%d') AS doc_date_str, DATE_FORMAT(d.due_date, '%Y-%m-%d') AS due_date_str
         FROM documents d WHERE ${where} ORDER BY d.doc_date DESC, d.id DESC LIMIT :limit OFFSET :offset`,
      params,
    );
    const total = await db.one(`SELECT COUNT(*) AS n FROM documents d WHERE ${where}`, params);
    res.json({ data: rows.map((r) => mapDocument(r, [])), meta: { page: f.page, pageSize: f.pageSize, total: Number(total.n) } });
  },
);

async function bankAccountFor(orgId) {
  const { getSettings, formatAccountNo } = require('../pos/pos.service');
  const { bankAccount } = await getSettings(orgId);
  return bankAccount?.number ? { ...bankAccount, display: formatAccountNo(bankAccount.number) } : null;
}

/** Everything a printable A4 document needs: org header, branch, party, lines, amount in words. */
router.get('/:id', requirePermission('accounting:read'), validate({ params: idParam }), async (req, res) => {
  const { d, items } = await loadDocument(req.user.orgId, req.valid.params.id);
  const org = await db.one(
    `SELECT o.name, o.legal_name, o.tax_id, o.address, o.phone, o.email, o.vat_registered, b.branch_no, b.name AS branch_name
       FROM organizations o LEFT JOIN branches b ON b.org_id = o.id AND b.branch_no = '00000'
      WHERE o.id = :orgId LIMIT 1`,
    { orgId: req.user.orgId },
  );
  let source = null;
  if (d.transaction_id) {
    source = await db.one(
      `SELECT wht_rate, wht_income_type, counterparty_type, DATE_FORMAT(txn_date, '%Y-%m-%d') AS txn_date, amount, wht_amount
         FROM transactions WHERE id = :id`,
      { id: d.transaction_id },
    );
  }
  res.json({
    data: {
      ...mapDocument(d, items),
      org: {
        name: org.name,
        legalName: org.legal_name,
        taxId: org.tax_id,
        address: org.address,
        phone: org.phone,
        email: org.email,
        vatRegistered: Boolean(org.vat_registered),
        branchNo: org.branch_no ?? '00000',
        bankAccount: await bankAccountFor(req.user.orgId),
      },
      whtSource: source && {
        rate: source.wht_rate == null ? null : Number(source.wht_rate),
        incomeType: source.wht_income_type,
        counterpartyType: source.counterparty_type,
        paidDate: source.txn_date,
        amount: Number(source.amount),
        whtAmount: Number(source.wht_amount),
      },
    },
  });
});

/* ---------------------------------------------------------------- create */

async function insertDocument(conn, user, b, totals, extra = {}) {
  let party = { name: b.partyName ?? null, taxId: b.partyTaxId ?? null, address: b.partyAddress ?? null };
  if (b.customerId) {
    const [[c]] = await conn.query('SELECT name, tax_id, address FROM customers WHERE id = :id AND org_id = :orgId', {
      id: b.customerId,
      orgId: user.orgId,
    });
    if (!c) throw notFound('ไม่พบลูกค้า');
    party = { name: party.name || c.name, taxId: party.taxId || c.tax_id, address: party.address || c.address };
  }
  if (['tax_invoice', 'tax_invoice_receipt'].includes(b.docType) && !party.name) {
    throw badRequest('ใบกำกับภาษีต้องระบุชื่อผู้ซื้อ');
  }
  const [ins] = await conn.query(
    `INSERT INTO documents (org_id, doc_type, doc_no, doc_date, due_date, customer_id, party_name, party_tax_id, party_address,
                            subtotal, discount, vat_amount, total, status, ref_doc_id, note, created_by)
     VALUES (:orgId, :docType, :tmpNo, :docDate, :dueDate, :customerId, :partyName, :partyTaxId, :partyAddress,
             :subtotal, :discount, :vat, :total, 'draft', :refDocId, :note, :userId)`,
    {
      orgId: user.orgId,
      docType: b.docType,
      tmpNo: `DRAFT-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      docDate: b.docDate,
      dueDate: b.dueDate ?? null,
      customerId: b.customerId ?? null,
      partyName: party.name,
      partyTaxId: party.taxId,
      partyAddress: party.address,
      subtotal: totals.subtotal,
      discount: totals.discount,
      vat: totals.vat,
      total: totals.total,
      refDocId: b.refDocId ?? extra.refDocId ?? null,
      note: b.note ?? null,
      userId: user.id,
    },
  );
  const id = ins.insertId;
  await conn.query('UPDATE documents SET doc_no = :no WHERE id = :id', { no: `DRAFT-${id}`, id });
  for (const l of totals.lines) {
    await conn.query(
      `INSERT INTO document_items (document_id, product_id, description, quantity, unit_price, discount, vat_type, line_total)
       VALUES (:id, :productId, :description, :quantity, :unitPrice, :discount, :vatType, :lineTotal)`,
      { id, productId: l.productId ?? null, description: l.description, quantity: l.quantity, unitPrice: l.unitPrice, discount: l.discount ?? 0, vatType: l.vatType, lineTotal: l.lineTotal },
    );
  }
  return id;
}

router.post('/', requirePermission('accounting:write'), validate({ body: docBody }), async (req, res) => {
  const b = req.valid.body;
  if (b.docType === 'credit_note' && !b.refDocId) throw badRequest('ใบลดหนี้ต้องอ้างอิงใบกำกับภาษีเดิม');
  const totals = computeDocTotals(b.items, b.discount);
  const id = await db.tx((conn) => insertDocument(conn, req.user, b, totals));
  audit(req, 'document.create', 'document', id, { docType: b.docType, total: totals.total });
  const { d, items } = await loadDocument(req.user.orgId, id);
  res.status(201).json({ data: mapDocument(d, items) });
});

router.patch('/:id', requirePermission('accounting:write'), validate({ params: idParam, body: docBody }), async (req, res) => {
  const { id } = req.valid.params;
  const b = req.valid.body;
  const totals = computeDocTotals(b.items, b.discount);
  await db.tx(async (conn) => {
    const [[d]] = await conn.query('SELECT status FROM documents WHERE id = :id AND org_id = :orgId FOR UPDATE', { id, orgId: req.user.orgId });
    if (!d) throw notFound('ไม่พบเอกสาร');
    if (d.status !== 'draft') throw conflict('แก้ไขได้เฉพาะฉบับร่าง เอกสารที่ออกแล้วต้องยกเลิกและออกใหม่');
    await conn.query('DELETE FROM document_items WHERE document_id = :id', { id });
    await conn.query(
      `UPDATE documents SET doc_type = :docType, doc_date = :docDate, due_date = :dueDate, customer_id = :customerId,
              party_name = :partyName, party_tax_id = :partyTaxId, party_address = :partyAddress,
              subtotal = :subtotal, discount = :discount, vat_amount = :vat, total = :total, ref_doc_id = :refDocId, note = :note
        WHERE id = :id`,
      {
        id,
        docType: b.docType,
        docDate: b.docDate,
        dueDate: b.dueDate ?? null,
        customerId: b.customerId ?? null,
        partyName: b.partyName ?? null,
        partyTaxId: b.partyTaxId ?? null,
        partyAddress: b.partyAddress ?? null,
        subtotal: totals.subtotal,
        discount: totals.discount,
        vat: totals.vat,
        total: totals.total,
        refDocId: b.refDocId ?? null,
        note: b.note ?? null,
      },
    );
    for (const l of totals.lines) {
      await conn.query(
        `INSERT INTO document_items (document_id, product_id, description, quantity, unit_price, discount, vat_type, line_total)
         VALUES (:id, :productId, :description, :quantity, :unitPrice, :discount, :vatType, :lineTotal)`,
        { id, productId: l.productId ?? null, description: l.description, quantity: l.quantity, unitPrice: l.unitPrice, discount: l.discount ?? 0, vatType: l.vatType, lineTotal: l.lineTotal },
      );
    }
  });
  const { d, items } = await loadDocument(req.user.orgId, id);
  res.json({ data: mapDocument(d, items) });
});

/* -------------------------------------------------------------- lifecycle */

/** Issue: assign the next sequential number and post to the ledger. */
router.post(
  '/:id/issue',
  requirePermission('accounting:write'),
  validate({ params: idParam, body: z.object({ paymentMethod: z.enum(['cash', 'transfer', 'card', 'promptpay', 'cheque']).optional() }) }),
  async (req, res) => {
    const { id } = req.valid.params;
    const { orgId, id: userId } = req.user;
    await db.tx(async (conn) => {
      const [[d]] = await conn.query(
        "SELECT *, DATE_FORMAT(doc_date, '%Y-%m-%d') AS doc_date_str FROM documents WHERE id = :id AND org_id = :orgId FOR UPDATE",
        { id, orgId },
      );
      if (!d) throw notFound('ไม่พบเอกสาร');
      if (d.status !== 'draft') throw conflict('เอกสารนี้ออกไปแล้ว');
      const method = req.valid.body.paymentMethod;
      if (PAID_ON_ISSUE.includes(d.doc_type) && !method) throw badRequest('ใบเสร็จต้องระบุวิธีรับชำระ');

      const docNo = await nextNumber(conn, orgId, d.doc_type, d.doc_date_str);
      const total = Number(d.total);
      const vat = Number(d.vat_amount);
      const net = r2(total - vat);
      let status = 'issued';
      let lines = null;
      if (CREDIT_TYPES.includes(d.doc_type)) {
        lines = [
          { account: ACC.AR, debit: total },
          { account: ACC.SALES, credit: net },
          { account: ACC.OUTPUT_VAT, credit: vat },
        ];
      } else if (PAID_ON_ISSUE.includes(d.doc_type)) {
        status = 'paid';
        lines = [
          { account: paymentAccount(method), debit: total },
          { account: ACC.SALES, credit: net },
          { account: ACC.OUTPUT_VAT, credit: vat },
        ];
      } else if (d.doc_type === 'credit_note') {
        lines = [
          { account: ACC.SALES, debit: net },
          { account: ACC.OUTPUT_VAT, debit: vat },
          { account: ACC.AR, credit: total },
        ];
      }
      await conn.query(
        `UPDATE documents SET doc_no = :docNo, status = :status, paid_at = IF(:status = 'paid', UTC_TIMESTAMP(), NULL), payment_method = :method
          WHERE id = :id`,
        { docNo, status, method: method ?? null, id },
      );
      if (lines) {
        await postJournal(conn, { orgId, date: d.doc_date_str, description: `ออกเอกสาร ${docNo} ${d.party_name ?? ''}`.trim(), refType: 'document', refId: id, userId, lines });
      }
    });
    audit(req, 'document.issue', 'document', id);
    const { d, items } = await loadDocument(orgId, id);
    res.json({ data: mapDocument(d, items) });
  },
);

router.post(
  '/:id/pay',
  requirePermission('accounting:write'),
  validate({
    params: idParam,
    body: z.object({ paymentMethod: z.enum(['cash', 'transfer', 'card', 'promptpay', 'cheque']), paidDate: z.iso.date().optional() }),
  }),
  async (req, res) => {
    const { id } = req.valid.params;
    const { orgId, id: userId } = req.user;
    const b = req.valid.body;
    await db.tx(async (conn) => {
      const [[d]] = await conn.query('SELECT * FROM documents WHERE id = :id AND org_id = :orgId FOR UPDATE', { id, orgId });
      if (!d) throw notFound('ไม่พบเอกสาร');
      if (!CREDIT_TYPES.includes(d.doc_type)) throw badRequest('รับชำระได้เฉพาะใบแจ้งหนี้/ใบกำกับภาษี');
      if (d.status !== 'issued') throw conflict(d.status === 'paid' ? 'รับชำระไปแล้ว' : 'ต้องออกเอกสารก่อนรับชำระ');
      await conn.query("UPDATE documents SET status = 'paid', paid_at = UTC_TIMESTAMP(), payment_method = :m WHERE id = :id", { m: b.paymentMethod, id });
      await postJournal(conn, {
        orgId,
        date: b.paidDate ?? localDate(),
        description: `รับชำระ ${d.doc_no}`,
        refType: 'document',
        refId: id,
        userId,
        lines: [
          { account: paymentAccount(b.paymentMethod), debit: Number(d.total) },
          { account: ACC.AR, credit: Number(d.total) },
        ],
      });
    });
    audit(req, 'document.pay', 'document', id, { method: b.paymentMethod });
    const { d, items } = await loadDocument(orgId, id);
    res.json({ data: mapDocument(d, items) });
  },
);

/** Void keeps the number (no gaps) and reverses every journal the document produced. */
router.post(
  '/:id/void',
  requirePermission('accounting:write'),
  validate({ params: idParam, body: z.object({ reason: z.string().trim().min(1).max(200) }) }),
  async (req, res) => {
    const { id } = req.valid.params;
    const { orgId, id: userId } = req.user;
    await db.tx(async (conn) => {
      const [[d]] = await conn.query('SELECT * FROM documents WHERE id = :id AND org_id = :orgId FOR UPDATE', { id, orgId });
      if (!d) throw notFound('ไม่พบเอกสาร');
      if (d.status === 'void') throw conflict('เอกสารนี้ถูกยกเลิกแล้ว');
      if (d.status === 'draft') {
        await conn.query('DELETE FROM documents WHERE id = :id', { id });
        return;
      }
      await conn.query("UPDATE documents SET status = 'void', note = CONCAT(COALESCE(note, ''), :reason) WHERE id = :id", {
        id,
        reason: `\n[ยกเลิก] ${req.valid.body.reason}`,
      });
      await reverseJournalsFor(conn, { orgId, refType: 'document', refId: id, reason: `ยกเลิก ${d.doc_no}`, userId });
    });
    audit(req, 'document.void', 'document', id, { reason: req.valid.body.reason });
    res.json({ data: { ok: true } });
  },
);

/** Quotation -> invoice/tax invoice draft with the same lines. */
router.post(
  '/:id/convert',
  requirePermission('accounting:write'),
  validate({ params: idParam, body: z.object({ docType: z.enum(['invoice', 'tax_invoice', 'tax_invoice_receipt', 'receipt', 'credit_note']) }) }),
  async (req, res) => {
    const { d, items } = await loadDocument(req.user.orgId, req.valid.params.id);
    if (d.status === 'void' || d.status === 'draft') throw badRequest('แปลงได้เฉพาะเอกสารที่ออกแล้ว');
    const b = {
      docType: req.valid.body.docType,
      docDate: localDate(),
      customerId: d.customer_id,
      partyName: d.party_name,
      partyTaxId: d.party_tax_id,
      partyAddress: d.party_address,
      refDocId: d.id,
      discount: Number(d.discount),
      items: items.map((i) => ({
        productId: i.product_id,
        description: i.description,
        quantity: Number(i.quantity),
        unitPrice: Number(i.unit_price),
        discount: Number(i.discount),
        vatType: i.vat_type,
      })),
    };
    const id = await db.tx((conn) => insertDocument(conn, req.user, b, computeDocTotals(b.items, b.discount)));
    const out = await loadDocument(req.user.orgId, id);
    res.status(201).json({ data: mapDocument(out.d, out.items) });
  },
);

/** Withholding-tax certificate (50 ทวิ) generated from an expense with WHT. */
router.post(
  '/wht-certificate',
  requirePermission('accounting:write'),
  validate({ body: z.object({ transactionId: z.number().int().positive() }) }),
  async (req, res) => {
    const { orgId, id: userId } = req.user;
    const id = await db.tx(async (conn) => {
      const [[t]] = await conn.query(
        "SELECT *, DATE_FORMAT(txn_date, '%Y-%m-%d') AS d FROM transactions WHERE id = :id AND org_id = :orgId FOR UPDATE",
        { id: req.valid.body.transactionId, orgId },
      );
      if (!t || t.status !== 'posted') throw notFound('ไม่พบรายการ');
      if (t.type !== 'expense' || !Number(t.wht_amount)) throw badRequest('รายการนี้ไม่มีภาษีหัก ณ ที่จ่าย');
      const [[existing]] = await conn.query(
        "SELECT id FROM documents WHERE transaction_id = :id AND doc_type = 'wht_certificate' AND status <> 'void'",
        { id: t.id },
      );
      if (existing) return existing.id;
      const docNo = await nextNumber(conn, orgId, 'wht_certificate', t.d);
      const [ins] = await conn.query(
        `INSERT INTO documents (org_id, doc_type, doc_no, doc_date, party_name, party_tax_id, subtotal, wht_amount, total, status, transaction_id, created_by)
         VALUES (:orgId, 'wht_certificate', :docNo, :d, :name, :taxId, :amount, :wht, :amount, 'issued', :tid, :userId)`,
        { orgId, docNo, d: t.d, name: t.counterparty, taxId: t.counterparty_tax_id, amount: t.amount, wht: t.wht_amount, tid: t.id, userId },
      );
      await conn.query('UPDATE transactions SET document_id = :doc WHERE id = :id', { doc: ins.insertId, id: t.id });
      return ins.insertId;
    });
    audit(req, 'document.wht_certificate', 'document', id);
    const { d, items } = await loadDocument(orgId, id);
    res.status(201).json({ data: mapDocument(d, items) });
  },
);

module.exports = { router, computeDocTotals };
