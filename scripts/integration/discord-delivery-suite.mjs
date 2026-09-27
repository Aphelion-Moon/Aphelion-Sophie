import assert from 'node:assert/strict';
import { createCoreStore } from '../../apps/core/storage/core-store.js';
import { createOutbox } from '../../apps/core/storage/outbox.js';
import { createRoleDispatcher } from '../../apps/core/discord/dispatcher.js';
import { definition, GUILD, NOW, USER, observation, command, moderator } from '../../tests/fixtures/domain.js';
import { simulatedDiscord, BYOND_ROLE, WHITELIST } from '../../tests/fixtures/discord.js';
import { casePolicy } from '../../tests/fixtures/cases.js';

/** Real PostgreSQL plus simulated Discord HTTP; no live guild or credentials. */
export async function runDeliverySuite(cluster, run) {
  const pool = cluster.corePool;
  const admin = cluster.adminPool;
  let sequence = 500000000000000000n;
  const nextId = () => String(++sequence);
  const store = createCoreStore({ pool, clock: () => NOW, authorize: async () => true, casePolicy });
  const outbox = createOutbox({ pool });
  const metadata = async table => (await admin.query(`SELECT * FROM sophie_core.${table}`)).rows;
  let discord;
  let dispatcher;
  async function pending() {
    let { session } = await store.start({ actor: {}, interactionId: nextId(), id: `delivery-${sequence}`, nonce: 'initial', observation: await discord.roles.observe(USER), definitionId: definition.id });
    for (let i = 0; i < 5; i++) ({ session } = await store.transition({ actor: {}, action: 'advance', interactionId: nextId(), sessionId: session.id,
      command: command(session), observation: await discord.roles.observe(USER) }));
    return session;
  }
  const mute = () => store.requestMute({ actor: moderator, interactionId: nextId(), observation: observation() });
  const writes = () => discord.state.calls.filter(call => call.method !== 'GET');
  const scenario = async (name, work) => run(name, async () => {
    await admin.query("UPDATE sophie_core.discord_backoff SET until_at = '-infinity', paused = false");
    await admin.query(`TRUNCATE sophie_core.case_reply_events, sophie_core.case_replies, sophie_core.case_label_changes, sophie_core.case_notes, sophie_core.case_direct_notices, sophie_core.case_attachment_jobs, sophie_core.case_attachment_attempts, sophie_core.case_attachment_capacity, sophie_core.case_message_observations, sophie_core.case_capture_gaps, sophie_core.case_capture_channels, sophie_core.case_participant_actions, sophie_core.case_participants, sophie_core.case_form_editor_actions, sophie_core.case_form_drafts, sophie_core.case_delivery_actions, sophie_core.case_delivery_issues, sophie_core.case_intake_messages, sophie_core.case_intakes, sophie_core.case_form_slots, sophie_core.case_form_actions, sophie_core.case_forms, sophie_core.shuttle_editor_actions, sophie_core.shuttle_draft_revisions, sophie_core.dashboard_sessions, sophie_core.dashboard_login_flows, sophie_core.dashboard_auth_limits, sophie_core.dashboard_auth_policies, sophie_core.case_inspection_sweeps, sophie_core.case_staff_actions, sophie_core.case_lifecycle_actions, sophie_core.shuttle_delivery_rechecks, sophie_core.shuttle_delivery_issues, sophie_core.shuttle_alerts, sophie_core.shuttle_help_resolutions, sophie_core.shuttle_screens, sophie_core.shuttle_help_requests, sophie_core.shuttle_publications, sophie_core.shuttle_cases, sophie_core.gateway_members, sophie_core.gateway_lifecycle, sophie_core.outbox, sophie_core.receipts, sophie_core.sessions, sophie_core.member_actions, sophie_core.members,
      sophie_core.definitions, sophie_core.case_provisions, sophie_core.case_channels, sophie_core.case_policies,
      sophie_core.case_reservations, sophie_core.case_budgets, sophie_core.case_exclusions`);
    discord = simulatedDiscord();
    dispatcher = createRoleDispatcher({ outbox, store, discord: discord.roles, enabled: () => true });
    await store.publishDefinition({ actor: {}, definition });
    await work();
    assert.equal(discord.state.members.get(USER)?.includes(BYOND_ROLE), true);
  });
  async function makeDue() {
    await admin.query("UPDATE sophie_core.outbox SET available_at = clock_timestamp() - interval '1 second' WHERE status = 'ready'");
  }
  async function drain() {
    for (let i = 0; i < 10; i++) {
      const result = await dispatcher.runOnce('drain-worker');
      if (result.status === 'idle') return;
      assert.equal(result.status, 'settled');
    }
    assert.fail('Role queue did not settle within the test bound');
  }

  await scenario('D01 dispatcher grants only after five stages and confirms the observed role', async () => {
    await pending();
    assert.deepEqual(await dispatcher.runOnce('worker'), { status: 'settled' });
    assert.equal((await metadata('sessions'))[0].state.status, 'complete');
    assert.equal((await metadata('outbox'))[0].status, 'done');
    assert.equal(writes().length, 1);
    assert.equal(writes()[0].method, 'PUT');
  });

  await scenario('D02 a durable mute intent prevents the queued role write', async () => {
    await pending(); await mute();
    assert.deepEqual(await dispatcher.runOnce('worker'), { status: 'settled', code: 'MEMBER_MUZZLED' });
    assert.equal(writes().length, 0);
    assert.equal((await metadata('sessions'))[0].state.status, 'role_pending');
    assert.equal((await metadata('outbox')).find(row => row.kind === 'member.reconcile').status, 'ready');
  });

  await scenario('D03 mute during the HTTP request cancels completion and the next job removes the late grant', async () => {
    await pending();
    discord.state.before = async call => { if (call.method === 'PUT') await mute(); };
    assert.deepEqual(await dispatcher.runOnce('worker'), { status: 'settled', code: 'MEMBER_MUZZLED' });
    assert.equal(discord.state.members.get(USER).includes(WHITELIST), true);
    await drain();
    assert.equal(discord.state.members.get(USER).includes(WHITELIST), false);
    assert.deepEqual(writes().map(call => call.method), ['PUT', 'DELETE']);
    assert.equal((await metadata('members'))[0].state.eligibilityEpoch, 1);
    assert.equal((await metadata('sessions'))[0].current, false);
  });

  await scenario('D04 a worker that loses its lease records uncertainty without completing the old claim', async () => {
    await pending();
    let replacement;
    discord.state.afterWrite = async () => {
      await admin.query("UPDATE sophie_core.outbox SET lease_until = clock_timestamp() - interval '1 second' WHERE status = 'leased'");
      replacement = (await outbox.claim('replacement', 30_000, ['whitelist.grant'])).claim;
    };
    assert.deepEqual(await dispatcher.runOnce('expired-worker'), { status: 'lease_lost' });
    assert.equal((await metadata('outbox')).find(row => row.kind === 'whitelist.grant').lease_owner, 'replacement');
    assert.equal((await metadata('sessions'))[0].state.status, 'role_pending');
    await store.inspectGrant({ claim: replacement, observation: await discord.roles.observe(USER) });
    await drain();
    assert.equal((await metadata('sessions'))[0].state.status, 'complete');
    assert.equal(writes().length, 1);
  });

  await scenario('D05 an applied write with a lost response is observed on retry without repeating the write', async () => {
    await pending();
    discord.state.afterWrite = async () => { throw new Error('synthetic lost response'); };
    assert.deepEqual(await dispatcher.runOnce('worker'), { status: 'retry_scheduled', code: 'DELIVERY_UNCERTAIN' });
    discord.state.afterWrite = null;
    assert.equal((await metadata('sessions'))[0].state.status, 'role_pending');
    await makeDue(); await drain();
    assert.equal((await metadata('sessions'))[0].state.status, 'complete');
    assert.equal(writes().length, 1);
  });

  await scenario('D06 a role arriving after cancellation and initial compensation triggers another durable inspection', async () => {
    await pending();
    discord.state.before = call => call.method === 'PUT' ? new Response(null, { status: 503 }) : null;
    assert.equal((await dispatcher.runOnce('worker')).status, 'retry_scheduled');
    discord.state.before = null;
    await mute(); await makeDue(); await drain();
    assert.equal((await metadata('outbox')).find(row => row.kind === 'whitelist.grant').status, 'cancelled');
    // A delayed Discord effect arrives after the earlier reconciliation saw no role.
    discord.state.members.get(USER).push(WHITELIST);
    await store.recordObservation(await discord.roles.observe(USER));
    await drain();
    assert.equal(discord.state.members.get(USER).includes(WHITELIST), false);
    assert.equal((await metadata('sessions'))[0].state.status, 'role_pending');
  });

  await scenario('D07 old compensation preserves a newer currently valid completion', async () => {
    const old = await pending();
    const claim = (await outbox.claim('first', 30_000, ['whitelist.grant'])).claim;
    await store.inspectGrant({ claim, observation: observation() });
    await mute();
    await store.confirmUnmuted({ actor: moderator, interactionId: nextId(), observation: observation() });
    await store.inspectGrant({ claim, observation: observation() });
    await store.transition({ actor: {}, action: 'retry', interactionId: nextId(), sessionId: old.id, command: command(old), observation: observation() });
    await drain();
    assert.equal((await metadata('sessions'))[0].state.status, 'complete');
    await store.noteUncertainGrant(claim);
    await drain();
    assert.equal(discord.state.members.get(USER).includes(WHITELIST), true);
    assert.deepEqual(writes().map(call => call.method), ['PUT']);
  });

  await scenario('D08 hierarchy failures park the grant and make no role changes', async () => {
    await pending();
    discord.state.roles.find(role => role.id === WHITELIST).position = 10;
    assert.deepEqual(await dispatcher.runOnce('worker'), { status: 'operator_required', code: 'ROLE_HIERARCHY_BLOCKED' });
    assert.equal(writes().length, 0);
    assert.equal((await metadata('outbox')).find(row => row.kind === 'whitelist.grant').status, 'parked');
  });

  await scenario('D09 the role dispatcher never claims or consumes case provisioning jobs', async () => {
    await store.reserveCase({ actor: {}, interactionId: nextId(), id: 'unhandled-case', type: 'admin-help', observation: observation(),
      limits: { memberOpen: 1, guildPending: 1, cooldownMs: 1_000 } });
    assert.deepEqual(await dispatcher.runOnce('worker'), { status: 'idle' });
    assert.equal((await metadata('outbox'))[0].attempts, 0);
    assert.equal(discord.state.calls.length, 0);
  });

  await scenario('D10 Discord Retry-After survives in the durable retry schedule', async () => {
    await pending();
    discord.state.before = () => new Response(JSON.stringify({ retry_after: 1336.57, global: true }), { status: 429, headers: { 'Retry-After': '1337' } });
    assert.deepEqual(await dispatcher.runOnce('worker'), { status: 'retry_scheduled', code: 'RATE_LIMITED' });
    const delay = (await admin.query("SELECT extract(epoch FROM (available_at - clock_timestamp())) AS seconds FROM sophie_core.outbox WHERE kind = 'whitelist.grant'")).rows[0].seconds;
    assert.ok(Number(delay) > 1336 && Number(delay) <= 1337);
    assert.equal(writes().length, 0);
    const restartedOutbox = createOutbox({ pool });
    assert.equal(await restartedOutbox.claim('another-process'), null);
    assert.equal((await metadata('discord_backoff'))[0].paused, false);
  });

  await scenario('D11 a withdrawn definition cannot dispatch a previously queued grant', async () => {
    await pending();
    await store.withdrawDefinition({ actor: {}, id: definition.id, version: definition.version });
    assert.deepEqual(await dispatcher.runOnce('worker'), { status: 'settled', code: 'DEFINITION_WITHDRAWN' });
    assert.equal(writes().length, 0);
  });

  await scenario('D12 an unreadable rate limit parks the job and durably pauses all Discord delivery', async () => {
    await pending();
    discord.state.before = () => new Response('unparseable', { status: 429 });
    assert.deepEqual(await dispatcher.runOnce('worker'), { status: 'operator_required', code: 'DISCORD_RATE_LIMIT_INVALID' });
    assert.equal((await metadata('discord_backoff'))[0].paused, true);
    const restartedOutbox = createOutbox({ pool });
    assert.equal(await restartedOutbox.claim('another-process'), null);
  });

  await scenario('D13 a pause committed after the claim prevents the already-claimed role mutation', async () => {
    await pending();
    discord.state.before = async call => {
      if (call.path.endsWith(`/members/${USER}`)) await admin.query('UPDATE sophie_core.discord_backoff SET paused = true WHERE singleton');
    };
    assert.deepEqual(await dispatcher.runOnce('worker'), { status: 'retry_scheduled', code: 'DISCORD_UNAVAILABLE' });
    assert.equal(writes().length, 0);
    assert.equal((await metadata('sessions'))[0].state.status, 'role_pending');
  });

  await scenario('D14 a rate limit received after lease expiry still pauses other workers', async () => {
    await pending();
    discord.state.before = async () => {
      await admin.query("UPDATE sophie_core.outbox SET lease_until = clock_timestamp() - interval '1 second' WHERE status = 'leased'");
      return new Response(JSON.stringify({ retry_after: 60, global: true }), { status: 429 });
    };
    assert.deepEqual(await dispatcher.runOnce('worker'), { status: 'lease_lost' });
    assert.equal(await createOutbox({ pool }).claim('replacement'), null);
    const delay = (await admin.query('SELECT extract(epoch FROM (until_at - clock_timestamp())) AS seconds FROM sophie_core.discord_backoff')).rows[0].seconds;
    assert.ok(Number(delay) > 59);
    assert.equal(writes().length, 0);
  });
}
