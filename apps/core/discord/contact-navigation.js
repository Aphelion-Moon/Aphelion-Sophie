import { ContractError, requireCondition } from '../../../contracts/validation.js';

/** Shared recipient navigation for signed Discord and authenticated HTTP; references never grant access. */
export function createContactNavigation({ authorization, discord, channels, store, enabled }) {
  const active = async () => requireCondition(await enabled() === true, 'OPERATION_DENIED');
  const current = async (actor, reference) => store.describeStaffContactDestination({ actor,
    observation: await discord.observe(reference.openerId), caseToken: reference.token });
  return Object.freeze({
    async list({ actor, after = null }) {
      await active();
      const page = await store.listStaffContactReferences({ actor, guildId: actor.guildId, after }), items = [];
      for (const reference of page.references) {
        try {
          const value = await current(actor, reference);
          if (['inspect', 'preparing'].includes(value.state)) items.push({ token: reference.token, openerId: reference.openerId,
            createdAt: value.createdAt, access: value.state === 'preparing' ? 'preparing' : value.access });
        } catch (error) { if (!(error instanceof ContractError) || error.code !== 'CASE_DESTINATION_DENIED') throw error; }
      }
      requireCondition(await authorization.authorize('case.create', actor, { guildId: actor.guildId, userId: actor.userId }) === true, 'OPERATION_DENIED');
      await active(); return { state: 'queue', items, next: page.next };
    },
    async destination({ actor, caseToken }) {
      await active();
      const reference = await store.describeStaffContactReference({ actor, guildId: actor.guildId, caseToken });
      const input = { actor, caseToken }, value = await current(actor, { ...reference, token: caseToken });
      if (value.state !== 'inspect') { await active(); return { state: value.state, caseToken }; }
      const proof = await channels.inspect(value.plan, value.channelId); await active();
      const result = await store.confirmStaffContactDestination({ ...input, observation: await discord.observe(reference.openerId), proof });
      await active(); return result;
    },
  });
}
