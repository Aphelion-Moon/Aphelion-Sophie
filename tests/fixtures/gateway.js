import { GUILD } from './domain.js';
import { BOT, roleList, mapping } from './discord.js';
import { APPLICATION } from './interactions.js';

export const gatewayConfiguration = Object.freeze({ ...mapping, applicationId: APPLICATION });
export const gatewayEvent = (sequence, type, data) => ({ op: 0, s: sequence, t: type, d: data });
export const readyEvent = (sequence = 1, sessionId = 'synthetic-gateway-session') => gatewayEvent(sequence, 'READY', {
  user: { id: BOT, bot: true }, application: { id: APPLICATION }, guilds: [{ id: GUILD }],
  session_id: sessionId, resume_gateway_url: 'wss://gateway.discord.gg/' });
export const guildEvent = (sequence = 2) => gatewayEvent(sequence, 'GUILD_CREATE', { id: GUILD, roles: roleList() });
/** A realistic GUILD_CREATE from the simulated Discord state: Discord always sends the owner, channels and (small-guild) members. */
export const stateGuildEvent = (state, sequence = 2) => gatewayEvent(sequence, 'GUILD_CREATE', { id: GUILD, owner_id: state.ownerId, roles: structuredClone(state.roles),
  channels: [...state.channels.values()].map(channel => structuredClone(channel)), emojis: [...state.emojis.values()].map(emoji => structuredClone(emoji)),
  members: [...state.members].map(([id, roles]) => ({ user: { id, bot: id === BOT }, roles: [...roles], communication_disabled_until: null })) });