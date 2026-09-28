import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createAiControls, aiDigest } from '../../apps/core/storage/ai-controls.js';
import { aiWorkerCatalogue, createAiWorkerJournal } from '../../apps/core/storage/ai-worker-operations.js';
import { createAiOperationsRuntime } from '../../apps/core/runtime/ai-operations.js';
import { DEFAULT_AI_BUDGET } from '../../modules/assistant/budget.js';
import { DRAFT_PERSONALITY } from '../../modules/assistant/personality.js';

const release={name:'Synthetic Flash public',workerId:'1'.repeat(64),releaseHash:'2'.repeat(64),profileHash:'3'.repeat(64),evidenceHash:'4'.repeat(64),provider:'deepseek',domain:'public'};
const deferred=()=>{let resolve;const promise=new Promise(done=>resolve=done);return {promise,resolve};};
const tick=()=>new Promise(resolve=>setImmediate(resolve));

export async function runAiOperationsSuite(cluster,run) {
  const {adminPool:admin,corePool:pool,knowledgePool:knowledge}=cluster;let guild=1900;
  await admin.query('GRANT USAGE ON SCHEMA sophie_ai TO sophie_test_core');
  await admin.query('GRANT SELECT,INSERT,UPDATE ON sophie_ai.state,sophie_ai.publications,sophie_ai.budget_policies,sophie_ai.worker_state,sophie_ai.worker_requests TO sophie_test_core');
  async function fixture() {
    const actor={guildId:String(++guild),userId:'202',capabilityEpoch:1,policyVersion:1},catalogue=aiWorkerCatalogue([release]);
    const flags={permitted:true,qualified:true,quiescent:true,wrongAck:false,launchGate:null,drainGate:null},events=[];
    let runtime=null,physical=false,launched=0;
    const store=createAiControls({pool,guildId:actor.guildId,authorize:async(_action,candidate)=>flags.permitted && candidate===actor,
      inspectChannel:async()=>null,memberPresence:async()=>1,workerCatalogue:catalogue,workerOperationsAvailable:true,invalidate:()=>runtime?.invalidate()});
    for(const [kind,document] of [['configuration',{schemaVersion:1,enabled:false,deadlineMs:15000,channels:[],emojis:[]}],
      ['personality',DRAFT_PERSONALITY],['budget',{...DEFAULT_AI_BUDGET,priceValidUntil:Date.now()+60000}]]) {
      const input={actor,kind,expectedRevision:0,document},reviewed=await store.review(input);
      await store.publish({...input,requestId:aiDigest(randomUUID()),reviewSha256:reviewed.reviewSha256,confirmed:true});
    }
    const lifecycle={releases:[release],qualified:async()=>flags.qualified,
      async quiesce({operationId}){events.push('quiesce');if(flags.quiescent)physical=false;return {operationId,stopped:flags.quiescent};},
      async launch({identity,beforeStart}) {
        assert.equal(await beforeStart(),true);assert.equal(physical,false);physical=true;events.push('launch');launched++;
        if(flags.launchGate)await flags.launchGate.promise;
        return {provider:'deepseek',probe:async()=>{events.push('probe');return flags.wrongAck?{...identity,bootId:'f'.repeat(64)}:identity;},
          stop(){events.push('client-stop');}};
      }};
    const makeRuntime=()=>createAiOperationsRuntime({pool,guildId:actor.guildId,lifecycle,onFault:()=>events.push('fault'),
      createRuntime:()=>({async start(){events.push('lane-start');},async stop(){events.push('lane-stop');if(flags.drainGate)await flags.drainGate.promise;},
        invalidate(){events.push('invalidate');},prepare(){return 'synthetic-proof';},committed(){return 'synthetic-commit';}})});
    runtime=makeRuntime();
    const review=async()=>store.reviewWorker({actor,candidateId:catalogue[0].id,expectedRevision:(await store.workerStatus({actor})).desiredRevision});
    const request=async()=>{const reviewed=await review();return {actor,candidateId:reviewed.candidateId,expectedRevision:reviewed.expectedRevision,
      reviewSha256:reviewed.reviewSha256,requestId:aiDigest(randomUUID()),confirmed:true};};
    return {actor,store,runtime,makeRuntime,lifecycle,flags,events,request,review,journal:createAiWorkerJournal({pool,guildId:actor.guildId}),
      status:()=>store.workerStatus({actor}),physical:()=>physical,launches:()=>launched,
      start:()=>runtime.start({automatic:false}),async apply(){return store.applyWorker(await request());},
      async close(){flags.drainGate?.resolve();flags.launchGate?.resolve();flags.quiescent=true;await runtime.stop();}};
  }
  await run('DS09-O01 worker requests are capability checked, source-revision bound, idempotent and cannot enable processing',async()=>{
    const f=await fixture();try {
      await assert.rejects(f.store.workerStatus({actor:{...f.actor}}),/OPERATION_DENIED/);
      const input=await f.request();const first=await f.store.applyWorker(input);assert.equal(first.revision,1);
      assert.equal((await f.store.applyWorker(input)).duplicate,true);assert.equal((await f.status()).disabled,true);
      await assert.rejects(f.store.applyWorker({...input,requestId:aiDigest(randomUUID())}),/AI_WORKER_OPERATION_STALE/);
      await assert.rejects(f.store.applyWorker({...input,candidateId:'e'.repeat(64)}),/AI_REQUEST_COLLISION/);
      assert.equal(f.launches(),0);await assert.rejects(knowledge.query('SELECT * FROM sophie_ai.worker_requests'),error=>error.code==='42501');
    }finally{await f.close();}
  });
  await run('DS09-O02 ready requires quiescence and matching worker acknowledgement; replacement does not touch another lane',async()=>{
    const f=await fixture();try {
      await f.start();await f.apply();await f.runtime.runOnce();const first=await f.status();
      assert.equal(first.phase,'ready');assert.equal(first.activeRevision,1);assert.equal(first.acknowledged.releaseHash,release.releaseHash);assert.equal(first.disabled,true);
      assert.equal(f.runtime.prepare({}),'synthetic-proof');assert.equal(f.runtime.committed({},true),'synthetic-commit');
      await f.apply();await f.runtime.runOnce();const second=await f.status();
      assert.equal(second.activeRevision,2);assert.notEqual(second.acknowledged.bootId,first.acknowledged.bootId);
      assert.deepEqual(f.events.filter(event=>['quiesce','launch','probe','lane-start','lane-stop'].includes(event)),
        ['quiesce','quiesce','launch','probe','lane-start','lane-stop','quiesce','launch','probe','lane-start']);
    }finally{await f.close();}
  });
  await run('DS09-O03 replacement waits for the actual prior lane to stop',async()=>{
    const f=await fixture();try {
      await f.start();await f.apply();await f.runtime.runOnce();f.flags.drainGate=deferred();await f.apply();
      const replacing=f.runtime.runOnce();while(!f.events.includes('lane-stop'))await tick();
      assert.equal(f.launches(),1);assert.equal((await f.status()).phase,'draining');assert.equal(f.runtime.prepare({}),null);
      f.flags.drainGate.resolve();await replacing;assert.equal(f.launches(),2);assert.equal((await f.status()).phase,'ready');
    }finally{await f.close();}
  });
  await run('DS09-O04 stop supersedes a late launch, compensates it and does not replay inference',async()=>{
    const f=await fixture();try {
      await f.start();f.flags.launchGate=deferred();await f.apply();const applying=f.runtime.runOnce();while(f.launches()===0)await tick();
      const stop={actor:f.actor,requestId:aiDigest(randomUUID())};await f.store.stopWorker(stop);
      f.flags.launchGate.resolve();await applying;assert.equal(f.events.includes('lane-start'),false);assert.equal(f.physical(),false);
      await f.runtime.runOnce();assert.equal((await f.status()).phase,'stopped');assert.equal((await f.store.stopWorker(stop)).duplicate,true);
      assert.equal(f.launches(),1);
    }finally{await f.close();}
  });
  await run('DS09-O05 interrupted ownership is quiesced on startup and requires a fresh operator apply',async()=>{
    const f=await fixture();try {
      await f.apply();const token=await f.journal.claim(randomUUID());await f.journal.transition(token,'starting');
      await f.start();assert.equal((await f.status()).phase,'failed');assert.equal(f.launches(),0);
      await f.runtime.runOnce();assert.equal(f.launches(),0);await f.apply();await f.runtime.runOnce();assert.equal((await f.status()).phase,'ready');
      assert.equal(await f.journal.transition(token,'failed'),false);
    }finally{await f.close();}
  });
  await run('DS09-O06 missing physical-stop proof or worker qualification prevents launch',async()=>{
    for(const field of ['quiescent','qualified']) {const f=await fixture();try {
      await f.start();f.flags[field]=false;await f.apply();await f.runtime.runOnce();
      assert.equal((await f.status()).phase,'failed');assert.equal(f.launches(),0);assert.equal((await f.status()).disabled,true);
    }finally{await f.close();}}
  });
  await run('DS09-O07 another coordinator cannot replace the live owner or stop its registered service',async()=>{
    const f=await fixture();const second=f.makeRuntime();try {
      await f.start();await f.apply();await f.runtime.runOnce();const before=f.events.filter(value=>value==='quiesce').length;
      await assert.rejects(second.start({automatic:false}),/AI_WORKER_OPERATIONS_UNAVAILABLE/);await second.stop();
      assert.equal(f.events.filter(value=>value==='quiesce').length,before);assert.equal((await f.status()).phase,'ready');assert.equal(f.physical(),true);
    }finally{await second.stop();await f.close();}
  });
  await run('DS09-O08 wrong acknowledgement or changed control revision discards the candidate',async()=>{
    for(const mode of ['identity','revision']) {const f=await fixture();try {
      await f.start();if(mode==='identity')f.flags.wrongAck=true;else f.flags.launchGate=deferred();await f.apply();
      const applying=f.runtime.runOnce();if(mode==='revision'){
        while(f.launches()===0)await tick();await f.store.disable({actor:f.actor});
        // Disable is idempotent while apply already holds it; a new publication must still invalidate the reviewed revision.
        const input={actor:f.actor,kind:'personality',expectedRevision:1,document:{...DRAFT_PERSONALITY,core:'Synthetic revised character'}};
        const reviewed=await f.store.review(input);await f.store.publish({...input,requestId:aiDigest(randomUUID()),reviewSha256:reviewed.reviewSha256,confirmed:true});
        f.flags.launchGate.resolve();
      }
      await applying;assert.equal((await f.status()).phase,'failed');assert.equal((await f.status()).acknowledged,null);assert.equal(f.physical(),false);
    }finally{await f.close();}}
  });
  await run('DS09-O09 a full operation history still permits a bounded emergency stop and failed-stop recovery',async()=>{
    const f=await fixture();try {
      await f.start();await f.apply();await f.runtime.runOnce();
      await admin.query('UPDATE sophie_ai.worker_state SET desired_revision=1000 WHERE guild_id=$1',[f.actor.guildId]);
      await assert.rejects(f.review(),/AI_WORKER_HISTORY_FULL/);
      const stop={actor:f.actor,requestId:aiDigest(randomUUID())};assert.equal((await f.store.stopWorker(stop)).revision,1001);
      f.flags.quiescent=false;await f.runtime.runOnce();assert.equal((await f.status()).phase,'failed');assert.equal(f.physical(),true);
      const count=async()=>Number((await admin.query('SELECT count(*) FROM sophie_ai.worker_requests WHERE guild_id=$1',[f.actor.guildId])).rows[0].count);
      const before=await count();f.flags.quiescent=true;
      assert.equal((await f.store.stopWorker({actor:f.actor,requestId:aiDigest(randomUUID())})).coalesced,true);
      await f.runtime.runOnce();assert.equal((await f.status()).phase,'stopped');assert.equal(f.physical(),false);
      assert.equal(await count(),before);assert.equal(f.launches(),1);assert.equal((await f.status()).historyFull,true);
    }finally{await f.close();}
  });
  await run('DS09-O10 an exact lost-response apply retry does not cancel its in-progress launch',async()=>{
    const f=await fixture();try {
      await f.start();f.flags.launchGate=deferred();const input=await f.request();await f.store.applyWorker(input);
      const applying=f.runtime.runOnce();while(f.launches()===0)await tick();
      await assert.rejects(f.store.stopWorker({actor:{...f.actor},requestId:aiDigest(randomUUID())}),/OPERATION_DENIED/);
      assert.equal((await f.store.applyWorker(input)).duplicate,true);
      f.flags.launchGate.resolve();await applying;
      assert.equal((await f.status()).phase,'ready');assert.equal(f.launches(),1);assert.equal(f.physical(),true);
    }finally{await f.close();}
  });
}
