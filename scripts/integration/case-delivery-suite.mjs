import { moderator } from '../../tests/fixtures/domain.js';
import { closeTestCase } from '../../tests/fixtures/case-lifecycle.js';
import assert from 'node:assert/strict';
import { createCoreStore } from '../../apps/core/storage/core-store.js';
import { createOutbox } from '../../apps/core/storage/outbox.js';
import { createCaseDispatcher } from '../../apps/core/discord/case-dispatcher.js';
import { createCaseChannels } from '../../apps/core/discord/case-channels.js';
import { caseChannelPayload } from '../../modules/tickets/channel-policy.js';
import { channelPermissions, PERMISSIONS } from '../../platform/authorization/discord-permissions.js';
import { GUILD, USER, OTHER, STAFF, LEAD, NOW, observation } from '../../tests/fixtures/domain.js';
import { BOT_ROLE, CREW, WHITELIST, BYOND_ROLE, mapping } from '../../tests/fixtures/discord.js';
import { simulatedCases, casePolicy, CATEGORY } from '../../tests/fixtures/cases.js';

/** Actual transactions/fencing; fixed-route Discord HTTP simulated with metadata only. */
export async function runCaseDeliverySuite(cluster, run) {
  const pool = cluster.corePool, admin = cluster.adminPool;
  let sequence = 700000000000000000n;
  const nextId = () => String(++sequence);
  let discord, store, outbox, dispatcher, enabled, now = NOW;
  const obs = overrides => observation({ observedAt: now, ...overrides });
  const read = async table => (await admin.query(`SELECT * FROM sophie_core.${table}`)).rows;
  const writes = method => discord.state.calls.filter(call => call.method !== 'GET' && (!method || call.method === method));
  const channels = () => [...discord.state.channels.values()].filter(channel => channel.type === 0);
  const limits = { memberOpen: 5, guildPending: 10, cooldownMs: 1_000 };
  const reserve = (type = 'admin-help') => {
    now += 1_000;
    return store.reserveCase({ actor: {}, interactionId: nextId(), id: `case-${sequence}`,
      type, observation: obs({ whitelist: discord.state.members.get(USER)?.includes(WHITELIST) ?? false }), limits });
  };
  const makeDue = () => admin.query("UPDATE sophie_core.outbox SET available_at = clock_timestamp() - interval '1 second' WHERE status = 'ready'");
  const expire = () => admin.query("UPDATE sophie_core.outbox SET lease_until = clock_timestamp() - interval '1 second' WHERE status = 'leased'");
  const left = () => obs({ present: false, crew: false });
  async function plan() {
    const row = (await read('case_provisions'))[0], reservation = (await read('case_reservations'))[0];
    return { id: row.case_id, guildId: GUILD, openerId: USER, type: reservation.type,
      policyVersion: row.policy_version, token: row.operation_token, presenceEpoch: Number(row.presence_epoch) };
  }
  function view(channel, userId, roleIds) {
    return !!(channelPermissions({ guildId: GUILD, userId, roleIds, overwrites: channel.permission_overwrites,
      roles: discord.state.roles.map(({ id, permissions }) => ({ id, permissions })) }) & PERMISSIONS.viewChannel);
  }
  async function drain() {
    await makeDue();
    for (let i = 0; i < 12; i++) {
      const result = await dispatcher.runOnce('case-worker');
      if (result.status === 'idle') return;
      assert.ok(['settled', 'progressed'].includes(result.status), JSON.stringify(result));
    }
    assert.fail('Case delivery did not settle within the test bound');
  }
  const scenario = async (name, work) => run(name, async () => {
    await admin.query("UPDATE sophie_core.discord_backoff SET until_at = '-infinity', paused = false");
    await admin.query(`TRUNCATE sophie_core.case_reply_events, sophie_core.case_replies, sophie_core.case_label_changes, sophie_core.case_notes, sophie_core.case_direct_notices, sophie_core.case_attachment_jobs, sophie_core.case_attachment_attempts, sophie_core.case_attachment_capacity, sophie_core.case_message_observations, sophie_core.case_capture_gaps, sophie_core.case_capture_channels, sophie_core.case_participant_actions, sophie_core.case_participants, sophie_core.case_form_editor_actions, sophie_core.case_form_drafts, sophie_core.case_delivery_actions, sophie_core.case_delivery_issues, sophie_core.case_intake_messages, sophie_core.case_intakes, sophie_core.case_form_slots, sophie_core.case_form_actions, sophie_core.case_forms, sophie_core.shuttle_editor_actions, sophie_core.shuttle_draft_revisions, sophie_core.dashboard_sessions, sophie_core.dashboard_login_flows, sophie_core.dashboard_auth_limits, sophie_core.dashboard_auth_policies, sophie_core.case_inspection_sweeps, sophie_core.case_staff_actions, sophie_core.case_lifecycle_actions, sophie_core.shuttle_delivery_rechecks, sophie_core.shuttle_delivery_issues, sophie_core.shuttle_alerts, sophie_core.shuttle_help_resolutions, sophie_core.shuttle_screens, sophie_core.shuttle_help_requests, sophie_core.shuttle_publications, sophie_core.shuttle_cases, sophie_core.gateway_members, sophie_core.gateway_lifecycle, sophie_core.actor_authority, sophie_core.capability_policies, sophie_core.member_actions,
      sophie_core.outbox, sophie_core.receipts, sophie_core.sessions, sophie_core.members, sophie_core.definitions,
      sophie_core.case_channels, sophie_core.case_provisions, sophie_core.case_policies,
      sophie_core.case_reservations, sophie_core.case_budgets, sophie_core.case_exclusions`);
    enabled = true; now = NOW;
    discord = simulatedCases({ clock: () => now });
    store = createCoreStore({ pool, clock: () => now, authorize: async () => true,
      casePolicy, caseVerification: discord.channels.verification });
    outbox = createOutbox({ pool });
    dispatcher = createCaseDispatcher({ outbox, store, roles: discord.roles, channels: discord.channels, enabled: () => enabled });
    await work();
    assert.equal(writes('DELETE').length, 0);
  });

  await scenario('C01 private creation precedes verified audience access and confirmed case state', async () => {
    await reserve();
    assert.deepEqual(await dispatcher.runOnce('worker'), { status: 'progressed' });
    assert.equal(channels().length, 1);
    assert.equal(view(channels()[0], USER, [CREW]), false);
    assert.equal(view(channels()[0], OTHER, [STAFF, LEAD]), false);
    assert.equal((await read('case_reservations'))[0].state, 'pending');
    assert.equal((await read('case_exclusions'))[0].channel_id, channels()[0].id);
    assert.deepEqual(await dispatcher.runOnce('worker'), { status: 'settled', opened: true });
    assert.equal(view(channels()[0], USER, [CREW]), true);
    assert.equal(view(channels()[0], OTHER, [STAFF]), true);
    assert.equal(view(channels()[0], OTHER, [CREW, BYOND_ROLE]), false);
    assert.equal((await read('case_reservations'))[0].state, 'open');
    assert.deepEqual(writes().map(call => call.method), ['POST', 'PATCH']);
  });

  await scenario('C02 Head Admin contact excludes ordinary Staff while Staff Report includes Staff', async () => {
    discord.state.members.set(USER, [CREW, STAFF]);
    await reserve('head-admin-contact'); await drain();
    assert.equal(view(channels()[0], USER, [STAFF]), true);
    assert.equal(view(channels()[0], OTHER, [STAFF]), false);
    assert.equal(view(channels()[0], OTHER, [LEAD]), true);
    await reserve('staff-report'); await drain();
    assert.equal(view(channels()[1], OTHER, [STAFF]), true);
    assert.equal(view(channels()[1], OTHER, [CREW]), false);
  });

  await scenario('C03 lost create response is reconciled by marker without a duplicate POST', async () => {
    await reserve();
    discord.state.afterWrite = call => { if (call.method === 'POST') throw new Error('SYNTHETIC_LOST_RESPONSE'); };
    assert.deepEqual(await dispatcher.runOnce('worker'), { status: 'retry_scheduled', code: 'DELIVERY_UNCERTAIN' });
    assert.equal((await read('case_channels')).length, 0);
    discord.state.afterWrite = null; await drain();
    assert.equal(writes('POST').length, 1);
    assert.equal((await read('case_reservations'))[0].state, 'open');
    assert.equal((await read('case_exclusions')).length, 1);
  });

  await scenario('C04 ambiguous creation with no observed result parks without blindly retrying', async () => {
    await reserve();
    discord.state.before = call => { if (call.method === 'POST') throw new Error('SYNTHETIC_TIMEOUT'); };
    assert.equal((await dispatcher.runOnce('worker')).status, 'retry_scheduled');
    discord.state.before = null; await makeDue();
    assert.deepEqual(await dispatcher.runOnce('worker'), { status: 'operator_required', code: 'CASE_CREATION_UNCERTAIN' });
    assert.equal(writes('POST').length, 1);
    assert.equal((await read('case_reservations'))[0].state, 'pending');
    assert.equal((await read('outbox'))[0].status, 'parked');
  });

  await scenario('C05 duplicate marker candidates are all retained and excluded, never opened', async () => {
    await reserve(); await dispatcher.runOnce('worker');
    const duplicate = { ...structuredClone(channels()[0]), id: '300000000000000099' };
    discord.state.channels.set(duplicate.id, duplicate);
    assert.deepEqual(await dispatcher.runOnce('worker'), { status: 'operator_required', code: 'CASE_CHANNEL_DUPLICATE' });
    assert.equal((await read('case_channels')).length, 2);
    assert.equal((await read('case_exclusions')).length, 2);
    assert.equal(writes('PATCH').length, 0);
    assert.ok(channels().every(channel => !view(channel, USER, [CREW])));
  });

  await scenario('C06 an expired create lease can retain its channel but cannot acknowledge a newer worker', async () => {
    await reserve(); let replacement;
    discord.state.afterWrite = async call => {
      if (call.method !== 'POST') return;
      await expire(); replacement = await outbox.claim('new-worker', 30_000, ['case.provision']);
    };
    assert.deepEqual(await dispatcher.runOnce('old-worker'), { status: 'lease_lost' });
    assert.equal((await read('case_channels')).length, 1);
    assert.equal((await read('outbox'))[0].lease_owner, 'new-worker');
    assert.equal(replacement.claim.fence, 2);
    discord.state.afterWrite = null; await expire(); await drain();
    assert.equal(writes('POST').length, 1);
    assert.equal((await read('case_reservations'))[0].state, 'open');
  });

  await scenario('C07 missing channel permission parks before any channel is created', async () => {
    await reserve();
    discord.state.roles.find(role => role.id === BOT_ROLE).permissions = String(PERMISSIONS.manageRoles);
    assert.deepEqual(await dispatcher.runOnce('worker'), { status: 'operator_required', code: 'BOT_PERMISSION_MISSING' });
    assert.equal(writes().length, 0);
    assert.equal((await read('case_provisions'))[0].create_started, false);
  });

  await scenario('C08 an invalid configured category cannot admit a case channel', async () => {
    await reserve(); discord.state.channels.get(CATEGORY).type = 0;
    assert.deepEqual(await dispatcher.runOnce('worker'), { status: 'operator_required', code: 'CASE_CATEGORY_INVALID' });
    assert.equal(writes().length, 0);
  });

  await scenario('C09 requester departure before creation releases reservation without a channel', async () => {
    await reserve(); discord.state.members.delete(USER);
    assert.deepEqual(await dispatcher.runOnce('worker'), { status: 'settled', code: 'CASE_REQUESTER_LEFT' });
    assert.equal((await read('case_reservations'))[0].state, 'failed');
    assert.equal((await read('outbox'))[0].status, 'cancelled');
    assert.equal(writes().length, 0);
  });

  await scenario('C10 departure after private creation retains a sealed channel and its permanent exclusion', async () => {
    await reserve(); await dispatcher.runOnce('worker'); discord.state.members.delete(USER);
    assert.deepEqual(await dispatcher.runOnce('worker'), { status: 'settled', opened: false });
    assert.equal(view(channels()[0], OTHER, [STAFF, LEAD]), false);
    assert.equal((await read('case_reservations'))[0].state, 'failed');
    assert.equal((await read('case_exclusions')).length, 1);
    assert.equal(writes('PATCH').length, 0);
  });

  await scenario('C11 departure during audience delivery triggers a compensating seal before settlement', async () => {
    await reserve(); await dispatcher.runOnce('worker');
    discord.state.afterWrite = call => { if (call.method === 'PATCH') discord.state.members.delete(USER); };
    assert.deepEqual(await dispatcher.runOnce('worker'), { status: 'progressed' });
    assert.equal((await read('case_reservations'))[0].state, 'pending');
    assert.equal(view(channels()[0], OTHER, [STAFF]), true);
    discord.state.afterWrite = null; await drain();
    assert.equal(view(channels()[0], OTHER, [STAFF]), false);
    assert.equal((await read('case_reservations'))[0].state, 'failed');
    assert.equal(writes('PATCH').length, 2);
  });

  await scenario('C12 leave and rejoin cannot revive a case from the previous membership episode', async () => {
    await reserve(); await dispatcher.runOnce('worker');
    await store.recordObservation(left());
    await store.recordObservation(obs());
    await drain();
    assert.equal((await read('case_reservations'))[0].state, 'failed');
    assert.equal((await read('members'))[0].state.presenceEpoch, 1);
    assert.equal(view(channels()[0], USER, [CREW]), false);
  });

  await scenario('C13 Whitelist loss invalidates Shuttle eligibility without cancelling an ordinary case', async () => {
    discord.state.members.get(USER).push(WHITELIST); await reserve();
    discord.state.members.set(USER, [CREW, BYOND_ROLE]); await drain();
    assert.equal((await read('case_reservations'))[0].state, 'open');
    assert.equal((await read('members'))[0].state.presenceEpoch, 0);
    assert.equal((await read('members'))[0].state.eligibilityEpoch, 1);
  });

  await scenario('C14 broadened overwrites and a moved parent are repaired before open confirmation', async () => {
    await reserve(); await dispatcher.runOnce('worker');
    channels()[0].parent_id = OTHER;
    channels()[0].permission_overwrites = [{ id: GUILD, type: 0, allow: String(PERMISSIONS.viewChannel), deny: '0' }];
    await drain();
    assert.equal(channels()[0].parent_id, CATEGORY);
    assert.equal(view(channels()[0], OTHER, [CREW]), false);
    assert.equal((await read('case_reservations'))[0].state, 'open');
  });

  await scenario('C15 arbitrary channel IDs and forged certificates cannot confirm a private case', async () => {
    await reserve(); await dispatcher.runOnce('worker');
    const { claim } = await outbox.claim('worker', 30_000, ['case.provision']);
    await assert.rejects(store.confirmCaseProvision({ claim, observation: obs(), channelId: channels()[0].id }), /CASE_OBSERVATION_UNTRUSTED/);
    await assert.rejects(store.confirmCaseProvision({ claim, observation: obs(), proof: { channelId: channels()[0].id } }), /CASE_OBSERVATION_UNTRUSTED/);
    const proof = await discord.channels.inspect(await plan(), channels()[0].id);
    await assert.rejects(store.confirmCaseProvision({ claim, observation: obs(), proof }), /CASE_CHANNEL_ACL_MISMATCH/);
    assert.equal((await read('case_reservations'))[0].state, 'pending');
    assert.equal((await read('outbox'))[0].status, 'leased');
  });

  await scenario('C16 a deleted or unrecognisable known channel is not recreated', async () => {
    await reserve(); await dispatcher.runOnce('worker');
    discord.state.channels.delete(channels()[0].id);
    assert.deepEqual(await dispatcher.runOnce('worker'), { status: 'operator_required', code: 'CASE_CHANNEL_MISSING' });
    assert.equal(writes('POST').length, 1);
    assert.equal((await read('case_exclusions')).length, 1);
  });

  await scenario('C17 immutable policy versions and current delivery gate reject stale configuration', async () => {
    await reserve();
    const changed = createCoreStore({ pool, clock: () => now, authorize: async () => true,
      casePolicy: { ...casePolicy, attachmentsAllowed: true } });
    await assert.rejects(changed.reserveCase({ actor: {}, interactionId: nextId(), id: 'changed-policy', type: 'admin-help', observation: obs(), limits }), /CASE_POLICY_IMMUTABLE/);
    now += 1_000;
    const newer = createCoreStore({ pool, clock: () => now, authorize: async () => true,
      casePolicy: { ...casePolicy, version: 2 } });
    await newer.reserveCase({ actor: {}, interactionId: nextId(), id: 'new-policy', type: 'admin-help', observation: obs(), limits });
    assert.deepEqual(await dispatcher.runOnce('worker'), { status: 'operator_required', code: 'CASE_POLICY_CHANGED' });
    assert.equal(writes().length, 0);
  });

  await scenario('C18 lost audience response is reconciled without another create and permanent records survive closure', async () => {
    const request = await reserve(); await dispatcher.runOnce('worker');
    discord.state.afterWrite = call => { if (call.method === 'PATCH') throw new Error('SYNTHETIC_LOST_RESPONSE'); };
    assert.equal((await dispatcher.runOnce('worker')).status, 'retry_scheduled');
    discord.state.afterWrite = null; await drain();
    assert.equal(writes('POST').length, 1); assert.equal(writes('PATCH').length, 1);
    await closeTestCase({ store, actor: moderator, observation: obs(), interactionId: nextId(), id: request.id, worker: dispatcher });
    assert.equal((await read('case_reservations'))[0].state, 'closed');
    assert.equal((await read('case_channels')).length, 1);
    assert.equal(await store.hasCaseExclusion({ guildId: GUILD, lineage: [channels()[0].id] }), true);
  });

  await scenario('C19 a late permission write after a newer worker seals is durably compensated', async () => {
    await reserve(); await dispatcher.runOnce('worker');
    const currentPlan = await plan();
    const sealed = await discord.channels.inspect(currentPlan, channels()[0].id);
    discord.state.before = async call => {
      if (call.method !== 'PATCH') return;
      discord.state.before = null;
      await expire();
      const replacement = await outbox.claim('replacement', 30_000, ['case.provision']);
      discord.state.members.delete(USER);
      await store.beginCaseAccess({ claim: replacement.claim, observation: left(), proof: sealed });
      await store.confirmCaseProvision({ claim: replacement.claim, observation: left(), proof: sealed });
      // The old request reaches Discord only after the newer worker finished.
    };
    assert.deepEqual(await dispatcher.runOnce('stale-worker'), { status: 'lease_lost' });
    assert.equal(view(channels()[0], OTHER, [STAFF]), true);
    assert.equal((await read('case_reservations'))[0].state, 'failed');
    assert.equal((await read('outbox')).filter(job => job.kind === 'case.provision' && job.status === 'ready').length, 1);
    await drain();
    assert.equal(view(channels()[0], OTHER, [STAFF]), false);
    assert.equal((await read('case_reservations'))[0].state, 'failed');
    assert.equal(writes('POST').length, 1);
  });

  await scenario('C20 case cooldown and disable gates prevent other workers or late mutations', async () => {
    await reserve();
    discord.state.before = () => new Response(JSON.stringify({ retry_after: 60, global: true }), { status: 429 });
    assert.deepEqual(await dispatcher.runOnce('worker'), { status: 'retry_scheduled', code: 'RATE_LIMITED' });
    const count = discord.state.calls.length;
    assert.equal(await outbox.claim('role-worker', 30_000, ['member.reconcile']), null);
    assert.deepEqual(await dispatcher.runOnce('worker'), { status: 'idle' });
    assert.equal(discord.state.calls.length, count);
    await admin.query("UPDATE sophie_core.discord_backoff SET until_at = '-infinity'");
    await makeDue();
    // New adapter has no in-memory cooldown; the activation check still prevents POST.
    discord = simulatedCases({ clock: () => now });
    store = createCoreStore({ pool, clock: () => now, authorize: async () => true,
      casePolicy, caseVerification: discord.channels.verification });
    discord.state.before = call => { if (call.path === `/api/v10/channels/${CATEGORY}`) enabled = false; };
    dispatcher = createCaseDispatcher({ outbox, store, roles: discord.roles, channels: discord.channels, enabled: () => enabled });
    assert.equal((await dispatcher.runOnce('worker')).status, 'retry_scheduled');
    assert.equal(writes().length, 0);
    assert.deepEqual(await dispatcher.runOnce('worker'), { status: 'disabled' });
  });

  await scenario('C21 the store independently rejects an adapter configured with a different audience policy', async () => {
    await reserve(); await dispatcher.runOnce('worker');
    const currentPlan = await plan();
    const differentPolicy = { ...casePolicy, attachmentsAllowed: true };
    const differentAdapter = createCaseChannels({ transport: discord.transport, roles: discord.roles, mapping,
      policy: differentPolicy, clock: () => now });
    channels()[0].permission_overwrites = caseChannelPayload(currentPlan, differentPolicy, false).permission_overwrites;
    const proof = await differentAdapter.inspect(currentPlan, channels()[0].id);
    const mismatchedStore = createCoreStore({ pool, clock: () => now, authorize: async () => true,
      casePolicy, caseVerification: differentAdapter.verification });
    const { claim } = await outbox.claim('worker', 30_000, ['case.provision']);
    await assert.rejects(mismatchedStore.confirmCaseProvision({ claim, observation: obs(), proof }), /CASE_CHANNEL_ACL_MISMATCH/);
    assert.equal((await read('case_reservations'))[0].state, 'pending');
  });
}
