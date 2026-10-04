import test from 'node:test';
import assert from 'node:assert/strict';
import { createInteractionHttpServer } from '../apps/core/discord/interaction-http.js';
import { syntheticInteractions } from './fixtures/interactions.js';
import { createCaseIntake } from '../apps/core/discord/case-intake.js';
import { contactStaffControl } from '../modules/tickets/intake.js';
import { syntheticCaseForm } from './fixtures/case-intake.js';
import { GUILD } from './fixtures/domain.js';

async function setup(options = {}) {
  const signed = syntheticInteractions();
  const replies = [], faults = [], calls = [];
  const server = createInteractionHttpServer({ verifier: signed.verifier,
    commands: { execute: async command => { calls.push(command); return 'recorded'; } },
    respond: async (envelope, result) => replies.push({ envelope, result }), enabled: () => true,
    onFault: code => faults.push(code), ...options });
  const address = await server.listen();
  const request = (payload = signed.payload(), overrides = {}) => {
    const input = signed.signed(payload);
    return fetch(`http://${address.host}:${address.port}/discord/interactions`, { method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Signature-Ed25519': input.signature, 'X-Signature-Timestamp': input.timestamp },
      body: input.body, ...overrides });
  };
  return { server, signed, replies, faults, calls, request, address };
}

test('T01 loopback receiver validates signatures before acknowledging or dispatching', async () => {
  const fixture = await setup();
  try {
    assert.equal(fixture.address.host, '127.0.0.1');
    const ping = await fixture.request(fixture.signed.payload({ type: 1 }));
    assert.deepEqual(await ping.json(), { type: 1 });
    const invalid = await fixture.request(undefined, { body: '{}' });
    assert.equal(invalid.status, 401);
    assert.equal(fixture.calls.length, 0);
    const response = await fixture.request();
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await response.json(), { type: 5, data: { flags: 64 } });
    await fixture.server.drain();
    assert.equal(fixture.calls.length, 1);
    assert.equal(fixture.replies[0].result, 'recorded');
  } finally { await fixture.server.close(); }
});

test('T59 a busy endpoint defers one command promptly and admits no waiting backlog', async () => {
  let release;
  const blocked = new Promise(resolve => { release = resolve; });
  const fixture = await setup({ commands: { execute: () => blocked } });
  try {
    const first = await fixture.request();
    assert.equal((await first.json()).type, 5);
    const second = await fixture.request();
    const declined = await second.json();
    assert.equal(declined.type, 4); assert.match(declined.data.content, /busy/);
    assert.deepEqual(declined.data.allowed_mentions, { parse: [] });
    release('recorded'); await fixture.server.drain();
    assert.equal(fixture.replies.length, 1);
  } finally { release('unavailable'); await fixture.server.close(); }
});

test('T01 disabled commands, wrong routes, compressed and oversized bodies have no side effects', async () => {
  const fixture = await setup({ enabled: () => false });
  try {
    assert.match((await (await fixture.request()).json()).data.content, /disabled/);
    assert.equal((await fixture.request(undefined, { headers: { 'Content-Type': 'text/plain' } })).status, 415);
    assert.equal((await fixture.request(undefined, { headers: { 'Content-Type': 'application/json', 'Content-Encoding': 'gzip' } })).status, 415);
    assert.equal((await fixture.request(undefined, { body: Buffer.alloc(262_145) })).status, 413);
    assert.equal((await fetch(`http://${fixture.address.host}:${fixture.address.port}/other`)).status, 404);
    assert.equal(fixture.calls.length, 0);
  } finally { await fixture.server.close(); }
});

test('T24 execution and response failures emit stable codes, never the underlying error', async () => {
  const fixture = await setup({ commands: { execute: async () => { throw new Error('synthetic private diagnostic'); } },
    respond: async () => { throw new Error('synthetic response credential'); } });
  try {
    await (await fixture.request()).json(); await fixture.server.drain();
    assert.deepEqual(fixture.faults, ['INTERACTION_EXECUTION_UNAVAILABLE', 'INTERACTION_RESPONSE_UNAVAILABLE']);
  } finally { await fixture.server.close(); }
});

test('T26 Contact staff returns a private chooser, rechecks membership and opens only a blank selected form', async () => {
  let present = true, enabled = true;
  const forms = [], actor = {}, observation = {}, source = 'SYNTHETIC_AI_CHAT_MUST_NOT_TRANSFER';
  const caseIntake = createCaseIntake({ enabled: () => enabled, verifier: { takeCaseFormSubmission() { assert.fail('No form submitted'); } },
    authorization: { resolveActor: async envelope => {
      assert.equal(JSON.stringify(envelope).includes(source), false);
      if (!present) throw Error('Synthetic departed member'); return actor;
    } }, discord: { guildId: GUILD, observe: async () => observation }, store: {
      beginCaseForm: async input => { forms.push(input); return { form: syntheticCaseForm(input.caseType), token: 'a'.repeat(48) }; },
    } });
  const fixture = await setup({ caseIntake, enabled: () => enabled });
  const click = customId => fixture.request(fixture.signed.payload({ type: 3,
    message: { id: '777777777777777777', content: source }, data: { component_type: 2, custom_id: customId } }));
  try {
    const contact = contactStaffControl().components[0].custom_id;
    const chooser = await (await click(contact)).json();
    assert.equal(chooser.type, 4); assert.equal(chooser.data.flags, 64); assert.deepEqual(chooser.data.allowed_mentions, { parse: [] });
    const buttons = chooser.data.components.flatMap(row => row.components); assert.equal(buttons.length, 6);
    assert.equal(forms.length, 0); assert.equal(JSON.stringify(chooser).includes(source), false);
    const category = buttons.find(button => button.custom_id.endsWith(':admin-help')).custom_id;
    present = false;
    assert.equal((await (await click(contact)).json()).data.components, undefined);
    assert.equal((await (await click(category)).json()).type, 4); assert.equal(forms.length, 0);
    present = true;
    const modal = await (await click(category)).json(); assert.equal(modal.type, 9); assert.equal(forms.length, 1);
    for (const field of modal.data.components) {
      assert.equal(field.component.value, undefined); assert.equal(field.component.values, undefined);
      assert.equal(field.component.options?.some(option => option.default === true) ?? false, false);
    }
    assert.equal(JSON.stringify(modal).includes(source), false);
    assert.deepEqual(Object.keys(forms[0]).sort(), ['actor', 'caseType', 'interactionId', 'isCurrent', 'observation', 'subjectId']);
    assert.equal(forms[0].actor, actor); assert.equal(forms[0].observation, observation); assert.equal(forms[0].subjectId, null);
    enabled = false; assert.equal((await (await click(contact)).json()).data.components, undefined);
    assert.deepEqual(fixture.calls, []); assert.deepEqual(fixture.replies, []); assert.deepEqual(fixture.faults, []);
  } finally { await fixture.server.close(); }
});

test('T26 slow availability or membership cannot deliver a late Contact staff chooser', async () => {
  for (const delayed of ['availability', 'membership']) {
    let release;
    const pending = new Promise(resolve => { release = resolve; });
    const enabled = async () => { if (delayed === 'availability') await pending; return true; };
    const caseIntake = createCaseIntake({ enabled, verifier: { takeCaseFormSubmission() {} },
      authorization: { resolveActor: async () => { if (delayed === 'membership') await pending; return {}; } }, discord: { guildId: GUILD } });
    const fixture = await setup({ caseIntake, enabled, initialBudgetMs: 50 });
    try {
      const response = await fixture.request(fixture.signed.payload({ type: 3, message: { id: '777777777777777777' },
        data: { component_type: 2, custom_id: contactStaffControl().components[0].custom_id } }));
      const body = await response.json(); assert.equal(body.type, 4); assert.equal(body.data.flags, 64); assert.equal(body.data.components, undefined);
      release(); await fixture.server.drain();
      assert.deepEqual(fixture.calls, []); assert.deepEqual(fixture.replies, []); assert.deepEqual(fixture.faults, []);
    } finally { release(); await fixture.server.close(); }
  }
});

test('Shuttle panel preserves disabled-before-busy ordering and readiness outage reporting', async () => {
  let release, mode = 'enabled', panels = 0;
  const pending = new Promise(resolve => { release = resolve; });
  const fixture = await setup({ commands: { execute: () => pending },
    enabled: () => { if (mode === 'outage') throw Error('Synthetic readiness outage'); return mode === 'enabled'; },
    onboardingPanel: { prepare: async () => { panels++; return {}; } } });
  const panel = () => fixture.request(fixture.signed.payload({ data: { type: 1, name: 'whitelist', options: [{ type: 1, name: 'panel' }] } }));
  try {
    assert.equal((await (await fixture.request()).json()).type, 5);
    mode = 'disabled'; const disabled = await (await panel()).json();
    assert.equal(disabled.type, 4); assert.match(disabled.data.content, /disabled/);
    mode = 'outage'; assert.equal((await panel()).status, 503);
    assert.equal(panels, 0); assert.deepEqual(fixture.faults, ['INTERACTION_TRANSPORT_INVALID']);
  } finally { release('recorded'); await fixture.server.close(); }
});
