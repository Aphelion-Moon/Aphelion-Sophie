import { requireCondition, requireFreshObservation, requireId, requireInteger, requireKeys } from '../../contracts/validation.js';

/** @typedef {{guildId: string, userId: string, known: boolean, observedAt: number, present: boolean, crew: boolean, muzzled: boolean, whitelist: boolean}} MemberObservation */

export function createMembership(guildId, userId) {
  requireId(guildId);
  requireId(userId);
  return { guildId, userId, version: 0, eligibilityEpoch: 0, presenceEpoch: 0, accessEpoch: 0, muteRequested: false, observation: null };
}

function validateObservation(observation, member) {
  requireKeys(observation, ['guildId', 'userId', 'known', 'observedAt', 'present', 'crew', 'muzzled', 'whitelist']);
  requireCondition(observation.guildId === member.guildId && observation.userId === member.userId, 'MEMBER_MISMATCH');
  requireInteger(observation.observedAt);
  for (const key of ['known', 'present', 'crew', 'muzzled', 'whitelist']) requireCondition(typeof observation[key] === 'boolean', 'INVALID_ROLE_STATE');
  requireCondition(observation.present || (!observation.crew && !observation.muzzled && !observation.whitelist), 'ABSENT_MEMBER_HAS_ROLES');
}

export function validateMembership(member) {
  requireKeys(member, ['guildId', 'userId', 'version', 'eligibilityEpoch', 'presenceEpoch', 'accessEpoch', 'muteRequested', 'observation']);
  requireId(member.guildId);
  requireId(member.userId);
  for (const key of ['version', 'eligibilityEpoch', 'presenceEpoch', 'accessEpoch']) requireInteger(member[key]);
  requireCondition(typeof member.muteRequested === 'boolean', 'INVALID_MUTE_STATE');
  if (member.observation !== null) validateObservation(member.observation, member);
}

/** Revocation evidence may invalidate prior work without pretending it is a current role snapshot. */
export function invalidateMembership(member, { eligibility, access, presence }) {
  validateMembership(member);
  for (const flag of [eligibility, access, presence]) requireCondition(typeof flag === 'boolean', 'INVALID_REVOCATION');
  requireCondition((!presence || eligibility) && (!eligibility || access), 'INVALID_REVOCATION');
  const next = { ...member, version: member.version + 1, eligibilityEpoch: member.eligibilityEpoch + Number(eligibility),
    accessEpoch: member.accessEpoch + Number(access), presenceEpoch: member.presenceEpoch + Number(presence) };
  validateMembership(next);
  return next;
}

/** Reconcile current membership; unknown/outage observations must never erase roles. */
export function observeMembership(member, observation, now) {
  validateMembership(member);
  validateObservation(observation, member);
  requireFreshObservation(observation, now);
  const previous = member.observation;
  requireCondition(!previous || observation.observedAt >= previous.observedAt, 'OBSERVATION_OUT_OF_ORDER');
  const eligibilityLost = previous && ((previous.present && !observation.present) || (previous.whitelist && !observation.whitelist));
  const accessChanged = eligibilityLost || (previous && previous.muzzled !== observation.muzzled);
  return {
    ...member,
    version: member.version + 1,
    eligibilityEpoch: member.eligibilityEpoch + (eligibilityLost ? 1 : 0),
    presenceEpoch: member.presenceEpoch + (previous?.present && !observation.present ? 1 : 0),
    accessEpoch: member.accessEpoch + (accessChanged ? 1 : 0),
    observation: { ...observation },
  };
}

/** Caller must authorise the moderator and atomically commit this intent with its outbox. */
export function setMuteIntent(member, muted, expectedVersion) {
  validateMembership(member);
  requireCondition(member.version === expectedVersion, 'MEMBER_VERSION_CONFLICT');
  requireCondition(typeof muted === 'boolean', 'INVALID_MUTE_STATE');
  return {
    ...member,
    version: member.version + 1,
    accessEpoch: member.accessEpoch + (member.muteRequested !== muted ? 1 : 0),
    muteRequested: muted,
  };
}

export function requireOnboardingEligibility(member, now) {
  validateMembership(member);
  requireFreshObservation(member.observation, now);
  requireCondition(member.observation.present, 'NOT_IN_GUILD');
  requireCondition(!member.muteRequested && !member.observation.muzzled, 'MEMBER_MUZZLED');
}

/** Crew reconciliation intentionally has no Whitelist restoration branch. */
export function planCrewChange(member, now) {
  validateMembership(member);
  requireFreshObservation(member.observation, now);
  const observed = member.observation;
  if (!observed.present) return 'none';
  if (member.muteRequested || observed.muzzled) return observed.crew ? 'remove_crew' : 'none';
  return observed.crew ? 'none' : 'add_crew';
}

/** A pending unmute remains restrictive until removal is actually observed. */
export function planMemberChange(member, desiredMute, now) {
  requireCondition(desiredMute === null || typeof desiredMute === 'boolean', 'INVALID_MUTE_STATE');
  const crew = planCrewChange(member, now);
  if (!member.observation.present) return 'none';
  // Remove access before changing the Muzzled role. Never replace the entire role array.
  if (crew === 'remove_crew') return crew;
  if (desiredMute === true && !member.observation.muzzled) return 'add_muzzled';
  if (desiredMute === false && member.observation.muzzled) return 'remove_muzzled';
  if (desiredMute === false && member.muteRequested) return 'confirm_unmute';
  return crew;
}
