'use strict';

const { defineAdapter } = require('./define');

let client;
let clientKey;

/**
 * MiniMax via its Anthropic-compatible endpoint (https://api.minimax.io/anthropic), so the agent
 * loop and message format are identical to Claude's and the official SDK can be reused.
 * MiniMax-M3 accepts text, images, tool use/results and thinking blocks.
 * Mainland China accounts use https://api.minimaxi.com/anthropic (set MINIMAX_BASE_URL).
 */
const adapter = defineAdapter(
  {
    id: 'minimax',
    name: 'MiniMax AI (ค่าเริ่มต้น)',
    category: 'ai',
    usedBy: ['inbox', 'accounting', 'video'],
    phase: 3,
    purpose: 'AI หลักของระบบ: แชตปิดการขาย/Return, อ่านใบเสร็จ, เขียนสคริปต์วิดีโอ (และเสียง/วิดีโอในเฟส 6)',
    applyUrl: 'https://platform.minimax.io/',
    env: [
      { name: 'MINIMAX_API_KEY' },
      { name: 'MINIMAX_MODEL', optional: true, default: 'MiniMax-M3' },
      { name: 'MINIMAX_BASE_URL', optional: true, default: 'https://api.minimax.io/anthropic' },
    ],
  },
  {
    capabilities: { images: true, pdf: false, structuredOutput: false },

    getClient() {
      const { MINIMAX_API_KEY, MINIMAX_BASE_URL } = adapter.requireConfig();
      // Re-create when the key changes (e.g. tests, key rotation without restart)
      if (!client || clientKey !== MINIMAX_API_KEY) {
        const Anthropic = require('@anthropic-ai/sdk').default;
        client = new Anthropic({ apiKey: MINIMAX_API_KEY, baseURL: MINIMAX_BASE_URL, maxRetries: 2, timeout: 60_000 });
        clientKey = MINIMAX_API_KEY;
      }
      return client;
    },

    /**
     * Sends only the portable subset of the Messages API: Claude-only extras (effort, betas,
     * server-side fallbacks, cache_control, strict tools) are dropped rather than risking a 400.
     */
    async createMessage({ system, messages, tools, toolChoice, maxTokens = 4000 }) {
      const { MINIMAX_MODEL } = adapter.requireConfig();
      return adapter.getClient().messages.create({
        model: MINIMAX_MODEL,
        max_tokens: maxTokens,
        ...(system ? { system } : {}),
        messages,
        ...(tools?.length ? { tools: tools.map(({ strict: _strict, ...t }) => t) } : {}),
        ...(toolChoice ? { tool_choice: toolChoice } : {}),
      });
    },
  },
);

module.exports = adapter;
