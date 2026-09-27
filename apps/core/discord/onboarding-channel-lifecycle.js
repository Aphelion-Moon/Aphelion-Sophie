import { requireCondition } from '../../../contracts/validation.js';

/** Staff explicitly select a channel; record closure before its durable worker removes it. */
export function createOnboardingChannelClosure({ authorization, roles, channels, store, enabled }) {
  return Object.freeze({ async execute(envelope) {
    if (!await enabled()) return 'disabled';
    try {
      requireCondition(envelope.command === 'shuttle.close' && envelope.confirmed === true, 'OPERATION_DENIED');
      const actor = await authorization.resolveActor(envelope);
      const target = await store.describeOnboardingClosure({ actor, channelId: envelope.selectedChannelId ?? envelope.channelId });
      const proof = await channels.inspectPresence(target.plan, target.channelId);
      if (!await enabled()) return 'disabled';
      await store.closeOnboardingChannel({ actor, id: target.id, proof, interactionId: envelope.interactionId,
        observation: await roles.observe(target.userId) });
      return 'shuttle_closed';
    } catch (error) { return error.code === 'OPERATION_DENIED' ? 'denied' : 'unavailable'; }
  } });
}

export function createOnboardingCleanup({ store, roles, enabled, clock }) {
  let nextCheck = 0;
  return Object.freeze({ async runOnce() {
    if (!await enabled() || clock() < nextCheck) return;
    nextCheck = clock() + 60_000;
    for (const row of await store.nextOnboardingCleanup()) {
      if (!await enabled()) return;
      await store.scheduleOnboardingCleanup({ id: row.id, observation: await roles.observe(row.user_id) });
    }
  } });
}
