import assert from 'node:assert/strict';
import { GUILD, USER, OTHER } from './domain.js';

export const channelChoicePayload = (f, issue, channelId, overrides = {}) => f.payload({ member: { user: { id: OTHER } },
  data: { type: 1, name: 'whitelist', options: [{ type: 1, name: 'choose', options: [
    { name: 'issue', type: 3, value: `${issue.id}.${issue.revision}` }, { name: 'channel', type: 3, value: channelId }] }] }, ...overrides });
export const channelChoice = (f, issue, channelId, overrides) => f.execute(channelChoicePayload(f, issue, channelId, overrides));

export async function casePlanFor(f) {
  const row = (await f.rows('case_provisions'))[0];
  return { id: row.case_id, guildId: GUILD, openerId: USER, type: 'shuttle', policyVersion: row.policy_version,
    token: row.operation_token, presenceEpoch: Number(row.presence_epoch) };
}

export async function retainLateCandidate(f, candidate) {
  f.discord.state.channels.set(candidate.id, candidate);
  const job = (await f.rows('outbox')).find(row => row.kind === 'case.provision');
  return f.store.noteCaseChannel({ claim: { guildId: GUILD, operationId: job.operation_id, owner: 'late-worker', fence: job.fence },
    proof: await f.discord.channels.inspect(await casePlanFor(f), candidate.id) });
}

export async function duplicateOnboardingCase(f, { opened = false } = {}) {
  if (opened) await f.open();
  else { assert.equal(await f.execute(f.payload()), 'shuttle_recorded'); assert.equal((await f.cases.runOnce('first-create')).status, 'progressed'); }
  const original = [...f.discord.state.channels.values()].find(row => row.type === 0);
  const duplicate = { ...structuredClone(original), id: f.nextId() };
  await retainLateCandidate(f, duplicate);
  for (let attempt = 0; attempt < 4; attempt++) {
    const result = await f.cases.runOnce('duplicate-review');
    if (result.status === 'progressed') continue;
    assert.deepEqual(result, { status: 'operator_required', code: 'CASE_CHANNEL_DUPLICATE' }); break;
  }
  const job = (await f.rows('outbox')).find(row => row.kind === 'case.provision' && row.status === 'parked');
  assert.ok(job);
  const issue = (await f.rows('shuttle_delivery_issues')).find(row => row.operation_id === job.operation_id);
  return { original, duplicate, issue };
}
