import { requireCondition, requireInteger } from '../../contracts/validation.js';
import { isIP } from 'node:net';

export const AI_OUTPUT_SCHEMA = {
  oneOf: [
    { type: 'object', additionalProperties: false, properties: { kind: { const: 'silent' } }, required: ['kind'] },
    { type: 'object', additionalProperties: false, properties: { kind: { const: 'react' }, emojiKey: { type: 'string', maxLength: 96 } }, required: ['kind', 'emojiKey'] },
    { type: 'object', additionalProperties: false, properties: { kind: { const: 'reply' }, text: { type: 'string', maxLength: 1600 },
      purpose: { enum: ['answer', 'conversation'] }, support: { enum: ['provided_sources', 'current_conversation', 'general_knowledge'] },
      citations: { type: 'array', maxItems: 4, items: { type: 'string', maxLength: 96 } } }, required: ['kind', 'text', 'purpose', 'support', 'citations'] },
  ],
};

async function boundedJson(response, limit) {
  requireCondition(response.ok && response.headers.get('content-type')?.includes('application/json'), 'AI_WORKER_UNAVAILABLE');
  const reader = response.body?.getReader(); requireCondition(reader, 'AI_WORKER_UNAVAILABLE');
  const chunks = []; let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read(); if (done) break;
      length += value.byteLength; requireCondition(length <= limit, 'AI_WORKER_RESPONSE_LIMIT'); chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch { throw new Error('AI_WORKER_RESPONSE_INVALID'); }
  finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}

/** Fixed authenticated local/private endpoint, no redirects, retries, arbitrary URLs or provider fallback. */
export function createLlamaClient({ endpoint, apiKey, modelId, contextTokens = 4096, outputTokens = 192, fetchImpl = fetch, clock = Date.now }) {
  const origin = new URL(endpoint);
  const loopback = origin.hostname === '127.0.0.1';
  const privateAddress = isIP(origin.hostname) === 4 && /^(?:10\.|192\.168\.|172\.(?:1[6-9]|2[0-9]|3[01])\.)/u.test(origin.hostname);
  requireCondition((loopback && origin.protocol === 'http:' || privateAddress && origin.protocol === 'https:') &&
    origin.pathname === '/' && !origin.username && !origin.password && !origin.search && !origin.hash, 'AI_WORKER_ENDPOINT_INVALID');
  requireCondition(typeof apiKey === 'string' && /^[a-zA-Z0-9_-]{32,256}$/.test(apiKey), 'AI_WORKER_KEY_REQUIRED');
  requireCondition(typeof modelId === 'string' && /^[a-zA-Z0-9._-]{1,96}$/.test(modelId), 'AI_MODEL_INVALID');
  requireInteger(contextTokens, 512, 4096); requireInteger(outputTokens, 16, 512);
  async function post(path, body, signal, deadline, limit = 262144) {
    requireCondition(!signal.aborted && clock() < deadline, 'AI_DEADLINE_EXPIRED');
    const abort = AbortSignal.any([signal, AbortSignal.timeout(Math.max(1, Math.min(15000, deadline - clock())))]);
    try { return await boundedJson(await fetchImpl(new URL(path, origin), { method: 'POST', redirect: 'error', signal: abort,
      headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' }, body: JSON.stringify(body) }), limit); }
    catch { throw new Error(signal.aborted || clock() >= deadline ? 'AI_DEADLINE_EXPIRED' : 'AI_WORKER_UNAVAILABLE'); }
  }
  return Object.freeze({
    async generate({ messages, trimGroups = [] }, { signal, deadline }) {
      requireCondition(Array.isArray(messages) && messages.length >= 2 && messages.length <= 54 &&
        messages.every(item => ['system', 'user', 'assistant'].includes(item.role) && typeof item.content === 'string' && item.content.length <= 32768) &&
        messages.reduce((count, item) => count + item.content.length, 0) <= 196608, 'AI_PROMPT_INVALID');
      requireCondition(Array.isArray(trimGroups) && trimGroups.length <= 44 && trimGroups.every(group => Array.isArray(group) &&
        group.length > 0 && group.length <= 2 && group.every(index => Number.isSafeInteger(index) && index > 0 && index < messages.length - 1 && messages[index].role !== 'system')) &&
        new Set(trimGroups.flat()).size === trimGroups.flat().length, 'AI_PROMPT_INVALID');
      const removed = new Set(); let groupIndex = 0, body;
      // b10977 counts the same chat parser/template used by generation, including its assistant prefix.
      for (;;) {
        const selected = messages.filter((_message, index) => !removed.has(index));
        body = { model: modelId, messages: selected, stream: false, max_tokens: outputTokens,
          temperature: 0.6, cache_prompt: false, response_format: { type: 'json_schema', json_schema: { name: 'sophie', strict: true, schema: AI_OUTPUT_SCHEMA } } };
        const counted = await post('/v1/chat/completions/input_tokens', body, signal, deadline, 4096);
        requireCondition(counted.object === 'response.input_tokens' && Number.isSafeInteger(counted.input_tokens) && counted.input_tokens > 0, 'AI_TOKENIZER_INVALID');
        if (counted.input_tokens + outputTokens <= contextTokens) break;
        requireCondition(groupIndex < trimGroups.length, 'AI_CONTEXT_LIMIT');
        // Estimate only how much optional text to remove; the next exact count still decides admission.
        const target = selected.reduce((count, item) => count + item.content.length, 0) * (counted.input_tokens + outputTokens - contextTokens) / counted.input_tokens + 256;
        let characters = 0;
        while (groupIndex < trimGroups.length && characters < target) {
          for (const index of trimGroups[groupIndex++]) { removed.add(index); characters += messages[index].content.length; }
        }
      }
      const response = await post('/v1/chat/completions', body, signal, deadline, 65536);
      requireCondition(response.choices?.length === 1 && response.choices[0].finish_reason === 'stop', 'AI_FINAL_OUTPUT_REQUIRED');
      const message = response.choices[0].message;
      requireCondition(message?.role === 'assistant' && typeof message.content === 'string' && message.content.length <= 8192 &&
        !message.tool_calls?.length && !message.function_call, 'AI_FINAL_OUTPUT_REQUIRED');
      // Only final content is parsed. Separate reasoning fields and transport errors never reach Discord.
      let output; try { output = JSON.parse(message.content); } catch { throw new Error('AI_OUTPUT_INVALID'); }
      requireCondition(clock() < deadline && !signal.aborted, 'AI_DEADLINE_EXPIRED');
      return output;
    },
  });
}
