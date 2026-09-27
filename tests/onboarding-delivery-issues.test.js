import test from 'node:test';
import assert from 'node:assert/strict';
import { parseOnboardingIssueControl, parseOnboardingRecoveryReference, onboardingIssueQueueReply, onboardingIssueReason } from '../modules/onboarding/delivery-issues.js';
import { createAdministrationCommands } from '../apps/core/discord/onboarding-commands.js';
import { syntheticInteractions } from './fixtures/interactions.js';
import { GUILD, USER, OTHER } from './fixtures/domain.js';

const issueId = 'a'.repeat(32), prefix = 'sophie:shuttle-issue:v1';

test('signed delivery review controls accept only bounded issue identities and revisions', () => {
  const identities = syntheticInteractions();
  const queue = identities.mint({ data: { type: 1, name: 'whitelist', options: [{ type: 1, name: 'issues' }] } });
  assert.equal(queue.command, 'shuttle.issues'); assert.equal(queue.after, null);
  const envelope = identities.mint({ type: 3, message: { id: OTHER, content: 'discard synthetic text' },
    data: { component_type: 2, custom_id: `${prefix}:recheck:${issueId}:4` },
    member: { user: { id: USER }, roles: ['untrusted'], permissions: '8' } });
  assert.equal(envelope.command, 'shuttle.issue.recheck'); assert.equal(envelope.issueId, issueId);
  assert.equal(envelope.expectedRevision, 4); assert.equal(envelope.targetId, USER);
  assert.equal(Object.hasOwn(envelope, 'message'), false); assert.equal(Object.hasOwn(envelope, 'roles'), false);
  assert.throws(() => identities.verifier.resolvePrincipal({ ...envelope }), /UNTRUSTED_PRINCIPAL/);
  assert.deepEqual(parseOnboardingIssueControl(`${prefix}:queue:${issueId}`), { command: 'shuttle.issues', after: issueId });
  for (const control of [`${prefix}:recheck:${issueId}:04`, `${prefix}:recheck:${issueId}:2147483647`,
    `${prefix}:recheck:${issueId}:-1`, `${prefix}:recheck:arbitrary-job:0`, `${prefix}:delete:${issueId}:0`,
    `${prefix}:queue:${issueId.toUpperCase()}`, `${prefix}:queue:../all`]) assert.throws(() => parseOnboardingIssueControl(control));
  assert.throws(() => identities.mint({ data: { type: 1, name: 'whitelist', options: [{ type: 1, name: 'issues', options: [{ name: 'sql', type: 3, value: 'unsupported' }] }] } }));
});

test('delivery review presentation contains only bounded metadata and specific recheck controls', () => {
  const entries = Array.from({ length: 5 }, (_, index) => ({ issueId: String(index).repeat(32), userId: USER,
    revision: index, channelId: OTHER, caseState: 'open', kind: index ? 'grant' : 'reconcile',
    reason: 'roles', attempted: true, recheckable: index !== 2, needsMessageId: false, channelChoice: null }));
  const view = { state: 'ready', guildId: GUILD, entries, next: entries.at(-1).issueId };
  const body = onboardingIssueQueueReply(view);
  assert.equal(body.embeds.length, 5); assert.equal(body.components[0].components.length, 5);
  assert.equal(body.components[0].components[2].disabled, true);
  for (let index = 0; index < 5; index++) {
    const button = body.components[0].components[index]; assert.ok(button.custom_id.length <= 100);
    assert.deepEqual(parseOnboardingIssueControl(button.custom_id), { command: 'shuttle.issue.recheck', issueId: entries[index].issueId, expectedRevision: index });
  }
  assert.equal(parseOnboardingIssueControl(body.components[1].components[1].custom_id).after, view.next);
  for (const state of ['disabled', 'denied', 'unavailable']) assert.deepEqual(onboardingIssueQueueReply({ state }).embeds, []);
  assert.equal(onboardingIssueQueueReply({ ...view, entries: [], next: null }).embeds.length, 0);
  for (const invalid of [{ ...view, entries: [...entries, entries[0]] }, { ...view, entries: [entries[0], entries[0]], next: null },
    { ...view, next: issueId }, { ...view, entries: [{ ...entries[0], reason: '@everyone' }], next: null },
    { ...view, entries: [{ ...entries[0], userId: '@everyone' }], next: null }, { ...view, notes: 'unsupported' }]) assert.throws(() => onboardingIssueQueueReply(invalid));
  assert.equal(onboardingIssueReason('ROLE_HIERARCHY_BLOCKED'), 'roles');
  assert.equal(onboardingIssueReason('OPERATION_DENIED'), 'permissions');
  assert.equal(onboardingIssueReason('ATTEMPT_LIMIT'), 'attempts');
  assert.equal(onboardingIssueReason('DISCORD_RATE_LIMIT_INVALID'), 'delivery');
  assert.equal(onboardingIssueReason('synthetic raw upstream detail'), 'review');
});

test('delivery issue routing requires explicit injection and excludes arbitrary retry operations', async () => {
  const called = [], router = createAdministrationCommands({ deliveryIssues: { execute: async envelope => {
    called.push(envelope.command); return 'shuttle_issue_recorded';
  } } });
  for (const command of ['shuttle.issues', 'shuttle.issue.recheck', 'shuttle.message.recover', 'shuttle.channel.choose']) {
    assert.equal(await router.execute({ command }), 'shuttle_issue_recorded');
    assert.equal(await createAdministrationCommands({}).execute({ command }), 'denied');
  }
  for (const command of ['outbox.retry', 'shuttle.issue.grant', 'case.retry', 'shuttle.message.resend']) assert.equal(await router.execute({ command }), 'denied');
  assert.deepEqual(called, ['shuttle.issues', 'shuttle.issue.recheck', 'shuttle.message.recover', 'shuttle.channel.choose']);
});

test('message recovery accepts only a versioned issue reference and one Discord message identity', () => {
  const identities = syntheticInteractions(), fields = [
    { name: 'issue', type: 3, value: `${issueId}.5` }, { name: 'message', type: 3, value: USER }];
  const mint = options => identities.mint({ data: { type: 1, name: 'whitelist', options: [{ type: 1, name: 'recover', options }] } });
  const envelope = mint(fields);
  assert.equal(envelope.command, 'shuttle.message.recover'); assert.equal(envelope.issueId, issueId);
  assert.equal(envelope.expectedRevision, 5); assert.equal(envelope.messageId, USER);
  assert.equal(mint(fields.toReversed()).issueId, issueId);
  for (const bad of [fields.slice(0, 1), [...fields, fields[0]], [fields[0], fields[0]],
    [fields[0], { ...fields[1], type: 7 }], [fields[0], { ...fields[1], value: 'https://discord.com/channels/1/2/3' }],
    [{ ...fields[0], value: `${issueId}.05` }, fields[1]], [{ ...fields[0], name: 'sql' }, fields[1]]]) assert.throws(() => mint(bad));
  for (const reference of [issueId, `${issueId}.-1`, `${issueId}.2147483646`, `${issueId}.0\n`, {}]) assert.throws(() => parseOnboardingRecoveryReference(reference));
});

test('unknown messages show precise recovery guidance without providing a blind resend button', () => {
  const entry = { issueId, userId: USER, revision: 3, channelId: OTHER, caseState: 'open', kind: 'screen',
    reason: 'review', attempted: true, recheckable: false, needsMessageId: true, channelChoice: null };
  const view = { state: 'ready', guildId: GUILD, entries: [entry], next: null };
  const body = onboardingIssueQueueReply(view);
  assert.match(body.embeds[0].description, new RegExp(`recover issue:${issueId}\\.3 message:`));
  assert.equal(body.components[0].components[0].disabled, true);
  for (const kind of ['screen', 'alert', 'case', 'grant', 'reconcile']) {
    assert.ok(onboardingIssueQueueReply({ ...view, entries: [{ ...entry, kind, needsMessageId: false, channelChoice: null, recheckable: true }] }).embeds[0].title);
  }
  assert.throws(() => onboardingIssueQueueReply({ ...view, entries: [{ ...entry, recheckable: true }] }));
  assert.throws(() => onboardingIssueQueueReply({ ...view, entries: [{ ...entry, kind: 'case' }] }));
});

test('channel selection accepts only a versioned issue reference and a channel ID', () => {
  const identities = syntheticInteractions(), fields = [
    { name: 'issue', type: 3, value: `${issueId}.7` }, { name: 'channel', type: 3, value: USER }];
  const mint = options => identities.mint({ data: { type: 1, name: 'whitelist', options: [{ type: 1, name: 'choose', options }] } });
  const envelope = mint(fields);
  assert.equal(envelope.command, 'shuttle.channel.choose'); assert.equal(envelope.selectedChannelId, USER);
  assert.equal(envelope.expectedRevision, 7); assert.equal(envelope.issueId, issueId);
  for (const invalid of [fields.slice(0, 1), [...fields, fields[1]], [fields[0], { ...fields[1], type: 7 }],
    [fields[0], { ...fields[1], name: 'message' }], [fields[0], { ...fields[1], value: '<#123>' }]]) assert.throws(() => mint(invalid));
});

test('duplicate channel guidance lists bounded retained candidates without an automatic first choice', () => {
  const entry = { issueId, userId: USER, revision: 7, channelId: null, caseState: 'pending', kind: 'case', reason: 'review',
    attempted: true, recheckable: false, needsMessageId: false, channelChoice: { required: true, candidates: [USER, OTHER], total: 2 } };
  const render = item => onboardingIssueQueueReply({ state: 'ready', guildId: GUILD, entries: [item], next: null });
  const body = render(entry);
  assert.match(body.embeds[0].description, new RegExp(`choose issue:${issueId}\\.7 channel:`));
  assert.equal(body.components[0].components[0].disabled, true);
  for (const invalid of [{ ...entry, recheckable: true }, { ...entry, kind: 'screen' },
    { ...entry, channelChoice: { ...entry.channelChoice, candidates: [USER, USER] } },
    { ...entry, channelChoice: { ...entry.channelChoice, total: 2_147_483_647 } }]) assert.throws(() => render(invalid));
  const oversized = render({ ...entry, channelChoice: { required: true, total: 501,
    candidates: [USER, OTHER, '100000000000000021', '100000000000000022', '100000000000000023'] } });
  assert.match(oversized.embeds[0].description, /exceeds the channel-selection limit/);
  assert.equal(oversized.embeds[0].description.includes('/whitelist choose'), false);
});
