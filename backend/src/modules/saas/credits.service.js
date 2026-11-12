'use strict';

const crypto = require('node:crypto');
const db = require('../../db/pool');
const logger = require('../../core/logger');
const { AppError } = require('../../core/errors');
const { current } = require('./credit-context');

const USD_TO_THB = 40;
const COST_MULTIPLIER = 2.5;
const CREDITS_PER_USD = USD_TO_THB * COST_MULTIPLIER;

function priceText(provider, model, inputTokens, outputTokens) {
  let inputUsdPerMillion = 1;
  let outputUsdPerMillion = 4;
  if (provider === 'anthropic') {
    const isSonnet = /sonnet/i.test(model || '');
    inputUsdPerMillion = isSonnet ? 3 : 15;
    outputUsdPerMillion = isSonnet ? 15 : 75;
  }
  const usd = (Math.max(0, inputTokens) * inputUsdPerMillion + Math.max(0, outputTokens) * outputUsdPerMillion) / 1_000_000;
  return Math.max(1, Math.ceil(usd * CREDITS_PER_USD));
}

function estimateInputTokens(value) {
  let textChars = 0;
  let images = 0;
  let documents = 0;
  const visit = (item) => {
    if (item == null) return;
    if (typeof item === 'string') {
      textChars += item.length;
      return;
    }
    if (Array.isArray(item)) {
      item.forEach(visit);
      return;
    }
    if (typeof item !== 'object') return;
    if (item.type === 'image' || item.type === 'image_url') images += 1;
    if (item.type === 'document') documents += 1;
    for (const [key, nested] of Object.entries(item)) {
      if (key === 'data' || key === 'image_base64') continue;
      visit(nested);
    }
  };
  visit(value);
  return Math.ceil(textChars / 1.5) + images * 3072 + documents * 12_000;
}

async function reserve(orgId, category, credits, idempotencyKey = crypto.randomUUID()) {
  const context = current();
  if (context?.platformAdmin) return { bypassed: true };
  if (!Number.isSafeInteger(Number(orgId)) || Number(orgId) <= 0 || Number(context?.orgId) !== Number(orgId)) {
    throw new AppError(503, 'AI_TENANT_CONTEXT_MISSING', 'ไม่สามารถระบุองค์กรสำหรับคิดเครดิต AI ได้ จึงหยุดงานเพื่อป้องกันค่าใช้จ่ายที่ไม่ได้บันทึก');
  }
  const reservationId = crypto.randomUUID();
  const amount = Math.max(1, Math.ceil(credits));
  await db.tx(async (conn) => {
    const [[wallet]] = await conn.query('SELECT balance FROM ai_credit_wallets WHERE org_id = :orgId LIMIT 1 FOR UPDATE', { orgId });
    if (!wallet) throw new AppError(503, 'AI_WALLET_MISSING', 'ไม่พบกระเป๋าเครดิต AI ขององค์กร');
    const balance = Number(wallet.balance);
    if (balance < amount) {
      throw new AppError(402, 'INSUFFICIENT_AI_CREDITS', `เครดิต AI ไม่พอ งานนี้ต้องสำรอง ${amount} เครดิต แต่มี ${balance} เครดิต`, {
        requiredCredits: amount,
        availableCredits: balance,
      });
    }
    const nextBalance = balance - amount;
    await conn.query('UPDATE ai_credit_wallets SET balance = :balance WHERE org_id = :orgId', { orgId, balance: nextBalance });
    await conn.query(
      `INSERT INTO ai_credit_reservations (id, org_id, idempotency_key, category, reserved_credits)
       VALUES (:id, :orgId, :key, :category, :credits)`,
      { id: reservationId, orgId, key: idempotencyKey, category, credits: amount },
    );
    await conn.query(
      `INSERT INTO ai_credit_ledger (org_id, reservation_id, amount, balance_after, entry_type, idempotency_key, description)
       VALUES (:orgId, :reservationId, :amount, :balance, 'reserve', :key, :description)`,
      {
        orgId,
        reservationId,
        amount: -amount,
        balance: nextBalance,
        key: `reserve:${idempotencyKey}`,
        description: `สำรองเครดิตสำหรับ ${category}`,
      },
    );
  });
  return { id: reservationId, orgId, credits: amount };
}

async function settle(reservation, chargedCredits) {
  if (!reservation || reservation.bypassed) return;
  const charged = Math.max(0, Math.ceil(chargedCredits));
  if (charged > reservation.credits) {
    throw new AppError(500, 'AI_RESERVATION_EXCEEDED', 'ต้นทุน AI สูงกว่าวงเงินที่สำรองไว้ งานถูกหยุดและเครดิตสำรองยังไม่คืน');
  }
  await db.tx(async (conn) => {
    const [[row]] = await conn.query('SELECT status, reserved_credits FROM ai_credit_reservations WHERE id = :id FOR UPDATE', { id: reservation.id });
    if (!row || row.status !== 'reserved') return;
    const reserved = Number(row.reserved_credits);
    const refund = reserved - charged;
    const [[wallet]] = await conn.query('SELECT balance FROM ai_credit_wallets WHERE org_id = :orgId LIMIT 1 FOR UPDATE', { orgId: reservation.orgId });
    if (!wallet) throw new AppError(503, 'AI_WALLET_MISSING', 'ไม่พบกระเป๋าเครดิต AI ขององค์กร');
    const nextBalance = Number(wallet.balance) + refund;
    if (refund) {
      await conn.query('UPDATE ai_credit_wallets SET balance = :balance WHERE org_id = :orgId', { orgId: reservation.orgId, balance: nextBalance });
      await conn.query(
        `INSERT INTO ai_credit_ledger (org_id, reservation_id, amount, balance_after, entry_type, idempotency_key, description)
         VALUES (:orgId, :reservationId, :amount, :balance, :type, :key, :description)`,
        {
          orgId: reservation.orgId,
          reservationId: reservation.id,
          amount: refund,
          balance: nextBalance,
          type: charged === 0 ? 'release' : 'settlement_refund',
          key: `settlement:${reservation.id}`,
          description: charged === 0 ? 'คืนเครดิตสำรอง เนื่องจากผู้ให้บริการปฏิเสธคำขอ' : 'คืนเครดิตส่วนที่ไม่ได้ใช้',
        },
      );
    }
    await conn.query(
      `UPDATE ai_credit_reservations SET charged_credits = :charged, status = 'settled', settled_at = UTC_TIMESTAMP()
        WHERE id = :id AND status = 'reserved'`,
      { id: reservation.id, charged },
    );
  });
}

function mayHaveBeenBilled(err) {
  const status = Number(err?.status);
  return !(status >= 400 && status < 500);
}

async function runMetered({ orgId, category, reserveCredits, actualCredits, execute }) {
  const reservation = await reserve(orgId, category, reserveCredits);
  try {
    const result = await execute();
    const actual = typeof actualCredits === 'function' ? actualCredits(result) : actualCredits;
    await settle(reservation, actual == null ? reservation.credits : actual);
    return result;
  } catch (err) {
    if (reservation && !reservation.bypassed) {
      try {
        await settle(reservation, mayHaveBeenBilled(err) ? reservation.credits : 0);
      } catch (settleErr) {
        logger.error({ err: settleErr, reservationId: reservation.id, orgId }, 'AI credit reservation could not be settled');
        throw new AppError(503, 'AI_CREDIT_SETTLEMENT_FAILED', 'งาน AI ล้มเหลวและตรวจสอบยอดเครดิตไม่สำเร็จ เครดิตสำรองจะถูกคงไว้จนกว่าระบบจะตรวจสอบได้');
      }
    }
    throw err;
  }
}

function meterText({ orgId, provider, model, system, messages, maxTokens = 4000, execute }) {
  const inputTokens = estimateInputTokens({ system, messages });
  const reserveCredits = priceText(provider, model, inputTokens, maxTokens) * 3;
  return runMetered({
    orgId,
    category: `text:${provider}`,
    reserveCredits,
    execute,
    actualCredits: (response) => {
      const usage = response?.usage;
      if (!usage) return null;
      const input = Number(usage.input_tokens || 0) + Number(usage.cache_read_input_tokens || 0) + Number(usage.cache_creation_input_tokens || 0);
      const output = Number(usage.output_tokens || 0);
      return priceText(provider, response.model || model, input, output);
    },
  });
}

function usdCredits(usd) {
  return Math.max(1, Math.ceil(Math.max(0, usd) * CREDITS_PER_USD));
}

function reserveMultiple(actualCredits, attempts = 3) {
  return Math.max(actualCredits, Math.ceil(actualCredits * attempts));
}

module.exports = {
  USD_TO_THB,
  COST_MULTIPLIER,
  CREDITS_PER_USD,
  priceText,
  estimateInputTokens,
  usdCredits,
  reserveMultiple,
  runMetered,
  meterText,
};
