import { loadAiWorkerBootstrap, createAiWorkerLease } from './bootstrap.js';
import { createInstalledWorker } from './installed.js';
import { requireCondition } from '../../contracts/validation.js';

// Fixed entrypoint for the dedicated restricted inference service account. No CLI-selected
// files, core credentials or shell tools; the boot/lease files are the only external input.
let boot,lease,worker,closing,startup,stopping=false;
async function stop(code=0) {
  if(stopping)return closing;
  stopping=true;
  process.exitCode=code;
  const forced=setTimeout(()=>process.exit(1),3000);forced.unref();
  closing=(async()=>{
    lease?.stop();await worker?.stop();await startup?.catch(()=>{});
    lease?.stop();await worker?.stop();
    for(const name of ['ipcKey','leaseKey'])boot?.[name]?.fill(0);
    clearTimeout(forced);
  })();return closing;
}
process.once('SIGINT',()=>{void stop();});process.once('SIGTERM',()=>{void stop();});
async function start() {
  requireCondition(process.argv.length===2,'AI_WORKER_ARGUMENTS_INVALID');
  boot=await loadAiWorkerBootstrap();
  if(stopping)throw Error('AI_WORKER_UNAVAILABLE');
  lease=createAiWorkerLease({identity:boot.identity,qualificationHash:boot.qualificationHash,key:boot.leaseKey});await lease.start();
  if(stopping)throw Error('AI_WORKER_UNAVAILABLE');
  worker=createInstalledWorker({boot,lease,onFault:()=>{void stop(1);}});
  lease.signal.addEventListener('abort',()=>{void stop(1);},{once:true});
  if(lease.signal.aborted)throw Error('AI_WORKER_UNAVAILABLE');
  await worker.start();if(stopping)throw Error('AI_WORKER_UNAVAILABLE');process.stdout.write('AI_WORKER_READY\n');
}
startup=start();
try {await startup;}catch {process.stderr.write('AI_WORKER_UNAVAILABLE\n');await stop(1);}
