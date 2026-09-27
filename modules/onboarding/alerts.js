import { defaultSystemText } from '../../contracts/system-messages.js';
import { requireCondition, requireId, requireKeys } from '../../contracts/validation.js';

export function requireAlertId(value) {
  requireCondition(typeof value === 'string' && /^[a-f0-9]{32}$/.test(value), 'INVALID_SHUTTLE_ALERT');
}
export function alertMarker(id) { requireAlertId(id); return `sophie:shuttle-alert:v1:${id}`; }



/** Closed static templates. Only the mapped Staff role may be mentioned. */
export function renderOnboardingAlert({ alertId, kind, staffRoleId }, text = defaultSystemText) {
  requireAlertId(alertId); requireId(staffRoleId);
  requireCondition(['help', 'delivery'].includes(kind), 'INVALID_SHUTTLE_ALERT');
  return { content: `<@&${staffRoleId}>`, embeds: [{ title: text(`onboarding.alert.${kind}.title`), description: text(`onboarding.alert.${kind}.body`), footer: { text: alertMarker(alertId) } }],
    components: [], allowed_mentions: { parse: [], roles: [staffRoleId], users: [], replied_user: false } };
}

export function validateOnboardingAlertPayload(value, alertId) {
  requireKeys(value, ['content', 'embeds', 'components', 'allowed_mentions']); requireAlertId(alertId);
  requireKeys(value.allowed_mentions, ['parse', 'roles', 'users', 'replied_user']);
  requireCondition(Array.isArray(value.allowed_mentions.roles) && value.allowed_mentions.roles.length === 1, 'INVALID_SHUTTLE_ALERT');
  const staffRoleId = value.allowed_mentions.roles[0]; requireId(staffRoleId);
  requireCondition(value.content === `<@&${staffRoleId}>` && Array.isArray(value.embeds) && value.embeds.length === 1 &&
    Array.isArray(value.components) && value.components.length === 0 && Array.isArray(value.allowed_mentions.parse) && value.allowed_mentions.parse.length === 0 &&
    Array.isArray(value.allowed_mentions.users) && value.allowed_mentions.users.length === 0 && value.allowed_mentions.replied_user === false, 'INVALID_SHUTTLE_ALERT');
  const embed = value.embeds[0]; requireKeys(embed, ['title', 'description', 'footer']); requireKeys(embed.footer, ['text']);
  requireCondition(embed.footer.text === alertMarker(alertId) && typeof embed.title === 'string' && embed.title.length > 0 && embed.title.length <= 80 &&
    typeof embed.description === 'string' && embed.description.length > 0 && embed.description.length <= 1500, 'INVALID_SHUTTLE_ALERT');
}
