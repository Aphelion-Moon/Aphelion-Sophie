import { win32 } from 'node:path';
import { requireCondition, requireKeys } from '../../contracts/validation.js';
import { canonicalAiWorkerRelease } from '../../modules/assistant/worker-release.js';
import { canonicalAiWorkerIdentity } from '../knowledge-worker/ipc-contract.js';

const hash=value=>typeof value==='string' && /^[a-f0-9]{64}$/u.test(value);
const absolute=value=>typeof value==='string' && /^[A-Za-z]:\\[^\x00-\x1f<>"|?*]+$/u.test(value) &&
  win32.normalize(value)===value && !value.endsWith('\\') && !value.slice(2).includes(':') &&
  value.slice(3).split('\\').every(part=>!/[. ]$/u.test(part) && !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu.test(part));
const serviceName=value=>typeof value==='string' && /^[A-Za-z][A-Za-z0-9-]{2,63}$/u.test(value);

/** No container image or mounts here: the worker is a plain OS process under its own restricted account. */
export function registeredAiWorker(value) {
  requireKeys(value,['installationId','serviceName','bootRoot','providerDirectory','release',...(Object.hasOwn(value??{},'trustDirectory')?['trustDirectory']:[])],'AI_WORKER_REGISTRATION_INVALID');
  requireCondition(hash(value.installationId) && serviceName(value.serviceName) &&
    absolute(value.bootRoot) && absolute(value.providerDirectory) &&
    ![value.bootRoot,value.providerDirectory].some((path,index,paths)=>
      path.toLowerCase()===paths[1-index].toLowerCase() || path.toLowerCase().startsWith(paths[1-index].toLowerCase()+'\\')),
  'AI_WORKER_REGISTRATION_INVALID');
  if(Object.hasOwn(value,'trustDirectory'))requireCondition(absolute(value.trustDirectory) &&
    [value.bootRoot,value.providerDirectory].every(path=>value.trustDirectory.toLowerCase()!==path.toLowerCase() &&
      !value.trustDirectory.toLowerCase().startsWith(path.toLowerCase()+'\\') && !path.toLowerCase().startsWith(value.trustDirectory.toLowerCase()+'\\')),
  'AI_WORKER_REGISTRATION_INVALID');
  return Object.freeze({...value,release:canonicalAiWorkerRelease(value.release)});
}

export function registeredAiWorkerIdentity(registration,identity) {
  const fixed=canonicalAiWorkerIdentity(identity),release=registration.release;
  requireCondition(['workerId','releaseHash','profileHash','provider','domain'].every(name=>fixed[name]===release[name]),'AI_WORKER_SCOPE_INVALID');
  return fixed;
}
