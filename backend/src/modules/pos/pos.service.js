'use strict';

const db = require('../../db/pool');
const { badRequest, conflict, forbidden, notFound } = require('../../core/errors');
const { applyMovement } = require('../inventory/inventory.service');
const { consumeFefo, restoreLots, parseAlloc } = require('../inventory/lots');
const { postJournal, reverseJournalsFor, saleLines } = require('../accounting/ledger.service');
const { localDate, localTime } = require('../../utils/dates');

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
  pointsEarnBaht: 'pos.points_earn_baht',
  pointValue: 'pos.point_value',
  cashLimit: 'pos.cash_limit',
  bankAccount: 'org.bank_account',
};
const DEFAULTS = {
  promptpayId: '',
  receiptFooter: 'ขอบคุณที่อุดหนุน',
  maxDiscountPct: 20,
  pointsEarnBaht: 25, // spend 25 baht = 1 point; 0 turns points off
  pointValue: 0.25, // 1 point = 0.25 baht when redeemed
  cashLimit: 0, // drawer amount that triggers a "move cash to the safe" prompt; 0 = off
  // Shop account for bank transfers (POS transfer screen, customer display, invoices, slip check)
  bankAccount: { bank: 'ธนาคารกสิกรไทย', type: 'ออมทรัพย์', number: '0621554271', name: 'พลวัต ฮวง' },
};

/** Thai bank account display format: 10 digits as XXX-X-XXXXX-X (KBank, SCB, BBL, KTB...). */
function formatAccountNo(number) {
  const d = String(number ?? '').replace(/\D/g, '');
  return d.length === 10 ? `${d.slice(0, 3)}-${d.slice(3, 4)}-${d.slice(4, 9)}-${d.slice(9)}` : d;
}

async function getSettings(orgId) {
  const rows = await db.query('SELECT setting_key, value FROM settings WHERE org_id = :orgId AND setting_key IN (:keys)', {
    orgId,
    keys: Object.values(SETTING_KEYS),
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
  const moves = await db.query('SELECT type, SUM(amount) AS amount FROM cash_movements WHERE shift_id = :shiftId GROUP BY type', { shiftId });
  const cash = Object.fromEntries(['pay_in', 'pay_out', 'pickup'].map((t) => [t, Number(moves.find((m) => m.type === t)?.amount ?? 0)]));
  return { orders: Number(row.orders), sales: Number(row.sales), voided: Number(row.voided), byMethod, cash };
}

/** Cash that should be in the drawer: float + cash sales (net of voids) + pay-ins - pay-outs - safe drops. */
function expectedDrawer(s, stats) {
  const c = stats?.cash ?? { pay_in: 0, pay_out: 0, pickup: 0 };
  return r2(Number(s.opening_cash) + (stats?.byMethod.cash ?? 0) + c.pay_in - c.pay_out - c.pickup);
}

function mapShift(s, stats) {
  const expectedCash = expectedDrawer(s, stats);
  return {
    id: s.id,
    branchId: s.branch_id,
    branchName: s.branch_name,
    openedAt: s.opened_at,
    closedAt: s.closed_at,
    openingCash: Number(s.opening_cash),
    closingCash: s.closing_cash == null ? null : Number(s.closing_cash),
    expectedCash: s.expected_cash == null ? expectedCash : Number(s.expected_cash),
    denominations: parseJsonColumn(s.denominations) ?? null,
    stats,
  };
}

const DENOMINATIONS = [1000, 500, 100, 50, 20, 10, 5, 2, 1, 0.5, 0.25];

async function addCashMovement(user, { type, amount, reason }) {
  const s = await currentShift(user.id);
  if (!s) throw notFound('ไม่มีกะที่เปิดอยู่');
  if (type !== 'pay_in') {
    const available = expectedDrawer(s, await shiftStats(s.id));
    if (amount > available + 1e-9) throw badRequest(`เงินในลิ้นชักมีไม่พอ (คาดว่ามี ${available.toLocaleString('th-TH')} บาท)`);
  }
  const r = await db.query(
    'INSERT INTO cash_movements (shift_id, type, amount, reason, created_by) VALUES (:shiftId, :type, :amount, :reason, :userId)',
    { shiftId: s.id, type, amount, reason, userId: user.id },
  );
  return { id: r.insertId, shift: mapShift(s, await shiftStats(s.id)) };
}

/** X report (mid-shift) / Z report (closed shift): totals per method, cash movements, best sellers. */
async function shiftReport(shiftId) {
  const s = await db.one('SELECT s.*, b.name AS branch_name, u.full_name AS cashier_name FROM pos_shifts s JOIN branches b ON b.id = s.branch_id JOIN users u ON u.id = s.user_id WHERE s.id = :shiftId', {
    shiftId,
  });
  if (!s) throw notFound('ไม่พบกะ');
  const stats = await shiftStats(shiftId);
  const moves = await db.query('SELECT type, amount, reason, created_at FROM cash_movements WHERE shift_id = :shiftId ORDER BY id', { shiftId });
  const top = await db.query(
    `SELECT i.name, SUM(i.quantity * i.unit_factor) AS qty, SUM(i.line_total) AS amount
       FROM sales_order_items i JOIN sales_orders so ON so.id = i.order_id
      WHERE so.shift_id = :shiftId AND so.status = 'completed'
      GROUP BY i.product_id, i.name ORDER BY amount DESC LIMIT 10`,
    { shiftId },
  );
  const disc = await db.one(
    `SELECT COALESCE(SUM(discount), 0) AS discount, COALESCE(SUM(vat_amount), 0) AS vat, COALESCE(SUM(points_used), 0) AS points
       FROM sales_orders WHERE shift_id = :shiftId AND status = 'completed'`,
    { shiftId },
  );
  return {
    ...mapShift(s, stats),
    cashierName: s.cashier_name,
    kind: s.closed_at ? 'Z' : 'X',
    difference: s.closing_cash == null ? null : r2(Number(s.closing_cash) - Number(s.expected_cash)),
    discount: Number(disc.discount),
    vat: Number(disc.vat),
    pointsUsed: Number(disc.points),
    cashMovements: moves.map((m) => ({ type: m.type, amount: Number(m.amount), reason: m.reason, createdAt: m.created_at })),
    topItems: top.map((t) => ({ name: t.name, quantity: Number(t.qty), amount: Number(t.amount) })),
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

/** Close with either a counted total or a per-note count (the count wins when both are sent). */
async function closeShift(user, { closingCash, denominations, note }) {
  const s = await currentShift(user.id);
  if (!s) throw notFound('ไม่มีกะที่เปิดอยู่');
  let counted = closingCash;
  if (denominations) {
    counted = r2(Object.entries(denominations).reduce((sum, [d, n]) => sum + Number(d) * Number(n), 0));
  }
  if (counted === undefined) throw badRequest('กรุณานับเงินสดในลิ้นชัก');
  const stats = await shiftStats(s.id);
  const expected = expectedDrawer(s, stats);
  await db.query(
    `UPDATE pos_shifts SET closed_at = UTC_TIMESTAMP(), closing_cash = :counted, expected_cash = :expected, denominations = :denominations, note = :note
      WHERE id = :id`,
    { id: s.id, counted, expected, denominations: denominations ? JSON.stringify(denominations) : null, note: note ?? null },
  );
  return shiftReport(s.id);
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

/** True when local "HH:MM" falls inside [from, to), windows may wrap midnight (e.g. 22:00-06:00). */
function inWindow(now, from, to) {
  if (from === to) return false;
  return from < to ? now >= from && now < to : now >= from || now < to;
}

function parseBlock(v) {
  const b = parseJsonColumn(v);
  return b && typeof b === 'object' && b.from && b.to ? b : null;
}

/** Legacy single `payment` -> payments[]; cash without an amount means "exact". */
function normalizePayments(input, total) {
  if (input.payments?.length) return input.payments;
  const p = input.payment;
  if (!p) throw badRequest('กรุณาเลือกวิธีชำระเงิน');
  return [{ method: p.method, amount: p.method === 'cash' ? (p.amountReceived ?? total) : total, reference: p.reference }];
}

/**
 * Split tender: electronic payments are taken as-is (they cannot exceed the bill), cash covers the
 * rest and is the only tender that gives change. Returns the rows to store and the change.
 */
function settlePayments(payments, total) {
  const nonCash = r2(payments.filter((p) => p.method !== 'cash').reduce((s, p) => s + p.amount, 0));
  const cashGiven = r2(payments.filter((p) => p.method === 'cash').reduce((s, p) => s + p.amount, 0));
  if (nonCash > total + 1e-9) throw badRequest('ยอดชำระที่ไม่ใช่เงินสดเกินยอดบิล');
  const cashDue = r2(total - nonCash);
  if (cashGiven + 1e-9 < cashDue) throw badRequest(`รับเงินไม่ครบ (ขาด ${r2(cashDue - cashGiven).toLocaleString('th-TH')} บาท)`);
  const rows = payments.filter((p) => p.method !== 'cash' && p.amount > 0).map((p) => ({ ...p, amount: r2(p.amount) }));
  if (cashDue > 0) rows.push({ method: 'cash', amount: cashDue, reference: null });
  return { rows, change: r2(cashGiven - cashDue) };
}

async function checkout(user, input) {
  const shift = await currentShift(user.id);
  if (!shift) throw conflict('กรุณาเปิดกะก่อนขาย');
  const settings = await getSettings(user.orgId);
  const canOverride = user.permissions.includes('pos:manage');
  const now = localTime();

  return db.tx(async (conn) => {
    const warehouseId = await warehouseForBranch(conn, user.orgId, shift.branch_id);

    // Price/cost always come from the database; only managers may override a unit price.
    const lines = [];
    let needsAge = false;
    for (const item of input.items) {
      const [[p]] = await conn.query(
        `SELECT p.id, p.name, p.price, p.cost, p.vat_type, p.status, c.sale_block, c.age_restricted
           FROM products p LEFT JOIN product_categories c ON c.id = p.category_id
          WHERE p.id = :id AND p.org_id = :orgId`,
        { id: item.productId, orgId: user.orgId },
      );
      if (!p || p.status !== 'active') throw badRequest(`สินค้า #${item.productId} ไม่พร้อมขาย`);
      const block = parseBlock(p.sale_block);
      if (block && inWindow(now, block.from, block.to)) {
        throw conflict(`ขาย "${p.name}" ไม่ได้ในช่วง ${block.from}–${block.to}${block.label ? ` (${block.label})` : ''}`);
      }
      if (p.age_restricted) needsAge = true;
      let unit = null;
      if (item.unitId) {
        const [[u]] = await conn.query('SELECT id, name, factor, price FROM product_units WHERE id = :unitId AND product_id = :productId', {
          unitId: item.unitId,
          productId: p.id,
        });
        if (!u) throw badRequest(`ไม่พบหน่วยขายของ ${p.name}`);
        unit = { id: u.id, name: u.name, factor: Number(u.factor), price: u.price == null ? null : Number(u.price) };
      }
      const factor = unit?.factor ?? 1;
      const listPrice = unit ? (unit.price ?? r2(Number(p.price) * factor)) : Number(p.price);
      if (item.unitPrice !== undefined && Number(item.unitPrice) !== listPrice && !canOverride) {
        throw forbidden('ต้องมีสิทธิ์ pos:manage เพื่อแก้ราคาขาย');
      }
      const unitPrice = item.unitPrice ?? listPrice;
      const gross = unitPrice * item.quantity;
      // Expiry-tracked items leave first-expiry-first-out; near-expiry lots carry their markdown
      const lotAllocations = await consumeFefo(conn, { warehouseId, productId: p.id, qty: r2(item.quantity * factor), forSale: true });
      const markdown = r2(lotAllocations.reduce((s, a) => s + (a.qty * (unitPrice / factor) * a.markdownPct) / 100, 0));
      const discount = r2((item.discount ?? 0) + markdown);
      if (discount > gross) throw badRequest(`ส่วนลดของ ${p.name} มากกว่าราคา`);
      lines.push({
        productId: p.id,
        name: p.name,
        unitName: unit?.name ?? null,
        unitFactor: factor,
        quantity: item.quantity,
        listPrice,
        unitPrice,
        unitCost: r2(Number(p.cost) * factor),
        discount,
        lineTotal: r2(gross - discount),
        vatType: p.vat_type,
        markdown,
        lotAllocations,
      });
    }
    if (needsAge && !input.ageConfirmed) throw badRequest('มีสินค้าจำกัดอายุ กรุณายืนยันว่าลูกค้าอายุ 20 ปีขึ้นไป');

    // Cashier discount limit is checked before points: redeeming points is the customer's right.
    const beforePoints = computeTotals(lines, input.discount ?? 0);
    const listGross = lines.reduce((s, l) => s + l.listPrice * l.quantity, 0);
    // Near-expiry markdowns are the shop's own price cut, not the cashier's discount
    const markdownTotal = lines.reduce((s, l) => s + l.markdown, 0);
    const discountPct = listGross ? ((listGross - beforePoints.total - markdownTotal) / listGross) * 100 : 0;
    if (discountPct > settings.maxDiscountPct + 1e-9 && !canOverride) {
      throw forbidden(`ส่วนลดรวมเกิน ${settings.maxDiscountPct}% ต้องให้ผู้จัดการอนุมัติ`);
    }

    let customer = null;
    if (input.customerId) {
      [[customer]] = await conn.query('SELECT id, points FROM customers WHERE id = :id AND org_id = :orgId FOR UPDATE', {
        id: input.customerId,
        orgId: user.orgId,
      });
      if (!customer) throw badRequest('ไม่พบสมาชิก');
    }
    const pointsUsed = input.pointsUsed ?? 0;
    if (pointsUsed && !customer) throw badRequest('ต้องเลือกสมาชิกก่อนใช้แต้ม');
    if (pointsUsed > Number(customer?.points ?? 0)) throw badRequest(`แต้มไม่พอ (มี ${customer?.points ?? 0} แต้ม)`);
    const pointsDiscount = r2(pointsUsed * settings.pointValue);
    if (pointsDiscount > beforePoints.total) throw badRequest('ใช้แต้มเกินยอดบิล');
    const totals = computeTotals(lines, r2((input.discount ?? 0) + pointsDiscount));
    const pointsEarned = customer && settings.pointsEarnBaht > 0 ? Math.floor(totals.total / settings.pointsEarnBaht) : 0;

    const { rows: payRows, change } = settlePayments(normalizePayments(input, totals.total), totals.total);

    const tmpNo = `TMP-${user.id}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const [ins] = await conn.query(
      `INSERT INTO sales_orders (org_id, branch_id, customer_id, shift_id, order_no, channel, status, subtotal, discount,
                                 shipping_fee, vat_amount, total, cost_total, platform_fee, points_earned, points_used, ordered_at, created_by)
       VALUES (:orgId, :branchId, :customerId, :shiftId, :tmpNo, 'pos', 'completed', :subtotal, :discount,
               0, :vat, :total, :cost, 0, :pointsEarned, :pointsUsed, UTC_TIMESTAMP(), :userId)`,
      {
        orgId: user.orgId,
        branchId: shift.branch_id,
        customerId: customer?.id ?? null,
        shiftId: shift.id,
        tmpNo,
        ...totals,
        pointsEarned,
        pointsUsed,
        userId: user.id,
      },
    );
    const orderId = ins.insertId;
    // Sequential, collision-free receipt number derived from the auto-increment id
    const orderNo = `POS${String(shift.branch_id).padStart(2, '0')}-${String(orderId).padStart(7, '0')}`;
    await conn.query('UPDATE sales_orders SET order_no = :orderNo WHERE id = :orderId', { orderNo, orderId });

    for (const l of lines) {
      await conn.query(
        `INSERT INTO sales_order_items (order_id, product_id, variant_id, name, unit_name, unit_factor, quantity, unit_price, unit_cost, discount, line_total, lot_allocations)
         VALUES (:orderId, :productId, 0, :name, :unitName, :unitFactor, :quantity, :unitPrice, :unitCost, :discount, :lineTotal, :alloc)`,
        { orderId, ...l, alloc: l.lotAllocations.length ? JSON.stringify(l.lotAllocations) : null },
      );
      await applyMovement(conn, {
        orgId: user.orgId,
        warehouseId,
        productId: l.productId,
        quantity: -r2(l.quantity * l.unitFactor),
        type: 'sale',
        refType: 'sales_order',
        refId: orderId,
        userId: user.id,
      });
    }
    for (const p of payRows) {
      await conn.query(
        `INSERT INTO payments (org_id, order_id, method, amount, reference) VALUES (:orgId, :orderId, :method, :amount, :reference)`,
        { orgId: user.orgId, orderId, method: p.method, amount: p.amount, reference: p.reference ?? p.slipRef ?? null },
      );
      if (p.slipRef) {
        try {
          await conn.query('INSERT INTO payment_slips (org_id, trans_ref, amount, order_id) VALUES (:orgId, :ref, :amount, :orderId)', {
            orgId: user.orgId,
            ref: p.slipRef,
            amount: p.amount,
            orderId,
          });
        } catch (err) {
          if (err.code === 'ER_DUP_ENTRY') throw conflict(`สลิปเลขอ้างอิง ${p.slipRef} ถูกใช้ไปแล้ว`);
          throw err;
        }
      }
    }
    if (customer) {
      await conn.query(
        `UPDATE customers SET total_spent = total_spent + :total, order_count = order_count + 1, points = points - :used + :earned
          WHERE id = :id`,
        { total: totals.total, used: pointsUsed, earned: pointsEarned, id: customer.id },
      );
    }
    // Same transaction as the sale: the books can never disagree with the till.
    await postJournal(conn, {
      orgId: user.orgId,
      date: localDate(),
      description: `ขายหน้าร้าน ${orderNo}`,
      refType: 'sales_order',
      refId: orderId,
      userId: user.id,
      lines: saleLines({ total: totals.total, vat: totals.vat, cost: totals.cost, payments: payRows }),
    });
    return { orderId, orderNo, ...totals, change, pointsEarned, pointsUsed, warehouseId };
  });
}

/* ------------------------------------------------------------------ orders */

async function getOrder(orgId, orderId) {
  const o = await db.one(
    `SELECT so.*, b.name AS branch_name, b.branch_no, u.full_name AS cashier_name, c.name AS customer_name, c.points AS customer_points
       FROM sales_orders so
       LEFT JOIN branches b ON b.id = so.branch_id
       LEFT JOIN users u ON u.id = so.created_by
       LEFT JOIN customers c ON c.id = so.customer_id
      WHERE so.id = :orderId AND so.org_id = :orgId`,
    { orderId, orgId },
  );
  if (!o) throw notFound('ไม่พบบิล');
  const items = await db.query(
    'SELECT product_id, name, unit_name, quantity, unit_price, discount, line_total FROM sales_order_items WHERE order_id = :orderId ORDER BY id',
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
    customerId: o.customer_id,
    pointsEarned: Number(o.points_earned ?? 0),
    pointsUsed: Number(o.points_used ?? 0),
    customerPoints: o.customer_points == null ? null : Number(o.customer_points),
    subtotal: Number(o.subtotal),
    discount: Number(o.discount),
    vatAmount: Number(o.vat_amount),
    total: Number(o.total),
    orderedAt: o.ordered_at,
    items: items.map((i) => ({
      productId: i.product_id,
      name: i.name,
      unitName: i.unit_name,
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
    const [items] = await conn.query('SELECT product_id, quantity, unit_factor, lot_allocations FROM sales_order_items WHERE order_id = :orderId', { orderId });
    for (const i of items) {
      await restoreLots(conn, parseAlloc(i.lot_allocations));
      await applyMovement(conn, {
        orgId: user.orgId,
        warehouseId,
        productId: i.product_id,
        quantity: r2(Number(i.quantity) * Number(i.unit_factor ?? 1)),
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
    // A voided bill frees its slip reference so the customer's transfer can be re-used on the corrected bill
    await conn.query('DELETE FROM payment_slips WHERE order_id = :orderId', { orderId });
    await reverseJournalsFor(conn, {
      orgId: user.orgId,
      refType: 'sales_order',
      refId: orderId,
      reason: `ยกเลิกบิล ${o.order_no} (${reason})`,
      userId: user.id,
    });
    if (o.customer_id) {
      // Points come back exactly as they moved; a balance already spent may go to zero, never negative.
      await conn.query(
        `UPDATE customers SET total_spent = GREATEST(total_spent - :total, 0), order_count = GREATEST(order_count - 1, 0),
                points = GREATEST(points + :used - :earned, 0) WHERE id = :id`,
        { total: o.total, used: o.points_used ?? 0, earned: o.points_earned ?? 0, id: o.customer_id },
      );
    }
  });
  return getOrder(user.orgId, orderId);
}

module.exports = {
  getSettings,
  saveSettings,
  formatAccountNo,
  currentShift,
  shiftStats,
  mapShift,
  openShift,
  closeShift,
  addCashMovement,
  shiftReport,
  expectedDrawer,
  DENOMINATIONS,
  inWindow,
  settlePayments,
  checkout,
  computeTotals,
  getOrder,
  voidOrder,
};
