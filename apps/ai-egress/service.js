import { requireCondition } from '../../contracts/validation.js';
import { createAiControlParticipant } from '../ai-control/participant.js';
import { createAiEgressBridge } from './runtime.js';

/** Separate unprivileged service. It observes a prepared boot and owns only its fixed-destination bridge. */
export function createAiEgressService({client,qualified,revocationSignal,onFault,createBridge=createAiEgressBridge}) {
  requireCondition(client?.signal instanceof AbortSignal && revocationSignal instanceof AbortSignal &&
    typeof qualified==='function' && typeof onFault==='function' && typeof createBridge==='function','AI_EGRESS_CONFIGURATION_INVALID');
  const lifetime=new AbortController(),signal=AbortSignal.any([lifetime.signal,client.signal,revocationSignal]);
  let participant=null,consumed=null,timer=null,pending=null,starting=null,closing=null,phase='idle';
  const report=()=>{try{onFault('AI_EGRESS_UNAVAILABLE');}catch{}};
  const fault=()=>{report();void stop().catch(()=>{});};
  async function tick() {
    const state=await client.request('inspect',{}, {signal});requireCondition(!signal.aborted,'AI_EGRESS_UNAVAILABLE');
    const wanted=state.identity && ['prepared','creating','created','starting','running'].includes(state.phase) &&
      !(state.job?.command==='prepare' && state.job.state!=='complete');
    if(participant && (!wanted || state.identity.bootId!==consumed)){await participant.stop();participant=null;}
    if(wanted && !participant && state.identity.bootId!==consumed){
      consumed=state.identity.bootId;
      participant=createAiControlParticipant({client,role:'egress',identity:state.identity,operationId:state.operationId,qualified,
        revocationSignal:signal,createChannel:createBridge,onFault:report});
      // A retired or failed boot stays consumed; it must not take down the observer for the next fresh boot.
      try{await participant.start();}catch{report();await participant.stop();}
    }
  }
  function schedule(){timer=setTimeout(()=>{pending=tick().then(()=>{if(!signal.aborted)schedule();}).catch(fault).finally(()=>{pending=null;});},250);}
  function stop(){
    if(closing)return closing;phase='stopped';signal.removeEventListener('abort',revoke);lifetime.abort();clearTimeout(timer);
    closing=(async()=>{await starting?.catch(()=>{});await pending;await participant?.stop();await client.stop();})();return closing;
  }
  const revoke=()=>{void stop().catch(()=>{});};signal.addEventListener('abort',revoke,{once:true});if(signal.aborted)revoke();
  return Object.freeze({signal,
    start(){requireCondition(phase==='idle' && !signal.aborted,'AI_EGRESS_ALREADY_STARTED');phase='starting';
      starting=(async()=>{try{await tick();requireCondition(!signal.aborted,'AI_EGRESS_UNAVAILABLE');phase='listening';schedule();}
        catch{fault();throw Error('AI_EGRESS_UNAVAILABLE');}})();return starting;},
    status:()=>({phase,bootId:participant?consumed:null,ready:participant?.status().current??false}),stop,
  });
}
