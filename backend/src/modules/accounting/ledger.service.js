'use strict';

const { badRequest } = require('../../core/errors');

const r2 = (n) => Math.round(Number(n) * 100) / 100;

/** Chart-of-accounts codes used by automatic postings (seeded Thai SME chart). */
const ACC = {
  CASH: '1100',
  BANK: '1110',
  AR: '1200',
  INVENTORY: '1300',
  INPUT_VAT: '1400',
  WHT_PREPAID: '1410', // tax withheld by our customers (claimable)
  AP: '2100',
  OUTPUT_VAT: '2200',
  WHT_PAYABLE: '2210', // tax we withheld from suppliers (remit via PND3/53)
  SALES: '4100',
  AFFILIATE: '4200',
  OTHER_INCOME: '4900',
  COGS: '5100',
  PLATFORM_FEES: '5600',
  OTHER_EXPENSE: '5900',
};

/** Cash in hand vs. every electronic method (PromptPay, card, transfer, platform payout). */
const paymentAccount = (method) => (method === 'cash' ? ACC.CASH : ACC.BANK);

/** Document number prefixes (Thai convention: one running sequence per type and month). */
const PREFIX = {
  quotation: 'QT',
  invoice: 'IV',
  tax_invoice: 'TI',
  receipt: 'RC',
  tax_invoice_receipt: 'TR',
  credit_note: 'CN',
  debit_note: 'DN',
  wht_certificate: 'WT',
  purchase_order: 'PO',
  expense_voucher: 'EX',
  journal: 'JV',
};

/**
 * Next gap-free number for (type, month), e.g. TI202610-0007. Must run inside a transaction:
 * one atomic upsert both creates the month's counter and increments it, and the row stays
 * locked until commit, so concurrent issuers queue (and a rollback gives the number back).
 * @param {string} date  YYYY-MM-DD (business date of the document)
 */
async function nextNumber(conn, orgId, docType, date) {
  const period = String(date).slice(0, 7).replace('-', '');
  await conn.query(
    `INSERT INTO document_sequences (org_id, doc_type, period, last_no) VALUES (:orgId, :docType, :period, LAST_INSERT_ID(1))
     ON DUPLICATE KEY UPDATE last_no = LAST_INSERT_ID(last_no + 1)`,
    { orgId, docType, period },
  );
  const [[row]] = await conn.query('SELECT LAST_INSERT_ID() AS n');
  return `${PREFIX[docType] ?? 'DOC'}${period}-${String(row.n).padStart(4, '0')}`;
}

async function accountIds(conn, orgId) {
  const [rows] = await conn.query('SELECT id, code FROM chart_of_accounts WHERE org_id = :orgId', { orgId });
  return new Map(rows.map((r) => [r.code, r.id]));
}

/**
 * Write a balanced double-entry journal. Lines with zero amounts are dropped.
 * @param {{orgId:number, date:string, description:string, refType?:string, refId?:number, userId?:number,
 *          lines:{account:string, debit?:number, credit?:number, memo?:string}[]}} entry
 */
async function postJournal(conn, { orgId, date, description, refType = null, refId = null, userId = null, lines }) {
  const clean = lines
    .map((l) => ({ ...l, debit: r2(l.debit ?? 0), credit: r2(l.credit ?? 0) }))
    .filter((l) => l.debit !== 0 || l.credit !== 0);
  if (!clean.length) return null;
  const dr = r2(clean.reduce((s, l) => s + l.debit, 0));
  const cr = r2(clean.reduce((s, l) => s + l.credit, 0));
  if (dr !== cr) throw badRequest(`รายการบัญชีไม่สมดุล (เดบิต ${dr} / เครดิต ${cr})`);

  const ids = await accountIds(conn, orgId);
  const entryNo = await nextNumber(conn, orgId, 'journal', date);
  const [res] = await conn.query(
    `INSERT INTO journal_entries (org_id, entry_no, entry_date, description, ref_type, ref_id, status, created_by)
     VALUES (:orgId, :entryNo, :date, :description, :refType, :refId, 'posted', :userId)`,
    { orgId, entryNo, date, description: description.slice(0, 500), refType, refId, userId },
  );
  for (const l of clean) {
    const accountId = ids.get(l.account);
    if (!accountId) throw badRequest(`ไม่พบรหัสบัญชี ${l.account} ในผังบัญชี`);
    await conn.query(
      'INSERT INTO journal_lines (entry_id, account_id, debit, credit, memo) VALUES (:entryId, :accountId, :debit, :credit, :memo)',
      { entryId: res.insertId, accountId, debit: l.debit, credit: l.credit, memo: l.memo ?? null },
    );
  }
  return { id: res.insertId, entryNo };
}

/**
 * Reverse every posted journal of a source record with mirror entries (debit <-> credit), dated
 * like the original so the voided amount drops out of that period's reports. Originals are kept,
 * so the audit trail shows both the posting and its reversal.
 */
async function reverseJournalsFor(conn, { orgId, refType, refId, reason, userId = null }) {
  const [entries] = await conn.query(
    `SELECT id, entry_no, DATE_FORMAT(entry_date, '%Y-%m-%d') AS entry_date FROM journal_entries
      WHERE org_id = :orgId AND ref_type = :refType AND ref_id = :refId AND status = 'posted'
        AND description NOT LIKE 'กลับรายการ%'`,
    { orgId, refType, refId },
  );
  const [codes] = await conn.query('SELECT id, code FROM chart_of_accounts WHERE org_id = :orgId', { orgId });
  const codeOf = new Map(codes.map((c) => [c.id, c.code]));
  for (const e of entries) {
    const [lines] = await conn.query('SELECT account_id, debit, credit FROM journal_lines WHERE entry_id = :id', { id: e.id });
    await postJournal(conn, {
      orgId,
      date: e.entry_date,
      description: `กลับรายการ ${e.entry_no}: ${reason}`,
      refType,
      refId,
      userId,
      lines: lines.map((l) => ({ account: codeOf.get(l.account_id), debit: Number(l.credit), credit: Number(l.debit) })),
    });
  }
  return entries.length;
}

/* ---------------------------------------------------- standard postings */

/** POS / marketplace sale: cash or bank against revenue + output VAT, and cost of goods sold. */
function saleLines({ total, vat, cost, method, platformFee = 0 }) {
  return [
    { account: paymentAccount(method), debit: r2(total - platformFee) },
    { account: ACC.PLATFORM_FEES, debit: platformFee },
    { account: ACC.SALES, credit: r2(total - vat) },
    { account: ACC.OUTPUT_VAT, credit: vat },
    { account: ACC.COGS, debit: cost },
    { account: ACC.INVENTORY, credit: cost },
  ];
}

/**
 * Income/expense entry from the simple ledger.
 * expense: Dr expense (+ VAT if not claimable), Dr input VAT | Cr cash/bank (net paid), Cr WHT payable
 * income:  Dr cash/bank (net received), Dr WHT prepaid | Cr income, Cr output VAT
 */
function transactionLines({ type, account, amount, vat, vatClaimable, wht, method }) {
  const net = r2(amount + vat - wht);
  if (type === 'expense') {
    return [
      { account, debit: vatClaimable ? amount : r2(amount + vat) },
      { account: ACC.INPUT_VAT, debit: vatClaimable ? vat : 0 },
      { account: paymentAccount(method), credit: net },
      { account: ACC.WHT_PAYABLE, credit: wht },
    ];
  }
  return [
    { account: paymentAccount(method), debit: net },
    { account: ACC.WHT_PREPAID, debit: wht },
    { account, credit: amount },
    { account: ACC.OUTPUT_VAT, credit: vat },
  ];
}

module.exports = { ACC, PREFIX, r2, paymentAccount, nextNumber, postJournal, reverseJournalsFor, saleLines, transactionLines };
