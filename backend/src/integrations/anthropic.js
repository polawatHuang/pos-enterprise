'use strict';

const { defineAdapter } = require('./define');

let client;
let clientKey;

/** Claude — optional alternative provider (set AI_PROVIDER=anthropic). */
const adapter = defineAdapter(
  {
    id: 'anthropic',
    name: 'Anthropic Claude API (ทางเลือก)',
    category: 'ai',
    usedBy: ['inbox', 'accounting', 'video'],
    phase: 3,
    purpose: 'ผู้ให้บริการ AI สำรอง ใช้เมื่อตั้ง AI_PROVIDER=anthropic',
    applyUrl: 'https://console.anthropic.com/',
    env: [
      { name: 'ANTHROPIC_API_KEY' },
      { name: 'ANTHROPIC_MODEL', optional: true, default: 'claude-opus-5-5' },
    ],
  },
  {
    capabilities: { images: true, pdf: true, structuredOutput: true },

    getClient() {
      const { ANTHROPIC_API_KEY } = adapter.requireConfig();
      if (!client || clientKey !== ANTHROPIC_API_KEY) {
        const Anthropic = require('@anthropic-ai/sdk').default;
        client = new Anthropic({ apiKey: ANTHROPIC_API_KEY, maxRetries: 2, timeout: 60_000 });
        clientKey = ANTHROPIC_API_KEY;
      }
      return client;
    },

    /**
     * Server-side fallback ("default") re-runs a declined request on a suitable model inside the
     * same call. The stable system prompt is cached; chat-style work runs at low effort.
     */
    async createMessage({ system, messages, tools, maxTokens = 4000, effort, outputFormat }) {
      const { ANTHROPIC_MODEL } = adapter.requireConfig();
      return adapter.getClient().beta.messages.create({
        model: ANTHROPIC_MODEL,
        max_tokens: maxTokens,
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        ...(system ? { system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }] } : {}),
        messages,
        ...(tools?.length ? { tools } : {}),
        ...(effort || outputFormat ? { output_config: { ...(effort ? { effort } : {}), ...(outputFormat ? { format: outputFormat } : {}) } } : {}),
      });
    },
  },
);

module.exports = adapter;
