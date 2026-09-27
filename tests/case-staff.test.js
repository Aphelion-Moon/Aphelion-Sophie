import assert from 'node:assert/strict';
import test from 'node:test';
import { caseQueueReply, parseCaseStaffControl, assignmentDescription } from '../modules/tickets/staff.js';
import { caseStatusReply, caseStatusView, ticketCommandDefinition } from '../modules/tickets/lifecycle.js';
import { createAdministrationCommands } from '../apps/core/discord/onboarding-commands.js';
import { syntheticInteractions } from './fixtures/interactions.js';
import { caseStaffPayload, caseStaffControl } from './fixtures/case-staff.js';
import { GUILD, USER, OTHER } from './fixtures/domain.js';

const token = 'abcdef123456'.repeat(4);
const entry = { id: 'c'.repeat(96), token, userId: USER, type: 'admin-help', caseState: 'open',
  version: 4, channelId: USER, assigneeId: null, assignmentStatus: null };
const view = { state: 'ready', guildId: GUILD, actorId: OTHER, filter: 'active', entries: [entry], next: token };

test('case queue controls stay bounded for maximal case identifiers and cannot carry arbitrary metadata', () => {
  const rendered = caseQueueReply(view);
  assert.match(rendered.embeds[0].description, /Unassigned/); assert.equal(rendered.embeds.length, 1);
  for (const row of rendered.components) for (const button of row.components) {
    assert.ok(button.custom_id.length <= 100); assert.ok(parseCaseStaffControl(button.custom_id).command.startsWith('ticket.'));
  }
  assert.throws(() => caseQueueReply({ ...view, entries: [{ ...entry, notes: 'synthetic-excluded' }] }), /INVALID_FIELDS/);
  assert.throws(() => caseQueueReply({ ...view, entries: [entry, entry] }), /INVALID_CASE_QUEUE/);
  assert.throws(() => caseQueueReply({ ...view, entries: Array(6).fill(entry) }), /INVALID_CASE_QUEUE/);
  assert.throws(() => caseQueueReply({ ...view, filter: 'closed' }), /INVALID_CASE_QUEUE/);
});

test('only open unassigned cases offer claim; own assignments offer unclaim without granting permissions', () => {
  const own = { ...entry, assigneeId: OTHER, assignmentStatus: 'needs_review' };
  assert.match(caseQueueReply({ ...view, entries: [own] }).components[0].components[0].custom_id, /:unclaim:/);
  const assigned = caseQueueReply({ ...view, entries: [{ ...own, assigneeId: USER }] }); assert.equal(assigned.components.length, 1);
  const pending = caseQueueReply({ ...view, entries: [{ ...entry, caseState: 'pending' }] }); assert.equal(pending.components.length, 1);
  const closed = caseQueueReply({ ...view, filter: 'closed', entries: [{ ...own, caseState: 'closed' }] }); assert.match(closed.components[0].components[0].custom_id, /:unclaim:/);
  assert.match(assignmentDescription(own), /authority needs review/);
  assert.throws(() => assignmentDescription({ assigneeId: USER, assignmentStatus: null }), /INVALID_CASE_ASSIGNMENT/);
});

test('signed queue, claim, unclaim and assignment accept a closed input schema and discard role snapshots', () => {
  const f = syntheticInteractions();
  for (const action of ['queue', 'claim', 'unclaim', 'assign']) {
    const proof = f.verifier.verify(f.signed(caseStaffPayload(f, action, entry)));
    assert.equal(proof.command, `ticket.${action}`); assert.equal(proof.userId, OTHER); assert.equal(proof.targetId, OTHER);
    assert.throws(() => f.verifier.resolvePrincipal({ ...proof }), /UNTRUSTED_PRINCIPAL/);
  }
  const control = f.verifier.verify(f.signed(caseStaffControl(f, `sophie:case-staff:v1:claim:${token}:4`)));
  assert.equal(control.caseToken, token); assert.equal(control.expectedVersion, 4); assert.equal(Object.hasOwn(control, 'message'), false);
  for (const id of [`sophie:case-staff:v1:claim:${token}:04`, `sophie:case-staff:v1:assign:${token}:4`,
    `sophie:case-queue:v1:any:${token}`, `sophie:case-staff:v1:claim:${token}:2147483645`]) assert.throws(() => parseCaseStaffControl(id));
  for (const change of [fields => { fields[1].type = 3; }, fields => { fields[2].value = 'unbounded free text'; },
    fields => fields.push({ type: 3, name: 'notes', value: 'synthetic-excluded' }), fields => { fields[1].name = 'case'; }]) {
    const payload = caseStaffPayload(f, 'assign', entry); change(payload.data.options[0].options); assert.throws(() => f.verifier.verify(f.signed(payload)));
  }
  assert.deepEqual(ticketCommandDefinition().options.find(row => row.name === 'assign').options.map(row => row.type), [3, 6, 3]);
});

test('case status exposes assignment diagnostics and drops internal records before strict rendering', () => {
  const result = caseStatusView({ ...entry, state: 'open', action: null, actionStatus: null, assigneeId: OTHER, assignmentStatus: 'needs_review',
    plan: { internal: true }, assignee_grant: { internal: true } });
  assert.equal(Object.hasOwn(result, 'plan'), false); assert.equal(Object.hasOwn(result, 'assignee_grant'), false);
  assert.match(caseStatusReply(result).embeds[0].description, /current responder authority needs review/);
});

test('Staff case routes require explicit composition and exclude arbitrary permission or content operations', async () => {
  const calls = [], router = createAdministrationCommands({ caseStaff: { execute: async e => { calls.push(e.command); return 'case_queue'; } } });
  for (const command of ['ticket.queue', 'ticket.claim', 'ticket.unclaim', 'ticket.assign']) {
    assert.equal(await router.execute({ command }), 'case_queue'); assert.equal(await createAdministrationCommands({}).execute({ command }), 'denied');
  }
  for (const command of ['ticket.invite', 'ticket.notes', 'ticket.sql']) assert.equal(await router.execute({ command }), 'denied');
  assert.equal(calls.length, 4);
});
