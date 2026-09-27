import test from 'node:test';
import assert from 'node:assert/strict';
import { createAutomationController } from '../apps/dashboard/automation-controller.js';
import { createDashboardApi, DashboardFailure } from '../apps/dashboard/api.js';
import { createSyntheticAutomationApi } from './fixtures/dashboard-automation.js';

function fixture(options) {const f=createSyntheticAutomationApi(options);let n=0;return {...f,c:createAutomationController({api:f.api,onChange:()=>{},newRequestId:()=>(++n).toString(16).padStart(64,'0')})};}
test('automation publication requires exact reviewed public rules and explicit confirmation; edits invalidate review',async()=>{
  const {c,state}=fixture();await c.start();c.editRule('response','Synthetic approved reply');await c.review();
  assert.equal(c.snapshot().review.document.rules[0].action.text,'Synthetic approved reply');await c.send();assert.equal(state.records.length,12);
  c.confirm(true);c.editSource('Another approved public source');assert.equal(c.snapshot().review,null);await c.send();assert.equal(state.records.length,12);
  await c.review();c.confirm(true);await c.send();assert.equal(state.records.length,13);assert.equal(c.snapshot().pending,null);assert.match(c.snapshot().notice,/does not activate/);
});
test('withdrawal and historical republication retain history and use the latest reviewed revision',async()=>{
  const {c,state}=fixture();await c.start();await c.history(c.snapshot().history.nextBefore);assert.deepEqual(c.snapshot().history.entries.map(r=>r.revision),[2,1]);
  c.useHistory(1);await c.review('withdraw');assert.equal(c.snapshot().review,null);await c.discard();await c.review('withdraw');c.confirm(true);await c.send();
  assert.equal(state.records.at(-1).action,'withdraw');assert.equal(state.records.length,13);c.useHistory(12);await c.review();c.confirm(true);await c.send();assert.equal(state.records.at(-1).action,'publish');
});
test('rule selection has explicit removal, bounded additions and separate reaction fields',async()=>{
  const {c}=fixture();await c.start();c.add();c.editRule('channels','123, 456');c.editRule('matchText','hello');c.editRule('actionKind','reaction');c.editRule('emojiName','👋');
  await c.review();assert.ok(c.snapshot().review);c.remove();c.editSource('blocked during removal');assert.equal(c.snapshot().draft.source,'Synthetic public policy; not community rules');c.cancelRemoval();assert.equal(c.snapshot().draft.rules.length,2);
  c.remove();c.confirmRemoval();assert.equal(c.snapshot().draft.rules.length,1);assert.equal(c.snapshot().review,null);
  for(let i=0;i<30;i++)c.add();assert.equal(c.snapshot().draft.rules.length,25);assert.equal(new Set(c.snapshot().draft.rules.map(r=>r.id)).size,25);
  c.select(0);c.remove();c.editSource('also blocked for index zero');assert.notEqual(c.snapshot().draft.source,'also blocked for index zero');
});
test('synthetic preview requires attestation, models cooldown and never echoes sample text',async()=>{
  const {c}=fixture();await c.start();c.sample(0,'channelId','123');c.sample(0,'content','help synthetic sentinel');await c.preview();assert.equal(c.snapshot().preview,null);
  c.addSample();c.sample(1,'atMs',500);c.sample(1,'content','help synthetic sentinel');c.attestSamples(true);await c.preview();
  const preview=c.snapshot().preview;assert.ok(preview);assert.equal(preview.results[0].actions.length,1);assert.equal(preview.results[1].actions.length,0);assert.equal(JSON.stringify(preview).includes('sentinel'),false);
  c.sample(1,'bot',true);assert.equal(c.snapshot().synthetic,false);assert.equal(c.snapshot().preview,null);
});
test('stale publication preserves local draft and requests a fresh review of the competing revision',async()=>{
  const {c,append,state}=fixture();await c.start();c.editRule('response','My local edit');await c.review();c.confirm(true);append();await c.send();
  assert.equal(c.snapshot().pending,null);assert.equal(c.snapshot().draft.rules[0].action.text,'My local edit');assert.equal(state.records.length,13);
  await c.review();assert.equal(c.snapshot().review.changed,true);assert.equal(c.snapshot().review.previous.revision,13);c.confirm(true);await c.send();assert.equal(state.records.length,14);
});
test('periodic access checks preserve an unchanged review but clear it when policy or delivery state changes',async()=>{
  const {c,state,append}=fixture();await c.start();await c.review();c.confirm(true);await c.checkAccess();assert.equal(c.snapshot().checked,true);assert.ok(c.snapshot().review);
  append();await c.checkAccess();assert.equal(c.snapshot().review,null);await c.openIssue(state.issues[0].deliveryId);await c.reviewRepair('recover','999');c.confirmRepair(true);
  await c.checkAccess();assert.equal(c.snapshot().repairChecked,true);state.issues[0].reviewVersion++;await c.checkAccess();assert.equal(c.snapshot().repair,null);
});
test('uncertain policy mutation freezes edits and retries its identical request after another revision',async()=>{
  const {c,state,append}=fixture();await c.start();await c.review();c.confirm(true);state.loseResponse=true;await c.send();
  const pending=c.snapshot().pending;assert.ok(pending);c.editSource('blocked');await c.review();assert.deepEqual(c.snapshot().pending,pending);append();await c.retry();
  assert.equal(state.records.length,14);assert.equal(c.snapshot().pending,null);assert.deepEqual(state.calls[0].request,state.calls[1].request);assert.equal(c.snapshot().current.revision,14);
});
test('unknown message sends require an existing output ID and never expose a job recheck',async()=>{
  const {c,state}=fixture();await c.start();await c.openIssue(state.issues[0].deliveryId);await c.reviewRepair('recheck');assert.equal(c.snapshot().repair,null);
  await c.reviewRepair('recover');assert.equal(c.snapshot().repair,null);await c.reviewRepair('recover','999');await c.sendRepair();assert.equal(state.calls.length,0);
  c.confirmRepair(true);state.loseResponse=true;await c.sendRepair();const pending=c.snapshot().pending;assert.equal(pending.body.messageId,'999');await c.retry();
  assert.deepEqual(state.calls[0].request,state.calls[1].request);assert.equal(state.issues[0].reviewVersion,2);assert.match(c.snapshot().notice,/not confirmation/);
});
test('reaction recovery verifies the original effect; stale review and quarantined flags forbid repair',async()=>{
  const {c,state}=fixture();await c.start();await c.openIssue(state.issues[1].deliveryId);await c.reviewRepair('recover','999');assert.equal(c.snapshot().repair.messageId,null);
  c.confirmRepair(true);await c.sendRepair();assert.equal(state.calls[0].request.messageId,null);
  await c.openIssue(state.issues[3].deliveryId);state.issues[3].reviewVersion++;await c.reviewRepair('recheck');assert.equal(c.snapshot().repair,null);
  state.issues[3].canRecheck=false;await c.reviewRepair('recheck');assert.equal(c.snapshot().repair,null);assert.equal(state.calls.length,1);
});
test('delivery and event history use bounded cursors and corrupt entries cannot be repaired',async()=>{
  const {c,state}=fixture();await c.start();assert.equal(c.snapshot().issues.entries.length,10);assert.equal(c.snapshot().issues.entries[2].integrity,'unverified');
  await c.issues(c.snapshot().issues.nextBefore);assert.equal(c.snapshot().issues.entries.length,2);await c.openIssue(state.issues[0].deliveryId);await c.openIssue(state.issues[0].deliveryId,c.snapshot().detail.nextBefore);
  assert.deepEqual(c.snapshot().detail.events.map(r=>r.sequence),[2,1]);await c.openIssue(state.issues[2].deliveryId);assert.equal(c.snapshot().detail,null);assert.equal(c.snapshot().phase,'unavailable');
});
test('authority loss, account change and page hiding clear selections and ignore late responses',async()=>{
  const identity={userId:'123',guildId:'456'},{c,state,api}=fixture({identity:()=>identity});await c.start();c.sample(0,'content','Synthetic private sample');
  state.allowed=false;await c.checkAccess();assert.equal(c.snapshot().phase,'denied');assert.equal(c.snapshot().draft,null);assert.equal(c.snapshot().samples[0].content,'');
  state.allowed=true;await c.start();identity.userId='789';await c.checkAccess();assert.equal(c.snapshot().draft,null);await c.start();
  let resolve;api.automation=()=>new Promise(r=>resolve=r);const request=c.checkAccess();await new Promise(r=>setImmediate(r));c.suspend();resolve({actorId:'789',guildId:'456',current:null});await request;
  assert.equal(c.snapshot().phase,'loading');assert.equal(c.snapshot().draft,null);await c.logout();assert.equal(c.snapshot().identity,null);
});
test('malformed and cross-actor replies clear protected state and unsafe previews are rejected',async()=>{
  const {c,api}=fixture();await c.start();const original=api.previewAutomation;c.sample(0,'channelId','123');c.sample(0,'content','help');c.attestSamples(true);
  api.previewAutomation=async b=>({...await original(b),deliveryEnabled:true});await c.preview();assert.equal(c.snapshot().preview,null);
  api.automation=async()=>({actorId:'999',guildId:'456',current:null});await c.checkAccess();assert.equal(c.snapshot().phase,'denied');assert.equal(c.snapshot().draft,null);
});
test('late mutation completion cannot restore cleared policy or recovery data',async()=>{
  const {c,api}=fixture();await c.start();await c.review();c.confirm(true);const original=api.changeAutomation;let resolve;
  api.changeAutomation=async b=>{const result=await original(b);return new Promise(r=>resolve=()=>r(result));};const sending=c.send();await new Promise(r=>setImmediate(r));c.suspend();resolve();await sending;
  assert.equal(c.snapshot().draft,null);assert.equal(c.snapshot().pending,null);assert.match(c.snapshot().notice,/may still complete/);
});
test('fixed browser routes validate cursors and carry same-origin CSRF; missing grant denies by default',async()=>{
  const calls=[],api=createDashboardApi({fetch:async(path,options)=>{calls.push({path,options});return Response.json(path==='/auth/session'?{userId:'123',guildId:'456',canEditForms:false,canEditOnboarding:false,csrfToken:'a'.repeat(64)}:{});}});
  await assert.rejects(api.changeAutomation({}),e=>e.kind==='denied');assert.equal((await api.session()).canEditAutomation,false);
  await api.automation();await api.automationHistory(12);await api.automationIssues('a'.repeat(32));await api.automationIssue('b'.repeat(32),8);await api.reviewAutomation({});await api.previewAutomation({});await api.changeAutomation({});await api.repairAutomation({});
  assert.equal(calls[2].path,'/api/automation/history?before=12');assert.equal(calls[4].path,'/api/automation/issue?deliveryId='+'b'.repeat(32)+'&before=8');
  assert.ok(calls.slice(5).every(c=>c.options.method==='POST'&&c.options.headers['X-CSRF-Token']==='a'.repeat(64)&&c.options.credentials==='same-origin'));
  assert.throws(()=>api.automationIssues('../case'),DashboardFailure);assert.throws(()=>api.automationIssue('a'.repeat(32),0),DashboardFailure);
});
