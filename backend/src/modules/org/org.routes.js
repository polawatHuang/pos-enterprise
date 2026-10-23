'use strict';

const express = require('express');
const db = require('../../db/pool');
const { z } = require('zod');
const { authenticate, requirePermission } = require('../../core/auth');
const { validate } = require('../../core/http');
const { audit } = require('../../core/audit');
const { badRequest, conflict, forbidden, notFound } = require('../../core/errors');
const { resetOrgData, CONFIRM_PHRASE } = require('./reset');
const { getTaxSettings, saveTaxSettings, VAT_TYPES } = require('./tax');
const { parseAccount, promptpayIdSchema, bankAccountSchema } = require('../pos/payment-target');
const { formatAccountNo } = require('../pos/pos.service');

const router = express.Router();
router.use(authenticate);

/* ---------------------------------------------------------------- branches */

router.get('/branches', async (req, res) => {
  const rows = await db.query(
    `SELECT b.id, b.code, b.name, b.branch_no AS branchNo, b.address, b.promptpay_id, b.bank_account, b.is_active AS isActive,
            (SELECT w.id FROM warehouses w WHERE w.branch_id = b.id ORDER BY w.id LIMIT 1) AS warehouseId,
            (SELECT w.name FROM warehouses w WHERE w.branch_id = b.id ORDER BY w.id LIMIT 1) AS warehouseName
       FROM branches b WHERE b.org_id = :orgId ORDER BY b.code`,
    { orgId: req.user.orgId },
  );
  res.json({
    data: rows.map(({ promptpay_id: promptpayId, bank_account: bank, ...r }) => {
      const bankAccount = parseAccount(bank);
      return { ...r, isActive: Boolean(r.isActive), promptpayId: promptpayId || null, bankAccount: bankAccount && { ...bankAccount, display: formatAccountNo(bankAccount.number) } };
    }),
  });
});

const branchBody = z.object({
  code: z
    .string()
    .trim()
    .min(1, 'ใส่รหัสสาขา')
    .max(32)
    .regex(/^[A-Za-z0-9_-]+$/, 'รหัสสาขาใช้ได้เฉพาะ A-Z, 0-9, - และ _')
    .transform((v) => v.toUpperCase()),
  name: z.string().trim().min(1, 'ใส่ชื่อสาขา').max(191),
  // Revenue Department branch number on tax invoices: 00000 = head office
  branchNo: z.string().trim().regex(/^\d{5}$/, 'เลขที่สาขาต้องเป็นตัวเลข 5 หลัก (สำนักงานใหญ่ = 00000)'),
  address: z.string().trim().max(1000).nullable().optional(),
  // This branch's own payment accounts; null / '' = use the shop-wide ones from POS settings
  promptpayId: promptpayIdSchema.nullable().optional(),
  bankAccount: bankAccountSchema.nullable().optional(),
  // Name of the branch's stock location (warehouse); shown in stock, transfers, counts and welfare
  warehouseName: z.string().trim().min(1, 'ใส่ชื่อคลังสินค้า').max(191).optional(),
});
/** Default name of a branch's warehouse; renaming the branch renames a warehouse still named so. */
const defaultWarehouseName = (branchName) => `คลัง ${branchName}`.slice(0, 191);
const branchValues = (b) => ({
  ...b,
  address: b.address || null,
  promptpayId: b.promptpayId || null,
  bankAccount: b.bankAccount ? JSON.stringify(b.bankAccount) : null,
});
const branchId = z.object({ id: z.coerce.number().int().positive() });
const duplicateCode = (err) => {
  if (err.code === 'ER_DUP_ENTRY') throw conflict('รหัสสาขานี้มีอยู่แล้ว');
  throw err;
};

/** New branch with its own stock location, so POS sales there have a warehouse to draw from. */
router.post('/branches', requirePermission('settings:manage'), validate({ body: branchBody }), async (req, res) => {
  const b = req.valid.body;
  const orgId = req.user.orgId;
  const id = await db
    .tx(async (conn) => {
      const [r] = await conn.query(
        `INSERT INTO branches (org_id, code, name, branch_no, address, promptpay_id, bank_account)
         VALUES (:orgId, :code, :name, :branchNo, :address, :promptpayId, :bankAccount)`,
        { orgId, ...branchValues(b) },
      );
      // Warehouse codes are unique per org too; add a suffix if WH-<code> is taken
      const [[taken]] = await conn.query('SELECT COUNT(*) AS n FROM warehouses WHERE org_id = :orgId AND code = :code', { orgId, code: `WH-${b.code}` });
      await conn.query('INSERT INTO warehouses (org_id, branch_id, code, name) VALUES (:orgId, :branchId, :code, :name)', {
        orgId,
        branchId: r.insertId,
        code: Number(taken.n) ? `WH-${b.code}-${r.insertId}` : `WH-${b.code}`,
        name: b.warehouseName || defaultWarehouseName(b.name),
      });
      return r.insertId;
    })
    .catch(duplicateCode);
  audit(req, 'branch.create', 'branch', id, { code: b.code, name: b.name });
  res.status(201).json({ data: { id } });
});

router.patch(
  '/branches/:id',
  requirePermission('settings:manage'),
  validate({ params: branchId, body: branchBody.partial().extend({ isActive: z.boolean().optional() }) }),
  async (req, res) => {
    const orgId = req.user.orgId;
    const { id } = req.valid.params;
    const b = req.valid.body;
    const current = await db.one('SELECT id, name, is_active FROM branches WHERE id = :id AND org_id = :orgId', { id, orgId });
    if (!current) throw notFound('ไม่พบสาขา');

    if (b.isActive === false && current.is_active) {
      const active = await db.one('SELECT COUNT(*) AS n FROM branches WHERE org_id = :orgId AND is_active = 1', { orgId });
      if (Number(active.n) <= 1) throw badRequest('ต้องมีสาขาที่เปิดใช้งานอย่างน้อย 1 สาขา');
      const open = await db.one('SELECT COUNT(*) AS n FROM pos_shifts WHERE branch_id = :id AND closed_at IS NULL', { id });
      if (Number(open.n)) throw badRequest('สาขานี้ยังมีกะขายที่เปิดอยู่ ปิดกะก่อนจึงปิดใช้งานสาขาได้');
    }

    // Only the fields that were sent
    const cols = { code: 'code', name: 'name', branchNo: 'branch_no', address: 'address', promptpayId: 'promptpay_id', bankAccount: 'bank_account', isActive: 'is_active' };
    const sets = Object.keys(cols).filter((k) => b[k] !== undefined);
    if (!sets.length && b.warehouseName === undefined) throw badRequest('ไม่มีข้อมูลที่จะแก้ไข');
    const values = branchValues(b);
    const params = { id, orgId };
    for (const k of sets) params[k] = k === 'isActive' ? (b[k] ? 1 : 0) : values[k];
    const renamed = await db
      .tx(async (conn) => {
        if (sets.length) await conn.query(`UPDATE branches SET ${sets.map((k) => `${cols[k]} = :${k}`).join(', ')} WHERE id = :id AND org_id = :orgId`, params);
        // The branch's warehouse: an explicit new name, or follow a branch rename while it still has
        // the automatic name ("คลัง <old branch name>" or the old branch name itself)
        const [[wh]] = await conn.query('SELECT id, name FROM warehouses WHERE branch_id = :id AND org_id = :orgId ORDER BY id LIMIT 1 FOR UPDATE', { id, orgId });
        if (!wh) return null;
        let name = b.warehouseName;
        if (name === undefined && b.name && b.name !== current.name && [defaultWarehouseName(current.name), current.name].includes(wh.name)) {
          name = defaultWarehouseName(b.name);
        }
        if (!name || name === wh.name) return null;
        await conn.query('UPDATE warehouses SET name = :name WHERE id = :whId', { name, whId: wh.id });
        return name;
      })
      .catch(duplicateCode);
    audit(req, 'branch.update', 'branch', id, { fields: renamed ? [...sets, 'warehouseName'] : sets, ...(renamed ? { warehouseName: renamed } : {}) });
    res.json({ data: { id } });
  },
);

router.get('/roles', requirePermission('users:read'), async (req, res) => {
  const rows = await db.query(
    `SELECT r.code, r.name, r.description, GROUP_CONCAT(p.code ORDER BY p.code) AS permissions
       FROM roles r
       LEFT JOIN role_permissions rp ON rp.role_id = r.id
       LEFT JOIN permissions p ON p.id = rp.permission_id
      GROUP BY r.id
      ORDER BY r.id`,
  );
  res.json({ data: rows.map((r) => ({ ...r, permissions: r.permissions ? r.permissions.split(',') : [] })) });
});

router.get('/organization', async (req, res) => {
  const org = await db.one(
    // Any signed-in user: document headers (purchase orders, receipts) need the seller's details
    `SELECT id, name, legal_name AS legalName, tax_id AS taxId, address, phone, vat_registered AS vatRegistered, currency, timezone
       FROM organizations WHERE id = :orgId`,
    { orgId: req.user.orgId },
  );
  res.json({ data: { ...org, vatRegistered: Boolean(org.vatRegistered) } });
});

/**
 * Delete a branch that was never used. Deleting a warehouse cascades to stock movements, levels,
 * lots and counts, and sales orders would lose their branch, so a branch with any history can
 * only be disabled (its sales and stock records stay intact).
 */
router.delete('/branches/:id', requirePermission('settings:manage'), validate({ params: branchId }), async (req, res) => {
  const orgId = req.user.orgId;
  const { id } = req.valid.params;
  const branch = await db.one('SELECT id, name FROM branches WHERE id = :id AND org_id = :orgId', { id, orgId });
  if (!branch) throw notFound('ไม่พบสาขา');
  const others = await db.one('SELECT COUNT(*) AS n FROM branches WHERE org_id = :orgId AND is_active = 1 AND id <> :id', { orgId, id });
  if (!Number(others.n)) throw badRequest('ต้องมีสาขาที่เปิดใช้งานอย่างน้อย 1 สาขา จึงลบสาขานี้ได้');

  const wh = 'SELECT id FROM warehouses WHERE branch_id = :id';
  const usage = await db.one(
    `SELECT (SELECT COUNT(*) FROM sales_orders WHERE branch_id = :id) AS orders,
            (SELECT COUNT(*) FROM pos_shifts WHERE branch_id = :id) AS shifts,
            (SELECT COUNT(*) FROM transactions WHERE branch_id = :id) AS transactions,
            (SELECT COUNT(*) FROM stock_movements WHERE warehouse_id IN (${wh})) AS movements,
            (SELECT COUNT(*) FROM stock_levels WHERE warehouse_id IN (${wh}) AND quantity <> 0) AS stocked,
            (SELECT COUNT(*) FROM purchase_orders WHERE warehouse_id IN (${wh})) AS purchases,
            (SELECT COUNT(*) FROM stock_transfers WHERE from_warehouse_id IN (${wh}) OR to_warehouse_id IN (${wh})) AS transfers,
            (SELECT COUNT(*) FROM stock_counts WHERE warehouse_id IN (${wh})) AS counts,
            (SELECT COUNT(*) FROM welfare_requests WHERE warehouse_id IN (${wh})) AS welfare`,
    { id },
  );
  const LABEL = {
    orders: 'บิลขาย',
    shifts: 'กะขาย',
    transactions: 'รายการรับ-จ่าย',
    movements: 'ความเคลื่อนไหวสต๊อก',
    stocked: 'สินค้าคงเหลือในคลัง',
    purchases: 'ใบสั่งซื้อ',
    transfers: 'ใบโอนสินค้า',
    counts: 'รอบตรวจนับ',
    welfare: 'คำขอเบิกสวัสดิการ',
  };
  const used = Object.keys(LABEL).filter((k) => Number(usage[k]));
  if (used.length) {
    throw conflict(
      `ลบสาขา "${branch.name}" ไม่ได้ เพราะมี${used.map((k) => `${LABEL[k]} ${Number(usage[k]).toLocaleString('th-TH')} รายการ`).join(', ')} — ใช้ "ปิดใช้งาน" แทนเพื่อเก็บประวัติไว้`,
    );
  }

  await db.tx(async (conn) => {
    await conn.query('DELETE FROM held_bills WHERE branch_id = :id AND org_id = :orgId', { id, orgId });
    await conn.query('DELETE FROM warehouses WHERE branch_id = :id AND org_id = :orgId', { id, orgId }); // empty: only zero stock rows cascade
    await conn.query('DELETE FROM branches WHERE id = :id AND org_id = :orgId', { id, orgId }); // users of this branch get branch_id NULL
  });
  audit(req, 'branch.delete', 'branch', id, { name: branch.name });
  res.json({ data: { id } });
});

/* --------------------------------------------------------------------- VAT */

// Everyone signed in reads it: POS, product and document screens compute VAT with it
router.get('/tax', async (req, res) => {
  res.json({ data: await getTaxSettings(req.user.orgId) });
});

router.put(
  '/tax',
  requirePermission('settings:manage'),
  validate({
    body: z.object({
      vatRegistered: z.boolean().optional(),
      vatRate: z.coerce.number().min(0).max(30).optional(),
      defaultVatType: z.enum(VAT_TYPES).optional(),
    }),
  }),
  async (req, res) => {
    const data = await saveTaxSettings(req.user.orgId, req.valid.body);
    audit(req, 'org.tax_update', 'organization', req.user.orgId, req.valid.body);
    res.json({ data });
  },
);

/* ------------------------------------------------------- demo data reset */

const OWNER_ROLES = ['owner', 'admin'];
const onlyOwner = (req) => {
  if (!req.user.roles.some((r) => OWNER_ROLES.includes(r))) throw forbidden('เฉพาะเจ้าของกิจการหรือผู้ดูแลระบบเท่านั้น');
};

/** What a reset would remove, so the confirmation dialog can show real numbers. */
router.get('/data-summary', requirePermission('settings:manage'), async (req, res) => {
  onlyOwner(req);
  const orgId = req.user.orgId;
  const count = async (sql) => Number((await db.one(sql, { orgId, me: req.user.id })).n);
  res.json({
    data: {
      products: await count('SELECT COUNT(*) AS n FROM products WHERE org_id = :orgId'),
      salesOrders: await count('SELECT COUNT(*) AS n FROM sales_orders WHERE org_id = :orgId'),
      customers: await count('SELECT COUNT(*) AS n FROM customers WHERE org_id = :orgId'),
      documents: await count('SELECT COUNT(*) AS n FROM documents WHERE org_id = :orgId'),
      transactions: await count('SELECT COUNT(*) AS n FROM transactions WHERE org_id = :orgId'),
      conversations: await count('SELECT COUNT(*) AS n FROM conversations WHERE org_id = :orgId'),
      trends: await count('SELECT COUNT(*) AS n FROM trending_products WHERE org_id = :orgId'),
      videos: await count('SELECT COUNT(*) AS n FROM video_projects WHERE org_id = :orgId'),
      otherUsers: await count('SELECT COUNT(*) AS n FROM users WHERE org_id = :orgId AND id <> :me'),
      confirmPhrase: CONFIRM_PHRASE,
    },
  });
});

/** Delete all demo/business data of the org; only the caller's account survives. */
router.post(
  '/reset-data',
  requirePermission('settings:manage'),
  validate({ body: z.object({ confirm: z.string() }) }),
  async (req, res) => {
    onlyOwner(req);
    if (req.valid.body.confirm.trim() !== CONFIRM_PHRASE) throw badRequest(`พิมพ์ "${CONFIRM_PHRASE}" เพื่อยืนยัน`);
    const { deleted, skipped } = await resetOrgData({ orgId: req.user.orgId, keepUserId: req.user.id });
    // The audit log was cleared with the rest; this entry records who reset it and when
    audit(req, 'org.reset_data', 'organization', req.user.orgId, { tables: Object.keys(deleted).length, skipped });
    res.json({ data: { deleted, skipped } });
  },
);

module.exports = { router };
