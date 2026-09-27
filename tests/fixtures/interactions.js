import { generateKeyPairSync, sign } from 'node:crypto';
import { createInteractionVerifier } from '../../apps/core/security/interaction-verifier.js';
import { GUILD, NOW, OTHER, USER } from './domain.js';

export const APPLICATION = '100000000000000012';
export const CHANNEL = '100000000000000013';

/** Ephemeral keys created for each test only, never a configured Discord public/private key. */
export function syntheticInteractions({ clock = () => NOW } = {}) {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const publicKeyHex = publicKey.export({ format: 'der', type: 'spki' }).subarray(-32).toString('hex');
  const verifier = createInteractionVerifier({ publicKeyHex, applicationId: APPLICATION, guildId: GUILD, clock });
  let sequence = 700000000000000000n;
  const payload = (overrides = {}) => ({ id: String(++sequence), application_id: APPLICATION, type: 2, version: 1,
    token: 'synthetic-interaction-reply-token',
    guild_id: GUILD, channel_id: CHANNEL, context: 0, authorizing_integration_owners: { '0': GUILD },
    member: { user: { id: OTHER, bot: false }, roles: [] },
    data: { type: 1, name: 'mute', options: [{ name: 'member', type: 6, value: USER }] }, ...overrides });
  const signed = (value, timestamp = String(Math.floor(clock() / 1_000))) => {
    const body = Buffer.from(JSON.stringify(value));
    const signature = sign(null, Buffer.concat([Buffer.from(timestamp), body]), privateKey).toString('hex');
    return { body, signature, timestamp };
  };
  return { verifier, publicKeyHex, payload, signed, mint: (overrides = {}) => verifier.verify(signed(payload(overrides))) };
}
