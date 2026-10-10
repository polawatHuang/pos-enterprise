'use strict';

const { defineAdapter } = require('./define');

let client;

const adapter = defineAdapter(
  {
    id: 'anthropic',
    name: 'Anthropic Claude API',
    category: 'ai',
    usedBy: ['inbox', 'accounting', 'video', 'scraping'],
    phase: 4,
    purpose: 'AI แชตปิดการขาย, Return/Dispute, เขียนสคริปต์วิดีโอ, อ่านใบเสร็จ/สรุปบัญชี',
    applyUrl: 'https://console.anthropic.com/',
    env: [
      { name: 'ANTHROPIC_API_KEY' },
      { name: 'ANTHROPIC_MODEL', optional: true, default: 'claude-opus-5-5' },
    ],
  },
  {
    getClient() {
      if (!client) {
        const { ANTHROPIC_API_KEY } = adapter.requireConfig();
        const Anthropic = require('@anthropic-ai/sdk').default;
        client = new Anthropic({ apiKey: ANTHROPIC_API_KEY, maxRetries: 2, timeout: 60_000 });
      }
      return client;
    },

    /**
     * Thin wrapper over the Messages API. Callers pass system/messages/tools; model and
     * refusal fallback are applied here so every module behaves the same.
     * Server-side fallback ("default") re-runs a declined request on a suitable model
     * inside the same call instead of returning an empty refusal to the customer.
     */
    async createMessage(params) {
      const { ANTHROPIC_MODEL } = adapter.requireConfig();
      return adapter.getClient().beta.messages.create({
        model: ANTHROPIC_MODEL,
        max_tokens: 16000,
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        ...params,
      });
    },
  },
);

module.exports = adapter;
