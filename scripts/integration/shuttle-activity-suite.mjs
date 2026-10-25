import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { ContractError } from '../../contracts/validation.js';
import { createCoreStore } from '../../apps/core/storage/core-store.js';
import { createOutbox } from '../../apps/core/storage/outbox.js';
import { createActorAuthorityStore } from '../../apps/core/storage/actor-authority.js';
import { createShuttleActivityStore } from '../../apps/core/storage/shuttle-activity.js';
import { createActivityLayoutStore } from '../../apps/core/storage/activity-layout.js';
import { loadActivityContent } from '../../apps/activity/content.js';
import { createCoreAuthorization } from '../../apps/core/security/authorization.js';
import { createCorePrincipals } from '../../apps/core/security/principals.js';
import { createActivityAuth } from '../../apps/core/security/activity-auth.js';
import { createOnboardingCommands } from '../../apps/core/discord/onboarding-commands.js';
import { createRoleDispatcher, createWhitelistGrantDispatcher } from '../../apps/core/discord/dispatcher.js';
import { createWhitelistNoticeDispatcher } from '../../apps/core/discord/whitelist-notices.js';
import { readRunTiming, readShuttleProgress } from '../../apps/core/storage/shuttle-timing.js';
import { formatDuration } from '../../modules/onboarding/timing.js';
import { simulatedCases, casePolicy } from '../../tests/fixtures/cases.js';
import { CREW, BYOND_ROLE, WHITELIST, MUZZLED } from '../../tests/fixtures/discord.js';
import { syntheticInteractions, APPLICATION } from '../../tests/fixtures/interactions.js';
import { GUILD, USER, OTHER, STAFF, LEAD, NOW, definition, publication } from '../../tests/fixtures/domain.js';
import { resetCoreState } from '../../tests/fixtures/reset.js';

const OWNER = '100000000000000099', INSTANCE = 'i-1700000000000000000-gc-100000000000000001-100000000000000012';

/** Shuttle Activity runs (P41) on the real store, authorization and grant dispatcher. Synthetic metadata only. */
export async function runShuttleActivitySuite(cluster, run) {
  const pool = cluster.corePool, admin = cluster.adminPool, outbox = createOutbox({ pool });
  const limits = { memberOpen: 2, guildPending: 3, cooldownMs: 1_000 };
  const policy = { guildId: GUILD, version: 1, staff: STAFF, leadOps: LEAD, muzzled: MUZZLED,
    grants: { 'member.mute': [LEAD], 'member.unmute': [LEAD], 'shuttle.publish': [LEAD], 'case.registry': [LEAD] } };
  let now, discord, identities, authorization, activityAuth, core, activity, grants, healthy, request = 0;
  let sequence = 840000000000000000n;
  const nextId = () => String(++sequence);
  const requestId = () => (++request).toString(16).padStart(32, '0');
  const rows = async table => (await admin.query(`SELECT * FROM sophie_core.${table}`)).rows;
  const interactionActor = async userId => authorization.resolveActor(identities.verifier.verify(identities.signed(identities.payload({ id: nextId(),
    member: { user: { id: userId } }, data: { type: 1, name: 'whitelist', options: [{ type: 1, name: 'start' }] } }))));
  /** Signs in through the Activity adapter, as the HTTP route does, and returns a request's member context. */
  async function member(userId = USER) {
    const { token } = await activityAuth.signIn({ code: `code-${userId}`, instanceId: INSTANCE });
    const proof = await activityAuth.authenticate(token);
    return { actor: await authorization.resolveActor(proof), observe: () => discord.roles.observe(userId, { reuse: true }) };
  }
  async function drainGrants() {
    for (let i = 0; i < 20; i++) {
      const result = await grants.runOnce('activity-grants');
      if (result.status === 'idle') return;
      assert.ok(['settled', 'progressed'].includes(result.status), `grant worker: ${result.status}/${result.code}`);
    }
    assert.fail('Synthetic grant queue did not drain');
  }
  const scenario = (name, work, status = 'testing', testerGrants = {}) => run(name, async () => {
    await admin.query("UPDATE sophie_core.discord_backoff SET until_at = '-infinity', paused = false");
    await resetCoreState(admin);
    now = NOW; healthy = true;
    discord = simulatedCases({ clock: () => now }); discord.state.members.set(OTHER, [LEAD]);
    discord.state.members.set(OWNER, [CREW, BYOND_ROLE]);
    identities = syntheticInteractions({ clock: () => now });
    const identitiesByCode = new Map();
    activityAuth = createActivityAuth({ applicationId: APPLICATION, guildId: GUILD, clock: () => now, enabled: () => healthy, discord: discord.roles,
      oauth: { async exchangeActivity(code) { const proof = Object.freeze({}); identitiesByCode.set(proof, code.slice(5)); return { proof, accessToken: 'synthetic-access-token', expiresIn: 604800, scopes: ['identify'] }; },
        resolveIdentity: proof => ({ guildId: GUILD, userId: identitiesByCode.get(proof) }) },
      instances: async instanceId => ({ application_id: APPLICATION, instance_id: instanceId, location: { guild_id: GUILD, channel_id: '100000000000000013' },
        users: [USER, OTHER, OWNER] }) });
    const dashboard = { async resolvePrincipal() { throw new ContractError('UNTRUSTED_PRINCIPAL'); } };
    authorization = createCoreAuthorization({ principals: createCorePrincipals({ interactions: identities.verifier, dashboard, activity: activityAuth }),
      discord: discord.roles, authorityStore: createActorAuthorityStore({ pool, clock: () => now }), policy: { ...policy, grants: { ...policy.grants, ...testerGrants } }, clock: () => now,
      isAuthorityCurrent: () => healthy, readContinuity: discord.roles.readContinuity });
    core = createCoreStore({ pool, clock: () => now, authorize: authorization.authorize, authorizeRecorded: authorization.authorizeRecorded,
      casePolicy, caseVerification: discord.channels.verification });
    await core.publishOnboarding({ actor: await interactionActor(OTHER), publication });
    activity = createShuttleActivityStore({ pool, clock: () => now, authorize: authorization.authorize, definitionId: definition.id, status });
    grants = createRoleDispatcher({ outbox, store: core, discord: discord.roles, enabled: () => healthy });
    await work();
  });

  await scenario('SA01 while testing, only the server owner and lead ops role holders pass the closed screen', async () => {
    assert.deepEqual(await activity.describe(await member(USER)), { state: 'closed' });
    await assert.rejects(activity.board({ ...await member(USER), requestId: requestId() }), error => error.code === 'ACTIVITY_CLOSED');
    for (const userId of [OTHER, OWNER]) {
      const seen = await activity.describe(await member(userId));
      assert.equal(seen.state, 'ready'); assert.equal(seen.mode, 'qualification'); assert.equal(seen.whitelist, 'none');
      assert.deepEqual(seen.stops.map(stop => stop.scene), ['departure-lounge', 'baggage-hall', 'boarding-cabin', 'viewport', 'pressure-door']);
    }
    // Staff alone does not pass unless the policy grants the tester gate to it (SA13).
    discord.state.members.set(USER, [...discord.state.members.get(USER), STAFF]);
    assert.deepEqual(await activity.describe(await member(USER)), { state: 'closed' });
    // The gate follows the current role: a removed lead ops role closes it again on the next request.
    discord.state.members.set(OTHER, [CREW]);
    assert.deepEqual(await activity.describe(await member(OTHER)), { state: 'closed' });
    assert.equal((await rows('sessions')).length, 0);
  });

  await scenario('SA02 boarding records one run with no channel, case or screen; repeats resume it', async () => {
    const id = requestId();
    const first = await activity.board({ ...await member(OTHER), requestId: id });
    assert.equal(first.run.stop, 0); assert.equal(first.run.status, 'reading'); assert.equal(first.run.whitelist, 'none');
    assert.deepEqual(first.run.pages, [publication.stages[0].body]);
    const again = await activity.board({ ...await member(OTHER), requestId: id });
    assert.equal(again.duplicate, true);
    const resumed = await activity.board({ ...await member(OTHER), requestId: requestId() });
    assert.equal(resumed.resumed, true);
    assert.equal((await rows('sessions')).length, 1); assert.equal((await rows('shuttle_activity_runs')).length, 1);
    for (const table of ['shuttle_cases', 'case_reservations', 'shuttle_screens']) assert.equal((await rows(table)).length, 0, table);
    assert.equal((await rows('outbox')).length, 0);
    assert.equal((await activity.describe(await member(OTHER))).state, 'run');
  });

  await scenario('SA03 Continue and Back move one stop at a time; an old version or a replay changes nothing', async () => {
    let { run: shown } = await activity.board({ ...await member(OTHER), requestId: requestId() });
    const id = requestId();
    ({ run: shown } = await activity.act({ ...await member(OTHER), requestId: id, action: 'advance', expectedVersion: shown.version }));
    assert.equal(shown.stop, 1);
    const replay = await activity.act({ ...await member(OTHER), requestId: id, action: 'advance', expectedVersion: 0 });
    assert.equal(replay.duplicate, true); assert.equal(replay.run.stop, 1);
    await assert.rejects(activity.act({ ...await member(OTHER), requestId: requestId(), action: 'advance', expectedVersion: 0 }), error => error.code === 'STALE_SHUTTLE_CONTROL');
    ({ run: shown } = await activity.act({ ...await member(OTHER), requestId: requestId(), action: 'back', expectedVersion: shown.version }));
    assert.equal(shown.stop, 0);
    await assert.rejects(activity.act({ ...await member(OTHER), requestId: requestId(), action: 'back', expectedVersion: shown.version }), error => error.code === 'BACK_UNAVAILABLE');
    await assert.rejects(activity.act({ ...await member(OTHER), requestId: requestId(), action: 'retry', expectedVersion: shown.version }), error => error.code === 'NO_PENDING_GRANT');
  });

  await scenario('SA04 the last Continue requests Whitelist; the Activity shows it confirmed only after Discord does', async () => {
    let { run: shown } = await activity.board({ ...await member(OWNER), requestId: requestId() });
    for (let stop = 0; stop < publication.stages.length; stop++) {
      const result = await activity.act({ ...await member(OWNER), requestId: requestId(), action: 'advance', expectedVersion: shown.version });
      shown = result.run;
      assert.equal(result.queued, stop === publication.stages.length - 1);
    }
    assert.equal(shown.status, 'pending'); assert.equal(shown.whitelist, 'requested');
    assert.equal((await rows('outbox')).filter(row => row.kind === 'whitelist.grant').length, 1);
    assert.equal(discord.state.members.get(OWNER).includes(WHITELIST), false);
    assert.equal((await activity.describe(await member(OWNER))).run.whitelist, 'requested');
    // Reset journey never sets aside a run whose Whitelist grant is under way.
    await assert.rejects(activity.reset({ ...await member(OWNER), requestId: requestId() }), error => error.code === 'SHUTTLE_RESET_PENDING');
    await drainGrants();
    // A finished run has nothing to reset (it offers riding again instead).
    assert.equal((await activity.reset({ ...await member(OWNER), requestId: requestId() })).reset, false);
    assert.equal(discord.state.members.get(OWNER).includes(WHITELIST), true);
    const seen = await activity.describe(await member(OWNER));
    assert.equal(seen.state, 'run'); assert.equal(seen.run.status, 'boarded'); assert.equal(seen.run.whitelist, 'confirmed');
    // Without the role on Discord the finished run is not shown as boarded; a new run can start.
    discord.state.members.set(OWNER, [CREW, BYOND_ROLE]);
    assert.equal((await activity.describe(await member(OWNER))).state, 'ready');
  });

  await scenario('SA05 a run that belongs to a channel stays there', async () => {
    const commands = createOnboardingCommands({ authorization, discord: discord.roles, channels: discord.channels, store: core,
      enabled: () => healthy, definitionId: definition.id, limits });
    const proof = identities.verifier.verify(identities.signed(identities.payload({ id: nextId(), member: { user: { id: OTHER } },
      data: { type: 1, name: 'whitelist', options: [{ type: 1, name: 'start' }] } })));
    assert.equal(await commands.execute(proof), 'shuttle_recorded');
    assert.deepEqual(await activity.describe(await member(OTHER)), { state: 'elsewhere' });
    await assert.rejects(activity.board({ ...await member(OTHER), requestId: requestId() }), error => error.code === 'SHUTTLE_ELSEWHERE');
    assert.equal((await rows('shuttle_activity_runs')).length, 0);
  });

  await scenario('SA06 Muzzled testers cannot board or move', async () => {
    const { run: shown } = await activity.board({ ...await member(OTHER), requestId: requestId() });
    discord.state.members.set(OTHER, [LEAD, MUZZLED]);
    assert.deepEqual(await activity.describe(await member(OTHER)), { state: 'unavailable' });
    await assert.rejects(activity.act({ ...await member(OTHER), requestId: requestId(), action: 'advance', expectedVersion: shown.version }), error => error.code === 'OPERATION_DENIED');
    assert.equal((await rows('sessions'))[0].state.stepIndex, 0);
  });

  await scenario('SA07 once open, every eligible member can board', async () => {
    const seen = await activity.describe(await member(USER));
    assert.equal(seen.state, 'ready');
    const { run: shown } = await activity.board({ ...await member(USER), requestId: requestId() });
    assert.equal(shown.mode, 'qualification');
    assert.equal((await rows('shuttle_activity_runs'))[0].user_id, USER);
  }, 'open');

  await scenario('SA08 a run from an earlier membership never continues; boarding starts a fresh one', async () => {
    const { run: first } = await activity.board({ ...await member(OTHER), requestId: requestId() });
    await activity.act({ ...await member(OTHER), requestId: requestId(), action: 'advance', expectedVersion: first.version });
    await admin.query(`UPDATE sophie_core.sessions SET state = jsonb_set(state, '{eligibilityEpoch}', to_jsonb((state->>'eligibilityEpoch')::bigint - 1))`);
    assert.equal((await activity.describe(await member(OTHER))).state, 'ready');
    const { run: fresh } = await activity.board({ ...await member(OTHER), requestId: requestId() });
    assert.equal(fresh.stop, 0);
    const sessions = await rows('sessions');
    assert.equal(sessions.length, 2); assert.equal(sessions.filter(row => row.current).length, 1);
  });

  await scenario('SA11 a story update disposes of progress: an outdated run never continues and boarding starts the new version', async () => {
    // Owner decision, 24 October 2026: nobody comes back to finish an outdated story.
    const { run: first } = await activity.board({ ...await member(OTHER), requestId: requestId() });
    const { run: moved } = await activity.act({ ...await member(OTHER), requestId: requestId(), action: 'advance', expectedVersion: first.version });
    assert.equal(moved.stop, 1);
    await core.publishOnboarding({ actor: await interactionActor(OTHER), publication: { ...publication, version: 2 } });
    assert.equal((await activity.describe(await member(OTHER))).state, 'ready', 'the old run is not offered');
    await assert.rejects(activity.act({ ...await member(OTHER), requestId: requestId(), action: 'advance', expectedVersion: moved.version }),
      error => error.code === 'SHUTTLE_RESTART_REQUIRED');
    const { run: fresh, resumed } = await activity.board({ ...await member(OTHER), requestId: requestId() });
    assert.equal(resumed, false); assert.equal(fresh.stop, 0);
    const sessions = await rows('sessions');
    assert.equal(sessions.length, 2); assert.deepEqual(sessions.filter(row => row.current).map(row => row.state.definitionVersion), [2]);
  });

  await scenario('SA12 Reset journey sets aside the run being read, once; nothing else is reset', async () => {
    assert.deepEqual(await activity.reset({ ...await member(OTHER), requestId: requestId() }), { duplicate: false, reset: false }, 'no run: nothing to reset');
    const { run: first } = await activity.board({ ...await member(OTHER), requestId: requestId() });
    await activity.act({ ...await member(OTHER), requestId: requestId(), action: 'advance', expectedVersion: first.version });
    const id = requestId();
    assert.deepEqual(await activity.reset({ ...await member(OTHER), requestId: id }), { duplicate: false, reset: true });
    assert.deepEqual(await activity.reset({ ...await member(OTHER), requestId: id }), { duplicate: true, reset: true }, 'a replay changes nothing');
    assert.equal((await activity.describe(await member(OTHER))).state, 'ready');
    const { run: fresh } = await activity.board({ ...await member(OTHER), requestId: requestId() });
    assert.equal(fresh.stop, 0);
    assert.equal((await rows('sessions')).length, 2, 'the reset run keeps its record');
    await assert.rejects(activity.reset({ ...await member(USER), requestId: requestId() }), error => error.code === 'ACTIVITY_CLOSED');
  });

  await scenario('SA13 a role the policy grants shuttle.activity.test passes the closed screen while testing, and only while it holds it', async () => {
    // Owner decision, 24 October 2026: Staff test the Activity too.
    assert.deepEqual(await activity.describe(await member(USER)), { state: 'closed' });
    discord.state.members.set(USER, [...discord.state.members.get(USER), STAFF]);
    assert.equal((await activity.describe(await member(USER))).state, 'ready');
    const { run: first } = await activity.board({ ...await member(USER), requestId: requestId() });
    assert.equal(first.stop, 0);
    discord.state.members.set(USER, discord.state.members.get(USER).filter(id => id !== STAFF));
    assert.deepEqual(await activity.describe(await member(USER)), { state: 'closed' });
  }, 'testing', { 'shuttle.activity.test': [STAFF] });

  await scenario('SA09 the layout editor publishes numbered versions for guidance publishers; runs use the scenes, moments and curated list it names', async () => {
    const content = await loadActivityContent(fileURLToPath(new URL('../../', import.meta.url)));
    const [first, second] = publication.stages;
    const defaults = { schema: 1, stages: { [first.id]: { 'synthetic heading': { beat: 'adult' }, 'another heading': { beat: 'pride' } } } };
    const layouts = createActivityLayoutStore({ pool, authorize: authorization.authorize, guildId: GUILD, definitionId: definition.id, defaults,
      sceneBeats: content.sceneBeats, viewscreens: content.viewscreens });
    const editor = await interactionActor(OTHER), key = n => n.toString(16).padStart(64, '0');
    await assert.rejects(layouts.readActivityLayout({ actor: await interactionActor(USER) }), error => error.code === 'OPERATION_DENIED');
    const empty = await layouts.readActivityLayout({ actor: editor });
    assert.equal(empty.version, 0); assert.deepEqual(empty.document, { schema: 1, stops: {}, arrival: [] });
    assert.deepEqual(empty.stages.map(stage => stage.id), publication.stages.map(stage => stage.id));
    assert.equal(empty.stages[0].defaultScene, 'departure-lounge');
    assert.ok(empty.scenes.find(scene => scene.id === 'viewport').beats.includes('enjoy'));
    const document = { schema: 1, stops: { [first.id]: { scene: 'viewport', moments: { 'another heading': { beat: 'enjoy', viewscreen: 'ten-thousand' } } } },
      arrival: [{ channelId: '100000000000000301', note: 'Say hello' }] };
    await assert.rejects(layouts.publishActivityLayout({ actor: await interactionActor(USER), requestId: key(1), expectedVersion: 0, document }), error => error.code === 'OPERATION_DENIED');
    assert.deepEqual(await layouts.publishActivityLayout({ actor: editor, requestId: key(1), expectedVersion: 0, document }), { version: 1, sha256: (await rows('activity_layouts'))[0].sha256, duplicate: false });
    assert.equal((await layouts.publishActivityLayout({ actor: editor, requestId: key(1), expectedVersion: 0, document })).duplicate, true);
    await assert.rejects(layouts.publishActivityLayout({ actor: editor, requestId: key(1), expectedVersion: 0, document: { ...document, arrival: [] } }), error => error.code === 'ACTIVITY_LAYOUT_REQUEST_REUSED');
    await assert.rejects(layouts.publishActivityLayout({ actor: editor, requestId: key(2), expectedVersion: 0, document }), error => error.code === 'ACTIVITY_LAYOUT_CHANGED');
    await assert.rejects(layouts.publishActivityLayout({ actor: editor, requestId: key(3), expectedVersion: 1,
      document: { ...document, stops: { [first.id]: { scene: 'baggage-hall', moments: { x: { beat: 'enjoy' } } } } } }), error => error.code === 'ACTIVITY_LAYOUT_UNKNOWN_BEAT');
    await assert.rejects(layouts.publishActivityLayout({ actor: editor, requestId: key(4), expectedVersion: 1,
      document: { ...document, stops: { 'not-a-stage': { scene: 'viewport' } } } }), error => error.code === 'ACTIVITY_LAYOUT_UNKNOWN_STOP');
    await assert.rejects(layouts.publishActivityLayout({ actor: editor, requestId: key(5), expectedVersion: 1,
      document: { ...document, stops: { [second.id]: { moments: { x: { beat: 'adult', viewscreen: 'missing' } } } } } }), error => error.code === 'INVALID_MOMENT');
    const stored = await rows('activity_layouts');
    assert.equal(stored.length, 1); assert.equal(stored[0].operator_grant.userId, OTHER);
    assert.equal((await layouts.readActivityLayout({ actor: editor })).version, 1);

    // Runs show the published layout: the stop's scene and merged moments; the curated list stays beside the view.
    const shown = createShuttleActivityStore({ pool, clock: () => now, authorize: authorization.authorize, definitionId: definition.id, status: 'testing', defaults });
    assert.equal((await shown.describe(await member(OTHER))).stops[0].scene, 'viewport');
    const { run } = await shown.board({ ...await member(OTHER), requestId: requestId() });
    assert.equal(run.stops[0].scene, 'viewport'); assert.equal(run.stops[1].scene, 'baggage-hall');
    assert.deepEqual(run.moments, { 'synthetic heading': { beat: 'adult' }, 'another heading': { beat: 'enjoy', viewscreen: 'ten-thousand' } });
    assert.deepEqual(run.arrivalChannels, [{ channelId: '100000000000000301', note: 'Say hello' }]);
    assert.equal(JSON.stringify(run).includes('100000000000000301'), false);

    // A stored layout that no longer matches its digest is refused rather than shown.
    await admin.query(`UPDATE sophie_core.activity_layouts SET document = jsonb_set(document, '{arrival}', '[]'::jsonb)`);
    await assert.rejects(shown.describe(await member(OTHER)), error => error.code === 'ACTIVITY_LAYOUT_CORRUPT');
  });

  await scenario('SA10 a section can stage its own scene: the layout takes it only with a beat that scene draws, and runs carry it', async () => {
    const content = await loadActivityContent(fileURLToPath(new URL('../../', import.meta.url)));
    const [first] = publication.stages;
    const defaults = { schema: 1, stages: { [first.id]: { 'synthetic heading': { beat: 'adult' } } } };
    const layouts = createActivityLayoutStore({ pool, authorize: authorization.authorize, guildId: GUILD, definitionId: definition.id, defaults,
      sceneBeats: content.sceneBeats, viewscreens: content.viewscreens });
    const editor = await interactionActor(OTHER), key = n => n.toString(16).padStart(64, '0');
    const publish = (n, moment) => layouts.publishActivityLayout({ actor: editor, requestId: key(n), expectedVersion: 0,
      document: { schema: 1, stops: { [first.id]: { moments: { 'another heading': moment } } }, arrival: [] } });
    // The first stop's own scene (the departure lounge) has no 'together' beat; the landing bay has, and no 'seat'.
    await assert.rejects(publish(1, { beat: 'together' }), error => error.code === 'ACTIVITY_LAYOUT_UNKNOWN_BEAT');
    await assert.rejects(publish(2, { beat: 'seat', scene: 'landing-bay' }), error => error.code === 'ACTIVITY_LAYOUT_UNKNOWN_BEAT');
    await assert.rejects(publish(3, { beat: 'together', scene: 'not-a-scene' }), error => error.code === 'INVALID_MOMENT');
    assert.equal((await publish(4, { beat: 'together', scene: 'landing-bay' })).version, 1);
    const shown = createShuttleActivityStore({ pool, clock: () => now, authorize: authorization.authorize, definitionId: definition.id, status: 'testing', defaults });
    const { run } = await shown.board({ ...await member(OTHER), requestId: requestId() });
    assert.deepEqual(run.moments['another heading'], { beat: 'together', scene: 'landing-bay' });
    assert.equal(run.stops[0].scene, 'departure-lounge', 'the stop keeps its scene; only that section changes');
  });

  await scenario('SA14 the member is observed after the capability checks, so slow checks cannot make the final Continue fail as stale', async () => {
    // Owner report, 24 October 2026: under load the checks' Discord reads used up the 5 s the observation may be old at
    // commit, on every try, and Whitelist was never queued. Here the check takes 6 s.
    const slow = createShuttleActivityStore({ pool, clock: () => now, definitionId: definition.id, status: 'open',
      authorize: async (...input) => { now += 6_000; return authorization.authorize(...input); } });
    let { run: shown } = await slow.board({ ...await member(USER), requestId: requestId() });
    while (shown.stop < shown.stops.length - 1) ({ run: shown } = await slow.act({ ...await member(USER), requestId: requestId(), action: 'advance', expectedVersion: shown.version }));
    // An observation made before the checks (the order before this fix) is stale by the time the transaction checks it.
    const early = await discord.roles.observe(USER), before = await member(USER);
    await assert.rejects(slow.act({ ...before, observe: async () => early, requestId: requestId(), action: 'advance', expectedVersion: shown.version }),
      error => error.code === 'MEMBERSHIP_STALE');
    const last = await slow.act({ ...await member(USER), requestId: requestId(), action: 'advance', expectedVersion: shown.version });
    assert.equal(last.run.status, 'pending'); assert.equal(last.queued, true);
    assert.deepEqual((await rows('outbox')).map(row => row.kind), ['whitelist.grant']);
    assert.equal((await rows('outbox')).some(row => row.kind === 'whitelist.notice'), false, 'no notice unless configured');
    // The observation must be of the member the actor names.
    await assert.rejects(slow.describe({ ...await member(USER), observe: () => discord.roles.observe(OTHER) }), error => error.code === 'MEMBER_MISMATCH');
  }, 'open');

  await scenario('SA16 one Continue stays within its budget of database round trips and Discord reads', async () => {
    // Activity audit, 24 October 2026: every authorization check re-registered the capability policy under a global lock.
    let queries = 0;
    const counted = client => new Proxy(client, { get(target, key) {
      if (key === 'query') return (...input) => { queries++; return target.query(...input); };
      const value = target[key]; return typeof value === 'function' ? value.bind(target) : value; } });
    const countedPool = { query: (...input) => { queries++; return pool.query(...input); }, connect: async () => counted(await pool.connect()) };
    const measured = createCoreAuthorization({ principals: createCorePrincipals({ interactions: identities.verifier, dashboard: { async resolvePrincipal() { throw new ContractError('UNTRUSTED_PRINCIPAL'); } }, activity: activityAuth }),
      discord: discord.roles, authorityStore: createActorAuthorityStore({ pool: countedPool, clock: () => now }), policy, clock: () => now,
      isAuthorityCurrent: () => healthy, readContinuity: discord.roles.readContinuity });
    const store = createShuttleActivityStore({ pool: countedPool, clock: () => now, authorize: measured.authorize, definitionId: definition.id, status: 'open' });
    const request = async () => {
      const { token } = await activityAuth.signIn({ code: `code-${USER}`, instanceId: INSTANCE });
      const proof = await activityAuth.authenticate(token);
      return { actor: await measured.resolveActor(proof), observe: () => discord.roles.observe(USER, { reuse: true }) };
    };
    let { run: shown } = await store.board({ ...await request(), requestId: requestId() });
    // Warm: the first check of a process registers the policy.
    ({ run: shown } = await store.act({ ...await request(), requestId: requestId(), action: 'advance', expectedVersion: shown.version }));
    // A whole request from cold (nothing to reuse): sign-in proof, actor, capability check, member observation, transaction.
    const { token } = await activityAuth.signIn({ code: `code-${USER}`, instanceId: INSTANCE });
    now += 1_501; queries = 0; const reads = discord.state.calls.length;
    const proof = await activityAuth.authenticate(token);
    await store.act({ actor: await measured.resolveActor(proof), observe: () => discord.roles.observe(USER, { reuse: true }), requestId: requestId(), action: 'advance', expectedVersion: shown.version });
    // Measured 24 October 2026: the actor, then its capability check and member observation reusing that one observation
    // (owner decision replacing 12 October) and the policy registered once per process: 24 round trips and 4 Discord reads
    // (bot identity, guild, roles, member) for the whole request, where each step had read Discord and recorded again. One
    // more since 25 October 2026: the focused reading time, recorded with the move in a single statement.
    assert.ok(queries <= 25, `database round trips: ${queries}`);
    assert.ok(discord.state.calls.length - reads <= 4, `Discord reads: ${discord.state.calls.length - reads}`);
    // The policy is still checked: once the observation is made again, a newer recorded version refuses this process.
    await admin.query(`INSERT INTO sophie_core.capability_policies (guild_id, version, policy) VALUES ($1, $2, $3)`, [GUILD, policy.version + 1, { ...policy, version: policy.version + 1 }]);
    now += 1_501;
    await assert.rejects((async () => store.act({ ...await request(), requestId: requestId(), action: 'back', expectedVersion: shown.version + 1 }))(), error => error.code === 'CAPABILITY_POLICY_ROLLBACK');
  }, 'open');

  await scenario('SA17 in production an uncertain Whitelist add leaves no reconciliation job; its next attempt confirms it', async () => {
    // Owner's production install, 24 October 2026: the read confirming an add failed (overtaken by the member's own update),
    // and a whitelist.reconcile job was queued that nothing in production runs.
    const uncertainAdd = async (store, userId) => {
      let { run: shown } = await activity.board({ ...await member(userId), requestId: requestId() });
      while (shown.status === 'reading') ({ run: shown } = await activity.act({ ...await member(userId), requestId: requestId(), action: 'advance', expectedVersion: shown.version }));
      let added = false;
      discord.state.afterWrite = async () => { added = true; };
      discord.state.before = call => added && call.method === 'GET' && call.path.endsWith(`/members/${userId}`) ? (added = false, new Response(null, { status: 503 })) : null;
      const dispatcher = createWhitelistGrantDispatcher({ outbox, store, discord: discord.roles, enabled: () => healthy });
      assert.equal((await dispatcher.runOnce('activity-grants')).status, 'retry_scheduled');
      discord.state.before = null; discord.state.afterWrite = null;
      await admin.query("UPDATE sophie_core.outbox SET available_at = clock_timestamp() WHERE kind = 'whitelist.grant'");
      assert.equal((await dispatcher.runOnce('activity-grants')).status, 'settled');
      return (await rows('outbox')).filter(row => row.user_id === userId).map(row => row.kind).sort();
    };
    const production = createCoreStore({ pool, clock: () => now, authorize: authorization.authorize, authorizeRecorded: authorization.authorizeRecorded,
      casePolicy, caseVerification: discord.channels.verification, whitelistReconciliation: false });
    assert.deepEqual(await uncertainAdd(production, USER), ['whitelist.grant']);
    assert.equal(discord.state.members.get(USER).includes(WHITELIST), true);
    assert.equal((await activity.describe(await member(USER))).run.whitelist, 'confirmed');
    // Where reconciliation runs (staging), the same uncertainty still queues it.
    assert.deepEqual(await uncertainAdd(core, OWNER), ['whitelist.grant', 'whitelist.reconcile']);
  }, 'open');

  await scenario('SA15 Sophie tells Staff once for each Whitelist she gives, never for one given by hand', async () => {
    // Owner request, 24 October 2026: a line in the staff bot channel when the Onboarding Activity gives Whitelist.
    const announcing = createCoreStore({ pool, clock: () => now, authorize: authorization.authorize, authorizeRecorded: authorization.authorizeRecorded,
      casePolicy, caseVerification: discord.channels.verification, whitelistNotices: true });
    const granting = createRoleDispatcher({ outbox, store: announcing, discord: discord.roles, enabled: () => healthy });
    const posts = [], CHANNEL = '100000000000000555';
    let failNext = false;
    const notices = createWhitelistNoticeDispatcher({ outbox, channelId: CHANNEL, enabled: () => healthy, transport: { guildId: GUILD,
      async createWhitelistNotice(...input) { posts.push(input); if (failNext) { failNext = false; throw Object.assign(new Error('timeout'), { code: 'DISCORD_UNAVAILABLE' }); } } } });
    // Each stop read for 40 s, 30 s of it focused, over two pages (owner request, 25 October 2026).
    const ride = async userId => {
      let { run: shown } = await activity.board({ ...await member(userId), requestId: requestId() });
      while (shown.status === 'reading') {
        now += 40_000;
        ({ run: shown } = await activity.act({ ...await member(userId), requestId: requestId(), action: 'advance', expectedVersion: shown.version, attention: { ms: 30_000, pages: 2 } }));
      }
    };
    const drain = async dispatcher => { for (let i = 0; i < 20; i++) if ((await dispatcher.runOnce('activity-notices')).status === 'idle') return; assert.fail('queue did not drain'); };
    await ride(USER); await drain(granting);
    assert.equal(discord.state.members.get(USER).includes(WHITELIST), true);
    const queued = (await rows('outbox')).filter(row => row.kind === 'whitelist.notice');
    assert.equal(queued.length, 1); assert.equal(queued[0].user_id, USER);
    // An uncertain send is tried again as the same post (the nonce comes from the job), and the job ends done.
    failNext = true;
    assert.equal((await notices.runOnce('activity-notices')).status, 'retry_scheduled');
    await admin.query("UPDATE sophie_core.outbox SET available_at = clock_timestamp() WHERE kind = 'whitelist.notice'");
    await drain(notices);
    assert.equal(posts.length, 2); assert.deepEqual(posts[0], posts[1]);
    const [channelId, nonce, body] = posts[0];
    assert.equal(channelId, CHANNEL); assert.match(nonce, /^[a-f0-9]{24}$/u);
    const stops = publication.stages.length;
    assert.equal(body.content, `**Whitelist granted** · <@${USER}> finished the Arrivals Shuttle and Sophie gave them Whitelist.
` +
      `Time to completion: ${formatDuration(stops * 30_000)} focused (${formatDuration(stops * 40_000)} from boarding) · ${stops * 2} pages, average 15s a page`);
    assert.deepEqual(body.allowed_mentions, { parse: [], users: [], roles: [], replied_user: false }, 'nobody is notified');
    assert.deepEqual((await rows('outbox')).filter(row => row.kind === 'whitelist.notice').map(row => row.status), ['done']);
    // A member given the role by hand before Sophie's grant ran: the run completes, and no notice is queued.
    await ride(OWNER);
    discord.state.members.set(OWNER, [...discord.state.members.get(OWNER), WHITELIST]);
    await drain(granting);
    assert.equal((await activity.describe(await member(OWNER))).run.whitelist, 'confirmed');
    assert.equal((await rows('outbox')).filter(row => row.kind === 'whitelist.notice').length, 1);
  }, 'open');

  await scenario('SA18 focused time is credited to the stop left, never more than the time that passed, and once per request', async () => {
    // Owner request, 25 October 2026: time to completion and the average time a page, counting only focused time.
    let { run: shown } = await activity.board({ ...await member(OTHER), requestId: requestId() });
    const session = (await rows('shuttle_activity_runs'))[0].session_id, started = now;
    const timing = () => readRunTiming(pool, session);
    assert.deepEqual(await timing(), { startedAtMs: started, lastActiveAtMs: started, completedAtMs: null, focusedMs: 0, pages: 0, stops: [], timed: false, fromStop: null });
    // A claim of more than really passed is cut to what passed.
    now += 10_000; const id = requestId();
    ({ run: shown } = await activity.act({ ...await member(OTHER), requestId: id, action: 'advance', expectedVersion: shown.version, attention: { ms: 999_999, pages: 3 } }));
    assert.deepEqual((await timing()).stops, [{ stop: 0, focusedMs: 10_000, pages: 3 }]);
    // A replayed request credits nothing.
    now += 5_000;
    assert.equal((await activity.act({ ...await member(OTHER), requestId: id, action: 'advance', expectedVersion: 0, attention: { ms: 4_000, pages: 3 } })).duplicate, true);
    assert.equal((await timing()).focusedMs, 10_000);
    // Back credits the stop it leaves; a page count keeps its largest report.
    ({ run: shown } = await activity.act({ ...await member(OTHER), requestId: requestId(), action: 'back', expectedVersion: shown.version, attention: { ms: 3_000, pages: 2 } }));
    now += 2_000;
    ({ run: shown } = await activity.act({ ...await member(OTHER), requestId: requestId(), action: 'advance', expectedVersion: shown.version, attention: { ms: 1_500, pages: 1 } }));
    assert.deepEqual((await timing()).stops, [{ stop: 0, focusedMs: 11_500, pages: 3 }, { stop: 1, focusedMs: 3_000, pages: 2 }]);
    // A client from before timing sends none: nothing is credited, and the run's clock still moves on.
    now += 1_000;
    ({ run: shown } = await activity.act({ ...await member(OTHER), requestId: requestId(), action: 'advance', expectedVersion: shown.version }));
    assert.equal((await timing()).focusedMs, 14_500); assert.equal((await timing()).lastActiveAtMs, now);
    while (shown.status === 'reading') {
      now += 1_000;
      ({ run: shown } = await activity.act({ ...await member(OTHER), requestId: requestId(), action: 'advance', expectedVersion: shown.version, attention: { ms: 1_000, pages: 1 } }));
    }
    const finished = await timing();
    assert.equal(finished.completedAtMs, now); assert.equal(finished.timed, true); assert.equal(finished.fromStop, 0);
    // Check while waiting for Whitelist credits no stop and keeps the completion time.
    now += 200_000; await drainGrants();
    assert.equal((await timing()).completedAtMs, finished.completedAtMs);
  }, 'open');

  await scenario('SA19 Staff progress reads where a member is, their timing and their grant, without changing anything', async () => {
    // Owner request, 25 October 2026: a command Staff can run to check a member's current Shuttle progress.
    assert.deepEqual(await readShuttleProgress(pool, GUILD, OTHER), { run: null, grant: null });
    let { run: shown } = await activity.board({ ...await member(OTHER), requestId: requestId() });
    now += 20_000;
    ({ run: shown } = await activity.act({ ...await member(OTHER), requestId: requestId(), action: 'advance', expectedVersion: shown.version, attention: { ms: 15_000, pages: 2 } }));
    const before = JSON.stringify(await rows('sessions'));
    const reading = await readShuttleProgress(pool, GUILD, OTHER);
    assert.equal(JSON.stringify(await rows('sessions')), before, 'reads only');
    assert.deepEqual({ ...reading.run, timing: null }, { current: true, activity: true, status: 'active', helpPaused: false, stop: 1,
      stops: publication.stages.length, title: publication.stages[1].title, definitionVersion: publication.version, timing: null });
    assert.equal(reading.run.timing.focusedMs, 15_000); assert.equal(reading.grant, null);
    while (shown.status === 'reading') ({ run: shown } = await activity.act({ ...await member(OTHER), requestId: requestId(), action: 'advance', expectedVersion: shown.version }));
    const pending = await readShuttleProgress(pool, GUILD, OTHER);
    assert.equal(pending.run.status, 'role_pending'); assert.deepEqual(pending.grant, { status: 'ready', code: null });
    await drainGrants();
    const done = await readShuttleProgress(pool, GUILD, OTHER);
    assert.equal(done.run.status, 'complete'); assert.equal(done.grant.status, 'done'); assert.notEqual(done.run.timing.completedAtMs, null);
  }, 'open');
}
