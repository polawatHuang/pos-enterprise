'use strict';

const crypto = require('node:crypto');
const bcrypt = require('bcryptjs');
const db = require('../../db/pool');
const env = require('../../config/env');
const slip2go = require('../../integrations/slip2go');
const { promptPayPayload, isValidPromptPayId } = require('../../utils/promptpay');
const { AppError, badRequest, conflict, notFound } = require('../../core/errors');
const { toPublicUser } = require('../auth/auth.service');
const authRepo = require('../auth/auth.repo');

const TRIAL_DAYS = 14;
const CREDIT_PACKS = [500, 1500, 3000];
const VAT_RATE = 0.07;

async function plans() {
  const rows = await db.query(
    `SELECT code, name, monthly_price_satangs, max_branches, max_users
       FROM saas_plans WHERE is_active = 1 ORDER BY monthly_price_satangs`,
  );
  return rows.map((r) => ({
    code: r.code,
    name: r.name,
    monthlyPrice: Number(r.monthly_price_satangs) / 100,
    maxBranches: Number(r.max_branches),
    maxUsers: Number(r.max_users),
  }));
}

async function createTenant({ organizationName, fullName, email, password, meta }) {
  const passwordHash = await bcrypt.hash(password, 12);
  try {
    const userId = await db.tx(async (conn) => {
      const [org] = await conn.query('INSERT INTO organizations (name, email) VALUES (:name, :email)', {
        name: organizationName,
        email,
      });
      const [branch] = await conn.query(
        `INSERT INTO branches (org_id, code, name, branch_no) VALUES (:orgId, 'HQ', 'สำนักงานใหญ่', '00000')`,
        { orgId: org.insertId },
      );
      await conn.query('INSERT INTO warehouses (org_id, branch_id, code, name) VALUES (:orgId, :branchId, :code, :name)', {
        orgId: org.insertId,
        branchId: branch.insertId,
        code: 'WH-HQ',
        name: 'คลังสำนักงานใหญ่',
      });
      const [[ownerRole]] = await conn.query("SELECT id FROM roles WHERE code = 'owner' LIMIT 1");
      if (!ownerRole) throw new AppError(503, 'RBAC_NOT_CONFIGURED', 'ระบบบทบาทยังไม่พร้อม กรุณาติดต่อผู้ดูแลระบบ');
      const [user] = await conn.query(
        `INSERT INTO users (org_id, branch_id, email, password_hash, full_name)
         VALUES (:orgId, :branchId, :email, :passwordHash, :fullName)`,
        { orgId: org.insertId, branchId: branch.insertId, email, passwordHash, fullName },
      );
      await conn.query('INSERT INTO user_roles (user_id, role_id) VALUES (:userId, :roleId)', { userId: user.insertId, roleId: ownerRole.id });
      await conn.query(
        `INSERT INTO saas_terms_acceptances (org_id, user_id, terms_version, privacy_version, ip, user_agent)
         VALUES (:orgId, :userId, '2026-10', '2026-10', :ip, :userAgent)`,
        { orgId: org.insertId, userId: user.insertId, ip: meta.ip ?? null, userAgent: meta.userAgent?.slice(0, 255) ?? null },
      );
      await conn.query(
        `INSERT INTO saas_subscriptions (org_id, plan_code, status, trial_ends_at)
         VALUES (:orgId, 'starter', 'trialing', UTC_TIMESTAMP() + INTERVAL :days DAY)`,
        { orgId: org.insertId, days: TRIAL_DAYS },
      );
      await conn.query('INSERT INTO ai_credit_wallets (org_id, balance) VALUES (:orgId, 0)', { orgId: org.insertId });
      return user.insertId;
    });
    const row = await authRepo.findUserById(userId);
    return { user: toPublicUser(row, await authRepo.loadRolesAndPermissions(userId)), meta };
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') throw conflict('อีเมลนี้ถูกใช้แล้ว');
    throw err;
  }
}

async function assertCapacity(conn, orgId, resource) {
  const column = resource === 'users' ? 'max_users' : 'max_branches';
  const table = resource === 'users' ? 'users' : 'branches';
  const active = resource === 'users' ? "AND status = 'active'" : 'AND is_active = 1';
  const [[subscription]] = await conn.query(
    `SELECT p.${column} AS quota
       FROM saas_subscriptions s LEFT JOIN saas_plans p ON p.code = s.plan_code
      WHERE s.org_id = :orgId LIMIT 1 FOR UPDATE`,
    { orgId },
  );
  if (!subscription || subscription.quota == null) return;
  const [[{ count }]] = await conn.query(`SELECT COUNT(*) AS count FROM ${table} WHERE org_id = :orgId ${active}`, { orgId });
  if (Number(count) >= Number(subscription.quota)) {
    throw new AppError(403, 'PLAN_LIMIT_REACHED', `แพ็กเกจปัจจุบันรองรับ${resource === 'users' ? 'ผู้ใช้' : 'สาขา'}ได้สูงสุด ${subscription.quota} รายการ กรุณาอัปเกรดแพ็กเกจ`, {
      resource,
      limit: Number(subscription.quota),
    });
  }
}

async function overview(orgId) {
  const [subscription, wallet] = await Promise.all([
    db.one(
      `SELECT s.plan_code,
              CASE
                WHEN s.status = 'trialing' AND s.trial_ends_at <= UTC_TIMESTAMP() THEN 'expired'
                WHEN s.status = 'active' AND s.current_period_end IS NOT NULL AND s.current_period_end <= UTC_TIMESTAMP() THEN 'expired'
                ELSE s.status
              END AS status,
              s.trial_ends_at, s.current_period_start, s.current_period_end,
              p.name AS plan_name, p.monthly_price_satangs, p.max_branches, p.max_users
         FROM saas_subscriptions s LEFT JOIN saas_plans p ON p.code = s.plan_code
        WHERE s.org_id = :orgId LIMIT 1`,
      { orgId },
    ),
    db.one('SELECT balance FROM ai_credit_wallets WHERE org_id = :orgId', { orgId }),
  ]);
  if (!subscription || !wallet) throw notFound('ไม่พบข้อมูลแพ็กเกจหรือกระเป๋าเครดิต');
  return {
    subscription: {
      planCode: subscription.plan_code,
      planName: subscription.plan_name || 'สมาชิกเดิม',
      status: subscription.status,
      trialEndsAt: subscription.trial_ends_at,
      currentPeriodStart: subscription.current_period_start,
      currentPeriodEnd: subscription.current_period_end,
      monthlyPrice: subscription.monthly_price_satangs == null ? null : Number(subscription.monthly_price_satangs) / 100,
      maxBranches: subscription.max_branches == null ? null : Number(subscription.max_branches),
      maxUsers: subscription.max_users == null ? null : Number(subscription.max_users),
    },
    credits: { balance: Number(wallet.balance), creditValue: 1, unit: 'THB before VAT' },
    creditPacks: CREDIT_PACKS,
  };
}

function paymentConfig() {
  const secretKey = env.SAAS_SLIP2GO_SECRET_KEY || env.SLIP2GO_SECRET_KEY;
  const promptPayId = env.SAAS_PROMPTPAY_ID || env.PROMPTPAY_CODE;
  if (!secretKey) throw new AppError(503, 'BILLING_NOT_CONFIGURED', 'ยังไม่ได้ตั้งค่า SLIP2GO_SECRET_KEY สำหรับตรวจสอบการชำระเงิน');
  if (!promptPayId || !isValidPromptPayId(promptPayId)) {
    throw new AppError(503, 'BILLING_NOT_CONFIGURED', 'ยังไม่ได้ตั้งค่า SAAS_PROMPTPAY_ID ให้เป็นเบอร์มือถือ เลขประจำตัว 13 หลัก หรือ PromptPay ID 15 หลัก');
  }
  return { secretKey, promptPayId };
}

function withVat(baseSatangs) {
  return Math.round(Number(baseSatangs) * (1 + VAT_RATE));
}

async function createCheckout(orgId, { planCode, credits }) {
  const { promptPayId } = paymentConfig();
  const [plan] = planCode ? (await plans()).filter((p) => p.code === planCode) : [];
  if (planCode && !plan) throw badRequest('ไม่พบแพ็กเกจที่เลือก');
  if (credits != null && !CREDIT_PACKS.includes(Number(credits))) throw badRequest('เลือกจำนวนเครดิตจากแพ็กเกจที่กำหนดเท่านั้น');
  if (!plan && credits == null) throw badRequest('เลือกแพ็กเกจสมาชิกหรือเครดิต AI');

  const orderId = crypto.randomUUID();
  const orderType = plan ? 'subscription' : 'ai_credits';
  const baseSatangs = plan ? Math.round(plan.monthlyPrice * 100) : Number(credits) * 100;
  const amountSatangs = withVat(baseSatangs);
  const amount = amountSatangs / 100;
  const expiresAt = new Date(Date.now() + 30 * 60_000);
  const qrPayload = promptPayPayload(promptPayId, amount);
  await db.query(
    `INSERT INTO saas_payment_orders (id, org_id, order_type, plan_code, credits, amount_satangs, provider, expires_at)
     VALUES (:id, :orgId, :type, :planCode, :credits, :amount, 'slip2go', UTC_TIMESTAMP() + INTERVAL 30 MINUTE)`,
    { id: orderId, orgId, type: orderType, planCode: plan?.code ?? null, credits: credits ?? null, amount: amountSatangs },
  );
  return { id: orderId, type: orderType, amount, qrPayload, expiresAt };
}

async function applyPaidOrder(orderId, amount) {
  return db.tx(async (conn) => {
    const [[order]] = await conn.query('SELECT * FROM saas_payment_orders WHERE id = :id LIMIT 1 FOR UPDATE', { id: orderId });
    if (!order) return { handled: false };
    if (order.status === 'paid') return { handled: true, duplicate: true };
    if (order.status !== 'pending' || Number(order.amount_satangs) !== Math.round(Number(amount) * 100)) {
      if (order.status === 'pending') {
        await conn.query("UPDATE saas_payment_orders SET status = 'failed' WHERE id = :id", { id: orderId });
      }
      return { handled: false, amountMismatch: true };
    }

    await conn.query("UPDATE saas_payment_orders SET status = 'paid', paid_at = UTC_TIMESTAMP() WHERE id = :id", { id: orderId });
    if (order.order_type === 'ai_credits') {
      const [[wallet]] = await conn.query('SELECT balance FROM ai_credit_wallets WHERE org_id = :orgId LIMIT 1 FOR UPDATE', { orgId: order.org_id });
      if (!wallet) throw new AppError(500, 'AI_WALLET_MISSING', 'ไม่พบกระเป๋าเครดิต AI ขององค์กร');
      const balance = Number(wallet.balance) + Number(order.credits);
      await conn.query('UPDATE ai_credit_wallets SET balance = :balance WHERE org_id = :orgId', { orgId: order.org_id, balance });
      await conn.query(
        `INSERT INTO ai_credit_ledger (org_id, amount, balance_after, entry_type, idempotency_key, description)
         VALUES (:orgId, :amount, :balance, 'topup', :key, :description)`,
        { orgId: order.org_id, amount: order.credits, balance, key: `order:${order.id}`, description: `เติมเครดิต AI (${order.credits} เครดิต)` },
      );
    } else {
      await conn.query(
        `UPDATE saas_subscriptions
            SET plan_code = :planCode, status = 'active',
                current_period_start = UTC_TIMESTAMP(),
                current_period_end = DATE_ADD(GREATEST(COALESCE(current_period_end, UTC_TIMESTAMP()), UTC_TIMESTAMP()), INTERVAL 1 MONTH),
                provider = 'slip2go'
          WHERE org_id = :orgId`,
        { orgId: order.org_id, planCode: order.plan_code },
      );
    }
    return { handled: true, duplicate: false };
  });
}

async function reconcileOrder(orgId, orderId) {
  const order = await db.one('SELECT id, provider, status, expires_at FROM saas_payment_orders WHERE id = :id AND org_id = :orgId', { id: orderId, orgId });
  if (!order) throw notFound('ไม่พบรายการชำระเงิน');
  if (order.status === 'pending' && new Date(order.expires_at) <= new Date()) {
    await db.query("UPDATE saas_payment_orders SET status = 'expired' WHERE id = :id AND status = 'pending'", { id: order.id });
    return { status: 'expired' };
  }
  const current = await db.one('SELECT status FROM saas_payment_orders WHERE id = :id', { id: order.id });
  return { status: current.status };
}

function validImageSignature(buffer, mimeType) {
  if (mimeType === 'image/jpeg') return buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  if (mimeType === 'image/png') return buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (mimeType === 'image/webp') return buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP';
  return false;
}

async function verifyOrderSlip(orgId, orderId, { mimeType, imageBase64 }) {
  const order = await db.one(
    `SELECT id, provider, status, amount_satangs, expires_at
       FROM saas_payment_orders WHERE id = :id AND org_id = :orgId`,
    { id: orderId, orgId },
  );
  if (!order) throw notFound('ไม่พบรายการชำระเงิน');
  if (order.status === 'paid') return { status: 'paid', verified: true, duplicate: true };
  if (order.status !== 'pending' || new Date(order.expires_at) <= new Date()) {
    if (order.status === 'pending') {
      await db.query("UPDATE saas_payment_orders SET status = 'expired' WHERE id = :id AND status = 'pending'", { id: orderId });
    }
    return { status: 'expired', verified: false, message: 'รายการชำระเงินหมดอายุ กรุณาสร้างรายการใหม่' };
  }
  if (order.provider !== 'slip2go') throw conflict('รายการนี้ไม่ได้สร้างด้วยช่องทางชำระเงินปัจจุบัน กรุณาสร้างรายการใหม่');
  const { secretKey } = paymentConfig();

  const imageBuffer = Buffer.from(imageBase64, 'base64');
  if (!imageBuffer.length || imageBuffer.length > 5 * 1024 * 1024 || !validImageSignature(imageBuffer, mimeType)) {
    throw badRequest('ไฟล์สลิปไม่ถูกต้อง หรือมีขนาดใหญ่เกิน 5 MB');
  }

  const result = await slip2go.verifySlipByImage({
    secretKey,
    imageBuffer,
    mimeType,
    expectedAmount: Number(order.amount_satangs) / 100,
  });
  if (!result.verified) {
    return { status: 'pending', verified: false, code: result.code, message: result.message };
  }

  const resultPaid = await applyPaidOrder(order.id, Number(order.amount_satangs) / 100);
  if (!resultPaid.handled) {
    throw new AppError(409, 'PAYMENT_AMOUNT_MISMATCH', 'ยอดชำระไม่ตรงกับรายการ กรุณาติดต่อฝ่ายบริการลูกค้า');
  }
  return { status: 'paid', verified: true, duplicate: resultPaid.duplicate, message: result.message };
}

async function creditHistory(orgId, page = 1) {
  const size = 25;
  const rows = await db.query(
    `SELECT id, amount, balance_after, entry_type, description, created_at
       FROM ai_credit_ledger WHERE org_id = :orgId
      ORDER BY id DESC LIMIT :limit OFFSET :offset`,
    { orgId, limit: size, offset: (page - 1) * size },
  );
  return rows.map((r) => ({ id: r.id, amount: Number(r.amount), balanceAfter: Number(r.balance_after), type: r.entry_type, description: r.description, createdAt: r.created_at }));
}

async function adminOrganizations() {
  const rows = await db.query(
    `SELECT o.id, o.name, o.email, s.plan_code, s.status, s.trial_ends_at, s.current_period_end, w.balance
       FROM organizations o
       LEFT JOIN saas_subscriptions s ON s.org_id = o.id
       LEFT JOIN ai_credit_wallets w ON w.org_id = o.id
      ORDER BY o.created_at DESC LIMIT 200`,
  );
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    email: r.email,
    planCode: r.plan_code,
    status: r.status,
    trialEndsAt: r.trial_ends_at,
    currentPeriodEnd: r.current_period_end,
    credits: Number(r.balance || 0),
  }));
}

module.exports = {
  TRIAL_DAYS,
  CREDIT_PACKS,
  plans,
  createTenant,
  assertCapacity,
  overview,
  createCheckout,
  reconcileOrder,
  verifyOrderSlip,
  creditHistory,
  adminOrganizations,
};
