import { createMembership, observeMembership, setMuteIntent } from '../modules/membership/index.js';
import { advanceOnboarding, confirmWhitelist, requireGrantDelivery, startOnboarding } from '../modules/onboarding/index.js';

// Synthetic, in-memory values only. This is not a persistence adapter or Discord client.
const now = Date.now();
const observation = { guildId: '100000000000000001', userId: '100000000000000002', known: true, observedAt: now, present: true, crew: true, muzzled: false, whitelist: false };
const member = observeMembership(createMembership(observation.guildId, observation.userId), observation, now);
const definition = { id: 'synthetic-demo', version: 1, status: 'published', stepIds: ['brochure', 'bags', 'board', 'lights', 'disembark'] };
let session = startOnboarding({ id: 'synthetic-session', nonce: 'nonce-0', member, definition, now });
let effect;
for (let i = 0; i < 5; i++) {
  const outcome = advanceOnboarding(session, member, definition, {
    guildId: member.guildId, userId: member.userId, expectedVersion: session.version,
    nonce: session.nonce, nextNonce: `nonce-${i + 1}`,
  }, now);
  session = outcome.session;
  effect = outcome.effects[0];
  console.log(`Acknowledgement ${i + 1}: ${session.status}`);
}
const muted = setMuteIntent(member, true, member.version);
try {
  requireGrantDelivery(session, muted, effect, definition, now);
  throw new Error('DEMO_EXPECTED_MUTE_REJECTION');
} catch (error) {
  if (error.code !== 'MEMBER_MUZZLED') throw error;
  console.log('Competing mute: pending grant rejected.');
}
const observed = observeMembership(member, { ...observation, whitelist: true }, now);
const confirmed = confirmWhitelist(session, observed, effect, definition, now);
console.log(`Separate successful synthetic path: ${confirmed.status} after role observation.`);
console.log('No Discord connection, files, services or production state were changed.');
