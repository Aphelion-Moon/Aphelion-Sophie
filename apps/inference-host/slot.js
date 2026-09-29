import { readdir, rm } from 'node:fs/promises';
import { win32 } from 'node:path';
import { requireCondition } from '../../contracts/validation.js';
import { registeredAiWorker, registeredAiWorkerIdentity } from './worker-registration.js';
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

/**
 * Durable state for the worker's Windows Service lifecycle. Unlike the old Docker-container
 * journal, there are no recoverable container labels to read back after a crash: the Windows
 * Service Control Manager is itself the durable record of whether the worker is running, and
 * a service found running at startup carries no identity of its own, so recovery always stops
 * it and starts clean rather than trying to resume or identify a prior boot.
 */
export function createAiWorkerSlot({registration,service}) {
  const registered=registeredAiWorker(registration);
  requireCondition(['inspect','create','start','remove','qualified','close'].every(name=>typeof service?.[name]==='function'),
  'AI_SUPERVISOR_CONFIGURATION_INVALID');
  let recovered=false,operation=null,stopping=null,closing=null,closed=false;
  let revision=0,phase='empty',identity=null,operationId=null;
  function snapshot(){return {revision,phase,identity,operationId};}
  function execute(signal,work) {
    requireCondition(recovered && !closed && !operation && !stopping,'AI_SUPERVISOR_NOT_READY');
    requireCondition(signal===undefined || signal instanceof AbortSignal,'AI_SUPERVISOR_OPERATION_INVALID');
    const abort=new AbortController(),combined=AbortSignal.any([abort.signal,...(signal?[signal]:[])]);
    const current=()=>requireCondition(!combined.aborted && !closed,'AI_SUPERVISOR_OPERATION_CANCELLED');
    current();const active={abort,task:null};operation=active;
    active.task=(async()=>{try{return await work(combined,current);}finally{operation=null;}})();return active.task;
  }
  function advance(from,to) {
    requireCondition(from.includes(phase),'AI_SUPERVISOR_PHASE_INVALID');
    phase=to;revision+=1;return snapshot();
  }
  async function cleanupStaleBoots() {
    // Cold-start hygiene only: this process holds no record of a prior boot's identity after
    // a crash, so it cannot selectively revoke one boot directory. It removes every leftover
    // boot/lease pair instead of resuming or trusting any of them, matching the old journal's
    // "recovery is removal-only, never resume a stored start" rule.
    let entries=[];
    try {entries=await readdir(registered.bootRoot,{withFileTypes:true});} catch {return;}
    for (const entry of entries) {
      // The worker requires exactly one boot directory, so an unremovable leftover must fail recovery here.
      await rm(win32.join(registered.bootRoot,entry.name),{recursive:true,force:true});
    }
  }
  async function remove(signal) {
    // Always confirm STOPPED through SCM. A failed inspection must not be mistaken for an absent worker,
    // and the slot stays unrecovered (refusing new boots) until a later quiesce confirms the stop.
    const {removed}=await service.remove({signal});
    requireCondition(removed===true,'AI_SUPERVISOR_STOP_UNCONFIRMED');
    if(identity)await revokeAiWorkerBootFiles({registration:registered,identity}).catch(()=>{});
    await cleanupStaleBoots();
    identity=null;operationId=null;if(phase!=='empty')advance(['prepared','created','running','removing','empty'],'empty');
    recovered=!closed;return snapshot();
  }
  function quiesce({signal}={}) {
    requireCondition(!closed,'AI_SUPERVISOR_CLOSED');
    if(stopping)return stopping;recovered=false;operation?.abort.abort();
    stopping=(async()=>{await operation?.task.catch(()=>{});return await remove(signal);})().finally(()=>{stopping=null;});return stopping;
  }
  return Object.freeze({
    status:()=>({recovered,closed,busy:operation!==null,stopping:stopping!==null,journal:snapshot()}),
    quiesce,
    qualified:({signal}={})=>execute(signal,combined=>service.qualified({signal:combined})),
    prepare({revision:expected,identity:requested,operationId:requestedOperation,signal}) {
      return execute(signal,async(_combined,current)=>{
        current();requireCondition(expected===revision,'AI_SUPERVISOR_REVISION_STALE');
        const fixed=registeredAiWorkerIdentity(registered,requested);
        identity=fixed;operationId=requestedOperation;
        current();return advance(['empty'],'prepared');
      });
    },
    create({revision:expected,signal}) {
      return execute(signal,async(combined,current)=>{
        requireCondition(expected===revision,'AI_SUPERVISOR_REVISION_STALE');
        await service.create({signal:combined});current();
        return advance(['prepared'],'created');
      });
    },
    start({revision:expected,signal,beforeStart}) {
      requireCondition(typeof beforeStart==='function','AI_SUPERVISOR_START_NOT_APPROVED');
      return execute(signal,async(combined,current)=>{
        requireCondition(expected===revision,'AI_SUPERVISOR_REVISION_STALE');
        requireCondition(await approved(beforeStart,combined),'AI_SUPERVISOR_START_NOT_APPROVED');current();
        await service.start({signal:combined});current();
        return advance(['created'],'running');
      });
    },
    close(){
      if(closing)return closing;
      const stopped=quiesce();closed=true;recovered=false;
      closing=(async()=>{try{await stopped;}finally{await service.close();}})();return closing;
    },
  });
}
