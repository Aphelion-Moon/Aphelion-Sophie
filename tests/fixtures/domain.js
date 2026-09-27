import { createMembership, observeMembership } from '../../modules/membership/index.js';
import { advanceOnboarding, startOnboarding } from '../../modules/onboarding/index.js';

// Synthetic IDs and fixed time. No production identities, forms or conversations.
export const NOW = 1_800_000_000_000;
export const GUILD = '100000000000000001';
export const USER = '100000000000000002';
export const OTHER = '100000000000000003';
export const STAFF = '100000000000000004';
export const LEAD = '100000000000000005';
export const moderator = Object.freeze({ guildId: GUILD, userId: OTHER, capabilityEpoch: 1, policyVersion: 1, moderator: true });

export const definition = Object.freeze({
  id: 'shuttle-v1', version: 1, status: 'published',
  stepIds: Object.freeze(['the-brochure', 'pack-your-bags', 'board-the-shuttle', 'admire-the-lights', 'disembarking']),
});

export const publication = Object.freeze({ id: definition.id, version: definition.version, helpPauses: false,
  stages: Object.freeze(definition.stepIds.map((id, index) => Object.freeze({ id, title: `Synthetic page ${index + 1}`,
    body: `Synthetic published guidance for stage ${index + 1}.` }))) });

export function observation(overrides = {}) {
  return { guildId: GUILD, userId: USER, known: true, observedAt: NOW, present: true, crew: true, muzzled: false, whitelist: false, ...overrides };
}

export function member(overrides = {}) {
  return observeMembership(createMembership(GUILD, USER), observation(overrides), NOW);
}

export function command(session, overrides = {}) {
  return { guildId: GUILD, userId: USER, expectedVersion: session.version, nonce: session.nonce, nextNonce: `nonce-${session.version + 1}`, ...overrides };
}

export function started(current = member(), published = definition, id = 'session-1') {
  return startOnboarding({ id, nonce: 'nonce-0', member: current, definition: published, now: NOW });
}

export function completedReading(current = member(), published = definition) {
  let session = started(current, published);
  let outcome;
  for (let i = 0; i < 5; i++) {
    outcome = advanceOnboarding(session, current, published, command(session), NOW);
    session = outcome.session;
  }
  return outcome;
}
