import { GUILD } from './domain.js';
import { BOT, roleList, mapping } from './discord.js';
import { APPLICATION } from './interactions.js';

export const gatewayConfiguration = Object.freeze({ ...mapping, applicationId: APPLICATION });
export const gatewayEvent = (sequence, type, data) => ({ op: 0, s: sequence, t: type, d: data });
export const readyEvent = (sequence = 1, sessionId = 'synthetic-gateway-session') => gatewayEvent(sequence, 'READY', {
  user: { id: BOT, bot: true }, application: { id: APPLICATION }, guilds: [{ id: GUILD }],
  session_id: sessionId, resume_gateway_url: 'wss://gateway.discord.gg/' });
export const guildEvent = (sequence = 2) => gatewayEvent(sequence, 'GUILD_CREATE', { id: GUILD, roles: roleList() });
