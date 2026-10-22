import { requireCondition } from '../../../contracts/validation.js';
import { validateAiOutput, renderAiReply } from '../../../modules/assistant/output.js';
import { aiSpeakerLabels, buildAiPrompt } from '../../knowledge-worker/prompt.js';
import { encodeMemory } from '../../../modules/assistant/memories.js';
import { redactAiIdentifiers } from '../../knowledge-worker/redaction.js';
import { freezeAiMaterial } from '../../knowledge-worker/prompt-contract.js';
import { effectContextFits } from '../storage/ai-effects.js';

/** Core owns delivery. No worker can choose a recipient, target message or operational indicator. */
export function createAiTurns({ admission, scheduler, context, knowledge, messages, clock, memory = null, memories = null, onInvalidate = () => {}, trace = () => {} }) {
  const outstanding = new Map(), gatherings = new Map(); let stopped = false, generation = 0;
  // Fixed diagnostic codes only: the stage a turn ended at, its outcome and whole seconds since receipt. No IDs or text.
  const code = value => typeof value === 'string' && /^[A-Z][A-Z0-9_]{2,40}$/u.test(value) ? value : 'ERROR';
  const report = (request, state, stage, reason = null) => {
    try { trace(`AI_TURN_${code(String(state).toUpperCase())}_${code(stage)}_${Math.min(99, Math.max(0, Math.floor((clock() - request.receivedAt) / 1000)))}S${reason === null ? '' : `_${code(reason)}`}`.slice(0, 64)); } catch { /* Diagnostics never affect a turn. */ }
  };
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
  const targeted = filter => Boolean(filter.channelId || filter.userId || filter.messageId);
  function invalidateContext(filter) {
    // Pending admissions have no trusted identity yet; discard them on any invalidation.
    admission.invalidate?.(); generation++;
    // An untargeted change (consent, AI state, knowledge, Gateway reconnect) is caught where it matters: history is
    // authorized as it is read and the pre-delivery check compares bindings. Wiping every lane, cancelling unrelated
    // turns and withdrawing every delivered reply on such events made Sophie forget and delete conversations.
    if (!targeted(filter)) return;
    context.invalidate(filter); onInvalidate(filter);
    for(const [id,{request}] of outstanding)if((!filter.channelId || request.channelId===filter.channelId) &&
      (!filter.userId || request.userId===filter.userId || (request.fragments??[]).some(item=>item.userId===filter.userId)) &&
      (!filter.messageId || request.messageId===filter.messageId || (request.fragments??[]).some(item=>item.messageId===filter.messageId) || filter.channelId))scheduler.cancel(id);
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
  // The second of exactly two authorization checks (owner decision, 12 October 2026). Admission is the first: it authorizes
  // the request and its fragments, and history is authorized as it is read. This one runs once, right before delivery,
  // over everything the reply depends on; beginDelivery re-checks the request itself atomically with the state change.
  async function dependenciesCurrent(request, sources, history, saved, remembered) {
    if (stopped || clock() >= request.deadline) return false;
    for (const fragment of request.fragments ?? []) if (fragment.messageId!==request.messageId && !await admission.revalidate(fragment)) return false;
    for (const source of history) if (!await historyCurrent(request, source)) return false;
    // Notes the member edited, deleted or stopped sharing after preparation must not reach delivery.
    if (saved !== null && await memory.current(request.userId, saved) !== true) return false;
    // A memory deleted, edited or no longer usable since preparation must not shape the reply.
    if (remembered?.length && await memories.current(remembered) !== true) return false;
    return await knowledge.current(sources, request) === true && clock() < request.deadline;
  }
  const expired = request => stopped || clock() >= request.deadline;
  // What Sophie chose to remember is stored only for a turn that finished (reply, reaction or silence), and memories she
  // used stay another 90 days. A memory failure never affects the turn.
  async function remember(request, speakers, output, remembered) {
    if (memories === null || remembered === null) return;
    try {
      await memories.touch(remembered);
      if (!output.memories?.length) return;
      const userOf = new Map([...speakers].map(([userId, label]) => [label, userId]));
      const saved = await memories.record({ channelId: request.channelId, memories: output.memories.map(item => encodeMemory(item, label => userOf.get(label)))
        // Contact details, links and IDs are masked before anything is kept, as they are before anything is sent.
        .map(item => ({ ...item, text: redactAiIdentifiers(item.text) })) });
      trace(`AI_MEMORY_SAVED_${saved}`);
    } catch { try { trace('AI_MEMORY_UNAVAILABLE'); } catch { /* Diagnostics only. */ } }
  }
  async function run(request) {
    const result = await runStages(request);
    report(request, result.state, result.stage ?? 'END', result.reason ?? null);
    return { state: result.state };
  }
  async function runStages(request) {
    let attempted = false, effect = null, stage = 'START';
    try {
      if (expired(request)) { await admission.settle(request, 'expired'); return { state: 'expired', stage }; }
      // Typing starts as soon as an addressed turn is admitted, as people expect; it promises nothing and an
      // indicator failure cannot authorize or replay a response.
      if (request.profile.typing && !request.decision.proactive && request.decision.outcomes.includes('reply')) void messages.typing(request).catch(() => {});
      stage = 'HISTORY';
      const fragmentIds = new Set((request.fragments ?? []).map(item=>item.messageId));
      let history = (await context.history(request, source => historyCurrent(request, source))).filter(source=>!fragmentIds.has(source.messageId));
      const fragmentDependencies = (request.fragments ?? []).filter(item=>item.messageId!==request.messageId)
        .map(item=>({...item,expiresAt:item.receivedAt+Math.min(300000,item.profile.contextTtlMs)}));
      stage = 'KNOWLEDGE';
      // The last few exchanged lines let a follow-up ("what about the other one?") find the topic being discussed.
      const sources = await knowledge.lookup(request.text, request, history.slice(-3).map(source => source.text).join('\n').slice(-4000));
      // The reply's effect record also holds what earlier replies in its context relied on, so a run of sourced answers
      // overflowed it and every later reply failed at delivery. Leave out Sophie's own earlier replies, oldest first, then
      // the oldest messages, until it fits; members' questions stay, and context the model never sees is not a dependency.
      while (history.length > 0 && !effectContextFits(request, [...history, ...fragmentDependencies], sources)) {
        const reply = history.findIndex(item => item.kind === 'assistant');
        history = reply >= 0 ? history.filter((_, index) => index !== reply) : history.slice(1);
      }
      const dependencies = [...history, ...fragmentDependencies];
      // Only the requester's own shared notes; never another participant's.
      stage = 'MEMORY';
      const saved = memory === null ? null : await memory.read(request.userId);
      // Sophie's own memories, only while an accepted notice discloses them; null means this turn cannot remember.
      const speakers = aiSpeakerLabels(request, history);
      const remembered = memories !== null && await memories.enabled() === true
        ? await memories.forPrompt({ channelId: request.channelId, userIds: [...speakers.keys()] }) : null;
      if (expired(request)) { await admission.settle(request, 'expired'); return { state: 'expired', stage }; }
      stage = 'GENERATE';
      const generated = await scheduler.submit({ id: request.messageId, member: `${request.guildId}.${request.userId}`, channel: `${request.guildId}.${request.channelId}`, receivedAt: request.receivedAt,
        deadline: request.deadline, proactive: request.decision.proactive,
        // The prepared-shape comparison holds block sizes and digests only; diagnostics() re-authorizes it before showing it.
        onPrepared: comparison => context.comparePrepared(request, history, sources, comparison, async () => true, async () => true),
        payload: freezeAiMaterial({ workerDomain: request.binding.workerDomain, releaseHash: request.binding.releaseHash,
          requesterId: request.userId, restricted: request.binding.restricted,
          boundary: { guildId: request.guildId, channelId: request.channelId, continuity: request.binding.continuity, boundaryEpoch: request.binding.boundaryEpoch },
          local: { messageId: request.messageId, inputRevision: request.inputRevision, controlEpoch: request.binding.epoch,
            deadline: request.deadline, proactive: request.decision.proactive },
          ...buildAiPrompt({ request, history, sources, memory: saved, memories: remembered }) }) });
      if (generated.state !== 'completed') { const state = ['expired', 'cancelled'].includes(generated.state) ? generated.state : 'unavailable'; await admission.settle(request, state); return { state, stage, reason: String(generated.state).toUpperCase() }; }
      stage = 'VALIDATE';
      const output = validateAiOutput(generated.result, { outcomes: request.decision.outcomes, answerOnly: request.decision.answerOnly,
        sources, emojiKeys: request.config.emojis.map(emoji => emoji.key), replyChars: request.context?.replyChars ?? 1600, ...(remembered === null ? {} : { memoryLabels: [...speakers.values()] }) });
      if (output.kind === 'silent') { await admission.settle(request, 'silent'); await remember(request, speakers, output, remembered); return { state: 'silent', stage }; }
      stage = 'DELIVER';
      if (!await dependenciesCurrent(request, sources, history, saved, remembered) || !await admission.beginDelivery(request)) {
        await admission.settle(request, clock() >= request.deadline ? 'expired' : 'cancelled');
        return { state: clock() >= request.deadline ? 'expired' : 'cancelled', stage };
      }
      // Deadline is propagated through the actual Discord request; no late-send queue or fallback destination.
      requireCondition(clock() < request.deadline, 'AI_DEADLINE_EXPIRED'); attempted = true;
      effect = output.kind === 'reply'
        ? await messages.reply(request, renderAiReply(output, sources, { replyChars: request.context?.replyChars ?? 1600 }), dependencies, sources)
        : await messages.react(request, request.config.emojis.find(emoji => emoji.key === output.emojiKey), dependencies, sources);
      // A sent reply stays. It is withdrawn only by an explicit event (opt-out, departure, source edit or delete), which
      // marks its effect for cleanup even while this turn is still settling.
      const state = output.kind === 'reply' ? 'delivered' : 'reacted';
      try { await admission.settle(request, state, effect.id); } catch { /* The effect receipt already records the delivery. */ }
      await remember(request, speakers, output, remembered);
      try {
        if (output.kind === 'reply') context.rememberReply(request, { id: effect.id, text: output.text }, dependencies, sources);
      } catch { /* Omit context if bounded retention is unavailable. */ }
      return { state, stage };
    } catch (error) {
      const reason = error?.code ?? error?.message;
      const state = attempted ? 'uncertain' : clock() >= request.deadline ? 'expired' : 'unavailable';
      await admission.settle(request, state, effect?.id ?? null).catch(() => {}); return { state, stage, reason };
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
      const version = generation;
      let request = await admission.admit(proof); if (!request) return { state: 'ignored' };
      report(request, 'admitted', request.decision.infer ? 'INFER' : 'CONTEXT');
      if (stopped) { await admission.settle(request, 'cancelled'); return { state: 'disabled' }; }
      if (version !== generation) { await admission.settle(request, 'cancelled'); return { state: 'cancelled' }; }
      context.remember(request);
      if (!request.decision.infer) return { state: 'context' };
      const first = request; request = await gather(request);
      if (request === 'joined') return { state:'gathered' };
      if (!request || stopped) { await admission.settle(first,'cancelled'); return { state:'cancelled' }; }
      if (outstanding.size >= 4) { await admission.settle(request, 'unavailable'); return { state: 'busy' }; }
      const task = run(request); outstanding.set(request.messageId, { request, task });
      try { return await task; } finally { outstanding.delete(request.messageId); }
    },
    /**
     * A change to one channel (moved, re-permissioned, deleted) stops the turns running there, so a channel that became
     * restricted or a case channel does not keep a provider call going; the pre-delivery check would refuse the reply
     * anyway. Other channels, context and delivered replies are untouched.
     */
    cancelChannel(channelId) {
      for (const [id, { request }] of outstanding) if (request.channelId === channelId) scheduler.cancel(id);
      for (const entry of [...gatherings.values()]) if ([...entry.fragments.values()].some(item => item.channelId === channelId)) { entry.cancelled = true; finishGather(entry); }
    },
    /** True while any message is gathering or running; background rechecks yield Discord capacity to it. */
    active: () => outstanding.size > 0 || gatherings.size > 0,
    invalidate(filter = {}) {
      invalidateContext(filter);
      if (!targeted(filter)) return;
      for (const entry of [...gatherings.values()]) if ([...entry.fragments.values()].some(item=>(!filter.channelId || item.channelId===filter.channelId) &&
        (!filter.userId || item.userId===filter.userId) && (!filter.messageId || item.messageId===filter.messageId))) { entry.cancelled=true; finishGather(entry); }
    },
    async stop() {
      stopped = true; for (const entry of [...gatherings.values()]) { entry.cancelled=true; finishGather(entry); }
      scheduler.disable(); context.clear(); await Promise.all([...outstanding.values()].map(value => value.task));
    },
  });
}
