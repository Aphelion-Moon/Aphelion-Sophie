import assert from 'node:assert/strict';
import { createAiControls } from '../../apps/core/storage/ai-controls.js';
import { defaultParticipation } from '../../modules/assistant/participation.js';
import { DRAFT_PERSONALITY } from '../../modules/assistant/personality.js';
import { aiDigest } from '../../apps/core/storage/ai-controls.js';
import { createAiAdmission } from '../../apps/core/storage/ai-admission.js';
import { createAiIngress } from '../../apps/core/discord/ai-ingress.js';
import { createAiAccounting } from '../../apps/core/storage/ai-accounting.js';
import { DEFAULT_AI_BUDGET, aiReservationNanos } from '../../modules/assistant/budget.js';
import { createAiActivation } from '../../apps/core/storage/ai-activation.js';

/** Existing isolated PostgreSQL runner, synthetic metadata and authored text only. */
export async function runAiControlsSuite(cluster, run) {
  const { adminPool: admin, corePool: pool, knowledgePool: knowledge } = cluster;
  await admin.query('GRANT USAGE ON SCHEMA sophie_ai TO sophie_test_core');
  await admin.query('GRANT SELECT,INSERT,UPDATE ON sophie_ai.state,sophie_ai.publications,sophie_ai.consents,sophie_ai.request_receipts,sophie_ai.request_tombstones TO sophie_test_core');
  // Opt-out withdraws dependent replies in the same transaction; production uses one control role for both.
  await admin.query('GRANT SELECT,UPDATE ON sophie_ai.effects TO sophie_test_core');
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
    // Delivered replies are not re-verified, so opt-out withdraws the ones that drew on this member in this channel explicitly.
    for (const [id, userId, channelId] of [['951', actor.userId, '303'], ['952', '909', '303'], ['953', actor.userId, '304']]) {
      await admin.query(`INSERT INTO sophie_ai.request_receipts(guild_id,message_id,channel_id,user_id,input_revision,state,deadline)
        VALUES($1,$2,$3,$4,repeat('a',64),'delivered',clock_timestamp()+interval '15 seconds')`, [actor.guildId, id, channelId, userId]);
      await admin.query(`INSERT INTO sophie_ai.effects(guild_id,message_id,owner,channel_id,kind,dependencies,sources,state,receipt_id,deadline)
      VALUES($1,$2,gen_random_uuid(),$3,'reply',$4,'[]','confirmed',$5,clock_timestamp()+interval '15 seconds')`, [actor.guildId, id, channelId, JSON.stringify([{ userId, messageId: id }]), String(Number(id) + 1000)]);
    }
    channelAvailable = false;
    assert.equal((await store.consent({ actor, channelId: '303', enabled: false, expectedEpoch: 1, acceptedNoticeRevision: 1 })).epoch, 2);
    assert.deepEqual((await admin.query(`SELECT message_id,state FROM sophie_ai.effects WHERE message_id IN ('951','952','953') ORDER BY message_id`)).rows.map(row => row.state), ['cleanup', 'confirmed', 'confirmed']);
    await admin.query(`DELETE FROM sophie_ai.effects WHERE message_id IN ('951','952','953')`);
    await admin.query(`DELETE FROM sophie_ai.request_receipts WHERE message_id IN ('951','952','953')`);
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
  await run('DS02-AI33 diagnostic reads require current operator/channel authority and unchanged enabled state',async()=>{
    let calls=0,mode='current';const diagnostic={basis:'prepared-outbound-shape'};
    const controls=createAiControls({pool,guildId:actor.guildId,authorize:async(_action,candidate)=>candidate===actor && permitted,
      inspectChannel:async(_client,id)=>channelAvailable && id==='303'?{}:null,memberPresence:async()=>1,
      readDiagnostic:async()=>{calls++;if(mode==='disable')await store.disable({actor});if(mode==='revoke')permitted=false;return diagnostic;}});
    assert.deepEqual(await controls.diagnostics({actor,channelId:'303'}),{diagnostic:null});assert.equal(calls,0);
    await admin.query('UPDATE sophie_ai.state SET disabled=false WHERE guild_id=$1',[actor.guildId]);
    assert.deepEqual(await controls.diagnostics({actor,channelId:'303'}),{diagnostic});
    await assert.rejects(controls.diagnostics({actor,channelId:'999'}),/AI_CHANNEL_UNAVAILABLE/);
    mode='disable';assert.deepEqual(await controls.diagnostics({actor,channelId:'303'}),{diagnostic:null});
    await admin.query('UPDATE sophie_ai.state SET disabled=false WHERE guild_id=$1',[actor.guildId]);
    mode='revoke';await assert.rejects(controls.diagnostics({actor,channelId:'303'}),/OPERATION_DENIED/);
    permitted=true;await store.disable({actor});
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
    const replay=createAiAdmission({pool,guildId:actor.guildId,ingress,clock:Date.now,
      readNotice:async()=>assert.fail('a duplicate must not repeat approval checks'),
      inspectContext:async()=>assert.fail('a duplicate must not fetch metadata'),inspectMember:async()=>assert.fail('duplicate member lookup')});
    assert.equal(await replay.admit(event('602')),null);
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
  await run('RB-N02 a follow-up that calls Sophie by name is answered inside the member interval', async () => {
    // 602 was received moments ago, so the 15 s member interval has not passed; it now paces unprompted turns only.
    const followUp = await admission.admit(event('603', 'Sophie, what do you do when you are bored?'));
    assert.ok(followUp, 'an addressed follow-up is admitted'); assert.equal(followUp.decision.proactive, false); assert.equal(followUp.decision.infer, true);
    // A second message inside the gathering window joins the first turn; it never starts a second concurrent turn.
    const second = await admission.admit(event('604', 'Sophie, and another thing?'));
    assert.ok(second === null || second.gather?.rootId === followUp.messageId, 'one turn per member at a time');
    await admission.settle(followUp, 'cancelled');
    await admin.query("DELETE FROM sophie_ai.request_receipts WHERE guild_id=$1 AND message_id IN ('603','604')", [actor.guildId]);
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
    // The gather window closed a moment ago (not "now": with fast commits the edit can land in the same instant).
    await admin.query("UPDATE sophie_ai.request_receipts SET gather_quiet_until=clock_timestamp()-interval '1 second' WHERE message_id=$1",[root.messageId]);
    assert.equal(await lane.replaceGather(prepare('720','Too late',true),updated),null);
    assert.equal((await admin.query('SELECT input_revision FROM sophie_ai.request_receipts WHERE message_id=$1',[root.messageId])).rows[0].input_revision,updated.inputRevision);
    sourceRevision='original';
  });
  await run('AI12 departure and rejoin cannot revive enrollment; withdrawn qualification blocks before body read', async () => {
    presenceEpoch = 2; bodyReads = 0; assert.equal(await admission.admit(event('606')), null); assert.equal(bodyReads, 0); presenceEpoch = 1;
    // A reconnect advances the presence epoch for everyone; the Discord join time decides whether this is the same membership.
    const consented = (await admin.query("SELECT updated_at FROM sophie_ai.consents WHERE guild_id=$1 AND channel_id='303' AND user_id=$2", [actor.guildId, actor.userId])).rows[0].updated_at.getTime();
    for (const [id, joinedAt, refused] of [['6061', consented + 1000, true], ['6062', null, true], ['6063', consented - 86_400_000, false]]) {
      const reasons = [], lane = createAiIngress({ guildId: actor.guildId, botUserId: '505', clock: Date.now });
      const stint = createAiAdmission({ pool, guildId: actor.guildId, ingress: lane, clock: Date.now, trace: reason => reasons.push(reason),
        inspectContext: async () => ({ eligible: true, audienceHash: 'e'.repeat(64), restricted: false, canReply: true, canReact: true, messageRevision: 'original', continuity: 'synthetic-current', checkedAt: Date.now() }),
        inspectMember: async () => ({ eligible: true, presenceEpoch: 2, accessEpoch: 1, checkedAt: Date.now(), joinedAt }) });
      const proof = lane.prepare({ t: 'MESSAGE_CREATE', d: { guild_id: actor.guildId, channel_id: '303', id, author: { id: actor.userId, bot: false }, type: 0, mentions: [], content: 'Synthetic hello' } });
      assert.ok(proof, `${id} prepared`);
      const admitted = await stint.admit(proof);
      assert.equal(reasons.includes('PRESENCE_CHANGED'), refused, `${id} ${reasons.join(',')}`);
      if (refused) assert.equal(admitted, null, id); else if (admitted) await stint.settle(admitted, 'cancelled');
    }
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
    assert.equal(balance.reserved_nanos,'0'); assert.equal(balance.settled_nanos,'21360');
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
  await run('TS-AI01 reviewed activation checks approval, live audience, publications and worker, then fences replay', async () => {
    const operator={...actor,guildId:'991'},channelId='303';let approved=false,restricted=false,ready=true,authorized=true,noticeRevision=2;
    const control=createAiControls({pool,guildId:operator.guildId,authorize:async(_action,who)=>who===operator&&authorized,
      inspectChannel:async()=>({id:channelId}),memberPresence:async()=>1,
      readNotice:async()=>({revision:noticeRevision,text:'Synthetic notice',approved})});
    for(const [kind,doc] of [['configuration',document],['personality',DRAFT_PERSONALITY],['budget',{...DEFAULT_AI_BUDGET,priceValidUntil:Date.now()+60000}]]){
      const reviewed=await control.review({actor:operator,kind,expectedRevision:0,document:doc});
      await control.publish({actor:operator,kind,expectedRevision:0,document:doc,requestId:aiDigest({kind}),reviewSha256:reviewed.reviewSha256,confirmed:true});
    }
    const release={name:'Synthetic',workerId:'a'.repeat(64),releaseHash:'b'.repeat(64),profileHash:'c'.repeat(64),evidenceHash:'d'.repeat(64),provider:'mistral',domain:'public'};
    const activation=createAiActivation({pool:admin,guildId:operator.guildId,authorize:async(action,who)=>action==='ai.runtime.apply'&&who===operator&&authorized,
      inspectChannel:async()=>({eligible:true,restricted,checkedAt:Date.now(),audienceHash:'e'.repeat(64),continuity:'synthetic'}),
      approval:{evidence:async()=>approved?{evidenceHash:'f'.repeat(64),noticeRevision,validUntil:1799000000000}:null},
      workerRelease:async()=>ready?release:null,restoreCurrent:async()=>true});
    await assert.rejects(activation.reviewActivation({actor:operator,channelId}),/AI_PROCESSING_UNAPPROVED/);
    await assert.rejects(control.consent({actor:operator,channelId,enabled:true,expectedEpoch:0,acceptedNoticeRevision:2}),/AI_NOTICE_UNAPPROVED/);
    let noticeReads=0;
    const expiringConsent=createAiControls({pool,guildId:operator.guildId,authorize:async()=>true,inspectChannel:async()=>({id:channelId}),memberPresence:async()=>1,
      readNotice:async()=>({revision:2,text:'Synthetic notice',approved:++noticeReads===1})});
    await assert.rejects(expiringConsent.consent({actor:operator,channelId,enabled:true,expectedEpoch:0,acceptedNoticeRevision:2}),/AI_NOTICE_UNAPPROVED/);
    approved=true;restricted=true;await assert.rejects(activation.reviewActivation({actor:operator,channelId}),/AI_PUBLIC_CHANNEL_REQUIRED/);
    restricted=false;ready=false;await assert.rejects(activation.reviewActivation({actor:operator,channelId}),/AI_WORKER_NOT_READY/);ready=true;
    let reviewed=await activation.reviewActivation({actor:operator,channelId});
    const confirm=()=>({actor:operator,channelId,reviewSha256:reviewed.reviewSha256,requestId:'9'.repeat(64),confirmed:true});
    noticeRevision=3;await assert.rejects(activation.activate(confirm()),/AI_ACTIVATION_STALE/);
    await assert.rejects(control.consent({actor:operator,channelId,enabled:true,expectedEpoch:0,acceptedNoticeRevision:2}),/AI_NOTICE_STALE/);
    assert.equal((await control.ownConsents({actor:operator})).noticeRevision,3);
    reviewed=await activation.reviewActivation({actor:operator,channelId});authorized=false;await assert.rejects(activation.activate(confirm()),/OPERATION_DENIED/);authorized=true;
    const receipt=await activation.activate(confirm());assert.equal(receipt.duplicate,false);
    assert.equal((await control.current({actor:operator,kind:'configuration'})).disabled,false);
    await control.disable({actor:operator});assert.equal((await activation.activate(confirm())).duplicate,true);
    assert.equal((await control.current({actor:operator,kind:'configuration'})).disabled,true);
    await assert.rejects(pool.query('UPDATE sophie_ai.qualifications SET active=true'),error=>error.code==='42501');
    await assert.rejects(pool.query('DELETE FROM sophie_ai.activation_receipts'),error=>error.code==='42501');
    // RB-A01: Go live persists across deployments. Active qualifications follow the installed release; nothing else changes,
    // and an owner's disable stays in force.
    const deployed={...release,name:'Synthetic next',releaseHash:'1'.repeat(64),evidenceHash:'2'.repeat(64)};
    const before=(await admin.query('SELECT * FROM sophie_ai.qualifications WHERE guild_id=$1',[operator.guildId])).rows[0];
    assert.equal(await activation.rebind(deployed),1);assert.equal(await activation.rebind(deployed),0);
    const after=(await admin.query('SELECT * FROM sophie_ai.qualifications WHERE guild_id=$1',[operator.guildId])).rows[0];
    assert.equal(after.release_sha256,deployed.releaseHash);assert.equal(after.evidence_sha256,deployed.evidenceHash);
    for(const column of ['boundary_epoch','audience_sha256','configuration_sha256','personality_sha256','active','restricted'])assert.equal(String(after[column]),String(before[column]),column);
    assert.equal((await control.current({actor:operator,kind:'configuration'})).disabled,true);
    await assert.rejects(activation.rebind({...deployed,releaseHash:'bad'}),/AI_WORKER_RELEASE_INVALID|INVALID/);
    // RB-A02: Go live also follows a new publication, for channels the published configuration still lists.
    await admin.query(`INSERT INTO sophie_ai.qualifications(guild_id,channel_id,boundary_epoch,audience_sha256,worker_domain,release_sha256,
      evidence_sha256,configuration_sha256,personality_sha256,restricted,active,restore_ready) SELECT guild_id,'399',1,audience_sha256,worker_domain,release_sha256,
      evidence_sha256,configuration_sha256,personality_sha256,false,true,true FROM sophie_ai.qualifications WHERE guild_id=$1 AND channel_id=$2`,[operator.guildId,channelId]);
    const character={...DRAFT_PERSONALITY,core:'A synthetic chaotic gremlin who stands up straight for real questions.'};
    const reviewedCharacter=await control.review({actor:operator,kind:'personality',expectedRevision:1,document:character});
    await control.publish({actor:operator,kind:'personality',expectedRevision:1,document:character,requestId:aiDigest({kind:'personality',revision:2}),reviewSha256:reviewedCharacter.reviewSha256,confirmed:true});
    const published=(await control.current({actor:operator,kind:'personality'})).publication.sha256;
    assert.equal(await activation.follow(),1);assert.equal(await activation.follow(),0);
    const rows=Object.fromEntries((await admin.query('SELECT channel_id,personality_sha256,release_sha256,boundary_epoch FROM sophie_ai.qualifications WHERE guild_id=$1',[operator.guildId])).rows.map(row=>[row.channel_id,row]));
    assert.equal(rows[channelId].personality_sha256,published,'the live channel follows the new character');
    assert.equal(rows[channelId].release_sha256,deployed.releaseHash);assert.equal(String(rows[channelId].boundary_epoch),String(after.boundary_epoch));
    assert.notEqual(rows['399'].personality_sha256,published,'a channel the configuration does not list is left as it is');
    assert.equal((await control.current({actor:operator,kind:'configuration'})).disabled,true,'a disable stays in force');
    await admin.query("DELETE FROM sophie_ai.qualifications WHERE guild_id=$1 AND channel_id='399'",[operator.guildId]);
  });
  await run('DS01-C02 exact notice receipts reject stale acceptance and survive provider outage and withdrawal', async () => {
    const member={...actor,guildId:'929'},channelId='303';
    let binding='a'.repeat(64),text='Synthetic complete notice',outage=false,changeDuringPresence=false;
    const controls=createAiControls({pool,guildId:member.guildId,authorize:async(_action,who)=>who===member,
      inspectChannel:async()=>({id:channelId}),memberPresence:async()=>{if(changeDuringPresence)binding='c'.repeat(64);return 1;},
      readNotice:async()=>{if(outage)throw Error('synthetic outage');return {revision:2,binding,text,approved:true};}});
    const request={actor:member,kind:'configuration',expectedRevision:0,document};
    const review=await controls.review(request);
    await controls.publish({...request,requestId:'1'.repeat(64),reviewSha256:review.reviewSha256,confirmed:true});
    const consent={actor:member,channelId,enabled:true,expectedEpoch:0,acceptedNoticeRevision:2,acceptedNoticeBinding:binding};
    await assert.rejects(controls.consent({...consent,acceptedNoticeBinding:null}),/AI_NOTICE_STALE/);
    changeDuringPresence=true;await assert.rejects(controls.consent(consent),/AI_NOTICE_STALE/);
    changeDuringPresence=false;binding=consent.acceptedNoticeBinding;
    await controls.consent(consent);
    const accepted=(await controls.exportConsents({actor:member})).channels[0];
    assert.equal(accepted.receipt.text,text);assert.equal(accepted.receipt.binding,binding);assert.ok(Date.parse(accepted.receipt.acceptedAt)>0);
    binding='b'.repeat(64);text='Changed notice at same revision';
    await assert.rejects(controls.consent({...consent,expectedEpoch:1}),/AI_NOTICE_STALE/);
    outage=true;assert.equal((await controls.ownConsents({actor:member})).optInAvailable,false);
    await controls.consent({...consent,enabled:false,expectedEpoch:1,acceptedNoticeRevision:99});
    const withdrawn=(await controls.exportConsents({actor:member})).channels[0];
    assert.equal(withdrawn.enabled,false);assert.equal(withdrawn.noticeRevision,2);assert.deepEqual(withdrawn.receipt,accepted.receipt);
    await assert.rejects(controls.exportConsents({actor:{...member,userId:'999'}}),/OPERATION_DENIED/);
    assert.equal((await controls.exportConsents({actor:member})).channels.length,1);
  });
  await run('DS01-C03 remote consent binding is checked before content and on delivery', async () => {
    let binding='a'.repeat(64);
    const consentIngress=createAiIngress({guildId:actor.guildId,botUserId:'505',clock:Date.now});
    const consentEvent=id=>{
      const d={guild_id:actor.guildId,channel_id:'303',id,author:{id:actor.userId,bot:false},type:0,mentions:[{id:'505'}]};
      Object.defineProperty(d,'content',{get(){bodyReads++;return 'Synthetic direct question';}});
      const proof=consentIngress.prepare({t:'MESSAGE_CREATE',d});assert.ok(proof);return proof;
    };
    await admin.query('UPDATE sophie_ai.state SET disabled=false WHERE guild_id=$1',[actor.guildId]);
    await admin.query('UPDATE sophie_ai.qualifications SET active=true WHERE guild_id=$1',[actor.guildId]);
    const consent=(await pool.query('SELECT * FROM sophie_ai.consents WHERE guild_id=$1 AND channel_id=$2 AND user_id=$3',[actor.guildId,'303',actor.userId])).rows[0];
    const remote=createAiAdmission({pool,guildId:actor.guildId,ingress:consentIngress,clock:Date.now,noticeRevision:consent.notice_revision,
      readNotice:async()=>({revision:consent.notice_revision,binding,approved:true}),
      inspectContext:async()=>({eligible:true,audienceHash:'e'.repeat(64),restricted:false,canReply:true,canReact:true,messageRevision:sourceRevision,continuity:'synthetic-current',checkedAt:Date.now()}),
      inspectMember:async()=>({eligible:true,presenceEpoch:Number(consent.presence_epoch),accessEpoch:1,checkedAt:Date.now()})});
    await admin.query('UPDATE sophie_ai.consents SET enabled=true WHERE guild_id=$1',[actor.guildId]);
    bodyReads=0;assert.equal(await remote.admit(consentEvent('9901')),null);assert.equal(bodyReads,0);
    await admin.query('UPDATE sophie_ai.consents SET receipt=$2 WHERE guild_id=$1',[actor.guildId,{binding}]);
    await admin.query("UPDATE sophie_ai.request_receipts SET state='silent',received_at=clock_timestamp()-interval '2 minutes' WHERE guild_id=$1",[actor.guildId]);
    const currentRequest=await remote.admit(consentEvent('9903'));assert.ok(currentRequest);
    assert.equal(await remote.revalidate(currentRequest),true);
    binding='b'.repeat(64);assert.equal(await remote.revalidate(currentRequest),false);
    bodyReads=0;assert.equal(await remote.admit(consentEvent('9902')),null);assert.equal(bodyReads,0);
  });
  await run('DS01-C04 approval, revision and binding remain current after asynchronous metadata checks', async () => {
    const binding='a'.repeat(64), revision=2;
    await admin.query('UPDATE sophie_ai.consents SET enabled=true,notice_revision=$2,receipt=$3 WHERE guild_id=$1',[actor.guildId,revision,{binding}]);
    const consent=(await pool.query('SELECT * FROM sophie_ai.consents WHERE guild_id=$1 AND channel_id=$2 AND user_id=$3',[actor.guildId,'303',actor.userId])).rows[0];
    for (const change of ['approval', 'revision', 'binding', 'unbound', 'invalidation']) {
      const notice={approved:true,revision,binding:change==='unbound'?null:binding};
      const fresh=createAiIngress({guildId:actor.guildId,botUserId:'505',clock:Date.now});
      let notices=0, metadata=0;
      const lane=createAiAdmission({pool,guildId:actor.guildId,ingress:fresh,clock:Date.now,noticeRevision:revision,
        readNotice:async()=>{notices++;if(change==='invalidation' && notices===2)lane.invalidate();return {...notice};},
        inspectContext:async()=>{metadata++;return {eligible:true,audienceHash:'e'.repeat(64),restricted:false,canReply:true,canReact:true,
          messageRevision:sourceRevision,continuity:'synthetic-current',checkedAt:Date.now()};},
        inspectMember:async()=>{
          if(change==='approval')notice.approved=false;
          if(change==='revision')notice.revision++;
          if(change==='binding')notice.binding='b'.repeat(64);
          return {eligible:true,presenceEpoch:Number(consent.presence_epoch),accessEpoch:1,checkedAt:Date.now()};
        }});
      const d={guild_id:actor.guildId,channel_id:'303',id:'9910',author:{id:actor.userId,bot:false},type:0,mentions:[]};
      Object.defineProperty(d,'content',{get(){assert.fail(`stale ${change} must stop before message content`);}});
      assert.equal(await lane.admit(fresh.prepare({t:'MESSAGE_CREATE',d})),null,change);
      assert.equal(metadata,change==='unbound'?0:1);assert.equal(notices,change==='unbound'?1:2);
    }
    const unbound=createAiControls({pool,guildId:actor.guildId,authorize:async()=>true,noticeRevision:revision,
      readNotice:async()=>({revision,text:'Synthetic unbound notice',approved:true,binding:null}),
      inspectChannel:async()=>assert.fail('unbound remote opt-in must stop before channel inspection'),memberPresence:async()=>1});
    assert.equal((await unbound.ownConsents({actor})).optInAvailable,false);
    await assert.rejects(unbound.consent({actor,channelId:'303',enabled:true,expectedEpoch:Number(consent.epoch),acceptedNoticeRevision:revision}),/AI_NOTICE_STALE/);
  });
  await run('DS01-C05 revalidation rejects consent, control or qualification revocation during metadata lookup', async () => {
    const consent=(await pool.query('SELECT * FROM sophie_ai.consents WHERE guild_id=$1 AND channel_id=$2 AND user_id=$3',[actor.guildId,'303',actor.userId])).rows[0];
    const fresh=createAiIngress({guildId:actor.guildId,botUserId:'505',clock:Date.now});
    let revoke=null;
    const lane=createAiAdmission({pool,guildId:actor.guildId,ingress:fresh,clock:Date.now,noticeRevision:2,
      readNotice:async()=>({revision:2,binding:consent.receipt.binding,approved:true}),
      inspectContext:async()=>({eligible:true,audienceHash:'e'.repeat(64),restricted:false,canReply:true,canReact:true,
        messageRevision:sourceRevision,continuity:'synthetic-current',checkedAt:Date.now()}),
      inspectMember:async()=>{
        if(revoke!==null){const action=revoke;revoke=null;await action();}
        return {eligible:true,presenceEpoch:Number(consent.presence_epoch),accessEpoch:1,checkedAt:Date.now()};
      }});
    await admin.query("UPDATE sophie_ai.request_receipts SET state='silent',received_at=clock_timestamp()-interval '2 minutes' WHERE guild_id=$1",[actor.guildId]);
    const admitted=await lane.admit(fresh.prepare({t:'MESSAGE_CREATE',d:{guild_id:actor.guildId,channel_id:'303',id:'9920',
      author:{id:actor.userId,bot:false},type:0,mentions:[{id:'505'}],content:'Synthetic authority race'}}));
    assert.ok(admitted);assert.equal(await lane.revalidate(admitted),true);
    for (const [table,column] of [['consents','enabled'],['state','disabled'],['qualifications','active']]) {
      const before=column!=='disabled';
      revoke=()=>admin.query(`UPDATE sophie_ai.${table} SET ${column}=$2 WHERE guild_id=$1`,[actor.guildId,!before]);
      try {assert.equal(await lane.revalidate(admitted),false,table);}
      finally {await admin.query(`UPDATE sophie_ai.${table} SET ${column}=$2 WHERE guild_id=$1`,[actor.guildId,before]);}
    }
    revoke=()=>admin.query('UPDATE sophie_ai.consents SET epoch=epoch+1 WHERE guild_id=$1',[actor.guildId]);
    assert.equal(await lane.revalidateSource(admitted),false);
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
  await run('DS01-C06 every historical choice remains reachable and withdrawable through bounded self-only pages', async () => {
    const member={guildId:'91501',userId:'202',capabilityEpoch:1,policyVersion:1};let invalidations=0;
    const choices=createAiControls({pool,guildId:member.guildId,authorize:async(action,candidate,scope)=>
      action==='ai.self' && candidate===member && scope.userId===member.userId,
    readNotice:async()=>{throw Error('synthetic provider outage');},noticeRevision:2,
    inspectChannel:async()=>assert.fail('withdrawal does not require current channel visibility'),memberPresence:async()=>1,
    invalidate:()=>{invalidations++;}});
    const absent=await choices.consent({actor:member,channelId:'999',enabled:false,expectedEpoch:0,acceptedNoticeRevision:2});
    assert.equal(absent.epoch,0);assert.equal(absent.enabled,false);assert.equal(invalidations,0);
    assert.equal((await pool.query('SELECT 1 FROM sophie_ai.consents WHERE guild_id=$1',[member.guildId])).rowCount,0);
    await admin.query(`INSERT INTO sophie_ai.consents(guild_id,channel_id,user_id,epoch,enabled,presence_epoch,notice_revision)
      SELECT $1,(10000+n)::text,$2,1,true,1,1 FROM generate_series(0,202) n`,[member.guildId,member.userId]);
    await admin.query(`INSERT INTO sophie_ai.consents(guild_id,channel_id,user_id,epoch,enabled,presence_epoch,notice_revision)
      VALUES($1,'99999','303',1,true,1,1)`,[member.guildId]);
    const first=await choices.ownConsents({actor:member});assert.equal(first.channels.length,100);assert.equal(first.nextAfterChannelId,'10099');assert.equal(first.optInAvailable,false);
    const second=await choices.ownConsents({actor:member,afterChannelId:first.nextAfterChannelId});
    assert.equal(second.channels.length,100);assert.equal(second.nextAfterChannelId,'10199');
    const third=await choices.ownConsents({actor:member,afterChannelId:second.nextAfterChannelId});
    assert.equal(third.channels.length,3);assert.equal(third.nextAfterChannelId,null);
    assert.equal(new Set([...first.channels,...second.channels,...third.channels].map(item=>item.channelId)).size,203);
    const exact=await choices.ownConsents({actor:member,channelId:'10202'});
    assert.deepEqual(exact.channels,[{channelId:'10202',epoch:1,enabled:true,noticeRevision:1}]);assert.equal(exact.nextAfterChannelId,null);
    assert.deepEqual((await choices.ownConsents({actor:member,channelId:'99999'})).channels,[]);
    await choices.consent({actor:member,channelId:'10202',enabled:false,expectedEpoch:exact.channels[0].epoch,acceptedNoticeRevision:2});
    assert.equal((await choices.ownConsents({actor:member,channelId:'10202'})).channels[0].enabled,false);assert.equal(invalidations,1);
    await assert.rejects(choices.ownConsents({actor:{...member,userId:'303'}}),/OPERATION_DENIED/);
    assert.throws(()=>choices.ownConsents({actor:member,channelId:'10202',afterChannelId:'10099'}),/AI_INPUT_INVALID/);
  });
}
