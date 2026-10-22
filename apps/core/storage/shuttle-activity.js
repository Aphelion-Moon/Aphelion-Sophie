import { createHash, randomBytes } from 'node:crypto';
import { ContractError, requireCondition, requireFreshObservation, requireInteger, requireName } from '../../../contracts/validation.js';
import { requireOnboardingEligibility } from '../../../modules/membership/index.js';
import { advanceOnboarding, backOnboarding, retryWhitelist, startOnboarding } from '../../../modules/onboarding/index.js';
import { ACTIVITY_ACTIONS, ACTIVITY_STATUSES, activityRunView, activityStops, requireActivityRequestId } from '../../../modules/onboarding/activity.js';
import { createMemberOperation } from './members.js';
import { getDefinition, getPublication, getSession, saveSession } from './onboarding-records.js';
import { receipt, saveReceipt } from './receipts.js';
import { enqueue } from './outbox.js';

// Receipts are keyed per member, so one member's request key can never replay another's.
const receiptId = (userId, requestId) => `activity.${createHash('sha256').update(`${userId}:${requestId}`).digest('hex')}`;
const ACTIONS = Object.freeze({ advance: advanceOnboarding, back: backOnboarding, retry: retryWhitelist });

/**
 * Shuttle runs driven from the Activity (P41). A run is an ordinary session with the same domain rules, nonce
 * rotation, grant effect and receipts as the channel Shuttle, but no Onboarding channel. A member whose current run
 * belongs to a channel finishes it there. While the Activity is `testing`, only the server owner and current lead
 * ops role holders are admitted; every request reads Discord afresh through `authorize`. No AI.
 */
export function createShuttleActivityStore({ pool, clock, authorize, definitionId, status }) {
  requireName(definitionId);
  requireCondition(typeof authorize === 'function' && ACTIVITY_STATUSES.includes(status), 'ACTIVITY_CONFIGURATION_INVALID');
  const memberOperation = createMemberOperation({ pool, clock });
  const scope = member => ({ guildId: member.guildId, userId: member.userId });

  /** null when admitted; otherwise what the member sees instead. */
  async function refusal(actor, member) {
    if (status === 'testing' && await authorize('shuttle.activity.test', actor, scope(member)) !== true) return 'closed';
    if (await authorize('shuttle.self', actor, scope(member)) !== true) return 'unavailable';
    try { requireOnboardingEligibility(member, clock()); }
    catch (error) { if (error instanceof ContractError) return 'unavailable'; throw error; }
    return null;
  }
  async function admit(actor, member) {
    const refused = await refusal(actor, member);
    requireCondition(refused === null, refused === 'closed' ? 'ACTIVITY_CLOSED' : 'OPERATION_DENIED');
  }
  async function currentRun(client, member) {
    return (await client.query(`SELECT s.state, a.session_id IS NOT NULL AS activity
      FROM sophie_core.sessions s LEFT JOIN sophie_core.shuttle_activity_runs a ON a.session_id = s.id
      WHERE s.guild_id = $1 AND s.user_id = $2 AND s.current FOR UPDATE OF s`, [member.guildId, member.userId])).rows[0] ?? null;
  }
  /** A run that can carry on: same eligibility and still-published guidance. Otherwise a new run replaces it. */
  async function carriesOn(client, session, member) {
    if (session.eligibilityEpoch !== member.eligibilityEpoch) return false;
    return (await getDefinition(client, session.definitionId, session.definitionVersion)).status === 'published';
  }
  async function latestDefinition(client) {
    return (await client.query(`SELECT definition FROM sophie_core.definitions WHERE id = $1
      AND definition->>'status' = 'published' ORDER BY version DESC LIMIT 1 FOR SHARE`, [definitionId])).rows[0]?.definition ?? null;
  }
  async function view(client, session, member) {
    return activityRunView({ session, publication: await getPublication(client, session), whitelist: member.observation.whitelist === true });
  }
  async function replay(client, member, previous) {
    const session = await getSession(client, previous.sessionId, member.guildId, member.userId);
    return { duplicate: true, run: await view(client, session, member) };
  }

  return Object.freeze({
    /** What the Activity shows now. Reads only; it records the fresh membership observation like every member action. */
    async describe({ actor, observation }) {
      return memberOperation(observation, async (client, member) => {
        const refused = await refusal(actor, member);
        if (refused) return { state: refused };
        const found = await currentRun(client, member);
        if (found && !found.activity) return { state: 'elsewhere' };
        if (found && await carriesOn(client, found.state, member)) return { state: 'run', run: await view(client, found.state, member) };
        // The member's last Activity run, if it finished in this membership and Discord still shows Whitelist.
        const last = (await client.query(`SELECT s.state FROM sophie_core.shuttle_activity_runs a JOIN sophie_core.sessions s ON s.id = a.session_id
          WHERE a.guild_id = $1 AND a.user_id = $2 ORDER BY a.started_at_ms DESC, a.session_id DESC LIMIT 1`, [member.guildId, member.userId])).rows[0]?.state;
        if (!found && last?.status === 'complete' && last.eligibilityEpoch === member.eligibilityEpoch && member.observation.whitelist) {
          return { state: 'run', run: await view(client, last, member) };
        }
        const published = await latestDefinition(client);
        if (!published) return { state: 'unpublished' };
        const publication = await getPublication(client, { definitionId: published.id, definitionVersion: published.version });
        return { state: 'ready', mode: member.observation.whitelist ? 'refresh' : 'qualification', stops: activityStops(publication),
          whitelist: member.observation.whitelist ? 'confirmed' : 'none' };
      });
    },

    /** Starts a run, or resumes the current Activity run. */
    async board({ actor, observation, requestId }) {
      requireActivityRequestId(requestId);
      return memberOperation(observation, async (client, member) => {
        await admit(actor, member);
        const id = receiptId(member.userId, requestId);
        const previous = await receipt(client, member.guildId, member.userId, id, { action: 'activity.board', definitionId });
        if (previous) return replay(client, member, previous);
        const found = await currentRun(client, member);
        requireCondition(!found || found.activity, 'SHUTTLE_ELSEWHERE');
        if (found && await carriesOn(client, found.state, member)) {
          await saveReceipt(client, member.guildId, id, { sessionId: found.state.id });
          return { duplicate: false, resumed: true, run: await view(client, found.state, member) };
        }
        // A run from an earlier membership or withdrawn guidance never continues: it stops being current and a new run starts.
        if (found) await client.query('UPDATE sophie_core.sessions SET current = false WHERE id = $1', [found.state.id]);
        const published = await latestDefinition(client);
        requireCondition(published !== null, 'DEFINITION_NOT_FOUND');
        const session = startOnboarding({ id: `activity.${randomBytes(16).toString('hex')}`, nonce: randomBytes(16).toString('hex'),
          member, definition: published, now: clock() });
        await getPublication(client, session);
        requireFreshObservation(member.observation, clock());
        await client.query(`INSERT INTO sophie_core.sessions (id, guild_id, user_id, definition_id, definition_version, current, state)
          VALUES ($1, $2, $3, $4, $5, true, $6)`, [session.id, member.guildId, member.userId, session.definitionId, session.definitionVersion, session]);
        await client.query(`INSERT INTO sophie_core.shuttle_activity_runs (session_id, guild_id, user_id, started_at_ms)
          VALUES ($1, $2, $3, $4)`, [session.id, member.guildId, member.userId, clock()]);
        await saveReceipt(client, member.guildId, id, { sessionId: session.id });
        return { duplicate: false, resumed: false, run: await view(client, session, member) };
      });
    },

    /** Continue, Back or Check. The client names the version it showed; anything else is out of date. */
    async act({ actor, observation, requestId, action, expectedVersion }) {
      requireActivityRequestId(requestId); requireInteger(expectedVersion);
      requireCondition(ACTIVITY_ACTIONS.includes(action), 'INVALID_SHUTTLE_ACTION');
      return memberOperation(observation, async (client, member) => {
        await admit(actor, member);
        const id = receiptId(member.userId, requestId);
        const previous = await receipt(client, member.guildId, member.userId, id, { action: `activity.${action}`, expectedVersion });
        if (previous) return replay(client, member, previous);
        const found = await currentRun(client, member);
        requireCondition(found?.activity === true, 'SHUTTLE_NOT_ACTIVE');
        const session = found.state;
        requireCondition(session.eligibilityEpoch === member.eligibilityEpoch, 'SHUTTLE_RESTART_REQUIRED');
        requireCondition(session.version === expectedVersion, 'STALE_SHUTTLE_CONTROL');
        const definition = await getDefinition(client, session.definitionId, session.definitionVersion);
        const command = { guildId: member.guildId, userId: member.userId, expectedVersion, nonce: session.nonce, nextNonce: randomBytes(16).toString('hex') };
        const change = ACTIONS[action](session, member, definition, command, clock());
        await saveSession(client, change.session, member);
        for (const effect of change.effects) await enqueue(client, effect);
        requireFreshObservation(member.observation, clock());
        await saveReceipt(client, member.guildId, id, { sessionId: session.id });
        return { duplicate: false, run: await view(client, change.session, member), queued: change.effects.length > 0 };
      });
    },
  });
}
