import { Agent, request } from 'node:http';
import { requireCondition } from '../../contracts/validation.js';
import { registeredAiContainer, registeredAiWorkerIdentity, aiContainerProfile, inspectOwnedAiContainer, requireAiContainerProfile, AI_CONTAINER_ENTRYPOINT } from './container-profile.js';

const socketPath='\\\\.\\pipe\\docker_engine',prefix='/v1.54';
const failure=()=>Error('AI_CONTAINER_OPERATION_UNCONFIRMED');

/** Privileged supervisor only. No exported raw API, shell, build/pull, exec, arbitrary target or automatic start retry. */
export function createAiDockerSlot({registration,requestImpl=request}) {
  const registered=registeredAiContainer(registration),name=`sophie-ai-public-${registered.installationId}`;
  const agent=new Agent({keepAlive:false,maxSockets:1,maxTotalSockets:1,proxyEnv:{}}),requests=new Set();
  let stopped=false,closing=null,busy=false,startable=null,uncertain=null;
  async function call(method,path,{body,signal,accepted=[200]}={}) {
    requireCondition(!stopped && !signal?.aborted,'AI_CONTAINER_OPERATION_UNCONFIRMED');
    const serialized=body===undefined?null:JSON.stringify(body);
    requireCondition(serialized===null || Buffer.byteLength(serialized)<=16384,'AI_CONTAINER_PROFILE_MISMATCH');
    return new Promise((resolve,reject)=>{
      let response,timer,bytes=0;const chunks=[];
      const fail=()=>{response?.destroy();outgoing.destroy();reject(failure());};
      const outgoing=requestImpl({socketPath,host:'localhost',path:prefix+path,method,agent,signal,maxHeaderSize:16384,
        headers:serialized===null?{}:{'content-type':'application/json','content-length':Buffer.byteLength(serialized)}},incoming=>{
        response=incoming;
        if(!accepted.includes(incoming.statusCode)){fail();return;}
        incoming.on('data',chunk=>{bytes+=chunk.length;if(bytes>262144)fail();else chunks.push(chunk);});
        incoming.once('error',fail);incoming.once('aborted',fail);
        incoming.once('end',()=>{
          try {
            requireCondition(incoming.complete && !signal?.aborted,'AI_CONTAINER_OPERATION_UNCONFIRMED');
            const value=bytes?JSON.parse(Buffer.concat(chunks).toString('utf8')):null;
            resolve({status:incoming.statusCode,value});
          } catch {fail();}
        });
      });
      requests.add(outgoing);outgoing.once('error',()=>reject(failure()));
      outgoing.once('close',()=>{clearTimeout(timer);requests.delete(outgoing);});
      timer=setTimeout(fail,10000);outgoing.end(serialized);
    });
  }
  async function exclusive(work) {
    requireCondition(!busy && !stopped,'AI_CONTAINER_OPERATION_BUSY');busy=true;
    try{return await work();}finally{busy=false;}
  }
  async function inspect(signal) {
    const result=await call('GET',`/containers/${name}/json`,{signal,accepted:[200,404]});
    if(result.status===404)return null;
    const safe=inspectOwnedAiContainer(result.value,registered,name);return {safe,raw:result.value};
  }
  async function engine(signal) {
    const {value}=await call('GET','/version',{signal});
    requireCondition(value?.Version==='29.8.0' && value.Os==='windows' && value.Arch==='amd64','AI_CONTAINER_ENGINE_UNQUALIFIED');
    const image=await call('GET',`/images/${registered.imageId}/json`,{signal});
    const config=image.value?.Config;
    requireCondition(image.value?.Id===registered.imageId && image.value?.Os==='windows' && image.value?.Architecture==='amd64' &&
      config?.User==='ContainerUser' && config.WorkingDir==='C:\\sophie' && JSON.stringify(config.Entrypoint)===JSON.stringify(AI_CONTAINER_ENTRYPOINT) &&
      (!config.Cmd || (Array.isArray(config.Cmd) && config.Cmd.length===0)) && (!config.Env || (Array.isArray(config.Env) && config.Env.length===0)) &&
      Object.keys(config.Volumes??{}).length===0 && !config.Healthcheck &&
      Object.keys(config.ExposedPorts??{}).length===0,'AI_CONTAINER_IMAGE_UNQUALIFIED');
    return true;
  }
  return Object.freeze({
    name,
    status:()=>({stopped,busy,startPrepared:startable!==null,uncertain:uncertain?.action??null}),
    inspect:({signal}={})=>exclusive(async()=>{const found=await inspect(signal);return found?.safe??null;}),
    qualified:({signal}={})=>exclusive(()=>engine(signal)),
    create({identity,operationId,signal}) {
      return exclusive(async()=>{
        requireCondition(!uncertain,'AI_CONTAINER_RECONCILIATION_REQUIRED');
        const fixed=registeredAiWorkerIdentity(registered,identity),body=aiContainerProfile(registered,fixed,operationId);
        requireCondition(signal instanceof AbortSignal && !signal.aborted,'AI_CONTAINER_OPERATION_UNCONFIRMED');
        await engine(signal);requireCondition(await inspect(signal)===null,'AI_CONTAINER_SLOT_OCCUPIED');startable=null;
        uncertain={action:'create',identity:fixed,operationId};
        const {value}=await call('POST',`/containers/create?name=${name}`,{body,signal,accepted:[201]});
        requireCondition(typeof value?.Id==='string' && /^[a-f0-9]{64}$/u.test(value.Id),'AI_CONTAINER_OPERATION_UNCONFIRMED');
        uncertain.id=value.Id;
        const found=await inspect(signal);
        requireCondition(found?.safe.id===value.Id && !found.safe.running && !found.safe.restarting && !found.safe.paused && !found.safe.dead,
          'AI_CONTAINER_OPERATION_UNCONFIRMED');
        requireAiContainerProfile(found.raw,registered,fixed,operationId);
        requireCondition(!value.Warnings || (Array.isArray(value.Warnings) && value.Warnings.length===0),'AI_CONTAINER_PROFILE_MISMATCH');
        startable={id:value.Id,identity:fixed,operationId};uncertain=null;return {id:value.Id};
      });
    },
    start({id,signal}) {
      return exclusive(async()=>{
        requireCondition(signal instanceof AbortSignal && !signal.aborted && startable?.id===id,'AI_CONTAINER_START_NOT_PREPARED');
        const prepared=startable;startable=null;
        const found=await inspect(signal);requireCondition(found?.safe.id===id && !found.safe.running && !found.safe.restarting && !found.safe.paused && !found.safe.dead,
          'AI_CONTAINER_OPERATION_UNCONFIRMED');
        requireAiContainerProfile(found.raw,registered,prepared.identity,prepared.operationId);
        uncertain={action:'start',...prepared};
        await call('POST',`/containers/${id}/start`,{signal,accepted:[204]});
        const running=await inspect(signal);requireCondition(running?.safe.id===id && running.safe.running && !running.safe.paused && !running.safe.restarting && !running.safe.dead,
          'AI_CONTAINER_OPERATION_UNCONFIRMED');
        requireAiContainerProfile(running.raw,registered,prepared.identity,prepared.operationId);uncertain=null;return {id,running:true};
      });
    },
    remove({signal}={}) {
      return exclusive(async()=>{
        startable=null;const found=await inspect(signal);
        if(!found){
          // A known deleted ID cannot be resurrected by a late start. An unacknowledged create has no such proof.
          if(uncertain?.id){const exact=await call('GET',`/containers/${uncertain.id}/json`,{signal,accepted:[200,404]});
            requireCondition(exact.status===404,'AI_CONTAINER_REMOVAL_UNCONFIRMED');const id=uncertain.id;uncertain=null;return {removed:true,id};}
          requireCondition(!uncertain,'AI_CONTAINER_REMOVAL_UNCONFIRMED');return {removed:true,id:null};
        }
        requireCondition(!uncertain || (found.safe.operationId===uncertain.operationId &&
          Object.entries(uncertain.identity).every(([key,value])=>found.safe.identity[key]===value) &&
          (!uncertain.id || found.safe.id===uncertain.id)),'AI_CONTAINER_REMOVAL_UNCONFIRMED');
        const id=found.safe.id;
        if(uncertain)uncertain.id=id;
        await call('DELETE',`/containers/${id}?force=true&v=false`,{signal,accepted:[204,404]});
        const exact=await call('GET',`/containers/${id}/json`,{signal,accepted:[200,404]});
        requireCondition(exact.status===404 && await inspect(signal)===null,'AI_CONTAINER_REMOVAL_UNCONFIRMED');uncertain=null;return {removed:true,id};
      });
    },
    close() {
      if(closing)return closing;stopped=true;startable=null;
      const handles=new Set([...requests,...Object.values(agent.sockets).flat(),...Object.values(agent.freeSockets).flat()]);
      closing=Promise.all([...handles].filter(item=>!item.closed).map(item=>new Promise(resolve=>item.once('close',resolve)))).then(()=>{});
      for(const outgoing of requests)outgoing.destroy();agent.destroy();return closing;
    },
  });
}
