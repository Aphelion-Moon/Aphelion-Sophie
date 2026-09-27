import { defaultSystemText } from '../../contracts/system-messages.js';
/** Static routing only. A button identifier never establishes membership or access. */
export const ONBOARDING_ENTRY_ID = 'sophie:shuttle:start:1';

export function onboardingEntryControls(text = defaultSystemText) {
  return [{ type: 1, components: [{ type: 2, style: 1, label: text('onboarding.entry'), custom_id: ONBOARDING_ENTRY_ID }] }];
}

export function onboardingEntryPanel(text = defaultSystemText) {
  return { embeds: [{ title: text('onboarding.panel.title'), description: text('onboarding.panel.body') }],
    components: onboardingEntryControls(text), allowed_mentions: { parse: [], users: [], roles: [], replied_user: false } };
}

/** Registration data for later staging; importing it does not register a command. */
export function onboardingCommandDefinition() {
  return { type: 1, name: 'whitelist', description: 'Start or resume your private Shuttle session.',
    integration_types: [0], contexts: [0], options: [
      { type: 1, name: 'start', description: 'Start or resume your private Shuttle session.' },
      { type: 1, name: 'panel', description: 'Guidance publishers: post the configured Shuttle entry panel here.' },
      { type: 1, name: 'close', description: 'Staff: remove an Onboarding channel while retaining its records.', options: [
        { type: 5, name: 'confirm', description: 'Confirm deletion of the Discord channel. Records remain saved.', required: true },
        { type: 7, name: 'channel', description: 'Onboarding channel to close (defaults to this channel).', channel_types: [0] },
      ] },
      { type: 1, name: 'queue', description: 'Staff: list outstanding Shuttle assistance requests.' },
    ] };
}
