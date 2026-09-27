import test from 'node:test';
import assert from 'node:assert/strict';
import { advanceOnboarding, backOnboarding, retryWhitelist, pauseOnboarding, resumeOnboarding, requireGrantDelivery } from '../modules/onboarding/index.js';
import { renderOnboardingScreen } from '../modules/onboarding/screens.js';
import { member, started, completedReading, command, definition, publication, NOW } from './fixtures/domain.js';

test('a help pause freezes all member transitions and resumption rotates controls without advancing', () => {
  const current = member(), initial = advanceOnboarding(started(), current, definition, command(started()), NOW).session;
  const paused = pauseOnboarding(initial, current, definition, command(initial), NOW).session;
  assert.equal(paused.helpPaused, true); assert.equal(paused.stepIndex, initial.stepIndex); assert.equal(paused.version, initial.version + 1);
  for (const transition of [advanceOnboarding, backOnboarding, retryWhitelist]) {
    assert.throws(() => transition(paused, current, definition, command(paused), NOW), /SHUTTLE_PAUSED/);
  }
  const resumed = resumeOnboarding(paused, current, definition, command(paused), NOW);
  assert.equal(resumed.session.helpPaused, false); assert.equal(resumed.session.stepIndex, initial.stepIndex); assert.deepEqual(resumed.effects, []);
  assert.notEqual(resumed.session.nonce, paused.nonce);
  assert.throws(() => resumeOnboarding(paused, member({ muzzled: true }), definition, command(paused), NOW), /MEMBER_MUZZLED/);
});

test('pausing pending delivery removes its grant intent and resumption requires a fresh final acknowledgement', () => {
  const current = member(), pending = completedReading(), oldEffect = pending.effects[0];
  const paused = pauseOnboarding(pending.session, current, definition, command(pending.session), NOW).session;
  assert.equal(paused.status, 'active'); assert.equal(paused.stepIndex, 4); assert.equal(paused.grantAccessEpoch, null);
  assert.throws(() => requireGrantDelivery(paused, current, oldEffect, definition, NOW), /SHUTTLE_PAUSED/);
  const resumed = resumeOnboarding(paused, current, definition, command(paused), NOW);
  assert.deepEqual(resumed.effects, []); assert.equal(resumed.session.status, 'active');
  assert.throws(() => requireGrantDelivery(resumed.session, current, oldEffect, definition, NOW));
  const acknowledged = advanceOnboarding(resumed.session, current, definition, command(resumed.session), NOW);
  assert.equal(acknowledged.session.status, 'role_pending'); assert.notEqual(acknowledged.effects[0].operationId, oldEffect.operationId);
  requireGrantDelivery(acknowledged.session, current, acknowledged.effects[0], definition, NOW);
});

test('a paused screen identifies Staff assistance and disables both progress controls', () => {
  const session = pauseOnboarding(started(), member(), definition, command(started()), NOW).session;
  const payload = renderOnboardingScreen({ screenId: 'a'.repeat(32), session, publication: { ...publication, helpPauses: true }, helpRequested: true });
  assert.deepEqual(payload.components[0].components.map(button => button.disabled), [true, true, false]);
  assert.match(payload.embeds.at(-1).description, /Staff have been asked to help.*when you can continue/);
  assert.throws(() => renderOnboardingScreen({ screenId: 'a'.repeat(32), session, publication }), /INVALID_SHUTTLE_PAUSE/);
});
