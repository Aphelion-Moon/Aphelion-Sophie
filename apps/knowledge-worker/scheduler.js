import { requireCondition, requireInteger, requireName } from '../../contracts/validation.js';
import { AI_DEADLINE_MS } from '../../modules/assistant/participation.js';

/** One physical inference at a time. A timed-out worker retains its slot until it actually stops. */
export function createAiScheduler({ clock = Date.now, execute, maxWaiting = 3, deliveryReserveMs = 1000 }) {
  requireCondition(typeof execute === 'function' && typeof clock === 'function', 'TRUSTED_ADAPTERS_REQUIRED');
  requireInteger(maxWaiting, 0, 3); requireInteger(deliveryReserveMs, 100, 3000);
  const queue = [], members = new Set(), requests = new Set();
  let active = null, disabled = false, lastMember = null, explicitStreak = 0;
  function finish(job, result) {
    if (job.settled) return;
    job.settled = true; clearTimeout(job.timer); job.resolve(result);
  }
  function cancel(job, reason) {
    job.controller.abort(); finish(job, { state: reason });
    const index = queue.indexOf(job);
    if (index !== -1) { queue.splice(index, 1); members.delete(job.member); requests.delete(job.id); job.payload = null; }
  }
  function pump() {
    if (active || disabled) return;
    for (const job of [...queue]) if (clock() >= job.cutoff) cancel(job, 'expired');
    if (!queue.length) return;
    const addressed = queue.filter(job => !job.proactive), proactive = queue.filter(job => job.proactive);
    const preferred = addressed.length && (explicitStreak < 2 || !proactive.length) ? addressed : proactive;
    const job = preferred.find(item => item.member !== lastMember) ?? preferred[0];
    queue.splice(queue.indexOf(job), 1); active = job; lastMember = job.member;
    explicitStreak = job.proactive ? 0 : explicitStreak + 1;
    // Do not detach an unfinished worker on abort: overlapping jobs could share its cache or exceed the CPU budget.
    Promise.resolve().then(async () => {
      // Queued inputs can lose consent or source access while another generation runs.
      if (job.beforeExecute !== null && await job.beforeExecute() !== true) { cancel(job, 'cancelled'); return null; }
      if (job.controller.signal.aborted || clock() >= job.cutoff) return null;
      return execute(job.payload, { signal: job.controller.signal, deadline: job.cutoff, beforeDispatch: job.beforeDispatch ?? (async () => true) });
    }).then(result => {
      if (job.controller.signal.aborted || clock() >= job.cutoff) finish(job, { state: 'expired' });
      else finish(job, { state: 'completed', result });
    }, () => finish(job, { state: clock() >= job.cutoff ? 'expired' : job.controller.signal.aborted ? 'cancelled' : 'unavailable' }))
      .finally(() => { members.delete(job.member); requests.delete(job.id); job.payload = null; job.beforeExecute = null; job.beforeDispatch = null; active = null; pump(); });
  }
  return Object.freeze({
    submit({ id, member, receivedAt, deadline, proactive, payload, beforeExecute = null, beforeDispatch = null }) {
      requireName(id); requireName(member); requireInteger(receivedAt); requireInteger(deadline);
      requireCondition(typeof proactive === 'boolean' && deadline > receivedAt && deadline - receivedAt <= AI_DEADLINE_MS, 'AI_DEADLINE_INVALID');
      requireCondition(beforeExecute === null || typeof beforeExecute === 'function', 'TRUSTED_ADAPTERS_REQUIRED');
      requireCondition(beforeDispatch === null || typeof beforeDispatch === 'function', 'TRUSTED_ADAPTERS_REQUIRED');
      const now = clock(); requireInteger(now);
      if (receivedAt > now || now >= deadline - deliveryReserveMs) return Promise.resolve({ state: 'expired' });
      if (disabled) return Promise.resolve({ state: 'disabled' });
      if (requests.has(id)) return Promise.resolve({ state: 'duplicate' });
      if (members.has(member) || (active !== null && queue.length >= maxWaiting)) return Promise.resolve({ state: 'busy' });
      let resolve;
      const result = new Promise(done => { resolve = done; });
      const job = { id, member, proactive, payload, beforeExecute, beforeDispatch, cutoff: deadline - deliveryReserveMs, controller: new AbortController(), resolve, settled: false };
      job.timer = setTimeout(() => cancel(job, 'expired'), Math.max(1, job.cutoff - now));
      queue.push(job); members.add(member); requests.add(id); pump(); return result;
    },
    cancel(id) { const job = active?.id === id ? active : queue.find(item => item.id === id); if (job) cancel(job, 'cancelled'); },
    disable() { disabled = true; for (const job of [...queue]) cancel(job, 'disabled'); if (active) cancel(active, 'disabled'); },
    resume() { requireCondition(active === null, 'AI_WORKER_NOT_STOPPED'); disabled = false; pump(); },
    status() { return { disabled, active: active !== null, cancelling: active?.controller.signal.aborted === true, waiting: queue.length }; },
  });
}
