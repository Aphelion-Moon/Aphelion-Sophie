import { requireCondition } from '../../../contracts/validation.js';

/** The most focused time one Continue or Back may report for its stop, and the most pages a stop may have. */
export const ATTENTION_MAX_MS = 3_600_000, ATTENTION_MAX_PAGES = 64;

/** `{ ms, pages }` as the Activity reports it with Continue, Back or Check; anything else is refused. */
export function requireActivityAttention(value) {
  requireCondition(value !== null && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 2 &&
    Number.isSafeInteger(value.ms) && value.ms >= 0 && value.ms <= ATTENTION_MAX_MS &&
    Number.isSafeInteger(value.pages) && value.pages >= 0 && value.pages <= ATTENTION_MAX_PAGES, 'ACTIVITY_BODY_INVALID');
  return value;
}

/**
 * A Shuttle Activity run's timing (owner request, 25 October 2026), for the Whitelist notice and Staff's progress check:
 * when it was boarded, last moved and finished, and the focused reading time and pages of each stop the Activity reported.
 * null for a session that is not an Activity run. `timed` is false when no stop was reported (a run from before timing
 * was recorded); `fromStop` is the first stop reported, above 0 when timing began partway through the run.
 */
export async function readRunTiming(client, sessionId) {
  const run = (await client.query(`SELECT started_at_ms, attention_at_ms, completed_at_ms FROM sophie_core.shuttle_activity_runs
    WHERE session_id = $1`, [sessionId])).rows[0];
  if (!run) return null;
  const stops = (await client.query(`SELECT stop, active_ms, pages FROM sophie_core.shuttle_activity_attention WHERE session_id = $1
    ORDER BY stop`, [sessionId])).rows.map(row => ({ stop: Number(row.stop), focusedMs: Number(row.active_ms), pages: Number(row.pages) }));
  const started = Number(run.started_at_ms);
  return {
    startedAtMs: started, lastActiveAtMs: Number(run.attention_at_ms ?? started),
    completedAtMs: run.completed_at_ms === null ? null : Number(run.completed_at_ms),
    focusedMs: stops.reduce((sum, stop) => sum + stop.focusedMs, 0), pages: stops.reduce((sum, stop) => sum + stop.pages, 0),
    stops, timed: stops.length > 0, fromStop: stops[0]?.stop ?? null,
  };
}

/**
 * A member's Shuttle progress for Staff's `/whitelist progress` (owner request, 25 October 2026). Reads only, in one
 * read-only transaction: the current run (or, without one, the last Activity run), where it is, its timing, and the latest
 * Whitelist grant job's state. Metadata only: no story copy, no ticket data.
 */
export async function readShuttleProgress(pool, guildId, userId) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN READ ONLY');
    const current = (await client.query(`SELECT s.id, s.state, a.session_id IS NOT NULL AS activity FROM sophie_core.sessions s
      LEFT JOIN sophie_core.shuttle_activity_runs a ON a.session_id = s.id WHERE s.guild_id = $1 AND s.user_id = $2 AND s.current`, [guildId, userId])).rows[0] ?? null;
    const found = current ?? (await client.query(`SELECT s.id, s.state, true AS activity FROM sophie_core.shuttle_activity_runs a
      JOIN sophie_core.sessions s ON s.id = a.session_id WHERE a.guild_id = $1 AND a.user_id = $2 ORDER BY a.started_at_ms DESC, a.session_id DESC LIMIT 1`,
    [guildId, userId])).rows[0] ?? null;
    const grant = (await client.query(`SELECT status, last_error_code FROM sophie_core.outbox WHERE guild_id = $1 AND user_id = $2
      AND kind = 'whitelist.grant' ORDER BY created_at DESC, operation_id DESC LIMIT 1`, [guildId, userId])).rows[0] ?? null;
    let run = null;
    if (found) {
      const session = found.state;
      const titles = (await client.query(`SELECT publication->'stages' AS stages FROM sophie_core.shuttle_publications
        WHERE definition_id = $1 AND definition_version = $2`, [session.definitionId, session.definitionVersion])).rows[0]?.stages ?? [];
      run = { current: current !== null, activity: found.activity === true, status: session.status, helpPaused: session.helpPaused === true,
        stop: session.stepIndex, stops: Array.isArray(titles) ? titles.length : 0, title: typeof titles[session.stepIndex]?.title === 'string' ? titles[session.stepIndex].title : null,
        definitionVersion: session.definitionVersion, timing: found.activity ? await readRunTiming(client, found.id) : null };
    }
    await client.query('COMMIT');
    return { run, grant: grant ? { status: grant.status, code: grant.last_error_code ?? null } : null };
  } catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; } finally { client.release(); }
}
