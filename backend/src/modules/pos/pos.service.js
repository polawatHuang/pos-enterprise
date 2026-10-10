'use strict';

const db = require('../../db/pool');
const { badRequest, conflict, forbidden, notFound } = require('../../core/errors');
const { applyMovement } = require('../inventory/inventory.service');

const VAT_RATE = 7;
const r2 = (n) => Math.round(n * 100) / 100;

/* ---------------------------------------------------------------- settings */

// MySQL's JSON type arrives already parsed from mysql2; MariaDB stores JSON as LONGTEXT and
// arrives as raw JSON text. Accept both.
function parseJsonColumn(v) {
  if (typeof v !== 'string') return v;
  try {
    return JSON.parse(v);
  } catch {
    return v;
  }
}

const SETTING_KEYS = {
  promptpayId: 'pos.promptpay_id',
  receiptFooter: 'pos.receipt_footer',
  maxDiscountPct: 'pos.max_discount_pct',
};
const DEFAULTS = { promptpayId: '', receiptFooter: 'ขอบคุณที่อุดหนุน', maxDiscountPct: 20 };

async function getSettings(orgId) {
  const rows = await db.query('SELECT setting_key, value FROM settings WHERE org_id = :orgId AND setting_key LIKE :p', {
    orgId,
    p: 'pos.%',
  });
  const out = { ...DEFAULTS };
  for (const [field, key] of Object.entries(SETTING_KEYS)) {
    const row = rows.find((r) => r.setting_key === key);
    if (row && row.value != null) out[field] = parseJsonColumn(row.value);
  }
  return out;
}

async function saveSettings(orgId, patch) {
  for (const [field, value] of Object.entries(patch)) {
    if (value === undefined || !SETTING_KEYS[field]) continue;
    await db.query(
      `INSERT INTO settings (org_id, setting_key, value) VALUES (:orgId, :key, :value)
       ON DUPLICATE KEY UPDATE value = VALUES(value)`,
      { orgId, key: SETTING_KEYS[field], value: JSON.stringify(value) },
    );
  }
  return getSettings(orgId);
}

/* ------------------------------------------------------------------ shifts */

async function currentShift(userId) {
  return db.one(
    `SELECT s.*, b.name AS branch_name FROM pos_shifts s JOIN branches b ON b.id = s.branch_id
      WHERE s.user_id = :userId AND s.closed_at IS NULL ORDER BY s.id DESC LIMIT 1`,
    { userId },
  );
}

async function shiftStats(shiftId) {
  const row = await db.one(
    `SELECT COUNT(DISTINCT CASE WHEN so.status = 'completed' THEN so.id END) AS orders,
            COALESCE(SUM(CASE WHEN so.status = 'completed' THEN so.total END), 0) AS sales,
            COUNT(DISTINCT CASE WHEN so.status = 'cancelled' THEN so.id END) AS voided
       FROM sales_orders so WHERE so.shift_id = :shiftId`,
    { shiftId },
  );
  const pays = await db.query(
    `SELECT p.method, SUM(p.amount) AS amount FROM payments p JOIN sales_orders so ON so.id = p.order_id
      WHERE so.shift_id = :shiftId GROUP BY p.method`,
    { shiftId },
  );
  const byMethod = Object.fromEntries(pays.map((p) => [p.method, Number(p.amount)]));
  return { orders: Number(row.orders), sales: Number(row.sales), voided: Number(row.voided), byMethod };
}

function mapShift(s, stats) {
  const expectedCash = r2(Number(s.opening_cash) + (stats?.byMethod.cash ?? 0));
  return {
    id: s.id,
    branchId: s.branch_id,
    branchName: s.branch_name,
    openedAt: s.opened_at,
    closedAt: s.closed_at,
    openingCash: Number(s.opening_cash),
    closingCash: s.closing_cash == null ? null : Number(s.closing_cash),
    expectedCash: s.expected_cash == null ? expectedCash : Number(s.expected_cash),
    stats,
  };
}

async function openShift(user, branchId, openingCash) {
  if (await currentShift(user.id)) throw conflict('คุณมีกะที่เปิดอยู่แล้ว');
  const branch = await db.one('SELECT id FROM branches WHERE id = :branchId AND org_id = :orgId AND is_active = 1', {
    branchId,
    orgId: user.orgId,
  });
  if (!branch) throw notFound('ไม่พบสาขา');
  const r = await db.query(
    'INSERT INTO pos_shifts (org_id, branch_id, user_id, opening_cash) VALUES (:orgId, :branchId, :userId, :openingCash)',
    { orgId: user.orgId, branchId, userId: user.id, openingCash },
  );
  const s = await db.one('SELECT s.*, b.name AS branch_name FROM pos_shifts s JOIN branches b ON b.id = s.branch_id WHERE s.id = :id', {
    id: r.insertId,
  });
  return mapShift(s, await shiftStats(s.id));
}

async function closeShift(user, closingCash, note) {
  const s = await currentShift(user.id);
  if (!s) throw notFound('ไม่มีกะที่เปิดอยู่');
  const stats = await shiftStats(s.id);
  const expected = r2(Number(s.opening_cash) + (stats.byMethod.cash ?? 0));
  await db.query(
    `UPDATE pos_shifts SET closed_at = UTC_TIMESTAMP(), closing_cash = :closingCash, expected_cash = :expected, note = :note WHERE id = :id`,
    { id: s.id, closingCash, expected, note: note ?? null },
  );
  const closed = await db.one('SELECT s.*, b.name AS branch_name FROM pos_shifts s JOIN branches b ON b.id = s.branch_id WHERE s.id = :id', {
    id: s.id,
  });
  return { ...mapShift(closed, stats), difference: r2(closingCash - expected) };
}

/* ---------------------------------------------------------------- checkout */

async function warehouseForBranch(conn, orgId, branchId) {
  const [[wh]] = await conn.query('SELECT id FROM warehouses WHERE org_id = :orgId AND branch_id = :branchId ORDER BY id LIMIT 1', {
    orgId,
    branchId,
  });
  if (wh) return wh.id;
  const [[fallback]] = await conn.query('SELECT id FROM warehouses WHERE org_id = :orgId ORDER BY id LIMIT 1', { orgId });
  if (!fallback) throw badRequest('ยังไม่ได้ตั้งค่าคลังสินค้า');
  return fallback.id;
}

/**
 * Prices include VAT (Thai retail convention). VAT is extracted per line after
 * spreading the bill discount proportionally, so exempt items never carry VAT.
 */
function computeTotals(lines, billDiscount) {
  const subtotal = r2(lines.reduce((s, l) => s + l.lineTotal, 0));
  if (billDiscount > subtotal) throw badRequest('ส่วนลดมากกว่ายอดขาย');
  const total = r2(subtotal - billDiscount);
  const ratio = subtotal ? total / subtotal : 0;
  const vatable = lines.filter((l) => l.vatType === 'vat7').reduce((s, l) => s + l.lineTotal, 0);
  const vat = r2(((vatable * ratio) * VAT_RATE) / (100 + VAT_RATE));
  const cost = r2(lines.reduce((s, l) => s + l.unitCost * l.quantity, 0));
  return { subtotal, discount: r2(billDiscount), total, vat, cost };
}

async function checkout(user, input) {
  const shift = await currentShift(user.id);
  if (!shift) throw conflict('กรุณาเปิดกะก่อนขาย');
  const settings = await getSettings(user.orgId);
  const canOverride = user.permissions.includes('pos:manage');

  return db.tx(async (conn) => {
    const warehouseId = await warehouseForBranch(conn, user.orgId, shift.branch_id);

    // Price/cost always come from the database; only managers may override a unit price.
    const lines = [];
    for (const item of input.items) {
      const [[p]] = await conn.query(
        `SELECT id, name, price, cost, vat_type, status FROM products WHERE id = :id AND org_id = :orgId`,
        { id: item.productId, orgId: user.orgId },
      );
      if (!p || p.status !== 'active') throw badRequest(`สินค้า #${item.productId} ไม่พร้อมขาย`);
      if (item.unitPrice !== undefined && Number(item.unitPrice) !== Number(p.price) && !canOverride) {
        throw forbidden('ต้องมีสิทธิ์ pos:manage เพื่อแก้ราคาขาย');
      }
      const unitPrice = item.unitPrice ?? Number(p.price);
      const gross = unitPrice * item.quantity;
      const discount = item.discount ?? 0;
      if (discount > gross) throw badRequest(`ส่วนลดของ ${p.name} มากกว่าราคา`);
      lines.push({
        productId: p.id,
        name: p.name,
        quantity: item.quantity,
        unitPrice,
        unitCost: Number(p.cost),
        discount,
        lineTotal: r2(gross - discount),
        vatType: p.vat_type,
      });
    }

    const totals = computeTotals(lines, input.discount ?? 0);
    const grossBeforeDiscounts = lines.reduce((s, l) => s + l.unitPrice * l.quantity, 0);
    const discountPct = grossBeforeDiscounts ? ((grossBeforeDiscounts - totals.total) / grossBeforeDiscounts) * 100 : 0;
    if (discountPct > settings.maxDiscountPct + 1e-9 && !canOverride) {
      throw forbidden(`ส่วนลดรวมเกิน ${settings.maxDiscountPct}% ต้องให้ผู้จัดการอนุมัติ`);
    }

    const { method, amountReceived, reference } = input.payment;
    let change = 0;
    if (method === 'cash') {
      const received = amountReceived ?? totals.total;
      if (received + 1e-9 < totals.total) throw badRequest('รับเงินไม่ครบ');
      change = r2(received - totals.total);
    }

    const tmpNo = `TMP-${user.id}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const [ins] = await conn.query(
      `INSERT INTO sales_orders (org_id, branch_id, customer_id, shift_id, order_no, channel, status, subtotal, discount,
                                 shipping_fee, vat_amount, total, cost_total, platform_fee, ordered_at, created_by)
       VALUES (:orgId, :branchId, :customerId, :shiftId, :tmpNo, 'pos', 'completed', :subtotal, :discount,
               0, :vat, :total, :cost, 0, UTC_TIMESTAMP(), :userId)`,
      {
        orgId: user.orgId,
        branchId: shift.branch_id,
        customerId: input.customerId ?? null,
        shiftId: shift.id,
        tmpNo,
        ...totals,
        userId: user.id,
      },
    );
    const orderId = ins.insertId;
    // Sequential, collision-free receipt number derived from the auto-increment id
    const orderNo = `POS${String(shift.branch_id).padStart(2, '0')}-${String(orderId).padStart(7, '0')}`;
    await conn.query('UPDATE sales_orders SET order_no = :orderNo WHERE id = :orderId', { orderNo, orderId });

    for (const l of lines) {
      await conn.query(
        `INSERT INTO sales_order_items (order_id, product_id, variant_id, name, quantity, unit_price, unit_cost, discount, line_total)
         VALUES (:orderId, :productId, 0, :name, :quantity, :unitPrice, :unitCost, :discount, :lineTotal)`,
        { orderId, ...l },
      );
      await applyMovement(conn, {
        orgId: user.orgId,
        warehouseId,
        productId: l.productId,
        quantity: -l.quantity,
        type: 'sale',
        refType: 'sales_order',
        refId: orderId,
        userId: user.id,
      });
    }
    await conn.query(
      `INSERT INTO payments (org_id, order_id, method, amount, reference) VALUES (:orgId, :orderId, :method, :amount, :reference)`,
      { orgId: user.orgId, orderId, method, amount: totals.total, reference: reference ?? null },
    );
    if (input.customerId) {
      await conn.query(
        'UPDATE customers SET total_spent = total_spent + :total, order_count = order_count + 1 WHERE id = :id AND org_id = :orgId',
        { total: totals.total, id: input.customerId, orgId: user.orgId },
      );
    }
    return { orderId, orderNo, ...totals, change, warehouseId };
  });
}

/* ------------------------------------------------------------------ orders */

async function getOrder(orgId, orderId) {
  const o = await db.one(
    `SELECT so.*, b.name AS branch_name, b.branch_no, u.full_name AS cashier_name, c.name AS customer_name
       FROM sales_orders so
       LEFT JOIN branches b ON b.id = so.branch_id
       LEFT JOIN users u ON u.id = so.created_by
       LEFT JOIN customers c ON c.id = so.customer_id
      WHERE so.id = :orderId AND so.org_id = :orgId`,
    { orderId, orgId },
  );
  if (!o) throw notFound('ไม่พบบิล');
  const items = await db.query(
    'SELECT product_id, name, quantity, unit_price, discount, line_total FROM sales_order_items WHERE order_id = :orderId ORDER BY id',
    { orderId },
  );
  const payments = await db.query('SELECT method, amount, reference, paid_at FROM payments WHERE order_id = :orderId ORDER BY id', {
    orderId,
  });
  return {
    id: o.id,
    orderNo: o.order_no,
    channel: o.channel,
    status: o.status,
    shiftId: o.shift_id,
    branchName: o.branch_name,
    branchNo: o.branch_no,
    cashierName: o.cashier_name,
    customerName: o.customer_name,
    subtotal: Number(o.subtotal),
    discount: Number(o.discount),
    vatAmount: Number(o.vat_amount),
    total: Number(o.total),
    orderedAt: o.ordered_at,
    items: items.map((i) => ({
      productId: i.product_id,
      name: i.name,
      quantity: Number(i.quantity),
      unitPrice: Number(i.unit_price),
      discount: Number(i.discount),
      lineTotal: Number(i.line_total),
    })),
    payments: payments.map((p) => ({ method: p.method, amount: Number(p.amount), reference: p.reference, paidAt: p.paid_at })),
  };
}

/** Void a completed POS bill: restock every line and record a negative payment. */
async function voidOrder(user, orderId, reason) {
  await db.tx(async (conn) => {
    const [[o]] = await conn.query('SELECT * FROM sales_orders WHERE id = :orderId AND org_id = :orgId FOR UPDATE', {
      orderId,
      orgId: user.orgId,
    });
    if (!o) throw notFound('ไม่พบบิล');
    if (o.channel !== 'pos') throw badRequest('ยกเลิกได้เฉพาะบิลหน้าร้าน');
    if (o.status !== 'completed') throw conflict('บิลนี้ถูกยกเลิกไปแล้ว');
    const warehouseId = await warehouseForBranch(conn, user.orgId, o.branch_id);
    const [items] = await conn.query('SELECT product_id, quantity FROM sales_order_items WHERE order_id = :orderId', { orderId });
    for (const i of items) {
      await applyMovement(conn, {
        orgId: user.orgId,
        warehouseId,
        productId: i.product_id,
        quantity: Number(i.quantity),
        type: 'return',
        refType: 'sales_order',
        refId: orderId,
        note: `ยกเลิกบิล ${o.order_no}: ${reason}`,
        userId: user.id,
      });
    }
    const [pays] = await conn.query('SELECT method, amount FROM payments WHERE order_id = :orderId', { orderId });
    for (const p of pays) {
      await conn.query(
        `INSERT INTO payments (org_id, order_id, method, amount, reference) VALUES (:orgId, :orderId, :method, :amount, :reference)`,
        { orgId: user.orgId, orderId, method: p.method, amount: -Number(p.amount), reference: `VOID: ${reason}`.slice(0, 191) },
      );
    }
    await conn.query(`UPDATE sales_orders SET status = 'cancelled' WHERE id = :orderId`, { orderId });
    if (o.customer_id) {
      await conn.query('UPDATE customers SET total_spent = GREATEST(total_spent - :total, 0), order_count = GREATEST(order_count - 1, 0) WHERE id = :id', {
        total: o.total,
        id: o.customer_id,
      });
    }
  });
  return getOrder(user.orgId, orderId);
}

module.exports = {
  getSettings,
  saveSettings,
  currentShift,
  shiftStats,
  mapShift,
  openShift,
  closeShift,
  checkout,
  computeTotals,
  getOrder,
  voidOrder,
};
