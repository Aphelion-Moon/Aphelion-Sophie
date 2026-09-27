import { OTHER } from './domain.js';

export function caseStaffPayload(f, action, row = null, { userId = OTHER, filter = 'active', assigneeId = OTHER, reason = 'handoff', priority = 'high', tags = 'Synthetic, Follow-up', ...overrides } = {}) {
  const options = action === 'queue' ? [{ type: 3, name: 'state', value: filter }] : [
    { type: 3, name: 'case', value: `${row.id}@${row.version}` },
    ...(action === 'assign' ? [{ type: 6, name: 'member', value: assigneeId }, { type: 3, name: 'reason', value: reason }] : []),
    ...(action === 'label' ? [{ type: 3, name: 'priority', value: priority }, { type: 3, name: 'tags', value: tags }] : []),
  ];
  return f.payload({ member: { user: { id: userId } }, data: { type: 1, name: 'ticket', options: [{ type: 1, name: action, options }] }, ...overrides });
}

export function caseStaffControl(f, customId, overrides = {}) {
  return f.payload({ member: { user: { id: OTHER } }, type: 3, message: { id: OTHER },
    data: { component_type: 2, custom_id: customId }, ...overrides });
}
