'use strict';

const express = require('express');
const { z } = require('zod');
const db = require('../../db/pool');
const { validate } = require('../../core/http');
const { authenticate, requirePermission } = require('../../core/auth');
const { audit } = require('../../core/audit');
const { badRequest, notFound, conflict } = require('../../core/errors');

const router = express.Router();
router.use(authenticate);

const idParam = z.object({ id: z.coerce.number().int().positive() });
const money = z.coerce.number().min(0).max(99_999_999);

const productBody = z.object({
  sku: z.string().trim().min(1).max(64),
  barcode: z.string().trim().max(64).nullable().optional(),
  name: z.string().trim().min(1).max(255),
  categoryId: z.number().int().positive().nullable().optional(),
  description: z.string().max(5000).nullable().optional(),
  sellingPoints: z.string().max(5000).nullable().optional(),
  unit: z.string().trim().min(1).max(30).default('ชิ้น'),
  price: money,
  cost: money.default(0),
  vatType: z.enum(['vat7', 'exempt', 'zero']).default('vat7'),
  reorderPoint: z.coerce.number().int().min(0).max(1_000_000).default(0),
  supplierId: z.number().int().positive().nullable().optional(),
  packSize: z.coerce.number().positive().max(100_000).default(1),
  trackExpiry: z.boolean().default(false),
  shelfLifeDays: z.coerce.number().int().min(0).max(3650).nullable().optional(),
  imageUrl: z.url().max(1000).nullable().optional(),
  status: z.enum(['active', 'draft', 'archived']).default('active'),
});

const SELECT_PRODUCT = `
  SELECT p.id, p.sku, p.barcode, p.name, p.category_id, c.name AS category_name, p.description, p.selling_points,
         p.unit, p.price, p.cost, p.vat_type, p.reorder_point, p.supplier_id, p.pack_size, p.track_expiry, p.shelf_life_days, s.name AS supplier_name,
         p.image_url, p.status, p.created_at, p.updated_at,
         COALESCE((SELECT SUM(sl.quantity) FROM stock_levels sl WHERE sl.product_id = p.id), 0) AS on_hand
    FROM products p
    LEFT JOIN product_categories c ON c.id = p.category_id
    LEFT JOIN suppliers s ON s.id = p.supplier_id`;

function mapProduct(r) {
  return {
    id: r.id,
    sku: r.sku,
    barcode: r.barcode,
    name: r.name,
    categoryId: r.category_id,
    categoryName: r.category_name,
    description: r.description,
    sellingPoints: r.selling_points,
    unit: r.unit,
    price: Number(r.price),
    cost: Number(r.cost),
    vatType: r.vat_type,
    reorderPoint: Number(r.reorder_point),
    supplierId: r.supplier_id,
    supplierName: r.supplier_name ?? null,
    packSize: Number(r.pack_size ?? 1),
    trackExpiry: Boolean(r.track_expiry),
    shelfLifeDays: r.shelf_life_days == null ? null : Number(r.shelf_life_days),
    imageUrl: r.image_url,
    status: r.status,
    onHand: Number(r.on_hand),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

async function getProduct(orgId, id) {
  const row = await db.one(`${SELECT_PRODUCT} WHERE p.org_id = :orgId AND p.id = :id`, { orgId, id });
  return row ? mapProduct(row) : null;
}

async function assertUnique(orgId, { sku, barcode }, exceptId = 0) {
  const dup = await db.one(
    `SELECT sku, barcode FROM products
      WHERE org_id = :orgId AND id <> :exceptId AND (sku = :sku OR (:barcode IS NOT NULL AND barcode = :barcode)) LIMIT 1`,
    { orgId, exceptId, sku, barcode: barcode || null },
  );
  if (dup) throw conflict(dup.sku === sku ? `SKU "${sku}" ถูกใช้แล้ว` : `บาร์โค้ด "${barcode}" ถูกใช้แล้ว`);
  if (barcode) {
    const unit = await db.one('SELECT id FROM product_units WHERE org_id = :orgId AND barcode = :barcode', { orgId, barcode });
    if (unit) throw conflict(`บาร์โค้ด "${barcode}" ถูกใช้เป็นบาร์โค้ดแพ็ก/ลังแล้ว`);
  }
}

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'เวลาต้องเป็น HH:MM');
const parseJson = (v) => {
  if (typeof v !== 'string') return v ?? null;
  try {
    return JSON.parse(v);
  } catch {
    return null;
  }
};

/* ------------------------------------------------------------------ categories */

router.get('/categories', requirePermission('products:read'), async (req, res) => {
  const rows = await db.query(
    `SELECT c.id, c.name, c.parent_id AS parentId, c.sort_order AS sortOrder, c.age_restricted, c.sale_block,
            (SELECT COUNT(*) FROM products p WHERE p.category_id = c.id AND p.status <> 'archived') AS productCount
       FROM product_categories c WHERE c.org_id = :orgId ORDER BY c.sort_order, c.name`,
    { orgId: req.user.orgId },
  );
  res.json({
    data: rows.map(({ age_restricted: age, sale_block: block, ...r }) => ({
      ...r,
      productCount: Number(r.productCount),
      ageRestricted: Boolean(age),
      saleBlock: parseJson(block),
    })),
  });
});

/** Category rules applied at the till: no-sale hours (e.g. alcohol) and the age-20+ check. */
router.patch(
  '/categories/:id',
  requirePermission('products:write'),
  validate({
    params: idParam,
    body: z.object({
      name: z.string().trim().min(1).max(191).optional(),
      ageRestricted: z.boolean().optional(),
      saleBlock: z.object({ from: hhmm, to: hhmm, label: z.string().trim().max(80).optional() }).nullable().optional(),
    }),
  }),
  async (req, res) => {
    const b = req.valid.body;
    const r = await db.query(
      `UPDATE product_categories SET name = COALESCE(:name, name),
              age_restricted = COALESCE(:age, age_restricted),
              sale_block = CASE WHEN :setBlock = 1 THEN :block ELSE sale_block END
        WHERE id = :id AND org_id = :orgId`,
      {
        id: req.valid.params.id,
        orgId: req.user.orgId,
        name: b.name ?? null,
        age: b.ageRestricted === undefined ? null : Number(b.ageRestricted),
        setBlock: b.saleBlock === undefined ? 0 : 1,
        block: b.saleBlock ? JSON.stringify(b.saleBlock) : null,
      },
    );
    if (!r.affectedRows) throw notFound('ไม่พบหมวดสินค้า');
    audit(req, 'category.update', 'category', req.valid.params.id, { fields: Object.keys(b) });
    res.json({ data: { ok: true } });
  },
);

router.post(
  '/categories',
  requirePermission('products:write'),
  validate({ body: z.object({ name: z.string().trim().min(1).max(191) }) }),
  async (req, res) => {
    const r = await db.query(
      `INSERT INTO product_categories (org_id, name, sort_order)
       SELECT :orgId, :name, COALESCE(MAX(sort_order), 0) + 1 FROM product_categories WHERE org_id = :orgId`,
      { orgId: req.user.orgId, name: req.valid.body.name },
    );
    audit(req, 'category.create', 'category', r.insertId);
    res.status(201).json({ data: { id: r.insertId, name: req.valid.body.name } });
  },
);

/* -------------------------------------------------------------------- products */

router.get(
  '/',
  requirePermission('products:read'),
  validate({
    query: z.object({
      q: z.string().trim().max(100).optional(),
      categoryId: z.coerce.number().int().positive().optional(),
      status: z.enum(['active', 'draft', 'archived', 'all']).default('all'),
      lowStock: z.enum(['true', 'false']).optional(),
      sort: z.enum(['name', 'sku', 'price', 'on_hand', 'updated_at']).default('name'),
      page: z.coerce.number().int().min(1).default(1),
      pageSize: z.coerce.number().int().min(1).max(200).default(25),
    }),
  }),
  async (req, res) => {
    const f = req.valid.query;
    const params = {
      orgId: req.user.orgId,
      q: f.q ? `%${f.q}%` : null,
      categoryId: f.categoryId ?? null,
      status: f.status,
      limit: f.pageSize,
      offset: (f.page - 1) * f.pageSize,
    };
    const where = `p.org_id = :orgId
      AND (:q IS NULL OR p.name LIKE :q OR p.sku LIKE :q OR p.barcode LIKE :q)
      AND (:categoryId IS NULL OR p.category_id = :categoryId)
      AND (:status = 'all' AND p.status <> 'archived' OR p.status = :status)`;
    const lowFilter = f.lowStock === 'true' ? 'WHERE x.on_hand <= x.reorder_point' : '';
    // sort column comes from a zod enum, so interpolation is safe
    const orderBy = f.sort === 'updated_at' ? 'updated_at DESC' : `${f.sort} ASC`;
    const rows = await db.query(`SELECT * FROM (${SELECT_PRODUCT} WHERE ${where}) x ${lowFilter} ORDER BY ${orderBy}, id LIMIT :limit OFFSET :offset`, params);
    const total = await db.one(`SELECT COUNT(*) AS n FROM (${SELECT_PRODUCT} WHERE ${where}) x ${lowFilter}`, params);
    res.json({ data: rows.map(mapProduct), meta: { page: f.page, pageSize: f.pageSize, total: Number(total.n) } });
  },
);

router.get('/:id', requirePermission('products:read'), validate({ params: idParam }), async (req, res) => {
  const product = await getProduct(req.user.orgId, req.valid.params.id);
  if (!product) throw notFound('ไม่พบสินค้า');
  const stock = await db.query(
    `SELECT w.id AS warehouseId, w.code, w.name, COALESCE(sl.quantity, 0) AS quantity
       FROM warehouses w
       LEFT JOIN stock_levels sl ON sl.warehouse_id = w.id AND sl.product_id = :id AND sl.variant_id = 0
      WHERE w.org_id = :orgId ORDER BY w.id`,
    { orgId: req.user.orgId, id: product.id },
  );
  res.json({ data: { ...product, stock: stock.map((s) => ({ ...s, quantity: Number(s.quantity) })) } });
});

router.post('/', requirePermission('products:write'), validate({ body: productBody }), async (req, res) => {
  const b = req.valid.body;
  await assertUnique(req.user.orgId, b);
  const r = await db.query(
    `INSERT INTO products (org_id, category_id, supplier_id, sku, barcode, name, description, selling_points, unit, price, cost, vat_type, reorder_point,
                           pack_size, track_expiry, shelf_life_days, image_url, status)
     VALUES (:orgId, :categoryId, :supplierId, :sku, :barcode, :name, :description, :sellingPoints, :unit, :price, :cost, :vatType, :reorderPoint,
             :packSize, :trackExpiry, :shelfLifeDays, :imageUrl, :status)`,
    {
      orgId: req.user.orgId,
      categoryId: b.categoryId ?? null,
      sku: b.sku,
      barcode: b.barcode || null,
      name: b.name,
      description: b.description ?? null,
      sellingPoints: b.sellingPoints ?? null,
      unit: b.unit,
      price: b.price,
      cost: b.cost,
      vatType: b.vatType,
      reorderPoint: b.reorderPoint,
      supplierId: b.supplierId ?? null,
      packSize: b.packSize,
      trackExpiry: b.trackExpiry ? 1 : 0,
      shelfLifeDays: b.shelfLifeDays ?? null,
      imageUrl: b.imageUrl ?? null,
      status: b.status,
    },
  );
  audit(req, 'product.create', 'product', r.insertId, { sku: b.sku });
  res.status(201).json({ data: await getProduct(req.user.orgId, r.insertId) });
});

router.patch(
  '/:id',
  requirePermission('products:write'),
  validate({ params: idParam, body: productBody.partial() }),
  async (req, res) => {
    const { id } = req.valid.params;
    const existing = await getProduct(req.user.orgId, id);
    if (!existing) throw notFound('ไม่พบสินค้า');
    // .partial() still fills schema defaults (unit, cost, status...): only apply fields the client sent
    const sent = Object.fromEntries(Object.entries(req.valid.body).filter(([k]) => Object.hasOwn(req.body ?? {}, k)));
    const merged = { ...existing, ...sent };
    await assertUnique(req.user.orgId, merged, id);
    await db.query(
      `UPDATE products SET category_id = :categoryId, sku = :sku, barcode = :barcode, name = :name, description = :description,
              selling_points = :sellingPoints, unit = :unit, price = :price, cost = :cost, vat_type = :vatType,
              reorder_point = :reorderPoint, supplier_id = :supplierId, pack_size = :packSize,
              track_expiry = :trackExpiry, shelf_life_days = :shelfLifeDays, image_url = :imageUrl, status = :status
        WHERE id = :id AND org_id = :orgId`,
      {
        id,
        orgId: req.user.orgId,
        categoryId: merged.categoryId ?? null,
        sku: merged.sku,
        barcode: merged.barcode || null,
        name: merged.name,
        description: merged.description ?? null,
        sellingPoints: merged.sellingPoints ?? null,
        unit: merged.unit,
        price: merged.price,
        cost: merged.cost,
        vatType: merged.vatType,
        reorderPoint: merged.reorderPoint,
        supplierId: merged.supplierId ?? null,
        packSize: merged.packSize ?? 1,
        trackExpiry: merged.trackExpiry ? 1 : 0,
        shelfLifeDays: merged.shelfLifeDays ?? null,
        imageUrl: merged.imageUrl ?? null,
        status: merged.status,
      },
    );
    audit(req, 'product.update', 'product', id, { fields: Object.keys(sent) });
    res.json({ data: await getProduct(req.user.orgId, id) });
  },
);

/* ------------------------------------------------- AI knowledge base per product */

router.get('/:id/knowledge', requirePermission('products:read'), validate({ params: idParam }), async (req, res) => {
  const rows = await db.query(
    `SELECT id, kind, question, answer, created_at AS createdAt FROM product_knowledge
      WHERE org_id = :orgId AND product_id = :id ORDER BY id`,
    { orgId: req.user.orgId, id: req.valid.params.id },
  );
  res.json({ data: rows });
});

router.post(
  '/:id/knowledge',
  requirePermission('products:write'),
  validate({
    params: idParam,
    body: z.object({
      kind: z.enum(['faq', 'policy', 'objection', 'usage', 'other']).default('faq'),
      question: z.string().trim().max(500).nullable().optional(),
      answer: z.string().trim().min(1).max(5000),
    }),
  }),
  async (req, res) => {
    const { id } = req.valid.params;
    if (!(await getProduct(req.user.orgId, id))) throw notFound('ไม่พบสินค้า');
    const b = req.valid.body;
    const r = await db.query(
      `INSERT INTO product_knowledge (org_id, product_id, kind, question, answer) VALUES (:orgId, :id, :kind, :question, :answer)`,
      { orgId: req.user.orgId, id, kind: b.kind, question: b.question ?? null, answer: b.answer },
    );
    res.status(201).json({ data: { id: r.insertId, ...b } });
  },
);

router.delete(
  '/:id/knowledge/:kid',
  requirePermission('products:write'),
  validate({ params: idParam.extend({ kid: z.coerce.number().int().positive() }) }),
  async (req, res) => {
    const r = await db.query('DELETE FROM product_knowledge WHERE id = :kid AND product_id = :id AND org_id = :orgId', {
      ...req.valid.params,
      orgId: req.user.orgId,
    });
    if (!r.affectedRows) throw notFound();
    res.json({ data: { ok: true } });
  },
);

/* ---------------------------------------------------------- pack / carton units */

const mapUnit = (u) => ({ id: u.id, name: u.name, factor: Number(u.factor), barcode: u.barcode, price: u.price == null ? null : Number(u.price) });

router.get('/:id/units', requirePermission('products:read'), validate({ params: idParam }), async (req, res) => {
  if (!(await getProduct(req.user.orgId, req.valid.params.id))) throw notFound('ไม่พบสินค้า');
  const rows = await db.query('SELECT * FROM product_units WHERE product_id = :id ORDER BY factor', { id: req.valid.params.id });
  res.json({ data: rows.map(mapUnit) });
});

/** Replace the product's selling units (e.g. แพ็ก 6 = 6 ชิ้น, ลัง 24) in one save. */
router.put(
  '/:id/units',
  requirePermission('products:write'),
  validate({
    params: idParam,
    body: z.object({
      units: z
        .array(
          z.object({
            name: z.string().trim().min(1).max(30),
            factor: z.coerce.number().gt(1, 'ต้องมากกว่า 1 หน่วยฐาน').max(100_000),
            barcode: z.string().trim().max(64).nullable().optional(),
            price: z.coerce.number().min(0).max(99_999_999).nullable().optional(),
          }),
        )
        .max(10),
    }),
  }),
  async (req, res) => {
    const productId = req.valid.params.id;
    const orgId = req.user.orgId;
    if (!(await getProduct(orgId, productId))) throw notFound('ไม่พบสินค้า');
    const { units } = req.valid.body;
    const codes = units.map((u) => u.barcode).filter(Boolean);
    if (new Set(codes).size !== codes.length) throw badRequest('บาร์โค้ดของหน่วยซ้ำกัน');
    if (codes.length) {
      const clash = await db.one(
        `SELECT barcode FROM products WHERE org_id = :orgId AND barcode IN (:codes)
         UNION SELECT barcode FROM product_units WHERE org_id = :orgId AND product_id <> :productId AND barcode IN (:codes) LIMIT 1`,
        { orgId, productId, codes },
      );
      if (clash) throw conflict(`บาร์โค้ด "${clash.barcode}" ถูกใช้แล้ว`);
    }
    await db.tx(async (conn) => {
      await conn.query('DELETE FROM product_units WHERE product_id = :productId', { productId });
      for (const u of units) {
        await conn.query(
          'INSERT INTO product_units (org_id, product_id, name, factor, barcode, price) VALUES (:orgId, :productId, :name, :factor, :barcode, :price)',
          { orgId, productId, name: u.name, factor: u.factor, barcode: u.barcode || null, price: u.price ?? null },
        );
      }
    });
    audit(req, 'product.units', 'product', productId, { count: units.length });
    const rows = await db.query('SELECT * FROM product_units WHERE product_id = :productId ORDER BY factor', { productId });
    res.json({ data: rows.map(mapUnit) });
  },
);

module.exports = { router, getProduct };
