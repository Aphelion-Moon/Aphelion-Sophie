import { createHash, createHmac, randomBytes } from 'node:crypto';
import { requireCondition, requireId, requireInteger } from '../../contracts/validation.js';
import { validateAiOutput } from '../../modules/assistant/output.js';
import { createAiOutputSchema, validateAiPrompt, freezeAiMaterial } from './prompt-contract.js';

export const DEEPSEEK_MODEL = 'deepseek-flash';
const endpoint = 'https://api.deepseek.com/chat/completions';

/** Missing or inconsistent counters cannot release a conservative reservation. */
export function deepSeekUsage(value) {
  const usage = {};
  for (const key of ['prompt_tokens', 'completion_tokens', 'total_tokens', 'prompt_cache_hit_tokens', 'prompt_cache_miss_tokens']) {
    if (!Number.isSafeInteger(value?.[key]) || value[key] < 0 || value[key] > 2000000) return null;
    usage[key] = value[key];
  }
  if (usage.prompt_tokens + usage.completion_tokens !== usage.total_tokens ||
    usage.prompt_cache_hit_tokens + usage.prompt_cache_miss_tokens !== usage.prompt_tokens) return null;
  return Object.freeze(usage);
}

/** Fixed remote provider. Only the inference identity receives this key; no SDK or fallback. */
export function createDeepSeekClient({ apiKey, fetchImpl = fetch, clock = Date.now, onUsage = () => {}, maxPromptBytes = 16384, outputTokens = 384,
  acceptedFingerprints = [] }) {
  requireCondition(typeof apiKey === 'string' && /^[a-zA-Z0-9_-]{16,256}$/u.test(apiKey), 'AI_WORKER_KEY_REQUIRED');
  requireCondition([fetchImpl, clock, onUsage].every(fn => typeof fn === 'function'), 'TRUSTED_ADAPTERS_REQUIRED');
  requireInteger(maxPromptBytes, 4096, 32768); requireInteger(outputTokens, 64, 512);
  requireCondition(Array.isArray(acceptedFingerprints) && acceptedFingerprints.length <= 16 && acceptedFingerprints.every(value =>
    typeof value === 'string' && /^[a-zA-Z0-9._-]{1,96}$/u.test(value)), 'AI_IDENTITY_POLICY_INVALID');
  const fingerprints = new Set(acceptedFingerprints), preparedTurns = new WeakSet(), consumed = new WeakSet();
  const comparisonKey=randomBytes(32);
  const compareHash=value=>createHmac('sha256',comparisonKey).update(JSON.stringify(value)).digest('hex');
  const profileHash = createHash('sha256').update(JSON.stringify({schema:1,provider:'deepseek',endpoint,model:DEEPSEEK_MODEL,
    maxPromptBytes,outputTokens,thinking:false,stream:false,temperature:0.4,responseFormat:'json_object',acceptedFingerprints:[...fingerprints].sort()})).digest('hex');
  let active = false, blockedUntil = 0, credentialBlocked = false, identityBlocked = false;
  function scope({ boundary, workerDomain, releaseHash, requesterId, restricted }) {
    // Existing local/private qualifications do not authorize a remote restricted lane.
    requireCondition(restricted === false && workerDomain === 'public', 'AI_REMOTE_CONTEXT_UNAPPROVED');
    requireId(requesterId); requireId(boundary?.guildId); requireId(boundary.channelId);
    requireInteger(boundary.boundaryEpoch, 1);
    requireCondition(typeof boundary.continuity === 'string' && /^[a-zA-Z0-9._:-]{1,128}$/u.test(boundary.continuity) &&
      typeof releaseHash === 'string' && /^[a-f0-9]{64}$/u.test(releaseHash), 'AI_REMOTE_CONTEXT_INVALID');
    // Public conversation is shared only inside this qualified channel boundary.
    // A per-member cache key would repeatedly charge its identical approved prefix.
    return createHmac('sha256', apiKey).update(JSON.stringify([workerDomain, boundary.guildId,
      boundary.channelId, boundary.boundaryEpoch, boundary.continuity, releaseHash])).digest('hex');
  }
  function prepare(payload) {
    const started=clock();
    validateAiPrompt(payload);
    const userId = scope(payload), { messages, outputContract, sourceMessages = [], trimGroups = [], contractMessageIndex } = payload;
    const removed = new Set(); let group = 0;
    for (;;) {
      const sources = sourceMessages.filter(source => !removed.has(source.index)).map(source => ({ id: source.id }));
      const contract = { ...outputContract, sourceIds: sources.map(source => source.id) };
      const schema = createAiOutputSchema(contract);
      if (schema.oneOf.length === 1) return prepared({ sources, contract, body: null, messages: [], blocks: [] },started);
      const selected = messages.filter((_message, index) => !removed.has(index) && index !== contractMessageIndex).map(({ role, content }) => ({ role, content }));
      // DeepSeek JSON mode does not enforce JSON Schema. Describe it, then validate locally.
      selected.splice(selected.length - 1, 0, { role: 'system', content: `Return one JSON object matching this turn's schema. Silence is {"kind":"silent"}. No markdown or extra fields.\n${JSON.stringify(schema)}` });
      const body = { model: DEEPSEEK_MODEL, messages: selected, user_id: userId, thinking: { type: 'disabled' },
        stream: false, max_tokens: outputTokens, temperature: 0.4, response_format: { type: 'json_object' } };
      if (Buffer.byteLength(JSON.stringify(body), 'utf8') <= maxPromptBytes) {
        const blocks = messages.flatMap((_message, index) => removed.has(index) || index === contractMessageIndex ? [] :
          [{ kind: payload.blocks?.[index]?.kind ?? (index === 0 ? 'authoring' : index === messages.length - 1 ? 'question' : 'history'),
            ...(sourceMessages.find(source => source.index === index) ? { id: sourceMessages.find(source => source.index === index).id } : {}) }]);
        blocks.splice(blocks.length - 1, 0, { kind: 'contract' });
        return prepared({ sources, contract, body, messages: selected, blocks },started);
      }
      requireCondition(group < trimGroups.length, 'AI_CONTEXT_LIMIT');
      for (const index of trimGroups[group++]) removed.add(index);
    }
  }
  function prepared(value,started) {
    const serialized = value.body === null ? null : JSON.stringify(value.body);
    const result = freezeAiMaterial({ ...value, serialized, bytes: serialized === null ? 0 : Buffer.byteLength(serialized, 'utf8'),
      outputTokens, estimateQuality: 'conservative-byte-estimate',
      diagnostics: value.blocks.map((block, index) => ({ ...block, bytes: Buffer.byteLength(value.messages[index].content, 'utf8') })),
      comparison:{protocol:compareHash({...value.body,messages:undefined}),milliseconds:Math.max(0,Math.min(15000,clock()-started)),
        blocks:value.blocks.map((block,index)=>({kind:block.kind,digest:compareHash([block,value.messages[index]]),bytes:Buffer.byteLength(value.messages[index].content,'utf8')}))} });
    preparedTurns.add(result); return result;
  }
  async function generatePrepared(turn, { signal, deadline, beforeDispatch = async () => true,
    recordDispatch = async () => true, recordResponse = async () => {}, recordUndispatched = async () => {} }) {
      requireInteger(deadline);
      requireCondition(preparedTurns.has(turn) && !consumed.has(turn), 'AI_PREPARATION_UNTRUSTED');
      requireCondition([beforeDispatch, recordDispatch, recordResponse, recordUndispatched].every(fn => typeof fn === 'function'), 'TRUSTED_ADAPTERS_REQUIRED');
      requireCondition(!signal.aborted && clock() < deadline, 'AI_DEADLINE_EXPIRED');
      requireCondition(!active && !credentialBlocked && !identityBlocked && fingerprints.size > 0 && clock() >= blockedUntil, 'AI_WORKER_UNAVAILABLE');
      const { body, contract, sources, serialized } = turn;
      consumed.add(turn);
      if (body === null) return { kind: 'silent' };
      const started = clock(), abort = AbortSignal.any([signal, AbortSignal.timeout(Math.max(1, Math.min(14000, deadline - started)))]);
      active = true; let reader, response, networkStarted = false;
      try {
        requireCondition(await beforeDispatch() === true && !abort.aborted && clock() < deadline, 'AI_DISPATCH_REVOKED');
        requireCondition(await recordDispatch() === true, 'AI_DISPATCH_REVOKED');
        requireCondition(await beforeDispatch() === true && !abort.aborted && clock() < deadline, 'AI_DISPATCH_REVOKED');
        networkStarted = true;
        response = await fetchImpl(endpoint, { method: 'POST', redirect: 'error', signal: abort,
          headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' }, body: serialized });
        if (!response.ok) {
          if ([401, 402, 403].includes(response.status)) credentialBlocked = true;
          const retry = response.headers.get('retry-after');
          const delay = retry && /^\d{1,6}$/u.test(retry) ? Math.min(300000, Math.max(1000, Number(retry) * 1000)) : response.status === 429 ? 30000 : 5000;
          blockedUntil = clock() + delay;
          await response.body?.cancel().catch(() => {});
          throw Error('AI_WORKER_UNAVAILABLE');
        }
        requireCondition(response.headers.get('content-type')?.includes('application/json'), 'AI_WORKER_RESPONSE_INVALID');
        reader = response.body?.getReader(); requireCondition(reader, 'AI_WORKER_RESPONSE_INVALID');
        const chunks = []; let bytes = 0;
        for (;;) {
          const { done, value } = await reader.read(); if (done) break;
          bytes += value.byteLength; requireCondition(bytes <= 65536, 'AI_WORKER_RESPONSE_LIMIT'); chunks.push(value);
        }
        // Non-streaming provider keep-alives are whitespace; JSON.parse accepts them.
        const responseBody = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        const usage = deepSeekUsage(responseBody.usage);
        const model = typeof responseBody.model === 'string' && /^[a-zA-Z0-9._-]{1,96}$/u.test(responseBody.model) ? responseBody.model : null;
        const fingerprint = typeof responseBody.system_fingerprint === 'string' && /^[a-zA-Z0-9._-]{1,96}$/u.test(responseBody.system_fingerprint) ? responseBody.system_fingerprint : null;
        // Accounting precedes acceptance: malformed, truncated, late or unapproved output may still cost money.
        await recordResponse({ usage, model, fingerprint });
        try { onUsage({ model, fingerprint, milliseconds: clock() - started, ...usage }); } catch { /* Optional telemetry does not settle spending. */ }
        if (model !== DEEPSEEK_MODEL || !fingerprints.has(fingerprint)) identityBlocked = true;
        requireCondition(!identityBlocked, 'AI_IDENTITY_UNAPPROVED');
        requireCondition(!abort.aborted && clock() < deadline, 'AI_DEADLINE_EXPIRED');
        requireCondition(responseBody.model === DEEPSEEK_MODEL && responseBody.choices?.length === 1 && responseBody.choices[0].finish_reason === 'stop', 'AI_FINAL_OUTPUT_REQUIRED');
        const message = responseBody.choices[0].message;
        requireCondition(message?.role === 'assistant' && typeof message.content === 'string' && message.content.length <= 8192 &&
          !message.tool_calls?.length && !message.function_call && !message.reasoning_content, 'AI_FINAL_OUTPUT_REQUIRED');
        const output = validateAiOutput(JSON.parse(message.content), { outcomes: contract.outcomes, answerOnly: contract.answerOnly,
          sources, emojiKeys: contract.emojiKeys });
        requireCondition(!abort.aborted && clock() < deadline, 'AI_DEADLINE_EXPIRED');
        return output;
      } catch {
        blockedUntil = Math.max(blockedUntil, clock() + 5000);
        throw Error(abort.aborted || clock() >= deadline ? 'AI_DEADLINE_EXPIRED' : 'AI_WORKER_UNAVAILABLE');
      } finally {
        if (reader) { await reader.cancel().catch(() => {}); reader.releaseLock(); }
        else await response?.body?.cancel().catch(() => {});
        active = false;
        if (!networkStarted) await recordUndispatched();
      }
  }
  return Object.freeze({
    provider: 'deepseek', profileHash,
    prepare, generatePrepared,
    async generate(payload, context) { return generatePrepared(prepare(payload), context); },
    status() { return { active, credentialBlocked, identityBlocked, cooldownUntil: blockedUntil }; },
  });
}
