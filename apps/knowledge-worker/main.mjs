import { loadAiWorkerBootstrap, createAiWorkerLease } from './bootstrap.js';
import { createDeepSeekPipeConnector } from './egress-client.js';
import { createDeepSeekTransport } from './http-transport.js';
import { createAiWorkerRuntime } from './runtime.js';

// Fixed container entrypoint. No CLI-selected files, direct networking, core credentials or shell tools.
let boot,lease,worker,closing,startup,stopping=false;
async function stop(code=0) {
  if(stopping)return closing;
  stopping=true;
  process.exitCode=code;
  const forced=setTimeout(()=>process.exit(1),3000);forced.unref();
  closing=(async()=>{
    lease?.stop();await worker?.stop();await startup?.catch(()=>{});
    lease?.stop();await worker?.stop();
    for(const name of ['ipcKey','egressKey','leaseKey'])boot?.[name]?.fill(0);
    clearTimeout(forced);
  })();return closing;
}
process.once('SIGINT',()=>{void stop();});process.once('SIGTERM',()=>{void stop();});
async function start() {
  boot=await loadAiWorkerBootstrap();
  if(stopping)throw Error('AI_WORKER_UNAVAILABLE');
  lease=createAiWorkerLease({identity:boot.identity,qualificationHash:boot.qualificationHash,key:boot.leaseKey});await lease.start();
  if(stopping)throw Error('AI_WORKER_UNAVAILABLE');
  const connector=createDeepSeekPipeConnector({identity:boot.identity,key:boot.egressKey,revocationSignal:lease.signal});
  worker=createAiWorkerRuntime({identity:boot.identity,key:boot.ipcKey,apiKey:boot.apiKey,acceptedFingerprints:boot.acceptedFingerprints,
    qualified:lease.current,revocationSignal:lease.signal,transport:createDeepSeekTransport({connector}),connectionMode:'dial-host',
    onFault:()=>{void stop(1);}});
  lease.signal.addEventListener('abort',()=>{void stop(1);},{once:true});
  if(lease.signal.aborted)throw Error('AI_WORKER_UNAVAILABLE');
  await worker.start();if(stopping)throw Error('AI_WORKER_UNAVAILABLE');process.stdout.write('AI_WORKER_READY\n');
}
startup=start();
try {await startup;}catch {process.stderr.write('AI_WORKER_UNAVAILABLE\n');await stop(1);}
