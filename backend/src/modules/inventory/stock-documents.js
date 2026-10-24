'use strict';

// Numbered stock documents: ใบรับสินค้า (GR), ใบปรับสต๊อก (AJ) and ใบตัดของเสีย (WS). The header is
// made in the same transaction as the stock movements, which point to it (stock_document_id), so a
// receipt or write-off can be found, printed and cited in the stock ledger (มาตรา 87(3)).

const db = require('../../db/pool');
const { notFound } = require('../../core/errors');
const { localDate } = require('../../utils/dates');
const { r2, nextNumber } = require('../accounting/ledger.service');

/** Sequence (and prefix) per type: GR / AJ / WS, see ledger.service PREFIX. */
const SEQ = { goods_receipt: 'stock_gr', adjustment: 'stock_aj', waste: 'stock_ws' };

/** Opens a document (inside the caller's transaction); add movements with its id, then `closeStockDocument`. */
async function openStockDocument(conn, { orgId, type, warehouseId, supplierId = null, purchaseOrderId = null, reference = null, reason = null, note = null, userId = null, date = localDate() }) {
  const docNo = await nextNumber(conn, orgId, SEQ[type], date);
  const [r] = await conn.query(
    `INSERT INTO stock_documents (org_id, doc_type, doc_no, doc_date, warehouse_id, supplier_id, purchase_order_id, reference, reason, note, created_by)
     VALUES (:orgId, :type, :docNo, :date, :warehouseId, :supplierId, :purchaseOrderId, :reference, :reason, :note, :userId)`,
    { orgId, type, docNo, date, warehouseId, supplierId, purchaseOrderId, reference, reason, note: note ? String(note).slice(0, 255) : null, userId },
  );
  return { id: r.insertId, docNo };
}

/** Total value at the movements' unit cost (falls back to the product cost). */
async function closeStockDocument(conn, id) {
  await conn.query(
    `UPDATE stock_documents sd SET total_cost = (
       SELECT COALESCE(SUM(ABS(m.quantity) * COALESCE(m.unit_cost, p.cost, 0)), 0)
         FROM stock_movements m JOIN products p ON p.id = m.product_id WHERE m.stock_document_id = sd.id)
      WHERE sd.id = :id`,
    { id },
  );
}

async function getStockDocument(orgId, id) {
  const d = await db.one(
    `SELECT sd.*, DATE_FORMAT(sd.doc_date, '%Y-%m-%d') AS day, w.name AS warehouse_name, s.name AS supplier_name, s.tax_id AS supplier_tax_id,
            po.po_no, u.full_name AS created_by_name
       FROM stock_documents sd
       JOIN warehouses w ON w.id = sd.warehouse_id
       LEFT JOIN suppliers s ON s.id = sd.supplier_id
       LEFT JOIN purchase_orders po ON po.id = sd.purchase_order_id
       LEFT JOIN users u ON u.id = sd.created_by
      WHERE sd.id = :id AND sd.org_id = :orgId`,
    { id, orgId },
  );
  if (!d) throw notFound('ไม่พบเอกสาร');
  const lines = await db.query(
    `SELECT m.product_id, p.sku, p.name, p.unit, m.quantity, COALESCE(m.unit_cost, p.cost) AS unit_cost, m.note
       FROM stock_movements m JOIN products p ON p.id = m.product_id
      WHERE m.stock_document_id = :id ORDER BY m.id`,
    { id },
  );
  const org = await db.one('SELECT name, legal_name, tax_id, address FROM organizations WHERE id = :orgId', { orgId });
  return {
    org: { name: org.name, legalName: org.legal_name, taxId: org.tax_id, address: org.address },
    id: d.id,
    docType: d.doc_type,
    docNo: d.doc_no,
    docDate: d.day,
    warehouseName: d.warehouse_name,
    supplierName: d.supplier_name,
    supplierTaxId: d.supplier_tax_id,
    purchaseOrderId: d.purchase_order_id,
    poNo: d.po_no,
    reference: d.reference,
    reason: d.reason,
    note: d.note,
    totalCost: Number(d.total_cost),
    createdBy: d.created_by_name,
    createdAt: d.created_at,
    lines: lines.map((l) => ({
      productId: l.product_id,
      sku: l.sku,
      name: l.name,
      unit: l.unit,
      quantity: Number(l.quantity),
      unitCost: l.unit_cost == null ? null : Number(l.unit_cost),
      value: r2(Math.abs(Number(l.quantity)) * Number(l.unit_cost ?? 0)),
      note: l.note,
    })),
  };
}

module.exports = { openStockDocument, closeStockDocument, getStockDocument };
