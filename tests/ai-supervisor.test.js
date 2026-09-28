import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, rmdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { hash, inputs, deferred, inspected, engineFixture, json } from './fixtures/ai-supervisor.js';
import { registeredAiContainer, aiContainerProfile, requireAiContainerProfile } from '../apps/ai-supervisor/container-profile.js';
import { prepareAiWorkerBoot } from '../apps/ai-supervisor/bootstrap.js';
import { AI_WORKER_FILES, loadAiWorkerBootstrap, readAiWorkerFile, createAiWorkerLease } from '../apps/knowledge-worker/bootstrap.js';

const native={skip:process.platform!=='win32',timeout:15000};

test('DS04-S01 registration confines exact worker, disjoint Windows mounts and observed profile',()=>{
  const {registration,identity,operationId}=inputs(),name='synthetic',id=hash();
  for(const path of ['C:\\root\\..\\provider','C:\\root\\trailing.','C:\\root\\NUL','C:\\root\\file:stream','\\\\host\\share'])
    assert.throws(()=>registeredAiContainer({...registration,providerDirectory:path}),/AI_CONTAINER_REGISTRATION_INVALID/);
  for(const path of [registration.bootRoot,registration.bootRoot+'\\provider','C:\\parent']){
    const bootRoot=path==='C:\\parent'?'C:\\parent\\boots':registration.bootRoot;
    assert.throws(()=>registeredAiContainer({...registration,bootRoot,providerDirectory:path}),/AI_CONTAINER_REGISTRATION_INVALID/);
  }
  assert.throws(()=>aiContainerProfile(registration,{...identity,releaseHash:hash()},operationId),/AI_CONTAINER_SCOPE_INVALID/);
  const profile=aiContainerProfile(registeredAiContainer(registration),identity,operationId),observed=inspected(profile,name,id);
  assert.equal(profile.HostConfig.Mounts.length,4);assert.equal(profile.HostConfig.NetworkMode,'none');
  assert.equal(profile.Labels['com.aphelion.sophie.transport'],'relay-v2');
  for(const mount of profile.HostConfig.Mounts.filter(item=>item.Type==='npipe')){
    assert.match(mount.Source,/\\sophie-ai-relay-(inference|egress)-/u);
    assert.equal(mount.Source.replace('sophie-ai-relay-','sophie-ai-'),mount.Target);
    const direct=structuredClone(observed);direct.HostConfig.Mounts.find(item=>item.Source===mount.Source).Source=mount.Target;
    assert.throws(()=>requireAiContainerProfile(direct,registration,identity,operationId),/AI_CONTAINER_PROFILE_MISMATCH/);
  }
  requireAiContainerProfile(observed,registration,identity,operationId);
  for(const alter of [v=>v.Config.Env=['HTTP_PROXY=http://synthetic'],v=>v.HostConfig.Isolation='process',v=>v.Mounts[2].RW=true,
    v=>v.Mounts[3].Source='C:\\unexpected',v=>v.HostConfig.RestartPolicy.Name='always',v=>v.HostConfig.Binds=['C:\\root:C:\\root']]){
    const bad=structuredClone(observed);alter(bad);assert.throws(()=>requireAiContainerProfile(bad,registration,identity,operationId),/AI_CONTAINER_PROFILE_MISMATCH/);
  }
});

test('DS04-S02 fixed Engine API creates, starts once, projects safe status and verifies deletion',async t=>{
  const f=await engineFixture(t);assert.equal(await f.slot.qualified(),true);assert.deepEqual(await f.create(),{id:f.id});
  assert.equal(f.slot.status().startPrepared,true);assert.deepEqual(await f.start(),{id:f.id,running:true});
  await assert.rejects(f.start(),/AI_CONTAINER_START_NOT_PREPARED/);
  const safe=await f.slot.inspect();assert.deepEqual(safe.identity,f.identity);assert.equal(safe.running,true);
  assert.equal(Object.hasOwn(safe,'Config'),false);assert.equal(Object.hasOwn(safe,'HostConfig'),false);
  assert.deepEqual(await f.slot.remove(),{removed:true,id:f.id});assert.equal(await f.slot.inspect(),null);
  assert.equal(f.calls.filter(call=>call.path.endsWith('/start')).length,1);
  assert.equal(f.calls.filter(call=>call.method==='DELETE')[0].path,`/v1.54/containers/${f.id}?force=true&v=false`);
});

test('DS04-S17 independent owner records require a disjoint read-only trust mount',()=>{
  const f=inputs(),registration={...f.registration,trustDirectory:'C:\\synthetic-trust'};
  for(const trustDirectory of [f.registration.bootRoot,f.registration.providerDirectory,f.registration.bootRoot+'\\trust'])
    assert.throws(()=>registeredAiContainer({...registration,trustDirectory}),/AI_CONTAINER_REGISTRATION_INVALID/);
  const profile=aiContainerProfile(registeredAiContainer(registration),f.identity,f.operationId),observed=inspected(profile,'synthetic',hash());
  assert.equal(profile.HostConfig.Mounts.length,5);assert.equal(profile.HostConfig.Mounts[4].Target,'C:\\sophie-trust');
  requireAiContainerProfile(observed,registration,f.identity,f.operationId);
  for(const alter of [value=>value.Mounts[4].RW=true,value=>value.HostConfig.Mounts[4].ReadOnly=false,value=>value.Mounts.pop()]){
    const bad=structuredClone(observed);alter(bad);assert.throws(()=>requireAiContainerProfile(bad,registration,f.identity,f.operationId),/AI_CONTAINER_PROFILE_MISMATCH/);
  }
});

test('DS04-S03 ownership and image environment mismatches cannot start or remove another slot',async t=>{
  const f=await engineFixture(t);await f.create();f.container.Config.Labels['com.aphelion.sophie.installation']=hash();
  await assert.rejects(f.start(),/AI_CONTAINER_NOT_OWNED/);await assert.rejects(f.slot.remove(),/AI_CONTAINER_NOT_OWNED/);
  assert.equal(f.calls.some(call=>call.method==='DELETE'||call.path.endsWith('/start')),false);
  f.hook=(req,res)=>{if(req.url.includes('/images/')){json(res,200,{Id:f.registration.imageId,Os:'windows',Architecture:'amd64',
    Config:{...aiContainerProfile(f.registration,f.identity,f.operationId),Env:['SYNTHETIC_SECRET=unapproved']}});return true;}};
  await assert.rejects(f.slot.qualified(),/AI_CONTAINER_IMAGE_UNQUALIFIED/);
});

test('DS04-S04 changed observed mount prevents start and leaves owned removal available',async t=>{
  const f=await engineFixture(t);await f.create();f.container.Mounts[2].RW=true;
  await assert.rejects(f.start(),/AI_CONTAINER_PROFILE_MISMATCH/);
  assert.equal(f.calls.some(call=>call.path.endsWith('/start')),false);await f.slot.remove();
});

test('DS04-S05 cancelled accepted create remains uncertain until the matching slot is removed',async t=>{
  const f=await engineFixture(t),abort=new AbortController(),entered=deferred();
  f.hook=(req,_res,body)=>{if(req.url.includes('/create?')){f.container=inspected(body,f.slot.name,f.id);entered.resolve();return true;}};
  const failed=assert.rejects(f.create(abort.signal),/AI_CONTAINER_OPERATION_UNCONFIRMED/);await entered.promise;abort.abort();await failed;
  assert.equal(f.slot.status().uncertain,'create');await assert.rejects(f.create(),/AI_CONTAINER_RECONCILIATION_REQUIRED/);
  await assert.rejects(f.start(),/AI_CONTAINER_START_NOT_PREPARED/);f.hook=null;
  await f.slot.remove();assert.equal(f.slot.status().uncertain,null);await f.create();
});

test('DS04-S06 absent uncertain create cannot certify cleanup; late creation is subsequently reconciled',async t=>{
  const f=await engineFixture(t),abort=new AbortController(),entered=deferred();let delayed;
  f.hook=(req,_res,body)=>{if(req.url.includes('/create?')){delayed=body;entered.resolve();return true;}};
  const failed=assert.rejects(f.create(abort.signal),/AI_CONTAINER_OPERATION_UNCONFIRMED/);await entered.promise;abort.abort();await failed;
  f.hook=null;await assert.rejects(f.slot.remove(),/AI_CONTAINER_REMOVAL_UNCONFIRMED/);
  f.container=inspected(delayed,f.slot.name,f.id);await f.slot.remove();assert.equal(f.slot.status().uncertain,null);
});

test('DS04-S07 cancelled accepted start is never retried and requires exact owned removal',async t=>{
  const f=await engineFixture(t),abort=new AbortController(),entered=deferred();await f.create();
  f.hook=(req)=>{if(req.url.endsWith('/start')){f.container.State.Running=true;entered.resolve();return true;}};
  const failed=assert.rejects(f.start(abort.signal),/AI_CONTAINER_OPERATION_UNCONFIRMED/);await entered.promise;abort.abort();await failed;
  assert.equal(f.slot.status().uncertain,'start');await assert.rejects(f.start(),/AI_CONTAINER_START_NOT_PREPARED/);
  f.hook=null;await f.slot.remove();assert.equal(f.calls.filter(call=>call.path.endsWith('/start')).length,1);
});

test('DS04-S08 a deletion acknowledgement without observed absence is insufficient',async t=>{
  const f=await engineFixture(t);await f.create();await f.start();
  f.hook=(req,res)=>{if(req.method==='DELETE'){json(res,204);return true;}};
  await assert.rejects(f.slot.remove(),/AI_CONTAINER_REMOVAL_UNCONFIRMED/);assert.ok(f.container);
  f.hook=null;await f.slot.remove();assert.equal(f.container,null);
});

test('DS04-S09 Engine transport rejects oversized, malformed and truncated replies with redacted errors',async t=>{
  const f=await engineFixture(t);
  for(const reply of [res=>res.end('not json'),res=>res.end('x'.repeat(262145)),res=>{res.writeHead(200,{'content-length':1000});res.end('{}');}]){
    f.hook=(_req,res)=>{reply(res);return true;};await assert.rejects(f.slot.inspect(),/^Error: AI_CONTAINER_OPERATION_UNCONFIRMED$/);
  }
});

test('DS04-S10 concurrent operations are excluded and shutdown closes a pending HTTP request',async t=>{
  const f=await engineFixture(t),entered=deferred();f.hook=()=>{entered.resolve();return true;};
  const pending=assert.rejects(f.slot.inspect(),/AI_CONTAINER_OPERATION_UNCONFIRMED/);await entered.promise;
  await assert.rejects(f.slot.qualified(),/AI_CONTAINER_OPERATION_BUSY/);await f.slot.close();await pending;
  assert.equal(f.slot.status().stopped,true);
});

test('DS04-S16 lost deletion reply reconciles a previously uncertain create by its discovered exact ID',async t=>{
  const f=await engineFixture(t),createAbort=new AbortController(),created=deferred();
  f.hook=(req,_res,body)=>{if(req.url.includes('/create?')){f.container=inspected(body,f.slot.name,f.id);created.resolve();return true;}};
  const failedCreate=assert.rejects(f.create(createAbort.signal),/AI_CONTAINER_OPERATION_UNCONFIRMED/);
  await created.promise;createAbort.abort();await failedCreate;
  const removeAbort=new AbortController(),removed=deferred();
  f.hook=(req)=>{if(req.method==='DELETE'){f.container=null;removed.resolve();return true;}};
  const failedRemove=assert.rejects(f.slot.remove({signal:removeAbort.signal}),/AI_CONTAINER_OPERATION_UNCONFIRMED/);
  await removed.promise;removeAbort.abort();await failedRemove;assert.equal(f.slot.status().uncertain,'create');
  f.hook=null;assert.deepEqual(await f.slot.remove(),{removed:true,id:f.id});assert.equal(f.slot.status().uncertain,null);
  assert.equal(f.calls.at(-1).path,`/v1.54/containers/${f.id}/json`);
});

async function bootFixture(t,{qualified=async()=>true,clock,monotonic}={}) {
  const root=await mkdtemp(join(tmpdir(),'sophie-supervisor-')),fixed=inputs(),bootRoot=join(root,'boots'),providerDirectory=join(root,'provider');
  await mkdir(bootRoot);await mkdir(providerDirectory);fixed.registration={...fixed.registration,bootRoot,providerDirectory};
  const boot=await prepareAiWorkerBoot({...fixed,acceptedFingerprints:['synthetic-supervisor'],qualified,clock,monotonic});
  const directory=join(bootRoot,fixed.identity.bootId);
  const reader=async(path,limit)=>path===AI_WORKER_FILES.provider?'synthetic-supervisor-provider-key':
    readAiWorkerFile(join(directory,path===AI_WORKER_FILES.bootstrap?'boot.json':'lease.json'),limit);
  t.after(async()=>{await boot.revoke();
    // These exact, test-created directories are removed only when empty; never recursively.
    await rmdir(directory);await rmdir(bootRoot);await rmdir(providerDirectory);await rmdir(root);});
  return {...fixed,boot,directory,reader};
}

test('DS04-S11 published bootstrap and renewal round-trip through the real bounded worker reader',native,async t=>{
  const f=await bootFixture(t);await assert.rejects(readFile(join(f.directory,'lease.json')),error=>error.code==='ENOENT');
  const loaded=await loadAiWorkerBootstrap(f.reader),inference=f.boot.channel('inference'),egress=f.boot.channel('egress');
  assert.deepEqual(loaded.ipcKey,inference.key);assert.deepEqual(loaded.egressKey,egress.key);assert.notDeepEqual(inference.key,egress.key);
  inference.key.fill(0);assert.notDeepEqual(f.boot.channel('inference').key,inference.key);
  const lease=createAiWorkerLease({identity:f.identity,qualificationHash:loaded.qualificationHash,key:loaded.leaseKey,read:f.reader});t.after(()=>lease.stop());
  assert.equal((await f.boot.renew()).sequence,1);await lease.start();assert.equal(await lease.current(),true);
  for(let n=2;n<=6;n++){assert.equal((await f.boot.renew()).sequence,n);assert.equal(await lease.current(),true);}
  assert.deepEqual((await readdir(f.directory)).sort(),['boot.json','lease.json']);
  await f.boot.revoke();assert.equal(await lease.current(),false);assert.deepEqual(await readdir(f.directory),[]);
  assert.throws(()=>f.boot.renew(),/AI_BOOT_PUBLICATION_REVOKED/);
  await assert.rejects(prepareAiWorkerBoot({...f,acceptedFingerprints:['synthetic-supervisor'],qualified:async()=>true}),error=>error.code==='EEXIST');
});

test('DS04-S12 revocation fences late qualification, drains renewal and removes bootstrap authority',native,async t=>{
  const entered=deferred(),answer=deferred(),f=await bootFixture(t,{qualified:()=>{entered.resolve();return answer.promise;}});
  const pending=assert.rejects(f.boot.renew(),/AI_BOOT_PUBLICATION_REVOKED/);await entered.promise;
  assert.throws(()=>f.boot.renew(),/AI_BOOT_PUBLICATION_REVOKED/);await f.boot.revoke();await pending;answer.resolve(true);
  await new Promise(resolve=>setImmediate(resolve));assert.deepEqual(await readdir(f.directory),[]);assert.equal(f.boot.signal.aborted,true);
});

test('DS04-S13 denied renewal deletes the previous lease and cannot heal after qualification recovers',native,async t=>{
  let allowed=true;const f=await bootFixture(t,{qualified:async()=>allowed});await f.boot.renew();allowed=false;
  await assert.rejects(f.boot.renew(),/AI_BOOT_PUBLICATION_REVOKED/);allowed=true;
  assert.throws(()=>f.boot.renew(),/AI_BOOT_PUBLICATION_REVOKED/);
  await assert.rejects(readFile(join(f.directory,'lease.json')),error=>error.code==='ENOENT');
});

test('DS04-S14 independent monotonic expiry rejects renewal after wall-clock rollback',native,async t=>{
  let now=10000,tick=0;const f=await bootFixture(t,{clock:()=>now,monotonic:()=>tick});await f.boot.renew();tick=5001;now=9000;
  assert.throws(()=>f.boot.renew(),/AI_BOOT_PUBLICATION_REVOKED/);assert.equal(f.boot.signal.aborted,true);
});

test('DS04-S15 stalled qualification times out without publishing and late success stays revoked',native,async t=>{
  const answer=deferred(),f=await bootFixture(t,{qualified:()=>answer.promise});
  await assert.rejects(f.boot.renew(),/AI_BOOT_PUBLICATION_REVOKED/);answer.resolve(true);
  assert.equal(f.boot.signal.aborted,true);await assert.rejects(readFile(join(f.directory,'lease.json')),error=>error.code==='ENOENT');
});
