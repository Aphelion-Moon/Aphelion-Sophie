import { loadAiWorkerBootstrap, createAiWorkerLease, readAiWorkerFile, AI_WORKER_FILES } from './bootstrap.js';
import { createInstalledWorker } from './installed.js';
import { createInstalledWindowsPipeTransport } from '../windows-pipe/transport.js';
import { installationHash } from '../windows-pipe/installation.js';
import { requireCondition } from '../../contracts/validation.js';

// Fixed container entrypoint. No CLI-selected files, direct networking, core credentials or shell tools.
let boot,lease,worker,pipes,closing,startup,stopping=false;
async function stop(code=0) {
  if(stopping)return closing;
  stopping=true;
  process.exitCode=code;
  const forced=setTimeout(()=>process.exit(1),3000);forced.unref();
  closing=(async()=>{
    lease?.stop();await worker?.stop();await startup?.catch(()=>{});
    lease?.stop();await worker?.stop();
    await pipes?.stop();
    for(const name of ['ipcKey','egressKey','leaseKey'])boot?.[name]?.fill(0);
    clearTimeout(forced);
  })();return closing;
}
process.once('SIGINT',()=>{void stop();});process.once('SIGTERM',()=>{void stop();});
async function start() {
  requireCondition(process.argv.length===2,'AI_WORKER_ARGUMENTS_INVALID');
  const bootstrap=await readAiWorkerFile(AI_WORKER_FILES.bootstrap,8192);
  boot=await loadAiWorkerBootstrap((path,limit)=>path===AI_WORKER_FILES.bootstrap?bootstrap:readAiWorkerFile(path,limit));
  if(stopping)throw Error('AI_WORKER_UNAVAILABLE');
  pipes=await createInstalledWindowsPipeTransport({role:'worker',bootId:boot.identity.bootId,bootstrapHash:installationHash(bootstrap)});
  const release=pipes.installation.configuration.release;
  requireCondition(['workerId','releaseHash','profileHash','provider','domain'].every(name=>boot.identity[name]===release[name]) &&
    boot.qualificationHash===release.evidenceHash,'AI_WORKER_NOT_QUALIFIED');
  pipes.signal.addEventListener('abort',()=>{void stop(1);},{once:true});
  if(stopping || pipes.signal.aborted)throw Error('AI_WORKER_UNAVAILABLE');
  lease=createAiWorkerLease({identity:boot.identity,qualificationHash:boot.qualificationHash,key:boot.leaseKey});await lease.start();
  if(stopping)throw Error('AI_WORKER_UNAVAILABLE');
  worker=createInstalledWorker({boot,lease,pipes,onFault:()=>{void stop(1);}});
  lease.signal.addEventListener('abort',()=>{void stop(1);},{once:true});
  if(lease.signal.aborted)throw Error('AI_WORKER_UNAVAILABLE');
  await worker.start();if(stopping)throw Error('AI_WORKER_UNAVAILABLE');process.stdout.write('AI_WORKER_READY\n');
}
startup=start();
try {await startup;}catch {process.stderr.write('AI_WORKER_UNAVAILABLE\n');await stop(1);}
