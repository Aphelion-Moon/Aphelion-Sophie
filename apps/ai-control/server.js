import { createServer } from 'node:net';
import { randomBytes } from 'node:crypto';
import { requireCondition, requireKeys } from '../../contracts/validation.js';
import { createAiIpcChannel } from '../knowledge-worker/ipc-channel.js';
import { aiControlHash, aiControlPipe, aiControlScope, aiControlRequest, aiControlResult } from './contract.js';
import { createAiControlQualification } from './qualification.js';

/** Two fixed role endpoints with encrypted frames; actual named-pipe identity and ACLs require separate qualification. */
export function createAiControlServer({installationId,keys,qualified,handle,revocationSignal,onFault,createPipeServer=createServer}) {
  requireKeys(keys,['core','egress'],'AI_CONTROL_CONFIGURATION_INVALID');
  requireCondition(['core','egress'].every(role=>Buffer.isBuffer(keys[role]) && keys[role].length===32) && !keys.core.equals(keys.egress) &&
    typeof handle==='function' && typeof onFault==='function' && revocationSignal instanceof AbortSignal,'AI_CONTROL_CONFIGURATION_INVALID');
  const secret={core:Buffer.from(keys.core),egress:Buffer.from(keys.egress)},session=randomBytes(32).toString('hex');
  const lifetime=new AbortController(),signal=AbortSignal.any([lifetime.signal,revocationSignal]),qualification=createAiControlQualification(qualified);
  let phase='idle',starting=null,closing=null;const peers=new Set(),tasks=new Set(),handlers=new Set();
  const servers=['core','egress'].map(role=>{
    const scope=Object.freeze({...aiControlScope(installationId,role),session});
    const server=createPipeServer(socket=>{
      socket.on('error',()=>{});
      if(phase!=='listening' || signal.aborted || [...peers].filter(peer=>peer.role===role).length>=2){socket.destroy();return;}
      const channel=createAiIpcChannel({stream:socket,key:secret[role],side:'broker',profile:'control'}),peer={role,socket,channel};peers.add(peer);
      const combined=AbortSignal.any([signal,channel.signal]);
      const close=()=>channel.close();combined.addEventListener('abort',close,{once:true});
      const task=(async()=>{
        try {
          requireCondition(await qualification.current(scope,combined) && !combined.aborted,'AI_CONTROL_UNAVAILABLE');
          await channel.send('challenge',scope);
          const proof=await channel.receive('proof');requireKeys(proof,['installationId','role','nonce'],'AI_CONTROL_INVALID');
          requireCondition(proof.installationId===installationId && proof.role===role && aiControlHash(proof.nonce),'AI_CONTROL_INVALID');
          channel.bind(proof.nonce);await channel.send('ready',{session});
          const request=aiControlRequest(await channel.receive('request'),role);
          requireCondition(request.session===session && await qualification.current(scope,combined) && !combined.aborted,'AI_CONTROL_UNAVAILABLE');
          let response,cancel;
          try {
            requireCondition(handlers.size<4,'AI_CONTROL_BUSY');
            const work=Promise.resolve().then(()=>{requireCondition(!combined.aborted,'AI_CONTROL_UNAVAILABLE');return handle(request,{role,signal:combined});});
            handlers.add(work);void work.then(()=>handlers.delete(work),()=>handlers.delete(work));
            const cancelled=new Promise((_,reject)=>{cancel=()=>reject(Error('AI_CONTROL_UNAVAILABLE'));combined.addEventListener('abort',cancel,{once:true});if(combined.aborted)cancel();});
            response={ok:true,value:aiControlResult(request.command,await Promise.race([work,cancelled]))};
          }
          catch(error){response={ok:false,code:['AI_CONTROL_BUSY','AI_CONTROL_STALE','AI_CONTROL_DENIED'].includes(error.message)?error.message:'AI_CONTROL_UNAVAILABLE'};}
          finally {if(cancel)combined.removeEventListener('abort',cancel);}
          requireCondition(await qualification.current(scope,combined) && !combined.aborted,'AI_CONTROL_UNAVAILABLE');
          await channel.send('result',response);
          // Wait for the client to consume the result; an immediate destroy can truncate a pipe reply.
          await new Promise(resolve=>{channel.signal.addEventListener('abort',resolve,{once:true});if(channel.signal.aborted)resolve();});
        } catch {} finally {combined.removeEventListener('abort',close);channel.close();
          if(!socket.closed)await new Promise(resolve=>socket.once('close',resolve));peers.delete(peer);}
      })();tasks.add(task);void task.finally(()=>tasks.delete(task));
    });
    server.on('error',()=>{try{onFault('AI_CONTROL_UNAVAILABLE');}catch{}void stop();});
    return {server,scope};
  });
  function stop(){
    if(closing)return closing;phase='stopped';lifetime.abort();qualification.stop();Object.values(secret).forEach(key=>key.fill(0));
    revocationSignal.removeEventListener('abort',revoke);
    closing=(async()=>{await starting?.catch(()=>{});for(const peer of peers)peer.channel.close();
      await Promise.all([...servers.map(({server})=>new Promise(resolve=>server.listening?server.close(resolve):resolve())),...tasks]);})();return closing;
  }
  const revoke=()=>{void stop();};revocationSignal.addEventListener('abort',revoke,{once:true});if(revocationSignal.aborted)revoke();
  return Object.freeze({session,signal,
    start(){requireCondition(phase==='idle','AI_CONTROL_ALREADY_STARTED');phase='starting';
      starting=(async()=>{try{
        for(const {server,scope} of servers){
          requireCondition(await qualification.current(scope,signal) && !signal.aborted,'AI_CONTROL_UNAVAILABLE');
          await new Promise((resolve,reject)=>{const fail=()=>{server.off('listening',ready);reject(Error('AI_CONTROL_UNAVAILABLE'));};
            const ready=()=>{server.off('error',fail);resolve();};server.once('error',fail);server.once('listening',ready);server.listen(aiControlPipe(installationId,scope.role));});
        }
        requireCondition(!signal.aborted,'AI_CONTROL_UNAVAILABLE');phase='listening';
      }catch{void stop();throw Error('AI_CONTROL_UNAVAILABLE');}})();return starting;
    },
    status:()=>({phase,connections:peers.size,pendingHandlers:handlers.size}),stop,
  });
}
