import assert from 'node:assert/strict';
import { createAiControls } from '../../apps/core/storage/ai-controls.js';
import { defaultParticipation } from '../../modules/assistant/participation.js';
import { DRAFT_PERSONALITY } from '../../modules/assistant/personality.js';
import { aiDigest } from '../../apps/core/storage/ai-controls.js';
import { createAiAdmission } from '../../apps/core/storage/ai-admission.js';
import { createAiIngress } from '../../apps/core/discord/ai-ingress.js';
import { createAiAccounting } from '../../apps/core/storage/ai-accounting.js';
import { DEFAULT_AI_BUDGET, aiReservationNanos } from '../../modules/assistant/budget.js';

/** Existing isolated PostgreSQL runner, synthetic metadata and authored text only. */
export async function runAiControlsSuite(cluster, run) {
  const { adminPool: admin, corePool: pool, knowledgePool: knowledge } = cluster;
  await admin.query('GRANT USAGE ON SCHEMA sophie_ai TO sophie_test_core');
  await admin.query('GRANT SELECT,INSERT,UPDATE ON sophie_ai.state,sophie_ai.publications,sophie_ai.consents,sophie_ai.request_receipts TO sophie_test_core');
  await admin.query('GRANT SELECT ON sophie_ai.qualifications TO sophie_test_core');
  await admin.query('GRANT SELECT,INSERT,UPDATE ON sophie_ai.budget_policies,sophie_ai.budget_periods,sophie_ai.provider_attempts,sophie_ai.budget_hold_receipts TO sophie_test_core');
  await admin.query('GRANT DELETE ON sophie_ai.budget_periods,sophie_ai.provider_attempts TO sophie_test_core');
  const actor = Object.freeze({ guildId: '101', userId: '202', capabilityEpoch: 1, policyVersion: 1 });
  let permitted = true, channelAvailable = true, checks = 0;
  const store = createAiControls({ pool, guildId: actor.guildId, noticeRevision: 1, noticeApproved: async () => true,
    authorize: async (_action, candidate) => { checks++; return candidate === actor && permitted; },
    inspectChannel: async (_client, id) => channelAvailable && id === '303' ? { id } : null, memberPresence: async () => 1 });
  const document = { schemaVersion: 1, enabled: true, deadlineMs: 15000, channels: [{ channelId: '303', profile: defaultParticipation('conversational') }], emojis: [] };
  const review = fields => store.review({ actor, kind: 'configuration', expectedRevision: 0, document, ...fields });
  let published;
  await run('AI01 desired publication is idempotent and cannot activate an unqualified worker', async () => {
    const candidate = await review();
    published = { actor, kind: candidate.kind, expectedRevision: candidate.expectedRevision, document: candidate.document,
      reviewSha256: candidate.reviewSha256, confirmed: true, requestId: 'a'.repeat(64) };
    assert.deepEqual(await store.publish(published), { revision: 1, duplicate: false, activation: 'qualification-required' });
    assert.equal((await store.publish(published)).duplicate, true);
    const saved = await store.current({ actor, kind: 'configuration' }); assert.equal(saved.disabled, true); assert.equal(saved.publication.revision, 1);
    assert.ok(checks >= 8);
  });
  await run('AI02 concurrent exact reviews serialize and stale edits cannot overwrite the winner', async () => {
    const candidate = await review({ expectedRevision: 1 });
    const input = { ...published, expectedRevision: 1, reviewSha256: candidate.reviewSha256 };
    const results = await Promise.allSettled([store.publish({ ...input, requestId: 'b'.repeat(64) }), store.publish({ ...input, requestId: 'c'.repeat(64) })]);
    assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
    assert.equal(results.find(result => result.status === 'rejected').reason.code, 'AI_PUBLICATION_STALE');
  });
  await run('AI03 changed candidate, reused receipt and forged operator cannot publish', async () => {
    await assert.rejects(store.publish({ ...published, document: { ...document, enabled: false } }), /AI_REVIEW_STALE/);
    const changed = await review({ expectedRevision: 2 });
    await assert.rejects(store.publish({ ...published, expectedRevision: 2, reviewSha256: changed.reviewSha256 }), /AI_REQUEST_COLLISION/);
    await assert.rejects(store.current({ actor: { ...actor }, kind: 'configuration' }), /OPERATION_DENIED/);
  });
  await run('AI04 personal consent is channel-bound, versioned and revocable after channel access disappears', async () => {
    assert.equal((await store.consent({ actor, channelId: '303', enabled: true, expectedEpoch: 0, acceptedNoticeRevision: 1 })).epoch, 1);
    await assert.rejects(store.consent({ actor, channelId: '303', enabled: true, expectedEpoch: 0, acceptedNoticeRevision: 1 }), /AI_CONSENT_STALE/);
    channelAvailable = false;
    assert.equal((await store.consent({ actor, channelId: '303', enabled: false, expectedEpoch: 1, acceptedNoticeRevision: 1 })).epoch, 2);
    await assert.rejects(store.consent({ actor, channelId: '303', enabled: true, expectedEpoch: 2, acceptedNoticeRevision: 1 }), /AI_CHANNEL_UNAVAILABLE/);
    channelAvailable = true;
    await assert.rejects(store.consent({ actor, channelId: '303', enabled: true, expectedEpoch: 2, acceptedNoticeRevision: 2 }), /AI_NOTICE_STALE/);
    assert.deepEqual((await store.ownConsents({ actor })).channels, [{ channelId: '303', epoch: 2, enabled: false, noticeRevision: 1 }]);
  });
  await run('AI05 personality publication is separate from permissions and cannot widen configuration', async () => {
    const request = { actor, kind: 'personality', expectedRevision: 0, document: DRAFT_PERSONALITY };
    const inspected = await store.review(request);
    await store.publish({ ...request, reviewSha256: inspected.reviewSha256, requestId: 'd'.repeat(64), confirmed: true });
    assert.equal((await store.current({ actor, kind: 'personality' })).publication.document.core, DRAFT_PERSONALITY.core);
    assert.equal((await store.current({ actor, kind: 'configuration' })).publication.revision, 2);
    await assert.rejects(store.review({ ...request, document: { ...DRAFT_PERSONALITY, tools: ['shell'] } }), /AI_PERSONALITY_INVALID/);
  });
  await run('AI06 runtime cannot mint qualification and knowledge principal cannot read core or consent', async () => {
    await assert.rejects(pool.query('UPDATE sophie_ai.qualifications SET active=true'), error => error.code === '42501');
    await assert.rejects(knowledge.query('SELECT * FROM sophie_core.members'), error => error.code === '42501');
    await assert.rejects(knowledge.query('SELECT * FROM sophie_ai.consents'), error => error.code === '42501');
  });
  await run('AI07 AI disable does not enter administration maintenance or require inference', async () => {
    await admin.query('UPDATE sophie_ai.state SET disabled=false WHERE guild_id=$1', [actor.guildId]);
    const before = (await admin.query('SELECT * FROM sophie_control.runtime_gate')).rows;
    const disabled = await store.disable({ actor }); assert.equal(disabled.disabled, true);
    assert.deepEqual(await store.disable({ actor }), disabled);
    assert.deepEqual((await admin.query('SELECT * FROM sophie_control.runtime_gate')).rows, before);
    permitted = false; await assert.rejects(store.disable({ actor }), /OPERATION_DENIED/); permitted = true;
  });
  const ingress = createAiIngress({ guildId: actor.guildId, botUserId: '505', clock: Date.now });
  let contextEligible = true, sourceRevision = 'original', presenceEpoch = 1;
  const admissionFor = ingress => createAiAdmission({ pool, guildId: actor.guildId, ingress, clock: Date.now,
    inspectContext: async () => ({ eligible: contextEligible, audienceHash: 'e'.repeat(64), restricted: false, canReply: true, canReact: true, messageRevision: sourceRevision, continuity: 'synthetic-current', checkedAt: Date.now() }),
    inspectMember: async () => ({ eligible: true, presenceEpoch, accessEpoch: 1, checkedAt: Date.now() }) });
  const admission = admissionFor(ingress);
  let bodyReads = 0;
  const event = (id, text = 'Synthetic hello', extras = {}) => {
    const d = { guild_id: actor.guildId, channel_id: '303', id, author: { id: actor.userId, bot: false }, type: 0, mentions: [], ...extras };
    Object.defineProperty(d, 'content', { get() { bodyReads++; return text; } });
    return ingress.prepare({ t: 'MESSAGE_CREATE', d });
  };
  await run('AI08 admission excludes a ticket sentinel before inspecting its body, even with synthetic qualification', async () => {
    const configuration = await store.current({ actor, kind: 'configuration' }), personality = await store.current({ actor, kind: 'personality' });
    await admin.query(`INSERT INTO sophie_ai.qualifications(guild_id,channel_id,boundary_epoch,audience_sha256,worker_domain,
      release_sha256,evidence_sha256,configuration_sha256,personality_sha256,restricted,active,restore_ready)
      VALUES($1,'303',1,$2,'synthetic-public',$3,$3,$4,$5,false,true,true)`,
    [actor.guildId, 'e'.repeat(64), 'f'.repeat(64), configuration.publication.sha256, personality.publication.sha256]);
    await admin.query('UPDATE sophie_ai.state SET disabled=false WHERE guild_id=$1', [actor.guildId]);
    await store.consent({ actor, channelId: '303', enabled: true, expectedEpoch: 2, acceptedNoticeRevision: 1 });
    contextEligible = false; bodyReads = 0;
    assert.equal(await admission.admit(event('601', 'EXCLUDED_SYNTHETIC_TICKET_SENTINEL')), null); assert.equal(bodyReads, 0);
    contextEligible = true;
  });
  let admitted;
  await run('AI09 concurrent replay has one durable admission; message text never enters receipts', async () => {
    const results = await Promise.all([admission.admit(event('602')), admission.admit(event('602'))]);
    assert.equal(results.filter(Boolean).length, 1); admitted = results.find(Boolean);
    assert.equal(await admission.revalidate(admitted), true);
    const rows = (await admin.query('SELECT * FROM sophie_ai.request_receipts WHERE guild_id=$1', [actor.guildId])).rows;
    assert.equal(rows.length, 1); assert.equal(JSON.stringify(rows).includes('Synthetic hello'), false);
    assert.equal(admitted.inputRevision, aiDigest(['602', 'original']));
    await admission.settle(admitted, 'delivered', '700');
    await admission.settle(admitted, 'cancelled', '701');
    assert.equal((await pool.query('SELECT state FROM sophie_ai.request_receipts WHERE message_id=$1', ['602'])).rows[0].state, 'delivered');
    await admission.settle(admitted, 'cancelled', '700');
    assert.equal((await pool.query('SELECT state FROM sophie_ai.request_receipts WHERE message_id=$1', ['602'])).rows[0].state, 'cancelled');
  });
  await run('DS01-01 local notice consent cannot admit remote processing or enable an unapproved notice', async () => {
    const controls = createAiControls({ pool, guildId: actor.guildId, authorize: async () => true,
      inspectChannel: async () => ({ id: '303' }), memberPresence: async () => 1 });
    assert.equal((await controls.ownConsents({ actor })).optInAvailable, false);
    await assert.rejects(controls.consent({ actor, channelId: '303', enabled: true, expectedEpoch: 3, acceptedNoticeRevision: 1 }), /AI_NOTICE_STALE/);
    await assert.rejects(controls.consent({ actor, channelId: '303', enabled: true, expectedEpoch: 3, acceptedNoticeRevision: 2 }), /AI_NOTICE_UNAPPROVED/);
    const remote = createAiAdmission({ pool, guildId: actor.guildId, ingress, clock: Date.now, noticeRevision: 2,
      inspectContext: async () => assert.fail('old consent must stop before content authority'), inspectMember: async () => assert.fail('old consent') });
    bodyReads = 0; assert.equal(await remote.admit(event('699')), null); assert.equal(bodyReads, 0);
  });
  await run('AI10 edited or deleted source and withdrawn consent invalidate delivery and historical context', async () => {
    sourceRevision = 'edited'; assert.equal(await admission.revalidate(admitted), false); assert.equal(await admission.revalidateSource(admitted), false); sourceRevision = 'original';
    contextEligible = false; assert.equal(await admission.beginDelivery(admitted), false); contextEligible = true;
    await store.consent({ actor, channelId: '303', enabled: false, expectedEpoch: 3, acceptedNoticeRevision: 1 });
    assert.equal(await admission.revalidate(admitted), false);
    await store.consent({ actor, channelId: '303', enabled: true, expectedEpoch: 4, acceptedNoticeRevision: 1 });
    assert.equal(await admission.revalidate(admitted), false);
  });
  await run('AI11 member flood and proactive cadence reserve capacity atomically before another model turn', async () => {
    assert.equal(await admission.admit(event('603')), null);
    await admin.query("UPDATE sophie_ai.request_receipts SET state='silent',received_at=clock_timestamp()-interval '2 minutes' WHERE guild_id=$1", [actor.guildId]);
    const results = await Promise.all([admission.admit(event('604')), admission.admit(event('605'))]);
    assert.equal(results.filter(Boolean).length, 2);
    const root = results.find(item=>item.messageId===item.gather.rootId), third = await admission.admit(event('708'));
    assert.equal(third.gather.rootId,root.messageId);assert.equal(await admission.admit(event('709')),null);
    assert.equal(await admission.freezeGather(root,[...results,third]),true);
    assert.equal(await admission.freezeGather(root,[...results,third]),false);
    const rows=(await admin.query('SELECT message_id,state,deadline FROM sophie_ai.request_receipts WHERE gather_root=$1',[root.messageId])).rows;
    assert.equal(rows.filter(row=>row.state==='admitted').length,1);assert.equal(new Set(rows.map(row=>row.deadline.getTime())).size,1);
  });
  await run('DS-06 gathering preserves byte bounds, target and owner fences and independently rejects lost eligibility', async () => {
    const fresh = createAiIngress({guildId:actor.guildId,botUserId:'505',clock:Date.now}), lane=admissionFor(fresh);
    const prepare=(id,text='Synthetic fragment',extras={})=>fresh.prepare({t:'MESSAGE_CREATE',d:{guild_id:actor.guildId,channel_id:'303',id,author:{id:actor.userId,bot:false},type:0,mentions:[],content:text,...extras}});
    const reset=()=>admin.query("UPDATE sophie_ai.request_receipts SET state='silent',received_at=clock_timestamp()-interval '2 minutes' WHERE guild_id=$1",[actor.guildId]);
    await reset();const full=await lane.admit(prepare('710','😀'.repeat(1024)));assert.ok(full.gather);
    assert.equal(await lane.admit(prepare('711','x')),null);
    await reset();const large=await lane.admit(prepare('712','😀'.repeat(1025)));assert.equal(large.gather,null);
    await reset();const target=id=>({type:19,message_reference:{channel_id:'303',message_id:id},referenced_message:{author:{id:'505'}}});
    const root=await lane.admit(prepare('713','First question',target('901')));
    assert.equal(await lane.admit(prepare('714','Different reply',target('902'))),null);
    const joined=await lane.admit(prepare('715','Same reply',target('901')));assert.equal(joined.gather.rootId,root.messageId);
    assert.equal(await admissionFor(fresh).freezeGather(root,[root,joined]),false);
    contextEligible=false;assert.equal(await lane.admit(prepare('716','Now excluded',target('901'))),null);contextEligible=true;
    await admin.query('UPDATE sophie_ai.request_receipts SET gather_quiet_until=clock_timestamp() WHERE message_id=$1',[root.messageId]);
    sourceRevision='edited';assert.equal(await lane.freezeGather(root,[root,joined]),false);sourceRevision='original';
  });
  await run('DS06-E01 edits replace only a matching gathering revision under the original receipt deadline and limits', async()=>{
    const fresh=createAiIngress({guildId:actor.guildId,botUserId:'505',clock:Date.now}),lane=admissionFor(fresh);
    const prepare=(id,text,edit=false,extras={})=>fresh.prepare({t:edit?'MESSAGE_UPDATE':'MESSAGE_CREATE',d:{guild_id:actor.guildId,channel_id:'303',id,
      author:{id:actor.userId,bot:false},type:0,mentions:[],attachments:[],content:text,...(edit?{edited_timestamp:sourceRevision}:{}),...extras}});
    const reset=()=>admin.query("UPDATE sophie_ai.request_receipts SET state='silent',received_at=clock_timestamp()-interval '2 minutes' WHERE guild_id=$1",[actor.guildId]);
    await reset();const root=await lane.admit(prepare('720','Before edit'));
    sourceRevision=new Date().toISOString();const updated=await lane.replaceGather(prepare('720','After edit',true),root);
    assert.equal(updated.text,'After edit');assert.equal(updated.deadline,root.deadline);assert.equal(updated.receivedAt,root.receivedAt);
    assert.equal(updated.gather.until,root.gather.until);
    assert.equal(await lane.replaceGather(prepare('720','Stale writer',true),root),null);
    sourceRevision=new Date(Date.now()+1).toISOString();assert.equal(await lane.replaceGather(prepare('720','😀'.repeat(1025),true),updated),null);
    contextEligible=false;assert.equal(await lane.replaceGather(prepare('720','Excluded edit',true),updated),null);contextEligible=true;
    sourceRevision=new Date(Date.now()+2).toISOString();assert.equal(await lane.replaceGather(prepare('720','Different target',true,{mentions:[{id:'505'}]}),updated),null);
    sourceRevision=new Date().toISOString();
    await admin.query('UPDATE sophie_ai.request_receipts SET gather_quiet_until=clock_timestamp() WHERE message_id=$1',[root.messageId]);
    assert.equal(await lane.replaceGather(prepare('720','Too late',true),updated),null);
    assert.equal((await admin.query('SELECT input_revision FROM sophie_ai.request_receipts WHERE message_id=$1',[root.messageId])).rows[0].input_revision,updated.inputRevision);
    sourceRevision='original';
  });
  await run('AI12 departure and rejoin cannot revive enrollment; withdrawn qualification blocks before body read', async () => {
    presenceEpoch = 2; bodyReads = 0; assert.equal(await admission.admit(event('606')), null); assert.equal(bodyReads, 0); presenceEpoch = 1;
    await admin.query('UPDATE sophie_ai.qualifications SET active=false WHERE guild_id=$1', [actor.guildId]);
    bodyReads = 0; assert.equal(await admission.admit(event('607')), null); assert.equal(bodyReads, 0);
  });
  const accounting = createAiAccounting({ pool, guildId: actor.guildId });
  let budgetRevision = 0, nextId = 800;
  const budget = { ...DEFAULT_AI_BUDGET, priceValidUntil: Date.now() + 3600000 };
  async function publishBudget(changes = {}) {
    const document = { ...budget, ...changes };
    const reviewed = await store.review({ actor, kind: 'budget', expectedRevision: budgetRevision, document });
    const result = await store.publish({ actor, kind: 'budget', expectedRevision: budgetRevision, document,
      reviewSha256: reviewed.reviewSha256, confirmed: true, requestId: aiDigest(['synthetic-budget', budgetRevision]) });
    budgetRevision = result.revision; return result;
  }
  async function generation() {
    const messageId = String(++nextId), deadline = Date.now() + 14000, inputRevision = aiDigest([messageId, 'original']);
    const controlEpoch = Number((await pool.query('SELECT epoch FROM sophie_ai.state WHERE guild_id=$1', [actor.guildId])).rows[0].epoch);
    await admin.query(`INSERT INTO sophie_ai.request_receipts(guild_id,message_id,channel_id,user_id,input_revision,state,deadline,proactive)
      VALUES($1,$2,'303',$3,$4,'admitted',to_timestamp($5/1000.0),false)`, [actor.guildId,messageId,actor.userId,inputRevision,deadline]);
    return { local: { messageId,inputRevision,controlEpoch,proactive:false }, bytes:4096,outputTokens:384,deadline };
  }
  const reported = { prompt_tokens:100,completion_tokens:25,total_tokens:125,prompt_cache_hit_tokens:64,prompt_cache_miss_tokens:36 };
  await run('DS03-01 budget publication is reviewed, stale-safe and scoped to AI control authority', async () => {
    assert.equal((await publishBudget()).revision, 1);
    await assert.rejects(store.budgetStatus({ actor:{...actor} }), /OPERATION_DENIED/);
    await assert.rejects(store.review({ actor,kind:'budget',expectedRevision:0,document:budget }), /AI_PUBLICATION_STALE/);
    assert.equal((await store.budgetStatus({actor})).policy.document.dailyLimitNanos, null);
    await assert.rejects(knowledge.query('SELECT * FROM sophie_ai.provider_attempts'), error => error.code === '42501');
  });
  await run('DS03-02 two workers compete for the last allowance without overspending or duplicate dispatch', async () => {
    const amount = aiReservationNanos({bytes:4096,outputTokens:384},budget);
    await publishBudget({monthlyLimitNanos:amount.toString()});
    const inputs = await Promise.all([generation(),generation()]);
    const results = await Promise.all(inputs.map(input => accounting.reserve(input)));
    assert.equal(results.filter(Boolean).length,1);
    const token = results.find(Boolean), input = inputs.find(value=>value.local.messageId===token.messageId);
    assert.equal(await accounting.reserve(input),null);
    assert.equal(await accounting.dispatch({...token,fence:'00000000-0000-0000-0000-000000000000'}),false);
    assert.equal(await accounting.dispatch(token),true); assert.equal(await accounting.dispatch(token),false);
    assert.equal(await accounting.settle(token,reported,{model:'synthetic-model',fingerprint:'synthetic-build'}),true);
    assert.equal(await accounting.settle(token,reported),false);
    const balance=(await accounting.status()).balances.find(row=>row.period.length===7);
    assert.equal(balance.reserved_nanos,'0'); assert.equal(balance.settled_nanos,'41184');
  });
  await run('DS03-03 crashes and missing usage retain reservations and cannot replay after expiry', async () => {
    await publishBudget();
    const input = await generation(), token=await accounting.reserve(input);
    assert.equal(await accounting.dispatch(token),true);
    assert.equal(await accounting.settle(token,{...reported,total_tokens:1}),false);
    await admin.query("UPDATE sophie_ai.provider_attempts SET deadline=clock_timestamp()-interval '1 second' WHERE guild_id=$1 AND message_id=$2",[actor.guildId,token.messageId]);
    const recovered=createAiAccounting({pool,guildId:actor.guildId}); await recovered.expire();
    assert.equal(await recovered.settle(token,reported),false); assert.equal(await recovered.reserve(input),null);
    const status=await recovered.status(); assert.equal(status.unresolved.attempts,1); assert.ok(BigInt(status.unresolved.nanos)>0n);
  });
  await run('DS03-04 known non-dispatch releases funds but never permits the same turn to be replayed', async () => {
    const input=await generation(),token=await accounting.reserve(input);
    await accounting.finish(token,false); await accounting.finish(token,false);
    assert.equal(await accounting.reserve(input),null);
    const dispatched=await accounting.reserve(await generation()); assert.equal(await accounting.dispatch(dispatched),true);
    await accounting.finish(dispatched,false);
    assert.equal((await pool.query('SELECT state FROM sophie_ai.provider_attempts WHERE guild_id=$1 AND message_id=$2',[actor.guildId,dispatched.messageId])).rows[0].state,'released');
  });
  await run('DS03-05 policy changes, disable and unresolved capacity fence dispatch and admission', async () => {
    const token=await accounting.reserve(await generation()); await publishBudget({maxUnresolved:1});
    assert.equal(await accounting.dispatch(token),false); await accounting.finish(token,false);
    assert.equal(await accounting.reserve(await generation()),null);
    await publishBudget({priceValidUntil:Date.now()-1000}); assert.equal(await accounting.reserve(await generation()),null);
    await publishBudget(); const pending=await accounting.reserve(await generation());
    await store.disable({actor}); assert.equal(await accounting.dispatch(pending),false); await accounting.finish(pending,false);
    assert.equal(await accounting.reserve(await generation()),null);
    await admin.query('UPDATE sophie_ai.state SET disabled=false WHERE guild_id=$1',[actor.guildId]);
  });
  await run('DS03-06 actual usage above the estimate holds future admission and is never rounded down', async () => {
    const token=await accounting.reserve(await generation()); assert.equal(await accounting.dispatch(token),true);
    const large={prompt_tokens:10000,completion_tokens:500,total_tokens:10500,prompt_cache_hit_tokens:0,prompt_cache_miss_tokens:10000};
    assert.equal(await accounting.settle(token,large),true);
    assert.equal((await accounting.status()).policy.held,true);
    assert.equal(await accounting.reserve(await generation()),null);
    await assert.rejects(store.reviewSpendingHold({ actor, expectedRevision: budgetRevision, evidenceHash: 'a'.repeat(64) }), /AI_ACCOUNTING_UNRESOLVED/);
  });
  await run('DS03-07 explicit uncertain-charge resolution remains charged and is idempotent and authorized', async () => {
    const before=await accounting.status(),pending=before.pending[0];
    const input={actor,messageId:pending.messageId,fence:pending.fence,requestId:aiDigest(['resolve',pending.messageId]),confirmed:true};
    await assert.rejects(store.resolveSpending({...input,actor:{...actor}}),/OPERATION_DENIED/);
    await assert.rejects(store.resolveSpending({...input,confirmed:false}),/AI_CONFIRMATION_REQUIRED/);
    assert.deepEqual(await store.resolveSpending(input),{resolved:true,duplicate:false});
    assert.deepEqual(await store.resolveSpending(input),{resolved:true,duplicate:true});
    const after=await accounting.status(); assert.equal(after.unresolved.attempts,0);
    for(const original of before.balances){const updated=after.balances.find(row=>row.period===original.period);
      assert.equal(BigInt(updated.reserved_nanos)+BigInt(updated.settled_nanos),BigInt(original.reserved_nanos)+BigInt(original.settled_nanos));}
    assert.equal(after.policy.held,true);
  });
  await run('DS03-08 operator hold clearance requires current review and evidence, preserves balances and does not activate AI', async () => {
    const before = await accounting.status(), evidenceHash = 'a'.repeat(64);
    await assert.rejects(store.reviewSpendingHold({ actor: { ...actor }, expectedRevision: budgetRevision, evidenceHash }), /OPERATION_DENIED/);
    const reviewed = await store.reviewSpendingHold({ actor, expectedRevision: budgetRevision, evidenceHash });
    const input = { actor, expectedRevision: budgetRevision, evidenceHash, reviewSha256: reviewed.reviewSha256, requestId: 'f'.repeat(64), confirmed: true };
    await store.disable({ actor });
    await assert.rejects(store.clearSpendingHold(input), /AI_REVIEW_STALE/);
    input.reviewSha256 = (await store.reviewSpendingHold({ actor, expectedRevision: budgetRevision, evidenceHash })).reviewSha256;
    assert.deepEqual(await store.clearSpendingHold(input), { cleared: true, duplicate: false });
    assert.deepEqual(await store.clearSpendingHold(input), { cleared: true, duplicate: true });
    const after = await accounting.status(); assert.equal(after.policy.held, false); assert.deepEqual(after.balances, before.balances);
    assert.equal(await accounting.reserve(await generation()), null);
    assert.equal((await store.current({ actor, kind: 'budget' })).disabled, true);
  });
  await run('DS03-09 bounded retention preserves unresolved reservations, referenced periods and independent replay receipts', async () => {
    const guild='919', retained=createAiAccounting({pool,guildId:guild});
    await admin.query('INSERT INTO sophie_ai.state(guild_id) VALUES($1)',[guild]);
    await admin.query(`INSERT INTO sophie_ai.budget_periods(guild_id,period,reserved_nanos) VALUES
      ($1,'2000-01',2),($1,'2000-01-01',2),($1,'2001-01',0),($1,'2001-01-01',0)`,[guild]);
    await admin.query(`INSERT INTO sophie_ai.request_receipts(guild_id,message_id,channel_id,user_id,input_revision,state,deadline)
      SELECT $1,n::text,'303','202',repeat('a',64),'expired',timestamptz '2000-01-01' FROM generate_series(1000,1502) n`,[guild]);
    await admin.query(`INSERT INTO sophie_ai.provider_attempts(guild_id,message_id,fence,state,policy_revision,price,month_period,day_period,
      control_epoch,input_revision,reserved_nanos,prompt_bytes,output_tokens,deadline,updated_at)
      SELECT $1,n::text,gen_random_uuid(),CASE WHEN n<1501 THEN 'released' ELSE 'uncertain' END,1,$2,'2000-01','2000-01-01',
        0,repeat('a',64),1,1,1,timestamptz '2000-01-01',timestamptz '2000-01-01' FROM generate_series(1000,1502) n`,[guild,budget]);
    assert.deepEqual(await retained.maintain(),{attempts:500,periods:2});
    assert.deepEqual(await retained.maintain(),{attempts:1,periods:0});
    const status=await retained.status();assert.equal(status.attemptRows,2);assert.equal(status.unresolved.nanos,'2');
    assert.equal(status.retention.resolvedDays,90);assert.equal(status.capacityHeld,false);
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM sophie_ai.request_receipts WHERE guild_id=$1',[guild])).rows[0].n,503);
    assert.deepEqual((await pool.query('SELECT reserved_nanos FROM sophie_ai.budget_periods WHERE guild_id=$1',[guild])).rows,
      [{reserved_nanos:'2'},{reserved_nanos:'2'}]);
    assert.deepEqual(await retained.maintain(),{attempts:0,periods:0});
  });
}
