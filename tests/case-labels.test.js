import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCaseTags, requireCaseLabels } from '../modules/tickets/labels.js';
import { caseStatusReply, caseStatusView, ticketCommandDefinition } from '../modules/tickets/lifecycle.js';
import { syntheticInteractions } from './fixtures/interactions.js';
import { caseStaffPayload } from './fixtures/case-staff.js';
import { GUILD, USER } from './fixtures/domain.js';

test('manual labels are bounded human text with no mentions, control characters or repeated tags', () => {
  assert.deepEqual(parseCaseTags(' Polska, Follow-up, Café '), ['Polska', 'Follow-up', 'Café']);
  assert.deepEqual(parseCaseTags('-'), []); assert.deepEqual(parseCaseTags(''), []);
  for (const tags of ['@everyone', '<script>', 'a\nb', 'a,a', 'a,A', 'x'.repeat(33), 'a,b,c,d,e,f,g,h,i', 'a,,b', 'tag`code']) assert.throws(() => parseCaseTags(tags), /CASE_LABELS_INVALID/);
  assert.throws(() => requireCaseLabels({ priority: 'automatic', tags: [] }), /CASE_LABELS_INVALID/);
});
test('signed labels use a closed input shape and frozen tags; registration and status retain literal labels', () => {
  const f = syntheticInteractions(), row = { id: 'synthetic-case', version: 1 };
  const proof = f.verifier.verify(f.signed(caseStaffPayload(f, 'label', row, { priority: 'urgent', tags: 'Needs_review' })));
  assert.equal(proof.command, 'ticket.label'); assert.equal(proof.priority, 'urgent'); assert.equal(Object.isFrozen(proof.tags), true);
  assert.throws(() => proof.tags.push('forged')); assert.throws(() => f.verifier.resolvePrincipal({ ...proof }));
  const bad = caseStaffPayload(f, 'label', row); bad.data.options[0].options.push({ type: 3, name: 'notes', value: 'not allowed' });
  assert.throws(() => f.verifier.verify(f.signed(bad)));
  assert.equal(ticketCommandDefinition().options.find(option => option.name === 'label').options.length, 3);
  const view = caseStatusView({ ...row, userId: USER, guildId: GUILD, type: 'admin-help', state: 'open', channelId: USER,
    action: null, actionStatus: null, assigneeId: null, assignmentStatus: null, priority: 'urgent', tags: ['Needs_review'] });
  assert.match(caseStatusReply(view).embeds[0].description, /Tags: `Needs_review`/);
});
