import { lookupCommandDefinition } from './lookup.js';
import { sophieCommandDefinition } from './member-panel.js';

/**
 * Sophie's capability manifest (plan of 2 November 2026, P53 H3). The October probe found her inventing commands, channels,
 * processes and abilities ("/music", "#roles", an events calendar page). The prompt states what she can and cannot do:
 * her commands come from their registered definitions, and the only channels she may name are the owner's directory in
 * the AI configuration. A reply may name a /command or #channel only from these lists or from a passage it cites
 * (reply-checks.js).
 */
const memberCommands = () => [sophieCommandDefinition(), lookupCommandDefinition()].map(({ name, description }) => ({ name, use: description }));
// Staff-only commands of the production command set (apps/core/discord/command-registration.js), named only in staff channels.
const STAFF_COMMANDS = Object.freeze([
  { name: 'whitelist', use: 'Lead Ops: the Shuttle Activity launch post (post). Staff: a member\'s Shuttle progress (progress).' },
  { name: 'member', use: 'Staff: turn Watch on or off for a member record (watch).' }]);
const CANNOT = 'moderate, mute, kick or ban anyone; give or remove roles, Whitelist included; open, read or answer tickets, reports ' +
  'or appeals, or contact staff for anyone; join voice or play music; set reminders or timers; post, announce or send messages ' +
  'for someone; or see live server status, player counts, round details, or build and test results';

const commandsFor = context => [...memberCommands(), ...(context?.name === 'staff' ? STAFF_COMMANDS : [])];

/** The slash command names a reply may use in this context. */
export function aiCommandNames(context = null) {
  return commandsFor(context).map(command => command.name);
}

/** The manifest in the prompt's fixed part, after the rules: commands, the owner's channel directory and the limits. */
export function capabilityBlock({ context = null, directory = [] } = {}) {
  const commands = commandsFor(context).map(command => `/${command.name}: ${command.use}`).join('\n');
  const channels = directory.length ? directory.map(entry => `#${entry.name}: ${entry.purpose}`).join('\n') : 'None is listed, so name no channel.';
  return `\n\nWhat you can do (fixed facts; never claim more):\nSlash commands:\n${commands}\nChannels you may name:\n${channels}\n` +
    `You cannot ${CANNOT}. Whitelist comes only from finishing the Shuttle Activity, never while a member is muzzled, and any loss ` +
    'of Whitelist, leaving the server included, needs a fresh Shuttle run. Name a slash command or a channel only from these lists or ' +
    'from evidence you cite. Never invent a channel, command, button, page, bot, form or process; if you do not know where something ' +
    'is done, say so.';
}
