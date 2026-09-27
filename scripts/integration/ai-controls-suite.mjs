import assert from 'node:assert/strict';
import { createAiControls } from '../../apps/core/storage/ai-controls.js';
import { defaultParticipation } from '../../modules/assistant/participation.js';
import { DRAFT_PERSONALITY } from '../../modules/assistant/personality.js';
import { aiDigest } from '../../apps/core/storage/ai-controls.js';
import { createAiAdmission } from '../../apps/core/storage/ai-admission.js';
import { createAiIngress } from '../../apps/core/discord/ai-ingress.js';

/** Existing isolated PostgreSQL runner, synthetic metadata and authored text only. */
export async function runAiControlsSuite(cluster, run) {
  const { adminPool: admin, corePool: pool, knowledgePool: knowledge } = cluster;
  await admin.query('GRANT USAGE ON SCHEMA sophie_ai TO sophie_test_core');
  await admin.query('GRANT SELECT,INSERT,UPDATE ON sophie_ai.state,sophie_ai.publications,sophie_ai.consents,sophie_ai.request_receipts TO sophie_test_core');
  await admin.query('GRANT SELECT ON sophie_ai.qualifications TO sophie_test_core');
  const actor = Object.freeze({ guildId: '101', userId: '202', capabilityEpoch: 1, policyVersion: 1 });
  let permitted = true, channelAvailable = true, checks = 0;
  const store = createAiControls({ pool, guildId: actor.guildId,
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
  const admission = createAiAdmission({ pool, guildId: actor.guildId, ingress, clock: Date.now,
    inspectContext: async () => ({ eligible: contextEligible, audienceHash: 'e'.repeat(64), restricted: false, canReply: true, canReact: true, messageRevision: sourceRevision, continuity: 'synthetic-current', checkedAt: Date.now() }),
    inspectMember: async () => ({ eligible: true, presenceEpoch, accessEpoch: 1, checkedAt: Date.now() }) });
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
    assert.equal(results.filter(Boolean).length, 1);
  });
  await run('AI12 departure and rejoin cannot revive enrollment; withdrawn qualification blocks before body read', async () => {
    presenceEpoch = 2; bodyReads = 0; assert.equal(await admission.admit(event('606')), null); assert.equal(bodyReads, 0); presenceEpoch = 1;
    await admin.query('UPDATE sophie_ai.qualifications SET active=false WHERE guild_id=$1', [actor.guildId]);
    bodyReads = 0; assert.equal(await admission.admit(event('607')), null); assert.equal(bodyReads, 0);
  });
}
