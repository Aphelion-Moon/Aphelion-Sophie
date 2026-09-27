import { createCaseChannels } from '../../apps/core/discord/case-channels.js';
import { CASE_CHANNEL_BITS, CASE_CLOSED_WRITE_BITS } from '../../modules/tickets/channel-policy.js';
import { PERMISSIONS } from '../../platform/authorization/discord-permissions.js';
import { BOT, BOT_ROLE, mapping, simulatedDiscord } from './discord.js';
import { GUILD, STAFF, LEAD, USER, NOW } from './domain.js';

export const CATEGORY = '100000000000000020';
export const casePolicy = Object.freeze({ guildId: GUILD, botUserId: BOT, staff: STAFF, leadOps: LEAD,
  categoryId: CATEGORY, version: 1, attachmentsAllowed: false });
export const casePlan = Object.freeze({ id: 'synthetic-case', guildId: GUILD, openerId: USER, type: 'admin-help',
  policyVersion: 1, token: '1234567890abcdef'.repeat(3), presenceEpoch: 0 });

/** Only generated metadata is exercised; no case messages/forms/attachments. */
export function simulatedCases({ clock = () => NOW, enabled = () => true, policy = casePolicy, readContinuity, authorizeCaseParticipant } = {}) {
  const discord = simulatedDiscord({ clock, enabled, readContinuity });
  discord.state.roles.find(role => role.id === BOT_ROLE).permissions = String(PERMISSIONS.manageRoles | PERMISSIONS.manageChannels | CASE_CHANNEL_BITS | CASE_CLOSED_WRITE_BITS);
  discord.state.channels.set(CATEGORY, { id: CATEGORY, guild_id: GUILD, type: 4, parent_id: null,
    topic: null, permission_overwrites: [] });
  return { ...discord, channels: createCaseChannels({ transport: discord.transport, roles: discord.roles, mapping, policy, clock, authorizeCaseParticipant }) };
}
