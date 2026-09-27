import test from 'node:test';
import assert from 'node:assert/strict';
import { observeMembership, planCrewChange, planMemberChange, requireOnboardingEligibility, setMuteIntent } from '../modules/membership/index.js';
import { NOW, member, observation } from './fixtures/domain.js';

test('T53 Crew is applied on join without becoming an admission prerequisite', () => {
  const current = member({ crew: false });
  assert.equal(planCrewChange(current, NOW), 'add_crew');
  assert.doesNotThrow(() => requireOnboardingEligibility(current, NOW));
});

test('T53 Muzzled removes Crew and blocks eligibility', () => {
  const current = member({ crew: true, muzzled: true });
  assert.equal(planCrewChange(current, NOW), 'remove_crew');
  assert.throws(() => requireOnboardingEligibility(current, NOW), { code: 'MEMBER_MUZZLED' });
  assert.equal(planCrewChange(member({ crew: false, muzzled: true }), NOW), 'none');
});

test('T53 a durable mute request blocks Crew before the external role arrives', () => {
  const current = member({ crew: false });
  const muting = setMuteIntent(current, true, current.version);
  assert.equal(planCrewChange(muting, NOW), 'none');
  assert.throws(() => requireOnboardingEligibility(muting, NOW), { code: 'MEMBER_MUZZLED' });
  assert.equal(muting.eligibilityEpoch, current.eligibilityEpoch);
  assert.equal(muting.accessEpoch, current.accessEpoch + 1);
});

test('T53 an unmute intent cannot beat a currently observed Muzzled role', () => {
  const current = member({ crew: false, muzzled: true });
  const unmuting = setMuteIntent(current, false, current.version);
  assert.equal(planCrewChange(unmuting, NOW), 'none');
  const confirmed = observeMembership(unmuting, observation({ crew: false }), NOW);
  assert.equal(planCrewChange(confirmed, NOW), 'add_crew');
});

test('T53 moderation plans remove Crew first and confirm unmute before restoring it', () => {
  let current = member();
  current = setMuteIntent(current, true, current.version);
  assert.equal(planMemberChange(current, true, NOW), 'remove_crew');
  current = observeMembership(current, observation({ crew: false }), NOW);
  assert.equal(planMemberChange(current, true, NOW), 'add_muzzled');
  current = observeMembership(current, observation({ crew: false, muzzled: true }), NOW);
  assert.equal(planMemberChange(current, true, NOW), 'none');
  assert.equal(planMemberChange(current, false, NOW), 'remove_muzzled');
  current = observeMembership(current, observation({ crew: false }), NOW);
  assert.equal(planMemberChange(current, false, NOW), 'confirm_unmute');
  assert.equal(planMemberChange(current, null, NOW), 'none');
  current = setMuteIntent(current, false, current.version);
  assert.equal(planMemberChange(current, null, NOW), 'add_crew');
});

test('T54 loss and rejoin invalidate prior completion exactly once per observed loss', () => {
  const current = member({ whitelist: true });
  const lost = observeMembership(current, observation(), NOW);
  const repeated = observeMembership(lost, observation(), NOW);
  assert.equal(lost.eligibilityEpoch, current.eligibilityEpoch + 1);
  assert.equal(repeated.eligibilityEpoch, lost.eligibilityEpoch);
  const left = observeMembership(repeated, observation({ present: false, crew: false }), NOW);
  assert.equal(planCrewChange(left, NOW), 'none');
  assert.throws(() => requireOnboardingEligibility(left, NOW), { code: 'NOT_IN_GUILD' });
  const rejoined = observeMembership(left, observation({ crew: false }), NOW);
  assert.equal(rejoined.eligibilityEpoch, left.eligibilityEpoch);
  assert.equal(planCrewChange(rejoined, NOW), 'add_crew');
  assert.equal(rejoined.observation.whitelist, false);
});

test('T20 unknown, old and out-of-order observations cannot erase known roles', () => {
  const current = member({ whitelist: true });
  assert.throws(() => observeMembership(current, observation({ known: false }), NOW), { code: 'MEMBERSHIP_UNKNOWN' });
  assert.throws(() => observeMembership(current, observation({ observedAt: NOW - 6_000 }), NOW), { code: 'MEMBERSHIP_STALE' });
  assert.throws(() => observeMembership(current, observation({ observedAt: NOW - 1 }), NOW), { code: 'OBSERVATION_OUT_OF_ORDER' });
  assert.equal(current.observation.whitelist, true);
});

test('T53 stale moderator writes and foreign membership observations are rejected', () => {
  const current = member();
  assert.throws(() => setMuteIntent(current, true, current.version - 1), { code: 'MEMBER_VERSION_CONFLICT' });
  assert.throws(() => observeMembership(current, observation({ userId: '9' }), NOW), { code: 'MEMBER_MISMATCH' });
});

test('T01 corrupted persisted membership cannot borrow another member\'s eligibility', () => {
  const current = member();
  const corrupted = { ...current, observation: { ...current.observation, userId: '9' } };
  assert.throws(() => requireOnboardingEligibility(corrupted, NOW), { code: 'MEMBER_MISMATCH' });
  assert.throws(() => planCrewChange(corrupted, NOW), { code: 'MEMBER_MISMATCH' });
  assert.throws(() => requireOnboardingEligibility({ ...current, observation: { ...current.observation, muzzled: 'false' } }, NOW), { code: 'INVALID_ROLE_STATE' });
});
