import { randomUUID } from 'node:crypto';
import { requireCondition, requireId, requireInteger, requireName, requireRecord } from '../../../contracts/validation.js';
import { observeMember } from '../../../modules/member-records/index.js';
import { inTransaction } from './transaction.js';

/**
 * Member records (owner decisions, 30 October 2026). Each record holds what Sophie wants the member's post to show (the
 * profile, the approved application, the events) and what she has delivered (message IDs and rendered hashes). Writers
 * (the Gateway, Sophie's Whitelist grant, the host-only backfill) only change the wanted state and raise the revision; the
 * dispatcher (apps/core/discord/member-records.js) converges one record at a time under a lease. No AI reads any of it.
 */

const EVENT_KINDS = Object.freeze(['record.opened', 'joined', 'left', 'whitelist.granted', 'whitelist.lost', 'muzzled', 'unmuzzled', 'name.changed', 'application', 'watched', 'unwatched']);
const SLOT = /^(?:header|ledger|application|application[2-9]|games|spare)$/u;
const EVENT_ID = /^[A-Za-z0-9._-]{1,160}$/u;
const NO_ROLES = Object.freeze({ crew: false, whitelist: false, muzzled: false, staff: false, leadOps: false });

function requireEvent(event) {
  requireRecord(event); requireCondition(EVENT_ID.test(event.eventId) && EVENT_KINDS.includes(event.kind), 'MEMBER_RECORD_EVENT_INVALID');
  requireInteger(event.atMs, 1); requireCondition(event.detail === undefined || (event.detail !== null && typeof event.detail === 'object' && !Array.isArray(event.detail)), 'MEMBER_RECORD_EVENT_INVALID');
  if (event.messageId !== undefined && event.messageId !== null) requireId(event.messageId);
}

async function insertEvents(client, guildId, userId, events) {
  for (const event of events) {
    requireEvent(event);
    await client.query(`INSERT INTO sophie_core.member_record_events (guild_id, event_id, user_id, kind, at_ms, detail, message_id)
      VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (guild_id, event_id) DO NOTHING`,
    [guildId, event.eventId, userId, event.kind, event.atMs, event.detail ?? {}, event.messageId ?? null]);
  }
}

/** Raises the wanted revision so the dispatcher takes the record up again; live work goes ahead of the backfill. */
async function touch(client, guildId, userId, profile, atMs) {
  await client.query(`UPDATE sophie_core.member_records SET profile = COALESCE($3, profile), revision = revision + 1, updated_at_ms = $4,
    background = false, due_at = LEAST(due_at, clock_timestamp()) WHERE guild_id = $1 AND user_id = $2`, [guildId, userId, profile, atMs]);
}

/** The member's role flags from Discord role IDs. */
export function memberRoleFlags(roleIds, mapping) {
  const has = key => roleIds.includes(mapping[key]);
  return { crew: has('crew'), whitelist: has('whitelist'), muzzled: has('muzzled'), staff: has('staff'), leadOps: has('leadOps') };
}

/** A new record's profile from what Discord says about the member. */
export function profileOf({ username, globalName = null, nick = null, present, roles, joinedAtMs = null, joinCount = null, note = null }) {
  return { username: username ?? null, displayName: nick ?? globalName ?? null, present, roles: { ...NO_ROLES, ...roles }, joinedAtMs,
    joinCount, lastLeftAtMs: null, earlierNames: [], note };
}

/** Whether a value came from the member records ingress (apps/core/discord/member-record-ingress.js), which freezes what it keeps. */
export function requireMemberRecordEvent(event) {
  requireCondition(event !== null && typeof event === 'object' && Object.isFrozen(event) && ['member', 'message', 'delete'].includes(event.kind), 'MEMBER_RECORD_OBSERVATION_INVALID');
}

/**
 * Called only inside the Gateway cursor transaction (apps/core/storage/gateway-journal.js). Member changes update the
 * member's record (a join with no record opens one); a message in one of the record posts is copied as an observation. A
 * member with no record yet is left to the backfill, except on a join. Bots and Sophie herself get no record.
 */
export async function recordMemberRecordObservation(client, { guildId, mapping, event, epoch, sequence, observedAt }) {
  requireRecord(event); requireInteger(epoch, 0); requireInteger(sequence, 0); requireInteger(observedAt, 1);
  if (event.kind === 'member') {
    if (event.bot || event.userId === mapping.botUserId) return;
    const row = (await client.query('SELECT profile FROM sophie_core.member_records WHERE guild_id = $1 AND user_id = $2 FOR UPDATE',
      [guildId, event.userId])).rows[0];
    const roles = event.present ? memberRoleFlags(event.roleIds, mapping) : { ...NO_ROLES };
    const observation = { present: event.present, roles, username: event.username, globalName: event.globalName, nick: event.nick, joinedAtMs: event.joinedAtMs };
    const id = suffix => `g.${epoch}.${sequence}.${suffix}`;
    if (!row) {
      if (event.type !== 'GUILD_MEMBER_ADD') return;
      const profile = profileOf({ ...observation, joinedAtMs: event.joinedAtMs ?? observedAt, joinCount: 1 });
      await client.query(`INSERT INTO sophie_core.member_records (guild_id, user_id, profile, opened_at_ms, updated_at_ms)
        VALUES ($1, $2, $3, $4, $4) ON CONFLICT DO NOTHING`, [guildId, event.userId, profile, observedAt]);
      await insertEvents(client, guildId, event.userId, [{ eventId: id('joined'), kind: 'joined', atMs: observedAt, detail: { joinCount: 1 } }]);
      return;
    }
    // Sophie's own grant is recorded by its confirmation (recordSophieWhitelist), with the reading time; the role it adds
    // is not a second entry.
    const bySophie = !row.profile.roles?.whitelist && roles.whitelist && (await client.query(`SELECT 1 FROM sophie_core.outbox
      WHERE guild_id = $1 AND user_id = $2 AND kind = 'whitelist.grant' AND status IN ('leased', 'done')
        AND created_at > clock_timestamp() - interval '6 hours' LIMIT 1`, [guildId, event.userId])).rowCount > 0;
    const next = observeMember(row.profile, observation, observedAt, { whitelistBySophie: bySophie });
    // A rejoin may come with a new application: look again.
    if (next.events.some(item => item.kind === 'joined')) await client.query(`UPDATE sophie_core.member_records
      SET application = CASE WHEN application IS NULL THEN NULL ELSE application || '{"recheck": true}'::jsonb END WHERE guild_id = $1 AND user_id = $2`, [guildId, event.userId]);
    await insertEvents(client, guildId, event.userId, next.events.map(({ kind, ...detail }, index) => ({ eventId: id(`${index}`), kind, atMs: observedAt, detail })));
    if (next.changed || next.events.length) await touch(client, guildId, event.userId, next.profile, observedAt);
    return;
  }
  requireCondition(['message', 'delete'].includes(event.kind), 'MEMBER_RECORD_OBSERVATION_INVALID');
  const record = (await client.query('SELECT user_id FROM sophie_core.member_records WHERE guild_id = $1 AND thread_id = $2', [guildId, event.channelId])).rows[0];
  if (!record) return;
  if (event.kind === 'message' && event.authorId === mapping.botUserId) return;
  for (const messageId of event.kind === 'delete' ? event.messageIds : [event.messageId]) {
    await client.query(`INSERT INTO sophie_core.member_record_messages (guild_id, thread_id, message_id, continuity_epoch, sequence, user_id, kind,
        author_id, author_name, content, attachments, message_at_ms, observed_at_ms) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
      ON CONFLICT DO NOTHING`, [guildId, event.channelId, messageId, epoch, sequence, record.user_id,
      event.kind === 'delete' ? 'delete' : event.type === 'MESSAGE_CREATE' ? 'create' : 'update',
      event.authorId ?? null, event.authorName ?? null, event.content ?? null,
      event.attachments === undefined ? null : JSON.stringify(event.attachments), event.messageAtMs ?? null, observedAt]);
  }
}

/**
 * Sophie's own Whitelist grant, at its confirmation (apps/core/storage/core-store.js), with the Activity run's reading time.
 * Recorded once per grant job; nothing happens for a member without a record.
 */
export async function recordSophieWhitelist(client, { guildId, userId, operationId, atMs, timing }) {
  const row = (await client.query('SELECT profile FROM sophie_core.member_records WHERE guild_id = $1 AND user_id = $2 FOR UPDATE', [guildId, userId])).rows[0];
  if (!row) return;
  const eventId = `wl.${operationId}`.slice(0, 160).replace(/[^A-Za-z0-9._-]/gu, '-');
  const inserted = await client.query(`INSERT INTO sophie_core.member_record_events (guild_id, event_id, user_id, kind, at_ms, detail)
    VALUES ($1, $2, $3, 'whitelist.granted', $4, $5) ON CONFLICT DO NOTHING`, [guildId, eventId, userId, atMs, { bySophie: true, timing: timing ?? null }]);
  if (!inserted.rowCount) return;
  await touch(client, guildId, userId, { ...row.profile, roles: { ...row.profile.roles, whitelist: true } }, atMs);
}

export function createMemberRecordStore({ pool, clock, guildId, forumId, changelogThreadId }) {
  requireId(guildId); requireId(forumId); requireId(changelogThreadId);
  requireCondition(typeof clock === 'function', 'TRUSTED_ADAPTERS_REQUIRED');
  const leased = (client, lease) => client.query(`SELECT * FROM sophie_core.member_records WHERE guild_id = $1 AND user_id = $2
    AND lease_owner = $3 AND lease_until > clock_timestamp() FOR UPDATE`, [guildId, lease.userId, lease.owner]).then(result => {
    requireCondition(result.rowCount === 1, 'MEMBER_RECORD_LEASE_LOST'); return result.rows[0];
  });
  return Object.freeze({
    guildId, forumId, changelogThreadId,
    /**
     * The forum and the changelog post are never AI contexts: they join the permanent case exclusions, which the AI
     * context checks read for a channel and its parent (apps/core/discord/ai-observations.js), so every post is covered.
     */
    async ensureExclusions() {
      await pool.query(`INSERT INTO sophie_core.case_exclusions (guild_id, channel_id, parent_id) VALUES ($1, $2, NULL), ($1, $3, $2)
        ON CONFLICT DO NOTHING`, [guildId, forumId, changelogThreadId]);
    },
    /**
     * Opens a record the host-only backfill read from Discord, or adopts a post made before core kept records (the Staff
     * test run): `thread` gives its post and Sophie's message IDs, and events may already carry their entry's message.
     * A member who already has a record is left alone.
     */
    async open({ userId, profile, application = null, events, thread = null, background = true }) {
      requireId(userId); requireRecord(profile); requireCondition(Array.isArray(events) && events.length <= 20, 'MEMBER_RECORD_EVENT_INVALID');
      requireCondition(application === null || ['found', 'none', 'unavailable'].includes(application.status), 'MEMBER_RECORD_APPLICATION_INVALID');
      if (thread !== null) {
        requireId(thread.threadId); requireRecord(thread.messages);
        for (const [slot, id] of Object.entries(thread.messages)) { requireCondition(SLOT.test(slot), 'MEMBER_RECORD_SLOT_INVALID'); requireId(id); }
        requireCondition(thread.messages.header === thread.threadId, 'MEMBER_RECORD_SLOT_INVALID');
      }
      const at = clock(); requireInteger(at, 1);
      return inTransaction(pool, async client => {
        const inserted = await client.query(`INSERT INTO sophie_core.member_records (guild_id, user_id, thread_id, messages, profile, application,
          background, opened_at_ms, updated_at_ms) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8) ON CONFLICT DO NOTHING`,
        [guildId, userId, thread?.threadId ?? null, thread?.messages ?? {}, profile, application, background, at]);
        if (!inserted.rowCount) return { opened: false };
        await insertEvents(client, guildId, userId, events);
        return { opened: true };
      });
    },
    /**
     * Staff turn Watch on or off for a member's record (owner direction, 30 October 2026: "All staff can use the member
     * watch command"). The change is an entry naming who made it; asking for the state the record already has adds nothing.
     * Authorization is the caller's (apps/core/discord/member-watch.js).
     * @returns {Promise<'missing'|'unchanged'|'recorded'>}
     */
    async setWatch({ userId, watch, by, interactionId }) {
      requireId(userId); requireId(by); requireId(interactionId); requireCondition(typeof watch === 'boolean', 'MEMBER_RECORD_WATCH_INVALID');
      const at = clock(); requireInteger(at, 1);
      return inTransaction(pool, async client => {
        const row = (await client.query('SELECT profile FROM sophie_core.member_records WHERE guild_id = $1 AND user_id = $2 FOR UPDATE', [guildId, userId])).rows[0];
        if (!row) return 'missing';
        if ((row.profile.watch === true) === watch) return 'unchanged';
        await insertEvents(client, guildId, userId, [{ eventId: `watch.${interactionId}`, kind: watch ? 'watched' : 'unwatched', atMs: at, detail: { by } }]);
        await touch(client, guildId, userId, { ...row.profile, watch }, at);
        return 'recorded';
      });
    },
    /** The member IDs that already have a record, for the backfill. */
    async recordedMembers() {
      return (await pool.query('SELECT user_id FROM sophie_core.member_records WHERE guild_id = $1', [guildId])).rows.map(row => row.user_id);
    },
    /**
     * Leases the next record with work, live work first. Nothing is claimed while Discord delivery is paused or the
     * Gateway is not current, the same barrier the outbox uses.
     */
    async claim(owner, leaseMs = 60_000) {
      requireName(owner); requireInteger(leaseMs, 5_000, 120_000);
      return inTransaction(pool, async client => {
        const delivery = await client.query('SELECT NOT paused AND until_at <= clock_timestamp() AS allowed FROM sophie_core.discord_backoff WHERE singleton');
        if (!delivery.rows[0]?.allowed) return null;
        const gateway = await client.query(`SELECT 1 FROM sophie_core.gateway_lifecycle WHERE guild_id = $1
          AND (status <> 'current' OR lease_until <= clock_timestamp())`, [guildId]);
        if (gateway.rowCount) return null;
        const due = (await client.query(`SELECT user_id FROM sophie_core.member_records WHERE guild_id = $1 AND delivered_revision < revision
          AND due_at <= clock_timestamp() AND (lease_until IS NULL OR lease_until <= clock_timestamp())
          ORDER BY background, due_at, user_id LIMIT 1 FOR UPDATE SKIP LOCKED`, [guildId])).rows[0];
        if (!due) return null;
        const lease = { userId: due.user_id, owner: `${owner}.${randomUUID().slice(0, 8)}` };
        const row = (await client.query(`UPDATE sophie_core.member_records SET lease_owner = $3, lease_until = clock_timestamp() + $4 * interval '1 millisecond',
          attempts = attempts + 1 WHERE guild_id = $1 AND user_id = $2 RETURNING *`, [guildId, lease.userId, lease.owner, leaseMs])).rows[0];
        const events = (await client.query(`SELECT event_id, kind, at_ms, detail, message_id, changelog_message_id FROM sophie_core.member_record_events
          WHERE guild_id = $1 AND user_id = $2 ORDER BY at_ms, event_id`, [guildId, lease.userId])).rows
          .map(event => ({ eventId: event.event_id, kind: event.kind, atMs: Number(event.at_ms), detail: event.detail, messageId: event.message_id,
            changelogMessageId: event.changelog_message_id }));
        // Runs finished before 25 October 2026 have no completion time; their session's status says they finished.
        const run = (await client.query(`SELECT r.started_at_ms, r.completed_at_ms, s.state->>'status' AS status,
            COALESCE(SUM(a.active_ms), 0)::bigint AS focused_ms, COALESCE(SUM(a.pages), 0)::int AS pages, MIN(a.stop)::int AS from_stop, COUNT(a.stop)::int AS stops
          FROM sophie_core.shuttle_activity_runs r JOIN sophie_core.sessions s ON s.id = r.session_id
            LEFT JOIN sophie_core.shuttle_activity_attention a ON a.session_id = r.session_id
          WHERE r.guild_id = $1 AND r.user_id = $2 GROUP BY r.session_id, r.started_at_ms, r.completed_at_ms, s.state
          ORDER BY (s.state->>'status' = 'complete') DESC, r.started_at_ms DESC LIMIT 1`, [guildId, lease.userId])).rows[0];
        const shuttle = run === undefined ? null : (() => {
          const started = Number(run.started_at_ms), completed = run.completed_at_ms === null ? null : Number(run.completed_at_ms);
          return { startedAtMs: started, completedAtMs: completed, finished: run.status === 'complete',
            timing: completed !== null && run.stops > 0 ? { focusedMs: Number(run.focused_ms), pages: run.pages, wallMs: Math.max(0, completed - started), fromStop: run.from_stop } : null };
        })();
        // Mutes on record: Sophie's own mute actions and the Muzzled role seen given since records began.
        const mutes = Number((await client.query(`SELECT (SELECT COUNT(*) FROM sophie_core.member_actions WHERE guild_id = $1 AND user_id = $2 AND muted)
          + (SELECT COUNT(*) FROM sophie_core.member_record_events WHERE guild_id = $1 AND user_id = $2 AND kind = 'muzzled') AS mutes`, [guildId, lease.userId])).rows[0].mutes);
        return { lease, revision: row.revision, attempts: row.attempts, record: { userId: row.user_id, threadId: row.thread_id, messages: row.messages,
          profile: row.profile, application: row.application, delivered: row.delivered, createStarted: row.create_started,
          openedAtMs: Number(row.opened_at_ms), updatedAtMs: Number(row.updated_at_ms) }, events, shuttle, mutes };
      });
    },
    /** Keeps a long convergence's lease. */
    async renew(lease, leaseMs = 60_000) {
      requireInteger(leaseMs, 5_000, 120_000);
      return inTransaction(pool, async client => {
        await leased(client, lease);
        await client.query(`UPDATE sophie_core.member_records SET lease_until = clock_timestamp() + $3 * interval '1 millisecond'
          WHERE guild_id = $1 AND user_id = $2`, [guildId, lease.userId, leaseMs]);
      });
    },
    /**
     * Records delivery progress as soon as Discord confirms it, so a retry continues instead of posting again: the post,
     * a creation about to be attempted, Sophie's message for a slot, an entry's message, a changelog line, the
     * application read from Discord (with its event).
     */
    async progress(lease, { threadId, createStarted, slots, entries, changelog, application, applicationEvent }) {
      return inTransaction(pool, async client => {
        const row = await leased(client, lease);
        if (createStarted !== undefined) {
          // False only when Discord certainly made no post (the creation was refused before it was made).
          requireCondition(typeof createStarted === 'boolean' && (createStarted || row.thread_id === null), 'MEMBER_RECORD_PROGRESS_INVALID');
          await client.query('UPDATE sophie_core.member_records SET create_started = $3 WHERE guild_id = $1 AND user_id = $2', [guildId, lease.userId, createStarted]);
        }
        if (threadId !== undefined) {
          requireId(threadId); requireCondition(row.thread_id === null || row.thread_id === threadId, 'MEMBER_RECORD_THREAD_CONFLICT');
          await client.query(`UPDATE sophie_core.member_records SET thread_id = $3, messages = messages || jsonb_build_object('header', $3::text)
            WHERE guild_id = $1 AND user_id = $2`, [guildId, lease.userId, threadId]);
        }
        if (slots !== undefined) {
          requireRecord(slots);
          for (const [slot, id] of Object.entries(slots)) { requireCondition(SLOT.test(slot), 'MEMBER_RECORD_SLOT_INVALID'); requireId(id); }
          await client.query('UPDATE sophie_core.member_records SET messages = messages || $3 WHERE guild_id = $1 AND user_id = $2', [guildId, lease.userId, slots]);
        }
        if (application !== undefined) {
          requireCondition(['found', 'none', 'unavailable'].includes(application?.status), 'MEMBER_RECORD_APPLICATION_INVALID');
          await client.query('UPDATE sophie_core.member_records SET application = $3 WHERE guild_id = $1 AND user_id = $2', [guildId, lease.userId, application]);
        }
        if (applicationEvent !== undefined) await insertEvents(client, guildId, lease.userId, [applicationEvent]);
        for (const [column, updates] of [['message_id', entries], ['changelog_message_id', changelog]]) {
          if (updates === undefined) continue;
          requireRecord(updates);
          for (const [eventId, messageId] of Object.entries(updates)) {
            requireCondition(EVENT_ID.test(eventId), 'MEMBER_RECORD_EVENT_INVALID'); requireId(messageId);
            const result = await client.query(`UPDATE sophie_core.member_record_events SET ${column} = $4
              WHERE guild_id = $1 AND user_id = $2 AND event_id = $3 AND (${column} IS NULL OR ${column} = $4)`, [guildId, lease.userId, eventId, messageId]);
            requireCondition(result.rowCount === 1, 'MEMBER_RECORD_EVENT_CONFLICT');
          }
        }
      });
    },
    /** The record is delivered up to the revision that was claimed; a change made meanwhile leaves it due. */
    async finish(lease, { revision, delivered }) {
      requireInteger(revision, 1); requireRecord(delivered);
      return inTransaction(pool, async client => {
        await leased(client, lease);
        await client.query(`UPDATE sophie_core.member_records SET delivered_revision = GREATEST(delivered_revision, $3), delivered = $4,
          attempts = 0, last_error_code = NULL, lease_owner = NULL, lease_until = NULL WHERE guild_id = $1 AND user_id = $2`,
        [guildId, lease.userId, revision, delivered]);
      });
    },
    /**
     * Tries again later: Discord's own wait when it gave one, else doubling from a second up to an hour. Waiting for a
     * rate limit or the delivery gate is not a failed attempt, so it never counts toward the failing alert.
     */
    async retry(lease, code, retryAfterMs = 0) {
      requireCondition(typeof code === 'string' && /^[A-Z0-9_]{1,64}$/u.test(code), 'MEMBER_RECORD_PROGRESS_INVALID');
      requireInteger(retryAfterMs, 0, 86_400_000);
      return inTransaction(pool, async client => {
        await leased(client, lease);
        await client.query(`UPDATE sophie_core.member_records SET lease_owner = NULL, lease_until = NULL, last_error_code = $3,
          attempts = CASE WHEN $3 IN ('RATE_LIMITED', 'DISCORD_TRANSPORT_DISABLED', 'DISCORD_BUSY') THEN GREATEST(attempts - 1, 0) ELSE attempts END,
          due_at = clock_timestamp() + GREATEST($4::double precision, LEAST(3600000, power(2, LEAST(attempts, 12)) * 1000)) * interval '1 millisecond'
          WHERE guild_id = $1 AND user_id = $2`, [guildId, lease.userId, code, retryAfterMs]);
      });
    },
  });
}
