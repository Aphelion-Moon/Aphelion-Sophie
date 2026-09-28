import { performance } from 'node:perf_hooks';
import { requireCondition } from '../../contracts/validation.js';
import { canonicalAiWorkerIdentity } from '../knowledge-worker/ipc-contract.js';

const purposes=['inference','egress'];

/** Two fixed native control channels. OS descriptors authenticate their distinct
 * relay owners and the supervisor peer; no application secrets cross this API. */
export function createAiRelayController({pipes,signal,qualified,monotonic=()=>performance.now()}) {
  requireCondition(typeof pipes?.relayControl==='function' && pipes.signal instanceof AbortSignal && signal instanceof AbortSignal &&
    typeof qualified==='function','AI_RELAY_CONTROLLER_REQUIRED');
  const revoked=AbortSignal.any([signal,pipes.signal]);
  const used=new Set();let entry=null,operation=null,closing=null,stopFailure=null;
  const matches=(value,identity,operationId)=>value?.operationId===operationId &&
    Object.entries(value.identity).every(([key,item])=>identity?.[key]===item);
  const live=value=>entry===value && !revoked.aborted && !value.signal.aborted && !value.failed;
  const ready=value=>live(value) && value.started && monotonic()<value.until;
  async function qualify(value,signal=value.signal) {
    const bounded=AbortSignal.any([value.signal,signal,AbortSignal.timeout(1000)]);let cancel;
    try {
      const cancelled=new Promise(resolve=>{cancel=()=>resolve(false);bounded.addEventListener('abort',cancel,{once:true});if(bounded.aborted)cancel();});
      return await Promise.race([Promise.resolve().then(()=>qualified(value.identity,{signal:bounded})),cancelled])===true && !bounded.aborted;
    }finally{bounded.removeEventListener('abort',cancel);}
  }
  async function call(command,value) {
    const results=await Promise.allSettled(purposes.map(async purpose=>{
      if(command==='prepare')value.prepared.add(purpose);
      await pipes.relayControl(command,purpose,command==='prepare'?{bootId:value.identity.bootId,operationId:value.operationId}:undefined);
    }));
    requireCondition(results.every(result=>result.status==='fulfilled'),'AI_RELAY_UNAVAILABLE');
  }
  function schedule(value) {
    value.timer=setTimeout(()=>{
      value.polling=(async()=>{
        try {
          const issued=monotonic();requireCondition(ready(value),'AI_RELAY_UNAVAILABLE');
          requireCondition(await qualify(value) && ready(value),'AI_RELAY_UNQUALIFIED');
          await call('current',value);requireCondition(ready(value) && monotonic()<issued+1500,'AI_RELAY_UNAVAILABLE');
          value.until=issued+1500;schedule(value);
        }catch{value.failed=true;void quiesce().catch(()=>{});}
      })();
    },500);
  }
  function execute(work,reserve=()=>{}) {
    requireCondition(!operation && !closing && !revoked.aborted && !stopFailure,'AI_RELAY_BUSY');
    reserve();
    operation=Promise.resolve().then(work).finally(()=>{operation=null;});return operation;
  }
  function quiesce() {
    if(closing)return closing;
    const previous=entry;entry=null;
    if(previous){clearTimeout(previous.timer);previous.signal.removeEventListener('abort',previous.cancel);previous.failed=true;}
    closing=(async()=>{
      await operation?.catch(()=>{});await previous?.polling;
      if(!previous){if(stopFailure)throw stopFailure;return;}
      const results=await Promise.allSettled([...previous.prepared].map(purpose=>pipes.relayControl('quiesce',purpose)));
      requireCondition(results.every(result=>result.status==='fulfilled'),'AI_RELAY_STOP_UNCONFIRMED');
    })().catch(error=>{stopFailure=error;throw error;}).finally(()=>{closing=null;});return closing;
  }
  const revoke=()=>{void quiesce().catch(()=>{});};revoked.addEventListener('abort',revoke,{once:true});
  return Object.freeze({
    prepare({identity,operationId,signal:bootSignal}) {
      requireCondition(!entry && bootSignal instanceof AbortSignal && !bootSignal.aborted &&
        /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/u.test(operationId),'AI_RELAY_GRANT_INVALID');
      const fixed=canonicalAiWorkerIdentity(identity);
      requireCondition(fixed.bootId!=='0'.repeat(64) && used.size<4096 && !used.has(fixed.bootId),'AI_RELAY_GRANT_REUSED');
      const value={identity:fixed,operationId,signal:AbortSignal.any([bootSignal,revoked]),prepared:new Set(),failed:false,started:false,until:0,timer:null,polling:null,cancel:revoke};
      return execute(async()=>{
        try {
          requireCondition(live(value) && await qualify(value) && live(value),'AI_RELAY_UNQUALIFIED');
          await call('prepare',value);requireCondition(live(value),'AI_RELAY_UNAVAILABLE');
        }catch(error){value.failed=true;throw error;}
      },()=>{used.add(fixed.bootId);entry=value;value.signal.addEventListener('abort',value.cancel,{once:true});})
        .catch(async error=>{await quiesce();throw error;});
    },
    start({identity,operationId,signal:startSignal}) {
      return execute(async()=>{
        const value=entry;requireCondition(matches(value,identity,operationId) && live(value) && !value.started &&
          startSignal instanceof AbortSignal && !startSignal.aborted,'AI_RELAY_GRANT_INVALID');
        const issued=monotonic();
        try {
          requireCondition(await qualify(value,startSignal) && live(value) && !startSignal.aborted,'AI_RELAY_UNQUALIFIED');
          await call('start',value);requireCondition(live(value) && !startSignal.aborted && monotonic()<issued+1500,'AI_RELAY_UNAVAILABLE');
          value.started=true;value.until=issued+1500;schedule(value);
        }catch(error){value.failed=true;throw error;}
      }).catch(async error=>{await quiesce();throw error;});
    },
    current:(identity,operationId)=>matches(entry,identity,operationId) && ready(entry),
    quiesce,
  });
}
