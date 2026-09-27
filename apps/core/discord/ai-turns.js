import { requireCondition } from '../../../contracts/validation.js';
import { validateAiOutput, renderAiReply } from '../../../modules/assistant/output.js';
import { buildAiPrompt } from '../../knowledge-worker/prompt.js';
import { freezeAiMaterial } from '../../knowledge-worker/prompt-contract.js';

/** Core owns delivery. No worker can choose a recipient, target message or operational indicator. */
export function createAiTurns({ admission, scheduler, context, knowledge, messages, clock }) {
  const outstanding = new Map(); let stopped = false;
  const historyCurrent = (request, source) => context.current(source, item => admission.revalidateSource(item), items => knowledge.current(items, request));
  async function current(request, sources = [], history = []) {
    if (stopped || clock() >= request.deadline || !await admission.revalidate(request)) return false;
    for (const source of history) if (!await historyCurrent(request, source)) return false;
    return await knowledge.current(sources, request) === true && clock() < request.deadline;
  }
  async function run(request) {
    let attempted = false, effect = null;
    try {
      if (!await current(request)) { await admission.settle(request, 'cancelled'); return { state: 'cancelled' }; }
      const history = await context.history(request, source => historyCurrent(request, source));
      const sources = await knowledge.lookup(request.text, request);
      if (!await current(request, sources, history)) { await admission.settle(request, 'cancelled'); return { state: 'cancelled' }; }
      const generated = await scheduler.submit({ id: request.messageId, member: `${request.guildId}.${request.userId}`, receivedAt: request.receivedAt,
        deadline: request.deadline, proactive: request.decision.proactive,
        beforeDispatch: () => current(request, sources, history),
        beforeExecute: async () => {
          if (!await current(request, sources, history)) return false;
          if (request.profile.typing && !request.decision.proactive && request.decision.outcomes.includes('reply')) {
            try { await messages.typing(request); } catch { /* An optional indicator failure cannot authorize or replay a response. */ }
          }
          return current(request, sources, history);
        },
        payload: freezeAiMaterial({ workerDomain: request.binding.workerDomain, releaseHash: request.binding.releaseHash,
          requesterId: request.userId, restricted: request.binding.restricted,
          boundary: { guildId: request.guildId, channelId: request.channelId, continuity: request.binding.continuity, boundaryEpoch: request.binding.boundaryEpoch },
          local: { messageId: request.messageId, inputRevision: request.inputRevision, controlEpoch: request.binding.epoch,
            deadline: request.deadline, proactive: request.decision.proactive },
          ...buildAiPrompt({ request, history, sources }) }) });
      if (generated.state !== 'completed') { const state = ['expired', 'cancelled'].includes(generated.state) ? generated.state : 'unavailable'; await admission.settle(request, state); return { state }; }
      const output = validateAiOutput(generated.result, { outcomes: request.decision.outcomes, answerOnly: request.decision.answerOnly,
        sources, emojiKeys: request.config.emojis.map(emoji => emoji.key) });
      if (!await current(request, sources, history)) { await admission.settle(request, 'cancelled'); return { state: 'cancelled' }; }
      if (output.kind === 'silent') { await admission.settle(request, 'silent'); return { state: 'silent' }; }
      if (!await admission.beginDelivery(request)) { await admission.settle(request, 'cancelled'); return { state: 'cancelled' }; }
      // Deadline is propagated through the actual Discord request; no late-send queue or fallback destination.
      requireCondition(clock() < request.deadline, 'AI_DEADLINE_EXPIRED'); attempted = true;
      effect = output.kind === 'reply'
        ? await messages.reply(request, renderAiReply(output, sources))
        : await messages.react(request, request.config.emojis.find(emoji => emoji.key === output.emojiKey));
      if (clock() >= request.deadline || !await current(request, sources, history)) {
        await messages.remove(request, effect); await admission.settle(request, 'cancelled', effect.id); return { state: 'cancelled' };
      }
      const state = output.kind === 'reply' ? 'delivered' : 'reacted'; await admission.settle(request, state, effect.id);
      if (!await current(request, sources, history)) {
        await messages.remove(request, effect); await admission.settle(request, 'cancelled', effect.id); return { state: 'cancelled' };
      }
      // Disposable continuity must not turn a confirmed delivery into an uncertain send.
      try {
        if (output.kind === 'reply' && await current(request, sources, history)) context.rememberReply(request, { id: effect.id, text: output.text }, history, sources);
      } catch { /* Omit context if fresh authorization or bounded retention is unavailable. */ }
      return { state };
    } catch {
      if (effect !== null) {
        try { await messages.remove(request, effect); await admission.settle(request, 'cancelled', effect.id); return { state: 'cancelled' }; }
        catch { /* Cleanup uncertainty is retained; no new generation or delivery retry. */ }
      }
      const state = attempted ? 'uncertain' : clock() >= request.deadline ? 'expired' : 'unavailable';
      await admission.settle(request, state, effect?.id ?? null).catch(() => {}); return { state };
    }
  }
  return Object.freeze({
    async handle(proof) {
      if (stopped) return { state: 'disabled' };
      const request = await admission.admit(proof); if (!request) return { state: 'ignored' };
      if (stopped) { await admission.settle(request, 'cancelled'); return { state: 'disabled' }; }
      context.remember(request);
      if (!request.decision.infer) return { state: 'context' };
      if (outstanding.size >= 4) { await admission.settle(request, 'unavailable'); return { state: 'busy' }; }
      const task = run(request); outstanding.set(request.messageId, { request, task });
      try { return await task; } finally { outstanding.delete(request.messageId); }
    },
    invalidate(filter = {}) {
      context.invalidate(filter);
      // Any source in this bounded lane may be a history dependency of an active turn.
      for (const [id, { request }] of outstanding) if (!filter.channelId || request.channelId === filter.channelId) scheduler.cancel(id);
    },
    async stop() { stopped = true; scheduler.disable(); context.clear(); await Promise.all([...outstanding.values()].map(value => value.task)); },
  });
}
