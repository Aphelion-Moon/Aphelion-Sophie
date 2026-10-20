import assert from 'node:assert/strict';
import { createCoreStore } from '../../apps/core/storage/core-store.js';
import { createOutbox } from '../../apps/core/storage/outbox.js';
import { createMembershipDispatcher } from '../../apps/core/discord/dispatcher.js';
import { createModerationRecoveryHttp } from '../../apps/core/http/moderation-recovery.js';
import { GUILD, USER, NOW, moderator, observation } from '../../tests/fixtures/domain.js';
import { simulatedDiscord, CREW, MUZZLED, WHITELIST, BYOND_ROLE } from '../../tests/fixtures/discord.js';
import { resetCoreState } from '../../tests/fixtures/reset.js';

/** Actual database/outbox and fixed-route HTTP adapter, with synthetic role metadata. */
export async function runMemberDeliverySuite(cluster, run) {
  const pool = cluster.corePool;
  const admin = cluster.adminPool;
  let sequence = 600000000000000000n;
  const nextId = () => String(++sequence);
  let allowed, currentAllowed, operatorChecks, discord, store, outbox, dispatcher;
  const readMember = async () => (await admin.query('SELECT state FROM sophie_core.members WHERE guild_id = $1 AND user_id = $2', [GUILD, USER])).rows[0].state;
  const jobs = async () => (await admin.query('SELECT * FROM sophie_core.outbox ORDER BY created_at, operation_id')).rows;
  const writes = () => discord.state.calls.filter(call => call.method !== 'GET');
  const observed = () => discord.roles.observe(USER);
  const roles = () => discord.state.members.get(USER);
  const request = async muted => store[muted ? 'requestMute' : 'requestUnmute']({ actor: moderator, interactionId: nextId(), observation: await observed() });
  const review = () => observed().then(observation => store.reviewModeration({ actor: moderator, observation }));
  const retryInput = (page, job = page.jobs.find(row => row.status === 'parked')) => ({ operationId: job.operationId, expectedFence: job.fence,
    expectedActionRevision: page.actionRevision, expectedEligibilityEpoch: page.eligibilityEpoch });
  const retry = async (page, interactionId = nextId()) => store.retryModeration({ actor: moderator, observation: await observed(), interactionId, ...retryInput(page) });
  async function park() {
    const job = await outbox.claim('parked-worker', 30_000, ['member.reconcile']);
    await store.inspectMemberReconciliation({ claim: job.claim, observation: await observed() });
    await outbox.park(job.claim, 'BOT_PERMISSION_MISSING'); return job;
  }
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
    await resetCoreState(admin);
    allowed = true; currentAllowed = true; operatorChecks = 0;
    discord = simulatedDiscord();
    store = createCoreStore({ pool, clock: () => NOW, authorize: async () => currentAllowed,
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

  await scenario('M15 reviewed HTTP retry preserves uncertainty and records an exact idempotent receipt', async () => {
    await request(true); await park();
    const http = createModerationRecoveryHttp({ store, discord: discord.roles, enabled: () => true,
      auth: { authenticate: async () => ({ proof: {} }), resolvePrincipal: async () => moderator },
      authorization: { resolveActor: async () => moderator, authorize: async () => currentAllowed } });
    const page = await http.execute({ path: '/api/moderation/review', method: 'GET', query: new URLSearchParams({ userId: USER }), body: null, credentials: {} });
    assert.equal(page.jobs[0].retryAllowed, true); assert.equal(page.actorId, moderator.userId);
    const body = { userId: USER, ...retryInput(page), requestId: 'a'.repeat(64), confirmed: true };
    const send = () => http.execute({ path: '/api/moderation/retry', method: 'POST', query: new URLSearchParams(), body, credentials: {} });
    assert.deepEqual(await send(), { recorded: true, duplicate: false });
    let job = (await jobs())[0]; assert.equal(job.dispatch_started, true); assert.equal(job.status, 'ready');
    assert.equal(Number(job.fence), body.expectedFence + 1); assert.equal(Number(job.attempts), 0);
    assert.deepEqual(await send(), { recorded: true, duplicate: true });
    await drain(); assert.deepEqual(new Set(roles()), new Set([BYOND_ROLE, MUZZLED]));
    const count = writes().length; assert.deepEqual(await send(), { recorded: true, duplicate: true });
    assert.equal(writes().length, count); assert.equal((await jobs())[0].status, 'done');
    assert.equal(Number((await admin.query("SELECT count(*) FROM sophie_core.receipts WHERE interaction_id LIKE 'dashboard.%'")).rows[0].count), 1);
  });

  await scenario('M16 stale decision and job-fence reviews cannot reopen parked delivery', async () => {
    await request(true); await park(); const page = await review();
    await admin.query('UPDATE sophie_core.outbox SET fence=fence+1 WHERE operation_id=$1', [page.jobs[0].operationId]);
    await assert.rejects(retry(page), /MODERATION_REVIEW_STALE/);
    const fresh = await review(); await request(false);
    await assert.rejects(retry(fresh), /MODERATION_REVIEW_STALE/);
    assert.equal((await jobs()).find(job => job.operation_id === page.jobs[0].operationId).status, 'parked');
    assert.equal((await review()).jobs.some(job => job.operationId === page.jobs[0].operationId), false);
  });

  await scenario('M17 current and original moderator revocation both deny retry without changing the job', async () => {
    await request(true); await park(); const page = await review();
    currentAllowed = false; await assert.rejects(review(), /OPERATION_DENIED/); await assert.rejects(retry(page), /OPERATION_DENIED/);
    currentAllowed = true; allowed = false;
    assert.equal((await review()).hold, 'moderator_unavailable'); await assert.rejects(retry(page), /MODERATION_REVIEW_STALE/);
    assert.equal((await jobs())[0].status, 'parked'); assert.equal(writes().length, 0);
  });

  await scenario('M18 departure and rejoin require a fresh decision rather than a stale retry', async () => {
    await request(true); await park(); const page = await review();
    discord.state.members.delete(USER); await assert.rejects(retry(page), /MODERATION_REVIEW_STALE/);
    discord.state.members.set(USER, [BYOND_ROLE]); const fresh = await review();
    assert.equal(fresh.hold, 'decision_expired'); assert.ok(fresh.jobs.every(job => !job.retryAllowed));
    await assert.rejects(retry(page), /MODERATION_REVIEW_STALE/); assert.equal(writes().length, 0);
  });

  await scenario('M19 reviewed retry rejects unknown or quarantined failures and non-member jobs', async () => {
    await request(true); await park(); const page = await review();
    for (const code of [null, 'UNREVIEWED_FAILURE', 'RESTORE_QUARANTINED']) {
      await admin.query('UPDATE sophie_core.outbox SET last_error_code=$2 WHERE operation_id=$1', [page.jobs[0].operationId, code]);
      const current = await review(); assert.equal(current.jobs[0].reason, null); assert.equal(current.jobs[0].retryAllowed, false);
      await assert.rejects(retry(page), /MODERATION_REVIEW_STALE/);
      assert.equal((await jobs())[0].status, 'parked'); assert.equal(Number((await jobs())[0].fence), page.jobs[0].fence);
    }
    await admin.query("UPDATE sophie_core.outbox SET last_error_code='BOT_PERMISSION_MISSING' WHERE operation_id=$1", [page.jobs[0].operationId]);
    await admin.query(`UPDATE sophie_core.outbox SET kind='whitelist.reconcile', effect=jsonb_set(effect,'{kind}','"whitelist.reconcile"')
      WHERE operation_id=$1`, [page.jobs[0].operationId]);
    await assert.rejects(retry(page), /MODERATION_REVIEW_STALE/);
    assert.equal((await jobs())[0].status, 'parked'); assert.equal(writes().length, 0);
  });

  await scenario('M20 concurrent exact retries only reopen the job once and changed payloads collide', async () => {
    await request(true); await park(); const page = await review(), interactionId = nextId();
    const input = { actor: moderator, observation: await observed(), interactionId, ...retryInput(page) };
    const results = await Promise.all([store.retryModeration(input), store.retryModeration(input)]);
    assert.deepEqual(results.map(result => result.duplicate).sort(), [false, true]);
    assert.equal(Number((await jobs())[0].fence), page.jobs[0].fence + 1);
    await assert.rejects(store.retryModeration({ actor: moderator, observation: await observed(), interactionId,
      ...retryInput(page), expectedFence: page.jobs[0].fence + 1 }), /INTERACTION_ID_COLLISION/);
  });
}
