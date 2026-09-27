import test from 'node:test';
import assert from 'node:assert/strict';
import { observeMembership, setMuteIntent } from '../modules/membership/index.js';
import { advanceOnboarding, backOnboarding, confirmWhitelist, requireGrantDelivery, retryWhitelist, startOnboarding, nextOnboardingScreen, previousOnboardingScreen } from '../modules/onboarding/index.js';

test('T13/T14 screens require ordered navigation before acknowledgement and retain pause/version fences', () => {
  const current = member(), configured = { ...definition, stepIds: ['first', 'last'], screenCounts: [2, 3] };
  let session = startOnboarding({ id: 'screens', nonce: 'initial', member: current, definition: configured, now: NOW });
  assert.throws(() => advanceOnboarding(session, current, configured, command(session), NOW), /SHUTTLE_SCREENS_UNREAD/);
  const old = command(session);
  session = nextOnboardingScreen(session, current, configured, old, NOW).session;
  assert.equal(session.stepIndex, 0); assert.equal(session.screenIndex, 1);
  assert.throws(() => nextOnboardingScreen(session, current, configured, old, NOW), /NONCE_NOT_ROTATED/);
  assert.throws(() => nextOnboardingScreen(session, current, configured, command(session), NOW), /SCREEN_NAVIGATION_UNAVAILABLE/);
  session = advanceOnboarding(session, current, configured, command(session), NOW).session;
  assert.equal(session.stepIndex, 1); assert.equal(session.screenIndex, 0);
  session = backOnboarding(session, current, configured, command(session), NOW).session;
  assert.equal(session.stepIndex, 0); assert.equal(session.screenIndex, 1);
  session = previousOnboardingScreen(session, current, configured, command(session), NOW).session;
  assert.equal(session.screenIndex, 0);
  assert.throws(() => nextOnboardingScreen({ ...session, helpPaused: true }, current, configured, command(session), NOW), /SHUTTLE_PAUSED/);
  for (const transition of [nextOnboardingScreen, advanceOnboarding, nextOnboardingScreen, nextOnboardingScreen]) session = transition(session, current, configured, command(session), NOW).session;
  const outcome = advanceOnboarding(session, current, configured, command(session), NOW);
  assert.equal(outcome.session.status, 'role_pending'); assert.equal(outcome.effects.length, 1);
  assert.throws(() => requireGrantDelivery({ ...outcome.session, screenIndex: 0 }, current, outcome.effects[0], configured, NOW), /INVALID_SESSION_PROGRESS/);
});
import { NOW, OTHER, command, completedReading, definition, member, observation, started } from './fixtures/domain.js';

test('T13 five explicit transitions produce one pending intent, not a success claim', () => {
  const current = member();
  const outcome = completedReading(current);
  assert.equal(outcome.session.status, 'role_pending');
  assert.equal(outcome.session.version, 5);
  assert.equal(outcome.effects.length, 1);
  assert.throws(() => confirmWhitelist(outcome.session, current, outcome.effects[0], definition, NOW), { code: 'ROLE_NOT_CONFIRMED' });
  const observed = observeMembership(current, observation({ whitelist: true }), NOW);
  const confirmed = confirmWhitelist(outcome.session, observed, outcome.effects[0], definition, NOW);
  assert.equal(confirmed.status, 'complete');
  assert.throws(() => requireGrantDelivery(confirmed, observed, outcome.effects[0], definition, NOW), { code: 'GRANT_MISMATCH' });
});

test('T13/T14 configurable step counts complete only at the pinned final step', () => {
  for (const count of [1, 3, 8, 20]) {
    const current = member(), configured = { ...definition, stepIds: Array.from({ length: count }, (_, i) => `step-${i}`) };
    let session = startOnboarding({ id: 'variable', nonce: 'initial', member: current, definition: configured, now: NOW });
    let outcome;
    for (let i = 0; i < count; i++) {
      outcome = advanceOnboarding(session, current, configured, command(session), NOW);
      assert.equal(outcome.effects.length, i === count - 1 ? 1 : 0);
      session = outcome.session;
    }
    assert.equal(session.stepIndex, count - 1); assert.equal(session.status, 'role_pending');
    assert.doesNotThrow(() => requireGrantDelivery(session, current, outcome.effects[0], configured, NOW));
    if (count > 1) assert.throws(() => requireGrantDelivery({ ...session, stepIndex: count - 2 }, current, outcome.effects[0], configured, NOW), /INVALID_SESSION_PROGRESS/);
    assert.throws(() => requireGrantDelivery(session, current, outcome.effects[0], { ...configured, version: 2 }, NOW), /DEFINITION_MISMATCH/);
    const observed = observeMembership(current, observation({ whitelist: true }), NOW);
    assert.equal(confirmWhitelist(session, observed, outcome.effects[0], configured, NOW).status, 'complete');
  }
  assert.throws(() => started(member(), { ...definition, stepIds: Array.from({ length: 21 }, (_, i) => `step-${i}`) }), /INVALID_SHUTTLE_STEPS/);
});

test('T13/T14 repeated, stale and foreign controls cannot advance current state', () => {
  const current = member();
  const initial = started(current);
  const action = command(initial);
  const next = advanceOnboarding(initial, current, definition, action, NOW).session;
  assert.equal(initial.stepIndex, 0);
  assert.equal(next.stepIndex, 1);
  assert.throws(() => advanceOnboarding(next, current, definition, action, NOW), { code: 'NONCE_NOT_ROTATED' });
  assert.throws(() => advanceOnboarding(next, current, definition, command(next, { expectedVersion: 0 }), NOW), { code: 'STALE_SHUTTLE_CONTROL' });
  assert.throws(() => advanceOnboarding(next, current, definition, command(next, { userId: OTHER }), NOW), { code: 'FOREIGN_SHUTTLE_CONTROL' });
});

test('T14 Back is a versioned transition and never retracts a delivered role', () => {
  const current = member();
  const initial = started(current);
  assert.throws(() => backOnboarding(initial, current, definition, command(initial), NOW), { code: 'BACK_UNAVAILABLE' });
  const next = advanceOnboarding(initial, current, definition, command(initial), NOW).session;
  const back = backOnboarding(next, current, definition, command(next), NOW);
  assert.equal(back.session.stepIndex, 0);
  assert.deepEqual(back.effects, []);
  const refresh = completedReading(member({ whitelist: true })).session;
  assert.throws(() => backOnboarding(refresh, member({ whitelist: true }), definition, command(refresh), NOW), { code: 'BACK_UNAVAILABLE' });
});

test('T19 sessions stay pinned and withdrawn definitions cannot complete or deliver', () => {
  const current = member();
  const session = started(current);
  assert.throws(() => advanceOnboarding(session, current, { ...definition, version: 2 }, command(session), NOW), { code: 'DEFINITION_MISMATCH' });
  const withdrawn = { ...definition, status: 'withdrawn' };
  assert.throws(() => advanceOnboarding(session, current, withdrawn, command(session), NOW), { code: 'DEFINITION_WITHDRAWN' });
  const pending = completedReading(current);
  assert.throws(() => requireGrantDelivery(pending.session, current, pending.effects[0], withdrawn, NOW), { code: 'DEFINITION_WITHDRAWN' });
});

test('T55 refresh visits use the latest published definition without role writes', () => {
  const current = member({ whitelist: true });
  const latest = { ...definition, id: 'shuttle-v2', version: 2 };
  const outcome = completedReading(current, latest);
  assert.equal(outcome.session.mode, 'refresh');
  assert.equal(outcome.session.definitionVersion, 2);
  assert.equal(outcome.session.status, 'complete');
  assert.deepEqual(outcome.effects, []);
  assert.equal(current.observation.whitelist, true);
  const repeat = started(current, latest, 'session-repeat');
  assert.equal(repeat.stepIndex, 0);
  assert.equal(outcome.session.status, 'complete');
});

test('T54 Whitelist loss during a refresh requires all five steps again', () => {
  const original = member({ whitelist: true });
  const refresh = started(original);
  const lost = observeMembership(original, observation(), NOW);
  assert.throws(() => advanceOnboarding(refresh, lost, definition, command(refresh), NOW), { code: 'SHUTTLE_RESTART_REQUIRED' });
  const fresh = completedReading(lost);
  assert.equal(fresh.session.mode, 'qualification');
  assert.equal(fresh.effects[0].eligibilityEpoch, lost.eligibilityEpoch);
});

test('T18/T54 leaving invalidates queued grants even after rejoining', () => {
  const current = member();
  const pending = completedReading(current);
  const left = observeMembership(current, observation({ present: false, crew: false }), NOW);
  assert.throws(() => requireGrantDelivery(pending.session, left, pending.effects[0], definition, NOW), { code: 'NOT_IN_GUILD' });
  const rejoined = observeMembership(left, observation(), NOW);
  assert.throws(() => requireGrantDelivery(pending.session, rejoined, pending.effects[0], definition, NOW), { code: 'SHUTTLE_RESTART_REQUIRED' });
});

test('T53 a mute blocks reading/completion and a pending grant immediately', () => {
  const current = member();
  const initial = started(current);
  const pending = completedReading(current);
  const muted = setMuteIntent(current, true, current.version);
  assert.throws(() => advanceOnboarding(initial, muted, definition, command(initial), NOW), { code: 'MEMBER_MUZZLED' });
  assert.throws(() => requireGrantDelivery(pending.session, muted, pending.effects[0], definition, NOW), { code: 'MEMBER_MUZZLED' });
  const unmuted = setMuteIntent(muted, false, muted.version);
  assert.throws(() => requireGrantDelivery(pending.session, unmuted, pending.effects[0], definition, NOW), { code: 'STALE_GRANT' });
  const retry = retryWhitelist(pending.session, unmuted, definition, command(pending.session), NOW);
  assert.notEqual(retry.effects[0].operationId, pending.effects[0].operationId);
  assert.doesNotThrow(() => requireGrantDelivery(retry.session, unmuted, retry.effects[0], definition, NOW));
  assert.equal(advanceOnboarding(initial, unmuted, definition, command(initial), NOW).session.stepIndex, 1);
});

test('T18 a late successful external role observation cannot confirm a muted grant', () => {
  const current = member();
  const pending = completedReading(current);
  const late = observeMembership(current, observation({ whitelist: true, muzzled: true }), NOW);
  assert.throws(() => confirmWhitelist(pending.session, late, pending.effects[0], definition, NOW), { code: 'MEMBER_MUZZLED' });
  assert.equal(pending.session.status, 'role_pending');
});

test('T01/T14 stale membership, absent members, malformed definitions and mismatched effects fail closed', () => {
  const current = member();
  assert.throws(() => startOnboarding({ id: 'x', nonce: 'n', member: current, definition, now: NOW + 5_001 }), { code: 'MEMBERSHIP_STALE' });
  assert.throws(() => started(member({ present: false, crew: false })), { code: 'NOT_IN_GUILD' });
  assert.throws(() => started(current, { ...definition, stepIds: [] }), { code: 'INVALID_SHUTTLE_STEPS' });
  const pending = completedReading(current);
  assert.throws(() => requireGrantDelivery(pending.session, current, { ...pending.effects[0], userId: OTHER }, definition, NOW), { code: 'MEMBER_MISMATCH' });
});

test('T14 inconsistent persisted progress cannot become a role grant', () => {
  const current = member();
  const pending = completedReading(current);
  assert.throws(() => requireGrantDelivery({ ...pending.session, stepIndex: 0 }, current, pending.effects[0], definition, NOW), { code: 'INVALID_SESSION_PROGRESS' });
  assert.throws(() => requireGrantDelivery({ ...pending.session, grantAccessEpoch: null }, current, pending.effects[0], definition, NOW), { code: 'INVALID_GRANT_STATE' });
});
