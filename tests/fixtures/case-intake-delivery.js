import { createCaseIntakeDeliveryStore } from '../../apps/core/storage/case-intake-delivery.js';
import { createCaseIntakeDispatcher } from '../../apps/core/discord/case-intake-dispatcher.js';
import { createCaseIntakeMessages } from '../../apps/core/discord/case-intake-messages.js';
import { createDiscordTransport } from '../../apps/core/discord/transport.js';
import { createDiscordRoles } from '../../apps/core/discord/roles.js';
import { createCaseChannels } from '../../apps/core/discord/case-channels.js';
import { createOutbox } from '../../apps/core/storage/outbox.js';
import { intakeWorkflow, syntheticCaseForm, syntheticCaseValues, intakeBeginPayload } from './case-intake.js';
import { casePolicy } from './cases.js';
import { mapping } from './discord.js';
import { GUILD } from './domain.js';
import assert from 'node:assert/strict';

export function intakeDeliveryServices(f, { policy = casePolicy, store: suppliedStore, messages: suppliedMessages } = {}) {
  const clock = () => f.clock.now, enabled = () => f.clock.enabled;
  const transport = createDiscordTransport({ guildId: GUILD, token: 'synthetic-test-token-not-a-secret', fetch: f.discord.fetch, clock, enabled });
  const roles = createDiscordRoles({ transport, mapping, clock, readContinuity: f.discord.roles.readContinuity });
  const channels = createCaseChannels({ transport, roles, mapping, policy, clock, authorizeCaseParticipant: f.authorization.authorizeCaseParticipant });
  const messages = suppliedMessages ?? createCaseIntakeMessages({ transport, roles, channels, mapping, policy, clock });
  const store = suppliedStore ?? createCaseIntakeDeliveryStore({ pool: f.pool, clock, policy,
    caseVerification: channels.verification, messageVerification: messages.verification });
  const outbox = createOutbox({ pool: f.pool });
  const worker = createCaseIntakeDispatcher({ outbox, store, roles, messages, enabled });
  return { intakeWorker: worker, intakeDeliveryStore: store, intakeMessages: messages, intakeRoles: roles, intakeChannels: channels, intakeTransport: transport };
}
export async function intakeDeliveryWorkflow(cluster, options) {
  const f = await intakeWorkflow(cluster, options), services = intakeDeliveryServices(f);
  const openTicket = async (type = 'admin-help', values = syntheticCaseValues(), form = syntheticCaseForm(type)) => {
    if (type === 'quick-help') assert.equal(await f.executeIntake(intakeBeginPayload(f, type)), 'ticket_recorded');
    else { await f.publish(form); const prepared = await f.prepare(type); assert.equal(prepared.result.status, 'modal');
      assert.equal(await f.submit(prepared.result.modal.token, values), 'ticket_recorded'); }
    await f.drain(f.cases); return (await f.rows('case_reservations')).find(row => row.type === type);
  };
  return { ...f, ...services, openTicket };
}
