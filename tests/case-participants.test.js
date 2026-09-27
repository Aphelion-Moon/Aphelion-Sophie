import test from 'node:test';
import assert from 'node:assert/strict';
import { validateCaseParticipantGrant } from '../contracts/case-participant.js';
import { requireCaseAccess } from '../modules/tickets/index.js';
import { GUILD, USER, OTHER, STAFF, LEAD, NOW } from './fixtures/domain.js';
import { validateCaseAudience, requireParticipantChange } from '../modules/tickets/participants.js';
import { caseChannelPayload, casePlanKey } from '../modules/tickets/channel-policy.js';
import { casePlan, casePolicy, simulatedCases } from './fixtures/cases.js';
import { participantPayload, PARTICIPANT } from './fixtures/case-participants.js';
import { syntheticInteractions } from './fixtures/interactions.js';
import { ticketCommandDefinition, caseStatusView, caseStatusReply } from '../modules/tickets/lifecycle.js';
import { PERMISSIONS } from '../platform/authorization/discord-permissions.js';

test('participant presence bindings are strict metadata without invitation or operator authority', () => {
  const grant = { guildId: GUILD, userId: USER, presenceEpoch: 1 };
  assert.doesNotThrow(() => validateCaseParticipantGrant(grant));
  for (const value of [{ ...grant, presenceEpoch: 0 }, { ...grant, presenceEpoch: Number.MAX_SAFE_INTEGER + 1 },
    { ...grant, userId: 'not-an-id' }, { ...grant, caseId: 'arbitrary-case' }, { ...grant, roleIds: [STAFF] },
    { ...grant, capabilityEpoch: 1 }, { guildId: GUILD, userId: USER }, null]) assert.throws(() => validateCaseParticipantGrant(value));
});

test('participant audiences are bounded, explicit and included in exact permission plans', () => {
  const audience = { version: 1, participants: [{ guildId: GUILD, userId: PARTICIPANT, presenceEpoch: 2 }] }, plan = { ...casePlan, audience };
  validateCaseAudience(audience, GUILD, USER);
  assert.notEqual(casePlanKey(plan), casePlanKey({ ...plan, audience: { ...audience, version: 2 } }));
  for (const mode of ['open', 'closed']) {
    const entry = caseChannelPayload(plan, casePolicy, mode).permission_overwrites.find(row => row.id === PARTICIPANT);
    assert.ok((BigInt(entry.allow) & PERMISSIONS.viewChannel) !== 0n);
    if (mode === 'closed') assert.ok((BigInt(entry.deny) & PERMISSIONS.sendMessages) !== 0n);
  }
  assert.equal(caseChannelPayload(plan, casePolicy, 'sealed').permission_overwrites.some(row => row.id === PARTICIPANT), false);
  for (const bad of [{ ...audience, version: 0 }, { ...audience, participants: [...audience.participants, ...audience.participants] },
    { ...audience, participants: [{ guildId: GUILD, userId: USER, presenceEpoch: 1 }] },
    { ...audience, participants: [{ guildId: OTHER, userId: PARTICIPANT, presenceEpoch: 1 }] }]) assert.throws(() => validateCaseAudience(bad, GUILD, USER));
});

test('signed participant changes require exact selection, matching reason and explicit history confirmation', () => {
  const identities = syntheticInteractions(), f = { payload: identities.payload }, row = { id: 'synthetic-case', version: 7 };
  const payload = participantPayload(f, row), envelope = identities.verifier.verify(identities.signed(payload));
  assert.equal(envelope.command, 'ticket.participant'); assert.equal(envelope.participantId, PARTICIPANT);
  assert.equal(envelope.targetId, OTHER); assert.equal(envelope.expectedVersion, 7); assert.equal(envelope.confirmed, true);
  const option = ticketCommandDefinition().options.find(value => value.name === 'participant'); assert.equal(option.options.length, 5);
  for (const confirmed of [false, 'true', null]) assert.throws(() => identities.verifier.verify(identities.signed(participantPayload(f, row, { confirmed }))));
  assert.throws(() => requireParticipantChange({ action: 'add', userId: PARTICIPANT, reason: 'no-longer-needed', confirmed: true }));
  const duplicate = structuredClone(payload); duplicate.data.options[0].options[4] = duplicate.data.options[0].options[1];
  assert.throws(() => identities.verifier.verify(identities.signed(duplicate)));
});

test('late channel identities remain retainable while old audience proofs and contexts cannot authorize a newer plan', async () => {
  const f = simulatedCases({ authorizeCaseParticipant: async () => true });
  const first = { ...casePlan, audience: { version: 1, participants: [{ guildId: GUILD, userId: PARTICIPANT, presenceEpoch: 1 }] } };
  const second = { ...first, audience: { version: 2, participants: [] } };
  const context = await f.channels.prepare(first), proof = await f.channels.create(await f.channels.prepare(first), first);
  await f.channels.verification.candidate(proof, second);
  await assert.rejects(f.channels.verification.channel(proof, second, 'sealed'), /CASE_AUDIENCE_CHANGED/);
  await assert.rejects(f.channels.setAudience(context, proof, second, 'open'), /CASE_CONTEXT_UNTRUSTED/);
  const denied = simulatedCases(); const stale = await denied.channels.create(await denied.channels.prepare(first), first);
  await assert.rejects(denied.channels.setAudience(await denied.channels.prepare(first), stale, first, 'open'), /CASE_AUDIENCE_CHANGED/);
});

test('Staff status exposes selected participant IDs without membership bindings or invitation audit data', () => {
  const record = { id: 'synthetic-case', type: 'admin-help', state: 'pending', version: 3, userId: USER, channelId: OTHER,
    action: null, actionStatus: null, assigneeId: null, assignmentStatus: null,
    plan: { ...casePlan, audience: { version: 1, participants: [{ guildId: GUILD, userId: PARTICIPANT, presenceEpoch: 7 }] } } };
  const view = caseStatusView(record); assert.deepEqual(view.participantIds, [PARTICIPANT]);
  const reply = caseStatusReply(view); assert.match(reply.embeds[0].description, /Selected additional participants:/);
  assert.equal(JSON.stringify(view).includes('presenceEpoch'), false);
  assert.throws(() => caseStatusReply({ ...view, participantIds: Array(21).fill(PARTICIPANT) }));
});

test('current guild membership alone grants no case access and an explicit participant never inherits management or notes', () => {
  const actor = { guildId: GUILD, userId: USER, present: true, known: true, observedAt: NOW, roleIds: [] };
  const caseRecord = { guildId: GUILD, openerId: OTHER, participantIds: [], type: 'staff-contact' };
  const request = { actor, caseRecord, roles: { staff: STAFF, leadOps: LEAD }, operation: 'read', now: NOW };
  assert.throws(() => requireCaseAccess(request), /CASE_ACCESS_DENIED/);
  const invited = { ...request, caseRecord: { ...caseRecord, participantIds: [USER] } };
  assert.doesNotThrow(() => requireCaseAccess(invited));
  for (const operation of ['notes', 'manage']) assert.throws(() => requireCaseAccess({ ...invited, operation }), /CASE_ACCESS_DENIED/);
  assert.throws(() => requireCaseAccess({ ...invited, actor: { ...actor, present: false } }), /CASE_ACCESS_DENIED/);
  assert.throws(() => requireCaseAccess({ ...invited, now: NOW + 60_001 }));
});
