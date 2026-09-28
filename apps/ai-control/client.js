import { connect } from 'node:net';
import { randomBytes } from 'node:crypto';
import { requireCondition, requireKeys } from '../../contracts/validation.js';
import { createAiIpcChannel } from '../knowledge-worker/ipc-channel.js';
import { aiControlHash, aiControlPipe, aiControlScope, aiControlRequest, aiControlResult } from './contract.js';

/** Session is learned by inspect once. A new supervisor requires a new client and fresh lifecycle recovery. */
export function createAiControlClient({installationId,role,key,revocationSignal,connectPipe=connect}) {
  const scope=aiControlScope(installationId,role),path=aiControlPipe(installationId,role);
  requireCondition(Buffer.isBuffer(key) && key.length===32 && revocationSignal instanceof AbortSignal,'AI_CONTROL_CONFIGURATION_INVALID');
  const secret=Buffer.from(key),lifetime=new AbortController(),signal=AbortSignal.any([lifetime.signal,revocationSignal]),active=new Set();let session=null,closing=null;
  function stop(){if(closing)return closing;lifetime.abort();secret.fill(0);revocationSignal.removeEventListener('abort',revoke);
    closing=Promise.all([...active].map(item=>item.done)).then(()=>{});for(const item of active)item.channel.close();return closing;}
  const revoke=()=>{void stop();};revocationSignal.addEventListener('abort',revoke,{once:true});if(revocationSignal.aborted)revoke();
  return Object.freeze({signal,session:()=>session,
    async request(command,body={},options={}) {
      requireCondition(!signal.aborted && active.size<2 && (command==='inspect' || session!==null),'AI_CONTROL_UNAVAILABLE');
      const request=aiControlRequest({session:session??'0'.repeat(64),command,body},role);
      requireCondition(options.signal===undefined || options.signal instanceof AbortSignal,'AI_CONTROL_INVALID');
      const socket=connectPipe(path);socket.on('error',()=>{});
      const channel=createAiIpcChannel({stream:socket,key:secret,side:'worker',profile:'control'}),combined=AbortSignal.any([signal,channel.signal,...(options.signal?[options.signal]:[])]);
      const item={channel,done:new Promise(resolve=>socket.once('close',resolve))};active.add(item);
      const cancel=()=>channel.close();combined.addEventListener('abort',cancel,{once:true});if(combined.aborted)cancel();
      try {
        const greeting=await channel.receive('challenge');requireKeys(greeting,['installationId','role','session'],'AI_CONTROL_INVALID');
        requireCondition(greeting.installationId===scope.installationId && greeting.role===scope.role && aiControlHash(greeting.session),'AI_CONTROL_INVALID');
        if(session!==null && greeting.session!==session){void stop();throw Error('AI_CONTROL_SESSION_CHANGED');}
        const nonce=randomBytes(32).toString('hex');await channel.send('proof',{...scope,nonce});channel.bind(nonce);
        const ready=await channel.receive('ready');requireKeys(ready,['session'],'AI_CONTROL_INVALID');requireCondition(ready.session===greeting.session,'AI_CONTROL_INVALID');
        await channel.send('request',{...request,session:greeting.session});
        const result=await channel.receive('result');
        requireCondition(typeof result?.ok==='boolean','AI_CONTROL_INVALID');
        if(!result.ok){requireKeys(result,['ok','code'],'AI_CONTROL_INVALID');requireCondition(['AI_CONTROL_BUSY','AI_CONTROL_STALE','AI_CONTROL_DENIED','AI_CONTROL_UNAVAILABLE'].includes(result.code),'AI_CONTROL_INVALID');throw Error(result.code);}
        requireKeys(result,['ok','value'],'AI_CONTROL_INVALID');const value=aiControlResult(command,result.value);
        requireCondition(!combined.aborted && (session===null || session===greeting.session),'AI_CONTROL_UNAVAILABLE');session=greeting.session;return value;
      }catch(error){throw Error(['AI_CONTROL_SESSION_CHANGED','AI_CONTROL_BUSY','AI_CONTROL_STALE','AI_CONTROL_DENIED'].includes(error.message)?error.message:'AI_CONTROL_UNAVAILABLE');}
      finally{combined.removeEventListener('abort',cancel);channel.close();await item.done;active.delete(item);}
    },stop,
  });
}
