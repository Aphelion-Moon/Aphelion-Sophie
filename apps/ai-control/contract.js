import { requireCondition, requireKeys } from '../../contracts/validation.js';
import { canonicalAiWorkerIdentity } from '../knowledge-worker/ipc-contract.js';

export const aiControlHash=value=>typeof value==='string' && /^[a-f0-9]{64}$/u.test(value);
const uuid=value=>typeof value==='string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/u.test(value);
const revision=value=>Number.isSafeInteger(value) && value>=0;
const mutations=['prepare','create','start','quiesce'];
const commands=['inspect','channel','ready',...mutations];
const phases=['empty','prepared','creating','created','starting','running','removing'];
export function aiControlScope(installationId,role) {
  requireCondition(aiControlHash(installationId) && ['core','egress'].includes(role),'AI_CONTROL_CONFIGURATION_INVALID');
  return {installationId,role};
}
export function aiControlPipe(installationId,role) {
  aiControlScope(installationId,role);requireCondition(process.platform==='win32','AI_WINDOWS_REQUIRED');
  return `\\\\.\\pipe\\sophie-ai-control-${role}-${installationId}`;
}
export function aiControlRequest(value,role) {
  requireKeys(value,['session','command','body'],'AI_CONTROL_INVALID');
  requireCondition(aiControlHash(value.session) && commands.includes(value.command),'AI_CONTROL_INVALID');
  requireCondition(role==='core' || (role==='egress' && ['inspect','channel','ready'].includes(value.command)),'AI_CONTROL_DENIED');
  const body=value.body;
  if(['channel','ready'].includes(value.command)){
    requireKeys(body,['operationId','identity'],'AI_CONTROL_INVALID');requireCondition(uuid(body.operationId),'AI_CONTROL_INVALID');
    return {session:value.session,command:value.command,body:{operationId:body.operationId,identity:canonicalAiWorkerIdentity(body.identity)}};
  }
  requireKeys(body,value.command==='inspect'?[]:value.command==='prepare'?['revision','operationId','identity']:['revision','operationId'],'AI_CONTROL_INVALID');
  if(value.command!=='inspect')requireCondition(revision(body.revision) && uuid(body.operationId),'AI_CONTROL_INVALID');
  const canonical=value.command==='inspect'?{}:{revision:body.revision,operationId:body.operationId,
    ...(value.command==='prepare'?{identity:canonicalAiWorkerIdentity(body.identity)}:{})};
  return {session:value.session,command:value.command,body:canonical};
}
function job(value) {
  requireKeys(value,['id','command','operationId','revision','state'],'AI_CONTROL_INVALID');
  requireCondition(uuid(value.id) && mutations.includes(value.command) && uuid(value.operationId) && revision(value.revision) &&
    ['running','complete','failed'].includes(value.state),'AI_CONTROL_INVALID');
}
export function aiControlResult(command,value) {
  if(['channel','ready'].includes(command)){
    requireKeys(value,command==='channel'?['identity','operationId','purpose','key']:['identity','operationId','ready'],'AI_CONTROL_INVALID');
    canonicalAiWorkerIdentity(value.identity);requireCondition(uuid(value.operationId),'AI_CONTROL_INVALID');
    if(command==='channel')requireCondition(['inference','egress'].includes(value.purpose) && aiControlHash(value.key),'AI_CONTROL_INVALID');
    else requireCondition(value.ready===true,'AI_CONTROL_INVALID');
  }else if(command==='inspect'){
    requireKeys(value,['revision','phase','identity','operationId','recovered','readiness','job'],'AI_CONTROL_INVALID');
    requireCondition(revision(value.revision) && phases.includes(value.phase) && typeof value.recovered==='boolean','AI_CONTROL_INVALID');
    requireKeys(value.readiness,['core','egress'],'AI_CONTROL_INVALID');
    requireCondition(['core','egress'].every(role=>typeof value.readiness[role]==='boolean'),'AI_CONTROL_INVALID');
    if(value.phase==='empty')requireCondition(value.identity===null && value.operationId===null,'AI_CONTROL_INVALID');
    else {canonicalAiWorkerIdentity(value.identity);requireCondition(uuid(value.operationId),'AI_CONTROL_INVALID');}
    if(value.job!==null)job(value.job);
  }else {requireKeys(value,['job'],'AI_CONTROL_INVALID');job(value.job);requireCondition(value.job.command===command,'AI_CONTROL_INVALID');}
  return structuredClone(value);
}
