import { requireCondition,requireInteger } from '../../contracts/validation.js';

/** A separately qualified knowledge identity refreshes only the owner-selected collection. Never publishes. */
export function createKnowledgeSynchronizer({library,qualified,intervalMs=120000,onFault=()=>{},setTimer=setTimeout,clearTimer=clearTimeout}) {
  requireCondition(typeof library.synchronizePolicies==='function' && typeof qualified==='function','TRUSTED_ADAPTERS_REQUIRED');
  requireInteger(intervalMs,60000,240000);
  let started=false,stopped=false,timer=null,pending=Promise.resolve(),controller=null;
  function tick() {
    if(stopped)return;
    controller=new AbortController();
    pending=Promise.resolve().then(async()=>{
      requireCondition(await qualified()===true && !controller.signal.aborted,'KNOWLEDGE_SYNC_UNQUALIFIED');
      const result=await library.synchronizePolicies({signal:controller.signal});
      requireCondition(result?.publishedAutomatically===false,'KNOWLEDGE_SYNC_INVALID');
    }).catch(()=>{try{onFault('KNOWLEDGE_SYNC_UNAVAILABLE');}catch{}}).finally(()=>{
      controller=null;if(!stopped){timer=setTimer(tick,intervalMs);timer.unref?.();}
    });
  }
  return Object.freeze({
    start(){requireCondition(!started && !stopped,'KNOWLEDGE_SYNC_STARTED');started=true;tick();},
    async stop(){stopped=true;clearTimer(timer);controller?.abort();await pending;},
    status:()=>({started,stopped,refreshing:controller!==null,publishesAutomatically:false}),
  });
}
