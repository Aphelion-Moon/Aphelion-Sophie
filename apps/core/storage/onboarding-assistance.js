import { randomBytes } from 'node:crypto';
import { requireCondition, requireFreshObservation, requireId, requireInteger } from '../../../contracts/validation.js';
import { operatorGrant } from '../../../contracts/operator-grant.js';
import { validateCasePolicy } from '../../../modules/tickets/channel-policy.js';
import { resumeOnboarding } from '../../../modules/onboarding/index.js';
import { createMemberOperation } from './members.js';
import { inTransaction } from './transaction.js';
import { registerCasePolicy } from './case-records.js';
import { createOnboardingCaseAccess } from './onboarding-case-access.js';
import { getSession, getDefinition, getPublication, saveSession, requestOnboardingScreen } from './onboarding-records.js';
import { receipt, saveReceipt } from './receipts.js';

/** Staff assistance metadata only; resolving help never advances progress or changes roles. */
export function createOnboardingAssistanceStore({ pool, clock, authorize, policy }) {
  if (policy !== null) validateCasePolicy(policy);
  const fixed = policy === null ? null : structuredClone(policy);
  const memberOperation = createMemberOperation({ pool, clock });
  const { binding } = createOnboardingCaseAccess({ policy, verification: null });
  async function access(actor, guildId, openerId = actor?.userId) {
    requireId(guildId);
    requireCondition(fixed !== null && guildId === fixed.guildId, 'CASE_CONFIGURATION_REQUIRED');
    requireCondition(await authorize('case.manage', actor, { guildId, type: 'shuttle', openerId }) === true, 'OPERATION_DENIED');
  }
  async function request(client, guildId, requestId) {
    requireId(requestId);
    const row = (await client.query(`SELECT h.user_id, h.session_id, r.type, s.current AS session_current FROM sophie_core.shuttle_help_requests h
      JOIN sophie_core.sessions s ON s.id = h.session_id AND s.guild_id = h.guild_id AND s.user_id = h.user_id
      JOIN sophie_core.shuttle_cases b ON b.session_id = h.session_id AND b.guild_id = h.guild_id AND b.user_id = h.user_id
      JOIN sophie_core.case_reservations r ON r.id = b.case_id AND r.guild_id = h.guild_id AND r.user_id = h.user_id
      WHERE h.guild_id = $1 AND h.interaction_id = $2`, [guildId, requestId])).rows[0];
    requireCondition(row?.type === 'shuttle', 'SHUTTLE_HELP_NOT_FOUND'); return row;
  }
  return Object.freeze({
    async listOnboardingHelp({ actor, guildId, after = null }) {
      if (after !== null) requireId(after);
      return inTransaction(pool, async client => {
        await access(actor, guildId); await registerCasePolicy(client, fixed);
        const rows = (await client.query(`SELECT h.interaction_id, h.user_id, h.revision, r.channel_id, r.state AS case_state,
          (s.state->>'helpPaused')::boolean AS paused
          FROM sophie_core.shuttle_help_requests h
          JOIN sophie_core.shuttle_cases b ON b.session_id = h.session_id AND b.guild_id = h.guild_id AND b.user_id = h.user_id
          JOIN sophie_core.sessions s ON s.id = h.session_id AND s.guild_id = h.guild_id AND s.user_id = h.user_id
          JOIN sophie_core.case_reservations r ON r.id = b.case_id AND r.guild_id = h.guild_id AND r.user_id = h.user_id
          WHERE h.guild_id = $1 AND h.status = 'open' AND r.type = 'shuttle'
            AND ($2::numeric IS NULL OR h.interaction_id::numeric > $2::numeric)
          ORDER BY h.interaction_id::numeric LIMIT 6`, [guildId, after])).rows;
        const page = rows.slice(0, 5).map(row => ({ requestId: row.interaction_id, userId: row.user_id, revision: row.revision,
          channelId: row.channel_id, caseState: row.case_state, paused: row.paused }));
        await access(actor, guildId);
        return { state: 'ready', guildId, entries: page, next: rows.length > 5 ? page.at(-1).requestId : null };
      });
    },
    async describeOnboardingHelp({ actor, guildId, requestId }) {
      return inTransaction(pool, async client => {
        await access(actor, guildId); await registerCasePolicy(client, fixed);
        const row = await request(client, guildId, requestId);
        await access(actor, guildId, row.user_id);
        return { userId: row.user_id };
      });
    },
    async resolveOnboardingHelp({ actor, interactionId, requestId, expectedRevision, observation }) {
      requireId(requestId); requireInteger(expectedRevision, 0, 2_147_483_646);
      return memberOperation(observation, async (client, member) => {
        await access(actor, member.guildId);
        const found = await request(client, member.guildId, requestId);
        requireCondition(found.user_id === member.userId, 'MEMBER_MISMATCH');
        const session = await getSession(client, found.session_id, member.guildId, member.userId);
        const definition = await getDefinition(client, session.definitionId, session.definitionVersion);
        const bound = await binding(client, member, session);
        await access(actor, member.guildId, member.userId);
        const current = (await client.query(`SELECT status, revision FROM sophie_core.shuttle_help_requests
          WHERE guild_id = $1 AND interaction_id = $2 FOR UPDATE`, [member.guildId, requestId])).rows[0];
        const grant = operatorGrant(actor);
        const previous = await receipt(client, member.guildId, grant.userId, interactionId,
          { action: 'shuttle.help.resolve', requestId, expectedRevision });
        if (previous) return { duplicate: true, resumed: previous.resumed ?? false };
        requireCondition(current.status === 'open' && current.revision === expectedRevision, 'STALE_SHUTTLE_HELP');
        const live = found.session_current && bound.row.state === 'open' && definition.status === 'published' &&
          session.eligibilityEpoch === member.eligibilityEpoch && bound.plan.presenceEpoch === member.presenceEpoch;
        let resumed = null;
        if (session.helpPaused && live) {
          requireCondition((await getPublication(client, session)).helpPauses, 'INVALID_SHUTTLE_PAUSE');
          // The pure guard rejects current Muzzled/absence/revocation and leaves the request open.
          resumed = resumeOnboarding(session, member, definition, { guildId: member.guildId, userId: member.userId,
            expectedVersion: session.version, nonce: session.nonce, nextNonce: randomBytes(16).toString('hex') }, clock()).session;
        }
        await client.query("UPDATE sophie_core.shuttle_help_requests SET status = 'resolved', revision = revision + 1 WHERE guild_id = $1 AND interaction_id = $2",
          [member.guildId, requestId]);
        await client.query(`INSERT INTO sophie_core.shuttle_help_resolutions (guild_id, interaction_id, request_id, revision, operator_grant, resumed_version)
          VALUES ($1, $2, $3, $4, $5, $6)`, [member.guildId, interactionId, requestId, current.revision + 1, grant, resumed?.version ?? null]);
        // A historical request must never replace the screen of a newer repeat. Ineligible
        // members keep their records; normal entry/reconciliation controls future display.
        const screen = await client.query('SELECT 1 FROM sophie_core.shuttle_screens WHERE session_id = $1 AND current', [session.id]);
        if (resumed !== null) await saveSession(client, resumed, member);
        else if (!session.helpPaused && screen.rowCount && bound.row.state === 'open' && definition.status === 'published' &&
          session.eligibilityEpoch === member.eligibilityEpoch && bound.plan.presenceEpoch === member.presenceEpoch &&
          member.observation.present && !member.observation.muzzled && !member.muteRequested) {
          await requestOnboardingScreen(client, member, session, `help-resolved.${interactionId}`, { replace: true });
        }
        await access(actor, member.guildId, member.userId); requireFreshObservation(member.observation, clock());
        await saveReceipt(client, member.guildId, interactionId, { requestId, revision: current.revision + 1, resumed: resumed !== null });
        return { duplicate: false, resumed: resumed !== null };
      });
    },
  });
}
