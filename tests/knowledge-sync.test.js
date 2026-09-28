import test from 'node:test';
import assert from 'node:assert/strict';
import { createKnowledgeSynchronizer } from '../apps/knowledge/synchronizer.js';
import { createKnowledgeRuntime } from '../apps/knowledge/runtime.js';
const tick=()=>new Promise(resolve=>setImmediate(resolve));

test('DS07-S01 unattended sync is serialized, requalified every run and cancelled without publication',async()=>{
  let qualified=true,release,next,signal,calls=0;const faults=[];
  const sync=createKnowledgeSynchronizer({qualified:async()=>qualified,onFault:code=>faults.push(code),setTimer:callback=>{next=callback;return 1;},clearTimer:()=>{},
    library:{synchronizePolicies:async input=>{signal=input.signal;calls++;await new Promise(resolve=>{release=resolve;});return {publishedAutomatically:false};}}});
  sync.start();await tick();assert.equal(calls,1);assert.equal(next,undefined);assert.throws(()=>sync.start(),/KNOWLEDGE_SYNC_STARTED/);
  release();await tick();assert.equal(sync.status().refreshing,false);
  qualified=false;next();await tick();assert.equal(calls,1);assert.deepEqual(faults,['KNOWLEDGE_SYNC_UNAVAILABLE']);
  qualified=true;next();await tick();const stop=sync.stop();assert.equal(signal.aborted,true);release();await stop;assert.equal(sync.status().stopped,true);
});
test('DS07-S02 knowledge composition requires qualification and exposes no automatic publication on its read interface',async()=>{
  const runtime=createKnowledgeRuntime({pool:{},guildId:'101',authorize:async()=>false,restoreCurrent:async()=>true,qualified:async()=>false,
    fetchImpl:()=>assert.fail('unqualified composition must not fetch')});
  assert.deepEqual(Object.keys(runtime.publicKnowledge),['lookup','current','currentReferences']);
  assert.equal('synchronizePolicies' in runtime.editor,false);await assert.rejects(runtime.start(),/KNOWLEDGE_SYNC_UNQUALIFIED/);await runtime.stop();
});
