import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { requireCondition } from '../../contracts/validation.js';
import { registeredAiWorker } from './worker-registration.js';

const SERVICE_DOES_NOT_EXIST = 1060;
const SERVICE_NOT_ACTIVE = 1062;

function defaultRun(command,args,signal) {
  return new Promise((resolve,reject)=>{
    let child;
    try { child=spawn(command,args,{shell:false,windowsHide:true,stdio:['ignore','pipe','pipe'],signal}); }
    catch(error) { reject(error); return; }
    let stdout='';
    child.stdout.on('data',chunk=>{if(stdout.length<16384)stdout+=chunk;});
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
 * Starts, stops and queries one pre-registered WinSW service that runs the worker under its own
 * virtual service account. Registration, the account's ACLs and firewall scope are provisioned
 * out of band by ops/windows/Setup-InferenceAccount.ps1; this module never creates or reconfigures them.
 */
export function createAiServiceControl({registration,run=defaultRun,timeoutMs=15000}) {
  const registered=registeredAiWorker(registration);
  let closed=false;
  async function waitFor(state,signal) {
    const deadline=Date.now()+timeoutMs;
    for(;;) {
      requireCondition(!signal?.aborted,'AI_SERVICE_OPERATION_CANCELLED');
      const found=await queryService(run,registered.serviceName,signal);
      requireCondition(found!==null,'AI_SERVICE_NOT_REGISTERED');
      if(found.state===state)return found;
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
    async create({signal}={}) {
      requireCondition(!closed,'AI_SERVICE_CLOSED');
      const found=await queryService(run,registered.serviceName,signal);
      requireCondition(found!==null,'AI_SERVICE_NOT_REGISTERED');
      // A running worker holds some earlier boot's keys; the slot must stop it before a fresh start.
      requireCondition(found.state==='STOPPED','AI_SERVICE_NOT_STOPPED');
      return {id:registered.serviceName};
    },
    async start({signal}={}) {
      requireCondition(!closed,'AI_SERVICE_CLOSED');
      const {code}=await run('sc.exe',['start',registered.serviceName],signal);
      requireCondition(code===0,'AI_SERVICE_START_FAILED');
      await waitFor('RUNNING',signal);
    },
    /** Resolves only after SCM reports STOPPED; an unconfirmed stop rejects instead of reporting removal. */
    async remove({signal}={}) {
      requireCondition(!closed,'AI_SERVICE_CLOSED');
      const found=await queryService(run,registered.serviceName,signal);
      if(found===null)return {removed:true,id:registered.serviceName};
      if(found.state!=='STOPPED' && found.state!=='STOP_PENDING') {
        const {code}=await run('sc.exe',['stop',registered.serviceName],signal);
        requireCondition(code===0 || code===SERVICE_NOT_ACTIVE,'AI_SERVICE_STOP_FAILED');
      }
      await waitFor('STOPPED',signal);
      return {removed:true,id:registered.serviceName};
    },
    async qualified({signal}={}) {
      if(closed)return false;
      try { return await queryService(run,registered.serviceName,signal)!==null; }
      catch { return false; }
    },
    async close(){closed=true;},
  });
}
