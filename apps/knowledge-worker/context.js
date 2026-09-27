import { requireCondition, requireInteger } from '../../contracts/validation.js';

/** Disposable bounded context. Every source must be reauthorized by core before it is returned. */
export function createAiContext({ clock = Date.now, maxLanes = 100 }) {
  requireInteger(maxLanes, 1, 100);
  const lanes = new Map();
  const key = request => `${request.guildId}:${request.channelId}:${request.binding.boundaryEpoch}:${request.binding.workerDomain}`;
  function prune() {
    const now = clock();
    for (const [id, lane] of lanes) { lane.messages = lane.messages.filter(item => item.expiresAt > now); if (!lane.messages.length) lanes.delete(id); }
  }
  return Object.freeze({
    remember(request) {
      prune();
      if (request.profile.contextMessages === 0 || !request.decision.context) return;
      requireCondition(typeof request.text === 'string' && request.text.length <= 4000, 'AI_INPUT_INVALID');
      const id = key(request), lane = lanes.get(id) ?? { messages: [] };
      lane.messages = lane.messages.filter(item => item.request.messageId !== request.messageId);
      const stored = { guildId: request.guildId, channelId: request.channelId, userId: request.userId, messageId: request.messageId,
        receivedAt: request.receivedAt, inputRevision: request.inputRevision, binding: structuredClone(request.binding), text: request.text };
      lane.messages.push({ request: stored, expiresAt: Math.min(clock() + request.profile.contextTtlMs, request.receivedAt + request.profile.contextTtlMs) });
      lane.messages = lane.messages.slice(-request.profile.contextMessages);
      lanes.delete(id); lanes.set(id, lane);
      while (lanes.size > maxLanes) lanes.delete(lanes.keys().next().value);
    },
    async history(request, authorize) {
      prune(); const id = key(request), lane = lanes.get(id); if (!lane) return [];
      const result = [];
      for (const item of [...lane.messages]) {
        if (item.request.messageId === request.messageId) continue;
        if (!await authorize(item.request)) { lane.messages = lane.messages.filter(candidate => candidate !== item); continue; }
        // The lane may have been invalidated while awaiting the fresh source authorization.
        if (lanes.get(id) !== lane || item.expiresAt <= clock()) return [];
        result.push(structuredClone(item.request));
      }
      return result.slice(-request.profile.contextMessages);
    },
    invalidate({ channelId = null, userId = null, messageId = null } = {}) {
      for (const [id, lane] of lanes) {
        lane.messages = lane.messages.filter(({ request }) => !(channelId === null || request.channelId === channelId) ||
          !(userId === null || request.userId === userId) || !(messageId === null || request.messageId === messageId));
        if (!lane.messages.length) lanes.delete(id);
      }
    },
    clear() { lanes.clear(); },
    status() { prune(); return { lanes: lanes.size, messages: [...lanes.values()].reduce((count, lane) => count + lane.messages.length, 0) }; },
  });
}
