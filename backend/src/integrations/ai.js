'use strict';

const { AppError, badRequest } = require('../core/errors');
const minimax = require('./minimax');
const anthropic = require('./anthropic');

/**
 * Single entry point for every AI feature (chat agent, receipt reading, video scripts).
 * AI_PROVIDER selects the backend: "minimax" (default) or "anthropic". Both speak the
 * Anthropic Messages format, so callers build one request shape and read one response shape.
 */
const PROVIDERS = { minimax, anthropic };

function providerId() {
  const id = (process.env.AI_PROVIDER || 'minimax').toLowerCase();
  return PROVIDERS[id] ? id : 'minimax';
}
const active = () => PROVIDERS[providerId()];

function isConfigured() {
  return active().isConfigured();
}

/** Throws 503 INTEGRATION_NOT_CONFIGURED naming the missing env vars of the active provider. */
function requireConfig() {
  return active().requireConfig();
}

/**
 * @param {{system?:string, messages:object[], tools?:object[], maxTokens?:number, effort?:string}} params
 * effort is honoured by Claude only.
 */
function createMessage(params) {
  return active().createMessage(params);
}

const textOf = (response) =>
  (response.content ?? [])
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('\n')
    .trim();

/** Pulls the first JSON object out of free text (handles ```json fences and <think> preambles). */
function parseJsonLoose(text) {
  const cleaned = String(text).replace(/<think>[\s\S]*?<\/think>/g, '');
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(cleaned.slice(start, end + 1));
  } catch {
    return null;
  }
}

/**
 * Extract a JSON object matching `schema` from `content` (text/image blocks).
 * Claude: native structured output. MiniMax: a single tool whose input_schema is the schema,
 * with a JSON-in-text fallback if the model answers in prose.
 */
async function extractStructured({ system, content, schema, toolName = 'submit_result', toolDescription = 'Submit the extracted data', maxTokens = 4000 }) {
  const p = active();
  if (content.some((b) => b.type === 'document') && !p.capabilities.pdf) {
    throw badRequest('ผู้ให้บริการ AI ปัจจุบันอ่านไฟล์ PDF ไม่ได้ กรุณาถ่ายรูปหรือแคปหน้าจอเอกสารแทน');
  }
  let response;
  if (p.capabilities.structuredOutput) {
    response = await p.createMessage({ system, maxTokens, messages: [{ role: 'user', content }], outputFormat: { type: 'json_schema', schema } });
  } else {
    response = await p.createMessage({
      system: `${system}\n\nส่งผลลัพธ์ด้วยการเรียกเครื่องมือ ${toolName} เพียงครั้งเดียว`,
      maxTokens,
      messages: [{ role: 'user', content }],
      tools: [{ name: toolName, description: toolDescription, input_schema: schema }],
      toolChoice: { type: 'tool', name: toolName },
    });
  }
  if (response.stop_reason === 'refusal') throw new AppError(422, 'AI_REFUSED', 'AI ไม่สามารถอ่านเอกสารนี้ได้');
  const toolUse = (response.content ?? []).find((b) => b.type === 'tool_use' && b.name === toolName);
  const data = toolUse?.input ?? parseJsonLoose(textOf(response));
  if (!data || typeof data !== 'object') throw new AppError(502, 'AI_BAD_OUTPUT', 'AI ตอบกลับในรูปแบบที่อ่านไม่ได้ กรุณาลองใหม่');
  return { data, model: response.model, provider: providerId() };
}

module.exports = { providerId, active, isConfigured, requireConfig, createMessage, extractStructured, textOf, parseJsonLoose, PROVIDERS };
