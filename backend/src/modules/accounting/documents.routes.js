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
const { getTaxSettings, lineRate } = require('../org/tax');

const router = express.Router();

const SALES_TYPES = ['quotation', 'invoice', 'tax_invoice', 'receipt', 'tax_invoice_receipt', 'credit_note', 'debit_note'];
/** Issued as a sale on credit -> receivable until paid. */
const CREDIT_TYPES = ['invoice', 'tax_invoice', 'debit_note'];
/** Credit / debit notes adjust a tax invoice that was issued (Revenue Code s.86/9, 86/10). */
const ADJUSTS_TAX_INVOICE = ['credit_note', 'debit_note'];
/** What a billing note (ใบวางบิล) can collect: unpaid credit sales, less their credit notes. */
const BILLABLE = ['invoice', 'tax_invoice', 'debit_note', 'credit_note'];
/** Issued and paid at once (cash sale). */
const PAID_ON_ISSUE = ['receipt', 'tax_invoice_receipt'];

const BILLABLE_SQL = `d.org_id = :orgId AND d.doc_type IN (:types) AND d.status = 'issued'
  AND NOT EXISTS (SELECT 1 FROM billing_note_items bi JOIN documents bn ON bn.id = bi.billing_note_id
                   WHERE bi.document_id = d.id AND bn.status = 'issued')`;
const signed = (d) => (d.doc_type === 'credit_note' ? -Number(d.total) : Number(d.total));

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
 * VAT applies to vat7 lines at the shop's rate after spreading the bill discount proportionally;
 * a shop that is not VAT registered adds none.
 */
function computeDocTotals(items, billDiscount, tax) {
  const lines = items.map((i) => ({ ...i, lineTotal: r2(i.quantity * i.unitPrice - (i.discount ?? 0)) }));
  if (lines.some((l) => l.lineTotal < 0)) throw badRequest('ส่วนลดรายการมากกว่าราคา');
  const subtotal = r2(lines.reduce((s, l) => s + l.lineTotal, 0));
  if (billDiscount > subtotal) throw badRequest('ส่วนลดมากกว่ายอดรวม');
  const net = r2(subtotal - billDiscount);
  const ratio = subtotal ? net / subtotal : 0;
  const vat = r2(lines.reduce((s, l) => s + (l.lineTotal * ratio * lineRate(tax, l.vatType)) / 100, 0));
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
      docType: z.enum([...SALES_TYPES, 'wht_certificate', 'billing_note', 'substitute_receipt']).optional(),
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
      f.status === 'unpaid' ? "AND d.status = 'issued' AND d.doc_type IN ('invoice','tax_invoice','debit_note')" : 'AND (:status IS NULL OR d.status = :status)';
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

/** Unpaid documents of one customer (by customer record, or by name when there is none). */
router.get(
  '/billable',
  requirePermission('accounting:read'),
  validate({ query: z.object({ customerId: z.coerce.number().int().positive().optional(), partyName: z.string().trim().max(191).optional() }) }),
  async (req, res) => {
    const { customerId, partyName } = req.valid.query;
    if (!customerId && !partyName) {
      // who can be billed: one row per customer with something unpaid
      const rows = await db.query(
        `SELECT d.customer_id, d.party_name, COUNT(*) AS n, SUM(CASE WHEN d.doc_type = 'credit_note' THEN -d.total ELSE d.total END) AS amount
           FROM documents d WHERE ${BILLABLE_SQL} GROUP BY d.customer_id, d.party_name
          HAVING SUM(d.doc_type <> 'credit_note') > 0 ORDER BY d.party_name`,
        { orgId: req.user.orgId, types: BILLABLE },
      );
      return res.json({ data: rows.map((r) => ({ customerId: r.customer_id, partyName: r.party_name, count: Number(r.n), amount: Number(r.amount) })) });
    }
    const rows = await db.query(
      `SELECT d.*, DATE_FORMAT(d.doc_date, '%Y-%m-%d') AS doc_date_str, DATE_FORMAT(d.due_date, '%Y-%m-%d') AS due_date_str
         FROM documents d
        WHERE ${BILLABLE_SQL} AND ${customerId ? 'd.customer_id = :customerId' : 'd.customer_id IS NULL AND d.party_name = :partyName'}
        ORDER BY d.doc_date, d.id`,
      { orgId: req.user.orgId, types: BILLABLE, customerId: customerId ?? null, partyName: partyName ?? null },
    );
    res.json({ data: rows.map((r) => ({ ...mapDocument(r, []), signedAmount: signed(r) })) });
  },
);

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
  if (d.payment_voucher_id) {
    source = await db.one(
      `SELECT wht_rate, wht_income_type, payee_type AS counterparty_type, DATE_FORMAT(pay_date, '%Y-%m-%d') AS txn_date, wht_base AS amount, wht_amount
         FROM payment_vouchers WHERE id = :id`,
      { id: d.payment_voucher_id },
    );
  } else if (d.transaction_id) {
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
      billedDocuments: d.doc_type === 'billing_note' ? await billedDocuments(d.id) : undefined,
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

/** A credit/debit note must point at a tax invoice of this shop that was actually issued. */
async function assertAdjustsTaxInvoice(conn, orgId, docType, refDocId) {
  if (!ADJUSTS_TAX_INVOICE.includes(docType)) return;
  const label = docType === 'credit_note' ? 'ใบลดหนี้' : 'ใบเพิ่มหนี้';
  if (!refDocId) throw badRequest(`${label}ต้องอ้างอิงใบกำกับภาษีเดิม`);
  const [[ref]] = await conn.query('SELECT doc_type, status FROM documents WHERE id = :id AND org_id = :orgId', { id: refDocId, orgId });
  if (!ref) throw badRequest('ไม่พบใบกำกับภาษีที่อ้างอิง');
  if (!['tax_invoice', 'tax_invoice_receipt'].includes(ref.doc_type)) throw badRequest(`${label}ต้องอ้างอิงใบกำกับภาษี`);
  if (!['issued', 'paid'].includes(ref.status)) throw badRequest(`ใบกำกับภาษีที่อ้างอิงต้องออกแล้วและไม่ถูกยกเลิก`);
}

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
  if (['tax_invoice', 'tax_invoice_receipt', ...ADJUSTS_TAX_INVOICE].includes(b.docType) && !party.name) {
    throw badRequest('ใบกำกับภาษีต้องระบุชื่อผู้ซื้อ');
  }
  await assertAdjustsTaxInvoice(conn, user.orgId, b.docType, b.refDocId ?? extra.refDocId ?? null);
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
  const totals = computeDocTotals(b.items, b.discount, await getTaxSettings(req.user.orgId));
  const id = await db.tx((conn) => insertDocument(conn, req.user, b, totals));
  audit(req, 'document.create', 'document', id, { docType: b.docType, total: totals.total });
  const { d, items } = await loadDocument(req.user.orgId, id);
  res.status(201).json({ data: mapDocument(d, items) });
});

router.patch('/:id', requirePermission('accounting:write'), validate({ params: idParam, body: docBody }), async (req, res) => {
  const { id } = req.valid.params;
  const b = req.valid.body;
  const totals = computeDocTotals(b.items, b.discount, await getTaxSettings(req.user.orgId));
  await db.tx(async (conn) => {
    const [[d]] = await conn.query('SELECT status FROM documents WHERE id = :id AND org_id = :orgId FOR UPDATE', { id, orgId: req.user.orgId });
    if (!d) throw notFound('ไม่พบเอกสาร');
    if (d.status !== 'draft') throw conflict('แก้ไขได้เฉพาะฉบับร่าง เอกสารที่ออกแล้วต้องยกเลิกและออกใหม่');
    await assertAdjustsTaxInvoice(conn, req.user.orgId, b.docType, b.refDocId ?? null);
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
      // the tax invoice may have been voided since the draft was made
      await assertAdjustsTaxInvoice(conn, orgId, d.doc_type, d.ref_doc_id);
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
      if (d.doc_type === 'billing_note') throw badRequest('ใบวางบิลรับชำระที่ปุ่มรับชำระของใบวางบิล');
      if (!CREDIT_TYPES.includes(d.doc_type)) throw badRequest('รับชำระได้เฉพาะใบแจ้งหนี้/ใบกำกับภาษี/ใบเพิ่มหนี้');
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
      if (d.doc_type === 'billing_note' && d.status === 'paid') {
        // the payment is reversed above, so what it settled is unpaid again
        await conn.query(
          `UPDATE documents SET status = 'issued', paid_at = NULL, payment_method = NULL
            WHERE status = 'paid' AND id IN (SELECT document_id FROM billing_note_items WHERE billing_note_id = :id AND settled = 1)`,
          { id },
        );
      }
    });
    audit(req, 'document.void', 'document', id, { reason: req.valid.body.reason });
    res.json({ data: { ok: true } });
  },
);

/** Quotation -> invoice/tax invoice draft with the same lines. */
router.post(
  '/:id/convert',
  requirePermission('accounting:write'),
  validate({ params: idParam, body: z.object({ docType: z.enum(['invoice', 'tax_invoice', 'tax_invoice_receipt', 'receipt', 'credit_note', 'debit_note']) }) }),
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
    const totals = computeDocTotals(b.items, b.discount, await getTaxSettings(req.user.orgId));
    const id = await db.tx((conn) => insertDocument(conn, req.user, b, totals));
    const out = await loadDocument(req.user.orgId, id);
    res.status(201).json({ data: mapDocument(out.d, out.items) });
  },
);

/* ------------------------------------------------------------ billing note */

/**
 * A billing note (ใบวางบิล) collects a customer's unpaid invoices, tax invoices and debit notes, less
 * their credit notes, into one request for payment. It is only a letter: issuing it posts nothing.
 * Paying it settles everything inside with one journal for the net amount.
 */

router.post(
  '/billing-note',
  requirePermission('accounting:write'),
  validate({
    body: z.object({
      docDate: z.iso.date(),
      dueDate: z.iso.date().nullable().optional(),
      documentIds: z.array(z.number().int().positive()).min(1, 'เลือกเอกสารอย่างน้อย 1 ใบ').max(100),
      note: z.string().trim().max(2000).nullable().optional(),
    }),
  }),
  async (req, res) => {
    const b = req.valid.body;
    const { orgId, id: userId } = req.user;
    const ids = [...new Set(b.documentIds)];
    const id = await db.tx(async (conn) => {
      const [docs] = await conn.query(`SELECT d.* FROM documents d WHERE ${BILLABLE_SQL} AND d.id IN (:ids) FOR UPDATE`, { orgId, types: BILLABLE, ids });
      if (docs.length !== ids.length) throw badRequest('มีเอกสารที่ชำระแล้ว ถูกยกเลิก หรืออยู่ในใบวางบิลอื่นแล้ว');
      const key = (d) => (d.customer_id ? `c${d.customer_id}` : `n${d.party_name ?? ''}`);
      if (new Set(docs.map(key)).size > 1) throw badRequest('ใบวางบิลหนึ่งใบรวมได้เฉพาะเอกสารของลูกค้ารายเดียวกัน');
      if (!docs.some((d) => d.doc_type !== 'credit_note')) throw badRequest('ต้องมีใบแจ้งหนี้อย่างน้อย 1 ใบ');
      const total = r2(docs.reduce((sum, d) => sum + signed(d), 0));
      if (total <= 0) throw badRequest('ยอดวางบิลต้องมากกว่า 0');
      const first = docs.find((d) => d.doc_type !== 'credit_note');
      const docNo = await nextNumber(conn, orgId, 'billing_note', b.docDate);
      const [ins] = await conn.query(
        `INSERT INTO documents (org_id, doc_type, doc_no, doc_date, due_date, customer_id, party_name, party_tax_id, party_address,
                                subtotal, discount, vat_amount, total, status, note, created_by)
         VALUES (:orgId, 'billing_note', :docNo, :docDate, :dueDate, :customerId, :partyName, :partyTaxId, :partyAddress,
                 :total, 0, 0, :total, 'issued', :note, :userId)`,
        {
          orgId,
          docNo,
          docDate: b.docDate,
          dueDate: b.dueDate ?? null,
          customerId: first.customer_id,
          partyName: first.party_name,
          partyTaxId: first.party_tax_id,
          partyAddress: first.party_address,
          total,
          note: b.note ?? null,
          userId,
        },
      );
      for (const d of docs) {
        await conn.query('INSERT INTO billing_note_items (billing_note_id, document_id, amount) VALUES (:bn, :doc, :amount)', {
          bn: ins.insertId,
          doc: d.id,
          amount: signed(d),
        });
      }
      return ins.insertId;
    });
    audit(req, 'document.billing_note', 'document', id, { documents: ids.length });
    const { d, items } = await loadDocument(orgId, id);
    res.status(201).json({ data: { ...mapDocument(d, items), billedDocuments: await billedDocuments(id) } });
  },
);

async function billedDocuments(billingNoteId) {
  const rows = await db.query(
    `SELECT d.id, d.doc_type, d.doc_no, d.status, bi.amount, DATE_FORMAT(d.doc_date, '%Y-%m-%d') AS doc_date, DATE_FORMAT(d.due_date, '%Y-%m-%d') AS due_date
       FROM billing_note_items bi JOIN documents d ON d.id = bi.document_id
      WHERE bi.billing_note_id = :id ORDER BY d.doc_date, d.id`,
    { id: billingNoteId },
  );
  return rows.map((r) => ({ id: r.id, docType: r.doc_type, docNo: r.doc_no, status: r.status, docDate: r.doc_date, dueDate: r.due_date, amount: Number(r.amount) }));
}

/** The customer paid the billing note: settle what is still open inside it with one journal. */
router.post(
  '/:id/settle',
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
      const [[bn]] = await conn.query('SELECT * FROM documents WHERE id = :id AND org_id = :orgId FOR UPDATE', { id, orgId });
      if (!bn || bn.doc_type !== 'billing_note') throw notFound('ไม่พบใบวางบิล');
      if (bn.status !== 'issued') throw conflict(bn.status === 'paid' ? 'รับชำระไปแล้ว' : 'ใบวางบิลนี้ถูกยกเลิกแล้ว');
      const [open] = await conn.query(
        `SELECT d.id, d.doc_type, d.total FROM billing_note_items bi JOIN documents d ON d.id = bi.document_id
          WHERE bi.billing_note_id = :id AND d.status = 'issued' FOR UPDATE`,
        { id },
      );
      const net = r2(open.reduce((sum, d) => sum + signed(d), 0));
      if (net < 0) throw conflict('ยอดค้างในใบวางบิลติดลบ (ใบแจ้งหนี้ถูกชำระแยกไปแล้ว) — ยกเลิกใบวางบิลนี้แล้วออกใหม่');
      if (open.length) {
        const ids = open.map((d) => d.id);
        await conn.query("UPDATE documents SET status = 'paid', paid_at = UTC_TIMESTAMP(), payment_method = :m WHERE id IN (:ids)", { m: b.paymentMethod, ids });
        await conn.query('UPDATE billing_note_items SET settled = 1 WHERE billing_note_id = :id AND document_id IN (:ids)', { id, ids });
      }
      await conn.query("UPDATE documents SET status = 'paid', paid_at = UTC_TIMESTAMP(), payment_method = :m WHERE id = :id", { m: b.paymentMethod, id });
      await postJournal(conn, {
        orgId,
        date: b.paidDate ?? localDate(),
        description: `รับชำระตามใบวางบิล ${bn.doc_no} ${bn.party_name ?? ''}`.trim(),
        refType: 'document',
        refId: id,
        userId,
        lines: [
          { account: paymentAccount(b.paymentMethod), debit: net },
          { account: ACC.AR, credit: net },
        ],
      });
    });
    audit(req, 'document.settle', 'document', id, { method: b.paymentMethod });
    const { d, items } = await loadDocument(orgId, id);
    res.json({ data: { ...mapDocument(d, items), billedDocuments: await billedDocuments(id) } });
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

/**
 * ใบรับรองแทนใบเสร็จรับเงิน: for an expense paid to someone who gives no receipt (a market stall, a
 * day labourer). Only for expenses without VAT; it records nothing new in the books (the expense is).
 */
router.post(
  '/substitute-receipt',
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
      if (t.type !== 'expense') throw badRequest('ใช้ได้กับรายจ่ายเท่านั้น');
      if (Number(t.vat_amount) > 0) throw badRequest('รายจ่ายที่มีภาษีมูลค่าเพิ่มต้องใช้ใบกำกับภาษีของผู้ขาย ไม่ใช้ใบรับรองแทนใบเสร็จ');
      const [[existing]] = await conn.query("SELECT id FROM documents WHERE transaction_id = :id AND doc_type = 'substitute_receipt' AND status <> 'void'", {
        id: t.id,
      });
      if (existing) return existing.id;
      const docNo = await nextNumber(conn, orgId, 'substitute_receipt', t.d);
      const [ins] = await conn.query(
        `INSERT INTO documents (org_id, doc_type, doc_no, doc_date, party_name, party_tax_id, subtotal, total, status, transaction_id, note, created_by)
         VALUES (:orgId, 'substitute_receipt', :docNo, :d, :name, :taxId, :amount, :amount, 'issued', :tid, :note, :userId)`,
        { orgId, docNo, d: t.d, name: t.counterparty, taxId: t.counterparty_tax_id, amount: t.amount, tid: t.id, note: t.category, userId },
      );
      await conn.query(
        `INSERT INTO document_items (document_id, description, quantity, unit_price, discount, vat_type, line_total)
         VALUES (:doc, :desc, 1, :amount, 0, 'exempt', :amount)`,
        { doc: ins.insertId, desc: (t.description || t.category).slice(0, 500), amount: t.amount },
      );
      return ins.insertId;
    });
    audit(req, 'document.substitute_receipt', 'document', id);
    const { d, items } = await loadDocument(orgId, id);
    res.status(201).json({ data: mapDocument(d, items) });
  },
);

module.exports = { router, computeDocTotals };
