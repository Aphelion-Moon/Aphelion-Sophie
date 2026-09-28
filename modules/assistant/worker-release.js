import { requireCondition, requireKeys } from '../../contracts/validation.js';

/** Installed releases are operator-owned bounded data, never browser-supplied commands or paths. */
export function canonicalAiWorkerRelease(value) {
  requireKeys(value,['name','workerId','releaseHash','profileHash','evidenceHash','provider','domain'],'AI_WORKER_RELEASE_INVALID');
  requireCondition(typeof value.name === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9 ._-]{0,63}$/u.test(value.name) &&
    ['workerId','releaseHash','profileHash','evidenceHash'].every(key=>typeof value[key] === 'string' && /^[a-f0-9]{64}$/u.test(value[key])) &&
    value.provider === 'deepseek' && value.domain === 'public','AI_WORKER_RELEASE_INVALID');
  return Object.freeze(Object.fromEntries(['name','workerId','releaseHash','profileHash','evidenceHash','provider','domain'].map(key=>[key,value[key]])));
}
