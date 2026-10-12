import { requireCondition } from '../../contracts/validation.js';
import { canonicalAiWorkerIdentity } from './ipc-contract.js';

/** A stalled qualification service must neither hold prompt closures indefinitely nor accumulate unbounded checks. */
export function createAiWorkerQualification({identity,qualified}) {
  const fixed=canonicalAiWorkerIdentity(identity), stopped=new AbortController(); let pending=0;
  requireCondition(typeof qualified === 'function','TRUSTED_ADAPTERS_REQUIRED');
  return Object.freeze({
    async current(signal) {
      if(stopped.signal.aborted || signal?.aborted || pending>=4)return false;
      pending++;
      const timeout=new AbortController(), combined=AbortSignal.any([stopped.signal,timeout.signal,...(signal?[signal]:[])]);
      const timer=setTimeout(()=>timeout.abort(),2000);let abort;
      const denied=new Promise(resolve=>{abort=()=>resolve(false);combined.addEventListener('abort',abort,{once:true});if(combined.aborted)abort();});
      // The pending count follows the underlying check, even when cancellation wins the race.
      const check=Promise.resolve().then(()=>qualified(fixed,{signal:combined})).then(value=>value===true,()=>false).finally(()=>pending--);
      try {return await Promise.race([denied,check]) && !combined.aborted;}
      finally {clearTimeout(timer);combined.removeEventListener('abort',abort);}
    },
    stop() {stopped.abort();},
  });
}
