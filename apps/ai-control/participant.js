import { performance } from 'node:perf_hooks';
import { requireCondition } from '../../contracts/validation.js';
import { canonicalAiWorkerIdentity } from '../knowledge-worker/ipc-contract.js';
import { createAiWorkerQualification } from '../knowledge-worker/windows-pipe.js';

/** A role owns one boot listener. Its acknowledgement expires locally as well as at the supervisor. */
export function createAiControlParticipant({client,role,identity,operationId,qualified,revocationSignal,createChannel,onFault,
  monotonic=()=>performance.now()}) {
  const fixed=canonicalAiWorkerIdentity(identity),lifetime=new AbortController();
  requireCondition(['core','egress'].includes(role) && typeof client?.request==='function' && client.signal instanceof AbortSignal &&
    revocationSignal instanceof AbortSignal && typeof createChannel==='function' && typeof onFault==='function','AI_CONTROL_CONFIGURATION_INVALID');
  const signal=AbortSignal.any([lifetime.signal,client.signal,revocationSignal]),qualification=createAiWorkerQualification({identity:fixed,qualified});
  let channel=null,key=null,starting=null,pending=null,closing=null,timer=null,expiry=null,until=0,phase='idle';
  const matches=value=>value.operationId===operationId && Object.entries(fixed).every(([name,item])=>value.identity?.[name]===item);
  const current=()=>!signal.aborted && (until===0 || monotonic()<until);
  const fail=()=>{try{onFault('AI_WORKER_READINESS_LOST');}catch{}void stop().catch(()=>{});};
  async function heartbeat() {
    requireCondition(current() && channel?.status().phase==='listening' && await qualification.current(signal) && current(),'AI_WORKER_READINESS_LOST');
    const issued=monotonic(),result=await client.request('ready',{identity:fixed,operationId},{signal});
    requireCondition(matches(result) && current() && monotonic()<issued+3000 && channel.status().phase==='listening','AI_WORKER_READINESS_LOST');
    until=issued+3000;clearTimeout(expiry);expiry=setTimeout(fail,Math.max(1,until-monotonic()));
  }
  function schedule() {
    timer=setTimeout(()=>{pending=heartbeat().then(()=>{if(current())schedule();else fail();}).catch(fail).finally(()=>{pending=null;});},500);
  }
  function stop() {
    if(closing)return closing;phase='stopped';signal.removeEventListener('abort',revoke);lifetime.abort();qualification.stop();clearTimeout(timer);clearTimeout(expiry);
    closing=(async()=>{await starting?.catch(()=>{});await pending;try{await channel?.stop();}finally{key?.fill(0);}})();return closing;
  }
  const revoke=()=>{void stop().catch(()=>{});};signal.addEventListener('abort',revoke,{once:true});if(signal.aborted)revoke();
  return Object.freeze({signal,
    start(){
      requireCondition(phase==='idle' && !signal.aborted,'AI_CONTROL_UNAVAILABLE');phase='starting';
      starting=(async()=>{try{
        requireCondition(await qualification.current(signal) && current(),'AI_WORKER_NOT_QUALIFIED');
        const grant=await client.request('channel',{identity:fixed,operationId},{signal});
        requireCondition(matches(grant) && grant.purpose===(role==='core'?'inference':'egress') && current(),'AI_CONTROL_INVALID');
        key=Buffer.from(grant.key,'hex');channel=createChannel({identity:fixed,key,revocationSignal:signal,
          qualified:async()=>current() && await qualification.current(signal) && current()});
        requireCondition(['start','stop','status'].every(name=>typeof channel?.[name]==='function'),'AI_CONTROL_CONFIGURATION_INVALID');
        await channel.start();await heartbeat();requireCondition(current(),'AI_WORKER_READINESS_LOST');phase='ready';schedule();return channel;
      }catch{fail();throw Error('AI_WORKER_READINESS_LOST');}})();return starting;
    },
    channel:()=>phase==='ready' && current()?channel:null,
    status:()=>({phase,current:phase==='ready' && current()}),stop,
  });
}
