import { requireCondition } from '../../contracts/validation.js';
import { registeredAiContainer } from './container-profile.js';
import { revokeAiWorkerBootFiles } from './bootstrap.js';

async function approved(beforeStart,signal) {
  const abort=new AbortController(),combined=AbortSignal.any([signal,abort.signal]);let cancel;
  const timer=setTimeout(()=>abort.abort(),2000);
  try {
    const cancelled=new Promise(resolve=>{cancel=()=>resolve(false);combined.addEventListener('abort',cancel,{once:true});if(combined.aborted)cancel();});
    const check=Promise.resolve().then(()=>combined.aborted?false:beforeStart({signal:combined})).catch(()=>false);
    return await Promise.race([check,cancelled])===true && !combined.aborted;
  } finally {clearTimeout(timer);combined.removeEventListener('abort',cancel);}
}

/** Persist intent before Docker mutation. This owner has no core, Discord or egress-bridge implementation. */
export function createAiSupervisorSlot({registration,journal,docker}) {
  const registered=registeredAiContainer(registration);
  requireCondition(journal?.signal instanceof AbortSignal && ['snapshot','status','begin','creating','created','starting','running','removing','observeRemoval','removed','close']
    .every(name=>typeof journal[name]==='function') && ['inspect','knownContainer','create','start','remove','qualified','close'].every(name=>typeof docker?.[name]==='function'),
  'AI_SUPERVISOR_CONFIGURATION_INVALID');
  let recovered=false,operation=null,stopping=null,closing=null,closed=false;
  function execute(signal,work) {
    requireCondition(recovered && !closed && !operation && !stopping && !journal.signal.aborted && journal.status().available,'AI_SUPERVISOR_NOT_READY');
    requireCondition(signal===undefined || signal instanceof AbortSignal,'AI_SUPERVISOR_OPERATION_INVALID');
    const abort=new AbortController(),combined=AbortSignal.any([abort.signal,journal.signal,...(signal?[signal]:[])]);
    const current=()=>requireCondition(!combined.aborted && !closed,'AI_SUPERVISOR_OPERATION_CANCELLED');
    current();const active={abort,task:null};operation=active;
    active.task=(async()=>{try{return await work(combined,current);}finally{operation=null;}})();return active.task;
  }
  async function remove(signal) {
    let state=journal.snapshot(),cleanupError=null,journalError=journal.status().available?null:Error('AI_SUPERVISOR_JOURNAL_UNAVAILABLE');
    async function update(action){try{state=await action();}catch(error){
      if(error.message!=='AI_SUPERVISOR_JOURNAL_UNAVAILABLE')throw error;journalError=error;
    }}
    if(state.phase!=='empty' && state.phase!=='removing')await update(()=>journal.removing({revision:state.revision}));
    if(state.identity){try{await revokeAiWorkerBootFiles({registration:registered,identity:state.identity});}catch(error){cleanupError=error;}}
    const found=await docker.inspect({signal})??docker.knownContainer();
    if(found){
      requireCondition(state.phase==='empty' || (state.operationId===found.operationId && state.imageId===found.imageId &&
        Object.entries(state.identity).every(([key,value])=>found.identity[key]===value) && (state.containerId===null || state.containerId===found.id)),
      'AI_SUPERVISOR_OBSERVATION_MISMATCH');
      await update(()=>journal.observeRemoval({revision:state.revision,container:found}));
      // A failed journal must prevent a new launch, not prevent stopping an already identified owned worker.
      if(journalError)state={...state,phase:'removing',identity:found.identity,operationId:found.operationId,imageId:found.imageId,containerId:found.id,createPending:false};
      try{await revokeAiWorkerBootFiles({registration:registered,identity:state.identity});}catch(error){cleanupError=error;}
    }
    // Keep an unacknowledged create durable until its exact container can be identified.
    requireCondition(!state.createPending || state.containerId!==null,'AI_SUPERVISOR_CREATE_UNRESOLVED');
    const recovery=state.identity?{identity:state.identity,operationId:state.operationId,imageId:state.imageId,id:state.containerId,createPending:state.createPending}:null;
    const receipt=await docker.remove({signal,recovery});
    if(cleanupError)throw cleanupError;
    if(journalError)throw journalError;
    if(state.phase!=='empty')state=await journal.removed({revision:state.revision,receipt});
    requireCondition(state.phase==='empty' && receipt.removed===true,'AI_SUPERVISOR_REMOVAL_UNCONFIRMED');
    recovered=!closed;return {revision:state.revision,...receipt};
  }
  function quiesce({signal}={}) {
    requireCondition(!closed,'AI_SUPERVISOR_CLOSED');
    if(stopping)return stopping;recovered=false;operation?.abort.abort();
    stopping=(async()=>{await operation?.task.catch(()=>{});return await remove(signal);})().finally(()=>{stopping=null;});return stopping;
  }
  return Object.freeze({
    status:()=>({recovered,closed,busy:operation!==null,stopping:stopping!==null,journal:journal.snapshot()}),
    quiesce,
    qualified:({signal}={})=>execute(signal,(combined)=>docker.qualified({signal:combined})),
    prepare({revision,identity,operationId,signal}) {
      return execute(signal,async(_combined,current)=>{current();const state=await journal.begin({revision,identity,operationId});current();return state;});
    },
    create({revision,signal}) {
      return execute(signal,async(combined,current)=>{
        const state=await journal.creating({revision});current();
        const result=await docker.create({identity:state.identity,operationId:state.operationId,signal:combined});
        const created=await journal.created({revision:state.revision,containerId:result.id});current();return created;
      });
    },
    start({revision,signal,beforeStart}) {
      requireCondition(typeof beforeStart==='function','AI_SUPERVISOR_START_NOT_APPROVED');
      return execute(signal,async(combined,current)=>{
        requireCondition(await approved(beforeStart,combined),'AI_SUPERVISOR_START_NOT_APPROVED');current();
        const state=await journal.starting({revision});current();
        await docker.start({id:state.containerId,signal:combined});
        const running=await journal.running({revision:state.revision});current();return running;
      });
    },
    close(){
      if(closing)return closing;
      const stopped=quiesce();closed=true;recovered=false;
      closing=(async()=>{try{await stopped;}finally{try{await docker.close();}finally{await journal.close();}}})();return closing;
    },
  });
}
