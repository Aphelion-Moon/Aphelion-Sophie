import { requireCondition, requireFreshObservation, requireId } from '../../../contracts/validation.js';
import { operatorGrant } from '../../../contracts/operator-grant.js';
import { CONTACT_PAGE_SIZE } from '../../../modules/tickets/contacts.js';
import { requireCaseToken } from '../../../modules/tickets/references.js';
import { requireCaseChannel } from '../../../modules/tickets/channel-policy.js';
import { inTransaction } from './transaction.js';
import { createMemberOperation } from './members.js';
import { registerCasePolicy } from './case-records.js';
import { loadCaseRecord } from './case-lookup.js';
import { loadCasePlan, participantBinding } from './case-audience.js';

/** Recipient metadata/navigation only. No answer, conversation, attachment or Staff-note query. */
export function createCaseContactNavigation({ pool, clock, authorize, authorizeCaseParticipant, policy, verification }) {
  const memberOperation = createMemberOperation({ pool, clock });
  async function self(actor, guildId) {
    const grant = operatorGrant(actor);
    requireCondition(guildId === policy.guildId && grant.guildId === guildId &&
      await authorize('case.create', actor, { guildId, userId: grant.userId }) === true, 'OPERATION_DENIED');
    return grant.userId;
  }
  async function invited(client, actor, row) {
    const userId = await self(actor, row.guild_id);
    requireCondition(row.type === 'staff-contact' && row.policy_version === policy.version, 'CASE_DESTINATION_DENIED');
    await registerCasePolicy(client, policy);
    const invitation = (await client.query(`SELECT p.* FROM sophie_core.case_participants p
      JOIN sophie_core.case_intakes i ON i.guild_id = p.guild_id AND i.case_id = p.case_id
      WHERE p.guild_id = $1 AND p.case_id = $2 AND p.user_id = $3 AND p.status = 'active'
        AND i.contact_status IN ('confirmed', 'superseded')`, [row.guild_id, row.id, userId])).rows[0];
    requireCondition(invitation !== undefined && await authorizeCaseParticipant(participantBinding(invitation)) === true, 'CASE_DESTINATION_DENIED');
    return userId;
  }
  async function destination(client, actor, member, caseToken) {
    const row = await loadCaseRecord(client, { guildId: member.guildId, token: caseToken, lock: true });
    requireCondition(row.user_id === member.userId && member.observation.present && Number(row.presence_epoch) === member.presenceEpoch, 'CASE_DESTINATION_DENIED');
    await invited(client, actor, row); requireFreshObservation(member.observation, clock());
    if (row.state === 'pending' || row.state === 'closing') return { state: 'preparing', caseToken, createdAt: Number(row.created_at_ms) };
    requireCondition(['open', 'closed'].includes(row.state) && row.desired_access === row.state, 'CASE_DESTINATION_DENIED');
    requireId(row.channel_id);
    return { state: 'inspect', plan: await loadCasePlan(client, row), channelId: row.channel_id, access: row.state, createdAt: Number(row.created_at_ms) };
  }
  return Object.freeze({
    async listStaffContactReferences({ actor, guildId, after = null }) {
      if (after !== null) requireCaseToken(after);
      return inTransaction(pool, async client => {
        const userId = await self(actor, guildId); let cursor = null;
        if (after !== null) { cursor = await loadCaseRecord(client, { guildId, token: after }); await invited(client, actor, cursor); }
        const rows = (await client.query(`SELECT r.id, r.user_id AS opener_id, r.created_at_ms, p.operation_token, i.guild_id, i.user_id, i.presence_epoch
          FROM sophie_core.case_participants i JOIN sophie_core.case_reservations r ON r.guild_id = i.guild_id AND r.id = i.case_id
          JOIN sophie_core.case_provisions p ON p.guild_id = r.guild_id AND p.case_id = r.id
          JOIN sophie_core.case_intakes c ON c.guild_id = r.guild_id AND c.case_id = r.id
          WHERE i.guild_id = $1 AND i.user_id = $2 AND i.status = 'active' AND r.type = 'staff-contact' AND p.policy_version = $3
            AND c.contact_status IN ('confirmed', 'superseded') AND r.state IN ('pending', 'open', 'closing', 'closed')
            AND ($4::bigint IS NULL OR (r.created_at_ms, r.id COLLATE "C") < ($4::bigint, $5::text COLLATE "C"))
          ORDER BY r.created_at_ms DESC, r.id COLLATE "C" DESC LIMIT $6`,
        [guildId, userId, policy.version, cursor?.created_at_ms ?? null, cursor?.id ?? null, CONTACT_PAGE_SIZE + 1])).rows;
        const page = rows.slice(0, CONTACT_PAGE_SIZE), references = [];
        for (const row of page) if (await authorizeCaseParticipant(participantBinding(row)) === true) references.push({ token: row.operation_token, openerId: row.opener_id });
        await self(actor, guildId);
        return { references, next: rows.length > CONTACT_PAGE_SIZE ? page.at(-1).operation_token : null };
      });
    },
    async describeStaffContactReference({ actor, guildId, caseToken }) {
      requireCaseToken(caseToken);
      return inTransaction(pool, async client => {
        await self(actor, guildId);
        const row = await loadCaseRecord(client, { guildId, token: caseToken }); await invited(client, actor, row);
        return { openerId: row.user_id };
      });
    },
    async describeStaffContactDestination({ actor, observation, caseToken }) {
      requireCaseToken(caseToken);
      return memberOperation(observation, (client, member) => destination(client, actor, member, caseToken));
    },
    async confirmStaffContactDestination({ actor, observation, caseToken, proof }) {
      requireCaseToken(caseToken);
      return memberOperation(observation, async (client, member) => {
        const current = await destination(client, actor, member, caseToken); requireCondition(current.state === 'inspect', 'CASE_DESTINATION_DENIED');
        requireCondition(typeof verification?.channel === 'function', 'CASE_VERIFIER_REQUIRED');
        const channel = await verification.channel(proof, current.plan, current.access); requireCaseChannel(channel, current.plan, policy, current.access);
        requireCondition(channel.id === current.channelId, 'CASE_CHANNEL_MISMATCH');
        return { state: 'ready', guildId: member.guildId, channelId: current.channelId, access: current.access };
      });
    },
  });
}
