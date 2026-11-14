'use strict';

const express = require('express');
const fs = require('node:fs');
const { rateLimit, ipKeyGenerator } = require('express-rate-limit');
const { z } = require('zod');
const env = require('../../config/env');
const { validate } = require('../../core/http');
const { notFound } = require('../../core/errors');
const { authenticate, requirePermission } = require('../../core/auth');
const service = require('./ecommerce.service');

const router = express.Router();
const slugParam = z.object({ slug: z.string().regex(/^[a-z0-9][a-z0-9-]{0,119}$/) });
const tokenParam = z.object({ slug: z.string().regex(/^[a-z0-9][a-z0-9-]{0,119}$/), token: z.string().regex(/^[A-Za-z0-9_-]{43}$/) });
const cart = z.array(z.object({ productId: z.coerce.number().int().positive(), quantity: z.coerce.number().int().min(1).max(99) })).min(1).max(30);
const imageType = z.enum(['image/jpeg', 'image/png', 'image/webp']);

const limiter = (windowMs, limit, message) => rateLimit({
  windowMs,
  limit: env.isTest ? 1000 : limit,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  keyGenerator: (req) => ipKeyGenerator(req.ip ?? ''),
  message: { error: { code: 'RATE_LIMITED', message } },
});
const orderLimiter = limiter(60 * 60 * 1000, 12, 'สร้างคำสั่งซื้อบ่อยเกินไป กรุณาลองใหม่ภายหลัง');
const slipLimiter = limiter(15 * 60 * 1000, 10, 'ตรวจสอบสลิปบ่อยเกินไป กรุณารอสักครู่แล้วลองใหม่');
const lineLoginLimiter = limiter(15 * 60 * 1000, 15, 'เริ่มเข้าสู่ระบบบ่อยเกินไป กรุณารอสักครู่');
const customerToken = (req) => req.cookies?.pe_ec ?? null;

router.post('/public/auth/line/complete', validate({
  body: z.object({ code: z.string().min(1).max(2048), state: z.string().min(32).max(128) }),
}), async (req, res) => {
  const result = await service.completeLineLogin({
    ...req.valid.body,
    proxySecret: req.get('x-ecommerce-auth-proxy'),
  });
  res.json({ data: result });
});

router.get('/public/auth/line/start', lineLoginLimiter, validate({
  query: z.object({ slug: z.string().regex(/^[a-z0-9][a-z0-9-]{0,119}$/) }),
}), async (req, res) => {
  res.json({ data: await service.beginLineLogin(req.valid.query.slug) });
});

router.get('/public/stores', async (_req, res) => {
  res.json({ data: await service.publicStoreIndex() });
});

router.get('/public/stores/:slug', validate({ params: slugParam }), async (req, res) => {
  res.json({ data: await service.publicStore(req.valid.params.slug) });
});

router.get('/public/products/:productId/image', validate({
  params: z.object({ productId: z.coerce.number().int().positive() }),
}), async (req, res) => {
  const image = await service.publicProductImage(req.valid.params.productId);
  if (!fs.existsSync(image.file)) throw notFound('ไม่พบรูปสินค้า');
  res.set({ 'Cache-Control': 'public, no-cache', 'X-Content-Type-Options': 'nosniff' }).type(image.mime).sendFile(image.file);
});

router.post(
  '/public/stores/:slug/quote',
  validate({
    params: slugParam,
    body: z.object({ items: cart, code: z.string().trim().max(50).optional().default('') }),
  }),
  async (req, res) => {
    res.json({ data: await service.quote(req.valid.params.slug, req.valid.body) });
  },
);

router.post(
  '/public/stores/:slug/orders',
  orderLimiter,
  validate({
    params: slugParam,
    body: z.object({
      items: cart,
      discountCode: z.string().trim().max(50).optional(),
      customerName: z.string().trim().min(2).max(191),
      phone: z.string().trim().min(8).max(50),
      email: z.email().trim().max(191).optional().or(z.literal('')),
      address: z.string().trim().min(5).max(1500),
      postalCode: z.string().trim().min(3).max(12),
      note: z.string().trim().max(500).optional(),
      saveAddress: z.boolean().optional().default(false),
    }),
  }),
  async (req, res) => {
    const identity = await service.customerIdentityFromToken(customerToken(req));
    res.status(201).json({ data: await service.createOrder(req.valid.params.slug, req.valid.body, identity?.id ?? null) });
  },
);

router.get('/public/stores/:slug/products/:productId/reviews', validate({
  params: z.object({ slug: z.string().regex(/^[a-z0-9][a-z0-9-]{0,119}$/), productId: z.coerce.number().int().positive() }),
}), async (req, res) => {
  res.json({ data: await service.productReviews(req.valid.params.slug, req.valid.params.productId) });
});

router.get('/public/stores/:slug/products/:productId/reviewable', validate({
  params: z.object({ slug: z.string().regex(/^[a-z0-9][a-z0-9-]{0,119}$/), productId: z.coerce.number().int().positive() }),
}), async (req, res) => {
  res.json({ data: await service.reviewableItems(req.valid.params.slug, req.valid.params.productId, customerToken(req)) });
});

router.post('/public/stores/:slug/products/:productId/reviews', validate({
  params: z.object({ slug: z.string().regex(/^[a-z0-9][a-z0-9-]{0,119}$/), productId: z.coerce.number().int().positive() }),
  body: z.object({
    orderItemId: z.coerce.number().int().positive(),
    rating: z.coerce.number().int().min(1).max(5),
    text: z.string().trim().max(2000).optional().default(''),
  }),
}), async (req, res) => {
  res.status(201).json({
    data: await service.createProductReview(req.valid.params.slug, req.valid.params.productId, customerToken(req), req.valid.body),
  });
});

router.get('/public/stores/:slug/customer/account', validate({ params: slugParam }), async (req, res) => {
  res.json({ data: await service.customerAccount(req.valid.params.slug, customerToken(req)) });
});

router.delete('/public/stores/:slug/customer/addresses/:id', validate({
  params: z.object({ slug: slugParam.shape.slug, id: z.coerce.number().int().positive() }),
}), async (req, res) => {
  await service.deleteCustomerAddress(req.valid.params.slug, customerToken(req), req.valid.params.id);
  res.json({ data: { ok: true } });
});

router.post('/public/stores/:slug/customer/logout', validate({ params: slugParam }), async (req, res) => {
  await service.logoutCustomer(customerToken(req));
  res.clearCookie('pe_ec', {
    httpOnly: true,
    secure: env.COOKIE_SECURE,
    sameSite: env.COOKIE_SAMESITE,
    domain: env.COOKIE_DOMAIN || undefined,
    path: '/',
  });
  res.json({ data: { ok: true } });
});

router.get('/public/stores/:slug/orders/:token', validate({ params: tokenParam }), async (req, res) => {
  res.json({ data: await service.tracking(req.valid.params.slug, req.valid.params.token) });
});

router.post(
  '/public/stores/:slug/orders/:token/verify-slip',
  slipLimiter,
  validate({
    params: tokenParam,
    body: z.object({
      mimeType: imageType,
      imageBase64: z.string().min(1).max(7_000_000).regex(/^[A-Za-z0-9+/]+={0,2}$/, 'รูปสลิปไม่ถูกต้อง'),
    }),
  }),
  async (req, res) => {
    res.json({ data: await service.verifySlip(req.valid.params.slug, req.valid.params.token, req.valid.body) });
  },
);

router.use(authenticate, requirePermission('pos:manage'));

router.get('/admin/store', async (req, res) => {
  res.json({ data: await service.adminStore(req.user.orgId) });
});

router.patch(
  '/admin/store',
  validate({
    body: z.object({
      enabled: z.boolean().optional(),
      warehouseId: z.coerce.number().int().positive().nullable().optional(),
      storeName: z.string().trim().min(2).max(191).optional(),
    }).refine((body) => body.enabled !== undefined || body.warehouseId !== undefined || body.storeName !== undefined, 'ไม่มีข้อมูลที่ต้องบันทึก'),
  }),
  async (req, res) => {
    res.json({ data: await service.updateAdminStore(req.user.orgId, req.valid.body) });
  },
);

router.get(
  '/admin/orders',
  validate({
    query: z.object({
      status: z.enum(['all', 'pending', 'paid', 'packed', 'shipped', 'completed', 'cancelled']).default('all'),
      q: z.string().trim().max(100).default(''),
    }),
  }),
  async (req, res) => {
    res.json({ data: await service.adminOrders(req.user.orgId, req.valid.query) });
  },
);

router.get('/admin/orders/:id', validate({ params: z.object({ id: z.coerce.number().int().positive() }) }), async (req, res) => {
  res.json({ data: await service.adminOrder(req.user.orgId, req.valid.params.id) });
});

router.get(
  '/admin/orders/:id/files/:kind',
  validate({ params: z.object({ id: z.coerce.number().int().positive(), kind: z.enum(['slip', 'shipment']) }) }),
  async (req, res) => {
    const file = await service.readAdminFile(req.user.orgId, req.valid.params.id, req.valid.params.kind);
    res.set('Cache-Control', 'private, no-store');
    res.set('X-Content-Type-Options', 'nosniff');
    res.type(file.mime).sendFile(file.file);
  },
);

router.patch(
  '/admin/orders/:id/status',
  validate({
    params: z.object({ id: z.coerce.number().int().positive() }),
    body: z.discriminatedUnion('status', [
      z.object({ status: z.literal('packed') }),
      z.object({
        status: z.literal('shipped'),
        mimeType: imageType,
        evidence: z.string().min(1).max(7_000_000).regex(/^[A-Za-z0-9+/]+={0,2}$/, 'รูปหลักฐานไม่ถูกต้อง'),
        note: z.string().trim().max(255).optional(),
      }),
    ]),
  }),
  async (req, res) => {
    const order = await service.updateOrderStatus(req.user.orgId, req.user.id, req.valid.params.id, req.valid.body);
    res.json({ data: order });
  },
);

module.exports = { router };
