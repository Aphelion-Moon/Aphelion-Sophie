import { requireCondition, requireFreshObservation, requireName } from '../../../contracts/validation.js';
import { requireOnboardingEligibility } from '../../../modules/membership/index.js';
import { startOnboarding } from '../../../modules/onboarding/index.js';
import { validateCasePolicy } from '../../../modules/tickets/channel-policy.js';
import { createMemberOperation } from './members.js';
import { receipt, saveReceipt } from './receipts.js';
import { registerCasePolicy, reserveCaseRecords } from './case-records.js';
import { enqueue } from './outbox.js';
import { getPublication, requestOnboardingScreen } from './onboarding-records.js';

/** Self-service entry only. There is no generic endpoint for caller-supplied sessions/cases. */
export function createOnboardingEntryStore({ pool, clock, authorize, policy }) {
  if (policy !== null) validateCasePolicy(policy);
  const fixed = policy === null ? null : structuredClone(policy);
  const memberOperation = createMemberOperation({ pool, clock });
  async function inspectCase(client, member, caseId, interactionId) {
    const pending = await client.query(`SELECT 1 FROM sophie_core.outbox WHERE guild_id = $1 AND kind = 'case.provision'
      AND effect->>'caseId' = $2 AND status IN ('ready', 'leased', 'parked') LIMIT 1`, [member.guildId, caseId]);
    if (!pending.rowCount) await enqueue(client, { kind: 'case.provision', operationId: `case.shuttle.${interactionId}`,
      guildId: member.guildId, userId: member.userId, caseId, type: 'shuttle' });
  }
  async function boundCase(client, member, session, replacement) {
    requireCondition(session.eligibilityEpoch === member.eligibilityEpoch, 'SHUTTLE_RESTART_REQUIRED');
    const definition = (await client.query('SELECT definition FROM sophie_core.definitions WHERE id = $1 AND version = $2 FOR SHARE',
      [session.definitionId, session.definitionVersion])).rows[0]?.definition;
    requireCondition(definition?.status === 'published', 'DEFINITION_WITHDRAWN');
    const row = (await client.query(`SELECT r.id, r.state, r.channel_id, r.onboarding_retirement FROM sophie_core.shuttle_cases s
      JOIN sophie_core.case_reservations r ON r.id = s.case_id AND r.guild_id = s.guild_id AND r.user_id = s.user_id
      JOIN sophie_core.case_provisions p ON p.case_id = r.id AND p.guild_id = r.guild_id
      WHERE s.session_id = $1 AND s.guild_id = $2 AND s.user_id = $3 AND r.type = 'shuttle'
        AND p.presence_epoch = $4 AND p.policy_version = $5 FOR UPDATE OF r, p`,
    [session.id, member.guildId, member.userId, member.presenceEpoch, fixed.version])).rows[0];
    if (row?.onboarding_retirement === 'removed' && replacement) {
      await reserveCaseRecords(client, member, { id: replacement.caseId, type: 'shuttle', limits: replacement.limits, policy: fixed, clock });
      await client.query(`UPDATE sophie_core.shuttle_cases SET previous_case_ids=array_append(previous_case_ids,case_id), case_id=$2 WHERE session_id=$1`, [session.id, replacement.caseId]);
      return { id: replacement.caseId, state: 'pending', channelId: null };
    }
    requireCondition(row && row.onboarding_retirement === null && ['pending', 'open'].includes(row.state), 'SHUTTLE_CASE_UNAVAILABLE');
    return { id: row.id, state: row.state, channelId: row.channel_id };
  }
  return Object.freeze({
    async openOnboarding({ actor, interactionId, id, nonce, caseId, observation, definitionId, limits }) {
      [id, nonce, caseId, definitionId].forEach(requireName);
      return memberOperation(observation, async (client, member) => {
        requireCondition(await authorize('shuttle.self', actor, { guildId: member.guildId, userId: member.userId }) === true, 'OPERATION_DENIED');
        requireOnboardingEligibility(member, clock());
        await registerCasePolicy(client, fixed);
        requireCondition(member.guildId === fixed.guildId, 'FOREIGN_GUILD');
        const previous = await receipt(client, member.guildId, member.userId, interactionId, { action: 'shuttle.open', definitionId });
        const found = previous ? await client.query(`SELECT state, current FROM sophie_core.sessions
          WHERE id = $1 AND guild_id = $2 AND user_id = $3 FOR UPDATE`, [previous.sessionId, member.guildId, member.userId]) :
          await client.query('SELECT state, current FROM sophie_core.sessions WHERE guild_id = $1 AND user_id = $2 AND current FOR UPDATE', [member.guildId, member.userId]);
        if (found.rowCount) {
          const session = found.rows[0].state;
          requireCondition(session.definitionId === definitionId, 'DEFINITION_MISMATCH');
          const caseRecord = await boundCase(client, member, session, previous ? null : { caseId, limits });
          // Replaying an old receipt never starts a new run or reconstructs an entitlement.
          requireCondition(session.status !== 'complete' || member.observation.whitelist, 'SHUTTLE_RESTART_REQUIRED');
          await getPublication(client, session);
          await inspectCase(client, member, caseRecord.id, interactionId);
          // An old completed receipt cannot replace the screen of a newer repeat.
          if (!previous || found.rows[0].current) await requestOnboardingScreen(client, member, session, interactionId, { recover: true });
          requireFreshObservation(member.observation, clock());
          if (!previous) await saveReceipt(client, member.guildId, interactionId, { sessionId: session.id });
          return { duplicate: previous !== null, resumed: true, session, case: caseRecord };
        }
        requireCondition(!previous, 'SESSION_NOT_FOUND');
        const published = (await client.query(`SELECT definition FROM sophie_core.definitions WHERE id = $1
          AND definition->>'status' = 'published' ORDER BY version DESC LIMIT 1 FOR SHARE`, [definitionId])).rows[0]?.definition;
        requireCondition(published !== undefined, 'DEFINITION_NOT_FOUND');
        const session = startOnboarding({ id, nonce, member, definition: published, now: clock() });
        await getPublication(client, session);
        const reusable = (await client.query(`SELECT r.id, r.state, r.channel_id FROM sophie_core.case_reservations r
          JOIN sophie_core.case_provisions p ON p.case_id = r.id AND p.guild_id = r.guild_id
          WHERE r.guild_id = $1 AND r.user_id = $2 AND r.type = 'shuttle' AND r.state IN ('pending', 'open')
            AND r.onboarding_retirement IS NULL
            AND p.presence_epoch = $3 AND p.policy_version = $4
          ORDER BY r.created_at_ms DESC, r.id DESC LIMIT 1 FOR UPDATE OF r, p`,
        [member.guildId, member.userId, member.presenceEpoch, fixed.version])).rows[0];
        if (!reusable) await reserveCaseRecords(client, member, { id: caseId, type: 'shuttle', limits, policy: fixed, clock });
        requireFreshObservation(member.observation, clock());
        await client.query(`INSERT INTO sophie_core.sessions (id, guild_id, user_id, definition_id, definition_version, current, state)
          VALUES ($1, $2, $3, $4, $5, true, $6)`, [id, member.guildId, member.userId, session.definitionId, session.definitionVersion, session]);
        const chosen = reusable?.id ?? caseId;
        if (reusable) await inspectCase(client, member, chosen, interactionId);
        await client.query('INSERT INTO sophie_core.shuttle_cases (session_id, case_id, guild_id, user_id) VALUES ($1, $2, $3, $4)',
          [id, chosen, member.guildId, member.userId]);
        await requestOnboardingScreen(client, member, session, interactionId);
        await saveReceipt(client, member.guildId, interactionId, { sessionId: id });
        return { duplicate: false, resumed: false, session,
          case: { id: chosen, state: reusable?.state ?? 'pending', channelId: reusable?.channel_id ?? null } };
      });
    },
  });
}
