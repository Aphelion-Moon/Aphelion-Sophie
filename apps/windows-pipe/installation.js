import { createHash } from 'node:crypto';
import { win32 } from 'node:path';
import { readAiWorkerFile } from '../knowledge-worker/bootstrap.js';
import { requireCondition, requireKeys } from '../../contracts/validation.js';

const code='AI_INSTALLATION_INVALID';
const hash=value=>typeof value==='string' && /^[a-f0-9]{64}$/u.test(value) && value!=='0'.repeat(64);
export const installationHash=value=>createHash('sha256').update(value).digest('hex');
const names=['version','role','installation','worker','release','profile','evidence','manifest','configuration',
  'userSid','serviceSid','supervisorSid','coreSid','egressSid','proxySid','guestSid','expires'];

/** Parsing does not establish trust. The native companion independently opens and holds these fixed files. */
export function parseInstallationOwner(text,role,now=Date.now()) {
  requireCondition(typeof text==='string' && text.length<=8192 && /^[\x20-\x7e\n]+\n$/u.test(text),code);
  const pairs=text.trimEnd().split('\n').map(line=>{const split=line.indexOf('=');return [line.slice(0,split),line.slice(split+1)];});
  const owner=Object.fromEntries(pairs);requireKeys(owner,names,code);requireCondition(pairs.length===names.length,code);
  requireCondition(owner.version==='1' && owner.role===role && ['supervisor','core','egress','worker'].includes(role) &&
    ['installation','worker','release','profile','evidence','manifest','configuration'].every(name=>hash(owner[name])) &&
    ['userSid','supervisorSid','coreSid','egressSid','proxySid','guestSid'].every(name=>/^S-1-(?:\d+-)+\d+$/u.test(owner[name])) &&
    ['supervisorSid','coreSid','egressSid'].every(name=>/^S-1-5-80-(?:\d+-){4}\d+$/u.test(owner[name])) &&
    new Set([owner.supervisorSid,owner.coreSid,owner.egressSid,owner.proxySid,owner.guestSid]).size===5 &&
    (role==='worker'?owner.serviceSid==='-' && owner.userSid===owner.guestSid:owner.serviceSid===owner[`${role}Sid`]) &&
    /^\d{1,15}$/u.test(owner.expires) && Number.isSafeInteger(Number(owner.expires)) && Number(owner.expires)>now && Number(owner.expires)-now<=86400000,code);
  return Object.freeze(owner);
}

export function installationPaths(role) {
  requireCondition(['supervisor','core','egress','worker'].includes(role),code);
  const base='C:\\Aphelion\\Sophie',worker=role==='worker';
  const trust=worker?'C:\\sophie-trust':`${base}\\trust`,source=worker?'C:\\sophie':`${base}\\package\\source`;
  return Object.freeze({trust,source,owner:win32.join(trust,`${role}.profile`),configuration:win32.join(trust,`${role}.json`),
    manifest:win32.join(source,'installation.manifest'),executable:win32.join(source,'apps\\windows-pipe\\sophie-pipe.exe')});
}

export async function loadInstallationConfiguration(role,read=readAiWorkerFile) {
  const paths=installationPaths(role),text=await read(paths.owner,8192),owner=parseInstallationOwner(text,role);
  const manifest=await read(paths.manifest,262144),configurationText=await read(paths.configuration,65536);
  requireCondition(installationHash(manifest)===owner.manifest && installationHash(configurationText)===owner.configuration,code);
  const entries=manifest.trimEnd().split('\n').map(line=>line.split(' '));
  requireCondition(manifest.endsWith('\n') && entries.length<=2048 && entries.every(([sha,path,...extra])=>hash(sha) && extra.length===0 &&
    /^(source|runtime)\/(?:[a-zA-Z0-9_-][a-zA-Z0-9_.-]*\/)*[a-zA-Z0-9_-][a-zA-Z0-9_.-]*$/u.test(path)) &&
    new Set(entries.map(([,path])=>path.toLowerCase())).size===entries.length,code);
  const sha256=entries.find(([,path])=>path==='source/apps/windows-pipe/sophie-pipe.exe')?.[0];requireCondition(hash(sha256),code);
  const configuration=JSON.parse(configurationText);
  requireCondition(configuration?.installationId===owner.installation && configuration.release?.workerId===owner.worker &&
    configuration.release.releaseHash===owner.release && configuration.release.profileHash===owner.profile &&
    configuration.release.evidenceHash===owner.evidence,code);
  return Object.freeze({paths,owner,ownerHash:installationHash(text),sha256,configuration});
}
