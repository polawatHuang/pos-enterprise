'use strict';

// Full tax invoice (ใบกำกับภาษีเต็มรูป) for a POS bill, on the customer's request.
//
// The sale already posted its own journal (sales, output VAT, cash/bank), so the document is a
// record of that sale, not a second one: it is linked by order_id (the PP.30 VAT report skips
// documents with an order_id) and posts nothing to the ledger.

const { badRequest, conflict, notFound } = require('../../core/errors');
const { localDate } = require('../../utils/dates');
const { r2, nextNumber } = require('../accounting/ledger.service');
const { getTaxSettings, lineRate } = require('../org/tax');

/** Thai 13-digit national / tax id: the 13th digit is a mod-11 check of the first twelve. */
function isValidTaxId(id) {
  if (!/^\d{13}$/.test(id)) return false;
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(id[i]) * (13 - i);
  return (11 - (sum % 11)) % 10 === Number(id[12]);
}

const DOC_PAY_METHOD = { cash: 'cash', promptpay: 'promptpay', card: 'card', transfer: 'transfer', ewallet: 'transfer' };

/** Days after the sale a customer can still ask for a full tax invoice. */
const REQUEST_WINDOW_DAYS = 30;

/** Why this bill cannot get a full tax invoice, or null. */
function problemFor(order, tax, existing) {
  if (!tax.vatRegistered) return 'ร้านยังไม่ได้จดทะเบียนภาษีมูลค่าเพิ่ม จึงออกใบกำกับภาษีไม่ได้';
  if (order.status !== 'completed') return 'บิลนี้ถูกยกเลิกหรือคืนสินค้าแล้ว';
  if (Number(order.refunded_amount ?? 0) > 0) return 'บิลนี้มีการคืนสินค้าแล้ว ออกใบกำกับภาษีเต็มรูปไม่ได้';
  if (existing?.status === 'issued') return 'บิลนี้ออกใบกำกับภาษีเต็มรูปไปแล้ว';
  return null;
}

/**
 * Creates and numbers the document for `orderId` from the buyer details, inside the caller's
 * transaction. Lines are the bill's own lines turned into VAT-exclusive prices so the invoice
 * adds up to exactly what the customer paid.
 */
async function issueForOrder(conn, user, orderId, buyer) {
  const [[o]] = await conn.query('SELECT * FROM sales_orders WHERE id = :orderId AND org_id = :orgId AND channel = :ch FOR UPDATE', {
    orderId,
    orgId: user.orgId,
    ch: 'pos',
  });
  if (!o) throw notFound('ไม่พบบิล');
  const tax = await getTaxSettings(user.orgId);
  const [[existing]] = await conn.query('SELECT * FROM tax_invoice_requests WHERE order_id = :orderId FOR UPDATE', { orderId });
  const problem = problemFor(o, tax, existing);
  if (problem) throw conflict(problem);
  const [[open]] = await conn.query("SELECT id, doc_no FROM documents WHERE order_id = :orderId AND status <> 'void' LIMIT 1", { orderId });
  if (open) throw conflict(`บิลนี้มีใบกำกับภาษี ${open.doc_no} แล้ว`);

  const [items] = await conn.query(
    `SELECT i.name, i.quantity, i.line_total, i.product_id, p.vat_type
       FROM sales_order_items i JOIN products p ON p.id = i.product_id WHERE i.order_id = :orderId ORDER BY i.id`,
    { orderId },
  );
  const total = Number(o.total);
  const vat = Number(o.vat_amount);
  const subtotal = Number(o.subtotal);
  const ratio = subtotal ? total / subtotal : 0; // the bill-level discount spread over the lines
  const lines = items.map((i) => {
    const gross = Number(i.line_total) * ratio;
    const rate = lineRate(tax, i.vat_type);
    const lineVat = (gross * rate) / (100 + rate);
    return { productId: i.product_id, description: i.name, quantity: Number(i.quantity), vatType: i.vat_type, net: r2(gross - lineVat) };
  });
  // Rounding: the lines carry exactly (total - VAT) between them
  const target = r2(total - vat);
  const drift = r2(target - lines.reduce((s, l) => s + l.net, 0));
  if (lines.length) lines[lines.length - 1].net = r2(lines[lines.length - 1].net + drift);

  const date = localDate();
  const [pay] = await conn.query('SELECT method FROM payments WHERE order_id = :orderId AND amount > 0 ORDER BY amount DESC LIMIT 1', { orderId });
  const method = DOC_PAY_METHOD[pay[0]?.method] ?? 'cash';
  const docNo = await nextNumber(conn, user.orgId, 'tax_invoice_receipt', date);
  const [ins] = await conn.query(
    `INSERT INTO documents (org_id, doc_type, doc_no, doc_date, customer_id, party_name, party_tax_id, party_address,
                            subtotal, discount, vat_amount, total, status, paid_at, payment_method, order_id, note, created_by)
     VALUES (:orgId, 'tax_invoice_receipt', :docNo, :date, :customerId, :name, :taxId, :address,
             :subtotal, 0, :vat, :total, 'paid', UTC_TIMESTAMP(), :method, :orderId, :note, :userId)`,
    {
      orgId: user.orgId,
      docNo,
      date,
      customerId: o.customer_id,
      name: buyer.name,
      taxId: buyer.taxId,
      address: `${buyer.address}${buyer.branchNo && buyer.branchNo !== '00000' ? ` (สาขา ${buyer.branchNo})` : ''}`,
      subtotal: target,
      vat,
      total,
      method,
      orderId,
      note: `ออกแทนใบกำกับภาษีอย่างย่อ ${o.order_no}`,
      userId: user.id,
    },
  );
  for (const l of lines) {
    await conn.query(
      `INSERT INTO document_items (document_id, product_id, description, quantity, unit_price, discount, vat_type, line_total)
       VALUES (:id, :productId, :description, :quantity, :unitPrice, 0, :vatType, :lineTotal)`,
      { id: ins.insertId, productId: l.productId, description: l.description, quantity: l.quantity, unitPrice: l.quantity ? r2(l.net / l.quantity) : l.net, vatType: l.vatType, lineTotal: l.net },
    );
  }
  await conn.query(
    `INSERT INTO tax_invoice_requests (org_id, order_id, name, tax_id, branch_no, address, email, status, document_id)
     VALUES (:orgId, :orderId, :name, :taxId, :branchNo, :address, :email, 'issued', :docId)
     ON DUPLICATE KEY UPDATE name = VALUES(name), tax_id = VALUES(tax_id), branch_no = VALUES(branch_no), address = VALUES(address),
                             email = COALESCE(VALUES(email), email), status = 'issued', document_id = VALUES(document_id)`,
    { orgId: user.orgId, orderId, name: buyer.name, taxId: buyer.taxId, branchNo: buyer.branchNo || '00000', address: buyer.address, email: buyer.email ?? null, docId: ins.insertId },
  );
  return { documentId: ins.insertId, docNo };
}

function assertBuyer(b) {
  if (!b.name?.trim()) throw badRequest('กรุณาระบุชื่อผู้ซื้อ');
  if (!isValidTaxId(b.taxId)) throw badRequest('เลขประจำตัวผู้เสียภาษีไม่ถูกต้อง (13 หลัก)');
  if (!b.address?.trim()) throw badRequest('กรุณาระบุที่อยู่');
}

module.exports = { isValidTaxId, issueForOrder, problemFor, assertBuyer, REQUEST_WINDOW_DAYS };
