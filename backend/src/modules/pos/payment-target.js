'use strict';

/**
 * Where a sale's money goes: a branch may have its own PromptPay ID and bank account; any field
 * it leaves empty falls back to the shop-wide one in POS settings.
 */
const { z } = require('zod');
const db = require('../../db/pool');
const { isValidPromptPayId } = require('../../utils/promptpay');
const { getSettings, formatAccountNo } = require('./pos.service');

const PROMPTPAY_MESSAGE = 'PromptPay ต้องเป็นเบอร์มือถือ 10 หลัก เลขผู้เสียภาษี 13 หลัก หรือเลขอ้างอิง e-Wallet/K PLUS 15 หลัก';

/** '' clears the value (falls back to the shop's). */
const promptpayIdSchema = z
  .string()
  .trim()
  .max(20)
  .transform((v) => v.replace(/[\s-]/g, ''))
  .refine((v) => v === '' || isValidPromptPayId(v), PROMPTPAY_MESSAGE);

const bankAccountSchema = z.object({
  bank: z.string().trim().min(1).max(60),
  type: z.string().trim().max(30).default('ออมทรัพย์'),
  number: z
    .string()
    .trim()
    .transform((v) => v.replace(/[\s-]/g, ''))
    .refine((v) => /^\d{10,15}$/.test(v), 'เลขที่บัญชีต้องเป็นตัวเลข 10-15 หลัก'),
  name: z.string().trim().min(1).max(100),
});

function parseAccount(v) {
  if (!v) return null;
  try {
    const a = typeof v === 'string' ? JSON.parse(v) : v;
    return a?.number ? a : null;
  } catch {
    return null;
  }
}

/** Effective PromptPay ID and bank account for a branch (null branch = shop-wide). */
async function paymentFor(orgId, branchId) {
  const [settings, branch] = await Promise.all([
    getSettings(orgId),
    branchId ? db.one('SELECT id, name, promptpay_id, bank_account FROM branches WHERE id = :branchId AND org_id = :orgId', { branchId, orgId }) : null,
  ]);
  const ownPromptpay = branch?.promptpay_id || null;
  const ownBank = parseAccount(branch?.bank_account);
  const bankAccount = ownBank ?? settings.bankAccount;
  return {
    settings,
    promptpayId: ownPromptpay ?? settings.promptpayId,
    bankAccount: bankAccount ? { ...bankAccount, display: formatAccountNo(bankAccount.number) } : null,
    branch: branch ? { id: branch.id, name: branch.name, ownPromptpay: Boolean(ownPromptpay), ownBank: Boolean(ownBank) } : null,
  };
}

module.exports = { paymentFor, parseAccount, promptpayIdSchema, bankAccountSchema, PROMPTPAY_MESSAGE };
