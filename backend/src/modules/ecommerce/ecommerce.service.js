'use strict';

const crypto = require('node:crypto');
const db = require('../../db/pool');
const env = require('../../config/env');
const { AppError, badRequest, conflict, notFound } = require('../../core/errors');
const { promptPayPayload, isValidPromptPayId } = require('../../utils/promptpay');
const { localDate } = require('../../utils/dates');
const { getTaxSettings } = require('../org/tax');
const { paymentFor } = require('../pos/payment-target');
const discounts = require('../pos/discounts');
const pos = require('../pos/pos.service');
const { applyMovement } = require('../inventory/inventory.service');
const { consumeFefo } = require('../inventory/lots');
const { postJournal, saleLines } = require('../accounting/ledger.service');
const slip2go = require('../../integrations/slip2go');
const media = require('../video/media');

const SHIPPING_FEE = 60;
const ORDER_TTL_MINUTES = 30;
const CUSTOMER_SESSION_DAYS = 30;
const r2 = (n) => Math.round(Number(n) * 100) / 100;
const slipSecret = () => env.SLIP2GO_SECRET_KEY || env.SAAS_SLIP2GO_SECRET_KEY || '';
const hash = (value) => crypto.createHash('sha256').update(value).digest('hex');
const lineLoginReady = () => Boolean(
  env.LINE_LOGIN_CHANNEL_ID && env.LINE_LOGIN_CHANNEL_SECRET && env.APP_PUBLIC_URL && env.ECOMMERCE_AUTH_PROXY_SECRET,
);

function validImageSignature(buffer, mimeType) {
  if (mimeType === 'image/jpeg') return buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  if (mimeType === 'image/png') return buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (mimeType === 'image/webp') return buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP';
  return false;
}

function normalizeItems(items) {
  const grouped = new Map();
  for (const item of items) {
    grouped.set(item.productId, (grouped.get(item.productId) ?? 0) + item.quantity);
  }
  if (Array.from(grouped.values()).some((quantity) => quantity > 99)) throw badRequest('สินค้าแต่ละรายการสั่งได้ไม่เกิน 99 ชิ้น');
  return Array.from(grouped, ([productId, quantity]) => ({ productId, quantity }));
}

function amountForCode(check, subtotal) {
  if (!check.valid || check.code?.customerId) return 0;
  return r2(Math.min(subtotal, Number(check.amount)));
}

async function storeBySlug(slug, { enabled = true } = {}) {
  const row = await db.one(
    `SELECT s.org_id, s.slug, s.store_name, s.warehouse_id, s.is_enabled,
            w.branch_id, w.name AS warehouse_name
       FROM ecommerce_stores s
       LEFT JOIN warehouses w ON w.id = s.warehouse_id AND w.org_id = s.org_id
      WHERE s.slug = :slug ${enabled ? 'AND s.is_enabled = 1' : ''}`,
    { slug },
  );
  if (!row) throw notFound('ไม่พบร้านค้าออนไลน์');
  return row;
}

async function ensureStore(orgId) {
  let store = await db.one('SELECT org_id, slug, store_name, warehouse_id, is_enabled FROM ecommerce_stores WHERE org_id = :orgId', { orgId });
  if (store) return store;
  await db.query(
    `INSERT IGNORE INTO ecommerce_stores (org_id, slug, warehouse_id, is_enabled)
     SELECT :orgId, CONCAT('store-', :orgId), (SELECT id FROM warehouses WHERE org_id = :orgId ORDER BY id LIMIT 1), 0
      FROM organizations WHERE id = :orgId`,
    { orgId },
  );
  store = await db.one('SELECT org_id, slug, store_name, warehouse_id, is_enabled FROM ecommerce_stores WHERE org_id = :orgId', { orgId });
  if (!store) throw notFound('ไม่พบข้อมูลองค์กร');
  return store;
}

async function paymentSetup(orgId, branchId) {
  const payment = await paymentFor(orgId, branchId);
  const promptpayId = payment.promptpayId ? String(payment.promptpayId).replace(/[\s-]/g, '') : '';
  return {
    promptpayId,
    ready: Boolean(slipSecret() && isValidPromptPayId(promptpayId)),
  };
}

async function publicStore(slug) {
  const store = await storeBySlug(slug);
  await db.tx((conn) => expirePendingOrders(conn, store.org_id));
  const setup = await paymentSetup(store.org_id, store.branch_id);
  const products = store.warehouse_id
    ? await db.query(
        `SELECT p.id, p.sku, p.name, p.description, p.image_url, p.price, p.unit,
                c.name AS category_name, (sl.quantity - sl.reserved) AS available
           FROM products p
           JOIN stock_levels sl ON sl.product_id = p.id AND sl.warehouse_id = :warehouseId AND sl.variant_id = 0
           LEFT JOIN product_categories c ON c.id = p.category_id
          WHERE p.org_id = :orgId AND p.status = 'active' AND p.open_price = 0
            AND (c.age_restricted IS NULL OR c.age_restricted = 0)
            AND sl.quantity > sl.reserved
          ORDER BY c.sort_order, p.name`,
        { orgId: store.org_id, warehouseId: store.warehouse_id },
      )
    : [];
  return {
    store: { name: store.store_name, slug: store.slug, warehouseName: store.warehouse_name },
    shippingFee: SHIPPING_FEE,
    paymentReady: setup.ready,
    customerLoginEnabled: lineLoginReady(),
    products: products.map((p) => ({
      id: Number(p.id),
      sku: p.sku,
      name: p.name,
      description: p.description,
      imageUrl: p.image_url,
      price: Number(p.price),
      unit: p.unit,
      category: p.category_name,
      available: Number(p.available),
    })),
  };
}

async function beginLineLogin(slug) {
  if (!lineLoginReady()) throw new AppError(503, 'LINE_LOGIN_NOT_CONFIGURED', 'ร้านค้ายังไม่ได้เปิดใช้งาน LINE Login');
  await storeBySlug(slug);
  await db.query('DELETE FROM ecommerce_line_login_states WHERE expires_at <= UTC_TIMESTAMP()');
  const state = crypto.randomBytes(32).toString('base64url');
  const codeVerifier = crypto.randomBytes(48).toString('base64url');
  const codeChallenge = crypto.createHash('sha256').update(codeVerifier).digest('base64url');
  await db.query(
    `INSERT INTO ecommerce_line_login_states (state_hash, store_slug, code_verifier, expires_at)
     VALUES (:stateHash, :slug, :codeVerifier, UTC_TIMESTAMP() + INTERVAL 10 MINUTE)`,
    { stateHash: hash(state), slug, codeVerifier },
  );
  const callback = new URL('/shop/auth/line/callback', env.APP_PUBLIC_URL).toString();
  const authorize = new URL('https://access.line.me/oauth2/v2.1/authorize');
  authorize.search = new URLSearchParams({
    response_type: 'code',
    client_id: env.LINE_LOGIN_CHANNEL_ID,
    redirect_uri: callback,
    state,
    scope: 'profile',
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
  }).toString();
  return { authorizationUrl: authorize.toString(), state };
}

async function completeLineLogin({ code, state, proxySecret }) {
  if (!lineLoginReady() || !proxySecret || Buffer.byteLength(proxySecret) !== Buffer.byteLength(env.ECOMMERCE_AUTH_PROXY_SECRET)
      || !crypto.timingSafeEqual(Buffer.from(proxySecret), Buffer.from(env.ECOMMERCE_AUTH_PROXY_SECRET))) {
    throw new AppError(403, 'FORBIDDEN', 'ไม่อนุญาตให้ดำเนินการ LINE Login callback');
  }
  const attempt = await db.tx(async (conn) => {
    const [[row]] = await conn.query(
      `SELECT state_hash, store_slug, code_verifier
         FROM ecommerce_line_login_states
        WHERE state_hash = :stateHash AND expires_at > UTC_TIMESTAMP()
        FOR UPDATE`,
      { stateHash: hash(state) },
    );
    if (!row) throw badRequest('LINE Login หมดอายุหรือ state ไม่ถูกต้อง กรุณาลองใหม่');
    await conn.query('DELETE FROM ecommerce_line_login_states WHERE state_hash = :stateHash', { stateHash: row.state_hash });
    return row;
  });
  const callback = new URL('/shop/auth/line/callback', env.APP_PUBLIC_URL).toString();
  let tokenResponse;
  try {
    const tokenRes = await fetch('https://api.line.me/oauth2/v2.1/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: callback,
        client_id: env.LINE_LOGIN_CHANNEL_ID,
        client_secret: env.LINE_LOGIN_CHANNEL_SECRET,
        code_verifier: attempt.code_verifier,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    tokenResponse = await tokenRes.json();
    if (!tokenRes.ok || !tokenResponse.access_token) {
      throw new AppError(401, 'LINE_LOGIN_FAILED', 'ยืนยันตัวตนกับ LINE ไม่สำเร็จ กรุณาลองเข้าสู่ระบบอีกครั้ง');
    }
    const profileRes = await fetch('https://api.line.me/v2/profile', {
      headers: { Authorization: `Bearer ${tokenResponse.access_token}` },
      signal: AbortSignal.timeout(10_000),
    });
    const profile = await profileRes.json();
    if (!profileRes.ok || typeof profile.userId !== 'string' || typeof profile.displayName !== 'string') {
      throw new AppError(401, 'LINE_LOGIN_FAILED', 'อ่านโปรไฟล์ LINE ไม่สำเร็จ กรุณาลองเข้าสู่ระบบอีกครั้ง');
    }
    const lineUserId = profile.userId.slice(0, 191);
    await db.query(
      `INSERT INTO ecommerce_customer_identities (line_user_id, display_name, picture_url)
       VALUES (:lineUserId, :displayName, :pictureUrl)
       ON DUPLICATE KEY UPDATE display_name = VALUES(display_name), picture_url = VALUES(picture_url)`,
      { lineUserId, displayName: profile.displayName.slice(0, 191), pictureUrl: typeof profile.pictureUrl === 'string' ? profile.pictureUrl.slice(0, 1000) : null },
    );
    const identity = await db.one(
      'SELECT id, display_name, picture_url FROM ecommerce_customer_identities WHERE line_user_id = :lineUserId',
      { lineUserId },
    );
    await db.query('DELETE FROM ecommerce_customer_sessions WHERE expires_at <= UTC_TIMESTAMP()');
    const sessionToken = crypto.randomBytes(48).toString('base64url');
    await db.query(
      `INSERT INTO ecommerce_customer_sessions (token_hash, identity_id, expires_at)
       VALUES (:tokenHash, :identityId, UTC_TIMESTAMP() + INTERVAL :days DAY)`,
      { tokenHash: hash(sessionToken), identityId: identity.id, days: CUSTOMER_SESSION_DAYS },
    );
    return {
      sessionToken,
      expiresIn: CUSTOMER_SESSION_DAYS * 86400,
      storeSlug: attempt.store_slug,
      customer: { displayName: identity.display_name, pictureUrl: identity.picture_url },
    };
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError(502, 'LINE_LOGIN_UNAVAILABLE', 'เชื่อมต่อ LINE Login ไม่สำเร็จ กรุณาลองใหม่ภายหลัง');
  }
}

async function customerIdentityFromToken(token) {
  if (!token || token.length > 128) return null;
  return db.one(
    `SELECT i.id, i.display_name, i.picture_url
       FROM ecommerce_customer_sessions s
       JOIN ecommerce_customer_identities i ON i.id = s.identity_id
      WHERE s.token_hash = :tokenHash AND s.expires_at > UTC_TIMESTAMP()`,
    { tokenHash: hash(token) },
  );
}

async function customerAccount(slug, token) {
  const store = await storeBySlug(slug, { enabled: false });
  const identity = await customerIdentityFromToken(token);
  if (!identity) throw new AppError(401, 'CUSTOMER_LOGIN_REQUIRED', 'กรุณาเข้าสู่ระบบด้วย LINE');
  const [addresses, orders] = await Promise.all([
    db.query(
      `SELECT id, recipient_name, phone, email, address, postal_code, is_default
         FROM ecommerce_customer_addresses
        WHERE org_id = :orgId AND identity_id = :identityId
        ORDER BY is_default DESC, updated_at DESC LIMIT 10`,
      { orgId: store.org_id, identityId: identity.id },
    ),
    db.query(
      `SELECT so.id, so.order_no, so.status, so.total, so.ordered_at, e.payment_status, e.public_token
         FROM ecommerce_order_details e
         JOIN sales_orders so ON so.id = e.sales_order_id
        WHERE e.org_id = :orgId AND e.customer_identity_id = :identityId
        ORDER BY so.ordered_at DESC LIMIT 50`,
      { orgId: store.org_id, identityId: identity.id },
    ),
  ]);
  return {
    customer: { displayName: identity.display_name, pictureUrl: identity.picture_url },
    addresses: addresses.map((row) => ({
      id: Number(row.id),
      recipientName: row.recipient_name,
      phone: row.phone,
      email: row.email,
      address: row.address,
      postalCode: row.postal_code,
      isDefault: Boolean(row.is_default),
    })),
    orders: orders.map((row) => ({
      id: Number(row.id),
      orderNo: row.order_no,
      status: row.payment_status === 'expired' ? 'expired' : row.status,
      total: Number(row.total),
      orderedAt: row.ordered_at,
      trackPath: `/shop/${slug}/track/${row.public_token}`,
    })),
  };
}

async function logoutCustomer(token) {
  if (token && token.length <= 128) {
    await db.query('DELETE FROM ecommerce_customer_sessions WHERE token_hash = :tokenHash', { tokenHash: hash(token) });
  }
}

async function deleteCustomerAddress(slug, token, addressId) {
  const store = await storeBySlug(slug, { enabled: false });
  const identity = await customerIdentityFromToken(token);
  if (!identity) throw new AppError(401, 'CUSTOMER_LOGIN_REQUIRED', 'กรุณาเข้าสู่ระบบด้วย LINE');
  await db.tx(async (conn) => {
    const [result] = await conn.query(
      `DELETE FROM ecommerce_customer_addresses
        WHERE id = :addressId AND org_id = :orgId AND identity_id = :identityId`,
      { addressId, orgId: store.org_id, identityId: identity.id },
    );
    if (!result.affectedRows) throw notFound('ไม่พบที่อยู่จัดส่ง');
    await conn.query(
      'UPDATE ecommerce_customer_addresses SET is_default = 0 WHERE org_id = :orgId AND identity_id = :identityId',
      { orgId: store.org_id, identityId: identity.id },
    );
    const [[remaining]] = await conn.query(
      `SELECT id FROM ecommerce_customer_addresses
        WHERE org_id = :orgId AND identity_id = :identityId
        ORDER BY updated_at DESC LIMIT 1`,
      { orgId: store.org_id, identityId: identity.id },
    );
    if (remaining) {
      await conn.query('UPDATE ecommerce_customer_addresses SET is_default = 1 WHERE id = :id', { id: remaining.id });
    }
  });
}

async function productReviews(slug, productId) {
  const store = await storeBySlug(slug);
  const product = await db.one(
    `SELECT id, name FROM products
      WHERE id = :productId AND org_id = :orgId AND status = 'active' AND open_price = 0`,
    { productId, orgId: store.org_id },
  );
  if (!product) throw notFound('ไม่พบสินค้า');
  const summary = await db.one(
    `SELECT COUNT(*) AS count, COALESCE(AVG(rating), 0) AS average
       FROM ecommerce_product_reviews
      WHERE org_id = :orgId AND product_id = :productId`,
    { orgId: store.org_id, productId },
  );
  const rows = await db.query(
    `SELECT rating, review_text, created_at
       FROM ecommerce_product_reviews
      WHERE org_id = :orgId AND product_id = :productId
      ORDER BY created_at DESC LIMIT 50`,
    { orgId: store.org_id, productId },
  );
  return {
    productName: product.name,
    count: Number(summary.count),
    average: Number(summary.average),
    reviews: rows.map((row) => ({
      rating: Number(row.rating),
      text: row.review_text,
      createdAt: row.created_at,
      reviewer: 'ผู้ซื้อที่ยืนยันแล้ว',
    })),
  };
}

async function reviewableItems(slug, productId, token) {
  const store = await storeBySlug(slug, { enabled: false });
  const identity = await customerIdentityFromToken(token);
  if (!identity) throw new AppError(401, 'CUSTOMER_LOGIN_REQUIRED', 'กรุณาเข้าสู่ระบบด้วย LINE');
  const rows = await db.query(
    `SELECT i.id AS order_item_id, so.order_no, so.ordered_at, i.quantity
       FROM ecommerce_order_details e
       JOIN sales_orders so ON so.id = e.sales_order_id
       JOIN sales_order_items i ON i.order_id = so.id
      WHERE e.org_id = :orgId AND e.customer_identity_id = :identityId
        AND e.payment_status = 'paid' AND so.status IN ('paid','packed','shipped','completed')
        AND i.product_id = :productId
        AND NOT EXISTS (
          SELECT 1 FROM ecommerce_product_reviews r WHERE r.sales_order_item_id = i.id
        )
      ORDER BY so.ordered_at DESC LIMIT 20`,
    { orgId: store.org_id, identityId: identity.id, productId },
  );
  return rows.map((row) => ({
    orderItemId: Number(row.order_item_id),
    orderNo: row.order_no,
    orderedAt: row.ordered_at,
    quantity: Number(row.quantity),
  }));
}

async function createProductReview(slug, productId, token, { orderItemId, rating, text }) {
  const store = await storeBySlug(slug, { enabled: false });
  const identity = await customerIdentityFromToken(token);
  if (!identity) throw new AppError(401, 'CUSTOMER_LOGIN_REQUIRED', 'กรุณาเข้าสู่ระบบด้วย LINE');
  await db.tx(async (conn) => {
    const [[item]] = await conn.query(
      `SELECT i.id
         FROM ecommerce_order_details e
         JOIN sales_orders so ON so.id = e.sales_order_id
         JOIN sales_order_items i ON i.order_id = so.id
        WHERE e.org_id = :orgId AND e.customer_identity_id = :identityId
          AND e.payment_status = 'paid' AND so.status IN ('paid','packed','shipped','completed')
          AND i.id = :orderItemId AND i.product_id = :productId
        FOR UPDATE`,
      { orgId: store.org_id, identityId: identity.id, orderItemId, productId },
    );
    if (!item) throw badRequest('รีวิวได้เฉพาะสินค้าที่ซื้อและชำระเงินแล้ว');
    await conn.query(
      `INSERT INTO ecommerce_product_reviews
         (org_id, product_id, sales_order_id, sales_order_item_id, customer_identity_id, rating, review_text)
       SELECT :orgId, :productId, i.order_id, i.id, :identityId, :rating, :text
         FROM sales_order_items i
        WHERE i.id = :orderItemId`,
      { orgId: store.org_id, productId, identityId: identity.id, rating, text: text || null, orderItemId },
    );
  }).catch((error) => {
    if (error.code === 'ER_DUP_ENTRY') throw conflict('สินค้ารายการนี้ได้รับรีวิวแล้ว');
    throw error;
  });
  return { ok: true };
}

async function publicStoreIndex() {
  const rows = await db.query(
    `SELECT s.slug, s.updated_at, p.id AS product_id
       FROM ecommerce_stores s
       JOIN products p ON p.org_id = s.org_id AND p.status = 'active' AND p.open_price = 0
       JOIN stock_levels sl
         ON sl.product_id = p.id AND sl.warehouse_id = s.warehouse_id AND sl.variant_id = 0
       LEFT JOIN product_categories c ON c.id = p.category_id
      WHERE s.is_enabled = 1
        AND s.warehouse_id IS NOT NULL
        AND (c.age_restricted IS NULL OR c.age_restricted = 0)
        AND sl.quantity > sl.reserved
      ORDER BY s.org_id, p.id`,
  );
  const stores = new Map();
  for (const row of rows) {
    const item = stores.get(row.slug) ?? { slug: row.slug, updatedAt: row.updated_at, productIds: [] };
    item.productIds.push(Number(row.product_id));
    stores.set(row.slug, item);
  }
  return Array.from(stores.values());
}

async function quote(slug, { items: rawItems, code = '' }) {
  const store = await storeBySlug(slug);
  await db.tx((conn) => expirePendingOrders(conn, store.org_id));
  const items = normalizeItems(rawItems);
  if (!store.warehouse_id) throw badRequest('ร้านยังไม่ได้เลือกคลังจัดส่ง');
  const products = await db.query(
    `SELECT p.id, p.name, p.price, p.status, p.open_price,
            (sl.quantity - sl.reserved) AS available
       FROM products p JOIN stock_levels sl
         ON sl.product_id = p.id AND sl.warehouse_id = :warehouseId AND sl.variant_id = 0
      WHERE p.org_id = :orgId AND p.id IN (:ids)`,
    { orgId: store.org_id, warehouseId: store.warehouse_id, ids: items.map((i) => i.productId) },
  );
  const byId = new Map(products.map((p) => [Number(p.id), p]));
  let subtotal = 0;
  for (const item of items) {
    const p = byId.get(item.productId);
    if (!p || p.status !== 'active' || p.open_price) throw badRequest('มีสินค้าที่ไม่พร้อมจำหน่ายในตะกร้า');
    if (item.quantity > Number(p.available)) throw conflict(`สินค้า "${p.name}" เหลือไม่พอ`);
    subtotal += Number(p.price) * item.quantity;
  }
  subtotal = r2(subtotal);
  let coupon = { valid: false, reason: null, amount: 0 };
  if (code.trim()) {
    const checked = await discounts.check(store.org_id, code, { subtotal, customerId: 0 });
    coupon = { valid: checked.valid && !checked.code?.customerId, reason: checked.reason, amount: amountForCode(checked, subtotal) };
    if (checked.valid && checked.code?.customerId) coupon.reason = 'โค้ดนี้สำหรับสมาชิกเฉพาะราย ไม่สามารถใช้กับร้านค้าออนไลน์ได้';
  }
  return {
    subtotal,
    discount: coupon.amount,
    shippingFee: SHIPPING_FEE,
    total: r2(subtotal - coupon.amount + SHIPPING_FEE),
    coupon,
  };
}

async function adminStore(orgId) {
  const store = await ensureStore(orgId);
  const [warehouses, warehouse] = await Promise.all([
    db.query('SELECT id, name, branch_id FROM warehouses WHERE org_id = :orgId ORDER BY id', { orgId }),
    store.warehouse_id
      ? db.one('SELECT w.id, w.name, w.branch_id FROM warehouses w WHERE w.id = :id AND w.org_id = :orgId', { id: store.warehouse_id, orgId })
      : null,
  ]);
  const payment = await paymentSetup(orgId, warehouse?.branch_id ?? null);
  return {
    slug: store.slug,
    storeName: store.store_name,
    enabled: Boolean(store.is_enabled),
    warehouseId: store.warehouse_id == null ? null : Number(store.warehouse_id),
    warehouseName: warehouse?.name ?? null,
    warehouses: warehouses.map((w) => ({ id: Number(w.id), name: w.name, branchId: w.branch_id == null ? null : Number(w.branch_id) })),
    paymentReady: payment.ready,
    paymentIssues: [
      ...(!payment.promptpayId ? ['กรุณาตั้งค่า PromptPay ใน POS > ตั้งค่าการชำระเงิน หรือในหน้าสาขา'] : []),
      ...(payment.promptpayId && !isValidPromptPayId(payment.promptpayId) ? ['PromptPay ID ไม่ถูกต้อง กรุณาตรวจสอบการตั้งค่ารับชำระ'] : []),
      ...(!slipSecret() ? ['เซิร์ฟเวอร์ยังไม่ได้ตั้งค่า SLIP2GO_SECRET_KEY'] : []),
    ],
  };
}

async function updateAdminStore(orgId, { enabled, warehouseId, storeName }) {
  const store = await ensureStore(orgId);
  const nextWarehouse = warehouseId === undefined ? store.warehouse_id : warehouseId;
  const nextEnabled = enabled === undefined ? Boolean(store.is_enabled) : enabled;
  if (nextEnabled && !nextWarehouse) throw badRequest('ก่อนเปิดร้าน กรุณาเลือกคลังจัดส่ง');
  if (nextWarehouse != null) {
    const found = await db.one('SELECT id, branch_id FROM warehouses WHERE id = :id AND org_id = :orgId', { id: nextWarehouse, orgId });
    if (!found) throw badRequest('ไม่พบคลังจัดส่งในองค์กรนี้');
    if (nextEnabled && !(await paymentSetup(orgId, found.branch_id)).ready) {
      throw badRequest('ก่อนเปิดร้าน กรุณาตั้งค่า PromptPay ของร้านและ SLIP2GO_SECRET_KEY บนเซิร์ฟเวอร์ให้พร้อม');
    }
  }
  await db.query(
    `UPDATE ecommerce_stores
        SET warehouse_id = :warehouseId, is_enabled = :enabled,
            store_name = COALESCE(:storeName, store_name)
      WHERE org_id = :orgId`,
    { orgId, warehouseId: nextWarehouse ?? null, enabled: Number(nextEnabled), storeName: storeName ?? null },
  );
  return adminStore(orgId);
}

async function expirePendingOrders(conn, orgId) {
  const [expired] = await conn.query(
    `SELECT e.sales_order_id, e.warehouse_id, so.discount_code_id
       FROM ecommerce_order_details e JOIN sales_orders so ON so.id = e.sales_order_id
      WHERE e.org_id = :orgId AND e.payment_status = 'pending' AND e.expires_at <= UTC_TIMESTAMP()
      FOR UPDATE`,
    { orgId },
  );
  for (const e of expired) {
    const [items] = await conn.query('SELECT product_id, quantity FROM sales_order_items WHERE order_id = :id ORDER BY product_id', { id: e.sales_order_id });
    for (const item of items) {
      await conn.query(
        `UPDATE stock_levels sl JOIN sales_orders so ON so.id = :orderId AND so.org_id = :orgId
            SET sl.reserved = GREATEST(sl.reserved - :qty, 0)
          WHERE sl.product_id = :productId AND sl.variant_id = 0
            AND sl.warehouse_id = :warehouseId`,
        { orderId: e.sales_order_id, orgId, warehouseId: e.warehouse_id, qty: Number(item.quantity), productId: item.product_id },
      );
    }
    if (e.discount_code_id) await conn.query('UPDATE discount_codes SET used_count = GREATEST(used_count - 1, 0) WHERE id = :id', { id: e.discount_code_id });
    await conn.query("UPDATE ecommerce_order_details SET payment_status = 'expired' WHERE sales_order_id = :id", { id: e.sales_order_id });
    await conn.query("UPDATE sales_orders SET status = 'cancelled' WHERE id = :id AND status = 'pending'", { id: e.sales_order_id });
  }
}

async function createOrder(slug, input, customerIdentityId = null) {
  const store = await storeBySlug(slug);
  if (!store.warehouse_id) throw badRequest('ร้านยังไม่ได้เลือกคลังจัดส่ง');
  const setup = await paymentSetup(store.org_id, store.branch_id);
  if (!setup.ready) throw new AppError(503, 'ECOMMERCE_PAYMENT_NOT_READY', 'ร้านยังไม่ได้ตั้งค่ารับชำระผ่าน PromptPay และ Slip2Go');
  const items = normalizeItems(input.items);
  const tax = await getTaxSettings(store.org_id);
  const publicToken = crypto.randomBytes(32).toString('base64url');
  const receiptToken = crypto.randomBytes(16).toString('base64url');
  const shortRef = crypto.randomBytes(4).toString('hex').toUpperCase();
  const draftOrderNo = `WEB-${Date.now()}-${shortRef}`;

  const created = await db.tx(async (conn) => {
    await expirePendingOrders(conn, store.org_id);
    const [products] = await conn.query(
      `SELECT p.id, p.name, p.price, p.cost, p.vat_type, p.status, p.open_price, sl.quantity, sl.reserved
         FROM products p JOIN stock_levels sl
           ON sl.product_id = p.id AND sl.warehouse_id = :warehouseId AND sl.variant_id = 0
        WHERE p.org_id = :orgId AND p.id IN (:ids) FOR UPDATE`,
      { orgId: store.org_id, warehouseId: store.warehouse_id, ids: items.map((i) => i.productId) },
    );
    const byId = new Map(products.map((p) => [Number(p.id), p]));
    const lines = items.map((item) => {
      const product = byId.get(item.productId);
      if (!product || product.status !== 'active' || product.open_price) throw badRequest('มีสินค้าที่ไม่พร้อมจำหน่ายในตะกร้า');
      const available = Number(product.quantity) - Number(product.reserved);
      if (item.quantity > available) throw conflict(`สินค้า "${product.name}" เหลือไม่พอ`);
      return {
        ...item,
        name: product.name,
        unitPrice: Number(product.price),
        unitCost: Number(product.cost),
        vatType: product.vat_type,
        lineTotal: r2(Number(product.price) * item.quantity),
      };
    });
    const subtotal = r2(lines.reduce((sum, line) => sum + line.lineTotal, 0));
    let codeId = null;
    let codeDiscount = 0;
    if (input.discountCode?.trim()) {
      const redeemed = await discounts.redeemInTx(conn, store.org_id, input.discountCode, { subtotal, customerId: 0 });
      if (redeemed.code.customer_id) throw badRequest('โค้ดนี้สำหรับสมาชิกเฉพาะราย ไม่สามารถใช้กับร้านค้าออนไลน์ได้');
      codeId = redeemed.code.id;
      codeDiscount = r2(Math.min(subtotal, redeemed.amount));
    }
    const totals = pos.computeTotals(lines, codeDiscount, tax);
    const shippingVat = tax.vatRegistered ? r2((SHIPPING_FEE * tax.vatRate) / (100 + tax.vatRate)) : 0;
    const shippingTotal = r2(totals.total + SHIPPING_FEE);
    const [sale] = await conn.query(
      `INSERT INTO sales_orders
         (org_id, branch_id, order_no, receipt_token, channel, status, subtotal, discount, shipping_fee, vat_amount,
          total, cost_total, discount_code_id, code_discount, ordered_at)
       VALUES (:orgId, :branchId, :orderNo, :receiptToken, 'website', 'pending', :subtotal, :discount, :shippingFee,
               :vat, :total, :cost, :codeId, :codeDiscount, UTC_TIMESTAMP())`,
      {
        orgId: store.org_id,
        branchId: store.branch_id,
        orderNo: draftOrderNo,
        receiptToken,
        subtotal: totals.subtotal,
        discount: codeDiscount,
        shippingFee: SHIPPING_FEE,
        vat: r2(totals.vat + shippingVat),
        total: shippingTotal,
        cost: totals.cost,
        codeId,
        codeDiscount,
      },
    );
    const salesOrderId = sale.insertId;
    const orderNo = `WEB-${String(salesOrderId).padStart(9, '0')}`;
    await conn.query('UPDATE sales_orders SET order_no = :orderNo WHERE id = :id', { orderNo, id: salesOrderId });
    for (const line of lines) {
      await conn.query(
        `INSERT INTO sales_order_items
           (order_id, product_id, variant_id, name, unit_factor, quantity, unit_price, unit_cost, discount, line_total)
         VALUES (:orderId, :productId, 0, :name, 1, :quantity, :unitPrice, :unitCost, 0, :lineTotal)`,
        { orderId: salesOrderId, ...line },
      );
      await conn.query(
        `UPDATE stock_levels SET reserved = reserved + :quantity
          WHERE warehouse_id = :warehouseId AND product_id = :productId AND variant_id = 0`,
        { warehouseId: store.warehouse_id, productId: line.productId, quantity: line.quantity },
      );
    }
    await conn.query(
      `INSERT INTO ecommerce_order_details
         (sales_order_id, org_id, customer_identity_id, warehouse_id, public_token, customer_name, phone, email, shipping_address, postal_code, customer_note, expires_at)
       VALUES (:salesOrderId, :orgId, :customerIdentityId, :warehouseId, :token, :name, :phone, :email, :address, :postalCode, :note,
               UTC_TIMESTAMP() + INTERVAL :ttl MINUTE)`,
      {
        salesOrderId,
        orgId: store.org_id,
        customerIdentityId,
        warehouseId: store.warehouse_id,
        token: publicToken,
        name: input.customerName,
        phone: input.phone,
        email: input.email ?? null,
        address: input.address,
        postalCode: input.postalCode,
        note: input.note ?? null,
        ttl: ORDER_TTL_MINUTES,
      },
    );
    if (customerIdentityId && input.saveAddress) {
      const [[addressCount]] = await conn.query(
        'SELECT COUNT(*) AS count FROM ecommerce_customer_addresses WHERE org_id = :orgId AND identity_id = :identityId',
        { orgId: store.org_id, identityId: customerIdentityId },
      );
      const [existing] = await conn.query(
        `SELECT id FROM ecommerce_customer_addresses
          WHERE org_id = :orgId AND identity_id = :identityId
            AND phone = :phone AND address = :address AND postal_code = :postalCode
          LIMIT 1 FOR UPDATE`,
        { orgId: store.org_id, identityId: customerIdentityId, phone: input.phone, address: input.address, postalCode: input.postalCode },
      );
      if (!existing.length && Number(addressCount.count) >= 10) throw badRequest('บันทึกที่อยู่ได้สูงสุด 10 รายการ กรุณาลบที่อยู่เก่าก่อน');
      await conn.query(
        'UPDATE ecommerce_customer_addresses SET is_default = 0 WHERE org_id = :orgId AND identity_id = :identityId',
        { orgId: store.org_id, identityId: customerIdentityId },
      );
      if (existing.length) {
        await conn.query(
          `UPDATE ecommerce_customer_addresses
              SET recipient_name = :name, email = :email, is_default = 1
            WHERE id = :id AND org_id = :orgId AND identity_id = :identityId`,
          { id: existing[0].id, orgId: store.org_id, identityId: customerIdentityId, name: input.customerName, email: input.email ?? null },
        );
      } else {
        await conn.query(
          `INSERT INTO ecommerce_customer_addresses
             (identity_id, org_id, recipient_name, phone, email, address, postal_code, is_default)
           VALUES (:identityId, :orgId, :name, :phone, :email, :address, :postalCode, 1)`,
          {
            identityId: customerIdentityId,
            orgId: store.org_id,
            name: input.customerName,
            phone: input.phone,
            email: input.email ?? null,
            address: input.address,
            postalCode: input.postalCode,
          },
        );
      }
    }
    await conn.query(
      `INSERT IGNORE INTO notifications (org_id, type, severity, title, body, link, permission, ref_key)
       VALUES (:orgId, 'ecommerce_order', 'info', 'มีคำสั่งซื้อใหม่', :body, '/ecommerce', 'pos:manage', :refKey)`,
      { orgId: store.org_id, body: `${orderNo} · ${input.customerName} · ${shippingTotal.toLocaleString('th-TH')} บาท`, refKey: `ecommerce:${salesOrderId}` },
    );
    return {
      id: salesOrderId,
      orderNo,
      token: publicToken,
      total: shippingTotal,
      subtotal: totals.subtotal,
      discount: codeDiscount,
      shippingFee: SHIPPING_FEE,
    };
  });
  const qrPayload = promptPayPayload(setup.promptpayId, created.total);
  const expiry = await db.one('SELECT expires_at FROM ecommerce_order_details WHERE sales_order_id = :id', { id: created.id });
  return {
    ...created,
    expiresAt: expiry?.expires_at ?? null,
    qrPayload,
    trackPath: `/shop/${slug}/track/${created.token}`,
  };
}

async function tracking(slug, token) {
  const store = await storeBySlug(slug, { enabled: false });
  const order = await db.one(
    `SELECT so.id, so.order_no, so.status, so.subtotal, so.discount, so.shipping_fee, so.total, so.ordered_at,
            e.public_token, e.customer_name, e.payment_status, e.expires_at, e.shipment_note, e.shipped_at, e.warehouse_id,
            e.org_id, e.sales_order_id, e.postal_code
       FROM ecommerce_order_details e JOIN sales_orders so ON so.id = e.sales_order_id
      WHERE e.org_id = :orgId AND e.public_token = :token`,
    { orgId: store.org_id, token },
  );
  if (!order) throw notFound('ไม่พบคำสั่งซื้อ');
  if (order.payment_status === 'pending' && new Date(order.expires_at) <= new Date()) {
    await db.tx((conn) => expirePendingOrders(conn, store.org_id));
    return tracking(slug, token);
  }
  const [items, warehouse] = await Promise.all([
    db.query('SELECT name, quantity, unit_price, line_total FROM sales_order_items WHERE order_id = :id ORDER BY id', { id: order.id }),
    db.one('SELECT w.branch_id FROM warehouses w WHERE w.id = :warehouseId AND w.org_id = :orgId', { warehouseId: order.warehouse_id, orgId: store.org_id }),
  ]);
  let qrPayload = null;
  if (order.payment_status === 'pending') {
    const setup = await paymentSetup(store.org_id, warehouse?.branch_id ?? null);
    if (setup.ready) qrPayload = promptPayPayload(setup.promptpayId, Number(order.total));
  }
  return {
    orderNo: order.order_no,
    status: order.payment_status === 'expired' ? 'expired' : order.status,
    paymentStatus: order.payment_status,
    customerName: order.customer_name,
    subtotal: Number(order.subtotal),
    discount: Number(order.discount),
    shippingFee: Number(order.shipping_fee),
    total: Number(order.total),
    orderedAt: order.ordered_at,
    expiresAt: order.expires_at,
    shipmentNote: order.shipment_note,
    shippedAt: order.shipped_at,
    qrPayload,
    items: items.map((i) => ({ name: i.name, quantity: Number(i.quantity), unitPrice: Number(i.unit_price), total: Number(i.line_total) })),
  };
}

async function verifySlip(slug, token, { mimeType, imageBase64 }) {
  const store = await storeBySlug(slug, { enabled: false });
  const order = await db.one(
    `SELECT e.sales_order_id, e.warehouse_id, e.payment_status, e.expires_at, so.org_id, so.total, so.order_no, so.status, so.vat_amount, so.cost_total
       FROM ecommerce_order_details e JOIN sales_orders so ON so.id = e.sales_order_id
      WHERE e.org_id = :orgId AND e.public_token = :token`,
    { orgId: store.org_id, token },
  );
  if (!order) throw notFound('ไม่พบคำสั่งซื้อ');
  if (order.payment_status !== 'pending' || order.status !== 'pending') throw conflict('คำสั่งซื้อนี้ไม่อยู่ในสถานะรอชำระเงิน');
  if (new Date(order.expires_at) <= new Date()) {
    await db.tx((conn) => expirePendingOrders(conn, store.org_id));
    throw conflict('รายการชำระเงินหมดอายุแล้ว กรุณาติดต่อร้านค้าก่อนโอนเงิน');
  }
  if (!slipSecret()) throw new AppError(503, 'SLIP2GO_NOT_CONFIGURED', 'ร้านค้ายังไม่ได้ตั้งค่าตรวจสอบสลิป Slip2Go');
  const imageBuffer = Buffer.from(imageBase64, 'base64');
  if (!imageBuffer.length || imageBuffer.length > 5 * 1024 * 1024 || !validImageSignature(imageBuffer, mimeType)) {
    throw badRequest('ไฟล์สลิปไม่ถูกต้อง หรือมีขนาดใหญ่เกิน 5 MB');
  }
  const result = await slip2go.verifySlipByImage({
    secretKey: slipSecret(),
    imageBuffer,
    mimeType,
    expectedAmount: Number(order.total),
  });
  if (!result.verified) return { verified: false, status: 'pending', message: result.message, code: result.code };

  const key = media.saveFile(imageBuffer, mimeType);
  try {
    await db.tx(async (conn) => {
      const [[locked]] = await conn.query(
        `SELECT e.sales_order_id, e.warehouse_id, e.org_id, e.payment_status, e.expires_at, e.customer_name,
                so.status, so.order_no, so.total, so.vat_amount, so.cost_total, so.branch_id, so.customer_id
           FROM ecommerce_order_details e JOIN sales_orders so ON so.id = e.sales_order_id
          WHERE e.sales_order_id = :id AND e.org_id = :orgId FOR UPDATE`,
        { id: order.sales_order_id, orgId: store.org_id },
      );
      if (!locked || locked.payment_status !== 'pending' || locked.status !== 'pending') throw conflict('คำสั่งซื้อนี้ได้รับการชำระเงินแล้วหรือหมดอายุ');
      if (new Date(locked.expires_at) <= new Date()) throw conflict('รายการชำระเงินหมดอายุแล้ว');
      const [lines] = await conn.query(
        `SELECT i.product_id, i.name, i.quantity, i.unit_price, i.unit_cost, i.line_total, p.track_expiry
           FROM sales_order_items i JOIN products p ON p.id = i.product_id WHERE i.order_id = :id ORDER BY i.product_id FOR UPDATE`,
        { id: order.sales_order_id },
      );
      const warehouseId = locked.warehouse_id;
      if (!warehouseId) throw badRequest('ไม่พบคลังจัดส่งของร้าน');
      for (const line of lines) {
        const qty = Number(line.quantity);
        const allocations = await consumeFefo(conn, { warehouseId, productId: line.product_id, qty, forSale: true });
        await conn.query(
          `UPDATE stock_levels SET reserved = GREATEST(reserved - :qty, 0)
            WHERE warehouse_id = :warehouseId AND product_id = :productId AND variant_id = 0`,
          { warehouseId, productId: line.product_id, qty },
        );
        await conn.query('UPDATE sales_order_items SET lot_allocations = :alloc WHERE order_id = :orderId AND product_id = :productId', {
          alloc: allocations.length ? JSON.stringify(allocations) : null,
          orderId: order.sales_order_id,
          productId: line.product_id,
        });
        await applyMovement(conn, {
          orgId: store.org_id,
          warehouseId,
          productId: line.product_id,
          quantity: -qty,
          type: 'sale',
          refType: 'sales_order',
          refId: order.sales_order_id,
          note: 'ขายผ่าน E-commerce',
        });
      }
      await conn.query("UPDATE sales_orders SET status = 'paid' WHERE id = :id", { id: order.sales_order_id });
      await conn.query(
        `UPDATE ecommerce_order_details SET payment_status = 'paid', slip_storage_key = :key
          WHERE sales_order_id = :id`,
        { id: order.sales_order_id, key },
      );
      await conn.query(
        `INSERT INTO payments (org_id, order_id, method, amount, reference)
         VALUES (:orgId, :orderId, 'promptpay', :amount, :reference)`,
        { orgId: store.org_id, orderId: order.sales_order_id, amount: Number(locked.total), reference: `Slip2Go ${locked.order_no}` },
      );
      await conn.query(
        `INSERT INTO payment_slips (org_id, trans_ref, amount, order_id, raw)
         VALUES (:orgId, :ref, :amount, :orderId, :raw)`,
        {
          orgId: store.org_id,
          ref: `WEB-${order.sales_order_id}`,
          amount: Number(locked.total),
          orderId: order.sales_order_id,
          raw: JSON.stringify({ provider: 'slip2go', code: result.code }),
        },
      );
      if (locked.customer_id) {
        await conn.query('UPDATE customers SET total_spent = total_spent + :total, order_count = order_count + 1 WHERE id = :id', {
          total: Number(locked.total),
          id: locked.customer_id,
        });
      }
      await postJournal(conn, {
        orgId: store.org_id,
        date: localDate(),
        description: `ขายออนไลน์ ${locked.order_no}`,
        refType: 'sales_order',
        refId: order.sales_order_id,
        lines: saleLines({
          total: Number(locked.total),
          vat: Number(locked.vat_amount),
          cost: Number(locked.cost_total),
          payments: [{ method: 'promptpay', amount: Number(locked.total) }],
        }),
      });
    });
  } catch (err) {
    media.removeFile(key);
    throw err;
  }
  return { verified: true, status: 'paid', message: result.message };
}

function mapAdminOrder(row) {
  return {
    id: Number(row.id),
    orderNo: row.order_no,
    status: row.status,
    paymentStatus: row.payment_status,
    customerName: row.customer_name,
    phone: row.phone,
    total: Number(row.total),
    itemCount: Number(row.item_count),
    createdAt: row.ordered_at,
    shippedAt: row.shipped_at,
  };
}

async function adminOrders(orgId, { status = 'all', q = '' } = {}) {
  await db.tx((conn) => expirePendingOrders(conn, orgId));
  const statuses = ['pending', 'paid', 'packed', 'shipped', 'completed', 'cancelled'];
  const rows = await db.query(
    `SELECT so.id, so.order_no, so.status, so.total, so.ordered_at, e.payment_status, e.customer_name, e.phone, e.shipped_at,
            (SELECT COUNT(*) FROM sales_order_items i WHERE i.order_id = so.id) AS item_count
       FROM sales_orders so JOIN ecommerce_order_details e ON e.sales_order_id = so.id
      WHERE so.org_id = :orgId AND (:status = 'all' OR so.status = :status)
        AND (:q = '' OR so.order_no LIKE :search OR e.customer_name LIKE :search OR e.phone LIKE :search)
      ORDER BY so.id DESC LIMIT 100`,
    { orgId, status: statuses.includes(status) ? status : 'all', q, search: `%${q}%` },
  );
  return rows.map(mapAdminOrder);
}

async function adminOrder(orgId, id) {
  const row = await db.one(
    `SELECT so.*, e.customer_name, e.phone, e.email, e.shipping_address, e.postal_code, e.customer_note,
            e.payment_status, e.shipment_note, e.shipped_at, e.slip_storage_key, e.shipment_evidence_key
       FROM sales_orders so JOIN ecommerce_order_details e ON e.sales_order_id = so.id
      WHERE so.org_id = :orgId AND so.id = :id`,
    { orgId, id },
  );
  if (!row) throw notFound('ไม่พบคำสั่งซื้อ');
  const items = await db.query('SELECT product_id, name, quantity, unit_price, line_total FROM sales_order_items WHERE order_id = :id ORDER BY id', { id });
  return {
    ...mapAdminOrder({ ...row, item_count: items.length }),
    subtotal: Number(row.subtotal),
    discount: Number(row.discount),
    shippingFee: Number(row.shipping_fee),
    address: row.shipping_address,
    postalCode: row.postal_code,
    email: row.email,
    note: row.customer_note,
    shipmentNote: row.shipment_note,
    paymentReference: row.order_no,
    items: items.map((i) => ({ productId: Number(i.product_id), name: i.name, quantity: Number(i.quantity), unitPrice: Number(i.unit_price), total: Number(i.line_total) })),
    hasSlip: Boolean(row.slip_storage_key),
    hasShipmentEvidence: Boolean(row.shipment_evidence_key),
  };
}

async function updateOrderStatus(orgId, userId, id, { status, evidence, mimeType, note }) {
  let key = null;
  if (status === 'shipped') {
    const buffer = Buffer.from(evidence ?? '', 'base64');
    if (!buffer.length || buffer.length > 5 * 1024 * 1024 || !validImageSignature(buffer, mimeType)) {
      throw badRequest('กรุณาแนบหลักฐานการจัดส่งเป็นรูปภาพ JPEG, PNG หรือ WebP ขนาดไม่เกิน 5 MB');
    }
    key = media.saveFile(buffer, mimeType);
  }
  try {
    await db.tx(async (conn) => {
      const [[order]] = await conn.query(
        `SELECT so.status FROM sales_orders so JOIN ecommerce_order_details e ON e.sales_order_id = so.id
          WHERE so.org_id = :orgId AND so.id = :id FOR UPDATE`,
        { orgId, id },
      );
      if (!order) throw notFound('ไม่พบคำสั่งซื้อ');
      if (status === 'packed') {
        if (order.status !== 'paid' && order.status !== 'packed') throw conflict('เริ่มแพ็กได้เฉพาะคำสั่งซื้อที่ชำระเงินแล้ว');
        await conn.query("UPDATE sales_orders SET status = 'packed' WHERE id = :id", { id });
      } else {
        if (order.status !== 'paid' && order.status !== 'packed') throw conflict('จัดส่งได้เฉพาะคำสั่งซื้อที่ชำระเงินแล้ว');
        await conn.query("UPDATE sales_orders SET status = 'shipped' WHERE id = :id", { id });
        await conn.query(
          `UPDATE ecommerce_order_details SET shipment_evidence_key = :key, shipment_note = :note,
                  shipped_at = UTC_TIMESTAMP(), shipped_by = :userId WHERE sales_order_id = :id`,
          { id, key, note: note || null, userId },
        );
      }
    });
  } catch (err) {
    if (key) media.removeFile(key);
    throw err;
  }
  return adminOrder(orgId, id);
}

async function readAdminFile(orgId, id, kind) {
  const column = kind === 'slip' ? 'slip_storage_key' : kind === 'shipment' ? 'shipment_evidence_key' : null;
  if (!column) throw notFound('ไม่พบไฟล์');
  const row = await db.one(
    `SELECT e.${column} AS storage_key FROM ecommerce_order_details e
      WHERE e.org_id = :orgId AND e.sales_order_id = :id`,
    { orgId, id },
  );
  const file = row?.storage_key && media.filePath(row.storage_key);
  if (!file) throw notFound('ไม่พบไฟล์');
  const mime = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp' }[media.extOf(row.storage_key)];
  return { file, mime };
}

module.exports = {
  SHIPPING_FEE,
  ORDER_TTL_MINUTES,
  validImageSignature,
  normalizeItems,
  publicStore,
  publicStoreIndex,
  beginLineLogin,
  completeLineLogin,
  customerIdentityFromToken,
  customerAccount,
  logoutCustomer,
  deleteCustomerAddress,
  productReviews,
  reviewableItems,
  createProductReview,
  quote,
  adminStore,
  updateAdminStore,
  createOrder,
  tracking,
  verifySlip,
  adminOrders,
  adminOrder,
  updateOrderStatus,
  readAdminFile,
};
