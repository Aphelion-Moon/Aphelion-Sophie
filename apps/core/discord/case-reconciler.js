import { requireCondition } from '../../../contracts/validation.js';

/** Core service tick, never a command, dashboard route or generic retry capability. */
export function createCaseReconciler({ store, enabled }) {
  requireCondition(typeof store?.queueCaseInspections === 'function' && typeof enabled === 'function', 'TRUSTED_ADAPTERS_REQUIRED');
  let busy = false;
  return Object.freeze({
    async runOnce() {
      if (busy) return { status: 'busy' };
      busy = true;
      try {
        if (await enabled() !== true) return { status: 'disabled' };
        return await store.queueCaseInspections();
      } finally { busy = false; }
    },
  });
}
