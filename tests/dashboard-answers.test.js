import test from 'node:test';
import assert from 'node:assert/strict';
import { createAnswersController } from '../apps/dashboard/answers-controller.js';
import { createDashboardApi, DashboardFailure } from '../apps/dashboard/api.js';
import { createSyntheticAnswersApi } from './fixtures/dashboard-answers.js';

function fixture() {
  const identity = { userId: '123', guildId: '456' }, f = createSyntheticAnswersApi({ identity: () => identity }); let sequence = 0;
  const c = createAnswersController({ api: f.api, onChange() {}, newRequestId: () => (++sequence).toString(16).padStart(64,'0') });
  return { ...f, c, identity };
}
const changes = f => f.state.calls.filter(call => call.method === 'change');
async function draft(f) { await f.c.start(); await f.c.open('sample-00'); f.c.edit('text','New synthetic public text <script>literal</script>'); }
async function reviewed(f) { await draft(f); await f.c.review(); f.c.confirm(true); }
const cleared = c => { const s = c.snapshot(); assert.equal(s.name,null); assert.deepEqual(s.draft,{ title:'',text:'',source:'' }); assert.equal(s.history,null); assert.equal(s.review,null); assert.equal(s.pending,null); };

test('DS-07 public knowledge lookup works for a non-editor with AI off and clears on suspension or identity loss', async () => {
  const f = fixture(); f.identity.knowledgeAvailable = true; f.identity.aiAvailable = false; f.state.canEditAnswers = false;
  const source = { id:'guide.r1.s0',title:'Public guide',heading:'Arrival',text:'Literal <script>data</script>',url:'https://example.test/guide',
    authority:'reference',attribution:'Synthetic author',rights:'Synthetic permission',sourceRevision:'1',validUntil:null };
  f.api.knowledgeLookup = async () => ({ actorId:f.identity.userId,guildId:f.identity.guildId,sources:[source] });
  await f.c.start(); await f.c.lookup('arrival'); assert.deepEqual(f.c.snapshot().knowledgeSources,[source]);
  f.c.suspend(); assert.equal(f.c.snapshot().knowledgeSources,null); assert.equal(f.c.snapshot().knowledgeQuery,'');
  await f.c.lookup('arrival'); f.identity.userId='999'; await f.c.checkAccess(); assert.equal(f.c.snapshot().knowledgeSources,null);
});

test('DS-07 stale results and executable links cannot populate direct lookup', async () => {
  const f = fixture(); f.identity.knowledgeAvailable = true;
  let finish; f.api.knowledgeLookup = () => new Promise(resolve => { finish=resolve; });
  await f.c.start(); const pending=f.c.lookup('arrival');
  while(!finish) await new Promise(resolve=>setImmediate(resolve));
  f.c.suspend(); finish({actorId:'123',guildId:'456',sources:[]}); await pending;
  assert.equal(f.c.snapshot().knowledgeSources,null);
  f.api.knowledgeLookup = async () => ({ actorId:'123',guildId:'456',sources:[{id:'guide.r1.s0',title:'Title',heading:'Heading',text:'Text',
    url:'javascript:alert(1)',authority:'reference',attribution:'Author',rights:'Synthetic',sourceRevision:'1',validUntil:null}] });
  await f.c.lookup('arrival'); assert.equal(f.c.snapshot().phase,'unavailable'); assert.equal(f.c.snapshot().knowledgeSources,null);
});

test('public answer changes require exact review and explicit public-source confirmation; edits invalidate both', async () => {
  const f = fixture(); await draft(f); await f.c.send(); await f.c.review(); await f.c.send(); assert.equal(changes(f).length,0);
  f.c.confirm(true); f.c.edit('source','Changed synthetic public source'); await f.c.send(); assert.equal(changes(f).length,0);
  await f.c.review(); f.c.confirm(true); await f.c.send();
  const request = changes(f)[0].request; assert.equal(request.expectedRevision,12); assert.equal(request.approvedPublic,true); assert.equal(request.confirmed,true);
  assert.equal(f.c.snapshot().current.revision,13); assert.equal(f.c.snapshot().dirty,false); assert.match(f.c.snapshot().notice,/Publication recorded/);
});
test('ordinary members use public lookup without editorial history or mutation controls', async () => {
  const f = fixture(); f.state.canEditAnswers = false; await f.c.start(); await f.c.open('sample-00');
  assert.equal(f.c.snapshot().current.revision,12); assert.equal(f.c.snapshot().history,null);
  f.c.edit('text','attempted'); await f.c.review(); await f.c.send();
  assert.equal(f.state.calls.some(call => ['history','review','change'].includes(call.method)),false);
});
test('unsaved text blocks switching until explicit discard; refresh preserves its base and warns on competing changes', async () => {
  const f = fixture(); await draft(f); await f.c.open('sample-01'); assert.equal(f.c.snapshot().name,'sample-00');
  f.append('sample-00',{ ...f.publicDocument, text:'Another synthetic editor revision' }); await f.c.checkAccess();
  assert.equal(f.c.snapshot().baseRevision,12); assert.match(f.c.snapshot().draft.text,/New synthetic/);
  await f.c.review(); assert.equal(f.c.snapshot().review.changed,true); assert.equal(f.c.snapshot().review.expectedRevision,13);
  assert.equal(f.c.snapshot().checked,false); assert.equal(f.c.snapshot().review.previous.document.text,'Another synthetic editor revision');
  await f.c.discard(); await f.c.open('sample-01'); assert.equal(f.c.snapshot().name,'sample-01');
});
test('uncertain publication retries exactly once even after another editor withdraws the result', async () => {
  const f = fixture(); await reviewed(f); f.state.loseResponse = true; await f.c.send(); const request = f.c.snapshot().pending;
  assert.ok(request); await f.c.open('sample-01'); f.c.edit('text','replacement'); await f.c.discard(); await f.c.send();
  assert.deepEqual(f.c.snapshot().pending,request); f.append('sample-00',null,'withdraw'); await f.c.checkAccess(); await f.c.retry();
  assert.deepEqual(changes(f).map(call => call.request),[request,request]); assert.equal(f.c.snapshot().current.action,'withdraw'); assert.equal(f.state.records.get('sample-00').length,14);
  assert.equal(f.c.snapshot().pending,null);
});
test('conflicts preserve the rejected draft and require a new current review before submission', async () => {
  const f = fixture(); await reviewed(f); f.append('sample-00',f.publicDocument); await f.c.send();
  assert.equal(f.c.snapshot().pending,null); assert.match(f.c.snapshot().draft.text,/New synthetic/); assert.equal(f.c.snapshot().review,null);
  await f.c.send(); assert.equal(changes(f).length,1); await f.c.review(); assert.equal(f.c.snapshot().review.changed,true);
  f.c.confirm(true); await f.c.send(); assert.equal(f.c.snapshot().current.revision,14);
});
test('withdrawal requires clean reviewed state, preserves earlier text and permits explicit later republication', async () => {
  const f = fixture(); await draft(f); await f.c.review('withdraw'); assert.equal(f.c.snapshot().review,null);
  await f.c.discard(); await f.c.review('withdraw'); f.c.confirm(true); await f.c.send();
  assert.equal(f.c.snapshot().current.action,'withdraw'); assert.equal(f.c.snapshot().history.entries[1].document.text,f.publicDocument.text);
  assert.equal(f.c.snapshot().list.entries.some(row => row.name === 'sample-00'),false);
  f.c.edit('title','Reviewed again'); f.c.edit('text','New public text'); f.c.edit('source','Public source'); await f.c.review();
  assert.equal(f.c.snapshot().review.expectedRevision,13);
});
test('identity changes and revoked editor or session clear drafts, history and uncertain requests', async () => {
  for (const failure of ['identity','editor','session']) {
    const f = fixture(); await reviewed(f); f.state.loseResponse = true; await f.c.send();
    if (failure === 'identity') f.identity.userId = '789'; else if (failure === 'editor') f.state.canEditAnswers = false; else f.state.signedIn = false;
    await f.c.checkAccess(); cleared(f.c); assert.match(f.c.snapshot().notice,/may still complete|prior submission/);
  }
});
test('hidden pages clear text and suppress late history and publication responses', async () => {
  for (const action of ['read','send']) {
    const f = fixture(); await reviewed(f); let finish;
    if (action === 'read') f.api.answerHistory = () => new Promise(resolve => { finish = resolve; });
    else f.api.changeAnswer = () => new Promise(resolve => { finish = resolve; });
    const running = action === 'read' ? f.c.checkAccess() : f.c.send(); await new Promise(resolve => setImmediate(resolve));
    f.c.suspend(); finish({}); await running; cleared(f.c); assert.equal(f.c.snapshot().busy,false);
  }
});
test('bounded pages and revision cursors work; malformed or cross-actor data clears editor state', async () => {
  const f = fixture(); await f.c.start(); await f.c.next(); assert.equal(f.c.snapshot().list.entries.length,2); await f.c.first();
  await f.c.open('sample-00'); await f.c.older(); assert.deepEqual(f.c.snapshot().history.entries.map(row => row.revision),[2,1]);
  for (const patch of [{ actorId:'999' },{ entries:[null] },{ nextBefore:9 }]) {
    const original = f.api.answerHistory; f.api.answerHistory = async (...args) => ({ ...await original(...args), ...patch });
    await f.c.checkAccess(); cleared(f.c); f.api.answerHistory = original; await f.c.open('sample-00');
  }
});
test('answer browser API uses fixed bounded names, same-origin credentials and CSRF; old sessions deny editing by default', async () => {
  const calls = [], api = createDashboardApi({ fetch: async (path,options) => { calls.push({ path,options }); return { ok:true,
    json: async () => ({ userId:'123', guildId:'456', csrfToken:'b'.repeat(64), canEditOnboarding:false, canEditForms:false }) }; } });
  await assert.rejects(api.changeAnswer({ name:'sample-00' }), error => error.kind === 'denied');
  assert.equal((await api.session()).canEditAnswers,false); await api.answerHistory('sample-00',3); await api.reviewAnswer({ name:'sample-00' });
  assert.equal(calls[1].path,'/api/answers/history?name=sample-00&before=3'); assert.equal(calls[2].options.headers['X-CSRF-Token'],'b'.repeat(64));
  assert.equal(calls[2].options.credentials,'same-origin'); assert.equal(calls[2].options.cache,'no-store');
  assert.throws(() => api.answer('../case'), error => error.kind === 'invalid'); assert.throws(() => api.answerHistory('sample-00',0), error => error.kind === 'invalid');
});
