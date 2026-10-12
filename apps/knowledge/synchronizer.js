import { requireCondition,requireInteger } from '../../contracts/validation.js';

/**
 * A separately qualified knowledge identity refreshes the owner-selected Policies snapshot (never published by itself)
 * and, when given, runs the due public-source collections, which the owner decided publish automatically.
 */
export function createKnowledgeSynchronizer({library,qualified,sources=null,intervalMs=120000,onFault=()=>{},setTimer=setTimeout,clearTimer=clearTimeout}) {
  requireCondition(typeof library.synchronizePolicies==='function' && typeof qualified==='function' && (sources===null || typeof sources.runDue==='function'),'TRUSTED_ADAPTERS_REQUIRED');
  requireInteger(intervalMs,60000,240000);
  let started=false,stopped=false,timer=null,pending=Promise.resolve(),controller=null;
  function tick() {
    if(stopped)return;
    controller=new AbortController();
    const signal=controller.signal;
    pending=Promise.resolve().then(async()=>{
      requireCondition(await qualified()===true && !signal.aborted,'KNOWLEDGE_SYNC_UNQUALIFIED');
      try {
        const result=await library.synchronizePolicies({signal});
        requireCondition(result?.publishedAutomatically===false,'KNOWLEDGE_SYNC_INVALID');
      } finally {
        // The Policies snapshot and the public sources fail independently.
        if(sources!==null && !signal.aborted && await qualified()===true) await sources.runDue({signal});
      }
    }).catch(()=>{try{onFault('KNOWLEDGE_SYNC_UNAVAILABLE');}catch{}}).finally(()=>{
      controller=null;if(!stopped){timer=setTimer(tick,intervalMs);timer.unref?.();}
    });
  }
  return Object.freeze({
    start(){requireCondition(!started && !stopped,'KNOWLEDGE_SYNC_STARTED');started=true;tick();},
    async stop(){stopped=true;clearTimer(timer);controller?.abort();await pending;},
    status:()=>({started,stopped,refreshing:controller!==null,publishesAutomatically:sources!==null}),
  });
}
