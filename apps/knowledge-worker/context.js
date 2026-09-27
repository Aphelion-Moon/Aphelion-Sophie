import { requireCondition, requireInteger } from '../../contracts/validation.js';

/** Disposable bounded context. Every source must be reauthorized by core before it is returned. */
export function createAiContext({ clock = Date.now, maxLanes = 100, setTimer = setTimeout, clearTimer = clearTimeout }) {
  requireInteger(maxLanes, 1, 100);
  const lanes = new Map(); let revision = 0, expiryTimer = null;
  function scheduleExpiry() {
    clearTimer(expiryTimer); expiryTimer = null;
    const expiries = [...lanes.values()].flatMap(lane => lane.messages.map(item => item.expiresAt));
    if (!expiries.length) return;
    expiryTimer = setTimer(() => { prune(); scheduleExpiry(); }, Math.max(1, Math.min(...expiries) - clock()));
    expiryTimer?.unref?.();
  }
  const key = request => `${request.guildId}:${request.channelId}:${request.binding.boundaryEpoch}:${request.binding.workerDomain}:${request.binding.continuity}`;
  const countLimit = request => Math.min(12, request.profile.contextMessages);
  const lifetime = request => Math.min(300000, request.profile.contextTtlMs);
  const matches = (request, { channelId = null, userId = null, messageId = null }) =>
    (channelId === null || request.channelId === channelId) && (userId === null || request.userId === userId) &&
    (messageId === null || request.messageId === messageId);
  function insert(request, stored, expiresAt) {
    if (expiresAt <= clock()) return;
    const id = key(request), lane = lanes.get(id) ?? { messages: [] };
    lane.messages = lane.messages.filter(item => item.request.messageId !== stored.messageId);
    stored.contextRevision = ++revision;
    lane.messages.push({ request: stored, expiresAt });
    lane.messages = lane.messages.slice(-countLimit(request));
    while (lane.messages.length && Buffer.byteLength(JSON.stringify(lane.messages), 'utf8') > 65536) lane.messages.shift();
    lanes.delete(id); if (lane.messages.length) lanes.set(id, lane);
    while (lanes.size > maxLanes) lanes.delete(lanes.keys().next().value);
    scheduleExpiry();
  }
  function dependency(source) {
    const { guildId, channelId, userId, messageId, receivedAt, inputRevision, binding, expiresAt } = source;
    return structuredClone({ guildId, channelId, userId, messageId, receivedAt, inputRevision, binding, expiresAt });
  }
  function prune() {
    const now = clock();
    for (const [id, lane] of lanes) { lane.messages = lane.messages.filter(item => item.expiresAt > now); if (!lane.messages.length) lanes.delete(id); }
  }
  return Object.freeze({
    remember(request) {
      prune();
      if (request.profile.contextMessages === 0 || !request.decision.context) return;
      requireCondition(typeof request.text === 'string' && request.text.length <= 4000, 'AI_INPUT_INVALID');
      const stored = { guildId: request.guildId, channelId: request.channelId, userId: request.userId, messageId: request.messageId,
        receivedAt: request.receivedAt, inputRevision: request.inputRevision, binding: structuredClone(request.binding), text: request.text,
        expiresAt: request.receivedAt + lifetime(request) };
      insert(request, stored, stored.expiresAt);
    },
    rememberReply(request, { id, text }, history, sources) {
      prune();
      if (countLimit(request) === 0 || !request.decision.context) return;
      requireCondition(typeof id === 'string' && /^[1-9][0-9]{0,19}$/.test(id) && typeof text === 'string' && text.length <= 1600,
        'AI_REPLY_CONTEXT_INVALID');
      const dependencies = new Map(), knowledge = new Map();
      for (const item of [{ ...request, expiresAt: request.receivedAt + lifetime(request) }, ...history]) {
        for (const original of item.kind === 'assistant' ? item.dependencies : [item]) {
          const source = dependency(original), key = `${source.channelId}.${source.messageId}`;
          const prior = dependencies.get(key);
          if (prior && (prior.inputRevision !== source.inputRevision || JSON.stringify(prior.binding) !== JSON.stringify(source.binding))) return;
          dependencies.set(key, source);
        }
        for (const source of item.knowledge ?? []) {
          const prior = knowledge.get(source.id);
          if (prior && JSON.stringify(prior) !== JSON.stringify(source)) return;
          knowledge.set(source.id, structuredClone(source));
        }
      }
      for (const source of sources) {
        const previous = knowledge.get(source.id);
        if (previous && JSON.stringify(previous) !== JSON.stringify(source)) return;
        knowledge.set(source.id, structuredClone(source));
      }
      // Bounds apply to the dependency closure too; never drop a dependency to retain an answer.
      if (dependencies.size > 12 || knowledge.size > 24) return;
      const expiresAt = Math.min(request.receivedAt + lifetime(request), ...[...dependencies.values()].map(source => source.expiresAt),
        ...[...knowledge.values()].filter(source => Number.isSafeInteger(source.validUntil)).map(source => source.validUntil));
      if (!Number.isSafeInteger(expiresAt)) return;
      insert(request, { kind: 'assistant', guildId: request.guildId, channelId: request.channelId, messageId: id, text,
        binding: structuredClone(request.binding), expiresAt, dependencies: [...dependencies.values()], knowledge: [...knowledge.values()] }, expiresAt);
    },
    async current(source, authorize, authorizeKnowledge) {
      const retained = () => source.expiresAt > clock() && lanes.get(key(source))?.messages.some(item =>
        item.request.messageId === source.messageId && item.request.contextRevision === source.contextRevision) === true;
      if (!retained()) return false;
      if (source.kind !== 'assistant') return await authorize(source) === true && retained();
      for (const item of source.dependencies) if (item.expiresAt <= clock() || await authorize(item) !== true) return false;
      return await authorizeKnowledge(source.knowledge) === true && retained();
    },
    async history(request, authorize) {
      if (countLimit(request) === 0 || !request.decision.context) return [];
      prune(); const id = key(request), lane = lanes.get(id); if (!lane) return [];
      const result = [];
      for (const item of [...lane.messages]) {
        if (item.request.messageId === request.messageId) continue;
        if (!await authorize(item.request)) { lane.messages = lane.messages.filter(candidate => candidate !== item); continue; }
        // The lane may have been invalidated while awaiting the fresh source authorization.
        if (lanes.get(id) !== lane || !lane.messages.includes(item) || item.expiresAt <= clock()) return [];
        result.push(structuredClone(item.request));
      }
      return result.slice(-countLimit(request));
    },
    invalidate({ channelId = null, userId = null, messageId = null } = {}) {
      for (const [id, lane] of lanes) {
        const filter = { channelId, userId, messageId };
        lane.messages = lane.messages.filter(({ request }) => !matches(request, filter) &&
          !(request.dependencies ?? []).some(source => matches(source, filter)));
        if (!lane.messages.length) lanes.delete(id);
      }
      scheduleExpiry();
    },
    clear() { lanes.clear(); clearTimer(expiryTimer); expiryTimer = null; },
    status() { prune(); return { lanes: lanes.size, messages: [...lanes.values()].reduce((count, lane) => count + lane.messages.length, 0) }; },
  });
}
