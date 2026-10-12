import { createHash } from 'node:crypto';
import { open } from 'node:fs/promises';
import { win32 } from 'node:path';
import { requireCondition, requireKeys } from '../../contracts/validation.js';

const code='AI_INSTALLATION_INVALID';
const hash=value=>typeof value==='string' && /^[a-f0-9]{64}$/u.test(value) && value!=='0'.repeat(64);
export const installationHash=value=>createHash('sha256').update(value).digest('hex');
export const INSTALLATION_ROOT='C:\\Aphelion\\Sophie';
const entrypoints=Object.freeze({core:'source/apps/core/installed.mjs',worker:'source/apps/knowledge-worker/main.mjs'});
const required=Object.freeze(['runtime/node.exe','runtime/LICENSE','source/package.json','source/apps/knowledge-worker/main.mjs']);

export function installationPaths(role,root=INSTALLATION_ROOT) {
  requireCondition(Object.hasOwn(entrypoints,role),code);
  return Object.freeze({configuration:win32.join(root,'trust',`${role}.json`),packageRoot:win32.join(root,'package'),
    manifest:win32.join(root,'package','source','installation.manifest'),provider:win32.join(root,'provider','api-key.txt')});
}

/** Bounded UTF-8 read of one regular file; never follows a size the caller did not allow. */
export async function readInstallationFile(path,limit) {
  const file=await open(path,'r');
  try {
    requireCondition((await file.stat()).isFile(),code);
    const bytes=Buffer.alloc(limit+1);let length=0;
    while(length<bytes.length){const result=await file.read(bytes,length,bytes.length-length,null);if(result.bytesRead===0)break;length+=result.bytesRead;}
    requireCondition(length>0 && length<=limit,code);
    return new TextDecoder('utf8',{fatal:true}).decode(bytes.subarray(0,length));
  } finally {await file.close();}
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

/** Recomputes every package file hash. OS ACLs protect the package; this detects drift from the installed release. */
export async function verifyInstallationManifest({role,text,packageRoot,hash:digest=hashFile}) {
  requireCondition(typeof text==='string' && text.endsWith('\n'),'AI_MANIFEST_INVALID');
  const seen=new Set();let total=0;
  for(const line of text.slice(0,-1).split('\n')){
    // Dotfiles occur in pinned node_modules; '.' and '..' segments never do.
    const match=/^([a-f0-9]{64}) ((?:runtime|source)(?:\/[a-zA-Z0-9_.@-]+)+)$/u.exec(line);
    requireCondition(match && match[2].split('/').every(part=>part!=='.' && part!=='..') && seen.size<4096 && !seen.has(match[2].toLowerCase()),'AI_MANIFEST_INVALID');
    seen.add(match[2].toLowerCase());
    const result=await digest(win32.join(packageRoot,...match[2].split('/')),268435456);
    total+=result.size;requireCondition(total<=536870912 && result.sha256===match[1],'AI_PACKAGE_CHANGED');
  }
  requireCondition([...required,entrypoints[role]].every(name=>seen.has(name.toLowerCase())),'AI_MANIFEST_INCOMPLETE');
}

/**
 * One operator-written JSON file per role under trust\, readable only by that role's service SID. Only core receives
 * Discord/database settings; only the worker receives the accepted provider model IDs. Both hold the channel key.
 * Integrity is checked when the role starts (every package file against the installed manifest); there is no expiry
 * and no daily renewal (owner decision, 12 October 2026).
 */
export async function loadInstallationConfiguration(role,{root=INSTALLATION_ROOT,read=readInstallationFile,hash:digest=hashFile}={}) {
  const paths=installationPaths(role,root),value=JSON.parse(await read(paths.configuration,65536));
  requireKeys(value,['version','role','installationId','manifest','release','qualification','keys',role==='core'?'core':'acceptedFingerprints'],code);
  requireCondition(value.version===2 && value.role===role && hash(value.installationId) && hash(value.manifest),code);
  requireKeys(value.keys,['channel'],code);requireCondition(hash(value.keys.channel),code);
  if(role==='worker')requireCondition(Array.isArray(value.acceptedFingerprints),code);
  else requireCondition(value.core!==null && typeof value.core==='object' && !Array.isArray(value.core),code);
  const manifest=await read(paths.manifest,1048576);
  requireCondition(installationHash(manifest)===value.manifest,'AI_PACKAGE_CHANGED');
  await verifyInstallationManifest({role,text:manifest,packageRoot:paths.packageRoot,hash:digest});
  const owner=Object.freeze({version:'2',role,installation:value.installationId});
  const {version:_version,role:_role,manifest:_manifest,...configuration}=value;
  return Object.freeze({paths,owner,configuration:Object.freeze(configuration)});
}
