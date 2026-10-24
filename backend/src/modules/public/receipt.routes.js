'use strict';

// The customer's own receipt page, opened from the QR on the printed receipt (no login).
// The long random token in the link is the only credential: it shows one bill, lets the customer
// ask for a full tax invoice, and lets them claim the bill's points under their phone number.

const express = require('express');
const { rateLimit, ipKeyGenerator } = require('express-rate-limit');
const { z } = require('zod');
const env = require('../../config/env');
const db = require('../../db/pool');
const { validate } = require('../../core/http');
const { badRequest, conflict, notFound } = require('../../core/errors');
const { getTaxSettings } = require('../org/tax');
const pos = require('../pos/pos.service');
const taxInvoices = require('../pos/tax-invoice');

const router = express.Router();

const limiter = (limit) =>
  rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: env.isTest ? 1000 : limit,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    keyGenerator: (req) => ipKeyGenerator(req.ip ?? ''),
    message: { error: { code: 'RATE_LIMITED', message: 'ทำรายการบ่อยเกินไป กรุณารอสักครู่' } },
  });
const read = limiter(120);
const write = limiter(15);

const tokenParam = z.object({ token: z.string().regex(/^[A-Za-z0-9_-]{22}$/) });
/** Points can be claimed for a week after the sale. */
const CLAIM_WINDOW_DAYS = 7;
const ageDays = (d) => (Date.now() - new Date(d).getTime()) / 86_400_000;

async function orderByToken(token, conn = null) {
  const sql = `SELECT * FROM sales_orders WHERE receipt_token = :token AND channel = 'pos'${conn ? ' FOR UPDATE' : ''}`;
  const o = conn ? (await conn.query(sql, { token }))[0][0] : await db.one(sql, { token });
  if (!o) throw notFound('ไม่พบใบเสร็จนี้ — ตรวจสอบ QR หรือลิงก์อีกครั้ง');
  return o;
}

const METHOD_LABEL = { cash: 'เงินสด', promptpay: 'PromptPay', card: 'บัตร', transfer: 'โอนเงิน', ewallet: 'e-Wallet', platform: 'แพลตฟอร์ม' };

router.get('/:token', read, validate({ params: tokenParam }), async (req, res) => {
  const o = await orderByToken(req.valid.params.token);
  const [org, branch, items, pays, settings, tax, tir] = await Promise.all([
    db.one('SELECT name, legal_name, tax_id, address, phone FROM organizations WHERE id = :id', { id: o.org_id }),
    db.one('SELECT name, branch_no FROM branches WHERE id = :id', { id: o.branch_id }),
    db.query('SELECT name, unit_name, quantity, unit_price, line_total FROM sales_order_items WHERE order_id = :id ORDER BY id', { id: o.id }),
    db.query('SELECT method, amount FROM payments WHERE order_id = :id AND amount > 0 ORDER BY id', { id: o.id }),
    pos.getSettings(o.org_id),
    getTaxSettings(o.org_id),
    db.one(
      `SELECT r.status, r.name, r.tax_id, r.branch_no, r.address, d.id AS doc_id, d.doc_no, DATE_FORMAT(d.doc_date, '%Y-%m-%d') AS doc_date
         FROM tax_invoice_requests r LEFT JOIN documents d ON d.id = r.document_id WHERE r.order_id = :id`,
      { id: o.id },
    ),
  ]);
  const completed = o.status === 'completed' && Number(o.refunded_amount ?? 0) === 0;
  let invoice = null;
  if (tir?.status === 'issued' && tir.doc_id) {
    const lines = await db.query('SELECT description, quantity, unit_price, line_total FROM document_items WHERE document_id = :id ORDER BY id', { id: tir.doc_id });
    invoice = {
      docNo: tir.doc_no,
      docDate: tir.doc_date,
      buyer: { name: tir.name, taxId: tir.tax_id, branchNo: tir.branch_no, address: tir.address },
      lines: lines.map((l) => ({ description: l.description, quantity: Number(l.quantity), unitPrice: Number(l.unit_price), lineTotal: Number(l.line_total) })),
      subtotal: Number(o.total) - Number(o.vat_amount),
      vat: Number(o.vat_amount),
      total: Number(o.total),
    };
  }
  const earnBaht = Number(settings.pointsEarnBaht) || 0;
  res.json({
    data: {
      orderNo: o.order_no,
      orderedAt: o.ordered_at,
      status: o.status,
      seller: { name: org.legal_name || org.name, taxId: org.tax_id, address: org.address, phone: org.phone, branchName: branch?.name ?? null, branchNo: branch?.branch_no ?? null, vatRegistered: tax.vatRegistered },
      items: items.map((i) => ({ name: i.name, unitName: i.unit_name, quantity: Number(i.quantity), unitPrice: Number(i.unit_price), lineTotal: Number(i.line_total) })),
      subtotal: Number(o.subtotal),
      discount: Number(o.discount),
      vat: Number(o.vat_amount),
      total: Number(o.total),
      payments: pays.map((p) => ({ method: METHOD_LABEL[p.method] ?? p.method, amount: Number(p.amount) })),
      lineOaId: settings.lineOaId || null,
      points: {
        isMember: o.customer_id != null,
        earned: Number(o.points_earned ?? 0),
        canClaim: completed && o.customer_id == null && earnBaht > 0 && ageDays(o.ordered_at) <= CLAIM_WINDOW_DAYS,
        wouldEarn: earnBaht > 0 ? Math.floor(Number(o.total) / earnBaht) : 0,
      },
      taxInvoice: {
        status: tir?.status ?? 'none',
        canRequest: tax.vatRegistered && completed && tir?.status !== 'issued' && ageDays(o.ordered_at) <= taxInvoices.REQUEST_WINDOW_DAYS,
        windowDays: taxInvoices.REQUEST_WINDOW_DAYS,
        invoice,
      },
    },
  });
});

router.post(
  '/:token/tax-invoice',
  write,
  validate({
    params: tokenParam,
    body: z.object({
      name: z.string().trim().min(1, 'กรุณาระบุชื่อ').max(191),
      taxId: z.string().trim().regex(/^\d{13}$/, 'เลขประจำตัวผู้เสียภาษีต้องเป็นตัวเลข 13 หลัก'),
      branchNo: z.string().trim().regex(/^\d{5}$/, 'รหัสสาขาเป็นตัวเลข 5 หลัก เช่น 00000').default('00000'),
      address: z.string().trim().min(5, 'กรุณาระบุที่อยู่').max(1000),
      email: z.email('อีเมลไม่ถูกต้อง').max(191).optional().or(z.literal('').transform(() => undefined)),
    }),
  }),
  async (req, res) => {
    const b = req.valid.body;
    if (!taxInvoices.isValidTaxId(b.taxId)) throw badRequest('เลขประจำตัวผู้เสียภาษีไม่ถูกต้อง กรุณาตรวจสอบอีกครั้ง');
    const out = await db.tx(async (conn) => {
      const o = await orderByToken(req.valid.params.token, conn);
      const tax = await getTaxSettings(o.org_id);
      const [[existing]] = await conn.query('SELECT status FROM tax_invoice_requests WHERE order_id = :id FOR UPDATE', { id: o.id });
      const problem = taxInvoices.problemFor(o, tax, existing);
      if (problem) throw conflict(problem);
      if (ageDays(o.ordered_at) > taxInvoices.REQUEST_WINDOW_DAYS) throw conflict(`ขอใบกำกับภาษีได้ภายใน ${taxInvoices.REQUEST_WINDOW_DAYS} วันหลังซื้อ`);
      await conn.query(
        `INSERT INTO tax_invoice_requests (org_id, order_id, name, tax_id, branch_no, address, email, status)
         VALUES (:orgId, :orderId, :name, :taxId, :branchNo, :address, :email, 'pending')
         ON DUPLICATE KEY UPDATE name = VALUES(name), tax_id = VALUES(tax_id), branch_no = VALUES(branch_no), address = VALUES(address), email = VALUES(email)`,
        { orgId: o.org_id, orderId: o.id, name: b.name, taxId: b.taxId, branchNo: b.branchNo, address: b.address, email: b.email ?? null },
      );
      const settings = await pos.getSettings(o.org_id);
      if (settings.taxInvoiceAuto) {
        const r = await taxInvoices.issueForOrder(conn, { orgId: o.org_id, id: o.created_by }, o.id, { ...b, email: b.email ?? null });
        return { status: 'issued', docNo: r.docNo };
      }
      return { status: 'pending' };
    });
    res.status(201).json({ data: out });
  },
);

/** Thai mobile/landline as typed: 0812345678, 081-234-5678, +66 81 234 5678 -> 0812345678. */
function normalizePhone(v) {
  let d = String(v).replace(/\D/g, '');
  if (d.startsWith('66') && d.length >= 11) d = `0${d.slice(2)}`;
  return /^0\d{8,9}$/.test(d) ? d : null;
}

router.post(
  '/:token/member',
  write,
  validate({
    params: tokenParam,
    body: z.object({
      phone: z.string().trim().min(8).max(20),
      name: z.string().trim().max(191).optional(),
      consentMarketing: z.boolean().default(false),
    }),
  }),
  async (req, res) => {
    const phone = normalizePhone(req.valid.body.phone);
    if (!phone) throw badRequest('เบอร์โทรไม่ถูกต้อง ตัวอย่าง 0812345678');
    const out = await db.tx(async (conn) => {
      const o = await orderByToken(req.valid.params.token, conn);
      const settings = await pos.getSettings(o.org_id);
      const earnBaht = Number(settings.pointsEarnBaht) || 0;
      if (!earnBaht) throw conflict('ร้านนี้ยังไม่เปิดระบบสะสมแต้ม');
      if (o.customer_id) throw conflict('บิลนี้สะสมแต้มไปแล้ว');
      if (o.status !== 'completed' || Number(o.refunded_amount ?? 0) > 0) throw conflict('บิลนี้ถูกยกเลิกหรือคืนสินค้าแล้ว สะสมแต้มไม่ได้');
      if (ageDays(o.ordered_at) > CLAIM_WINDOW_DAYS) throw conflict(`สะสมแต้มได้ภายใน ${CLAIM_WINDOW_DAYS} วันหลังซื้อ`);
      let [[c]] = await conn.query('SELECT id, name, points FROM customers WHERE org_id = :orgId AND phone = :phone FOR UPDATE', { orgId: o.org_id, phone });
      let created = false;
      if (!c) {
        const [ins] = await conn.query(
          'INSERT INTO customers (org_id, name, phone, consent_marketing) VALUES (:orgId, :name, :phone, :consent)',
          { orgId: o.org_id, name: req.valid.body.name || `สมาชิก ${phone.slice(-4)}`, phone, consent: req.valid.body.consentMarketing ? 1 : 0 },
        );
        await conn.query('UPDATE customers SET member_no = :no WHERE id = :id', { no: `M${String(ins.insertId).padStart(6, '0')}`, id: ins.insertId });
        c = { id: ins.insertId, points: 0 };
        created = true;
      }
      const earned = Math.floor(Number(o.total) / earnBaht);
      await conn.query('UPDATE sales_orders SET customer_id = :cid, points_earned = :earned WHERE id = :id', { cid: c.id, earned, id: o.id });
      await conn.query('UPDATE customers SET total_spent = total_spent + :total, order_count = order_count + 1, points = points + :earned WHERE id = :id', {
        total: Number(o.total),
        earned,
        id: c.id,
      });
      return { earned, balance: Number(c.points) + earned, created };
    });
    res.status(201).json({ data: out });
  },
);

module.exports = { router, normalizePhone };
