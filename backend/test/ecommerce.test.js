'use strict';

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const db = require('../src/db/pool');
const { validImageSignature, normalizeItems, SHIPPING_FEE, ORDER_TTL_MINUTES } = require('../src/modules/ecommerce/ecommerce.service');
const { applyMovement } = require('../src/modules/inventory/inventory.service');

after(async () => {
  await db.pool.end();
});

test('e-commerce cart items are grouped and quantity limits apply to the total per product', () => {
  assert.deepEqual(normalizeItems([
    { productId: 7, quantity: 2 },
    { productId: 4, quantity: 1 },
    { productId: 7, quantity: 3 },
  ]), [
    { productId: 7, quantity: 5 },
    { productId: 4, quantity: 1 },
  ]);
  assert.throws(() => normalizeItems([
    { productId: 7, quantity: 60 },
    { productId: 7, quantity: 40 },
  ]), /ไม่เกิน 99/);
});

test('e-commerce image uploads require a matching JPEG, PNG, or WebP signature', () => {
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0x00]);
  const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const webp = Buffer.from('RIFF0000WEBP');
  assert.equal(validImageSignature(jpeg, 'image/jpeg'), true);
  assert.equal(validImageSignature(png, 'image/png'), true);
  assert.equal(validImageSignature(webp, 'image/webp'), true);
  assert.equal(validImageSignature(png, 'image/jpeg'), false);
  assert.equal(validImageSignature(Buffer.from('not an image'), 'image/png'), false);
});

test('e-commerce shipping and payment reservation use the specified amounts and duration', () => {
  assert.equal(SHIPPING_FEE, 60);
  assert.equal(ORDER_TTL_MINUTES, 30);
});

test('stock movements cannot consume units reserved for online orders', async () => {
  const statements = [];
  const conn = {
    async query(sql) {
      statements.push(sql);
      if (sql.includes('SELECT quantity, reserved')) return [[{ quantity: 5, reserved: 4 }], []];
      if (sql.includes('SELECT name FROM products')) return [[{ name: 'reserved item' }], []];
      return [{ affectedRows: 1 }, []];
    },
  };
  await assert.rejects(
    applyMovement(conn, { orgId: 1, warehouseId: 2, productId: 3, quantity: -2, type: 'sale' }),
    (error) => error.status === 409,
  );
  assert.equal(statements.some((sql) => sql.includes('UPDATE stock_levels SET quantity')), false);
  assert.equal(statements.some((sql) => sql.includes('INSERT INTO stock_movements')), false);
});
