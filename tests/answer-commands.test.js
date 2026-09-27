import test from 'node:test';
import assert from 'node:assert/strict';
import { syntheticInteractions, APPLICATION } from './fixtures/interactions.js';
import { GUILD, NOW } from './fixtures/domain.js';
import { ContractError } from '../contracts/validation.js';
import { createCuratedAnswerCommands } from '../apps/core/discord/curated-answers.js';
import { createAdministrationCommands } from '../apps/core/discord/onboarding-commands.js';
import { createInteractionResponder } from '../apps/core/discord/interaction-response.js';
import { administrationCommandDefinitions } from '../apps/core/discord/command-registration.js';
import { answerLookupReply } from '../modules/answers/discord.js';

const entry = { name: 'synthetic-public', revision: 1, action: 'publish', sha256: 'a'.repeat(64),
  document: { title: 'Synthetic public answer', text: 'Public @everyone <@123> text', source: 'Synthetic authored reference' } };
const payload = (f, action = 'show', value = 'synthetic-public') => f.payload({ data: { type: 1, name: 'answer',
  options: [{ type: 1, name: action, options: value === null ? [] : [{ type: 3, name: action === 'show' ? 'name' : 'after', value }] }] } });
function fixture() {
  const f = syntheticInteractions(), state = { enabled: true, reads: [], resolves: 0, entry: structuredClone(entry) };
  const commands = createCuratedAnswerCommands({ guildId: GUILD, enabled: () => state.enabled,
    authorization: { resolveActor: async envelope => { state.resolves++; if (state.denied) throw new ContractError('OPERATION_DENIED'); return f.verifier.resolvePrincipal(envelope); } },
    answers: {
      lookup: async input => { state.reads.push(input); if (state.error) throw state.error; if (state.disableOnRead) state.enabled = false; return state.entry; },
      list: async input => { state.reads.push(input); return { entries: [state.entry], next: state.entry.name }; },
    } });
  return { ...f, commands, state, envelope: (action, value) => f.verifier.verify(f.signed(payload(f, action, value))) };
}

test('signed answer routes contain only fixed lookup metadata and registration matches both operations', () => {
  const f = fixture(), definition = administrationCommandDefinitions().find(value => value.name === 'answer');
  assert.deepEqual(definition.options.map(value => value.name), ['list', 'show']);
  assert.equal(f.envelope().answerName, entry.name); assert.equal(f.envelope('list', null).after, null);
  assert.equal(f.envelope('list', entry.name).after, entry.name);
  assert.equal(JSON.stringify(f.envelope()).includes(entry.document.text), false);
  assert.equal(definition.options[1].options[0].required, true);
  assert.equal(definition.options[1].options[0].max_length, 40);
});

test('signed answer parser rejects duplicate, extra, nested, missing, mistyped and arbitrary lookup inputs', () => {
  const f = fixture();
  for (const edit of [option => { option.name = 'publish'; }, option => { option.options = []; },
    option => option.options.push(option.options[0]), option => { option.options[0].type = 6; },
    option => { option.options[0].name = 'url'; }, option => { option.options[0].options = []; },
    option => { option.options[0].value = 'https://example.invalid'; }, option => { option.options[0].value = 'x'.repeat(41); },
    option => { option.options[0].value = null; }, option => { option.value = 'nested'; }]) {
    const raw = payload(f); edit(raw.data.options[0]); assert.throws(() => f.verifier.verify(f.signed(raw)));
  }
});

test('dispatch defers lookup until response-time authorization and resolves publication afresh for each view', async () => {
  const f = fixture(), envelope = f.envelope(), router = createAdministrationCommands({ publicAnswers: f.commands });
  assert.equal(await router.execute(envelope), 'public_answer'); assert.equal(f.state.reads.length, 0);
  assert.equal(await createAdministrationCommands({}).execute(envelope), 'denied');
  assert.equal((await f.commands.view(envelope)).entry.revision, 1);
  f.state.entry = { ...entry, revision: 2 }; assert.equal((await f.commands.view(envelope)).entry.revision, 2);
  f.state.error = new ContractError('ANSWER_UNAVAILABLE'); assert.deepEqual(await f.commands.view(envelope), { status: 'unavailable' });
  assert.equal(f.state.resolves, 4); assert.ok(f.state.reads.every(input => input.name === entry.name));
  assert.equal((await f.commands.view(f.envelope('list', null))).kind, 'list');
  assert.equal(f.state.reads.at(-1).after, null);
});

test('forged, foreign, expired, departed and disabled lookups cannot disclose the public answer', async () => {
  const f = fixture(), envelope = f.envelope();
  assert.equal(await f.commands.execute({ ...envelope }), 'denied');
  assert.equal(await f.commands.execute({ ...envelope, guildId: '99' }), 'denied');
  assert.equal(await f.commands.execute({ ...envelope, targetId: '99' }), 'denied');
  assert.deepEqual(await f.commands.view({ ...envelope }), { status: 'denied' });
  f.state.denied = true; assert.deepEqual(await f.commands.view(envelope), { status: 'denied' });
  assert.equal(f.state.reads.length, 0);
  f.state.denied = false; f.state.enabled = false; assert.equal(await f.commands.execute(envelope), 'disabled');
  f.state.enabled = true; f.state.disableOnRead = true; assert.deepEqual(await f.commands.view(envelope), { status: 'disabled' });
  let now = NOW; const late = syntheticInteractions({ clock: () => now });
  const proof = late.verifier.verify(late.signed(payload(late))); now += 300001;
  assert.throws(() => late.verifier.resolvePrincipal(proof), /UNTRUSTED_PRINCIPAL/);
});

test('full length approved answers and maximum pages fit Discord without silently truncating text', () => {
  const document = { title: 't'.repeat(80), text: 'x'.repeat(4000), source: 's'.repeat(300) };
  const body = answerLookupReply({ status: 'available', kind: 'show', entry: { ...entry, document } });
  assert.deepEqual(body.embeds[0], { title: document.title, description: document.text, footer: { text: document.source } });
  assert.ok(body.content.length <= 2000); assert.ok(body.embeds[0].description.length <= 4096);
  const entries = Array.from({ length: 25 }, (_, i) => ({ name: `a${String(i).padStart(2, '0')}${'x'.repeat(37)}` }));
  const page = answerLookupReply({ status: 'available', kind: 'list', entries, next: entries.at(-1).name });
  assert.ok(page.content.length <= 2000); assert.ok(entries.every(item => page.content.includes(item.name)));
  assert.match(page.content, /Next page: \/answer list after:/);
  assert.match(answerLookupReply({ status: 'available', kind: 'list', entries: [], next: null }).content, /No published/);
  assert.throws(() => answerLookupReply({ status: 'available', kind: 'show', entry: { ...entry, action: 'withdraw' } }));
});

test('responder suppresses mentions and never echoes internal errors or an earlier withdrawn answer', async () => {
  const f = fixture(), sent = [], responder = createInteractionResponder({ verifier: f.verifier, applicationId: APPLICATION,
    clock: () => NOW, enabled: () => f.state.enabled, publicAnswers: f.commands,
    fetch: async (url, options) => { sent.push(JSON.parse(options.body)); return new Response(null, { status: 200 }); } });
  await responder.respond(f.envelope(), 'public_answer');
  assert.equal(sent[0].embeds[0].description, entry.document.text); assert.deepEqual(sent[0].allowed_mentions.parse, []);
  assert.deepEqual(sent[0].components, []);
  f.state.error = new Error('Synthetic private failure text'); await responder.respond(f.envelope(), 'public_answer');
  assert.deepEqual(sent[1].embeds, []); assert.equal(JSON.stringify(sent[1]).includes('failure text'), false);
  f.state.denied = true; await responder.respond(f.envelope(), 'public_answer'); assert.match(sent[2].content, /current guild membership/);
  f.state.denied = false; f.state.error = null; f.state.disableOnRead = true;
  await assert.rejects(responder.respond(f.envelope(), 'public_answer'), /DISCORD_TRANSPORT_DISABLED/); assert.equal(sent.length, 3);
});
