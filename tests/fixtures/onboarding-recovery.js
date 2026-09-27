import assert from 'node:assert/strict';
import { OTHER } from './domain.js';

export const recoveryQueue = f => f.verified(f.payload({ member: { user: { id: OTHER } },
  data: { type: 1, name: 'whitelist', options: [{ type: 1, name: 'issues' }] } }));
export const issueRecheck = (f, issue) => f.execute(f.payload({ type: 3, member: { user: { id: OTHER } }, message: { id: OTHER },
  data: { component_type: 2, custom_id: `sophie:shuttle-issue:v1:recheck:${issue.id}:${issue.revision}` } }));
export const recoveryPayload = (f, issue, messageId, overrides = {}) => f.payload({ member: { user: { id: OTHER } },
  data: { type: 1, name: 'whitelist', options: [{ type: 1, name: 'recover', options: [
    { name: 'issue', type: 3, value: `${issue.id}.${issue.revision}` }, { name: 'message', type: 3, value: messageId }] }] }, ...overrides });
export const messageRecovery = (f, issue, messageId, overrides) => f.execute(recoveryPayload(f, issue, messageId, overrides));
export const makeDue = f => f.admin.query("UPDATE sophie_core.outbox SET available_at = clock_timestamp() WHERE status = 'ready'");

/** Simulate a successful own-message POST whose response never reaches the worker. */
export async function parkedOnboardingMessage(f, kind = 'screen') {
  assert.ok(['screen', 'alert'].includes(kind));
  if (kind === 'screen') { assert.equal(await f.execute(f.payload()), 'shuttle_recorded'); await f.drain(f.cases); }
  else { await f.open(); assert.equal(await f.click('help'), 'shuttle_help_recorded'); await f.drain(f.screens); }
  const worker = kind === 'screen' ? f.screens : f.alerts;
  f.discord.state.afterWrite = call => { if (call.method === 'POST' && call.path.includes('/messages')) {
    f.discord.state.afterWrite = null; throw new Error('SYNTHETIC_LOST_MESSAGE_RESPONSE');
  } };
  assert.equal((await worker.runOnce('lost-message')).status, 'retry_scheduled'); await makeDue(f);
  assert.equal((await worker.runOnce('unknown-message')).status, 'operator_required');
  const record = kind === 'screen' ? await f.current() : (await f.rows('shuttle_alerts'))[0];
  assert.equal(record.message_id, null); assert.equal(record.create_started, true);
  const message = [...f.discord.state.messages.values()].find(row => row.embeds.some(embed => embed.footer?.text?.endsWith(`:${record.id}`)) || row.components?.some(part => part.components?.some(button => button.custom_id?.startsWith(`sophie:shuttle:v1:${record.id}:`))));
  assert.ok(message);
  const job = (await f.rows('outbox')).find(row => row.status === 'parked' && row.kind === (kind === 'screen' ? 'shuttle.render' : 'shuttle.alert'));
  const issue = (await f.rows('shuttle_delivery_issues')).find(row => row.operation_id === job.operation_id);
  assert.ok(issue); return { issue, record, messageId: message.id };
}
