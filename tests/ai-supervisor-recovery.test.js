import test from 'node:test';
import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile, rename, rmdir, rm, realpath } from 'node:fs/promises';
import { join, resolve, dirname, basename } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { acquireAiSupervisorOwnership } from '../apps/ai-supervisor/ownership.js';
import { provisionAiSupervisorJournal, openAiSupervisorJournal } from '../apps/ai-supervisor/journal.js';
import { createAiSupervisorSlot } from '../apps/ai-supervisor/slot.js';
import { aiContainerProfile } from '../apps/ai-supervisor/container-profile.js';
import { hash, inputs, deferred, inspected, engineFixture, json } from './fixtures/ai-supervisor.js';

const native={skip:process.platform!=='win32',timeout:15000};
async function fixture(t,{provision=true}={}) {
  const root=await mkdtemp(join(tmpdir(),'sophie-supervisor-recovery-')),fixed=inputs(),journals=new Set();
  const bootRoot=join(root,'boots'),providerDirectory=join(root,'provider'),directory=join(root,'state');
  for(const path of [bootRoot,providerDirectory,directory])await mkdir(path);
  fixed.registration={...fixed.registration,bootRoot,providerDirectory};
  const path=join(directory,`slot-${fixed.registration.installationId}.json`);
  const open=async()=>{const journal=await openAiSupervisorJournal({...fixed,directory});journals.add(journal);return journal;};
  t.after(async()=>{
    for(const journal of journals)await journal.close();
    // Only this fresh synthetic fixture is removed, after resolving and checking its exact absolute root.
    assert.equal(await realpath(root),resolve(root));assert.equal(dirname(resolve(root)),resolve(tmpdir()));
    assert.ok(basename(root).startsWith('sophie-supervisor-recovery-'));await rm(root,{recursive:true});
  });
  if(provision)await provisionAiSupervisorJournal({...fixed,directory});
  return {...fixed,root,directory,path,open,read:async()=>JSON.parse(await readFile(path,'utf8')).state};
}
async function ownerChild(t,f,phase,containerId) {
  const child=fork(fileURLToPath(new URL('./fixtures/ai-supervisor-owner.mjs',import.meta.url)),[],{
    execArgv:[],windowsHide:true,stdio:['ignore','ignore','ignore','ipc'],env:{SystemRoot:process.env.SystemRoot??''},
  });
  const closed=new Promise(resolve=>child.once('close',resolve));
  t.after(async()=>{if(child.exitCode===null && child.signalCode===null)child.kill();await closed;});
  const ready=new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(Error('SYNTHETIC_OWNER_START_TIMEOUT')),3000);
    child.once('error',error=>{clearTimeout(timer);reject(error);});
    child.once('message',message=>{clearTimeout(timer);message.ready?resolve(message):reject(Error('SYNTHETIC_OWNER_START_FAILED'));});
  });
  child.send({registration:f.registration,directory:f.directory,identity:f.identity,operationId:f.operationId,containerId,phase});
  await ready;return {async crash(){assert.equal(child.kill(),true);await closed;}};
}
async function launch(controller,f) {
  await controller.quiesce();let state=controller.status().journal;
  state=await controller.prepare({revision:state.revision,identity:f.identity,operationId:f.operationId});
  state=await controller.create({revision:state.revision});
  return controller.start({revision:state.revision,beforeStart:async()=>true});
}

test('DS04-R01 Windows pipe ownership rejects a second owner and releases after explicit close',native,async()=>{
  const id=hash(),first=await acquireAiSupervisorOwnership(id);
  try {await assert.rejects(acquireAiSupervisorOwnership(id),/AI_SUPERVISOR_OWNER_BUSY/);assert.equal(first.signal.aborted,false);}
  finally {await first.close();}
  const second=await acquireAiSupervisorOwnership(id);await second.close();assert.equal(second.signal.aborted,true);
});

test('DS04-R02 abrupt child exit releases kernel ownership and preserves the last flushed journal stage',native,async t=>{
  const f=await fixture(t),id=hash(),child=await ownerChild(t,f,'created',id);
  await assert.rejects(f.open(),/AI_SUPERVISOR_OWNER_BUSY/);assert.equal((await f.read()).phase,'created');
  await child.crash();const journal=await f.open();assert.equal(journal.snapshot().containerId,id);assert.equal(journal.snapshot().phase,'created');
});

test('DS04-R03 missing or corrupt journal fails closed; explicit provisioning never replaces existing state',native,async t=>{
  const f=await fixture(t,{provision:false});await assert.rejects(f.open(),/AI_SUPERVISOR_JOURNAL_UNAVAILABLE/);
  await provisionAiSupervisorJournal(f);const initial=await readFile(f.path,'utf8');
  await assert.rejects(provisionAiSupervisorJournal(f),error=>error.code==='EEXIST');assert.equal(await readFile(f.path,'utf8'),initial);
  await writeFile(f.path,'{"state":null,"sha256":"invalid"}');await assert.rejects(f.open(),/AI_SUPERVISOR_JOURNAL_UNAVAILABLE/);
  assert.equal(await readFile(f.path,'utf8'),'{"state":null,"sha256":"invalid"}');
  await writeFile(f.path,initial);const journal=await f.open();assert.equal(journal.snapshot().phase,'empty');
});

test('DS04-R04 journal transitions fence stale revisions, reject illegal stages and preserve immutable identity',native,async t=>{
  const f=await fixture(t),journal=await f.open();
  assert.throws(()=>journal.begin({revision:0,identity:{...f.identity,profileHash:hash()},operationId:f.operationId}),/AI_CONTAINER_SCOPE_INVALID/);
  let state=await journal.begin({revision:0,identity:f.identity,operationId:f.operationId});
  state.identity.bootId=hash();assert.deepEqual(journal.snapshot().identity,f.identity);
  assert.throws(()=>journal.creating({revision:0}),/AI_SUPERVISOR_REVISION_STALE/);
  assert.throws(()=>journal.starting({revision:1}),/AI_SUPERVISOR_PHASE_INVALID/);
  state=await journal.creating({revision:1});assert.equal(state.revision,2);assert.equal(state.createPending,true);
  await journal.close();const recovered=await f.open();assert.deepEqual(recovered.snapshot(),await f.read());
});

test('DS04-R05 composed slot persists each mutation intent before Engine HTTP and revokes boot files before removal',native,async t=>{
  const f=await fixture(t),journal=await f.open(),engine=await engineFixture(t,f),seen=[];
  engine.hook=async(req)=>{if(req.method!=='GET')seen.push({method:req.method,path:req.url,state:await f.read()});};
  const controller=createAiSupervisorSlot({registration:f.registration,journal,docker:engine.slot});
  assert.throws(()=>controller.prepare({revision:0,identity:f.identity,operationId:f.operationId}),/AI_SUPERVISOR_NOT_READY/);
  const running=await launch(controller,f);assert.equal(running.phase,'running');assert.equal(engine.container.State.Running,true);
  const boot=join(f.registration.bootRoot,f.identity.bootId);await mkdir(boot);await writeFile(join(boot,'boot.json'),'{}');await writeFile(join(boot,'lease.json'),'{}');
  const receipt=await controller.quiesce();assert.equal(receipt.removed,true);assert.equal(controller.status().journal.phase,'empty');
  await assert.rejects(readFile(join(boot,'boot.json')),error=>error.code==='ENOENT');await assert.rejects(readFile(join(boot,'lease.json')),error=>error.code==='ENOENT');
  assert.deepEqual(seen.map(item=>item.state.phase),['creating','starting','removing']);
  assert.equal(seen[0].state.createPending,true);assert.equal(seen[1].state.containerId,engine.id);assert.equal(seen[2].state.containerId,engine.id);
  await controller.close();assert.equal(controller.status().recovered,false);
});

test('DS04-R06 crash recovery removes created, starting and running containers without replaying create/start',native,async t=>{
  for(const phase of ['created','starting','running']){
    const f=await fixture(t),engine=await engineFixture(t,f),child=await ownerChild(t,f,phase,engine.id);
    engine.container=inspected(aiContainerProfile(f.registration,f.identity,f.operationId),engine.slot.name,engine.id);
    engine.container.State.Running=phase!=='created';await child.crash();
    const journal=await f.open(),controller=createAiSupervisorSlot({registration:f.registration,journal,docker:engine.newSlot()});
    const result=await controller.quiesce();assert.equal(result.removed,true);assert.equal(controller.status().journal.phase,'empty');
    assert.equal(engine.calls.some(call=>call.method==='POST'),false);assert.equal(engine.container,null);await controller.close();
  }
});

test('DS04-R07 unacknowledged create stays durable while absent, then recovers its late observed container',native,async t=>{
  const f=await fixture(t),engine=await engineFixture(t,f),child=await ownerChild(t,f,'creating',engine.id);await child.crash();
  let journal=await f.open(),controller=createAiSupervisorSlot({registration:f.registration,journal,docker:engine.newSlot()});
  await assert.rejects(controller.quiesce(),/AI_SUPERVISOR_CREATE_UNRESOLVED/);assert.equal((await f.read()).createPending,true);
  await assert.rejects(controller.close(),/AI_SUPERVISOR_CREATE_UNRESOLVED/);
  engine.container=inspected(aiContainerProfile(f.registration,f.identity,f.operationId),engine.slot.name,engine.id);
  journal=await f.open();controller=createAiSupervisorSlot({registration:f.registration,journal,docker:engine.newSlot()});
  await controller.quiesce();assert.equal((await f.read()).phase,'empty');assert.equal(engine.calls.some(call=>call.method==='POST'),false);await controller.close();
});

test('DS04-R08 recovery verifies a vanished known ID and rejects another operation in the same installation slot',native,async t=>{
  const f=await fixture(t),engine=await engineFixture(t,f),child=await ownerChild(t,f,'starting',engine.id);await child.crash();
  const journal=await f.open(),controller=createAiSupervisorSlot({registration:f.registration,journal,docker:engine.newSlot()});
  engine.container=inspected(aiContainerProfile(f.registration,{...f.identity,bootId:hash()},f.operationId),engine.slot.name,engine.id);
  await assert.rejects(controller.quiesce(),/AI_SUPERVISOR_OBSERVATION_MISMATCH/);assert.equal(engine.calls.some(call=>call.method==='DELETE'),false);
  engine.container=null;await controller.quiesce();assert.equal(engine.calls.at(-1).path,`/v1.54/containers/${engine.id}/json`);
  assert.equal((await f.read()).phase,'empty');await controller.close();
});

test('DS04-R09 quiesce cancels stalled start approval and a late approval cannot dispatch a start',native,async t=>{
  const f=await fixture(t),journal=await f.open(),engine=await engineFixture(t,f),controller=createAiSupervisorSlot({registration:f.registration,journal,docker:engine.slot});
  await controller.quiesce();let state=await controller.prepare({revision:0,identity:f.identity,operationId:f.operationId});
  state=await controller.create({revision:state.revision});const entered=deferred(),answer=deferred();
  const pending=assert.rejects(controller.start({revision:state.revision,beforeStart:()=>{entered.resolve();return answer.promise;}}),/AI_SUPERVISOR_START_NOT_APPROVED/);
  await entered.promise;await controller.quiesce();await pending;answer.resolve(true);await new Promise(resolve=>setImmediate(resolve));
  assert.equal(engine.calls.some(call=>call.path.endsWith('/start')),false);assert.equal(controller.status().journal.phase,'empty');await controller.close();
});

test('DS04-R10 start approval has its own bound; failure leaves the created container removable',native,async t=>{
  const f=await fixture(t),journal=await f.open(),engine=await engineFixture(t,f),controller=createAiSupervisorSlot({registration:f.registration,journal,docker:engine.slot});
  await controller.quiesce();let state=await controller.prepare({revision:0,identity:f.identity,operationId:f.operationId});state=await controller.create({revision:state.revision});
  await assert.rejects(controller.start({revision:state.revision,beforeStart:()=>new Promise(()=>{})}),/AI_SUPERVISOR_START_NOT_APPROVED/);
  assert.equal((await f.read()).phase,'created');assert.equal(engine.calls.some(call=>call.path.endsWith('/start')),false);await controller.close();
});

test('DS04-R11 bootstrap cleanup failure still attempts container removal and retains the unresolved journal',native,async t=>{
  const f=await fixture(t),journal=await f.open(),engine=await engineFixture(t,f),controller=createAiSupervisorSlot({registration:f.registration,journal,docker:engine.slot});
  await launch(controller,f);const boot=join(f.registration.bootRoot,f.identity.bootId);await mkdir(boot);await mkdir(join(boot,'lease.json'));
  await assert.rejects(controller.quiesce(),/AI_BOOT_CLEANUP_UNCONFIRMED/);assert.equal(engine.container,null);assert.equal((await f.read()).phase,'removing');
  await rmdir(join(boot,'lease.json'));await controller.quiesce();assert.equal((await f.read()).phase,'empty');await controller.close();
});

test('DS04-R12 failed durable create-intent write prevents Engine mutation and disables the journal',native,async t=>{
  const f=await fixture(t),journal=await f.open(),engine=await engineFixture(t,f),controller=createAiSupervisorSlot({registration:f.registration,journal,docker:engine.slot});
  await controller.quiesce();const state=await controller.prepare({revision:0,identity:f.identity,operationId:f.operationId});
  await rename(f.path,f.path+'.saved');await mkdir(f.path);
  await assert.rejects(controller.create({revision:state.revision}),/AI_SUPERVISOR_JOURNAL_UNAVAILABLE/);
  assert.equal(engine.calls.some(call=>call.method==='POST'),false);assert.equal(journal.status().available,false);
  await assert.rejects(controller.close(),/AI_SUPERVISOR_JOURNAL_UNAVAILABLE/);
  await rmdir(f.path);await rename(f.path+'.saved',f.path);const recovered=await f.open();assert.equal(recovered.snapshot().phase,'prepared');
});

test('DS04-R13 journal write failure does not prevent removing an already running owned worker',native,async t=>{
  const f=await fixture(t),journal=await f.open(),engine=await engineFixture(t,f),controller=createAiSupervisorSlot({registration:f.registration,journal,docker:engine.slot});
  await launch(controller,f);await rename(f.path,f.path+'.saved');await mkdir(f.path);
  await assert.rejects(controller.quiesce(),/AI_SUPERVISOR_JOURNAL_UNAVAILABLE/);
  assert.equal(engine.container,null);assert.equal(journal.status().available,false);assert.equal(controller.status().recovered,false);
  assert.throws(()=>controller.qualified(),/AI_SUPERVISOR_NOT_READY/);await assert.rejects(controller.close(),/AI_SUPERVISOR_JOURNAL_UNAVAILABLE/);
  await rmdir(f.path);await rename(f.path+'.saved',f.path);const reopened=await f.open();
  const recovery=createAiSupervisorSlot({registration:f.registration,journal:reopened,docker:engine.newSlot()});
  await recovery.quiesce();assert.equal((await f.read()).phase,'empty');await recovery.close();
});

test('DS04-R14 a create acknowledgement remains useful after failed profile validation and lost container visibility',native,async t=>{
  const f=await fixture(t),journal=await f.open(),engine=await engineFixture(t,f),controller=createAiSupervisorSlot({registration:f.registration,journal,docker:engine.slot});
  await controller.quiesce();const state=await controller.prepare({revision:0,identity:f.identity,operationId:f.operationId});
  engine.hook=(req,res,body)=>{if(req.url.includes('/create?')){
    engine.container=inspected(body,engine.slot.name,engine.id);engine.container.Mounts[2].RW=true;json(res,201,{Id:engine.id,Warnings:[]});return true;
  }};
  await assert.rejects(controller.create({revision:state.revision}),/AI_CONTAINER_PROFILE_MISMATCH/);
  assert.equal(journal.snapshot().containerId,null);assert.equal(engine.slot.knownContainer().id,engine.id);
  await assert.rejects(engine.slot.remove({recovery:{identity:f.identity,operationId:f.operationId,imageId:f.registration.imageId,id:hash(),createPending:true}}),/AI_CONTAINER_RECOVERY_MISMATCH/);
  engine.hook=null;engine.container=null;
  await controller.quiesce();assert.equal(journal.snapshot().phase,'empty');assert.equal(engine.calls.at(-1).path,`/v1.54/containers/${engine.id}/json`);
  assert.equal(engine.slot.knownContainer(),null);await controller.close();
});
