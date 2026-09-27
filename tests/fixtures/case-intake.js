import { createCaseFormStore } from '../../apps/core/storage/case-forms.js';
import { createCaseIntakeStore } from '../../apps/core/storage/case-intake.js';
import { createCaseIntake } from '../../apps/core/discord/case-intake.js';
import { createCaseContacts } from '../../apps/core/discord/case-contacts.js';
import { createAdministrationCommands } from '../../apps/core/discord/onboarding-commands.js';
import { onboardingWorkflow } from './onboarding-workflow.js';
import { casePolicy } from './cases.js';
import { GUILD, OTHER, LEAD } from './domain.js';

export const syntheticCaseForm = (caseType = 'admin-help') => ({ caseType, title: 'Synthetic support form', fields: [
  { id: 'details', kind: 'paragraph', label: 'Synthetic details', description: 'Test-only question; no real reports.', required: true, maxLength: 2_000 },
  { id: 'choice', kind: 'select', label: 'Synthetic choice', description: '', required: false,
    options: [{ value: 'first', label: 'First synthetic option' }, { value: 'second', label: 'Second synthetic option' }] },
] });
export const syntheticCaseValues = () => [{ id: 'details', kind: 'text', value: 'Synthetic intake fixture.' }, { id: 'choice', kind: 'select', value: ['first'] }];
export const intakeBeginPayload = (f, caseType = 'admin-help', overrides = {}) => f.payload({ data: { type: 1, name: 'ticket',
  options: [{ type: 1, name: 'open', options: [{ type: 3, name: 'type', value: caseType }] }] }, ...overrides });
export const playerReportPayload = (f, subjectId = null, overrides = {}) => f.payload({ data: { type: 1, name: 'ticket',
  options: [{ type: 1, name: 'report', options: subjectId === null ? [] : [{ type: 6, name: 'player', value: subjectId }] }] }, ...overrides });
export const intakeSubmitPayload = (f, token, values = syntheticCaseValues(), overrides = {}) => f.payload({ type: 5,
  data: { custom_id: `sophie:ticket-form:v1:${token}`, components: values.map((value, index) => ({ type: 18, id: index * 2 + 1,
    component: { type: value.kind === 'text' ? 4 : 3, id: index * 2 + 2, custom_id: value.id,
      ...(value.kind === 'text' ? { value: value.value } : { values: value.value }) } })) }, ...overrides });

export function caseIntakeServices(f, { authorize = f.authorization.authorize, policy = casePolicy, limits = { memberOpen: 2, guildPending: 3, cooldownMs: 1_000 } } = {}) {
  const forms = createCaseFormStore({ pool: f.pool, authorize, guildId: GUILD });
  const intakeStore = createCaseIntakeStore({ pool: f.pool, clock: () => f.clock.now, authorize, policy, limits, verification: f.discord.channels.verification,
    authorizeRecorded: f.authorization.authorizeRecorded, resolveCaseParticipant: f.authorization.resolveCaseParticipant, authorizeCaseParticipant: f.authorization.authorizeCaseParticipant });
  const intake = createCaseIntake({ authorization: f.authorization, verifier: f.identities.verifier, discord: f.discord.roles,
    channels: f.discord.channels, store: intakeStore, enabled: () => f.clock.enabled });
  const contacts = createCaseContacts({ authorization: f.authorization, discord: f.discord.roles, channels: f.discord.channels, store: intakeStore, enabled: () => f.clock.enabled });
  const commands = createAdministrationCommands({ caseIntake: intake, caseContacts: contacts });
  const prepare = async (caseType = 'admin-help', overrides = {}) => {
    const payload = intakeBeginPayload(f, caseType, overrides), envelope = f.verified(payload);
    return { payload, envelope, result: await intake.prepare(envelope, { isCurrent: () => true }) };
  };
  const publish = async (form = syntheticCaseForm(), version = 1) => forms.publishCaseForm({ actor: await f.actor(OTHER), version, form });
  const executeIntake = payload => commands.execute(f.verified(payload));
  const submit = (token, values = syntheticCaseValues(), overrides = {}) => executeIntake(intakeSubmitPayload(f, token, values, overrides));
  return { ...f, forms, intakeStore, intake, contacts, commands, prepare, publish, executeIntake, submit };
}
export async function intakeWorkflow(cluster, { extraCapabilities = {}, ...options } = {}) {
  const f = await onboardingWorkflow(cluster, { extraCapabilities: { 'case.forms.publish': [LEAD], ...extraCapabilities } });
  f.discord.state.members.set(OTHER, [LEAD]); return caseIntakeServices(f, options);
}
