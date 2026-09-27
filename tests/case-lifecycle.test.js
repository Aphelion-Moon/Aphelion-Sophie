import assert from 'node:assert/strict';
import test from 'node:test';
import { caseStatusReply, parseCaseReference, ticketCommandDefinition } from '../modules/tickets/lifecycle.js';
import { CASE_CLOSED_WRITE_BITS, caseChannelPayload } from '../modules/tickets/channel-policy.js';
import { cancelOnboardingGrantForClosure } from '../modules/onboarding/index.js';
import { createAdministrationCommands } from '../apps/core/discord/onboarding-commands.js';
import { channelPermissions, PERMISSIONS } from '../platform/authorization/discord-permissions.js';
import { casePlan, casePolicy, simulatedCases } from './fixtures/cases.js';
import { BOT_ROLE, CREW, roleList } from './fixtures/discord.js';
import { syntheticInteractions } from './fixtures/interactions.js';
import { ticketPayload } from './fixtures/case-lifecycle.js';
import { GUILD, USER, OTHER, STAFF, LEAD, completedReading, started } from './fixtures/domain.js';

test('closed cases retain their exact audience while denying posting, threads and external app public responses', () => {
  const roles = roleList().map(role => ({ id: role.id, permissions: String(CASE_CLOSED_WRITE_BITS) }));
  for (const type of ['admin-help', 'staff-report', 'head-admin-contact']) {
    const overwrites = caseChannelPayload({ ...casePlan, type }, casePolicy, 'closed').permission_overwrites;
    const permission = (userId, roleIds) => channelPermissions({ guildId: GUILD, userId, roleIds, roles, overwrites });
    assert.equal(permission(USER, [CREW, STAFF, LEAD]) & CASE_CLOSED_WRITE_BITS, 0n);
    assert.equal(permission(USER, [CREW]) & PERMISSIONS.readHistory, PERMISSIONS.readHistory);
    assert.equal(permission(OTHER, [STAFF]) & PERMISSIONS.viewChannel, type === 'head-admin-contact' ? 0n : PERMISSIONS.viewChannel);
    assert.equal(permission(OTHER, [LEAD]) & CASE_CLOSED_WRITE_BITS, 0n);
    assert.equal(permission(OTHER, [CREW]) & PERMISSIONS.viewChannel, 0n);
  }
});

test('closed permission writes require a fresh preparation with all closed-mode permission bits', async () => {
  const f = simulatedCases(), proof = await f.channels.create(await f.channels.prepare(casePlan), casePlan);
  await assert.rejects(f.channels.setAudience(await f.channels.prepare(casePlan), proof, casePlan, 'closed'), /CASE_CONTEXT_UNTRUSTED/);
  f.state.roles.find(role => role.id === BOT_ROLE).permissions = String(PERMISSIONS.manageRoles | PERMISSIONS.manageChannels);
  await assert.rejects(f.channels.prepare(casePlan, 'closed'), /BOT_PERMISSION_MISSING/);
  assert.equal(f.state.calls.filter(call => call.method === 'PATCH').length, 0);
});

test('signed ticket commands carry only bounded routing, version and reason; unsigned copies confer no identity', () => {
  const f = syntheticInteractions(), row = { id: 'synthetic-case', version: 12 };
  for (const action of ['status', 'close', 'reopen']) {
    const proof = f.verifier.verify(f.signed(ticketPayload(f, action, row)));
    assert.equal(proof.command, `ticket.${action}`); assert.equal(proof.targetId, proof.userId);
    assert.equal(proof.caseId, row.id); if (action !== 'status') assert.equal(proof.expectedVersion, 12);
    assert.throws(() => f.verifier.resolvePrincipal({ ...proof }), /UNTRUSTED_PRINCIPAL/);
  }
  for (const reference of ['x@01', 'x@-1', 'x@1.0', 'x@2147483645', 'x@2147483646', 'x@0@1', '@0']) assert.throws(() => parseCaseReference(reference));
  assert.deepEqual(parseCaseReference('case.1@2147483644'), { caseId: 'case.1', expectedVersion: 2_147_483_644 });
  for (const change of [fields => fields.push({ type: 3, name: 'notes', value: 'synthetic-excluded-field' }),
    fields => { fields[1].value = 'free-form text'; }, fields => { fields[0].type = 6; }, fields => { fields[0].name = 'reason'; }]) {
    const payload = ticketPayload(f, 'close', row); change(payload.data.options[0].options);
    assert.throws(() => f.verifier.verify(f.signed(payload)));
  }
  const definition = ticketCommandDefinition(); assert.deepEqual(definition.contexts, [0]);
  assert.deepEqual(definition.options.map(row => row.name), ['open', 'report', 'contact', 'contacts', 'status', 'close', 'reopen', 'queue', 'claim', 'unclaim', 'assign', 'participant', 'label', 'reply', 'answer']);
});

test('ticket status is bounded metadata and distinguishes pending closure from confirmed closure', () => {
  const view = { state: 'ready', id: 'case-id', type: 'admin-help', caseState: 'closing', version: 2,
    userId: USER, channelId: OTHER, action: 'close', actionStatus: 'pending', assigneeId: null, assignmentStatus: null };
  assert.match(caseStatusReply(view).embeds[0].description, /Closing · permissions not yet confirmed/);
  assert.match(caseStatusReply({ ...view, caseState: 'closed' }).embeds[0].description, /ticket reopen case:case-id@2/);
  assert.match(caseStatusReply({ ...view, channelId: null }).embeds[0].description, /provisioning must be reviewed/);
  assert.throws(() => caseStatusReply({ ...view, notes: 'synthetic-excluded-field' }), /INVALID_FIELDS/);
});

test('closure invalidates pending grants without clearing reading progress, a help pause or already earned completion', () => {
  const active = started(), pending = completedReading().session;
  assert.equal(cancelOnboardingGrantForClosure(active, 'fresh'), active);
  const paused = { ...active, helpPaused: true }; assert.equal(cancelOnboardingGrantForClosure(paused, 'fresh'), paused);
  const next = cancelOnboardingGrantForClosure(pending, 'fresh');
  assert.equal(next.status, 'active'); assert.equal(next.helpPaused, false); assert.equal(next.stepIndex, pending.stepIndex);
  assert.equal(next.version, pending.version + 1); assert.equal(next.nonce, 'fresh'); assert.equal(next.grantAccessEpoch, null);
  const complete = { ...pending, status: 'complete', grantAccessEpoch: null };
  assert.equal(cancelOnboardingGrantForClosure(complete, 'fresh'), complete);
});

test('ticket routes require the explicitly injected lifecycle use case and reject generic operations', async () => {
  const calls = [], router = createAdministrationCommands({ caseLifecycle: { execute: async e => { calls.push(e.command); return 'case_status'; } } });
  for (const command of ['ticket.status', 'ticket.close', 'ticket.reopen']) {
    assert.equal(await router.execute({ command }), 'case_status');
    assert.equal(await createAdministrationCommands({}).execute({ command }), 'denied');
  }
  assert.equal(await router.execute({ command: 'ticket.delete' }), 'denied'); assert.equal(calls.length, 3);
});
