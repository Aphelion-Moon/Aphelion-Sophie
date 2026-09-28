import { open } from 'node:fs/promises';
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { requireCondition, requireKeys } from '../../contracts/validation.js';
import { canonicalAiWorkerIdentity } from './ipc-contract.js';

export const AI_WORKER_FILES=Object.freeze({bootstrap:'C:\\sophie-boot\\boot.json',lease:'C:\\sophie-boot\\lease.json',provider:'C:\\sophie-provider\\api-key.txt'});
const hex=value=>typeof value==='string' && /^[a-f0-9]{64}$/u.test(value);
const identityHash=identity=>createHash('sha256').update(JSON.stringify(['workerId','bootId','releaseHash','profileHash','provider','domain'].map(name=>identity[name]))).digest('hex');

export async function readAiWorkerFile(path,limit) {
  const file=await open(path,'r');
  try {
    requireCondition((await file.stat()).isFile(),'AI_BOOT_INVALID');
    const bytes=Buffer.alloc(limit+1);let length=0;
    while(length<bytes.length){const result=await file.read(bytes,length,bytes.length-length,null);if(result.bytesRead===0)break;length+=result.bytesRead;}
    requireCondition(length>0 && length<=limit,'AI_BOOT_INVALID');
    return new TextDecoder('utf8',{fatal:true}).decode(bytes.subarray(0,length));
  } finally {await file.close();}
}

export async function loadAiWorkerBootstrap(read=readAiWorkerFile) {
  const data=JSON.parse(await read(AI_WORKER_FILES.bootstrap,8192));
  requireKeys(data,['version','identity','qualificationHash','ipcKey','egressKey','leaseKey','acceptedFingerprints'],'AI_BOOT_INVALID');
  const identity=canonicalAiWorkerIdentity(data.identity);
  requireCondition(data.version===1 && [data.qualificationHash,data.ipcKey,data.egressKey,data.leaseKey].every(hex) &&
    new Set([data.ipcKey,data.egressKey,data.leaseKey]).size===3 && Array.isArray(data.acceptedFingerprints) &&
    data.acceptedFingerprints.length>0 && data.acceptedFingerprints.length<=16 &&
    data.acceptedFingerprints.every(value=>typeof value==='string' && /^[a-zA-Z0-9._-]{1,128}$/u.test(value)) &&
    new Set(data.acceptedFingerprints).size===data.acceptedFingerprints.length,'AI_BOOT_INVALID');
  const apiKey=(await read(AI_WORKER_FILES.provider,512)).trim();
  requireCondition(/^[a-zA-Z0-9_-]{16,256}$/u.test(apiKey),'AI_BOOT_INVALID');
  return Object.freeze({identity,qualificationHash:data.qualificationHash,ipcKey:Buffer.from(data.ipcKey,'hex'),
    egressKey:Buffer.from(data.egressKey,'hex'),leaseKey:Buffer.from(data.leaseKey,'hex'),acceptedFingerprints:Object.freeze([...data.acceptedFingerprints]),apiKey});
}

const leaseBytes=record=>JSON.stringify([record.version,record.identityHash,record.qualificationHash,record.sequence,record.issuedAt,record.expiresAt]);
const signature=(record,key)=>createHmac('sha256',key).update('sophie-worker-lease-v1:').update(leaseBytes(record)).digest();

/** Supervisor uses this only after actual current qualification. A signature is not itself evidence of OS containment. */
export function signAiWorkerLease({identity,qualificationHash,key,sequence,issuedAt,expiresAt}) {
  const fixed=canonicalAiWorkerIdentity(identity);
  requireCondition(Buffer.isBuffer(key) && key.length===32 && hex(qualificationHash) && Number.isSafeInteger(sequence) && sequence>=1 &&
    Number.isSafeInteger(issuedAt) && Number.isSafeInteger(expiresAt) && issuedAt>=0 && expiresAt>issuedAt && expiresAt-issuedAt<=5000,'AI_LEASE_INVALID');
  const record={version:1,identityHash:identityHash(fixed),qualificationHash,sequence,issuedAt,expiresAt};
  return {...record,mac:signature(record,key).toString('hex')};
}

/** One pending file read and a separate monotonic expiry timer. Expired/invalid/replayed authority never heals in place. */
export function createAiWorkerLease({identity,qualificationHash,key,read=readAiWorkerFile,clock=Date.now,monotonic=()=>performance.now()}) {
  const expected=identityHash(canonicalAiWorkerIdentity(identity));
  requireCondition(hex(qualificationHash) && Buffer.isBuffer(key) && key.length===32 && typeof read==='function','AI_LEASE_INVALID');
  const secret=Buffer.from(key),revoked=new AbortController();let sequence=0,mac=null,until=0,poll,expiry,pending=null,started=false;
  function stop(){if(revoked.signal.aborted)return;revoked.abort();secret.fill(0);clearTimeout(poll);clearTimeout(expiry);}
  function refresh() {
    if(pending)return pending;
    const checked=(async()=>{
      try {
        requireCondition(!revoked.signal.aborted,'AI_LEASE_INVALID');
        const record=JSON.parse(await read(AI_WORKER_FILES.lease,2048));
        requireKeys(record,['version','identityHash','qualificationHash','sequence','issuedAt','expiresAt','mac'],'AI_LEASE_INVALID');
        const now=clock();
        requireCondition(!revoked.signal.aborted && (sequence===0 || monotonic()<until) && record.version===1 && record.identityHash===expected && record.qualificationHash===qualificationHash &&
          Number.isSafeInteger(record.sequence) && record.sequence>=1 && record.sequence>=sequence &&
          Number.isSafeInteger(record.issuedAt) && Number.isSafeInteger(record.expiresAt) && record.issuedAt>=0 && record.issuedAt<=now &&
          record.expiresAt>now && record.expiresAt-record.issuedAt<=5000 && hex(record.mac) &&
          timingSafeEqual(Buffer.from(record.mac,'hex'),signature(record,secret)),'AI_LEASE_INVALID');
        if(record.sequence===sequence)requireCondition(record.mac===mac && monotonic()<until,'AI_LEASE_INVALID');
        else {
          sequence=record.sequence;mac=record.mac;until=monotonic()+record.expiresAt-now;clearTimeout(expiry);
          expiry=setTimeout(stop,Math.max(1,until-monotonic()));
        }
        return !revoked.signal.aborted;
      } catch {stop();return false;}
    })();
    let abort;
    const cancelled=new Promise(resolve=>{abort=()=>resolve(false);revoked.signal.addEventListener('abort',abort,{once:true});if(revoked.signal.aborted)abort();});
    pending=Promise.race([checked,cancelled]).finally(()=>{revoked.signal.removeEventListener('abort',abort);pending=null;});return pending;
  }
  async function schedule(){if(await refresh() && !revoked.signal.aborted)poll=setTimeout(()=>{void schedule();},500);}
  return Object.freeze({signal:revoked.signal,
    async start(){requireCondition(!started,'AI_LEASE_ALREADY_STARTED');started=true;
      // Missing or hung initial storage must also expire; there is no authorisation before the first valid record.
      expiry=setTimeout(stop,2000);requireCondition(await refresh() && !revoked.signal.aborted,'AI_LEASE_INVALID');
      poll=setTimeout(()=>{void schedule();},500);},
    async current(){return started && !revoked.signal.aborted && monotonic()<until && await refresh() && !revoked.signal.aborted && monotonic()<until;},
    stop,
  });
}
