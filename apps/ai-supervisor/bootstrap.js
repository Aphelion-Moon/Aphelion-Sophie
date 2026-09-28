import { lstat, mkdir, open, rename, unlink, rmdir } from 'node:fs/promises';
import { win32 } from 'node:path';
import { randomBytes } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { requireCondition } from '../../contracts/validation.js';
import { signAiWorkerLease } from '../knowledge-worker/bootstrap.js';
import { canonicalAiWorkerIdentity } from '../knowledge-worker/ipc-contract.js';
import { registeredAiContainer, registeredAiWorkerIdentity } from './container-profile.js';

const missingOkay=error=>{if(error.code!=='ENOENT')throw error;};

/** Recovery never reloads old secrets or renews an old boot. Only these two registered files are removed. */
export async function revokeAiWorkerBootFiles({registration,identity}) {
  const registered=registeredAiContainer(registration),fixed=canonicalAiWorkerIdentity(identity);
  const directory=win32.join(registered.bootRoot,fixed.bootId);
  try {
    const root=await lstat(registered.bootRoot),boot=await lstat(directory);
    requireCondition(root.isDirectory() && !root.isSymbolicLink() && boot.isDirectory() && !boot.isSymbolicLink(),'AI_BOOT_CLEANUP_UNCONFIRMED');
    await unlink(win32.join(directory,'lease.json')).catch(missingOkay);
    await unlink(win32.join(directory,'boot.json')).catch(missingOkay);
  } catch(error){if(error.code!=='ENOENT')throw Error('AI_BOOT_CLEANUP_UNCONFIRMED');}
}

/** Atomic visibility after a file flush, not a power-loss or ACL guarantee. The root is provisioned separately. */
async function publish(path,value,current) {
  const temporary=`${path}.${randomBytes(16).toString('hex')}.tmp`;
  try {
    const file=await open(temporary,'wx',0o600);
    try {await file.writeFile(JSON.stringify(value)+'\n','utf8');await file.sync();}finally{await file.close();}
    requireCondition(current(),'AI_BOOT_PUBLICATION_REVOKED');
    await rename(temporary,path);
    requireCondition(current(),'AI_BOOT_PUBLICATION_REVOKED');
  } finally {await unlink(temporary).catch(missingOkay);}
}

/** Supervisor-owned secrets. Only the purpose-specific channel key may cross its corresponding control interface. */
export async function prepareAiWorkerBoot({registration,identity,acceptedFingerprints,qualified,clock=Date.now,monotonic=()=>performance.now()}) {
  const registered=registeredAiContainer(registration),fixed=registeredAiWorkerIdentity(registered,identity);
  requireCondition(typeof qualified==='function' && Array.isArray(acceptedFingerprints) && acceptedFingerprints.length>0 &&
    acceptedFingerprints.length<=16 && acceptedFingerprints.every(value=>typeof value==='string' && /^[a-zA-Z0-9._-]{1,128}$/u.test(value)) &&
    new Set(acceptedFingerprints).size===acceptedFingerprints.length,'AI_BOOT_INVALID');
  const root=await lstat(registered.bootRoot);
  requireCondition(root.isDirectory() && !root.isSymbolicLink(),'AI_BOOT_ROOT_UNQUALIFIED');
  const directory=win32.join(registered.bootRoot,fixed.bootId),bootPath=win32.join(directory,'boot.json'),leasePath=win32.join(directory,'lease.json');
  // No reuse after a crash, even if an old directory looks empty. Its boot identity is consumed.
  await mkdir(directory,{mode:0o700});
  const keys={ipc:randomBytes(32),egress:randomBytes(32),lease:randomBytes(32)},revoked=new AbortController();
  let pending=null,closing=null,sequence=0,expiresAt=0,until=0,expiry;
  function invalidate(){if(!revoked.signal.aborted)revoked.abort();clearTimeout(expiry);Object.values(keys).forEach(key=>key.fill(0));}
  async function discard(){await unlink(leasePath).catch(missingOkay);await unlink(bootPath).catch(missingOkay);}
  function revoke() {
    if(closing)return closing;invalidate();
    // First remove current authority, then await a possible rename, then remove again.
    const removed=unlink(leasePath).catch(missingOkay);
    closing=(async()=>{await Promise.allSettled([removed,pending]);
      try {await discard();return {revoked:true};}catch{throw Error('AI_BOOT_CLEANUP_UNCONFIRMED');}})();return closing;
  }
  try {
    const bootstrap={version:1,identity:fixed,qualificationHash:registered.release.evidenceHash,
      ipcKey:keys.ipc.toString('hex'),egressKey:keys.egress.toString('hex'),leaseKey:keys.lease.toString('hex'),acceptedFingerprints:[...acceptedFingerprints]};
    requireCondition(new Set([bootstrap.ipcKey,bootstrap.egressKey,bootstrap.leaseKey]).size===3,'AI_BOOT_INVALID');
    await publish(bootPath,bootstrap,()=>!revoked.signal.aborted);
  } catch {invalidate();await discard();await rmdir(directory);throw Error('AI_BOOT_PUBLICATION_FAILED');}
  return Object.freeze({identity:fixed,signal:revoked.signal,
    channel(purpose) {
      requireCondition(!revoked.signal.aborted && ['inference','egress'].includes(purpose),'AI_BOOT_PUBLICATION_REVOKED');
      return {identity:fixed,key:Buffer.from(keys[purpose==='inference'?'ipc':'egress'])};
    },
    renew({signal}={}) {
      if(sequence>0 && monotonic()>=until)invalidate();
      requireCondition(!pending && !revoked.signal.aborted && !signal?.aborted,'AI_BOOT_PUBLICATION_REVOKED');
      const abort=new AbortController(),cancel=()=>abort.abort();let timer;
      revoked.signal.addEventListener('abort',cancel,{once:true});signal?.addEventListener('abort',cancel,{once:true});
      // A stalled qualification cannot keep publication alive, nor publish when it eventually returns.
      timer=setTimeout(cancel,2000);
      const current=()=>!abort.signal.aborted && !revoked.signal.aborted && !signal?.aborted && (sequence===0 || monotonic()<until);
      pending=(async()=>{
        let cancelled;
        try {
          const stopped=new Promise(resolve=>{cancelled=()=>resolve(false);abort.signal.addEventListener('abort',cancelled,{once:true});});
          const check=Promise.resolve().then(()=>qualified({identity:fixed,signal:abort.signal})).catch(()=>false);
          requireCondition(await Promise.race([check,stopped])===true && current(),'AI_BOOT_NOT_QUALIFIED');
          const issuedAt=clock(),issuedMonotonic=monotonic(),next=sequence+1;
          const record=signAiWorkerLease({identity:fixed,qualificationHash:registered.release.evidenceHash,key:keys.lease,
            sequence:next,issuedAt,expiresAt:issuedAt+5000});
          await publish(leasePath,record,()=>current() && clock()>=issuedAt && clock()<record.expiresAt && monotonic()<issuedMonotonic+5000);
          sequence=next;expiresAt=record.expiresAt;until=issuedMonotonic+5000;clearTimeout(expiry);
          expiry=setTimeout(invalidate,Math.max(1,until-monotonic()));return {sequence,expiresAt};
        } catch {invalidate();await unlink(leasePath).catch(missingOkay);throw Error('AI_BOOT_PUBLICATION_REVOKED');}
        finally {clearTimeout(timer);abort.signal.removeEventListener('abort',cancelled);revoked.signal.removeEventListener('abort',cancel);
          signal?.removeEventListener('abort',cancel);pending=null;}
      })();return pending;
    },
    status:()=>({revoked:revoked.signal.aborted,renewing:pending!==null,sequence,expiresAt}),
    revoke,
  });
}
