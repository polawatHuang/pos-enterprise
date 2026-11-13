'use strict';

process.env.NODE_ENV = 'test';
process.env.DB_USER = process.env.DB_USER || 'test';
process.env.DB_NAME = process.env.DB_NAME || 'test';
process.env.JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET || 'test-secret-that-is-long-enough-for-jwt';
process.env.CRON_SECRET = process.env.CRON_SECRET || 'test-cron-secret-long-enough';

const { test, after } = require('node:test');
const assert = require('node:assert/strict');

const poolPath = require.resolve('../src/db/pool');
const savedPool = require.cache[poolPath];
let captured;
let result;
require.cache[poolPath] = {
  id: poolPath,
  filename: poolPath,
  loaded: true,
  exports: {
    one: async (sql, params) => {
      captured = { sql, params };
      return result;
    },
  },
};

const dashboard = require('../src/modules/dashboard/dashboard.repo');

after(() => {
  if (savedPool) require.cache[poolPath] = savedPool;
  else delete require.cache[poolPath];
});

test('activation returns org-scoped setup counts and time to first sale', async () => {
  result = {
    active_branches: 2,
    active_products: 35,
    active_staff: 4,
    sales_orders: 120,
    first_sale_at: new Date('2026-11-04T00:00:00Z'),
    org_created_at: new Date('2026-11-01T00:00:00Z'),
  };

  const activation = await dashboard.activation({ orgId: 7 });

  assert.deepEqual(activation, {
    activeBranches: 2,
    activeProducts: 35,
    activeStaff: 4,
    salesOrders: 120,
    firstSaleAt: result.first_sale_at,
    daysToFirstSale: 3,
  });
  assert.deepEqual(captured.params, { orgId: 7 });
  assert.match(captured.sql, /b\.org_id = :orgId/);
  assert.match(captured.sql, /p\.org_id = :orgId/);
  assert.match(captured.sql, /u\.org_id = :orgId/);
  assert.match(captured.sql, /so\.org_id = :orgId/);
});

test('activation returns null time to first sale when there are no sales', async () => {
  result = {
    active_branches: 1,
    active_products: 0,
    active_staff: 1,
    sales_orders: 0,
    first_sale_at: null,
    org_created_at: new Date('2026-11-01T00:00:00Z'),
  };

  const activation = await dashboard.activation({ orgId: 9 });
  assert.equal(activation.salesOrders, 0);
  assert.equal(activation.firstSaleAt, null);
  assert.equal(activation.daysToFirstSale, null);
});
