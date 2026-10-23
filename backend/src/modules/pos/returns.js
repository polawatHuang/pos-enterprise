'use strict';

const db = require('../../db/pool');
const { badRequest, conflict, notFound } = require('../../core/errors');
const { applyMovement } = require('../inventory/inventory.service');
const { restoreLots, parseAlloc, consumeFefo } = require('../inventory/lots');
const { ACC, nextNumber, postJournal, paymentAccount, reverseJournalsFor } = require('../accounting/ledger.service');
const { localDate } = require('../../utils/dates');
const { warehouseForBranch } = require('./pos.service');

const r2 = (n) => Math.round(n * 100) / 100;
const r3 = (n) => Math.round(n * 1000) / 1000;

/** Reasons of the cash_movements rows returns write themselves (not removable from the cash dialog). */
const REFUND_PAYOUT_PREFIX = 'คืนเงิน ';
const VOID_PAYIN_PREFIX = 'ยกเลิกการคืน ';
const isAutoCashMovement = (reason) => /^(คืนเงิน|ยกเลิกการคืน) RT/.test(String(reason ?? ''));

/**
 * Lot allocations for returning `qty` base units of a line that already had `before` base units
 * returned: the same lots the sale took, in order, so expiry tracking stays right.
 */
function lotsFor(allocations, before, qty) {
  const out = [];
  let skip = before;
  let need = qty;
  for (const a of allocations) {
    if (need <= 0) break;
    const avail = Number(a.qty);
    const fromSkip = Math.min(skip, avail);
    skip -= fromSkip;
    const take = Math.min(avail - fromSkip, need);
    if (take > 0) {
      out.push({ lotId: a.lotId, qty: r3(take) });
      need -= take;
    }
  }
  return out;
}

/**
 * Return part (or all) of a POS bill: put the goods back on the shelf (or not, when damaged),
 * refund the customer, and post the reversal to the books, all in one transaction.
 *
 * The refund per line is its share of what the customer actually paid: line total scaled by the
 * bill-level ratio (total / subtotal), so bill discounts, discount codes and points are honoured.
 * VAT and cost come back in the same proportion. The last return of a bill takes whatever is left,
 * so rounding never leaves a satang behind.
 *
 * Cash refunds come out of the drawer of the shift that pays them: when that is not the bill's own
 * shift, the refund is also booked as a pay-out of the current shift.
 */
async function createReturn(user, orderId, { items, reason, refundMethod, restock = true, shiftId = null, aftersalesReturnId = null }) {
  return db.tx(async (conn) => {
    const [[o]] = await conn.query('SELECT * FROM sales_orders WHERE id = :orderId AND org_id = :orgId FOR UPDATE', { orderId, orgId: user.orgId });
    if (!o) throw notFound('ไม่พบบิล');
    if (o.status !== 'completed') throw conflict(o.status === 'refunded' ? 'บิลนี้คืนสินค้าครบแล้ว' : 'บิลนี้ถูกยกเลิกแล้ว คืนสินค้าไม่ได้');
    const [lines] = await conn.query('SELECT * FROM sales_order_items WHERE order_id = :orderId FOR UPDATE', { orderId });
    const byId = new Map(lines.map((l) => [Number(l.id), l]));

    const subtotal = Number(o.subtotal);
    const ratio = subtotal ? Number(o.total) / subtotal : 0;
    const picked = [];
    for (const it of items) {
      const l = byId.get(Number(it.orderItemId));
      if (!l) throw badRequest('รายการสินค้าไม่อยู่ในบิลนี้');
      const left = r3(Number(l.quantity) - Number(l.returned_qty));
      if (it.quantity > left + 1e-9) throw badRequest(`"${l.name}" คืนได้อีกไม่เกิน ${left}`);
      picked.push({ line: l, qty: r3(it.quantity) });
    }
    if (!picked.length) throw badRequest('เลือกสินค้าที่จะคืนอย่างน้อย 1 รายการ');
    // Cash comes out of a drawer, so it needs an open shift; transfers/cards do not
    if (refundMethod === 'cash' && !shiftId) throw conflict('ต้องเปิดกะก่อนคืนเงินสด');

    // Is this the last of the bill? Then refund exactly what remains, not a recomputed share.
    const returnedAfter = new Map(lines.map((l) => [Number(l.id), Number(l.returned_qty)]));
    for (const p of picked) returnedAfter.set(Number(p.line.id), returnedAfter.get(Number(p.line.id)) + p.qty);
    const fullyReturned = lines.every((l) => returnedAfter.get(Number(l.id)) >= Number(l.quantity) - 1e-9);
    const alreadyRefunded = Number(o.refunded_amount);

    let refund = 0;
    let cost = 0;
    for (const p of picked) {
      const unitNet = Number(p.line.line_total) / Number(p.line.quantity);
      p.amount = r2(unitNet * p.qty * ratio);
      refund += p.amount;
      cost += Number(p.line.unit_cost) * p.qty;
    }
    refund = r2(fullyReturned ? Number(o.total) - alreadyRefunded : refund);
    if (refund <= 0 && Number(o.total) > 0) throw badRequest('ยอดคืนเงินเป็นศูนย์');
    const [[prev]] = await conn.query('SELECT COALESCE(SUM(vat_amount), 0) AS vat FROM sales_returns WHERE order_id = :orderId AND voided_at IS NULL', { orderId });
    const vat = r2(fullyReturned ? Number(o.vat_amount) - Number(prev.vat) : Number(o.total) ? (Number(o.vat_amount) * refund) / Number(o.total) : 0);
    cost = r2(cost);

    const date = localDate();
    const returnNo = await nextNumber(conn, user.orgId, 'sales_return', date);
    const [ins] = await conn.query(
      `INSERT INTO sales_returns (org_id, order_id, return_no, reason, refund_method, refund_amount, vat_amount, cost_amount, restocked, shift_id,
                                  aftersales_return_id, created_by)
       VALUES (:orgId, :orderId, :returnNo, :reason, :method, :refund, :vat, :cost, :restock, :shiftId, :asr, :userId)`,
      {
        orgId: user.orgId,
        orderId,
        returnNo,
        reason,
        method: refundMethod,
        refund,
        vat,
        cost: restock ? cost : 0,
        restock: restock ? 1 : 0,
        shiftId,
        asr: aftersalesReturnId,
        userId: user.id,
      },
    );
    const returnId = ins.insertId;

    const warehouseId = await warehouseForBranch(conn, user.orgId, o.branch_id);
    for (const p of picked) {
      const factor = Number(p.line.unit_factor ?? 1);
      const base = r3(p.qty * factor);
      // The lots this return puts back are kept on the line, so voiding it takes exactly those again
      const lots = restock ? lotsFor(parseAlloc(p.line.lot_allocations), r3(Number(p.line.returned_qty) * factor), base) : [];
      await conn.query(
        `INSERT INTO sales_return_items (return_id, order_item_id, product_id, quantity, amount, lot_allocations)
         VALUES (:returnId, :itemId, :productId, :qty, :amount, :lots)`,
        { returnId, itemId: p.line.id, productId: p.line.product_id, qty: p.qty, amount: p.amount, lots: lots.length ? JSON.stringify(lots) : null },
      );
      await conn.query('UPDATE sales_order_items SET returned_qty = returned_qty + :qty WHERE id = :id', { qty: p.qty, id: p.line.id });
      if (restock) {
        await restoreLots(conn, lots);
        await applyMovement(conn, {
          orgId: user.orgId,
          warehouseId,
          productId: p.line.product_id,
          quantity: base,
          type: 'return',
          refType: 'sales_return',
          refId: returnId,
          note: `คืนสินค้า ${returnNo} (บิล ${o.order_no}): ${reason}`,
          userId: user.id,
        });
      }
    }

    // Money back: a negative payment on the bill keeps per-method sales and shift reports net of refunds
    await conn.query('INSERT INTO payments (org_id, order_id, method, amount, reference) VALUES (:orgId, :orderId, :method, :amount, :ref)', {
      orgId: user.orgId,
      orderId,
      method: refundMethod,
      amount: -refund,
      ref: `RETURN ${returnNo}`,
    });
    if (refundMethod === 'cash' && shiftId && Number(shiftId) !== Number(o.shift_id)) {
      await conn.query("INSERT INTO cash_movements (shift_id, type, amount, reason, created_by) VALUES (:shiftId, 'pay_out', :amount, :reason, :userId)", {
        shiftId,
        amount: refund,
        reason: `${REFUND_PAYOUT_PREFIX}${returnNo} (บิล ${o.order_no})`,
        userId: user.id,
      });
    }
    await conn.query(
      `UPDATE sales_orders SET refunded_amount = refunded_amount + :refund, status = IF(:full, 'refunded', status) WHERE id = :orderId`,
      { refund, full: fullyReturned ? 1 : 0, orderId },
    );
    if (o.customer_id) {
      const pointsBack = Number(o.total) ? Math.floor((Number(o.points_earned ?? 0) * refund) / Number(o.total)) : 0;
      await conn.query(
        `UPDATE customers SET total_spent = GREATEST(total_spent - :refund, 0), order_count = GREATEST(order_count - :full, 0),
                points = GREATEST(points - :pointsBack, 0) WHERE id = :id`,
        { refund, full: fullyReturned ? 1 : 0, pointsBack, id: o.customer_id },
      );
    }
    // Dr sales (net of VAT) and output VAT | Cr cash/bank; goods back on the shelf: Dr inventory | Cr cost of sales
    await postJournal(conn, {
      orgId: user.orgId,
      date,
      description: `คืนสินค้า ${returnNo} (บิล ${o.order_no})`,
      refType: 'sales_return',
      refId: returnId,
      userId: user.id,
      lines: [
        { account: ACC.SALES, debit: r2(refund - vat) },
        { account: ACC.OUTPUT_VAT, debit: vat },
        { account: paymentAccount(refundMethod), credit: refund },
        ...(restock ? [{ account: ACC.INVENTORY, debit: cost }, { account: ACC.COGS, credit: cost }] : []),
      ],
    });
    if (aftersalesReturnId) {
      await conn.query(
        `UPDATE returns SET status = 'completed', resolution = 'refund', amount = :refund, order_id = :orderId WHERE id = :id AND org_id = :orgId`,
        { refund, orderId, id: aftersalesReturnId, orgId: user.orgId },
      );
    }
    return { id: returnId, returnNo, refund, vat, cost: restock ? cost : 0, fullyReturned };
  });
}

/**
 * Take back out the exact lots a return put on the shelf. A lot that has since been sold down
 * cannot give its full share; the shortfall then comes from the remaining lots (FEFO), so lots
 * never exceed the stock level.
 */
async function takeLots(conn, { warehouseId, productId, allocations }) {
  let short = 0;
  for (const a of allocations) {
    const [[lot]] = await conn.query('SELECT quantity FROM stock_lots WHERE id = :id FOR UPDATE', { id: a.lotId });
    const take = r3(Math.min(Number(lot?.quantity ?? 0), Number(a.qty)));
    if (take > 0) await conn.query('UPDATE stock_lots SET quantity = quantity - :take WHERE id = :id', { take, id: a.lotId });
    short = r3(short + Number(a.qty) - take);
  }
  if (short > 0) await consumeFefo(conn, { warehouseId, productId, qty: short });
}

/**
 * Void a mistaken return: everything createReturn did is undone, with history kept — the stock
 * goes back out, the refund is mirrored by a positive payment, the journal is reversed, and the
 * return row is marked voided. The bill can then be returned again (or voided once nothing is
 * refunded any more).
 */
async function voidReturn(user, orderId, returnId, reason, { shiftId = null } = {}) {
  return db.tx(async (conn) => {
    const [[o]] = await conn.query('SELECT * FROM sales_orders WHERE id = :orderId AND org_id = :orgId FOR UPDATE', { orderId, orgId: user.orgId });
    if (!o) throw notFound('ไม่พบบิล');
    const [[r]] = await conn.query('SELECT * FROM sales_returns WHERE id = :returnId AND order_id = :orderId AND org_id = :orgId FOR UPDATE', {
      returnId,
      orderId,
      orgId: user.orgId,
    });
    if (!r) throw notFound('ไม่พบรายการคืนสินค้า');
    if (r.voided_at) throw conflict('รายการคืนนี้ถูกยกเลิกไปแล้ว');
    if (o.status === 'cancelled') throw conflict('บิลนี้ถูกยกเลิกแล้ว');
    const refund = Number(r.refund_amount);
    const note = `${VOID_PAYIN_PREFIX}${r.return_no}`;

    // Cash refunded from another shift's drawer was booked as a pay-out there: drop it while that shift
    // is open, otherwise the money comes back into the drawer of whoever voids it now.
    let cashBack = null;
    if (r.refund_method === 'cash') {
      const [[mv]] = await conn.query(
        `SELECT m.id, m.shift_id, s.closed_at FROM cash_movements m JOIN pos_shifts s ON s.id = m.shift_id
          WHERE m.shift_id = :shiftId AND m.type = 'pay_out' AND m.reason LIKE :reason ORDER BY m.id LIMIT 1 FOR UPDATE`,
        { shiftId: r.shift_id ?? 0, reason: `${REFUND_PAYOUT_PREFIX}${r.return_no} %` },
      );
      if (mv && !mv.closed_at) cashBack = { delete: mv.id };
      else if (mv) {
        if (!shiftId) throw conflict('ต้องเปิดกะก่อน — เงินที่คืนลูกค้าจะกลับเข้าลิ้นชักกะปัจจุบัน');
        cashBack = { payIn: shiftId };
      }
    }

    const [items] = await conn.query(
      `SELECT ri.*, i.unit_factor FROM sales_return_items ri JOIN sales_order_items i ON i.id = ri.order_item_id WHERE ri.return_id = :returnId FOR UPDATE`,
      { returnId },
    );
    const warehouseId = r.restocked ? await warehouseForBranch(conn, user.orgId, o.branch_id) : null;
    for (const it of items) {
      await conn.query('UPDATE sales_order_items SET returned_qty = GREATEST(returned_qty - :qty, 0) WHERE id = :id', { qty: it.quantity, id: it.order_item_id });
      if (!r.restocked) continue;
      const base = r3(Number(it.quantity) * Number(it.unit_factor ?? 1));
      await takeLots(conn, { warehouseId, productId: it.product_id, allocations: parseAlloc(it.lot_allocations) });
      await applyMovement(conn, {
        orgId: user.orgId,
        warehouseId,
        productId: it.product_id,
        quantity: -base,
        type: 'sale',
        refType: 'sales_return',
        refId: returnId,
        note: `${note} (บิล ${o.order_no}): ${reason}`,
        userId: user.id,
      });
    }

    await conn.query('INSERT INTO payments (org_id, order_id, method, amount, reference) VALUES (:orgId, :orderId, :method, :amount, :ref)', {
      orgId: user.orgId,
      orderId,
      method: r.refund_method,
      amount: refund,
      ref: `VOID-RETURN ${r.return_no}`,
    });
    if (cashBack?.delete) await conn.query('DELETE FROM cash_movements WHERE id = :id', { id: cashBack.delete });
    if (cashBack?.payIn) {
      await conn.query("INSERT INTO cash_movements (shift_id, type, amount, reason, created_by) VALUES (:shiftId, 'pay_in', :amount, :reason, :userId)", {
        shiftId: cashBack.payIn,
        amount: refund,
        reason: `${note} (บิล ${o.order_no})`,
        userId: user.id,
      });
    }

    const wasRefunded = o.status === 'refunded';
    await conn.query(
      `UPDATE sales_orders SET refunded_amount = GREATEST(refunded_amount - :refund, 0), status = IF(status = 'refunded', 'completed', status) WHERE id = :orderId`,
      { refund, orderId },
    );
    if (o.customer_id) {
      // createReturn took off the refund, the bill's visit when it became fully returned, and the points' share
      const pointsBack = Number(o.total) ? Math.floor((Number(o.points_earned ?? 0) * refund) / Number(o.total)) : 0;
      await conn.query(
        'UPDATE customers SET total_spent = total_spent + :refund, order_count = order_count + :full, points = points + :pointsBack WHERE id = :id',
        { refund, full: wasRefunded ? 1 : 0, pointsBack, id: o.customer_id },
      );
    }
    await reverseJournalsFor(conn, {
      orgId: user.orgId,
      refType: 'sales_return',
      refId: returnId,
      reason: `ยกเลิกการคืน ${r.return_no} (${reason})`,
      userId: user.id,
    });
    await conn.query('UPDATE sales_returns SET voided_by = :userId, voided_at = UTC_TIMESTAMP(), void_reason = :reason WHERE id = :returnId', {
      userId: user.id,
      reason,
      returnId,
    });
    return { id: returnId, returnNo: r.return_no, refund };
  });
}

/** Returns already made on a bill, newest first, with their lines. */
async function listForOrder(orderId) {
  const rets = await db.query(
    `SELECT r.*, u.full_name AS user_name FROM sales_returns r LEFT JOIN users u ON u.id = r.created_by WHERE r.order_id = :orderId ORDER BY r.id DESC`,
    { orderId },
  );
  if (!rets.length) return [];
  const items = await db.query(
    `SELECT ri.return_id, ri.quantity, ri.amount, i.name, i.unit_name FROM sales_return_items ri
       JOIN sales_order_items i ON i.id = ri.order_item_id WHERE ri.return_id IN (:ids) ORDER BY ri.id`,
    { ids: rets.map((r) => r.id) },
  );
  return rets.map((r) => ({
    id: r.id,
    returnNo: r.return_no,
    reason: r.reason,
    refundMethod: r.refund_method,
    refundAmount: Number(r.refund_amount),
    restocked: Boolean(r.restocked),
    userName: r.user_name,
    createdAt: r.created_at,
    voided: Boolean(r.voided_at),
    voidedAt: r.voided_at ?? null,
    voidReason: r.void_reason ?? null,
    items: items
      .filter((i) => i.return_id === r.id)
      .map((i) => ({ name: i.name, unitName: i.unit_name, quantity: Number(i.quantity), amount: Number(i.amount) })),
  }));
}

module.exports = { createReturn, voidReturn, listForOrder, lotsFor, isAutoCashMovement };
