'use strict';

const express = require('express');
const { z } = require('zod');
const db = require('../../db/pool');
const { validate } = require('../../core/http');
const { authenticate, requirePermission } = require('../../core/auth');
const { audit } = require('../../core/audit');
const { notFound, conflict } = require('../../core/errors');

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
  imageUrl: z.url().max(1000).nullable().optional(),
  status: z.enum(['active', 'draft', 'archived']).default('active'),
});

const SELECT_PRODUCT = `
  SELECT p.id, p.sku, p.barcode, p.name, p.category_id, c.name AS category_name, p.description, p.selling_points,
         p.unit, p.price, p.cost, p.vat_type, p.reorder_point, p.image_url, p.status, p.created_at, p.updated_at,
         COALESCE((SELECT SUM(sl.quantity) FROM stock_levels sl WHERE sl.product_id = p.id), 0) AS on_hand
    FROM products p
    LEFT JOIN product_categories c ON c.id = p.category_id`;

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
}

/* ------------------------------------------------------------------ categories */

router.get('/categories', requirePermission('products:read'), async (req, res) => {
  const rows = await db.query(
    `SELECT c.id, c.name, c.parent_id AS parentId, c.sort_order AS sortOrder,
            (SELECT COUNT(*) FROM products p WHERE p.category_id = c.id AND p.status <> 'archived') AS productCount
       FROM product_categories c WHERE c.org_id = :orgId ORDER BY c.sort_order, c.name`,
    { orgId: req.user.orgId },
  );
  res.json({ data: rows.map((r) => ({ ...r, productCount: Number(r.productCount) })) });
});

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
    `INSERT INTO products (org_id, category_id, sku, barcode, name, description, selling_points, unit, price, cost, vat_type, reorder_point, image_url, status)
     VALUES (:orgId, :categoryId, :sku, :barcode, :name, :description, :sellingPoints, :unit, :price, :cost, :vatType, :reorderPoint, :imageUrl, :status)`,
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
    const merged = { ...existing, ...req.valid.body };
    await assertUnique(req.user.orgId, merged, id);
    await db.query(
      `UPDATE products SET category_id = :categoryId, sku = :sku, barcode = :barcode, name = :name, description = :description,
              selling_points = :sellingPoints, unit = :unit, price = :price, cost = :cost, vat_type = :vatType,
              reorder_point = :reorderPoint, image_url = :imageUrl, status = :status
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
        imageUrl: merged.imageUrl ?? null,
        status: merged.status,
      },
    );
    audit(req, 'product.update', 'product', id, { fields: Object.keys(req.valid.body) });
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

module.exports = { router, getProduct };
