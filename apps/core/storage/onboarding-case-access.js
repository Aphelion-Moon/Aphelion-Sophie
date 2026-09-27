import { loadCasePlan } from './case-audience.js';
import { requireCondition } from '../../../contracts/validation.js';
import { validateCasePolicy, requireCaseChannel } from '../../../modules/tickets/channel-policy.js';
import { registerCasePolicy } from './case-records.js';

/** Shared private-case ownership and proof checks for Onboarding use cases. */
export function createOnboardingCaseAccess({ policy, verification }) {
  if (policy !== null) validateCasePolicy(policy);
  const fixed = policy === null ? null : structuredClone(policy);
  async function lookup(client, member, session, currentPolicy, lock, channelId = null) {
      requireCondition(fixed !== null, 'CASE_CONFIGURATION_REQUIRED');
      if (currentPolicy) await registerCasePolicy(client, fixed);
      const row = (await client.query(`SELECT r.id, r.guild_id, r.user_id, r.state, r.channel_id, r.type, r.onboarding_retirement, p.policy_version, p.operation_token, p.presence_epoch, p.audience_version
        FROM sophie_core.shuttle_cases b JOIN sophie_core.case_reservations r ON (r.id = b.case_id OR ($4::text IS NOT NULL AND r.id = ANY(b.previous_case_ids))) AND r.guild_id = b.guild_id AND r.user_id = b.user_id
        JOIN sophie_core.case_provisions p ON p.case_id = r.id AND p.guild_id = r.guild_id
        WHERE b.session_id = $1 AND b.guild_id = $2 AND b.user_id = $3 AND ($4::text IS NULL OR r.channel_id = $4)${lock ? ' FOR UPDATE OF r, p' : ''}`,
      [session.id, member.guildId, member.userId, channelId])).rows[0];
      requireCondition(row?.type === 'shuttle' && member.guildId === fixed.guildId, 'SHUTTLE_CASE_UNAVAILABLE');
      requireCondition(row.policy_version === fixed.version, 'CASE_POLICY_CHANGED');
      const plan = await loadCasePlan(client, row); return { row, plan };
  }
  return Object.freeze({
    binding: (client, member, session, currentPolicy = true, channelId = null) => lookup(client, member, session, currentPolicy, true, channelId),
    // A read-only descriptor must not take session/case locks against an active worker.
    describeBinding: (client, member, session) => lookup(client, member, session, true, false),
    async verify(proof, plan, channelId, retired) {
      requireCondition(typeof verification?.candidate === 'function' && typeof verification?.channel === 'function', 'CASE_VERIFIER_REQUIRED');
      const channel = await verification.candidate(proof, plan);
      requireCondition(channel.id === channelId, 'CASE_CHANNEL_MISMATCH');
      if (!retired) {
        await verification.channel(proof, plan, false);
        requireCaseChannel(channel, plan, fixed, false);
      }
    },
  });
}
