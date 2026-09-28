import { requireCondition, requireInteger, requireName } from '../../contracts/validation.js';
import { AI_DEADLINE_MS } from '../../modules/assistant/participation.js';

/** Bounded physical inference with channel fairness. Aborted workers retain their slots until they actually stop. */
export function createAiScheduler({ clock = Date.now, execute, maxWaiting = 3, maxActive = 1, deliveryReserveMs = 1000 }) {
  requireCondition(typeof execute === 'function' && typeof clock === 'function', 'TRUSTED_ADAPTERS_REQUIRED');
  requireInteger(maxWaiting, 0, 3); requireInteger(maxActive, 1, 2); requireInteger(deliveryReserveMs, 100, 3000);
  const queue = [], members = new Set(), requests = new Set(), active = new Map(), served = new Map();
  let disabled = false, explicitStreak = 0, sequence = 0;
  function finish(job, result) {
    if (job.settled) return;
    job.settled = true; clearTimeout(job.timer); job.resolve(result);
  }
  function cancel(job, reason) {
    job.controller.abort(); finish(job, { state: reason });
    const index = queue.indexOf(job);
    if (index !== -1) { queue.splice(index, 1); members.delete(job.member); requests.delete(job.id); job.payload = null;job.beforeExecute=null;job.beforeDispatch=null;job.onPrepared=null; }
  }
  function pump() {
    if (active.size >= maxActive || disabled) return;
    for (const job of [...queue]) if (clock() >= job.cutoff) cancel(job, 'expired');
    if (!queue.length) return;
    const available = queue.filter(job => ![...active.values()].some(item => item.channel === job.channel));
    if (!available.length) return;
    const addressed = available.filter(job => !job.proactive), proactive = available.filter(job => job.proactive);
    const preferred = addressed.length && (explicitStreak < 2 || !proactive.length) ? addressed : proactive;
    const job = preferred.reduce((first,item) => (served.get(item.channel) ?? 0) < (served.get(first.channel) ?? 0) ? item : first);
    queue.splice(queue.indexOf(job), 1); active.set(job.id,job);
    served.delete(job.channel); served.set(job.channel,++sequence);
    if (served.size > 128) served.delete(served.keys().next().value);
    explicitStreak = job.proactive ? 0 : explicitStreak + 1;
    // Do not detach an unfinished worker on abort: overlapping jobs could share its cache or exceed the CPU budget.
    Promise.resolve().then(async () => {
      // Queued inputs can lose consent or source access while another generation runs.
      if (job.beforeExecute !== null && await job.beforeExecute() !== true) { cancel(job, 'cancelled'); return null; }
      if (job.controller.signal.aborted || clock() >= job.cutoff) return null;
      return execute(job.payload, { signal: job.controller.signal, deadline: job.cutoff, beforeDispatch: job.beforeDispatch ?? (async () => true),onPrepared:job.onPrepared });
    }).then(result => {
      if (job.controller.signal.aborted || clock() >= job.cutoff) finish(job, { state: 'expired' });
      else finish(job, { state: 'completed', result });
    }, () => finish(job, { state: clock() >= job.cutoff ? 'expired' : job.controller.signal.aborted ? 'cancelled' : 'unavailable' }))
      .finally(() => { members.delete(job.member); requests.delete(job.id); job.payload = null; job.beforeExecute = null; job.beforeDispatch = null;job.onPrepared=null; active.delete(job.id); pump(); });
    pump();
  }
  return Object.freeze({
    submit({ id, member, channel = member, receivedAt, deadline, proactive, payload, beforeExecute = null, beforeDispatch = null,onPrepared=null }) {
      requireName(id); requireName(member); requireName(channel); requireInteger(receivedAt); requireInteger(deadline);
      requireCondition(typeof proactive === 'boolean' && deadline > receivedAt && deadline - receivedAt <= AI_DEADLINE_MS, 'AI_DEADLINE_INVALID');
      requireCondition(beforeExecute === null || typeof beforeExecute === 'function', 'TRUSTED_ADAPTERS_REQUIRED');
      requireCondition(beforeDispatch === null || typeof beforeDispatch === 'function', 'TRUSTED_ADAPTERS_REQUIRED');
      requireCondition(onPrepared===null || typeof onPrepared==='function','TRUSTED_ADAPTERS_REQUIRED');
      const now = clock(); requireInteger(now);
      if (receivedAt > now || now >= deadline - deliveryReserveMs) return Promise.resolve({ state: 'expired' });
      if (disabled) return Promise.resolve({ state: 'disabled' });
      if (requests.has(id)) return Promise.resolve({ state: 'duplicate' });
      if (members.has(member) || (active.size >= maxActive || [...active.values()].some(item=>item.channel===channel)) && queue.length >= maxWaiting) return Promise.resolve({ state: 'busy' });
      let resolve;
      const result = new Promise(done => { resolve = done; });
      const job = { id, member, channel, proactive, payload, beforeExecute, beforeDispatch,onPrepared, cutoff: deadline - deliveryReserveMs, controller: new AbortController(), resolve, settled: false };
      job.timer = setTimeout(() => cancel(job, 'expired'), Math.max(1, job.cutoff - now));
      queue.push(job); members.add(member); requests.add(id); pump(); return result;
    },
    cancel(id) { const job = active.get(id) ?? queue.find(item => item.id === id); if (job) cancel(job, 'cancelled'); },
    disable() { disabled = true; for (const job of [...queue,...active.values()]) cancel(job, 'disabled'); },
    resume() { requireCondition(active.size === 0, 'AI_WORKER_NOT_STOPPED'); disabled = false; pump(); },
    status() { return { disabled, active: active.size > 0, activeCount: active.size, cancelling: [...active.values()].some(job=>job.controller.signal.aborted), waiting: queue.length }; },
  });
}
