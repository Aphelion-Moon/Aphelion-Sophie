import { requireCondition } from '../../contracts/validation.js';

/** The pending count follows the underlying identity/ACL check, even after its caller times out. */
export function createAiControlQualification(qualified) {
  requireCondition(typeof qualified==='function','AI_CONTROL_CONFIGURATION_INVALID');
  const stopped=new AbortController();let pending=0;
  return Object.freeze({
    async current(scope,signal) {
      if(stopped.signal.aborted || signal.aborted || pending>=4)return false;
      pending++;const timeout=new AbortController(),combined=AbortSignal.any([signal,stopped.signal,timeout.signal]);let cancel;
      const timer=setTimeout(()=>timeout.abort(),2000);
      const cancelled=new Promise(resolve=>{cancel=()=>resolve(false);combined.addEventListener('abort',cancel,{once:true});if(combined.aborted)cancel();});
      const check=Promise.resolve().then(()=>qualified(scope,{signal:combined})).then(result=>result===true,()=>false).finally(()=>pending--);
      try{return await Promise.race([check,cancelled]) && !combined.aborted;}
      finally{clearTimeout(timer);combined.removeEventListener('abort',cancel);}
    },
    stop(){stopped.abort();},
  });
}
