import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { onboardingWorkflow } from '../../tests/fixtures/onboarding-workflow.js';
import { channelChoice, channelChoicePayload, casePlanFor, duplicateOnboardingCase, retainLateCandidate } from '../../tests/fixtures/onboarding-channel-choice.js';
import { recoveryQueue, makeDue, issueRecheck } from '../../tests/fixtures/onboarding-recovery.js';
import { GUILD, USER, OTHER } from '../../tests/fixtures/domain.js';
import { casePolicy } from '../../tests/fixtures/cases.js';
import { caseChannelPayload, requireCaseChannel } from '../../modules/tickets/channel-policy.js';
import { createCaseStore } from '../../apps/core/storage/case-store.js';
import { createCoreStore } from '../../apps/core/storage/core-store.js';
import { createCaseDispatcher } from '../../apps/core/discord/case-dispatcher.js';
import { createCaseChannels } from '../../apps/core/discord/case-channels.js';
import { createDiscordTransport } from '../../apps/core/discord/transport.js';
import { createDiscordRoles } from '../../apps/core/discord/roles.js';
import { mapping } from '../../tests/fixtures/discord.js';

export async function runOnboardingChannelChoiceSuite(cluster, run) {
  const scenario = (name, work) => run(name, async () => {
    const f = await onboardingWorkflow(cluster); await work(f);
    assert.equal(f.discord.state.calls.some(call => call.method === 'DELETE'), false);
  });
  const audit = f => f.rows('shuttle_delivery_rechecks');
  const freshIssue = async (f, issue) => (await f.rows('shuttle_delivery_issues')).find(row => row.id === issue.id);
  const state = async f => (await f.rows('case_reservations'))[0];
  const writes = f => f.discord.state.calls.filter(call => call.method !== 'GET');
  async function exact(f, id, sealed) {
    const plan = await casePlanFor(f), proof = await f.discord.channels.inspect(plan, id);
    requireCaseChannel(await f.discord.channels.verification.channel(proof, plan, sealed), plan, casePolicy, sealed);
  }
  async function request(f, issue, id) {
    return { actor: await f.actor(OTHER), interactionId: f.nextId(), issueId: issue.id, expectedRevision: issue.revision,
      observation: await f.discord.roles.observe(USER), resultId: id, proof: await f.discord.channels.inspect(await casePlanFor(f), id) };
  }

  await scenario('Q01 a Staff choice records the candidate set but only the worker opens the selected channel', async f => {
    const { original, duplicate, issue } = await duplicateOnboardingCase(f), session = await f.session(), before = writes(f).length;
    const entry = (await f.deliveryIssues.queue(recoveryQueue(f))).entries[0];
    assert.equal(entry.recheckable, false); assert.deepEqual(entry.channelChoice, { required: true, total: 2, candidates: [original.id, duplicate.id].sort() });
    assert.equal(await channelChoice(f, issue, duplicate.id), 'shuttle_channel_recorded');
    assert.equal((await state(f)).state, 'pending'); assert.equal(writes(f).length, before); assert.deepEqual(await f.session(), session);
    const rows = await audit(f); assert.equal(rows.length, 1); assert.equal(rows[0].action, 'select_channel');
    assert.deepEqual(rows[0].candidate_ids, [original.id, duplicate.id].sort()); assert.equal(rows[0].result_id, duplicate.id);
    await f.drain(f.cases); assert.equal((await state(f)).channel_id, duplicate.id); await exact(f, original.id, true); await exact(f, duplicate.id, false);
    assert.equal((await f.rows('case_channels')).length, 2); assert.equal((await f.rows('case_exclusions')).length, 2);
    assert.equal(writes(f).filter(call => call.method === 'POST').length, 1);
    await f.drain(f.screens); assert.equal((await f.current()).channel_id, duplicate.id);
  });

  await scenario('Q02 a broadened noncanonical candidate is sealed before the selected channel opens', async f => {
    const { original, duplicate, issue } = await duplicateOnboardingCase(f); await channelChoice(f, issue, duplicate.id);
    original.permission_overwrites = caseChannelPayload(await casePlanFor(f), casePolicy, false).permission_overwrites;
    const before = writes(f).length;
    assert.deepEqual(await f.cases.runOnce('seal-first'), { status: 'progressed' });
    assert.equal(writes(f).length, before + 1); await exact(f, original.id, true); await exact(f, duplicate.id, true);
    assert.equal((await state(f)).state, 'pending'); await f.drain(f.cases); await exact(f, duplicate.id, false);
  });

  await scenario('Q03 missing retained duplicates prevent opening and are never forgotten', async f => {
    const { original, duplicate, issue } = await duplicateOnboardingCase(f); await channelChoice(f, issue, duplicate.id);
    f.discord.state.channels.delete(original.id);
    assert.equal((await f.cases.runOnce('missing-duplicate')).code, 'CASE_CHANNEL_MISSING');
    await exact(f, duplicate.id, true); assert.equal((await f.rows('case_channels')).length, 2);
    assert.equal((await state(f)).state, 'pending');
  });

  await scenario('Q04 duplicate and competing signed choices retain one audit and reject stale revisions', async f => {
    const { original, duplicate, issue } = await duplicateOnboardingCase(f), payload = channelChoicePayload(f, issue, duplicate.id);
    assert.equal(await f.execute(payload), 'shuttle_channel_recorded'); assert.equal(await f.execute(payload), 'shuttle_channel_recorded');
    assert.equal(await channelChoice(f, issue, original.id), 'shuttle_issue_stale');
    assert.equal(await f.execute(channelChoicePayload(f, issue, original.id, { id: payload.id })), 'unavailable');
    assert.equal((await audit(f)).length, 1); assert.equal((await f.rows('case_provisions'))[0].chosen_channel_id, duplicate.id);
  });

  await scenario('Q05 unregistered channels and non-Staff actors cannot invoke selection reads or changes', async f => {
    const { duplicate, issue } = await duplicateOnboardingCase(f), before = f.discord.state.calls.length;
    assert.equal(await channelChoice(f, issue, OTHER), 'shuttle_channel_rejected');
    assert.equal(f.discord.state.calls.slice(before).some(call => call.path === `/api/v10/channels/${OTHER}`), false);
    const count = f.discord.state.calls.length;
    assert.equal(await channelChoice(f, issue, duplicate.id, { member: { user: { id: USER } } }), 'denied');
    assert.equal(f.discord.state.calls.slice(count).some(call => call.path === `/api/v10/channels/${duplicate.id}`), false);
    assert.equal((await audit(f)).length, 0);
  });

  await scenario('Q06 Staff revocation during channel inspection prevents a selection audit', async f => {
    const { duplicate, issue } = await duplicateOnboardingCase(f);
    f.discord.state.before = call => { if (call.path === `/api/v10/channels/${duplicate.id}`) f.discord.state.members.set(OTHER, []); };
    assert.equal(await channelChoice(f, issue, duplicate.id), 'denied'); assert.equal((await audit(f)).length, 0);
  });

  await scenario('Q07 forged and expired channel proofs cannot record a canonical choice', async f => {
    const { duplicate, issue } = await duplicateOnboardingCase(f), input = await request(f, issue, duplicate.id);
    await assert.rejects(f.store.chooseOnboardingChannel({ ...input, proof: { channelId: duplicate.id } }), /CASE_OBSERVATION_UNTRUSTED/);
    f.clock.now += 6_000;
    await assert.rejects(f.store.chooseOnboardingChannel({ ...input, observation: await f.discord.roles.observe(USER) }), /MEMBERSHIP_STALE/);
    assert.equal((await audit(f)).length, 0);
  });

  await scenario('Q08 a newly discovered candidate invalidates a previous selection and old queue references', async f => {
    const { original, duplicate, issue } = await duplicateOnboardingCase(f); await channelChoice(f, issue, duplicate.id);
    const stale = await freshIssue(f, issue), extra = { ...structuredClone(original), id: f.nextId() };
    await retainLateCandidate(f, extra);
    assert.equal((await f.cases.runOnce('new-candidate')).code, 'CASE_CHANNEL_DUPLICATE');
    assert.equal(await channelChoice(f, stale, duplicate.id), 'shuttle_issue_stale');
    const current = await freshIssue(f, issue); assert.ok(current.revision > stale.revision);
    assert.equal(await channelChoice(f, current, duplicate.id), 'shuttle_channel_recorded'); await f.drain(f.cases);
    assert.equal((await audit(f)).length, 2); assert.equal((await audit(f))[1].candidate_ids.length, 3);
    await exact(f, original.id, true); await exact(f, extra.id, true); await exact(f, duplicate.id, false);
  });

  await scenario('Q09 a late duplicate holds an open case and its original channel cannot be replaced', async f => {
    const { original, duplicate, issue } = await duplicateOnboardingCase(f, { opened: true });
    assert.equal((await state(f)).state, 'pending'); assert.equal(await f.click('advance'), 'shuttle_review');
    assert.equal(await channelChoice(f, issue, duplicate.id), 'shuttle_channel_rejected');
    assert.equal(await channelChoice(f, issue, original.id), 'shuttle_channel_recorded'); await f.drain(f.cases);
    assert.equal((await state(f)).channel_id, original.id); await exact(f, duplicate.id, true);
    assert.equal((await f.current()).channel_id, original.id);
  });

  await scenario('Q10 departure after a choice seals every candidate and fails the request', async f => {
    const { original, duplicate, issue } = await duplicateOnboardingCase(f); await channelChoice(f, issue, duplicate.id);
    f.discord.state.members.delete(USER); await f.drain(f.cases);
    assert.equal((await state(f)).state, 'failed'); await exact(f, original.id, true); await exact(f, duplicate.id, true);
  });

  await scenario('Q11 lost duplicate-seal responses reconcile without another create or premature opening', async f => {
    const { original, duplicate, issue } = await duplicateOnboardingCase(f); await channelChoice(f, issue, duplicate.id);
    original.permission_overwrites = caseChannelPayload(await casePlanFor(f), casePolicy, false).permission_overwrites;
    f.discord.state.afterWrite = call => { if (call.method === 'PATCH') { f.discord.state.afterWrite = null; throw new Error('SYNTHETIC_LOST_SEAL'); } };
    assert.equal((await f.cases.runOnce('lost-seal')).status, 'retry_scheduled'); await exact(f, duplicate.id, true);
    await makeDue(f); await f.drain(f.cases); assert.equal((await state(f)).channel_id, duplicate.id);
    assert.equal(writes(f).filter(call => call.method === 'POST').length, 1);
  });

  await scenario('Q12 missing or forged duplicate proofs cannot bypass the store opening checks', async f => {
    const { original, duplicate, issue } = await duplicateOnboardingCase(f); await channelChoice(f, issue, duplicate.id);
    const { claim } = await f.outbox.claim('direct-worker', 30_000, ['case.provision']);
    const input = { claim, observation: await f.discord.roles.observe(USER), proof: await f.discord.channels.inspect(await casePlanFor(f), duplicate.id) };
    await assert.rejects(f.store.beginCaseAccess(input), /CASE_CHANNEL_DUPLICATE/);
    await assert.rejects(f.store.beginCaseAccess({ ...input, otherProofs: [{ channelId: original.id }] }), /CASE_OBSERVATION_UNTRUSTED/);
    await assert.rejects(f.store.beginCaseAccess({ ...input, otherProofs: [input.proof] }), /CASE_CHANNEL_DUPLICATE/);
    const wrong = createCaseStore({ pool: f.pool, clock: () => f.clock.now, authorize: async () => true,
      policy: casePolicy, verification: { ...f.discord.channels.verification, channel: (proof, plan) => f.discord.channels.verification.candidate(proof, plan) } });
    original.permission_overwrites = caseChannelPayload(await casePlanFor(f), casePolicy, false).permission_overwrites;
    const broad = await f.discord.channels.inspect(await casePlanFor(f), original.id);
    await assert.rejects(wrong.beginCaseAccess({ ...input, otherProofs: [broad] }), /CASE_CHANNEL_ACL_MISMATCH/);
    assert.equal((await state(f)).state, 'pending');
  });

  await scenario('Q13 a failed audit rolls back the choice and preserves the parked job', async f => {
    const { duplicate, issue } = await duplicateOnboardingCase(f), input = await request(f, issue, duplicate.id);
    await f.admin.query("ALTER TABLE sophie_core.shuttle_delivery_rechecks ADD CONSTRAINT synthetic_choice_failure CHECK (action <> 'select_channel')");
    try { await assert.rejects(f.store.chooseOnboardingChannel(input), error => error.code === '23514'); }
    finally { await f.admin.query('ALTER TABLE sophie_core.shuttle_delivery_rechecks DROP CONSTRAINT synthetic_choice_failure'); }
    assert.equal((await f.rows('case_provisions'))[0].chosen_channel_id, null); assert.equal((await audit(f)).length, 0);
    assert.equal((await f.rows('outbox')).find(row => row.operation_id === issue.operation_id).status, 'parked');
    assert.equal((await freshIssue(f, issue)).revision, issue.revision);
  });

  await scenario('Q14 delivery pause and disabled commands retain a choice without applying channel writes', async f => {
    const { duplicate, issue } = await duplicateOnboardingCase(f); f.clock.enabled = false;
    assert.equal(await channelChoice(f, issue, duplicate.id), 'disabled'); f.clock.enabled = true;
    await f.admin.query('UPDATE sophie_core.discord_backoff SET paused = true');
    assert.equal(await channelChoice(f, issue, duplicate.id), 'shuttle_channel_recorded'); const count = writes(f).length;
    assert.equal((await f.cases.runOnce('paused-choice')).status, 'idle'); assert.equal(writes(f).length, count);
    await f.admin.query('UPDATE sophie_core.discord_backoff SET paused = false'); await f.drain(f.cases);
  });

  await scenario('Q15 migration retains ambiguous cases without inferring a choice or changing old audits', async f => {
    const { issue } = await duplicateOnboardingCase(f);
    await issueRecheck(f, issue); assert.equal((await f.cases.runOnce('migration-audit')).code, 'CASE_CHANNEL_DUPLICATE');
    const retained = await audit(f), current = await freshIssue(f, issue), client = await f.admin.connect();
    try {
      await client.query('BEGIN');
      await client.query('ALTER TABLE sophie_core.case_provisions DROP COLUMN chosen_channel_id, DROP COLUMN chosen_candidates');
      await client.query(`ALTER TABLE sophie_core.shuttle_delivery_rechecks DROP COLUMN candidate_ids,
        DROP CONSTRAINT shuttle_delivery_rechecks_action_check`);
      await client.query("ALTER TABLE sophie_core.shuttle_delivery_rechecks ADD CONSTRAINT shuttle_delivery_rechecks_action_check CHECK (action IN ('recheck', 'adopt_message')), ADD CONSTRAINT shuttle_recovery_result CHECK (result_id IS NULL OR result_id ~ '^[1-9][0-9]{0,19}$')");
      await client.query("UPDATE sophie_core.case_reservations SET state = 'open'");
      await client.query("UPDATE sophie_core.outbox SET status = 'done' WHERE kind = 'case.provision'");
      await client.query(await readFile(new URL('../../apps/core/storage/migrations/015-case-channel-selection.sql', import.meta.url), 'utf8'));
      const row = (await client.query('SELECT chosen_channel_id, chosen_candidates, create_started FROM sophie_core.case_provisions')).rows[0];
      assert.deepEqual(row, { chosen_channel_id: null, chosen_candidates: null, create_started: true });
      assert.equal((await client.query('SELECT state FROM sophie_core.case_reservations')).rows[0].state, 'pending');
      assert.equal((await client.query('SELECT revision FROM sophie_core.shuttle_delivery_issues WHERE id = $1', [issue.id])).rows[0].revision, current.revision);
      assert.deepEqual((await client.query('SELECT * FROM sophie_core.shuttle_delivery_rechecks')).rows, retained);
      const jobs = (await client.query("SELECT * FROM sophie_core.outbox WHERE kind = 'case.provision' AND status = 'ready'")).rows;
      assert.equal(jobs.length, 1); assert.equal(jobs[0].dispatch_started, false); assert.match(jobs[0].operation_id, /^case.selection.migration15\./);
    } finally { await client.query('ROLLBACK'); client.release(); }
  });

  await scenario('Q16 a late opening of the discarded candidate is compensated after the newer worker finishes', async f => {
    assert.equal(await f.execute(f.payload()), 'shuttle_recorded'); await f.cases.runOnce('initial-create');
    const original = [...f.discord.state.channels.values()].find(row => row.type === 0), plan = await casePlanFor(f);
    const actor = await f.actor(OTHER), duplicate = { ...structuredClone(original), id: f.nextId() };
    // Independent clients share only simulated remote state, like two live workers.
    const clock = () => f.clock.now, transport = createDiscordTransport({ guildId: GUILD,
      token: 'synthetic-test-token-not-a-secret', fetch: f.discord.fetch, clock, enabled: () => true });
    const roles = createDiscordRoles({ transport, mapping, clock, readContinuity: f.discord.roles.readContinuity });
    const channels = createCaseChannels({ transport, roles, mapping, policy: casePolicy, clock });
    const store = createCoreStore({ pool: f.pool, clock, authorize: async () => true, casePolicy, caseVerification: channels.verification });
    const worker = createCaseDispatcher({ outbox: f.outbox, store, roles, channels, enabled: () => true });
    f.discord.state.before = async call => {
      if (call.method !== 'PATCH') return; f.discord.state.before = null;
      await f.admin.query("UPDATE sophie_core.outbox SET lease_until = clock_timestamp() - interval '1 second' WHERE status = 'leased'");
      f.discord.state.channels.set(duplicate.id, duplicate);
      assert.equal((await worker.runOnce('new-worker')).code, 'CASE_CHANNEL_DUPLICATE');
      const issue = (await f.rows('shuttle_delivery_issues'))[0];
      await store.chooseOnboardingChannel({ actor, interactionId: f.nextId(), issueId: issue.id, expectedRevision: issue.revision,
        resultId: duplicate.id, observation: await roles.observe(USER), proof: await channels.inspect(plan, duplicate.id) });
      await f.drain(worker); assert.equal((await state(f)).channel_id, duplicate.id);
      // The old request now reaches Discord after the selected case was confirmed.
    };
    assert.deepEqual(await f.cases.runOnce('old-worker'), { status: 'lease_lost' });
    await exact(f, original.id, false);
    assert.ok((await f.rows('outbox')).some(row => row.kind === 'case.provision' && row.status === 'ready'));
    await f.drain(f.cases); await exact(f, original.id, true); await exact(f, duplicate.id, false);
    assert.equal((await state(f)).channel_id, duplicate.id);
    assert.equal(writes(f).filter(call => call.method === 'POST').length, 1);
  });

  await scenario('Q17 a new candidate arriving during the selected opening prevents confirmation', async f => {
    const { original, duplicate, issue } = await duplicateOnboardingCase(f); await channelChoice(f, issue, duplicate.id);
    const extra = { ...structuredClone(original), id: f.nextId() }, plan = await casePlanFor(f);
    f.discord.state.channels.set(extra.id, extra);
    const proof = await f.discord.channels.inspect(plan, extra.id); f.discord.state.channels.delete(extra.id);
    const job = (await f.rows('outbox')).find(row => row.operation_id === issue.operation_id);
    f.discord.state.before = async call => {
      if (call.method !== 'PATCH') return; f.discord.state.before = null; f.discord.state.channels.set(extra.id, extra);
      await f.store.noteCaseChannel({ claim: { guildId: GUILD, operationId: job.operation_id, owner: 'late-candidate', fence: job.fence }, proof });
    };
    assert.equal((await f.cases.runOnce('opening-race')).code, 'CASE_CHANNEL_DUPLICATE');
    assert.equal((await state(f)).state, 'pending'); assert.equal((await f.rows('case_channels')).length, 3);
    // The separately retained uncertain-access job seals the now-unresolved set.
    assert.equal((await f.cases.runOnce('seal-race')).status, 'progressed');
    assert.equal((await f.cases.runOnce('review-race')).code, 'CASE_CHANNEL_DUPLICATE');
    for (const channel of [original, duplicate, extra]) await exact(f, channel.id, true);
  });

  await scenario('Q18 channel selection excludes other case types and refuses a changed operation marker', async f => {
    const { duplicate, issue } = await duplicateOnboardingCase(f), topic = duplicate.topic;
    duplicate.topic = 'unrecognised synthetic marker';
    assert.equal(await channelChoice(f, issue, duplicate.id), 'shuttle_issue_review'); duplicate.topic = topic;
    await f.admin.query("UPDATE sophie_core.case_reservations SET type = 'head-admin-contact'");
    assert.equal(await channelChoice(f, issue, duplicate.id), 'shuttle_issue_stale'); assert.equal((await audit(f)).length, 0);
  });
}
