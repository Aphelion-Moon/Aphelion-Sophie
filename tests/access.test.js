import test from 'node:test';
import assert from 'node:assert/strict';
import { CASE_RETENTION, CASE_TYPES, requireCaseAccess, requireTicketCapacity } from '../modules/tickets/index.js';
import { requireNonTicketContext } from '../platform/authorization/non-ticket-context.js';
import { GUILD, LEAD, NOW, OTHER, STAFF, USER } from './fixtures/domain.js';

const actor = (userId, roleIds = [], overrides = {}) => ({ guildId: GUILD, userId, roleIds, present: true, known: true, observedAt: NOW, ...overrides });
const record = (type = 'admin-help') => ({ guildId: GUILD, type, openerId: USER, subjectId: OTHER, participantIds: [] });
const access = (who, caseRecord, operation = 'read') => requireCaseAccess({ actor: who, caseRecord, roles: { staff: STAFF, leadOps: LEAD }, operation, now: NOW });

test('T07/T08 a reported subject is not a participant', () => {
  assert.throws(() => access(actor(OTHER), record()), { code: 'CASE_ACCESS_DENIED' });
  assert.doesNotThrow(() => access(actor(USER), record()));
  assert.doesNotThrow(() => access(actor(OTHER), { ...record(), participantIds: [OTHER] }));
});

test('T56 only Head Admin contact excludes the ordinary Staff audience', () => {
  const ordinaryStaff = actor(OTHER, [STAFF]);
  assert.doesNotThrow(() => access(ordinaryStaff, record('staff-report')));
  assert.throws(() => access(ordinaryStaff, record('head-admin-contact')), { code: 'CASE_ACCESS_DENIED' });
  assert.doesNotThrow(() => access(actor(OTHER, [LEAD]), record('head-admin-contact')));
  assert.doesNotThrow(() => access(actor(USER, [STAFF]), record('head-admin-contact')));
  assert.equal(CASE_TYPES.filter(type => type.publicEntry).length, 6);
});

test('T07/T10 requester status does not grant staff-note or management access', () => {
  for (const operation of ['notes', 'manage']) {
    assert.throws(() => access(actor(USER), record(), operation), { code: 'CASE_ACCESS_DENIED' });
    assert.throws(() => access(actor(USER, [STAFF]), record('head-admin-contact'), operation), { code: 'CASE_ACCESS_DENIED' });
    assert.doesNotThrow(() => access(actor(OTHER, [LEAD]), record('head-admin-contact'), operation));
  }
});

test('T04 authority is checked again after a staff role is lost', () => {
  assert.doesNotThrow(() => access(actor(OTHER, [STAFF]), record(), 'export'));
  assert.throws(() => access(actor(OTHER), record(), 'export'), { code: 'CASE_ACCESS_DENIED' });
  assert.throws(() => access(actor(OTHER, [STAFF], { present: false }), record()), { code: 'CASE_ACCESS_DENIED' });
  assert.throws(() => access(actor(OTHER, [STAFF], { observedAt: NOW - 5_001 }), record()), { code: 'MEMBERSHIP_STALE' });
  assert.throws(() => access(actor(OTHER, [STAFF], { guildId: '9' }), record()), { code: 'CASE_ACCESS_DENIED' });
});

test('T59 ticket admission rejects floods and fails closed on invalid limits', () => {
  const limits = { memberOpen: 3, guildPending: 10, cooldownMs: 30_000 };
  const usage = { memberOpen: 0, guildPending: 0, lastCreatedAt: null };
  assert.doesNotThrow(() => requireTicketCapacity(usage, limits, NOW));
  assert.throws(() => requireTicketCapacity({ ...usage, memberOpen: 3 }, limits, NOW), { code: 'MEMBER_CASE_LIMIT' });
  assert.throws(() => requireTicketCapacity({ ...usage, guildPending: 10 }, limits, NOW), { code: 'GUILD_PROVISIONING_LIMIT' });
  assert.throws(() => requireTicketCapacity({ ...usage, lastCreatedAt: NOW - 1 }, limits, NOW), { code: 'CASE_COOLDOWN' });
  assert.throws(() => requireTicketCapacity(usage, { ...limits, memberOpen: Infinity }, NOW), { code: 'INVALID_INTEGER' });
});

test('T57 case retention has no automatic expiry', () => {
  assert.deepEqual(CASE_RETENTION, { mode: 'indefinite', automaticExpiry: false });
});

const context = () => ({
  guildId: GUILD, channelId: '20', checkedAt: NOW, allowlisted: true, actorAllowed: true,
  registryAvailable: true, ancestryComplete: true,
  lineage: [{ id: '20', classification: 'non_ticket' }, { id: '21', classification: 'non_ticket' }],
});

test('T22/T25 complete current non-ticket metadata is required at ingress and delivery', () => {
  const allowed = context();
  assert.doesNotThrow(() => requireNonTicketContext(allowed, NOW));
  const changed = context();
  changed.lineage[0].classification = 'case';
  assert.throws(() => requireNonTicketContext(changed, NOW), { code: 'AI_CASE_EXCLUDED' });
  assert.throws(() => requireNonTicketContext({ ...allowed, actorAllowed: false }, NOW), { code: 'AI_NOT_ALLOWED' });
});

test('T22 ticket ancestry, historical cases and incomplete classification are denied', () => {
  for (const classification of ['case', 'closed_case', 'moved_case', 'legacy_case', 'unknown']) {
    const target = context();
    target.lineage[1].classification = classification;
    assert.throws(() => requireNonTicketContext(target, NOW), { code: 'AI_CASE_EXCLUDED' });
  }
  for (const field of ['registryAvailable', 'ancestryComplete']) {
    assert.throws(() => requireNonTicketContext({ ...context(), [field]: false }, NOW), { code: 'AI_CLASSIFICATION_UNKNOWN' });
  }
  assert.throws(() => requireNonTicketContext({ ...context(), allowlisted: false }, NOW), { code: 'AI_NOT_ALLOWED' });
  assert.throws(() => requireNonTicketContext(context(), NOW + 5_001), { code: 'AI_CONTEXT_STALE' });
});

test('T23 the classification contract cannot accept case payloads or arbitrary fields', () => {
  assert.throws(() => requireNonTicketContext({ ...context(), messages: [] }, NOW), { code: 'INVALID_FIELDS' });
  assert.throws(() => requireNonTicketContext({ ...context(), channelId: '99' }, NOW), { code: 'AI_DESTINATION_MISMATCH' });
});
