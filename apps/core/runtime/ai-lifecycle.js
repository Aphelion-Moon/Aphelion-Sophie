import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { requireCondition } from '../../../contracts/validation.js';
import { canonicalAiWorkerRelease } from '../../../modules/assistant/worker-release.js';
import { canonicalAiWorkerIdentity } from '../../knowledge-worker/ipc-contract.js';
import { createAiControlQualification } from '../../ai-control/qualification.js';
import { createAiControlParticipant } from '../../ai-control/participant.js';
import { createAiReversePipeClient } from './ai-reverse-pipe.js';

/** Core uses bounded authenticated intents; only the supervisor identity can call Docker or publish boot files. */
export function createAiWindowsLifecycle({client,release,qualified,revocationSignal,onFault,createPipeServer}) {
  const fixed=canonicalAiWorkerRelease(release);
  requireCondition(client?.signal instanceof AbortSignal && typeof client.request==='function' && typeof client.stop==='function' &&
    revocationSignal instanceof AbortSignal && typeof onFault==='function','AI_CONTROL_CONFIGURATION_INVALID');
  const qualification=createAiControlQualification(qualified),startChecks=createAiControlQualification(({check},{signal})=>check({signal}));
  let active=null,stopping=null,closing=null,closed=false;
  const fault=()=>{try{onFault('AI_WORKER_LIFECYCLE_UNAVAILABLE');}catch{}};
  const selected=value=>Object.entries(fixed).every(([key,item])=>value?.[key]===item);
  const qualifiedRelease=async value=>!closed && !client.signal.aborted && !revocationSignal.aborted && selected(value) &&
    await qualification.current(fixed,AbortSignal.any([client.signal,revocationSignal]));
  async function waitFor(check,signal){
    for(;;){requireCondition(!signal.aborted,'AI_WORKER_LIFECYCLE_UNAVAILABLE');const state=await client.request('inspect',{}, {signal});
      if(check(state))return state;await delay(100,undefined,{signal});}
  }
  async function job(command,body,signal){
    const accepted=await client.request(command,body,{signal});
    requireCondition(accepted.job.operationId===body.operationId && accepted.job.revision===body.revision,'AI_CONTROL_INVALID');
    const state=await waitFor(value=>{
      requireCondition(value.job?.id===accepted.job.id,'AI_CONTROL_STALE');return value.job.state!=='running';
    },signal);requireCondition(state.job.state==='complete','AI_WORKER_OPERATION_FAILED');return state;
  }
  function quiesce({operationId}) {
    if(!stopping){
      const previous=active;active=null;previous?.abort.abort();
      stopping=(async()=>{
        await previous?.task.catch(()=>{});await previous?.participant?.stop();
        const signal=AbortSignal.any([client.signal,AbortSignal.timeout(15000)]);
        for(let attempt=0;attempt<4;attempt++){
          const state=await client.request('inspect',{}, {signal});
          try {
            const result=await job('quiesce',{revision:state.revision,operationId},signal);
            requireCondition(result.phase==='empty' && result.recovered,'AI_WORKER_STOP_UNCONFIRMED');return;
          }catch(error){if(!['AI_CONTROL_BUSY','AI_CONTROL_STALE'].includes(error.message) || attempt===3)throw error;await delay(100,undefined,{signal});}
        }
      })().finally(()=>{stopping=null;});
    }
    return stopping.then(()=>({operationId,stopped:true}));
  }
  function stop(){
    if(closing)return closing;closed=true;revocationSignal.removeEventListener('abort',revoke);qualification.stop();startChecks.stop();
    closing=(async()=>{try{await quiesce({operationId:randomUUID()});}finally{await client.stop();}})();return closing;
  }
  const revoke=()=>{void stop().catch(fault);};revocationSignal.addEventListener('abort',revoke,{once:true});if(revocationSignal.aborted)revoke();
  return Object.freeze({releases:[fixed],qualified:qualifiedRelease,quiesce,stop,
    launch({identity,operationId,signal,beforeStart}) {
      requireCondition(!closed && !active && !stopping && signal instanceof AbortSignal && typeof beforeStart==='function','AI_WORKER_LIFECYCLE_UNAVAILABLE');
      const peer=canonicalAiWorkerIdentity(identity);
      requireCondition(['workerId','releaseHash','profileHash','provider','domain'].every(name=>peer[name]===fixed[name]),'AI_WORKER_NOT_QUALIFIED');
      const entry={abort:new AbortController(),participant:null,task:null};active=entry;
      const combined=AbortSignal.any([signal,entry.abort.signal,client.signal,revocationSignal]),launchSignal=AbortSignal.any([combined,AbortSignal.timeout(30000)]);
      entry.task=(async()=>{try{
        requireCondition(await qualifiedRelease(fixed),'AI_WORKER_NOT_QUALIFIED');
        const initial=await client.request('inspect',{}, {signal:launchSignal});
        requireCondition(initial.phase==='empty' && initial.recovered,'AI_WORKER_STOP_UNCONFIRMED');
        await job('prepare',{revision:initial.revision,identity:peer,operationId},launchSignal);
        entry.participant=createAiControlParticipant({client,role:'core',identity:peer,operationId,revocationSignal:combined,
          qualified:()=>qualifiedRelease(fixed),onFault:fault,createChannel:options=>{
            const channel=createAiReversePipeClient({...options,createPipeServer});return Object.freeze({...channel,status:channel.inboxStatus});
          }});
        await entry.participant.start();
        const ready=await waitFor(state=>{
          requireCondition(state.identity?.bootId===peer.bootId && state.operationId===operationId && state.phase==='prepared','AI_CONTROL_STALE');
          return state.readiness.core && state.readiness.egress;
        },launchSignal);
        const created=await job('create',{revision:ready.revision,operationId},launchSignal);
        requireCondition(await startChecks.current({check:beforeStart},launchSignal) && await qualifiedRelease(fixed) && !launchSignal.aborted,'AI_WORKER_START_NOT_APPROVED');
        const running=await job('start',{revision:created.revision,operationId},launchSignal);
        requireCondition(running.phase==='running' && active===entry && !launchSignal.aborted && entry.participant.status().current,'AI_WORKER_LIFECYCLE_UNAVAILABLE');
        const worker=entry.participant.channel();return Object.freeze({...worker,stop:()=>entry.participant.stop()});
      }catch(error){entry.abort.abort();await entry.participant?.stop();throw error;}})();return entry.task;
    },
  });
}
