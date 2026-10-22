import { createServer } from 'node:net';
import { requireCondition, requireInteger } from '../../../contracts/validation.js';
import { canonicalAiWorkerIdentity } from '../../knowledge-worker/ipc-contract.js';
import { AI_DEADLINE_MS } from '../../../modules/assistant/participation.js';
import { aiBootPipe, authenticateAiBootPipe } from '../../knowledge-worker/boot-pipe.js';
import { createAiWorkerQualification } from '../../knowledge-worker/qualification.js';

/**
 * Core-owned loopback listener for the worker service. Only connections that pass the mutual channel-key handshake
 * become available, and each carries one turn. Up to `capacity` turns can take a connection at once.
 */
export function createAiWorkerInbox({identity,key,qualified,revocationSignal,createPipeServer=createServer,capacity=2}) {
  const fixed=canonicalAiWorkerIdentity(identity),path=aiBootPipe(fixed,'inference');
  requireCondition(Buffer.isBuffer(key) && key.length===32 && typeof qualified==='function' && revocationSignal instanceof AbortSignal,
    'AI_IPC_CONFIGURATION_INVALID');
  requireInteger(capacity,1,4);
  const secret=Buffer.from(key),lifetime=new AbortController(),signal=AbortSignal.any([lifetime.signal,revocationSignal]);
  const qualification=createAiWorkerQualification({identity:fixed,qualified}),sockets=new Set(),tasks=new Set(),available=[],waiters=[];
  let phase='idle',starting,closing,connectedAt=null;
  const deny=()=>Error('AI_WORKER_UNAVAILABLE');
  function offer(socket) {
    requireCondition(!signal.aborted && phase==='listening' && !socket.destroyed && available.length<capacity,'AI_WORKER_UNAVAILABLE');
    connectedAt=Date.now();
    const waiter=waiters.shift();if(waiter)waiter.resolve(socket);else available.push(socket);
  }
  const server=createPipeServer(socket=>{
    socket.on('error',()=>{});
    if(phase!=='listening' || signal.aborted || sockets.size>=capacity*2){socket.destroy();return;}
    sockets.add(socket);
    socket.once('close',()=>{sockets.delete(socket);const index=available.indexOf(socket);if(index!==-1)available.splice(index,1);});
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
    phase='stopped';lifetime.abort();qualification.stop();secret.fill(0);available.length=0;
    for(const waiter of waiters.splice(0))waiter.reject(deny());
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
      requireCondition(phase==='listening' && requestSignal instanceof AbortSignal && waiters.length<capacity &&
        Number.isSafeInteger(deadline) && deadline>Date.now() && deadline<=Date.now()+AI_DEADLINE_MS,'AI_WORKER_UNAVAILABLE');
      const timeout=new AbortController(),combined=AbortSignal.any([signal,requestSignal,timeout.signal]);
      // A connected worker always has an idle connection ready; a short wait covers its reconnection after a turn.
      const timer=setTimeout(()=>timeout.abort(),Math.max(1,Math.min(2000,deadline-Date.now())));let waiter=null,abort;
      try {
        requireCondition(!combined.aborted,'AI_WORKER_UNAVAILABLE');
        const socket=available.shift() ?? await new Promise((resolve,reject)=>{
          waiter={resolve,reject};waiters.push(waiter);
          abort=()=>{const index=waiters.indexOf(waiter);if(index!==-1)waiters.splice(index,1);reject(deny());};
          combined.addEventListener('abort',abort,{once:true});if(combined.aborted)abort();
        });
        try {
          requireCondition(socket && !socket.destroyed && !combined.aborted && await qualification.current(combined) && !combined.aborted,'AI_WORKER_NOT_QUALIFIED');
          return socket;
        } catch {socket?.destroy();throw deny();}
      } finally {clearTimeout(timer);if(abort)combined.removeEventListener('abort',abort);}
    },
    status(){return {phase,connections:sockets.size,available:available.length,waiting:waiters.length,connected:available.length>0,connectedAt};},stop,
  });
}
