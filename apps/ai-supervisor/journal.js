import { lstat, open, rename, unlink } from 'node:fs/promises';
import { win32 } from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { requireCondition, requireKeys } from '../../contracts/validation.js';
import { canonicalAiWorkerIdentity } from '../knowledge-worker/ipc-contract.js';
import { readAiWorkerFile } from '../knowledge-worker/bootstrap.js';
import { registeredAiContainer, registeredAiWorkerIdentity } from './container-profile.js';
import { acquireAiSupervisorOwnership } from './ownership.js';

const hash=value=>typeof value==='string' && /^[a-f0-9]{64}$/u.test(value);
const uuid=value=>typeof value==='string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/u.test(value);
const image=value=>typeof value==='string' && /^sha256:[a-f0-9]{64}$/u.test(value);
const checksum=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const same=(left,right)=>Object.keys(left).every(key=>left[key]===right?.[key]);
const empty=installationId=>({version:1,installationId,revision:0,phase:'empty',operationId:null,identity:null,imageId:null,containerId:null,createPending:false});

function validate(value,installationId) {
  requireKeys(value,['version','installationId','revision','phase','operationId','identity','imageId','containerId','createPending'],'AI_SUPERVISOR_JOURNAL_INVALID');
  requireCondition(value.version===1 && value.installationId===installationId && Number.isSafeInteger(value.revision) && value.revision>=0 &&
    ['empty','prepared','creating','created','starting','running','removing'].includes(value.phase) && typeof value.createPending==='boolean','AI_SUPERVISOR_JOURNAL_INVALID');
  if(value.phase==='empty')requireCondition(['operationId','identity','imageId','containerId'].every(key=>value[key]===null) && !value.createPending,'AI_SUPERVISOR_JOURNAL_INVALID');
  else {
    canonicalAiWorkerIdentity(value.identity);
    requireCondition(uuid(value.operationId) && image(value.imageId) && (value.containerId===null || hash(value.containerId)),'AI_SUPERVISOR_JOURNAL_INVALID');
    if(value.phase==='prepared')requireCondition(value.containerId===null && !value.createPending,'AI_SUPERVISOR_JOURNAL_INVALID');
    if(value.phase==='creating')requireCondition(value.containerId===null && value.createPending,'AI_SUPERVISOR_JOURNAL_INVALID');
    if(['created','starting','running'].includes(value.phase))requireCondition(hash(value.containerId) && !value.createPending,'AI_SUPERVISOR_JOURNAL_INVALID');
    requireCondition(!value.createPending || value.containerId===null,'AI_SUPERVISOR_JOURNAL_INVALID');
  }
  return structuredClone(value);
}

async function location(registration,directory) {
  // Reuse the registered Windows path rules and require separation from both guest-visible roots.
  registeredAiContainer({...registration,bootRoot:directory,providerDirectory:registration.bootRoot});
  registeredAiContainer({...registration,bootRoot:directory,providerDirectory:registration.providerDirectory});
  const info=await lstat(directory);requireCondition(info.isDirectory() && !info.isSymbolicLink(),'AI_SUPERVISOR_JOURNAL_DIRECTORY_INVALID');
  return win32.join(directory,`slot-${registration.installationId}.json`);
}

async function write(path,value,initial=false,current=()=>true) {
  const target=initial?path:`${path}.${randomBytes(16).toString('hex')}.tmp`;
  try {
    const file=await open(target,'wx',0o600);
    try {await file.writeFile(JSON.stringify({state:value,sha256:checksum(value)})+'\n','utf8');await file.sync();}finally{await file.close();}
    requireCondition(current(),'AI_SUPERVISOR_JOURNAL_UNAVAILABLE');
    if(!initial)await rename(target,path);
    requireCondition(current(),'AI_SUPERVISOR_JOURNAL_UNAVAILABLE');
  } finally {if(!initial)await unlink(target).catch(error=>{if(error.code!=='ENOENT')throw error;});}
}

/** Explicit operator setup only. A missing/corrupt journal is never silently recreated during recovery. */
export async function provisionAiSupervisorJournal({registration,directory}) {
  const registered=registeredAiContainer(registration),owner=await acquireAiSupervisorOwnership(registered.installationId);
  try {const path=await location(registered,directory);await write(path,empty(registered.installationId),true,()=>!owner.signal.aborted);}
  finally {await owner.close();}
}

export async function openAiSupervisorJournal({registration,directory}) {
  const registered=registeredAiContainer(registration),owner=await acquireAiSupervisorOwnership(registered.installationId);
  let path,state,pending=null,closing=null,closed=false,failed=false;
  try {
    path=await location(registered,directory);const envelope=JSON.parse(await readAiWorkerFile(path,8192));
    requireKeys(envelope,['state','sha256'],'AI_SUPERVISOR_JOURNAL_INVALID');
    requireCondition(hash(envelope.sha256) && checksum(envelope.state)===envelope.sha256,'AI_SUPERVISOR_JOURNAL_INVALID');
    state=validate(envelope.state,registered.installationId);
  } catch {await owner.close();throw Error('AI_SUPERVISOR_JOURNAL_UNAVAILABLE');}
  const available=()=>!closed && !failed && !owner.signal.aborted;
  function mutate(revision,build) {
    requireCondition(available() && !pending,'AI_SUPERVISOR_JOURNAL_UNAVAILABLE');
    requireCondition(revision===state.revision,'AI_SUPERVISOR_REVISION_STALE');
    const next=validate({...build(structuredClone(state)),revision:state.revision+1},registered.installationId);
    pending=(async()=>{
      try {await write(path,next,false,available);state=next;return structuredClone(state);}
      catch {failed=true;throw Error('AI_SUPERVISOR_JOURNAL_UNAVAILABLE');}
      finally {pending=null;}
    })();return pending;
  }
  function phase(revision,from,to,extra={}) {
    return mutate(revision,prior=>{requireCondition(from.includes(prior.phase),'AI_SUPERVISOR_PHASE_INVALID');return {...prior,phase:to,...extra};});
  }
  function observed(container) {
    requireCondition(container && hash(container.id) && image(container.imageId) && uuid(container.operationId),'AI_SUPERVISOR_OBSERVATION_INVALID');
    return {identity:canonicalAiWorkerIdentity(container.identity),operationId:container.operationId,imageId:container.imageId,containerId:container.id};
  }
  return Object.freeze({signal:owner.signal,
    snapshot:()=>structuredClone(state),
    status:()=>({available:available(),writing:pending!==null}),
    begin({revision,identity,operationId}) {
      const fixed=registeredAiWorkerIdentity(registered,identity);requireCondition(uuid(operationId),'AI_SUPERVISOR_OPERATION_INVALID');
      return phase(revision,['empty'],'prepared',{identity:fixed,operationId,imageId:registered.imageId,containerId:null,createPending:false});
    },
    creating:({revision})=>phase(revision,['prepared'],'creating',{createPending:true}),
    created({revision,containerId}){requireCondition(hash(containerId),'AI_SUPERVISOR_OBSERVATION_INVALID');return phase(revision,['creating'],'created',{containerId,createPending:false});},
    starting:({revision})=>phase(revision,['created'],'starting'),
    running:({revision})=>phase(revision,['starting'],'running'),
    removing:({revision})=>phase(revision,['prepared','creating','created','starting','running','removing'],'removing'),
    observeRemoval({revision,container}) {
      const found=observed(container);
      return mutate(revision,prior=>{
        requireCondition(['empty','removing'].includes(prior.phase),'AI_SUPERVISOR_PHASE_INVALID');
        if(prior.phase!=='empty')requireCondition(prior.operationId===found.operationId && prior.imageId===found.imageId && same(prior.identity,found.identity) &&
          (prior.containerId===null || prior.containerId===found.containerId),'AI_SUPERVISOR_OBSERVATION_MISMATCH');
        return {...prior,...found,phase:'removing',createPending:false};
      });
    },
    removed({revision,receipt}) {
      return mutate(revision,prior=>{
        requireKeys(receipt,['removed','id'],'AI_SUPERVISOR_REMOVAL_UNCONFIRMED');
        requireCondition(prior.phase==='removing' && !prior.createPending && receipt.removed===true && receipt.id===prior.containerId,'AI_SUPERVISOR_REMOVAL_UNCONFIRMED');
        return empty(registered.installationId);
      });
    },
    close(){
      if(closing)return closing;closed=true;
      closing=(async()=>{await pending?.catch(()=>{});await owner.close();})();return closing;
    },
  });
}
