import { createCaseLifecycle } from '../../apps/core/discord/case-lifecycle.js';
import { createCaseStaff } from '../../apps/core/discord/case-staff.js';
import assert from 'node:assert/strict';
import { createCoreStore } from '../../apps/core/storage/core-store.js';
import { createOutbox } from '../../apps/core/storage/outbox.js';
import { createActorAuthorityStore } from '../../apps/core/storage/actor-authority.js';
import { createCoreAuthorization } from '../../apps/core/security/authorization.js';
import { createOnboardingCommands, createAdministrationCommands } from '../../apps/core/discord/onboarding-commands.js';
import { createOnboardingAssistance } from '../../apps/core/discord/onboarding-assistance.js';
import { createOnboardingDeliveryIssues } from '../../apps/core/discord/onboarding-delivery-issues.js';
import { createCaseDispatcher } from '../../apps/core/discord/case-dispatcher.js';
import { createOnboardingDispatcher } from '../../apps/core/discord/onboarding-dispatcher.js';
import { createOnboardingAlertDispatcher } from '../../apps/core/discord/onboarding-alert-dispatcher.js';
import { createOnboardingAlertMessages } from '../../apps/core/discord/onboarding-alert-messages.js';
import { createRoleDispatcher } from '../../apps/core/discord/dispatcher.js';
import { createDiscordTransport } from '../../apps/core/discord/transport.js';
import { createDiscordRoles } from '../../apps/core/discord/roles.js';
import { simulatedOnboarding } from './onboarding.js';
import { navigationMessage, seedOnboardingHelp, shuttleGroup } from './onboarding-group.js';
import { casePolicy } from './cases.js';
import { mapping, MUZZLED } from './discord.js';
import { syntheticInteractions } from './interactions.js';
import { GUILD, USER, OTHER, STAFF, LEAD, NOW, publication } from './domain.js';
import { resetTables, resetCoreState } from './reset.js';

/** Shared real-core test composition with synthetic remote state; never a live Discord connection. */
export async function onboardingWorkflow(cluster, { helpPauses = false, extraCapabilities = {} } = {}) {
  const pool = cluster.corePool, admin = cluster.adminPool, clock = { now: NOW, enabled: true };
  await resetTables(admin, 'sophie_control.configuration_members, sophie_control.runtime_configuration, sophie_control.configuration_applications, sophie_control.maintenance_policy_applications, sophie_control.runtime_gate, sophie_control.maintenance_seal_effects, sophie_control.maintenance_seal_plans, sophie_control.maintenance_inventories, sophie_control.maintenance_operations'); await admin.query('INSERT INTO sophie_control.runtime_gate (singleton) VALUES (true)');
  await resetTables(admin, 'sophie_core.system_wording, sophie_core.permission_applications');
  await admin.query("UPDATE sophie_core.discord_backoff SET until_at = '-infinity', paused = false");
  await resetCoreState(admin);
  const enabled = () => clock.enabled, time = () => clock.now;
  const discord = simulatedOnboarding({ clock: time, enabled, authorizeCaseParticipant: grant => authorization.authorizeCaseParticipant(grant) }); discord.state.members.set(OTHER, [LEAD]);
  const identities = syntheticInteractions({ clock: time }); let sequence = 860000000000000000n;
  const nextId = () => String(++sequence);
  const payload = (overrides = {}) => identities.payload({ id: nextId(), member: { user: { id: USER } },
    data: { type: 1, name: 'whitelist', options: [{ type: 1, name: 'start' }] }, ...overrides });
  const verified = value => identities.verifier.verify(identities.signed(value));
  const policy = { guildId: GUILD, version: 1, staff: STAFF, leadOps: LEAD, muzzled: MUZZLED,
    grants: { 'member.mute': [LEAD], 'member.unmute': [LEAD], 'shuttle.publish': [LEAD], 'case.registry': [LEAD], ...extraCapabilities } };
  const authorization = createCoreAuthorization({ principals: identities.verifier, discord: discord.roles,
    authorityStore: createActorAuthorityStore({ pool, clock: time }), policy, clock: time,
    isAuthorityCurrent: enabled, readContinuity: discord.roles.readContinuity });
  const actor = (userId = USER) => authorization.resolveActor(verified(payload({ member: { user: { id: userId } } })));
  // A separate HTTP client models worker effects overlapping signed user commands.
  // Both clients share only synthetic remote state, not an in-process busy flag.
  const workerTransport = createDiscordTransport({ guildId: GUILD,
    token: 'synthetic-test-token-not-a-secret', fetch: discord.fetch, clock: time, enabled });
  const workerRoles = createDiscordRoles({ transport: workerTransport, mapping, clock: time,
    readContinuity: discord.roles.readContinuity });
  discord.alerts = createOnboardingAlertMessages({ transport: workerTransport, roles: workerRoles,
    channels: discord.channels, mapping, policy: casePolicy, clock: time });
  const store = createCoreStore({ pool, clock: time, authorize: authorization.authorize,
    resolveCaseParticipant: authorization.resolveCaseParticipant, authorizeCaseParticipant: authorization.authorizeCaseParticipant,
    authorizeRecorded: authorization.authorizeRecorded, resolveCaseResponder: authorization.resolveCaseResponder, casePolicy, caseVerification: discord.channels.verification,
    onboardingMessageVerification: discord.messages.verification, onboardingAlertVerification: discord.alerts.verification });
  await store.publishOnboarding({ actor: await actor(OTHER), publication: { ...publication, helpPauses } });
  discord.state.members.set(OTHER, [STAFF]);
  const assistance = createOnboardingAssistance({ authorization, discord: discord.roles, store, enabled });
  const deliveryIssues = createOnboardingDeliveryIssues({ authorization, discord: discord.roles, channels: discord.channels, store, enabled,
    screenMessages: discord.messages, alertMessages: discord.alerts });
  const caseLifecycle = createCaseLifecycle({ authorization, discord: discord.roles, store, enabled, limits: { memberOpen: 2, guildPending: 3, cooldownMs: 1_000 } });
  const caseStaff = createCaseStaff({ authorization, store, guildId: GUILD, enabled });
  const commands = createAdministrationCommands({ assistance, deliveryIssues, caseLifecycle, caseStaff, onboarding: createOnboardingCommands({ authorization,
    discord: discord.roles, channels: discord.channels, store, enabled, definitionId: publication.id,
    limits: { memberOpen: 2, guildPending: 3, cooldownMs: 1_000 } }) });
  const outbox = createOutbox({ pool });
  const cases = createCaseDispatcher({ outbox, store, roles: discord.roles, channels: discord.channels, enabled });
  const screens = createOnboardingDispatcher({ outbox, store, roles: discord.roles, messages: discord.messages, enabled });
  const alerts = createOnboardingAlertDispatcher({ outbox, store, roles: workerRoles, messages: discord.alerts, enabled });
  const grants = createRoleDispatcher({ outbox, store, discord: workerRoles, enabled });
  const rows = async table => (await admin.query(`SELECT * FROM sophie_core.${table}`)).rows;
  // A screen row plus nav_message_id: its current navigation card, where Continue, Back and Check clicks land.
  const withNavigation = async screen => screen && { ...screen, nav_message_id: await navigationMessage(admin, screen) };
  const current = async () => withNavigation((await rows('shuttle_screens')).find(row => row.current));
  const session = async () => (await rows('sessions')).find(row => row.current)?.state;
  async function drain(worker) {
    for (let index = 0; index < 60; index++) {
      const result = await worker.runOnce('workflow-worker'); if (result.status === 'idle') return;
      assert.ok(['settled', 'progressed'].includes(result.status), `${result.status}/${result.code}`);
    }
    assert.fail('Synthetic workflow queue did not drain');
  }
  const execute = value => commands.execute(verified(value));
  const control = (screen, action, overrides = {}) => payload({ type: 3, channel_id: screen.channel_id,
    message: { id: screen.nav_message_id ?? screen.message_id }, data: { component_type: 2, custom_id: `sophie:shuttle:v1:${screen.id}:${action}:${screen.control_version}` }, ...overrides });
  const click = async action => execute(control(await current(), action));
  // Ask Staff is retired; this records a help request as it did, for the retained assistance, alert and pause paths.
  const help = async (userId = USER) => seedOnboardingHelp({ pool, clock: time, observation: await discord.roles.observe(userId),
    interactionId: nextId(), userId });
  const resolution = (request, overrides = {}) => payload({ type: 3, member: { user: { id: OTHER } }, message: { id: OTHER },
    data: { component_type: 2, custom_id: `sophie:shuttle-help:v1:resolve:${request.interaction_id}:${request.revision}` }, ...overrides });
  const resolve = request => execute(resolution(request));
  async function open() { assert.equal(await execute(payload()), 'shuttle_recorded'); await drain(cases); await drain(screens); return current(); }
  async function pending() {
    await open(); for (let index = 0; index < 5; index++) { assert.equal(await click('advance'), 'shuttle_progress_recorded'); await drain(screens); }
    return session();
  }
  return { pool, admin, clock, discord, identities, policy, authorization, actor, store, assistance, deliveryIssues, caseLifecycle, caseStaff, commands, outbox, cases, screens, grants, alerts,
    group: async screen => shuttleGroup(admin, discord.state, screen ?? await current()),
    rows, current, withNavigation, session, drain, nextId, payload, verified, execute, control, click, help, resolution, resolve, open, pending };
}
