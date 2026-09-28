import { requireCondition } from '../../contracts/validation.js';
import { createDeepSeekPipeConnector } from './egress-client.js';
import { createDeepSeekTransport } from './http-transport.js';
import { createAiWorkerRuntime } from './runtime.js';

export function createInstalledWorker({boot,lease,pipes,onFault,createConnector=createDeepSeekPipeConnector}) {
  const release=pipes?.installation?.configuration?.release;
  requireCondition(pipes?.profile==='installed' && pipes.installation.owner.role==='worker' &&
    ['workerId','releaseHash','profileHash','provider','domain'].every(name=>boot.identity[name]===release?.[name]) &&
    boot.qualificationHash===release.evidenceHash && lease.signal instanceof AbortSignal && pipes.signal instanceof AbortSignal,'AI_WORKER_NOT_QUALIFIED');
  const revocationSignal=AbortSignal.any([lease.signal,pipes.signal]);
  const connector=createConnector({identity:boot.identity,key:boot.egressKey,revocationSignal,connectPipe:pipes.connect});
  return createAiWorkerRuntime({identity:boot.identity,key:boot.ipcKey,apiKey:boot.apiKey,acceptedFingerprints:boot.acceptedFingerprints,
    qualified:lease.current,revocationSignal,transport:createDeepSeekTransport({connector}),connectionMode:'dial-host',connectPipe:pipes.connect,onFault});
}
