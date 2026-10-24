import { createHash, randomBytes } from 'node:crypto';
import { ContractError, requireCondition, requireFreshObservation, requireInteger, requireName } from '../../../contracts/validation.js';
import { requireOnboardingEligibility } from '../../../modules/membership/index.js';
import { advanceOnboarding, backOnboarding, retryWhitelist, startOnboarding } from '../../../modules/onboarding/index.js';
import { ACTIVITY_ACTIONS, ACTIVITY_STATUSES, activityRunView, activityStops, requireActivityRequestId } from '../../../modules/onboarding/activity.js';
import { effectiveLayout } from '../../../modules/onboarding/activity-layout.js';
import { readPublishedActivityLayout } from './activity-layout.js';
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
export function createShuttleActivityStore({ pool, clock, authorize, definitionId, status, defaults = null, deliverWhitelist = true }) {
  requireName(definitionId);
  requireCondition(typeof authorize === 'function' && ACTIVITY_STATUSES.includes(status), 'ACTIVITY_CONFIGURATION_INVALID');
  const memberOperation = createMemberOperation({ pool, clock });
  const scope = observation => ({ guildId: observation.guildId, userId: observation.userId });

  /**
   * The capability checks, made before the member row is locked: they read Discord, and holding the lock across that call
   * made the same member's next request wait past the 3 s lock timeout (owner report, 24 October 2026: PG_55P03, and the
   * link lost after leaving the window). Each still runs on every request; eligibility is read under the lock.
   * null when allowed; otherwise what the member sees instead.
   */
  async function capability(actor, observation) {
    if (status === 'testing' && await authorize('shuttle.activity.test', actor, scope(observation)) !== true) return 'closed';
    if (await authorize('shuttle.self', actor, scope(observation)) !== true) return 'unavailable';
    return null;
  }
  /** The capability outcome, then the locked member's current eligibility. */
  function refusal(refused, member) {
    if (refused) return refused;
    try { requireOnboardingEligibility(member, clock()); }
    catch (error) { if (error instanceof ContractError) return 'unavailable'; throw error; }
    return null;
  }
  function admit(refused, member) {
    const outcome = refusal(refused, member);
    requireCondition(outcome === null, outcome === 'closed' ? 'ACTIVITY_CLOSED' : 'OPERATION_DENIED');
  }
  async function currentRun(client, member) {
    return (await client.query(`SELECT s.state, a.session_id IS NOT NULL AS activity
      FROM sophie_core.sessions s LEFT JOIN sophie_core.shuttle_activity_runs a ON a.session_id = s.id
      WHERE s.guild_id = $1 AND s.user_id = $2 AND s.current FOR UPDATE OF s`, [member.guildId, member.userId])).rows[0] ?? null;
  }
  /**
   * A run that can carry on: same eligibility and still-published guidance. A run still being read must also be on the
   * latest published version (owner decision, 24 October 2026: a story update disposes of progress, so nobody finishes an
   * outdated story). A run waiting on its Whitelist grant or already finished keeps its version. Otherwise a new run
   * replaces it.
   */
  async function carriesOn(client, session, member) {
    if (session.eligibilityEpoch !== member.eligibilityEpoch) return false;
    if ((await getDefinition(client, session.definitionId, session.definitionVersion)).status !== 'published') return false;
    return session.status !== 'active' || session.definitionVersion === (await latestDefinition(client))?.version;
  }
  async function latestDefinition(client) {
    return (await client.query(`SELECT definition FROM sophie_core.definitions WHERE id = $1
      AND definition->>'status' = 'published' ORDER BY version DESC LIMIT 1 FOR SHARE`, [definitionId])).rows[0]?.definition ?? null;
  }
  /** The scenes, moments and curated arrival list for a publication: defaults, then the published layout. */
  async function layoutFor(client, member, publication) {
    const published = await readPublishedActivityLayout(client, member.guildId);
    return effectiveLayout({ stages: publication.stages, defaults, layout: published?.document ?? null });
  }
  async function view(client, session, member) {
    const publication = await getPublication(client, session), layout = await layoutFor(client, member, publication);
    // The curated arrival list travels beside the view; the HTTP layer shows only channels the member can see, and only
    // once Whitelist is confirmed.
    return Object.defineProperty(activityRunView({ session, publication, whitelist: member.observation.whitelist === true, layout }),
      'arrivalChannels', { value: layout.arrival, enumerable: false });
  }
  async function replay(client, member, previous) {
    const session = await getSession(client, previous.sessionId, member.guildId, member.userId);
    return { duplicate: true, run: await view(client, session, member) };
  }

  return Object.freeze({
    /** What the Activity shows now. Reads only; it records the fresh membership observation like every member action. */
    async describe({ actor, observation }) {
      const allowed = await capability(actor, observation);
      return memberOperation(observation, async (client, member) => {
        const refused = refusal(allowed, member);
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
        return { state: 'ready', mode: member.observation.whitelist ? 'refresh' : 'qualification', stops: activityStops(publication, await layoutFor(client, member, publication)),
          whitelist: member.observation.whitelist ? 'confirmed' : 'none' };
      });
    },

    /** Starts a run, or resumes the current Activity run. */
    async board({ actor, observation, requestId }) {
      requireActivityRequestId(requestId);
      const allowed = await capability(actor, observation);
      return memberOperation(observation, async (client, member) => {
        admit(allowed, member);
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
      const allowed = await capability(actor, observation);
      return memberOperation(observation, async (client, member) => {
        admit(allowed, member);
        const id = receiptId(member.userId, requestId);
        const previous = await receipt(client, member.guildId, member.userId, id, { action: `activity.${action}`, expectedVersion });
        if (previous) return replay(client, member, previous);
        const found = await currentRun(client, member);
        requireCondition(found?.activity === true, 'SHUTTLE_NOT_ACTIVE');
        const session = found.state;
        requireCondition(await carriesOn(client, session, member), 'SHUTTLE_RESTART_REQUIRED');
        requireCondition(session.version === expectedVersion, 'STALE_SHUTTLE_CONTROL');
        const definition = await getDefinition(client, session.definitionId, session.definitionVersion);
        const command = { guildId: member.guildId, userId: member.userId, expectedVersion, nonce: session.nonce, nextNonce: randomBytes(16).toString('hex') };
        const change = ACTIONS[action](session, member, definition, command, clock());
        await saveSession(client, change.session, member);
        // deliverWhitelist false queues no grant (the run waits at the door until the role appears). Production grants since
        // 24 October 2026 (owner decision); the option stays for runtimes where another bot grants it.
        const effects = deliverWhitelist ? change.effects : change.effects.filter(effect => !String(effect.kind).startsWith('whitelist.'));
        for (const effect of effects) await enqueue(client, effect);
        requireFreshObservation(member.observation, clock());
        await saveReceipt(client, member.guildId, id, { sessionId: session.id });
        return { duplicate: false, run: await view(client, change.session, member), queued: effects.length > 0 };
      });
    },

    /**
     * Reset journey (owner decision, 24 October 2026): the member's Activity run still being read stops being current, so
     * boarding starts again at the first stop on the latest story. The run's record is kept. A run waiting on its Whitelist
     * grant, or one already finished, is not reset (a finished run offers riding again instead).
     */
    async reset({ actor, observation, requestId }) {
      requireActivityRequestId(requestId);
      const allowed = await capability(actor, observation);
      return memberOperation(observation, async (client, member) => {
        admit(allowed, member);
        const id = receiptId(member.userId, requestId);
        const previous = await receipt(client, member.guildId, member.userId, id, { action: 'activity.reset', definitionId });
        if (previous) return { duplicate: true, reset: previous.sessionId !== null };
        const found = await currentRun(client, member);
        requireCondition(!found || found.activity, 'SHUTTLE_ELSEWHERE');
        requireCondition(found?.state.status !== 'role_pending', 'SHUTTLE_RESET_PENDING');
        const resettable = found?.state.status === 'active';
        if (resettable) await client.query('UPDATE sophie_core.sessions SET current = false WHERE id = $1', [found.state.id]);
        await saveReceipt(client, member.guildId, id, { sessionId: resettable ? found.state.id : null });
        return { duplicate: false, reset: resettable };
      });
    },
  });
}
