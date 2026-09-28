import { performance } from 'node:perf_hooks';
import { requireCondition } from '../../contracts/validation.js';
import { prepareAiWorkerBoot } from './bootstrap.js';
import { registeredAiContainer, registeredAiWorkerIdentity } from './container-profile.js';

/** Owns bootstrap publication and short-lived role readiness around the durable container slot. */
export function createAiSupervisorWorkerSlot({registration,slot,relays,acceptedFingerprints,qualified,revocationSignal,onFault,
  monotonic=()=>performance.now()}) {
  const registered=registeredAiContainer(registration);
  requireCondition((!registration.trustDirectory && relays===undefined) || ['prepare','start','current','quiesce'].every(name=>typeof relays?.[name]==='function'),'AI_RELAY_CONTROLLER_REQUIRED');
  requireCondition(['status','prepare','create','start','quiesce','qualified','close'].every(name=>typeof slot?.[name]==='function') &&
    typeof qualified==='function' && typeof onFault==='function' && revocationSignal instanceof AbortSignal,'AI_SUPERVISOR_CONFIGURATION_INVALID');
  let boot=null,operation=null,stopping=null,closing=null,closed=false;
  const fault=()=>{try{onFault('AI_WORKER_READINESS_LOST');}catch{}void quiesce().catch(()=>{});};
  const matches=(entry,identity,operationId)=>entry && entry.operationId===operationId &&
    Object.entries(entry.identity).every(([key,value])=>identity?.[key]===value);
  const fresh=entry=>!closed && boot===entry && !entry.abort.signal.aborted && !entry.files.signal.aborted &&
    (!entry.established ? monotonic()<entry.deadline : ['core','egress'].every(role=>monotonic()<entry.roles[role].until));
  const rolesReady=entry=>fresh(entry) && ['core','egress'].every(role=>entry.roles[role].issued && monotonic()<entry.roles[role].until);
  const ready=entry=>rolesReady(entry) && (!relays || entry.relaysStarted && relays.current(entry.identity,entry.operationId)===true);
  function current(entry){requireCondition(fresh(entry),'AI_WORKER_READINESS_LOST');}
  function renew(entry) {
    if(entry.renewing)return entry.renewing;
    requireCondition(ready(entry),'AI_WORKER_NOT_READY');
    entry.renewing=entry.files.renew({signal:entry.abort.signal}).finally(()=>{entry.renewing=null;});return entry.renewing;
  }
  function monitor(entry) {
    entry.timer=setTimeout(()=>{
      entry.monitoring=(async()=>{try{
        current(entry);if(entry.relaysStarted)requireCondition(relays.current(entry.identity,entry.operationId)===true,'AI_WORKER_READINESS_LOST');if(ready(entry))await renew(entry);current(entry);monitor(entry);
      }catch{if(boot===entry)fault();}})();
    },500);
  }
  function execute(signal,work) {
    requireCondition(!closed && !revocationSignal.aborted && !stopping && !operation,'AI_SUPERVISOR_NOT_READY');
    requireCondition(signal===undefined || signal instanceof AbortSignal,'AI_SUPERVISOR_OPERATION_INVALID');
    const abort=new AbortController(),combined=AbortSignal.any([abort.signal,revocationSignal,...(signal?[signal]:[])]);
    const check=()=>requireCondition(!closed && !combined.aborted,'AI_SUPERVISOR_OPERATION_CANCELLED');check();
    const active={abort,task:null};operation=active;
    active.task=(async()=>{try{return await work(combined,check);}finally{operation=null;}})();return active.task;
  }
  function quiesce() {
    if(stopping)return stopping;
    const previous=boot;boot=null;operation?.abort.abort();
    if(previous){previous.abort.abort();clearTimeout(previous.timer);previous.files.signal.removeEventListener('abort',fault);}
    // Revoke authority immediately. A publication failure must not suppress physical removal.
    const revoked=previous?.files.revoke();if(revoked)void revoked.catch(()=>{});
    stopping=(async()=>{
      await operation?.task.catch(()=>{});
      const relayStopped=await Promise.allSettled([relays?.quiesce()]);
      // Drain the forwarding boundary first. Even an unconfirmed relay stop
      // must not suppress worker removal, but it must prevent a success receipt.
      const results=await Promise.allSettled([revoked,previous?.monitoring,slot.quiesce()]);
      requireCondition([...relayStopped,...results].every(result=>result.status==='fulfilled'),'AI_SUPERVISOR_STOP_UNCONFIRMED');return results[2].value;
    })().finally(()=>{stopping=null;});return stopping;
  }
  const revoke=()=>{void close().catch(()=>{});};revocationSignal.addEventListener('abort',revoke,{once:true});
  function close(){
    if(closing)return closing;const stopped=quiesce();closed=true;revocationSignal.removeEventListener('abort',revoke);
    closing=(async()=>{try{await stopped;}finally{await slot.close();}})();return closing;
  }
  if(revocationSignal.aborted)revoke();
  return Object.freeze({
    status:()=>({...slot.status(),readiness:Object.fromEntries(['core','egress'].map(role=>[role,Boolean(boot && fresh(boot) && monotonic()<boot.roles[role].until)]))}),
    qualified:slot.qualified,quiesce,close,
    prepare({revision,identity,operationId,signal}) {
      return execute(signal,async(combined,check)=>{
        requireCondition(boot===null,'AI_SUPERVISOR_NOT_READY');const fixed=registeredAiWorkerIdentity(registered,identity);
        const result=await slot.prepare({revision,identity:fixed,operationId,signal:combined});check();
        const entry={identity:fixed,operationId,abort:new AbortController(),roles:{core:{issued:false,until:0},egress:{issued:false,until:0}},
          established:false,deadline:0,files:null,timer:null,renewing:null,monitoring:null,relaysStarted:false};
        const files=await prepareAiWorkerBoot({registration:registered,identity:fixed,acceptedFingerprints,monotonic,
          qualified:async({signal:leaseSignal})=>ready(entry) && await qualified(fixed,{signal:leaseSignal})===true && ready(entry)});
        try {check();entry.files=files;await relays?.prepare({identity:fixed,operationId,signal:AbortSignal.any([entry.abort.signal,combined])});check();entry.deadline=monotonic()+5000;boot=entry;files.signal.addEventListener('abort',fault,{once:true});monitor(entry);return result;}
        catch(error){entry.abort.abort();await Promise.allSettled([files.revoke(),relays?.quiesce()]);throw error;}
      });
    },
    channel({role,identity,operationId}) {
      const entry=boot;requireCondition(['core','egress'].includes(role) && matches(entry,identity,operationId),'AI_CONTROL_STALE');current(entry);
      const purpose=role==='core'?'inference':'egress',grant=entry.files.channel(purpose);entry.roles[role].issued=true;
      try{return {identity:entry.identity,operationId,purpose,key:grant.key.toString('hex')};}finally{grant.key.fill(0);}
    },
    ready({role,identity,operationId}) {
      const entry=boot;requireCondition(['core','egress'].includes(role) && matches(entry,identity,operationId),'AI_CONTROL_STALE');current(entry);
      requireCondition(entry.roles[role].issued,'AI_CONTROL_DENIED');entry.roles[role].until=monotonic()+3000;
      if(rolesReady(entry))entry.established=true;
      return {identity:entry.identity,operationId,ready:true};
    },
    create({revision,signal}) {
      return execute(signal,async(combined,check)=>{const entry=boot;requireCondition(entry && rolesReady(entry),'AI_WORKER_NOT_READY');
        if(relays){await relays.start({identity:entry.identity,operationId:entry.operationId,signal:combined});check();entry.relaysStarted=true;requireCondition(ready(entry),'AI_WORKER_NOT_READY');}
        const result=await slot.create({revision,signal:combined});check();current(entry);return result;});
    },
    start({revision,signal,beforeStart}) {
      requireCondition(typeof beforeStart==='function','AI_SUPERVISOR_START_NOT_APPROVED');
      return execute(signal,async(combined,check)=>{const entry=boot;requireCondition(entry && ready(entry),'AI_WORKER_NOT_READY');
        const result=await slot.start({revision,signal:combined,beforeStart:async({signal:startSignal})=>{
          if(!ready(entry) || await beforeStart({signal:startSignal})!==true || startSignal.aborted || !ready(entry))return false;
          await renew(entry);return ready(entry) && !startSignal.aborted;
        }});check();current(entry);return result;});
    },
  });
}
