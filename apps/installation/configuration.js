import { createHash } from 'node:crypto';
import { open } from 'node:fs/promises';
import { win32 } from 'node:path';
import { readAiWorkerFile } from '../knowledge-worker/bootstrap.js';
import { requireCondition, requireKeys } from '../../contracts/validation.js';

const code='AI_INSTALLATION_INVALID';
const hash=value=>typeof value==='string' && /^[a-f0-9]{64}$/u.test(value) && value!=='0'.repeat(64);
export const installationHash=value=>createHash('sha256').update(value).digest('hex');
export const INSTALLATION_ROOT='C:\\Aphelion\\Sophie';
const MAXIMUM_LIFETIME=86400000;
const entrypoints=Object.freeze({core:'source/apps/core/installed.mjs',supervisor:'source/apps/inference-host/installed.mjs'});
const required=Object.freeze(['runtime/node.exe','runtime/LICENSE','source/package.json','source/apps/knowledge-worker/main.mjs']);

export function installationPaths(role,root=INSTALLATION_ROOT) {
  requireCondition(Object.hasOwn(entrypoints,role),code);
  return Object.freeze({configuration:win32.join(root,'trust',`${role}.json`),packageRoot:win32.join(root,'package'),
    manifest:win32.join(root,'package','source','installation.manifest')});
}

async function hashFile(path,limit) {
  const file=await open(path,'r'),digest=createHash('sha256'),buffer=Buffer.alloc(1048576);let total=0;
  try {
    requireCondition((await file.stat()).isFile(),'AI_PACKAGE_CHANGED');
    for(;;){const {bytesRead}=await file.read(buffer,0,buffer.length,null);if(bytesRead===0)break;
      total+=bytesRead;requireCondition(total<=limit,'AI_PACKAGE_CHANGED');digest.update(buffer.subarray(0,bytesRead));}
    return {sha256:digest.digest('hex'),size:total};
  } finally {await file.close();}
}

/** Recomputes every package file hash. OS ACLs protect the package; this detects drift from the qualified release. */
export async function verifyInstallationManifest({role,text,packageRoot,hash:digest=hashFile}) {
  requireCondition(typeof text==='string' && text.endsWith('\n'),'AI_MANIFEST_INVALID');
  const seen=new Set();let total=0;
  for(const line of text.slice(0,-1).split('\n')){
    const match=/^([a-f0-9]{64}) ((?:runtime|source)\/(?:[a-zA-Z0-9_@-][a-zA-Z0-9_.@-]*\/)*[a-zA-Z0-9_@-][a-zA-Z0-9_.@-]*)$/u.exec(line);
    requireCondition(match && seen.size<4096 && !seen.has(match[2].toLowerCase()),'AI_MANIFEST_INVALID');seen.add(match[2].toLowerCase());
    const result=await digest(win32.join(packageRoot,...match[2].split('/')),268435456);
    total+=result.size;requireCondition(total<=536870912 && result.sha256===match[1],'AI_PACKAGE_CHANGED');
  }
  requireCondition([...required,entrypoints[role]].every(name=>seen.has(name.toLowerCase())),'AI_MANIFEST_INCOMPLETE');
}

/**
 * One operator-written JSON file per role under trust\, readable only by that role's service SID.
 * Only core receives Discord/database settings; only the supervisor receives provider fingerprints.
 * Expiry is bounded to 24 hours, matching the qualification receipt lifetime.
 */
export async function loadInstallationConfiguration(role,{root=INSTALLATION_ROOT,read=readAiWorkerFile,hash:digest=hashFile,now=Date.now()}={}) {
  const paths=installationPaths(role,root),value=JSON.parse(await read(paths.configuration,65536));
  requireKeys(value,['version','role','installationId','expires','manifest','release','qualification','keys',role==='core'?'core':'acceptedFingerprints'],code);
  requireCondition(value.version===1 && value.role===role && hash(value.installationId) && hash(value.manifest) &&
    Number.isSafeInteger(value.expires) && value.expires>now && value.expires-now<=MAXIMUM_LIFETIME,code);
  requireKeys(value.keys,['core'],code);requireCondition(hash(value.keys.core),code);
  if(role==='supervisor')requireCondition(Array.isArray(value.acceptedFingerprints),code);
  else requireCondition(value.core!==null && typeof value.core==='object' && !Array.isArray(value.core),code);
  const manifest=await read(paths.manifest,1048576);
  requireCondition(installationHash(manifest)===value.manifest,'AI_PACKAGE_CHANGED');
  await verifyInstallationManifest({role,text:manifest,packageRoot:paths.packageRoot,hash:digest});
  const owner=Object.freeze({version:'1',role,installation:value.installationId,expires:String(value.expires)});
  const {version:_version,role:_role,expires:_expires,manifest:_manifest,...configuration}=value;
  return Object.freeze({paths,owner,configuration:Object.freeze(configuration)});
}
