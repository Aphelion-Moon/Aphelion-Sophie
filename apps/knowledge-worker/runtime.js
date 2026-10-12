import { requireCondition } from '../../contracts/validation.js';
import { createMistralClient } from './mistral-client.js';
import { createMistralTransport } from './http-transport.js';
import { createAiIpcWorker } from './ipc-server.js';
import { canonicalAiWorkerIdentity } from './ipc-contract.js';
import { createAiWorkerQualification } from './qualification.js';
import { createAiInferenceDialer } from './inference-dialer.js';

/** Runs under the independently provisioned worker identity. No core token, database or service manager access. */
export function createAiWorkerRuntime({ identity, key, apiKey, acceptedFingerprints, qualified, revocationSignal, clock = Date.now,
  transport = createMistralTransport(), connections = 2, onFault = ()=>{}, connectPipe }) {
  const fixed = canonicalAiWorkerIdentity(identity);
  requireCondition(typeof qualified === 'function' && revocationSignal instanceof AbortSignal && typeof onFault==='function', 'TRUSTED_ADAPTERS_REQUIRED');
  const client = createMistralClient({apiKey,acceptedFingerprints,fetchImpl:transport.fetch,clock});
  requireCondition(client.profileHash === fixed.profileHash,'AI_IPC_ADAPTER_INVALID');
  let stopped = false, closing = null; const lifetime=new AbortController();
  const qualification=createAiWorkerQualification({identity:fixed,qualified});
  const current = async signal => !stopped && !revocationSignal.aborted && await qualification.current(signal) && !stopped && !revocationSignal.aborted;
  const ready=(_identity,context)=>current(context.signal);
  const worker = createAiIpcWorker({identity:fixed,key,clock,qualified:ready,adapter:{provider:client.provider,profileHash:client.profileHash,
    async prepare(payload) { requireCondition(await current(),'AI_WORKER_NOT_QUALIFIED'); return client.prepare(payload); },
    async generatePrepared(prepared,context) {
      const signal=AbortSignal.any([context.signal,revocationSignal,lifetime.signal]);
      requireCondition(await current(signal),'AI_WORKER_NOT_QUALIFIED');
      const result=await client.generatePrepared(prepared,{...context,signal,beforeDispatch:async()=>await current(signal) && await context.beforeDispatch()});
      requireCondition(await current(signal) && !signal.aborted,'AI_WORKER_NOT_QUALIFIED'); return result;
    },
  }});
  const listener = createAiInferenceDialer({identity:fixed,key,worker,qualified:ready,connections,...(connectPipe?{connectPipe}:{}),onFault:code=>{
    try{onFault(code);}finally{void stop().catch(()=>{});}
  }});
  function stop() {
    if (closing) return closing;
    stopped = true; revocationSignal.removeEventListener('abort',revoke); lifetime.abort(); qualification.stop();
    const closed = listener.stop(), networkClosed = transport.stop();
    closing = Promise.all([closed,networkClosed,worker.stop()]).then(()=>{}); return closing;
  }
  const revoke=()=>{void stop().catch(()=>{});};
  revocationSignal.addEventListener('abort',revoke,{once:true});if(revocationSignal.aborted)revoke();
  return Object.freeze({
    start:listener.start,
    status() { return {identity:fixed,listener:listener.status(),worker:worker.status(),provider:client.status(),transport:transport.status(),stopped}; },
    stop,
  });
}
