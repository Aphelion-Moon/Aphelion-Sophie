import { createOnboardingMessages } from '../../apps/core/discord/onboarding-messages.js';
import { createOnboardingAlertMessages } from '../../apps/core/discord/onboarding-alert-messages.js';
import { simulatedCases, casePolicy } from './cases.js';
import { mapping } from './discord.js';
import { NOW } from './domain.js';

export function simulatedOnboarding({ clock = () => NOW, enabled = () => true, readContinuity, authorizeCaseParticipant } = {}) {
  const discord = simulatedCases({ clock, enabled, readContinuity, authorizeCaseParticipant });
  return { ...discord, messages: createOnboardingMessages({ transport: discord.transport, roles: discord.roles,
    channels: discord.channels, mapping, policy: casePolicy, clock }),
  alerts: createOnboardingAlertMessages({ transport: discord.transport, roles: discord.roles,
    channels: discord.channels, mapping, policy: casePolicy, clock }) };
}
