import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCaseIssueControl, parseCaseIssueReference, caseIssueQueueReply } from '../modules/tickets/delivery-issues.js';
import { createAdministrationCommands } from '../apps/core/discord/onboarding-commands.js';
import { syntheticInteractions } from './fixtures/interactions.js';
import { GUILD, USER, OTHER } from './fixtures/domain.js';
const id = 'a'.repeat(32), prefix = 'sophie:case-issue:v1';

test('ordinary recovery routing accepts only signed closed metadata commands and bounded references', () => {
  const f = syntheticInteractions(), queue = f.mint({ data: { type: 1, name: 'ticket', options: [{ type: 1, name: 'issues' }] } });
  assert.equal(queue.command, 'ticket.issues'); assert.equal(queue.after, null);
  for (const action of ['recover', 'choose']) {
    const selected = action === 'recover' ? 'message' : 'channel', fields = [{ type: 3, name: 'issue', value: `${id}.2` }, { type: 3, name: selected, value: USER }];
    const mint = options => f.mint({ data: { type: 1, name: 'ticket', options: [{ type: 1, name: action, options }] } });
    assert.equal(mint(fields).command, action === 'recover' ? 'ticket.message.recover' : 'ticket.channel.choose');
    assert.equal(mint(fields.toReversed()).expectedRevision, 2);
    for (const invalid of [fields.slice(0, 1), [...fields, fields[0]], [fields[0], { ...fields[1], type: 7 }],
      [fields[0], { ...fields[1], value: 'https://discord.com/unsupported' }]]) assert.throws(() => mint(invalid));
  }
  const action = f.mint({ type: 3, message: { id: OTHER, content: 'synthetic discarded text' }, data: { component_type: 2, custom_id: `${prefix}:recheck:${id}:2` } });
  assert.equal(action.command, 'ticket.issue.recheck'); assert.equal(Object.hasOwn(action, 'message'), false);
  assert.throws(() => f.verifier.resolvePrincipal({ ...action }));
  for (const bad of [`${id}.02`, `${id}.2147483645`, `${id}.-1`, `${id}.2\n`, {}]) assert.throws(() => parseCaseIssueReference(bad));
  for (const bad of [`${prefix}:resend:${id}:2`, `${prefix}:recheck:arbitrary:2`, `${prefix}:queue:../all`]) assert.throws(() => parseCaseIssueControl(bad));
});

test('ordinary issue presentation rejects free text and renders bounded audience-filtered metadata', () => {
  const entry = { issueId: id, userId: USER, revision: 3, channelId: OTHER, caseState: 'open', caseType: 'admin-help', kind: 'intake',
    reason: 'uncertain', attempted: true, recheckable: false, needsMessageId: true, channelChoice: null };
  const render = value => caseIssueQueueReply({ state: 'ready', guildId: GUILD, entries: [value], next: null });
  const body = render(entry); assert.equal(body.components[0].components[0].disabled, true);
  assert.ok(body.embeds[0].description.includes(`/ticket recover issue:${id}.3`));
  const reply = { ...entry, kind: 'reply', replyId: 'b'.repeat(32) }, replyBody = render(reply);
  assert.match(replyBody.embeds[0].title, /Human Staff reply/); assert.match(replyBody.embeds[0].description, /sophie:staff-reply:v1:bbbb/);
  assert.equal(replyBody.components[0].components[0].disabled, true);
  assert.throws(() => render({ ...reply, text: 'Synthetic private text' }));
  assert.throws(() => render({ ...reply, replyId: 'foreign' }));
  for (const change of [{ notes: 'unsupported' }, { reason: '@everyone' }, { caseType: 'shuttle' }, { recheckable: true }, { kind: 'arbitrary' }]) assert.throws(() => render({ ...entry, ...change }));
  const choice = { ...entry, kind: 'case', needsMessageId: false, channelChoice: { required: true, total: 2, candidates: [USER, OTHER] } };
  assert.ok(render(choice).embeds[0].description.includes('/ticket choose'));
  assert.throws(() => render({ ...choice, channelChoice: { ...choice.channelChoice, candidates: [USER, USER] } }));
  for (const state of ['denied', 'disabled', 'stale', 'unavailable']) assert.deepEqual(caseIssueQueueReply({ state }).embeds, []);
});

test('ordinary issue pagination stays within component limits and carries no arbitrary operation identity', () => {
  const entries = Array.from({ length: 5 }, (_, index) => ({ issueId: String(index).repeat(32), userId: USER, revision: index,
    channelId: null, caseState: 'pending', caseType: 'quick-help', kind: 'case', reason: 'review', attempted: false, recheckable: true, needsMessageId: false, channelChoice: null }));
  const view = { state: 'ready', guildId: GUILD, entries, next: entries.at(-1).issueId }, body = caseIssueQueueReply(view);
  assert.equal(body.embeds.length, 5); assert.equal(body.components.length, 2);
  for (const row of body.components) for (const button of row.components) { assert.ok(button.custom_id.length <= 100); assert.doesNotThrow(() => parseCaseIssueControl(button.custom_id)); }
  assert.throws(() => caseIssueQueueReply({ ...view, entries: [...entries, entries[0]] }));
  assert.throws(() => caseIssueQueueReply({ ...view, next: id }));
});

test('ordinary recovery needs explicit adapter injection and has no generic retry or resend route', async () => {
  const commands = ['ticket.issues', 'ticket.issue.recheck', 'ticket.message.recover', 'ticket.channel.choose'];
  const router = createAdministrationCommands({ caseDeliveryIssues: { execute: async envelope => envelope.command } });
  for (const command of commands) { assert.equal(await router.execute({ command }), command); assert.equal(await createAdministrationCommands({}).execute({ command }), 'denied'); }
  for (const command of ['outbox.retry', 'ticket.resend', 'ticket.delete', 'ticket.force']) assert.equal(await router.execute({ command }), 'denied');
});
