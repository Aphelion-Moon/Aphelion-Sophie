import { requireCondition } from './validation.js';

export const DASHBOARD_GROUPS = Object.freeze([
  { title: 'Community', pages: [['/contacts', 'My Staff contacts'], ['/contact-entry', 'New Staff contact'], ['/answers', 'Public answers']] },
  { title: 'Casework', pages: [['/cases', 'Case records'], ['/manage-cases', 'Manage cases'], ['/case-replies', 'Case replies'], ['/staff-notes', 'Staff notes'], ['/case-labels', 'Case labels']] },
  { title: 'Configuration', pages: [['/', 'Onboarding guidance'], ['/localizations', 'System wording'], ['/ticket-forms', 'Ticket forms'], ['/automation', 'Static automation'], ['/permissions', 'Permissions']] },
]);

/** Navigation hints only. Every data read and action retains its own authorization. */
export function dashboardPageAllowed(path, session) {
  const access = { '/': 'canEditOnboarding', '/localizations': 'canEditOnboarding', '/ticket-forms': 'canEditForms',
    '/automation': 'canEditAutomation', '/permissions': 'canEditPermissions', '/contact-entry': 'canCreateContacts',
    '/manage-cases': 'canManageCases', '/case-replies': 'canManageCases', '/staff-notes': 'canManageCases', '/case-labels': 'canManageCases' };
  return Object.hasOwn(access, path) ? session[access[path]] === true : ['/contacts', '/cases', '/answers'].includes(path);
}

export function dashboardSessionView(actor, csrfToken, available = {}) {
  const can = capability => available[capability] !== false && actor.capabilities[capability] === true;
  return { guildId: actor.guildId, userId: actor.userId, csrfToken,
    canEditOnboarding: can('shuttle.publish'), canEditForms: can('case.forms.publish'),
    canEditAnswers: can('answers.publish'), canEditAutomation: can('automation.publish'),
    canEditPermissions: can('permissions.publish'), canManageCases: actor.canManageCases === true,
    canCreateContacts: actor.canCreateContacts === true };
}
export function dashboardReturnPath(value) {
  requireCondition(typeof value === 'string' && DASHBOARD_GROUPS.some(group => group.pages.some(([path]) => path === value)), 'DASHBOARD_RETURN_PATH_INVALID');
  return value;
}
