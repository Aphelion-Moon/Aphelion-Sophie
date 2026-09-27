import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { canonicalCaseForm, canonicalCaseAnswers, parseCaseFormSubmission, caseFormModal, parseCaseIntakeControl, ticketEntryPanel, ticketDestinationReply } from '../modules/tickets/intake.js';
import { syntheticCaseForm, syntheticCaseValues, intakeSubmitPayload, intakeBeginPayload } from './fixtures/case-intake.js';
import { syntheticInteractions } from './fixtures/interactions.js';
import { requireConfiguredCapability, validateCapabilityPolicy } from '../platform/authorization/actor-policy.js';
import { GUILD, OTHER, STAFF, LEAD, NOW } from './fixtures/domain.js';
import { MUZZLED } from './fixtures/discord.js';
import { createCaseIntake } from '../apps/core/discord/case-intake.js';
import { ContractError } from '../contracts/validation.js';
import { DiscordError } from '../apps/core/discord/transport.js';

const token = 'a1'.repeat(24);

test('destination diagnostics disclose only fixed stage and error codes and cannot change the safe reply', async () => {
  const envelope = { guildId: GUILD, targetId: OTHER, userId: OTHER, command: 'ticket.destination', caseToken: token };
  for (const stage of ['ACTOR', 'DESCRIBE', 'CHANNEL', 'CONFIRM']) {
    for (const [error, code] of [[new DiscordError('RATE_LIMITED'), 'RATE_LIMITED'], [new ContractError('MEMBERSHIP_STALE'), 'MEMBERSHIP_STALE'],
      [new ContractError('SYNTHETIC_PRIVATE_VALUE'), 'UNAVAILABLE'], [new Error('Synthetic private body'), 'UNAVAILABLE']]) {
      const faults = [], step = (at, value) => async () => { if (stage === at) throw error; return value; };
      const adapter = createCaseIntake({ enabled: () => true, verifier: { takeCaseFormSubmission() {} }, discord: { guildId: GUILD, observe: async () => ({}) },
        authorization: { resolveActor: step('ACTOR', {}) }, channels: { inspect: step('CHANNEL', {}) },
        store: { describeTicketDestination: step('DESCRIBE', { state: 'inspect', plan: { token }, channelId: '123' }), confirmTicketDestination: step('CONFIRM', {}) },
        onFault: value => { faults.push(value); throw new Error('Synthetic logging failure'); } });
      assert.deepEqual(await adapter.destination(envelope), { state: 'unavailable' });
      assert.deepEqual(faults, [`TICKET_DESTINATION_${stage}_${code}`]);
    }
  }
});
test('bounded ticket form schemas preserve canonical authored fields and reject executable or participant settings', () => {
  const form = syntheticCaseForm(); assert.deepEqual(canonicalCaseForm(form), form);
  for (const modified of [{ ...form, caseType: 'quick-help' }, { ...form, fields: [] }, { ...form, fields: Array(6).fill(form.fields[0]) },
    { ...form, fields: [form.fields[0], form.fields[0]] }, { ...form, script: 'unreviewed' }, { ...form, title: 'x'.repeat(46) },
    { ...form, fields: [{ ...form.fields[0], kind: 'participants' }] }, { ...form, fields: [{ ...form.fields[0], maxLength: 4_001 }] }]) assert.throws(() => canonicalCaseForm(modified));
});
test('text and bounded selections validate against the exact version without truncation, omission or reordering', () => {
  const form = syntheticCaseForm(), values = syntheticCaseValues();
  assert.deepEqual(canonicalCaseAnswers(form, values.toReversed()), values);
  for (const invalid of [values.slice(1), [...values, values[0]], [{ ...values[0], value: '  \n ' }, values[1]],
    [{ ...values[0], value: 'x'.repeat(2_001) }, values[1]], [values[0], { ...values[1], value: ['unknown'] }],
    [values[0], { ...values[1], value: ['first', 'second'] }], [{ ...values[0], value: '\ud800' }, values[1]]]) assert.throws(() => canonicalCaseAnswers(form, invalid));
  const empty = [values[0], { ...values[1], value: [] }]; assert.deepEqual(canonicalCaseAnswers(form, empty), empty);
  const single = { ...form, fields: [{ ...form.fields[0], kind: 'short' }] };
  assert.throws(() => canonicalCaseAnswers(single, [{ ...values[0], value: 'two\nlines' }]));
});
test('modal rendering uses bounded Label/Text Input and String Select components with no files or mention parsing', () => {
  const modal = caseFormModal({ form: syntheticCaseForm(), token });
  assert.equal(modal.type, 9); assert.equal(modal.data.custom_id.length <= 100, true); assert.equal(modal.data.components[0].type, 18);
  assert.equal(modal.data.components[0].component.type, 4); assert.equal(modal.data.components[1].component.type, 3);
  assert.equal(modal.data.components[1].component.max_values, 1); assert.equal(JSON.stringify(modal).includes('value":"Synthetic intake'), false);
});
test('signed submission values are absent from routing and available once only to the explicit intake handoff', () => {
  const f = syntheticInteractions(), value = randomBytes(40).toString('hex'), fields = syntheticCaseValues(); fields[0].value = value;
  const payload = intakeSubmitPayload(f, token, fields), envelope = f.verifier.verify(f.signed(payload));
  assert.equal(envelope.command, 'ticket.submit'); assert.equal(JSON.stringify(envelope).includes(value), false);
  assert.throws(() => f.verifier.takeCaseFormSubmission({ ...envelope }), /UNTRUSTED_CASE_FORM/);
  const taken = f.verifier.takeCaseFormSubmission(envelope); assert.equal(taken[0].value === value, true);
  assert.throws(() => f.verifier.takeCaseFormSubmission(envelope), /UNTRUSTED_CASE_FORM/);
  assert.equal(f.verifier.resolvePrincipal(envelope).userId, payload.member.user.id);
});
test('modal wire parsing rejects uploads, resolved entities, duplicated fields and unknown nested data', () => {
  const f = syntheticInteractions(), data = intakeSubmitPayload(f, token).data;
  assert.equal(parseCaseFormSubmission(data).formToken, token);
  for (const invalid of [{ ...data, resolved: {} }, { ...data, components: [null] }, { ...data, components: [data.components[0], data.components[0]] },
    { ...data, components: [{ ...data.components[0], component: { type: 19, custom_id: 'file', values: [] } }] },
    { ...data, components: [{ ...data.components[0], hidden: 'source' }] }, { ...data, custom_id: 'foreign-form' }]) assert.throws(() => parseCaseFormSubmission(invalid));
});
test('public ticket buttons and slash entry accept exactly the six owner-defined public categories', () => {
  const f = syntheticInteractions(), panel = ticketEntryPanel(); assert.deepEqual(panel.allowed_mentions, { parse: [] });
  const buttons = panel.components.flatMap(row => row.components); assert.equal(buttons.length, 6); assert.equal(panel.components.length, 2);
  for (const button of buttons) { const route = parseCaseIntakeControl(button.custom_id); assert.equal(route.command, 'ticket.begin');
    const envelope = f.verifier.verify(f.signed(intakeBeginPayload(f, route.caseType))); assert.equal(envelope.caseType, route.caseType); }
  assert.throws(() => parseCaseIntakeControl('sophie:ticket:v1:open:player-report')); assert.throws(() => parseCaseIntakeControl('sophie:ticket:v1:open:shuttle'));
});
test('ticket navigation shows only verified fixed Discord destinations and distinguishes requests from readiness', () => {
  const pending = ticketDestinationReply({ state: 'preparing', caseToken: token }); assert.match(pending.content, /still being prepared/);
  assert.equal(parseCaseIntakeControl(pending.components[0].components[0].custom_id).command, 'ticket.destination');
  const ready = ticketDestinationReply({ state: 'ready', guildId: GUILD, channelId: '123' }); assert.equal(ready.components[0].components[0].url, `https://discord.com/channels/${GUILD}/123`);
  assert.throws(() => ticketDestinationReply({ state: 'ready', guildId: GUILD, channelId: 'https://other.test' }));
});
test('old capability maps stay immutable and deny new form-publication authority unless explicitly assigned', () => {
  const policy = { guildId: GUILD, version: 1, staff: STAFF, leadOps: LEAD, muzzled: MUZZLED,
    grants: { 'member.mute': [], 'member.unmute': [], 'shuttle.publish': [LEAD], 'case.registry': [LEAD] } };
  validateCapabilityPolicy(policy);
  const actor = { guildId: GUILD, userId: OTHER, known: true, observedAt: NOW, present: true,
    roleIds: [LEAD], bot: false, timedOut: false, administrator: false, guildOwner: false, highestRolePosition: 8 };
  assert.throws(() => requireConfiguredCapability(policy, 'case.forms.publish', actor, NOW), /OPERATION_DENIED/);
  const explicit = { ...policy, version: 2, grants: { ...policy.grants, 'case.forms.publish': [LEAD] } };
  assert.doesNotThrow(() => requireConfiguredCapability(explicit, 'case.forms.publish', actor, NOW));
});
