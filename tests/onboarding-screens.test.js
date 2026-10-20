import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { validatePublication, parseOnboardingControl, renderOnboardingScreen, validateOnboardingPayload, canonicalPublication, onboardingStepMessages,
  renderOnboardingContent, renderOnboardingStatus, renderOnboardingNav, renderOnboardingOpening, validateOnboardingContentPayload, validateOnboardingStatusPayload,
  validateOnboardingNavPayload, validateOnboardingPart } from '../modules/onboarding/screens.js';
import { canonicalOnboardingDraft, reviewOnboardingDraft } from '../modules/onboarding/authoring.js';
import { simulatedOnboarding } from './fixtures/onboarding.js';
import { publication, started, NOW, OTHER } from './fixtures/domain.js';
import { casePlan, casePolicy } from './fixtures/cases.js';
import { caseChannelPayload } from '../modules/tickets/channel-policy.js';
import { syntheticInteractions } from './fixtures/interactions.js';

const screenId = '1234567890abcdef'.repeat(2);

test('explicit screens render one card with next/back until final acknowledgement; legacy copy remains unchanged', () => {
  const configured = structuredClone(publication), stage = configured.stages[0];
  stage.screens = ['**First** synthetic screen.', 'Second synthetic screen.']; stage.body = stage.screens.join('\n\n');
  const session = { ...started(), screenIndex: 0 };
  const first = renderOnboardingScreen({ screenId, session, publication: configured });
  assert.equal(first.embeds.length, 1); assert.equal(first.embeds[0].description, stage.screens[0]);
  assert.equal(parseOnboardingControl(first.components[0].components[0].custom_id).action, 'next-screen');
  const last = renderOnboardingScreen({ screenId, session: { ...session, screenIndex: 1 }, publication: configured });
  assert.equal(last.components[0].components[0].label, 'Acknowledge & continue');
  assert.equal(parseOnboardingControl(last.components[0].components[1].custom_id).action, 'previous-screen');
  assert.throws(() => validatePublication({ ...configured, stages: [{ ...stage, screens: ['Different copy'] }] }), /SHUTTLE_SCREENS_MISMATCH/);
  assert.throws(() => renderOnboardingScreen({ screenId, session: started(), publication: configured }), /INVALID_SESSION_PROGRESS/);
});

test('variable journeys render their actual count and final control without assuming five steps', () => {
  for (const count of [1, 3, 20]) {
    const configured = { ...publication, stages: Array.from({ length: count }, (_, i) => ({ id: `step-${i}`, title: `Step ${i}`, body: 'Synthetic guidance.' })) };
    const session = { ...started(), stepIndex: count - 1 };
    const final = renderOnboardingScreen({ screenId, session, publication: configured });
    assert.match(final.embeds[0].title, new RegExp(`Page ${count} of ${count}`));
    assert.equal(final.components[0].components[0].label, 'Complete Shuttle');
    assert.throws(() => renderOnboardingScreen({ screenId, session: { ...session, stepIndex: count }, publication: configured }), /INVALID_INTEGER/);
    if (count > 1) {
      const first = renderOnboardingScreen({ screenId, session: { ...session, stepIndex: 0 }, publication: configured });
      assert.equal(first.components[0].components[0].label, 'Continue');
      assert.throws(() => renderOnboardingScreen({ screenId, session: { ...session, stepIndex: 0, status: 'complete' }, publication: configured }), /INVALID_SESSION_PROGRESS/);
    }
  }
});
test('published static screens preserve stage copy and expose only bounded versioned controls', () => {
  const session = started();
  for (let stepIndex = 0; stepIndex < 5; stepIndex++) {
    const body = renderOnboardingScreen({ screenId, session: { ...session, stepIndex }, publication });
    assert.equal(body.embeds[0].description, publication.stages[stepIndex].body);
    assert.deepEqual(body.allowed_mentions, { parse: [] });
    for (const button of body.components[0].components) {
      assert.ok(button.custom_id.length <= 100);
      assert.equal(parseOnboardingControl(button.custom_id).screenId, screenId);
    }
    assert.equal(body.components[0].components.find(button => button.label === 'Back').disabled, stepIndex === 0);
  }
  const retired = renderOnboardingScreen({ screenId, session, publication, retired: true });
  assert.ok(retired.components[0].components.every(button => button.disabled)); assert.match(retired.embeds[0].description, /journey has ended/);
  assert.ok(retired.embeds.every(embed => embed.footer === undefined));
  const pending = renderOnboardingScreen({ screenId, session: { ...session, stepIndex: publication.stages.length - 1, status: 'role_pending' }, publication });
  assert.doesNotMatch(pending.embeds[0].description, /role was confirmed/);
});

test('draft source, invalid pause rules and oversized copy cannot be published or sent', async () => {
  const draft = JSON.parse(await readFile(new URL('../content/onboarding/definition.json', import.meta.url), 'utf8'));
  assert.throws(() => validatePublication(draft), /INVALID_FIELDS/);
  validatePublication({ id: draft.id, version: draft.version, helpPauses: false,
    stages: draft.stages.map(({ id, title, body }) => ({ id, title, body })) });
  validatePublication({ ...publication, helpPauses: true });
  assert.throws(() => validatePublication({ ...publication, helpPauses: 'true' }), /SHUTTLE_HELP_MODE_UNSUPPORTED/);
  assert.throws(() => validatePublication({ ...publication, stages: publication.stages.map(stage => ({ ...stage, body: 'x'.repeat(5_001) })) }), /INVALID_STATIC_COPY/);
  const body = renderOnboardingScreen({ screenId, session: started(), publication });
  assert.throws(() => validateOnboardingPayload({ ...body, allowed_mentions: { parse: ['everyone'] } }, screenId), /INVALID_SHUTTLE_PAYLOAD/);
  assert.throws(() => parseOnboardingControl(`sophie:shuttle:v1:${screenId}:sql`), /INTERACTION_COMPONENT_UNSUPPORTED/);
});

test('signed stage controls retain routing metadata without granting authority from a component ID', () => {
  const identities = syntheticInteractions();
  const proof = identities.mint({ type: 3, message: { id: OTHER, content: 'Ignored synthetic placeholder' },
    data: { component_type: 2, custom_id: `sophie:shuttle:v1:${screenId}:advance` } });
  assert.equal(proof.command, 'shuttle.control'); assert.equal(proof.screenId, screenId);
  assert.equal(proof.action, 'advance'); assert.equal(proof.messageId, OTHER); assert.equal(Object.hasOwn(proof, 'content'), false);
  assert.throws(() => identities.verifier.resolvePrincipal({ ...proof }), /UNTRUSTED_PRINCIPAL/);
});

test('only observed own messages can confirm screens; stale authentic receipts retain IDs without authority', async () => {
  let now = NOW, continuity = 'screen-test-1';
  const discord = simulatedOnboarding({ clock: () => now, readContinuity: () => continuity });
  const plan = { ...casePlan, type: 'shuttle' }, channelId = OTHER;
  discord.state.channels.set(channelId, { ...caseChannelPayload(plan, casePolicy, false), id: channelId, guild_id: plan.guildId });
  const payload = renderOnboardingStatus({ session: started(), publication });
  const expected = { plan, channelId, screenId, kind: 'status', payload };
  const preparation = await discord.messages.prepare(plan, channelId, false);
  // The single-message format sent before message groups can be recognised, never sent.
  await assert.rejects(discord.messages.create(preparation, { ...expected, kind: 'screen', payload: renderOnboardingScreen({ screenId, session: started(), publication }) }), /INVALID_SHUTTLE_PAYLOAD/);
  const proof = await discord.messages.create(preparation, expected);
  assert.equal(await discord.messages.verification.matches(proof, expected), true);
  await assert.rejects(discord.messages.verification.candidate({ ...proof }, expected), /SHUTTLE_MESSAGE_UNTRUSTED/);
  await assert.rejects(discord.messages.create(preparation, expected), /SHUTTLE_MESSAGE_UNTRUSTED/);
  continuity = 'screen-test-2';
  await assert.rejects(discord.messages.verification.candidate(proof, expected), /OBSERVATION_INVALIDATED/);
  now += 6_000;
  assert.equal(discord.messages.verification.receipt(proof, expected).messageId, proof.messageId);
  await assert.rejects(discord.messages.verification.candidate(proof, expected), /MEMBERSHIP_STALE/);
});

test('message groups: shared preparations, write-response confirmation, deletion and missing messages', async () => {
  let now = NOW, continuity = 'group-1', boundary = 'boundary-1';
  const discord = simulatedOnboarding({ clock: () => now, readContinuity: () => continuity, readBoundary: async () => boundary });
  const plan = { ...casePlan, type: 'shuttle' }, channelId = OTHER;
  discord.state.channels.set(channelId, { ...caseChannelPayload(plan, casePolicy, false), id: channelId, guild_id: plan.guildId });
  const reads = () => discord.state.calls.filter(call => call.method === 'GET').length;
  const first = await discord.messages.prepare(plan, channelId, false, false, { share: true });
  const before = reads();
  // Other Gateway traffic (here: the next dispatch) does not repeat role, member or channel reads.
  continuity = 'group-2'; now += 500;
  const second = await discord.messages.prepare(plan, channelId, false, false, { share: true });
  assert.equal(reads(), before); assert.equal(second.observation.observedAt, first.observation.observedAt);
  const configured = structuredClone(publication); configured.stages[0].screens = ['See https://example.test', 'Second']; configured.stages[0].body = 'See https://example.test\n\nSecond';
  configured.stages[0].linkPreviews = [true, false];
  const [shown, quiet] = onboardingStepMessages(configured, 0).map(renderOnboardingContent);
  const partId = 'ab'.repeat(16), part = { plan, channelId, screenId, recordId: partId, kind: 'content', payload: shown };
  const created = await discord.messages.create(second, part);
  // Discord's event for that post moves continuity on; the response is still confirmed while authority is unchanged.
  continuity = 'group-3';
  await assert.rejects(discord.messages.verification.candidate(created, part), /OBSERVATION_INVALIDATED/);
  assert.equal(await discord.messages.verification.matches(created, part, { fromWrite: true }), true);
  // Link previews Discord attaches later are not part of what was written.
  discord.state.messages.get(created.messageId).embeds = [{ type: 'link', url: 'https://example.test' }];
  const reread = await discord.messages.inspect({ ...part, messageId: created.messageId });
  assert.equal(await discord.messages.verification.matches(reread, part), true);
  assert.equal(await discord.messages.verification.matches(reread, { ...part, payload: quiet }), false);
  // An authority change ends both sharing and write-response confirmation.
  boundary = 'boundary-2';
  await assert.rejects(discord.messages.verification.written(created, part), /OBSERVATION_INVALIDATED/);
  const third = await discord.messages.prepare(plan, channelId, false, false, { share: true });
  assert.ok(reads() > before); assert.ok(third.observation.observedAt >= second.observation.observedAt);
  const removed = await discord.messages.remove(third, { ...part, messageId: created.messageId });
  assert.deepEqual([removed.messageId, removed.missing], [created.messageId, true]);
  assert.equal(discord.state.messages.has(created.messageId), false);
  // Deleting again, or editing a deleted message, reports it missing instead of failing.
  const again = await discord.messages.remove(await discord.messages.prepare(plan, channelId, true, false, { share: true }), { ...part, messageId: created.messageId });
  assert.equal(again.missing, true);
  const edited = await discord.messages.edit(await discord.messages.prepare(plan, channelId, false, false, { share: true }), { ...part, messageId: created.messageId, retired: false });
  assert.equal(edited.missing, true);
  // A read without sharing never re-uses earlier reads.
  const fresh = reads(); await discord.messages.prepare(plan, channelId, false); assert.ok(reads() > fresh);
});

test('message groups: the status card reports progress without controls, from fixed wording and stored state', () => {
  const session = started();
  const status = renderOnboardingStatus({ session: { ...session, stepIndex: 2 }, publication });
  validateOnboardingStatusPayload(status);
  assert.equal(status.components.length, 0); assert.deepEqual(status.allowed_mentions, { parse: [] });
  const lines = status.embeds[0].description.split('\n');
  assert.match(lines[0], /^✅ 1\. Synthetic page 1$/); assert.match(lines[2], /\*\*3\. Synthetic page 3\*\* · reading now/);
  assert.match(lines[4], /^▫️ 5\./); assert.equal(lines.at(-1), '-# Whitelist: not requested yet');
  assert.match(renderOnboardingStatus({ session: { ...session, mode: 'refresh' }, publication }).embeds[0].description, /already active/);
  const last = publication.stages.length - 1;
  const pending = renderOnboardingStatus({ session: { ...session, stepIndex: last, status: 'role_pending', grantAccessEpoch: 1 }, publication });
  assert.ok(pending.embeds[0].description.split('\n').slice(0, 5).every(line => line.startsWith('✅')));
  assert.match(pending.embeds[0].description, /waiting for Discord to confirm/);
  assert.match(renderOnboardingStatus({ session: { ...session, stepIndex: last, status: 'complete' }, publication }).embeds[0].description, /Whitelist: confirmed/);
  assert.match(renderOnboardingStatus({ session, publication, retired: true }).embeds[0].description, /journey has ended/);
  // Requests and pauses recorded before Ask Staff was removed still show; nothing here can raise a new one.
  assert.match(renderOnboardingStatus({ session, publication, helpRequested: true }).embeds[0].description, /Staff have been asked/);
  assert.throws(() => validateOnboardingStatusPayload({ ...status, components: [{ type: 1, components: [] }] }), /INVALID_SHUTTLE_PAYLOAD/);
});

test('message groups: each step message is plain text with previews off unless the author turned them on', () => {
  const configured = structuredClone(publication), stage = configured.stages[1];
  stage.screens = ['First message https://example.test', 'Second message']; stage.body = stage.screens.join('\n\n');
  stage.linkPreviews = [false, true];
  const messages = onboardingStepMessages(configured, 1).map(renderOnboardingContent);
  assert.deepEqual(messages.map(message => [message.content, message.flags]), [[stage.screens[0], 4], [stage.screens[1], 0]]);
  for (const message of messages) {
    validateOnboardingContentPayload(message);
    assert.deepEqual([message.embeds, message.components, message.allowed_mentions], [[], [], { parse: [] }]);
  }
  // Unbroken copy is split deterministically; each segment is one message.
  const long = structuredClone(publication); long.stages[0].body = `${'a'.repeat(1_500)}\n\n${'b'.repeat(1_500)}`;
  assert.deepEqual(onboardingStepMessages(long, 0).map(message => message.content.length), [1_500, 1_500]);
  assert.throws(() => renderOnboardingContent({ content: 'x'.repeat(2_001), previews: false }), /INVALID_SHUTTLE_PAYLOAD/);
  assert.throws(() => validateOnboardingContentPayload({ ...messages[0], flags: 64 }), /INVALID_SHUTTLE_PAYLOAD/);
  assert.throws(() => validateOnboardingContentPayload({ ...messages[0], allowed_mentions: { parse: ['users'] } }), /INVALID_SHUTTLE_PAYLOAD/);
});

test('message groups: link previews publish only aligned with explicit messages, and all-off keeps existing hashes', () => {
  const configured = structuredClone(publication), stage = configured.stages[0];
  stage.screens = ['One', 'Two']; stage.body = 'One\n\nTwo';
  const unchanged = canonicalPublication(configured);
  assert.equal(Object.hasOwn(unchanged.stages[0], 'linkPreviews'), false);
  const withStage = changed => ({ ...configured, stages: [changed, ...configured.stages.slice(1)] });
  assert.throws(() => validatePublication(withStage({ ...stage, linkPreviews: [false, false] })), /INVALID_LINK_PREVIEWS/);
  assert.throws(() => validatePublication(withStage({ ...stage, linkPreviews: [true] })), /INVALID_LINK_PREVIEWS/);
  assert.throws(() => validatePublication({ ...publication, stages: [{ ...publication.stages[0], linkPreviews: [true] }, ...publication.stages.slice(1)] }), /INVALID_LINK_PREVIEWS/);
  assert.deepEqual(canonicalPublication(withStage({ ...stage, linkPreviews: [false, true] })).stages[0].linkPreviews, [false, true]);
  const draft = canonicalOnboardingDraft({ helpPauses: false, stages: [{ ...stage, linkPreviews: [false, false] }] });
  assert.equal(Object.hasOwn(draft.stages[0], 'linkPreviews'), false);
  const review = reviewOnboardingDraft('shuttle-v1', 2, { helpPauses: false, stages: [{ ...stage, linkPreviews: [false, true] }] });
  assert.equal(review.valid, true); assert.deepEqual(review.pages[0].previews, [false, true]);
});

test('message groups: the navigation card offers Back and Continue, Check completion when pending, and never Ask Staff', () => {
  const session = started(), last = publication.stages.length - 1;
  const first = renderOnboardingNav({ screenId, session, publication, controlVersion: 7 });
  validateOnboardingNavPayload(first, screenId);
  const buttons = first.components[0].components.map(button => ({ ...parseOnboardingControl(button.custom_id), label: button.label, disabled: button.disabled }));
  assert.deepEqual(buttons.map(button => [button.action, button.label, button.disabled, button.controlVersion]),
    [['back', 'Back', true, 7], ['advance', 'Continue', false, 7]]);
  assert.equal(first.embeds[0].title, 'Step 1 of 5 · Synthetic page 1'); assert.match(first.embeds[0].description, /open \*\*Synthetic page 2\*\*/);
  const final = renderOnboardingNav({ screenId, session: { ...session, stepIndex: last }, publication });
  assert.deepEqual(final.components[0].components.map(button => button.label), ['Back', 'Complete Shuttle']);
  const pending = renderOnboardingNav({ screenId, session: { ...session, stepIndex: last, status: 'role_pending', grantAccessEpoch: 1 }, publication });
  assert.deepEqual(pending.components[0].components.map(button => parseOnboardingControl(button.custom_id).action), ['retry']);
  assert.equal(renderOnboardingNav({ screenId, session: { ...session, stepIndex: last, status: 'complete' }, publication }).components.length, 0);
  const paused = renderOnboardingNav({ screenId, session: { ...session, stepIndex: 1, helpPaused: true }, publication: { ...publication, helpPauses: true } });
  assert.ok(paused.components[0].components.every(button => button.disabled)); assert.match(paused.embeds[0].description, /Staff have been asked/);
  const help = structuredClone(first); help.components[0].components.push({ ...help.components[0].components[0], label: 'Ask Staff',
    custom_id: `sophie:shuttle:v1:${screenId}:help:7` });
  assert.throws(() => validateOnboardingNavPayload(help, screenId), /INVALID_SHUTTLE_PAYLOAD/);
  assert.throws(() => validateOnboardingNavPayload(first, 'f'.repeat(32)), /INVALID_SHUTTLE_PAYLOAD/);
  assert.throws(() => validateOnboardingPart('alert', first, screenId), /INVALID_SHUTTLE_PAYLOAD/);
  const opening = renderOnboardingOpening({ screenId, controlVersion: 7 });
  assert.equal(opening.components[0].components[0].disabled, true); assert.equal(opening.components[0].components[0].label, 'Opening…');
});
