import { win32 } from 'node:path';
import { requireCondition, requireKeys } from '../../contracts/validation.js';
import { canonicalAiWorkerRelease } from '../../modules/assistant/worker-release.js';
import { canonicalAiWorkerIdentity } from '../knowledge-worker/ipc-contract.js';
import { aiBootPipe } from '../knowledge-worker/boot-pipe.js';

export const AI_CONTAINER_ENTRYPOINT=Object.freeze(['C:\\node\\node.exe','C:\\sophie\\apps\\knowledge-worker\\main.mjs']);
const hash=value=>typeof value==='string' && /^[a-f0-9]{64}$/u.test(value);
const absolute=value=>typeof value==='string' && /^[A-Za-z]:\\[^\x00-\x1f<>"|?*]+$/u.test(value) &&
  win32.normalize(value)===value && !value.endsWith('\\') && !value.slice(2).includes(':') &&
  value.slice(3).split('\\').every(part=>!/[. ]$/u.test(part) && !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu.test(part));
export function registeredAiContainer(value) {
  requireKeys(value,['installationId','imageId','bootRoot','providerDirectory','release'],'AI_CONTAINER_REGISTRATION_INVALID');
  requireCondition(hash(value.installationId) && /^sha256:[a-f0-9]{64}$/u.test(value.imageId) &&
    absolute(value.bootRoot) && absolute(value.providerDirectory) &&
    ![value.bootRoot,value.providerDirectory].some((path,index,paths)=>
      path.toLowerCase()===paths[1-index].toLowerCase() || path.toLowerCase().startsWith(paths[1-index].toLowerCase()+'\\')),
  'AI_CONTAINER_REGISTRATION_INVALID');
  return Object.freeze({...value,release:canonicalAiWorkerRelease(value.release)});
}

export function registeredAiWorkerIdentity(registration,identity) {
  const fixed=canonicalAiWorkerIdentity(identity),release=registration.release;
  requireCondition(['workerId','releaseHash','profileHash','provider','domain'].every(name=>fixed[name]===release[name]),'AI_CONTAINER_SCOPE_INVALID');
  return fixed;
}

export function aiContainerProfile(registration,identity,operationId) {
  const fixed=registeredAiWorkerIdentity(registration,identity);
  requireCondition(typeof operationId==='string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/u.test(operationId),'AI_CONTAINER_SCOPE_INVALID');
  const labels={'com.aphelion.sophie.scope':'ai-public-v1','com.aphelion.sophie.installation':registration.installationId,
    'com.aphelion.sophie.operation':operationId};
  for(const [name,value]of Object.entries(fixed))labels[`com.aphelion.sophie.${name}`]=value;
  const mounts=['inference','egress'].map(purpose=>({Type:'npipe',Source:aiBootPipe(fixed,purpose),Target:aiBootPipe(fixed,purpose),ReadOnly:false}));
  mounts.push({Type:'bind',Source:win32.join(registration.bootRoot,fixed.bootId),Target:'C:\\sophie-boot',ReadOnly:true},
    {Type:'bind',Source:registration.providerDirectory,Target:'C:\\sophie-provider',ReadOnly:true});
  return {Image:registration.imageId,User:'ContainerUser',Entrypoint:[...AI_CONTAINER_ENTRYPOINT],Cmd:[],WorkingDir:'C:\\sophie',Env:[],
    Labels:labels,AttachStdin:false,AttachStdout:false,AttachStderr:false,OpenStdin:false,Tty:false,
    HostConfig:{Isolation:'hyperv',NetworkMode:'none',CpuCount:4,Memory:8589934592,AutoRemove:false,
      RestartPolicy:{Name:'no',MaximumRetryCount:0},LogConfig:{Type:'none',Config:{}},Mounts:mounts}};
}

/** Inspect projections deliberately omit environment, logs, host paths and unrelated engine data. */
export function inspectOwnedAiContainer(value,registration,name) {
  const labels=value?.Config?.Labels??{};
  requireCondition(hash(value?.Id) && value.Name===`/${name}` && labels['com.aphelion.sophie.scope']==='ai-public-v1' &&
    labels['com.aphelion.sophie.installation']===registration.installationId,'AI_CONTAINER_NOT_OWNED');
  const identity=canonicalAiWorkerIdentity(Object.fromEntries(['workerId','bootId','releaseHash','profileHash','provider','domain']
    .map(key=>[key,labels[`com.aphelion.sophie.${key}`]])));
  const state=value.State;
  requireCondition(state && ['Running','Paused','Restarting','Dead'].every(key=>typeof state[key]==='boolean') &&
    typeof value.Image==='string' && /^sha256:[a-f0-9]{64}$/u.test(value.Image),'AI_CONTAINER_INSPECTION_INVALID');
  return {id:value.Id,imageId:value.Image,identity,operationId:labels['com.aphelion.sophie.operation'],
    running:state.Running,paused:state.Paused,restarting:state.Restarting,dead:state.Dead};
}

export function requireAiContainerProfile(value,registration,identity,operationId) {
  const expected=aiContainerProfile(registration,identity,operationId),config=value?.Config,host=value?.HostConfig;
  const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
  requireCondition(value?.Image===registration.imageId && config?.User===expected.User && config.WorkingDir===expected.WorkingDir &&
    equal(config.Entrypoint,expected.Entrypoint) && (!config.Cmd || equal(config.Cmd,[])) && (!config.Env || equal(config.Env,[])) &&
    config.OpenStdin===false && config.Tty===false &&
    Object.entries(expected.Labels).every(([key,item])=>config.Labels?.[key]===item) && host?.Isolation==='hyperv' &&
    host.NetworkMode==='none' && host.CpuCount===4 && host.Memory===8589934592 && host.AutoRemove===false &&
    host.RestartPolicy?.Name==='no' && host.RestartPolicy.MaximumRetryCount===0 && host.LogConfig?.Type==='none' && !host.Privileged &&
    !(host.Binds?.length) && !(host.Devices?.length) && Object.keys(host.PortBindings??{}).length===0 &&
    Array.isArray(host.Mounts) && host.Mounts.length===4 && expected.HostConfig.Mounts.every(mount=>host.Mounts.some(item=>
      ['Type','Source','Target','ReadOnly'].every(key=>item[key]===mount[key]))) && Array.isArray(value.Mounts) && value.Mounts.length===4 &&
    expected.HostConfig.Mounts.every(mount=>value.Mounts.some(item=>item.Type===mount.Type && item.Source===mount.Source &&
      item.Destination===mount.Target && item.RW===!mount.ReadOnly)),
  'AI_CONTAINER_PROFILE_MISMATCH');
}
