'use strict';

const { AsyncLocalStorage } = require('node:async_hooks');

const context = new AsyncLocalStorage();

function runWithOrg(value, fn) {
  const resolved = typeof value === 'number' ? { orgId: value } : value;
  return context.run(resolved, fn);
}

function current() {
  return context.getStore() ?? null;
}

module.exports = { runWithOrg, current };
