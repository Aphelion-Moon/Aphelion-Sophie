import test from 'node:test';
import assert from 'node:assert/strict';
import { syntheticInteractions, APPLICATION } from './fixtures/interactions.js';
import { GUILD, NOW } from './fixtures/domain.js';
import { createCaseReplyCommands } from '../apps/core/discord/case-reply-commands.js';
import { createAdministrationCommands } from '../apps/core/discord/onboarding-commands.js';
import { createInteractionResponder } from '../apps/core/discord/interaction-response.js';
import { administrationCommandDefinitions } from '../apps/core/discord/command-registration.js';
import { ContractError } from '../contracts/validation.js';

const text = 'SYNTHETIC private authored reply @everyone <@123>';
function payload(f, confirmed = true) {
  return f.payload({ data: { type: 1, name: 'ticket', options: [{ type: 1, name: 'reply', options: [
    { type: 3, name: 'case', value: 'synthetic-case@2' }, { type: 3, name: 'text', value: text }, { type: 5, name: 'confirm', value: confirmed },
  ] }] } });
}
function fixture() {
  const clock = { now: NOW }, f = syntheticInteractions({ clock: () => clock.now });
  const state = { enabled: true, requests: [], reads: [], result: 'pending' };
  const commands = createCaseReplyCommands({ verifier: f.verifier, guildId: GUILD, enabled: () => state.enabled,
    authorization: { resolveActor: async envelope => f.verifier.resolvePrincipal(envelope) },
    store: { describeCase: async args => { state.reads.push(args); if (state.readError) throw state.readError; if (state.disableAfterRead) state.enabled = false; return { channelId: '123' }; } },
    replies: { request: async args => { state.requests.push(args); if (state.error) throw state.error; return { state: state.result }; } } });
  return { ...f, state, commands, clock, envelope: confirmed => f.verifier.verify(f.signed(payload(f, confirmed))) };
}
test('signed reply text is private, bounded and consumed once through an authentic proof', () => {
  const f = fixture(), envelope = f.envelope(true);
  assert.equal(envelope.command, 'ticket.reply'); assert.equal(envelope.expectedVersion, 2); assert.equal(envelope.confirmed, true);
  assert.equal(JSON.stringify(envelope).includes(text), false); assert.equal(Object.hasOwn(envelope,'text'), false);
  assert.throws(() => f.verifier.takeCaseReplyText({ ...envelope }), /UNTRUSTED_CASE_REPLY/);
  assert.equal(f.verifier.takeCaseReplyText(envelope), text); assert.throws(() => f.verifier.takeCaseReplyText(envelope), /UNTRUSTED_CASE_REPLY/);
  const late = f.envelope(true); f.clock.now += 300001; assert.throws(() => f.verifier.takeCaseReplyText(late), /UNTRUSTED_CASE_REPLY/);
});
test('reply option parsing rejects extra, duplicate, mistyped, ill-formed or over-limit values', () => {
  const f = fixture();
  for (const edit of [fields => fields.push(fields[0]), fields => { fields[0].name = 'other'; }, fields => { fields[2].value = 'true'; },
    fields => { fields[1].type = 6; }, fields => { fields[1].value = 'x'.repeat(4001); }, fields => { fields[1].value = '\ud800'; },
    fields => { fields[1].value = ' '; }, fields => { fields[1].value = 'Synthetic\x00'; }, fields => { fields[0].value = 'synthetic-case'; }]) {
    const raw = payload(f); edit(raw.data.options[0].options); assert.throws(() => f.verifier.verify(f.signed(raw)));
  }
});
test('Discord confirmation and fresh case lookup reach the shared service with stable redelivery identity', async () => {
  const f = fixture(); assert.equal(await f.commands.execute(f.envelope(false)), 'case_reply_confirmation'); assert.equal(f.state.requests.length, 0);
  const raw = payload(f), execute = () => f.commands.execute(f.verifier.verify(f.signed(raw)));
  assert.equal(await execute(), 'case_reply_recorded'); assert.equal(await execute(), 'case_reply_recorded');
  assert.deepEqual(f.state.requests[0], f.state.requests[1]);
  const request = f.state.requests[0]; assert.equal(request.text, text); assert.equal(request.channelId, '123'); assert.equal(request.expectedVersion, 2); assert.match(request.requestId, /^[a-f0-9]{64}$/);
  assert.equal(f.state.reads[0].id, 'synthetic-case');
  const router = createAdministrationCommands({ caseReplies: f.commands }); assert.equal(await router.execute(f.envelope()), 'case_reply_recorded');
  assert.equal(await createAdministrationCommands({}).execute(f.envelope()), 'denied');
});
test('disabled, forged, revoked and stale requests fail closed; uncertain writes never claim delivery', async () => {
  const f = fixture(); f.state.enabled = false; assert.equal(await f.commands.execute(f.envelope()), 'disabled');
  f.state.enabled = true; assert.equal(await f.commands.execute({ ...f.envelope() }), 'denied');
  f.state.disableAfterRead = true; assert.equal(await f.commands.execute(f.envelope()), 'disabled'); assert.equal(f.state.requests.length, 0);
  f.state.disableAfterRead = false; f.state.enabled = true;
  for (const [code, status] of [['CASE_ACCESS_DENIED','denied'], ['CAPABILITY_REVOKED','denied'], ['STALE_CASE_VERSION','case_stale'], ['CASE_REPLY_LIMIT','case_reply_limit']]) {
    f.state.error = new ContractError(code); assert.equal(await f.commands.execute(f.envelope()), status);
  }
  f.state.error = new Error(text); assert.equal(await f.commands.execute(f.envelope()), 'case_reply_uncertain');
  f.state.error = null;
  for (const result of ['confirmed','cancelled','withdrawn']) { f.state.result = result; assert.equal(await f.commands.execute(f.envelope()), `case_reply_${result}`); }
});
test('registration is guild scoped and explicit; all reply acknowledgements suppress mentions and authored text', async () => {
  const f = fixture(), definition = administrationCommandDefinitions().find(command => command.name === 'ticket');
  const reply = definition.options.find(option => option.name === 'reply');
  assert.ok(definition.options.length <= 25); assert.equal(reply.options.length, 3); assert.ok(reply.options.every(option => option.required));
  assert.equal(reply.options[1].max_length, 4000); assert.equal(reply.options[2].type, 5);
  const sent = [], responder = createInteractionResponder({ verifier: f.verifier, applicationId: APPLICATION, clock: () => NOW, enabled: () => true,
    fetch: async (url, options) => { sent.push(JSON.parse(options.body)); return new Response(null, { status: 200 }); } });
  for (const suffix of ['confirmation','recorded','confirmed','cancelled','withdrawn','limit','uncertain']) await responder.respond(f.envelope(), `case_reply_${suffix}`);
  for (const message of sent) { assert.equal(JSON.stringify(message).includes(text), false); assert.deepEqual(message.allowed_mentions.parse, []); assert.deepEqual(message.components, []); }
  assert.match(sent[1].content, /Delivery is pending/); assert.match(sent.at(-1).content, /may still complete/);
});
