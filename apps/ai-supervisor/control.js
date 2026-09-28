import { randomUUID } from 'node:crypto';
import { requireCondition } from '../../contracts/validation.js';
import { aiControlRequest, aiControlResult } from '../ai-control/contract.js';
import { createAiControlServer } from '../ai-control/server.js';

/** Short RPCs own bounded local jobs, never caller-supplied functions, paths, commands or Docker arguments. */
export function createAiSupervisorControlApi({slot,beforeStart}) {
  requireCondition(slot && ['status','prepare','create','start','quiesce','close'].every(name=>typeof slot[name]==='function') && typeof beforeStart==='function',
  'AI_CONTROL_CONFIGURATION_INVALID');
  let latest=null,active=null,closed=false,closing=null;
  const receipt=job=>({id:job.id,command:job.command,operationId:job.body.operationId,revision:job.body.revision,state:job.state});
  return Object.freeze({
    handle(request,{role,signal}) {
      requireCondition(!closed && !signal.aborted,'AI_CONTROL_UNAVAILABLE');
      const {command,body}=aiControlRequest(request,role),status=slot.status(),state=status.journal;
      if(command==='inspect')return aiControlResult(command,{revision:state.revision,phase:state.phase,identity:state.identity,operationId:state.operationId,
        recovered:status.recovered,readiness:status.readiness??{core:false,egress:false},job:latest?receipt(latest):null});
      if(['channel','ready'].includes(command)){
        requireCondition(active?.command!=='quiesce','AI_CONTROL_BUSY');
        requireCondition(typeof slot[command]==='function','AI_CONTROL_UNAVAILABLE');
        return aiControlResult(command,slot[command]({...body,role}));
      }
      requireCondition(role==='core','AI_CONTROL_DENIED');
      const fingerprint=JSON.stringify({command,body});
      if(latest?.fingerprint===fingerprint)return {job:receipt(latest)};
      requireCondition(body.revision===state.revision,'AI_CONTROL_STALE');
      requireCondition(!active || (command==='quiesce' && active.command!=='quiesce'),'AI_CONTROL_BUSY');
      if(['create','start'].includes(command))requireCondition(body.operationId===state.operationId,'AI_CONTROL_STALE');
      requireCondition(['prepare','create','start','quiesce'].includes(command),'AI_CONTROL_DENIED');
      const job={id:randomUUID(),command,body:structuredClone(body),fingerprint,state:'running',task:null,abort:new AbortController()};
      if(command==='quiesce')active?.abort.abort();latest=job;active=job;
      job.task=Promise.resolve().then(async()=>{
        requireCondition(!closed && !job.abort.signal.aborted,'AI_CONTROL_UNAVAILABLE');
        if(command==='prepare')await slot.prepare({...body,signal:job.abort.signal});
        else if(command==='create')await slot.create({revision:body.revision,signal:job.abort.signal});
        else if(command==='start')await slot.start({revision:body.revision,signal:job.abort.signal,
          beforeStart:({signal})=>beforeStart({identity:state.identity,operationId:body.operationId,signal})});
        else await slot.quiesce();
        job.state='complete';
      }).catch(()=>{job.state='failed';}).finally(()=>{if(active===job)active=null;});
      return {job:receipt(job)};
    },
    close(){if(closing)return closing;closed=true;active?.abort.abort();const task=active?.task;
      closing=(async()=>{try{await slot.close();}finally{await task;}})();return closing;},
  });
}

/** Service lifetime owns both RPC admission and the registered slot. Startup recovery never launches a worker. */
export function createAiSupervisorControlService({installationId,keys,qualified,slot,beforeStart,revocationSignal,onFault}) {
  requireCondition(revocationSignal instanceof AbortSignal && typeof onFault==='function','AI_CONTROL_CONFIGURATION_INVALID');
  const api=createAiSupervisorControlApi({slot,beforeStart});let closing=null,failed=false;
  const fault=code=>{failed=true;try{onFault(code);}catch{}};
  const server=createAiControlServer({installationId,keys,qualified,handle:api.handle,revocationSignal,
    onFault:code=>{fault(code);void stop().catch(()=>{});}});
  function stop(){
    if(closing)return closing;revocationSignal.removeEventListener('abort',revoke);
    // Closing the API synchronously excludes handlers admitted just before RPC shutdown.
    closing=Promise.allSettled([api.close(),server.stop()]).then(results=>{
      if(results.some(result=>result.status==='rejected')){fault('AI_CONTROL_STOP_UNCONFIRMED');throw Error('AI_CONTROL_STOP_UNCONFIRMED');}
    });return closing;
  }
  const revoke=()=>{void stop().catch(()=>{});};revocationSignal.addEventListener('abort',revoke,{once:true});if(revocationSignal.aborted)revoke();
  return Object.freeze({session:server.session,signal:server.signal,
    async start(){try{
      await slot.quiesce();requireCondition(!closing && !revocationSignal.aborted,'AI_CONTROL_UNAVAILABLE');
      await server.start();requireCondition(!closing && !revocationSignal.aborted,'AI_CONTROL_UNAVAILABLE');
    }catch{fault('AI_CONTROL_UNAVAILABLE');await stop().catch(()=>{});throw Error('AI_CONTROL_UNAVAILABLE');}},
    status:()=>({...server.status(),failed}),stop,
  });
}
