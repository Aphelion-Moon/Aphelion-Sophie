import { requireCondition } from '../../../contracts/validation.js';

/** Trusted accounting coordinator. Only the worker owns provider credentials and serialized request bytes. */
export function createMeteredAiWorker({ worker, accounting }) {
  requireCondition(typeof worker.prepare === 'function' && typeof worker.generatePrepared === 'function' &&
    typeof worker.current === 'function', 'AI_METERED_WORKER_REQUIRED');
  return Object.freeze({
    async generate(payload, context) {
      requireCondition(payload.local && typeof context.beforeDispatch === 'function', 'AI_CURRENT_AUTHORITY_REQUIRED');
      const current = async () => !context.signal.aborted && await worker.current(payload) === true && await context.beforeDispatch() === true;
      requireCondition(await current(), 'AI_DISPATCH_REVOKED');
      const prepared = await worker.prepare(payload);
      requireCondition(await current(), 'AI_DISPATCH_REVOKED');
      if (prepared.bytes === 0) return { kind: 'silent' };
      const token = await accounting.reserve({ local: payload.local, bytes: prepared.bytes, outputTokens: prepared.outputTokens, deadline: context.deadline });
      requireCondition(token !== null, 'AI_BUDGET_UNAVAILABLE');
      let dispatchPossible = false;
      try {
        return await worker.generatePrepared(prepared, { ...context, beforeDispatch: current,
          recordDispatch: async () => { dispatchPossible = true; const dispatched = await accounting.dispatch(token);
            if (!dispatched) dispatchPossible = false; return dispatched; },
          recordResponse: async observation => { requireCondition(await accounting.settle(token, observation.usage, observation), 'AI_ACCOUNTING_UNRESOLVED'); },
          recordUndispatched: async () => { dispatchPossible = false; },
        });
      } finally { await accounting.finish(token, dispatchPossible); }
    },
  });
}
