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
import { requireActivityAttention } from './shuttle-timing.js';

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
  async function capability(actor) {
    if (status === 'testing' && await authorize('shuttle.activity.test', actor, scope(actor)) !== true) return 'closed';
    if (await authorize('shuttle.self', actor, scope(actor)) !== true) return 'unavailable';
    return null;
  }
  /**
   * The capability checks, then the member's observation: the checks read Discord several times, and made before the
   * observation they used up the 5 s it may be old when the transaction commits. Under load a final Continue ran out of it on
   * every try and was refused without a trace (owner report, 24 October 2026: Whitelist never queued). The observation is
   * for the same member the actor names.
   */
  async function admission(actor, observe) {
    requireCondition(typeof observe === 'function', 'TRUSTED_ADAPTERS_REQUIRED');
    const allowed = await capability(actor);
    const observation = await observe();
    requireCondition(observation?.guildId === actor.guildId && observation?.userId === actor.userId, 'MEMBER_MISMATCH');
    return { allowed, observation };
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
  /** The run's definition when the run carries on, else null; the caller uses it rather than reading it again. */
  async function carriesOn(client, session, member) {
    if (session.eligibilityEpoch !== member.eligibilityEpoch) return null;
    const definition = await getDefinition(client, session.definitionId, session.definitionVersion);
    if (definition.status !== 'published') return null;
    return session.status !== 'active' || session.definitionVersion === (await latestDefinition(client))?.version ? definition : null;
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
  /**
   * Credits the focused time a Continue, Back or Check reports to the stop it leaves (owner request, 25 October 2026), at
   * most the time that really passed since the run's last report or its boarding, so no client can claim more. A finished
   * run keeps its first completion time.
   */
  async function recordAttention(client, before, after, attention) {
    const now = clock(), credited = before.status === 'active' && attention !== null && (attention.ms > 0 || attention.pages > 0);
    // One round trip: the run's last report is read before it moves on, and the credit is capped by the time since.
    await client.query(`WITH previous AS (
        SELECT session_id, coalesce(attention_at_ms, started_at_ms) AS since FROM sophie_core.shuttle_activity_runs WHERE session_id = $1 FOR UPDATE),
      moved AS (UPDATE sophie_core.shuttle_activity_runs r SET attention_at_ms = $2,
          completed_at_ms = CASE WHEN $3 THEN coalesce(r.completed_at_ms, $2) ELSE r.completed_at_ms END
        FROM previous p WHERE r.session_id = p.session_id RETURNING p.since)
      INSERT INTO sophie_core.shuttle_activity_attention (session_id, stop, active_ms, pages)
        SELECT $1, $4, LEAST($5::bigint, GREATEST(0, $2::bigint - since)), $6 FROM moved WHERE $7
      ON CONFLICT (session_id, stop) DO UPDATE SET active_ms = shuttle_activity_attention.active_ms + EXCLUDED.active_ms,
        pages = GREATEST(shuttle_activity_attention.pages, EXCLUDED.pages)`,
    [before.id, now, before.status === 'active' && after.status !== 'active', before.stepIndex, attention?.ms ?? 0, attention?.pages ?? 0, credited]);
  }
  async function replay(client, member, previous) {
    const session = await getSession(client, previous.sessionId, member.guildId, member.userId);
    return { duplicate: true, run: await view(client, session, member) };
  }

  return Object.freeze({
    /** What the Activity shows now. Reads only; it records the fresh membership observation like every member action. */
    async describe({ actor, observe }) {
      const { allowed, observation } = await admission(actor, observe);
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
    async board({ actor, observe, requestId }) {
      requireActivityRequestId(requestId);
      const { allowed, observation } = await admission(actor, observe);
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

    /**
     * Continue, Back or Check. The client names the version it showed; anything else is out of date. `attention` is the
     * focused time on the stop being left and its page count, recorded with the change (never on a replay).
     */
    async act({ actor, observe, requestId, action, expectedVersion, attention = null }) {
      requireActivityRequestId(requestId); requireInteger(expectedVersion);
      requireCondition(ACTIVITY_ACTIONS.includes(action), 'INVALID_SHUTTLE_ACTION');
      if (attention !== null) requireActivityAttention(attention);
      const { allowed, observation } = await admission(actor, observe);
      return memberOperation(observation, async (client, member) => {
        admit(allowed, member);
        const id = receiptId(member.userId, requestId);
        const previous = await receipt(client, member.guildId, member.userId, id, { action: `activity.${action}`, expectedVersion });
        if (previous) return replay(client, member, previous);
        const found = await currentRun(client, member);
        requireCondition(found?.activity === true, 'SHUTTLE_NOT_ACTIVE');
        const session = found.state;
        const definition = await carriesOn(client, session, member);
        requireCondition(definition !== null, 'SHUTTLE_RESTART_REQUIRED');
        requireCondition(session.version === expectedVersion, 'STALE_SHUTTLE_CONTROL');
        const command = { guildId: member.guildId, userId: member.userId, expectedVersion, nonce: session.nonce, nextNonce: randomBytes(16).toString('hex') };
        const change = ACTIONS[action](session, member, definition, command, clock());
        await saveSession(client, change.session, member);
        await recordAttention(client, session, change.session, attention);
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
    async reset({ actor, observe, requestId }) {
      requireActivityRequestId(requestId);
      const { allowed, observation } = await admission(actor, observe);
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
