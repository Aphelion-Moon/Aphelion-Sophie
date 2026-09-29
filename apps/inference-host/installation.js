import { createHash } from 'node:crypto';
import { win32 } from 'node:path';
import { readAiWorkerFile } from '../knowledge-worker/bootstrap.js';
import { requireCondition, requireKeys } from '../../contracts/validation.js';

const code='AI_INSTALLATION_INVALID';
const hash=value=>typeof value==='string' && /^[a-f0-9]{64}$/u.test(value) && value!=='0'.repeat(64);
export const installationHash=value=>createHash('sha256').update(value).digest('hex');
const base='C:\\Aphelion\\Sophie';

export function installationPaths(role) {
  requireCondition(['supervisor','core'].includes(role),code);
  return Object.freeze({configuration: win32.join(base,'trust',`${role}.json`)});
}

/**
 * One plain JSON file per role, written once by the operator setup step and ACL'd so only that
 * role's own OS account (plus SYSTEM/Administrators) can read it. There is no native companion
 * independently verifying the reading process's identity the way the old pipe companion did;
 * that verification now happens at the OS layer — the account that can open this file at all
 * is the qualified identity.
 */
export async function loadInstallationConfiguration(role,read=readAiWorkerFile) {
  const paths=installationPaths(role),text=await read(paths.configuration,65536);
  const value=JSON.parse(text);
  requireKeys(value,['version','role','installationId','expires','release','qualification','keys',
    ...(role==='supervisor'?['acceptedFingerprints']:[])],code);
  requireCondition(value.version===1 && value.role===role && hash(value.installationId) &&
    /^\d{1,15}$/u.test(String(value.expires)) && Number.isSafeInteger(Number(value.expires)),code);
  requireKeys(value.keys,['core'],code);
  requireCondition(hash(value.keys.core),code);
  const owner=Object.freeze({version:'1',role,installation:value.installationId,expires:String(value.expires)});
  return Object.freeze({paths,owner,configuration:{release:value.release,qualification:value.qualification,keys:{...value.keys},
    ...(role==='supervisor'?{acceptedFingerprints:Object.freeze([...value.acceptedFingerprints])}:{})}});
}
