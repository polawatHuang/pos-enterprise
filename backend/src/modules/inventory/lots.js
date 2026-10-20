'use strict';

const { badRequest, conflict } = require('../../core/errors');
const { localDate } = require('../../utils/dates');

/**
 * Lots / expiry dates for products with track_expiry. Stock levels stay the source of truth
 * (applyMovement); lots say WHICH units are on the shelf. Stock received before tracking was
 * switched on simply has no lot ("untracked remainder") and is always allowed to move.
 */
const r3 = (n) => Math.round(n * 1000) / 1000;
const ymd = (d) => (d instanceof Date ? d.toISOString().slice(0, 10) : d ? String(d).slice(0, 10) : null);

async function trackInfo(conn, productId) {
  const [[p]] = await conn.query('SELECT track_expiry, shelf_life_days, name FROM products WHERE id = :productId', { productId });
  return { track: Boolean(p?.track_expiry), shelfLife: p?.shelf_life_days == null ? null : Number(p.shelf_life_days), name: p?.name };
}

/** Expiry for a receipt: the date given, else today + shelf life; tracked items must end up with one. */
function resolveExpiry(info, given) {
  if (given) return given;
  if (info.shelfLife != null) return localDate(new Date(Date.now() + info.shelfLife * 86_400_000));
  throw badRequest(`กรุณาใส่วันหมดอายุของ "${info.name}"`);
}

async function addLot(conn, { orgId, warehouseId, productId, qty, expiryDate = null, lotNo = null, unitCost = 0 }) {
  const [r] = await conn.query(
    `INSERT INTO stock_lots (org_id, warehouse_id, product_id, lot_no, expiry_date, quantity, unit_cost)
     VALUES (:orgId, :warehouseId, :productId, :lotNo, :expiryDate, :qty, :unitCost)`,
    { orgId, warehouseId, productId, lotNo, expiryDate, qty: r3(qty), unitCost: unitCost ?? 0 },
  );
  return r.insertId;
}

/** Receipt hook: when the product tracks expiry, record the lot that just arrived. */
async function receiveLot(conn, { orgId, warehouseId, productId, qty, expiryDate, lotNo, unitCost }) {
  const info = await trackInfo(conn, productId);
  if (!info.track) return null;
  return addLot(conn, { orgId, warehouseId, productId, qty, expiryDate: resolveExpiry(info, expiryDate), lotNo, unitCost });
}

/**
 * Take `qty` base units first-expiry-first-out (lots without a date last). With `forSale`, expired
 * lots are skipped and the sale is refused if unexpired + untracked stock cannot cover it.
 * @returns {Promise<{lotId:number, qty:number, expiry:string|null, cost:number, markdownPct:number}[]>}
 */
async function consumeFefo(conn, { warehouseId, productId, qty, forSale = false }) {
  const info = await trackInfo(conn, productId);
  if (!info.track || qty <= 0) return [];
  const today = localDate();
  const [lots] = await conn.query(
    `SELECT id, quantity, expiry_date, unit_cost, markdown_pct FROM stock_lots
      WHERE warehouse_id = :warehouseId AND product_id = :productId AND quantity > 0
      ORDER BY expiry_date IS NULL, expiry_date, id FOR UPDATE`,
    { warehouseId, productId },
  );
  const usable = forSale ? lots.filter((l) => !l.expiry_date || ymd(l.expiry_date) >= today) : lots;
  if (forSale) {
    const [[lvl]] = await conn.query('SELECT quantity FROM stock_levels WHERE warehouse_id = :warehouseId AND product_id = :productId AND variant_id = 0', {
      warehouseId,
      productId,
    });
    const inLots = lots.reduce((s, l) => s + Number(l.quantity), 0);
    // Call before applyMovement: units in stock that predate tracking have no lot and can always be sold
    const untracked = Math.max(Number(lvl?.quantity ?? 0) - inLots, 0);
    const available = usable.reduce((s, l) => s + Number(l.quantity), 0) + untracked;
    if (qty > available + 1e-9) throw conflict(`"${info.name}" ที่ยังไม่หมดอายุเหลือ ${r3(available)} — ล็อตที่เหลือหมดอายุแล้ว`);
  }
  const out = [];
  let left = qty;
  for (const l of usable) {
    if (left <= 1e-9) break;
    const take = Math.min(Number(l.quantity), left);
    await conn.query('UPDATE stock_lots SET quantity = quantity - :take WHERE id = :id', { take: r3(take), id: l.id });
    out.push({ lotId: l.id, qty: r3(take), expiry: ymd(l.expiry_date), cost: Number(l.unit_cost), markdownPct: Number(l.markdown_pct) });
    left = r3(left - take);
  }
  return out;
}

/** Put allocations back (void, cancelled transfer). */
async function restoreLots(conn, allocations) {
  for (const a of allocations ?? []) {
    await conn.query('UPDATE stock_lots SET quantity = quantity + :qty WHERE id = :id', { qty: a.qty, id: a.lotId });
  }
}

/** mysql2 may return JSON columns decoded or as text. */
const parseAlloc = (v) => {
  if (!v) return [];
  if (typeof v !== 'string') return v;
  try {
    return JSON.parse(v);
  } catch {
    return [];
  }
};

module.exports = { trackInfo, resolveExpiry, addLot, receiveLot, consumeFefo, restoreLots, parseAlloc, ymd };
