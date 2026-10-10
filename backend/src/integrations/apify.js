'use strict';

const { defineAdapter } = require('./define');
const { AppError } = require('../core/errors');

const API = 'https://api.apify.com/v2';

const adapter = defineAdapter(
  {
    id: 'apify',
    name: 'Apify (scraping service)',
    category: 'commerce',
    usedBy: ['scraping'],
    phase: 5,
    purpose: 'ทางเลือกสำรองสำหรับดึงข้อมูลหน้าเว็บที่อนุญาตแต่ไม่มี API (รัน actor บนคลาวด์ของ Apify)',
    applyUrl: 'https://console.apify.com/account/integrations',
    env: [{ name: 'APIFY_TOKEN' }],
  },
  {
    async call(path, { method = 'GET', body } = {}) {
      const { APIFY_TOKEN } = adapter.requireConfig();
      const res = await fetch(`${API}${path}`, {
        method,
        headers: { Authorization: `Bearer ${APIFY_TOKEN}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(20_000),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        throw new AppError(502, 'APIFY_ERROR', `Apify ${res.status}: ${json?.error?.message ?? 'request failed'}`.slice(0, 300));
      }
      return json;
    },

    /** Start an actor run asynchronously (runs can take minutes; we poll from the job queue). */
    async runActor(actorId, input = {}) {
      // Actor ids are "user/name" in the console but "user~name" in API paths
      const id = encodeURIComponent(String(actorId).replace('/', '~'));
      const r = await adapter.call(`/acts/${id}/runs`, { method: 'POST', body: input });
      return { runId: r.data.id, datasetId: r.data.defaultDatasetId, status: r.data.status };
    },

    /** @returns {{status:string, datasetId:string}} status: READY | RUNNING | SUCCEEDED | FAILED | ABORTED | TIMED-OUT */
    async getRun(runId) {
      const r = await adapter.call(`/actor-runs/${encodeURIComponent(runId)}`);
      return { status: r.data.status, datasetId: r.data.defaultDatasetId };
    },

    async getDatasetItems(datasetId, { limit = 500 } = {}) {
      return adapter.call(`/datasets/${encodeURIComponent(datasetId)}/items?clean=true&format=json&limit=${limit}`);
    },
  },
);

module.exports = adapter;
