import { createCaseParticipants } from '../../apps/core/discord/case-participants.js';
import { createAdministrationCommands } from '../../apps/core/discord/onboarding-commands.js';
import { OTHER, USER, GUILD } from './domain.js';

export const PARTICIPANT = '100000000000000031';
export const SECOND_PARTICIPANT = '100000000000000032';
export function participantPayload(f, row, { action = 'add', userId = PARTICIPANT, actorId = OTHER, reason = action === 'add' ? 'case-context' : 'no-longer-needed', confirmed = true } = {}) {
  return f.payload({ member: { user: { id: actorId } }, data: { type: 1, name: 'ticket', options: [{ type: 1, name: 'participant', options: [
    { type: 3, name: 'case', value: `${row.id}@${row.version}` }, { type: 3, name: 'action', value: action },
    { type: 6, name: 'member', value: userId }, { type: 3, name: 'reason', value: reason }, { type: 5, name: 'confirm', value: confirmed },
  ] }] } });
}
export function participantServices(f) {
  const controller = createCaseParticipants({ authorization: f.authorization, discord: f.discord.roles, store: f.store, enabled: () => f.clock.enabled });
  const commands = createAdministrationCommands({ caseParticipants: controller });
  const executeParticipant = payload => commands.execute(f.verified(payload));
  async function changeParticipant(row, { action = 'add', userId = PARTICIPANT, actorId = OTHER, interactionId = f.nextId(), confirmed = true } = {}) {
    return f.store.changeCaseParticipant({ actor: await f.actor(actorId), observation: await f.discord.roles.observe(row.user_id ?? USER), interactionId,
      id: row.id, expectedVersion: row.version, action, userId, reason: action === 'add' ? 'case-context' : 'no-longer-needed', confirmed });
  }
  const describe = id => f.actor(OTHER).then(actor => f.store.describeCase({ actor, guildId: GUILD, id }));
  return { ...f, participantController: controller, executeParticipant, changeParticipant, describe };
}
