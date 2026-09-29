import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { requireCondition } from '../../contracts/validation.js';
import { registeredAiWorker } from './worker-registration.js';

const SERVICE_DOES_NOT_EXIST = 1060;

function defaultRun(command,args,signal) {
  return new Promise((resolve,reject)=>{
    let child;
    try { child=spawn(command,args,{shell:false,windowsHide:true,stdio:['ignore','pipe','pipe'],signal}); }
    catch(error) { reject(error); return; }
    let stdout='';
    child.stdout.on('data',chunk=>{stdout+=chunk;});
    child.stderr.on('data',()=>{});
    child.once('error',reject);
    child.once('close',code=>resolve({code,stdout}));
  });
}

async function queryService(run,serviceName,signal) {
  const {code,stdout}=await run('sc.exe',['query',serviceName],signal);
  if(code===SERVICE_DOES_NOT_EXIST)return null;
  requireCondition(code===0,'AI_SERVICE_QUERY_FAILED');
  const state=/STATE\s*:\s*\d+\s+(\S+)/u.exec(stdout)?.[1]??null;
  requireCondition(typeof state==='string','AI_SERVICE_QUERY_FAILED');
  return {state};
}

/**
 * Controls one named Windows Service running the worker under its own restricted account.
 * The account, the pinned entrypoint and the service's startup type are provisioned once,
 * out of band, by ops/windows/setup-inference-account.ps1 — this module only starts, stops
 * and queries the already-registered service; it never creates accounts or grants ACLs.
 */
export function createAiServiceControl({registration,run=defaultRun}) {
  const registered=registeredAiWorker(registration);
  let closed=false;
  async function waitFor(states,signal,timeoutMs=15000) {
    const deadline=Date.now()+timeoutMs;
    for(;;) {
      requireCondition(!signal?.aborted,'AI_SERVICE_OPERATION_CANCELLED');
      const found=await queryService(run,registered.serviceName,signal);
      if(states.includes(found?.state??'STOPPED'))return found;
      requireCondition(Date.now()<deadline,'AI_SERVICE_OPERATION_TIMEOUT');
      await delay(200,undefined,{signal});
    }
  }
  return Object.freeze({
    async inspect({signal}={}) {
      requireCondition(!closed,'AI_SERVICE_CLOSED');
      const found=await queryService(run,registered.serviceName,signal);
      return found && found.state!=='STOPPED' ? {running:found.state==='RUNNING'} : null;
    },
    knownContainer(){return null;},
    async create({signal}={}) {
      requireCondition(!closed,'AI_SERVICE_CLOSED');
      const found=await queryService(run,registered.serviceName,signal);
      requireCondition(found!==null,'AI_SERVICE_NOT_REGISTERED');
      return {id:registered.serviceName};
    },
    async start({signal}={}) {
      requireCondition(!closed,'AI_SERVICE_CLOSED');
      const {code,stdout}=await run('sc.exe',['start',registered.serviceName],signal);
      requireCondition(code===0 || /already running|1056/iu.test(stdout),'AI_SERVICE_START_FAILED');
      await waitFor(['RUNNING'],signal);
    },
    async remove({signal}={}) {
      requireCondition(!closed,'AI_SERVICE_CLOSED');
      const found=await queryService(run,registered.serviceName,signal);
      if(found && found.state!=='STOPPED') {
        await run('sc.exe',['stop',registered.serviceName],signal);
        await waitFor(['STOPPED'],signal).catch(()=>{});
      }
      const settled=await queryService(run,registered.serviceName,signal);
      return {removed:(settled?.state??'STOPPED')==='STOPPED',id:registered.serviceName};
    },
    async qualified({signal}={}) {
      if(closed)return false;
      try { await queryService(run,registered.serviceName,signal); return true; }
      catch { return false; }
    },
    async close(){closed=true;},
  });
}
