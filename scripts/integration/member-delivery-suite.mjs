import assert from 'node:assert/strict';
import { createCoreStore } from '../../apps/core/storage/core-store.js';
import { createOutbox } from '../../apps/core/storage/outbox.js';
import { createMembershipDispatcher } from '../../apps/core/discord/dispatcher.js';
import { GUILD, USER, NOW, moderator, observation } from '../../tests/fixtures/domain.js';
import { simulatedDiscord, CREW, MUZZLED, WHITELIST, BYOND_ROLE } from '../../tests/fixtures/discord.js';

/** Actual database/outbox and fixed-route HTTP adapter, with synthetic role metadata. */
export async function runMemberDeliverySuite(cluster, run) {
  const pool = cluster.corePool;
  const admin = cluster.adminPool;
  let sequence = 600000000000000000n;
  const nextId = () => String(++sequence);
  let allowed, operatorChecks, discord, store, outbox, dispatcher;
  const readMember = async () => (await admin.query('SELECT state FROM sophie_core.members WHERE guild_id = $1 AND user_id = $2', [GUILD, USER])).rows[0].state;
  const jobs = async () => (await admin.query('SELECT * FROM sophie_core.outbox ORDER BY created_at, operation_id')).rows;
  const writes = () => discord.state.calls.filter(call => call.method !== 'GET');
  const observed = () => discord.roles.observe(USER);
  const roles = () => discord.state.members.get(USER);
  const request = async muted => store[muted ? 'requestMute' : 'requestUnmute']({ actor: moderator, interactionId: nextId(), observation: await observed() });
  const concurrentRequest = muted => store[muted ? 'requestMute' : 'requestUnmute']({ actor: moderator, interactionId: nextId(),
    observation: observation({ crew: roles().includes(CREW), muzzled: roles().includes(MUZZLED), whitelist: roles().includes(WHITELIST) }) });
  async function drain() {
    for (let i = 0; i < 12; i++) {
      const result = await dispatcher.runOnce('member-worker');
      if (result.status === 'idle') return;
      assert.ok(['settled', 'progressed'].includes(result.status), JSON.stringify(result));
    }
    assert.fail('Member role queue did not settle within the test bound');
  }
  const scenario = async (name, work) => run(name, async () => {
    await admin.query("UPDATE sophie_core.discord_backoff SET until_at = '-infinity', paused = false");
    await admin.query(`TRUNCATE sophie_core.case_reply_events, sophie_core.case_replies, sophie_core.case_label_changes, sophie_core.case_notes, sophie_core.case_direct_notices, sophie_core.case_attachment_jobs, sophie_core.case_attachment_attempts, sophie_core.case_attachment_capacity, sophie_core.case_message_observations, sophie_core.case_capture_gaps, sophie_core.case_capture_channels, sophie_core.case_participant_actions, sophie_core.case_participants, sophie_core.case_form_editor_actions, sophie_core.case_form_drafts, sophie_core.case_delivery_actions, sophie_core.case_delivery_issues, sophie_core.case_intake_messages, sophie_core.case_intakes, sophie_core.case_form_slots, sophie_core.case_form_actions, sophie_core.case_forms, sophie_core.shuttle_editor_actions, sophie_core.shuttle_draft_revisions, sophie_core.dashboard_sessions, sophie_core.dashboard_login_flows, sophie_core.dashboard_auth_limits, sophie_core.dashboard_auth_policies, sophie_core.case_inspection_sweeps, sophie_core.case_staff_actions, sophie_core.case_lifecycle_actions, sophie_core.shuttle_delivery_rechecks, sophie_core.shuttle_delivery_issues, sophie_core.shuttle_alerts, sophie_core.shuttle_help_resolutions, sophie_core.shuttle_screens, sophie_core.shuttle_help_requests, sophie_core.shuttle_publications, sophie_core.shuttle_cases, sophie_core.gateway_members, sophie_core.gateway_lifecycle, sophie_core.member_actions, sophie_core.outbox, sophie_core.receipts, sophie_core.sessions,
      sophie_core.members, sophie_core.definitions, sophie_core.case_provisions, sophie_core.case_channels, sophie_core.case_policies,
      sophie_core.case_reservations, sophie_core.case_budgets, sophie_core.case_exclusions`);
    allowed = true; operatorChecks = 0;
    discord = simulatedDiscord();
    store = createCoreStore({ pool, clock: () => NOW, authorize: async () => true,
      authorizeRecorded: async (capability, grant, scope) => {
        operatorChecks++;
        return allowed && ['member.mute', 'member.unmute'].includes(capability) &&
          grant.userId === moderator.userId && grant.capabilityEpoch === 1 && grant.policyVersion === 1 &&
          grant.guildId === GUILD && scope.guildId === GUILD && scope.userId === USER;
      } });
    outbox = createOutbox({ pool });
    dispatcher = createMembershipDispatcher({ outbox, store, discord: discord.roles, enabled: () => true });
    await work();
    if (roles()) assert.ok(roles().includes(BYOND_ROLE));
    assert.equal(writes().some(call => call.path.endsWith(`/${WHITELIST}`) || call.path.endsWith(`/${BYOND_ROLE}`)), false);
  });

  await scenario('M01 a current unmuted member receives only Crew', async () => {
    discord.state.members.set(USER, [BYOND_ROLE]);
    await store.recordObservation(await observed());
    await drain();
    assert.deepEqual(new Set(roles()), new Set([BYOND_ROLE, CREW]));
    assert.equal(writes().length, 1);
  });

  await scenario('M02 an externally applied Muzzled role removes Crew without an automatic unmute', async () => {
    roles().push(MUZZLED);
    await store.recordObservation(await observed()); await drain();
    assert.deepEqual(new Set(roles()), new Set([BYOND_ROLE, MUZZLED]));
    assert.equal(writes().length, 1);
    assert.equal(operatorChecks, 0);
  });

  await scenario('M03 mute removes Crew before applying Muzzled and retains the durable block', async () => {
    const interactionId = nextId();
    const observation = await observed();
    await store.requestMute({ actor: moderator, interactionId, observation });
    await store.requestMute({ actor: moderator, interactionId, observation });
    assert.equal((await jobs()).length, 1);
    assert.equal((await readMember()).muteRequested, true);
    assert.equal((await dispatcher.runOnce('member-worker')).status, 'progressed');
    assert.deepEqual(roles(), [BYOND_ROLE]);
    await drain();
    assert.deepEqual(new Set(roles()), new Set([BYOND_ROLE, MUZZLED]));
    assert.deepEqual(writes().map(call => [call.method, call.path.split('/').at(-1)]), [['DELETE', CREW], ['PUT', MUZZLED]]);
    assert.equal((await readMember()).muteRequested, true);
    assert.ok(operatorChecks >= 2);
  });

  await scenario('M04 unmute is confirmed before Crew is returned', async () => {
    await request(true); await drain();
    await request(false);
    discord.state.afterWrite = async call => {
      if (call.method === 'DELETE' && call.path.endsWith(MUZZLED)) {
        assert.equal((await readMember()).muteRequested, true);
        assert.equal(roles().includes(CREW), false);
      }
    };
    assert.equal((await dispatcher.runOnce('member-worker')).status, 'progressed');
    assert.equal((await readMember()).muteRequested, false);
    assert.equal(roles().includes(CREW), false);
    await drain();
    assert.deepEqual(new Set(roles()), new Set([BYOND_ROLE, CREW]));
  });

  await scenario('M05 a newer mute supersedes an unmute already in flight', async () => {
    await request(true); await drain(); await request(false);
    discord.state.afterWrite = async call => {
      if (call.method === 'DELETE' && call.path.endsWith(MUZZLED)) {
        discord.state.afterWrite = null;
        await concurrentRequest(true);
      }
    };
    assert.deepEqual(await dispatcher.runOnce('member-worker'), { status: 'settled', code: 'MEMBER_ACTION_SUPERSEDED' });
    await drain();
    assert.deepEqual(new Set(roles()), new Set([BYOND_ROLE, MUZZLED]));
    assert.equal((await readMember()).muteRequested, true);
    assert.equal(writes().filter(call => call.method === 'PUT' && call.path.endsWith(CREW)).length, 0);
  });

  await scenario('M06 a newer unmute compensates a superseded in-flight Muzzled addition', async () => {
    await request(true);
    await dispatcher.runOnce('member-worker'); // Crew removal.
    discord.state.afterWrite = async call => {
      if (call.method === 'PUT' && call.path.endsWith(MUZZLED)) {
        discord.state.afterWrite = null;
        await concurrentRequest(false);
      }
    };
    assert.equal((await dispatcher.runOnce('member-worker')).code, 'MEMBER_ACTION_SUPERSEDED');
    await drain();
    assert.deepEqual(new Set(roles()), new Set([BYOND_ROLE, CREW]));
    assert.equal((await readMember()).muteRequested, false);
  });

  await scenario('M07 lost moderator authority prevents a queued Muzzled addition', async () => {
    await request(true);
    allowed = false;
    const result = await dispatcher.runOnce('member-worker');
    assert.deepEqual(result, { status: 'operator_required', code: 'OPERATION_DENIED' });
    assert.equal(roles().includes(MUZZLED), false);
    assert.equal(roles().includes(CREW), false);
    assert.equal((await readMember()).muteRequested, true);
  });

  await scenario('M08 lost moderator authority prevents unmute and Crew restoration', async () => {
    await request(true); await drain(); await request(false);
    allowed = false;
    assert.deepEqual(await dispatcher.runOnce('member-worker'), { status: 'operator_required', code: 'OPERATION_DENIED' });
    assert.deepEqual(new Set(roles()), new Set([BYOND_ROLE, MUZZLED]));
    assert.equal((await readMember()).muteRequested, true);
  });

  await scenario('M09 an expired worker records uncertainty and cannot acknowledge its old lease', async () => {
    await request(true); await dispatcher.runOnce('member-worker');
    let replacement;
    discord.state.afterWrite = async () => {
      discord.state.afterWrite = null;
      await admin.query("UPDATE sophie_core.outbox SET lease_until = clock_timestamp() - interval '1 second' WHERE status = 'leased'");
      replacement = (await outbox.claim('replacement', 30_000, ['member.reconcile'])).claim;
    };
    assert.equal((await dispatcher.runOnce('expired')).status, 'lease_lost');
    assert.equal((await jobs()).find(job => job.status === 'leased').lease_owner, 'replacement');
    await store.inspectMemberReconciliation({ claim: replacement, observation: await observed() }); await drain();
    assert.deepEqual(new Set(roles()), new Set([BYOND_ROLE, MUZZLED]));
    assert.equal(writes().length, 2);
  });

  await scenario('M10 a lost response is recovered from observed roles without duplicating the write', async () => {
    await request(true);
    discord.state.afterWrite = () => { throw new Error('synthetic lost response'); };
    assert.equal((await dispatcher.runOnce('member-worker')).status, 'retry_scheduled');
    discord.state.afterWrite = null;
    await admin.query("UPDATE sophie_core.outbox SET available_at = clock_timestamp() WHERE status = 'ready'");
    await drain();
    assert.deepEqual(new Set(roles()), new Set([BYOND_ROLE, MUZZLED]));
    assert.equal(writes().length, 2);
  });

  await scenario('M11 a late Crew addition is reconciled against the current mute decision', async () => {
    await request(true); await drain();
    roles().push(CREW);
    await store.recordObservation(await observed()); await drain();
    assert.deepEqual(new Set(roles()), new Set([BYOND_ROLE, MUZZLED]));
  });

  await scenario('M12 completed unmute does not authorise removing a later manual Muzzled role', async () => {
    await request(true); await drain(); await request(false); await drain();
    roles().push(MUZZLED);
    await store.recordObservation(await observed()); await drain();
    assert.deepEqual(new Set(roles()), new Set([BYOND_ROLE, MUZZLED]));
  });

  await scenario('M13 departure cancels the old effect and rejoin requires a fresh moderation decision', async () => {
    await request(true);
    discord.state.members.delete(USER);
    assert.equal((await dispatcher.runOnce('member-worker')).code, 'MEMBER_ABSENT');
    discord.state.members.set(USER, [BYOND_ROLE]);
    await store.recordObservation(await observed());
    assert.deepEqual(await dispatcher.runOnce('member-worker'), { status: 'operator_required', code: 'MEMBER_ACTION_EPOCH_CHANGED' });
    assert.deepEqual(roles(), [BYOND_ROLE]);
    await request(true); await drain();
    assert.deepEqual(new Set(roles()), new Set([BYOND_ROLE, MUZZLED]));
  });

  await scenario('M14 recorded moderation defaults to denial without a current-authority adapter', async () => {
    await request(true); await dispatcher.runOnce('member-worker');
    const deniedStore = createCoreStore({ pool, clock: () => NOW, authorize: async () => true });
    const deniedDispatcher = createMembershipDispatcher({ outbox, store: deniedStore, discord: discord.roles, enabled: () => true });
    assert.deepEqual(await deniedDispatcher.runOnce('unconfigured-worker'), { status: 'operator_required', code: 'OPERATION_DENIED' });
    assert.deepEqual(roles(), [BYOND_ROLE]);
  });
}
