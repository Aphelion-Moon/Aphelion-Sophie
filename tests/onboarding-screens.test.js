import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { validatePublication, parseOnboardingControl, renderOnboardingScreen, validateOnboardingPayload } from '../modules/onboarding/screens.js';
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
  const payload = renderOnboardingScreen({ screenId, session: started(), publication });
  const expected = { plan, channelId, screenId, payload };
  const preparation = await discord.messages.prepare(plan, channelId, false);
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
