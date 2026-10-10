'use strict';

const { conflict, notFound, badRequest } = require('../../core/errors');

/**
 * Single entry point for every stock change (sale, receive, adjust, transfer, void).
 * Must run inside a transaction: the stock row is locked with FOR UPDATE so concurrent
 * POS terminals cannot oversell the same item.
 *
 * @returns {Promise<{before:number, after:number}>}
 */
async function applyMovement(
  conn,
  { orgId, warehouseId, productId, quantity, type, unitCost = null, refType = null, refId = null, note = null, userId = null, allowNegative = false },
) {
  if (!quantity) throw badRequest('จำนวนต้องไม่เป็นศูนย์');
  await conn.query(
    `INSERT IGNORE INTO stock_levels (warehouse_id, product_id, variant_id, quantity) VALUES (:warehouseId, :productId, 0, 0)`,
    { warehouseId, productId },
  );
  const [[row]] = await conn.query(
    `SELECT quantity FROM stock_levels WHERE warehouse_id = :warehouseId AND product_id = :productId AND variant_id = 0 FOR UPDATE`,
    { warehouseId, productId },
  );
  const before = Number(row.quantity);
  const after = before + Number(quantity);
  if (after < 0 && !allowNegative) {
    const [[p]] = await conn.query('SELECT name FROM products WHERE id = :productId', { productId });
    throw conflict(`สต๊อก "${p?.name ?? productId}" ไม่พอ (คงเหลือ ${before})`);
  }
  await conn.query(
    `UPDATE stock_levels SET quantity = :after WHERE warehouse_id = :warehouseId AND product_id = :productId AND variant_id = 0`,
    { after, warehouseId, productId },
  );
  await conn.query(
    `INSERT INTO stock_movements (org_id, warehouse_id, product_id, variant_id, type, quantity, unit_cost, ref_type, ref_id, note, created_by)
     VALUES (:orgId, :warehouseId, :productId, 0, :type, :quantity, :unitCost, :refType, :refId, :note, :userId)`,
    { orgId, warehouseId, productId, type, quantity, unitCost, refType, refId, note, userId },
  );
  return { before, after };
}

/** Verifies the warehouse belongs to the org; returns it. */
async function getWarehouse(conn, orgId, warehouseId) {
  const [[wh]] = await conn.query('SELECT * FROM warehouses WHERE id = :warehouseId AND org_id = :orgId', { warehouseId, orgId });
  if (!wh) throw notFound('ไม่พบคลังสินค้า');
  return wh;
}

/** Locks and returns a product row of the org. */
async function getProductForUpdate(conn, orgId, productId) {
  const [[p]] = await conn.query('SELECT * FROM products WHERE id = :productId AND org_id = :orgId FOR UPDATE', { productId, orgId });
  if (!p) throw notFound(`ไม่พบสินค้า #${productId}`);
  return p;
}

/**
 * Moving-average cost on receipt: newCost = (onHand*cost + qty*unitCost) / (onHand + qty).
 * Negative/zero on-hand stock resets the average to the incoming cost.
 */
async function updateAverageCost(conn, product, receivedQty, unitCost) {
  const [[s]] = await conn.query('SELECT COALESCE(SUM(quantity), 0) AS onhand FROM stock_levels WHERE product_id = :id', { id: product.id });
  const onHand = Math.max(Number(s.onhand) - receivedQty, 0); // stock before this receipt
  const cost = Number(product.cost);
  const next = onHand > 0 ? (onHand * cost + receivedQty * unitCost) / (onHand + receivedQty) : unitCost;
  await conn.query('UPDATE products SET cost = :cost WHERE id = :id', { cost: Math.round(next * 100) / 100, id: product.id });
}

module.exports = { applyMovement, getWarehouse, getProductForUpdate, updateAverageCost };
