import assert from 'node:assert/strict';
import { createCaseDeliveryIssueStore } from '../../apps/core/storage/case-delivery-issues.js';
import { createCaseDeliveryIssues } from '../../apps/core/discord/case-delivery-issues.js';
import { createAdministrationCommands } from '../../apps/core/discord/onboarding-commands.js';
import { intakeDeliveryWorkflow } from './case-intake-delivery.js';
import { casePolicy } from './cases.js';
import { GUILD, USER, OTHER } from './domain.js';
import { intakeBeginPayload } from './case-intake.js';

export const issuePayload = (f, action = 'issues', issue = null, resultId = null, overrides = {}) => {
  const options = action === 'issues' ? [] : [{ type: 3, name: 'issue', value: `${issue.id}.${issue.revision}` },
    { type: 3, name: action === 'recover' ? 'message' : 'channel', value: resultId }];
  return f.payload({ member: { user: { id: OTHER } }, data: { type: 1, name: 'ticket', options: [{ type: 1, name: action, options }] }, ...overrides });
};
export const recheckPayload = (f, issue, overrides = {}) => f.payload({ type: 3, member: { user: { id: OTHER } }, message: { id: OTHER },
  data: { component_type: 2, custom_id: `sophie:case-issue:v1:recheck:${issue.id}:${issue.revision}` }, ...overrides });
export function caseIssueServices(f, options = {}) {
  const issueStore = createCaseDeliveryIssueStore({ pool: f.pool, clock: () => f.clock.now, authorize: f.authorization.authorize,
    policy: casePolicy, verification: f.discord.channels.verification, messageVerification: f.intakeMessages.verification, ...options });
  const caseDeliveryIssues = createCaseDeliveryIssues({ authorization: f.authorization, discord: f.discord.roles,
    channels: f.discord.channels, messages: f.intakeMessages, store: issueStore, enabled: () => f.clock.enabled });
  const commands = createAdministrationCommands({ caseDeliveryIssues });
  return { issueStore, caseDeliveryIssues, issueCommands: commands, executeIssue: payload => commands.execute(f.verified(payload)),
    issueQueue: (overrides = {}) => caseDeliveryIssues.queue(f.verified(issuePayload(f, 'issues', null, null, overrides))) };
}
export async function caseIssueWorkflow(cluster) {
  const f = await intakeDeliveryWorkflow(cluster); return { ...f, ...caseIssueServices(f) };
}
export async function parkIntake(f, type = 'admin-help') {
  const row = await f.openTicket(type);
  f.discord.state.afterWrite = call => { if (/\/messages$/.test(call.path)) { f.discord.state.afterWrite = null; throw new Error('SYNTHETIC_LOST_RESPONSE'); } };
  assert.equal((await f.intakeWorker.runOnce('lost-intake-result')).status, 'retry_scheduled');
  await f.admin.query("UPDATE sophie_core.outbox SET available_at = '-infinity' WHERE status = 'ready'");
  assert.equal((await f.intakeWorker.runOnce('uncertain-intake')).code, 'CASE_INTAKE_UNCERTAIN');
  const issue = (await f.rows('case_delivery_issues')).find(item => item.case_id === row.id);
  assert.ok(issue); return { issue, row, message: [...f.discord.state.messages.values()].at(-1) };
}

export async function ordinaryCasePlan(f, row) {
  const record = (await f.rows('case_provisions')).find(item => item.case_id === row.id);
  return { id: row.id, guildId: GUILD, openerId: USER, type: row.type, policyVersion: record.policy_version,
    token: record.operation_token, presenceEpoch: Number(record.presence_epoch) };
}
export async function retainOrdinaryCandidate(f, row, candidate) {
  f.discord.state.channels.set(candidate.id, candidate);
  const job = (await f.rows('outbox')).find(item => item.kind === 'case.provision' && item.effect.caseId === row.id);
  await f.store.noteCaseChannel({ claim: { guildId: GUILD, operationId: job.operation_id, owner: 'late-worker', fence: job.fence },
    proof: await f.discord.channels.inspect(await ordinaryCasePlan(f, row), candidate.id) });
}
export async function duplicateOrdinaryCase(f, { opened = false } = {}) {
  if (opened) await f.openTicket('quick-help');
  else { assert.equal(await f.executeIntake(intakeBeginPayload(f, 'quick-help')), 'ticket_recorded'); assert.equal((await f.cases.runOnce('ordinary-create')).status, 'progressed'); }
  const row = (await f.rows('case_reservations'))[0], original = [...f.discord.state.channels.values()].find(channel => channel.type === 0);
  const duplicate = { ...structuredClone(original), id: f.nextId() }; await retainOrdinaryCandidate(f, row, duplicate);
  for (let index = 0; index < 5; index++) {
    const result = await f.cases.runOnce('ordinary-duplicate'); if (result.status === 'progressed') continue;
    assert.equal(result.code, 'CASE_CHANNEL_DUPLICATE'); break;
  }
  const issue = (await f.rows('case_delivery_issues')).find(item => item.case_id === row.id);
  assert.ok(issue); return { row, original, duplicate, issue };
}
