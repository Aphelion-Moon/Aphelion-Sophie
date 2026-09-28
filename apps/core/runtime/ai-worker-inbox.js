import { createServer } from 'node:net';
import { requireCondition } from '../../../contracts/validation.js';
import { canonicalAiWorkerIdentity } from '../../knowledge-worker/ipc-contract.js';
import { aiBootPipe, authenticateAiBootPipe } from '../../knowledge-worker/boot-pipe.js';
import { createAiWorkerQualification } from '../../knowledge-worker/windows-pipe.js';

/** Host-owned pipe mapped into a container. Only authenticated connections become available to the broker. */
export function createAiWorkerInbox({identity,key,qualified,revocationSignal,createPipeServer=createServer}) {
  const fixed=canonicalAiWorkerIdentity(identity),path=aiBootPipe(fixed,'inference');
  requireCondition(Buffer.isBuffer(key) && key.length===32 && typeof qualified==='function' && revocationSignal instanceof AbortSignal,
    'AI_IPC_CONFIGURATION_INVALID');
  const secret=Buffer.from(key),lifetime=new AbortController(),signal=AbortSignal.any([lifetime.signal,revocationSignal]);
  const qualification=createAiWorkerQualification({identity:fixed,qualified}),sockets=new Set(),tasks=new Set();
  let phase='idle',available=null,waiting=null,starting,closing,taking=false;
  const deny=()=>Error('AI_WORKER_UNAVAILABLE');
  function offer(socket) {
    requireCondition(!signal.aborted && phase==='listening' && !socket.destroyed && !available,'AI_WORKER_UNAVAILABLE');
    available=socket;waiting?.resolve();
  }
  const server=createPipeServer(socket=>{
    socket.on('error',()=>{});
    if(phase!=='listening' || signal.aborted || sockets.size>=2){socket.destroy();return;}
    sockets.add(socket);
    socket.once('close',()=>{sockets.delete(socket);if(available===socket)available=null;});
    const task=(async()=>{
      try {
        requireCondition(await qualification.current(signal) && !signal.aborted,'AI_WORKER_NOT_QUALIFIED');
        await authenticateAiBootPipe({stream:socket,identity:fixed,key:secret,side:'host',signal,purpose:'inference'});
        requireCondition(await qualification.current(signal),'AI_WORKER_NOT_QUALIFIED');offer(socket);
      } catch {socket.destroy();}
    })();tasks.add(task);void task.finally(()=>tasks.delete(task));
  });
  server.on('error',()=>{void stop();});
  function stop() {
    if(closing)return closing;
    phase='stopped';lifetime.abort();qualification.stop();secret.fill(0);available=null;waiting?.reject(deny());
    revocationSignal.removeEventListener('abort',revoke);
    for(const socket of sockets)socket.destroy();
    closing=(async()=>{
      await starting?.catch(()=>{});
      await Promise.all([...tasks,new Promise(resolve=>server.listening?server.close(()=>resolve()):resolve())]);
    })();return closing;
  }
  const revoke=()=>{void stop();};revocationSignal.addEventListener('abort',revoke,{once:true});if(revocationSignal.aborted)revoke();
  return Object.freeze({
    start() {
      requireCondition(phase==='idle','AI_IPC_ALREADY_STARTED');phase='starting';
      starting=(async()=>{
        try {
          requireCondition(await qualification.current(signal) && phase==='starting' && !signal.aborted,'AI_WORKER_NOT_QUALIFIED');
          await new Promise((resolve,reject)=>{
            const fail=()=>{server.off('listening',ready);reject(deny());};
            const ready=()=>{server.off('error',fail);resolve();};
            server.once('error',fail);server.once('listening',ready);server.listen(path);
          });
          requireCondition(phase==='starting' && !signal.aborted,'AI_WORKER_UNAVAILABLE');phase='listening';
        } catch {if(phase!=='stopped')phase='failed';throw deny();}
      })();return starting;
    },
    async take({signal:requestSignal,deadline}) {
      requireCondition(phase==='listening' && !taking && requestSignal instanceof AbortSignal &&
        Number.isSafeInteger(deadline) && deadline>Date.now() && deadline<=Date.now()+15000,'AI_WORKER_UNAVAILABLE');
      taking=true;const timeout=new AbortController(),combined=AbortSignal.any([signal,requestSignal,timeout.signal]);
      const timer=setTimeout(()=>timeout.abort(),Math.max(1,Math.min(2000,deadline-Date.now())));let abort;
      try {
        requireCondition(!combined.aborted,'AI_WORKER_UNAVAILABLE');
        if(!available)await new Promise((resolve,reject)=>{
          waiting={resolve,reject};abort=()=>reject(deny());combined.addEventListener('abort',abort,{once:true});if(combined.aborted)abort();
        });
        const socket=available;available=null;
        try {
          requireCondition(socket && !socket.destroyed && !combined.aborted && await qualification.current(combined) && !combined.aborted,'AI_WORKER_NOT_QUALIFIED');
          return socket;
        } catch {socket?.destroy();throw deny();}
      } finally {taking=false;waiting=null;clearTimeout(timer);if(abort)combined.removeEventListener('abort',abort);}
    },
    status(){return {phase,connections:sockets.size,available:available!==null,waiting:taking};},stop,
  });
}
