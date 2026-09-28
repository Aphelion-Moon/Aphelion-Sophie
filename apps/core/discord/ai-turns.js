import { requireCondition } from '../../../contracts/validation.js';
import { validateAiOutput, renderAiReply } from '../../../modules/assistant/output.js';
import { buildAiPrompt } from '../../knowledge-worker/prompt.js';
import { freezeAiMaterial } from '../../knowledge-worker/prompt-contract.js';

/** Core owns delivery. No worker can choose a recipient, target message or operational indicator. */
export function createAiTurns({ admission, scheduler, context, knowledge, messages, clock, onInvalidate = () => {} }) {
  const outstanding = new Map(), gatherings = new Map(); let stopped = false;
  function finishGather(entry) {
    clearTimeout(entry.timer); gatherings.delete(entry.rootId);
    entry.resolve?.(entry.cancelled ? null : [...entry.fragments.values()].sort((a,b)=>a.receivedAt-b.receivedAt || a.messageId.localeCompare(b.messageId)));
  }
  function scheduleGather(entry) {
    clearTimeout(entry.timer);
    entry.timer=setTimeout(()=>finishGather(entry),Math.max(1,(entry.editing ? entry.until : entry.quietUntil)-clock()));
  }
  function gatheringFor(filter) {
    return [...gatherings.values()].find(entry=>entry.fragments.has(filter.messageId) && entry.fragments.get(filter.messageId).channelId===filter.channelId);
  }
  function invalidateContext(filter) {
    context.invalidate(filter);onInvalidate(filter);
    for(const [id,{request}] of outstanding)if(!filter.channelId || request.channelId===filter.channelId)scheduler.cancel(id);
  }
  async function gather(request) {
    const lease = request.gather;
    if (!lease) return request;
    let entry = gatherings.get(lease.rootId);
    if (!entry) {
      if (gatherings.size >= 4) return null;
      entry = { rootId:lease.rootId, fragments:new Map(), quietUntil:lease.quietUntil, until:lease.until, timer:null, cancelled:false, resolve:null, editing:false };
      gatherings.set(lease.rootId,entry);
    }
    if(entry.editing){entry.cancelled=true;finishGather(entry);return null;}
    entry.fragments.set(request.messageId,request);
    entry.quietUntil = Math.min(entry.until,Math.max(entry.quietUntil,lease.quietUntil));
    if (entry.fragments.size >= 3) entry.quietUntil = clock();
    scheduleGather(entry);
    if (lease.rootId !== request.messageId) return 'joined';
    const fragments = await new Promise(resolve=>{entry.resolve=resolve;});
    const root=fragments?.find(item=>item.messageId===request.messageId);
    if (!root || entry.editing || !await admission.freezeGather(root,fragments)) return null;
    const combined = [root,...fragments.filter(item=>item.messageId!==root.messageId)];
    return { ...root, text:combined.map(item=>item.text).join('\n'), fragments:combined };
  }
  const historyCurrent = (request, source) => context.current(source, item => admission.revalidateSource(item), items => knowledge.current(items, request));
  async function current(request, sources = [], history = []) {
    if (stopped || clock() >= request.deadline || !await admission.revalidate(request)) return false;
    for (const fragment of request.fragments ?? []) if (fragment.messageId!==request.messageId && !await admission.revalidate(fragment)) return false;
    for (const source of history) if (!await historyCurrent(request, source)) return false;
    return await knowledge.current(sources, request) === true && clock() < request.deadline;
  }
  async function run(request) {
    let attempted = false, effect = null;
    try {
      if (!await current(request)) { await admission.settle(request, 'cancelled'); return { state: 'cancelled' }; }
      const fragmentIds = new Set((request.fragments ?? []).map(item=>item.messageId));
      const history = (await context.history(request, source => historyCurrent(request, source))).filter(source=>!fragmentIds.has(source.messageId));
      const dependencies = [...history,...(request.fragments ?? []).filter(item=>item.messageId!==request.messageId)
        .map(item=>({...item,expiresAt:item.receivedAt+Math.min(300000,item.profile.contextTtlMs)}))];
      const sources = await knowledge.lookup(request.text, request);
      if (!await current(request, sources, history)) { await admission.settle(request, 'cancelled'); return { state: 'cancelled' }; }
      const generated = await scheduler.submit({ id: request.messageId, member: `${request.guildId}.${request.userId}`, channel: `${request.guildId}.${request.channelId}`, receivedAt: request.receivedAt,
        deadline: request.deadline, proactive: request.decision.proactive,
        beforeDispatch: () => current(request, sources, history),
        onPrepared: async comparison=>{
          if(!await current(request,sources,history))return;
          await context.comparePrepared(request,history,sources,comparison,admission.revalidateSource,
            items=>items.length===0?true:knowledge.currentReferences(items,request));
        },
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
        ? await messages.reply(request, renderAiReply(output, sources), dependencies, sources)
        : await messages.react(request, request.config.emojis.find(emoji => emoji.key === output.emojiKey), dependencies, sources);
      if (clock() >= request.deadline || !await current(request, sources, history)) {
        await messages.remove(request, effect); await admission.settle(request, 'cancelled', effect.id); return { state: 'cancelled' };
      }
      const state = output.kind === 'reply' ? 'delivered' : 'reacted'; await admission.settle(request, state, effect.id);
      if (!await current(request, sources, history)) {
        await messages.remove(request, effect); await admission.settle(request, 'cancelled', effect.id); return { state: 'cancelled' };
      }
      // Disposable continuity must not turn a confirmed delivery into an uncertain send.
      try {
        if (output.kind === 'reply' && await current(request, sources, history)) context.rememberReply(request, { id: effect.id, text: output.text }, dependencies, sources);
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
    diagnostics:({guildId,channelId})=>context.diagnostic(channelId,admission.revalidateSource,
      items=>items.length===0?true:knowledge.currentReferences(items,{guildId,deadline:clock()+5000})),
    prepareEdit(filter) {
      invalidateContext(filter);
      const entry=gatheringFor(filter);
      if(!entry)return false;
      if(stopped || entry.editing || clock()>=entry.quietUntil || clock()>=entry.until){entry.cancelled=true;finishGather(entry);return false;}
      entry.editing=true;scheduleGather(entry);return true;
    },
    async edit(proof,filter) {
      const entry=gatheringFor(filter),previous=entry?.fragments.get(filter.messageId);
      if(!entry?.editing || stopped)return {state:'cancelled'};
      try {
        const replacement=await admission.replaceGather(proof,previous);
        if(!replacement || gatherings.get(entry.rootId)!==entry || clock()>=entry.until || stopped){entry.cancelled=true;finishGather(entry);return {state:'cancelled'};}
        entry.fragments.set(filter.messageId,replacement);entry.quietUntil=replacement.gather.quietUntil;entry.editing=false;
        context.remember(replacement);scheduleGather(entry);return {state:'gathered'};
      } catch {entry.cancelled=true;finishGather(entry);return {state:'cancelled'};}
    },
    async handle(proof) {
      if (stopped) return { state: 'disabled' };
      let request = await admission.admit(proof); if (!request) return { state: 'ignored' };
      if (stopped) { await admission.settle(request, 'cancelled'); return { state: 'disabled' }; }
      context.remember(request);
      if (!request.decision.infer) return { state: 'context' };
      const first = request; request = await gather(request);
      if (request === 'joined') return { state:'gathered' };
      if (!request || stopped) { await admission.settle(first,'cancelled'); return { state:'cancelled' }; }
      if (outstanding.size >= 4) { await admission.settle(request, 'unavailable'); return { state: 'busy' }; }
      const task = run(request); outstanding.set(request.messageId, { request, task });
      try { return await task; } finally { outstanding.delete(request.messageId); }
    },
    invalidate(filter = {}) {
      invalidateContext(filter);
      for (const entry of [...gatherings.values()]) if ([...entry.fragments.values()].some(item=>(!filter.channelId || item.channelId===filter.channelId) &&
        (!filter.userId || item.userId===filter.userId) && (!filter.messageId || item.messageId===filter.messageId))) { entry.cancelled=true; finishGather(entry); }
    },
    async stop() {
      stopped = true; for (const entry of [...gatherings.values()]) { entry.cancelled=true; finishGather(entry); }
      scheduler.disable(); context.clear(); await Promise.all([...outstanding.values()].map(value => value.task));
    },
  });
}
