import { requireCondition, requireId } from '../../../contracts/validation.js';
import { onboardingCommandDefinition } from '../../../modules/onboarding/entry-controls.js';
import { ticketCommandDefinition } from '../../../modules/tickets/lifecycle.js';
import { answerCommandDefinition } from '../../../modules/answers/discord.js';
import { lookupCommandDefinition } from '../../../modules/assistant/lookup.js';

function recoveryOptions() {
  return [{ type: 1, name: 'issues', description: 'Staff: inspect retained delivery issues.' },
    ...['recover', 'choose'].map(name => ({ type: 1, name,
      description: name === 'recover' ? 'Staff: identify a retained Sophie message.' : 'Staff: select a retained private case channel.',
      options: [{ type: 3, name: 'issue', description: 'Issue ID and revision from the issue queue.', required: true, max_length: 128 },
        { type: 3, name: name === 'recover' ? 'message' : 'channel', description: 'Exact Discord ID from the retained case.', required: true, max_length: 20 }] }))];
}

/** Fixed names, existing parser contracts, guild-only registration. No arbitrary command payload input. */
export function administrationCommandDefinitions() {
  const onboarding = onboardingCommandDefinition(), ticket = ticketCommandDefinition();
  // integration_types/contexts are global-command fields; guild scope is fixed by the HTTP path.
  for (const command of [onboarding, ticket]) { delete command.integration_types; delete command.contexts; command.options.push(...recoveryOptions()); }
  return [onboarding, ticket, answerCommandDefinition(), lookupCommandDefinition(), ...['mute', 'unmute'].map(name => ({ type: 1, name,
    description: name === 'mute' ? 'Staff: apply Muzzled and remove Crew.' : 'Staff: remove Muzzled and reconcile Crew.',
    options: [{ type: 6, name: 'member', description: 'Current guild member.', required: true }] }))];
}

/** Explicit call upserts only Sophie's named commands; never bulk-replaces or deletes other commands. */
export async function registerStagingCommands({ transport, applicationId, botUserId, confirmGuildId }) {
  requireId(applicationId); requireId(botUserId);
  requireCondition(confirmGuildId === transport.guildId, 'COMMAND_REGISTRATION_CONFIRMATION_REQUIRED');
  const identity = await transport.getCurrentUser(), application = await transport.getCurrentApplication();
  requireCondition(identity?.id === botUserId && identity.bot === true && application?.id === applicationId, 'GATEWAY_IDENTITY_MISMATCH');
  const registered = [];
  for (const definition of administrationCommandDefinitions()) {
    const result = await transport.upsertGuildCommand(applicationId, definition);
    requireCondition(result?.name === definition.name && result.type === 1 && result.application_id === applicationId &&
      result.guild_id === transport.guildId, 'COMMAND_REGISTRATION_UNCONFIRMED');
    requireId(result.id); registered.push({ name: definition.name, id: result.id });
  }
  return registered;
}
