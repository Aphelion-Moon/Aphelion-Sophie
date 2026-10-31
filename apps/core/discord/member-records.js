import { createHash } from 'node:crypto';
import { requireCondition, requireId, requireName, requireRecord } from '../../../contracts/validation.js';
import * as records from '../../../modules/member-records/index.js';
import { ROLE_WINDOW_MS } from '../storage/member-records.js';

const QUIET = Object.freeze({ parse: [], users: [], roles: [], replied_user: false });
const SUPPRESS_EMBEDS = 1 << 2;
const RESERVED_SLOTS = ['ledger', 'application', 'games', 'spare'];
const RENEW_AFTER_MS = 20_000;
const DELETION_WAIT_MS = 15_000;
// Entries kept in the post only, out of the ledger and the changelog, which they would flood.
const QUIET_KINDS = ['message.deleted', 'message.edited'];
// Role changes are posted once the member's roles have been quiet this long (see waitFor), within the store's window.
const ROLE_QUIET_MS = 20_000;
const ROLE_NAMES_KEPT_MS = 600_000;
const NOT_CREATED = ['RATE_LIMITED', 'DISCORD_TRANSPORT_DISABLED', 'DISCORD_BUSY', 'DISCORD_AUTHORIZATION_FAILED', 'DISCORD_SCOPE_REFUSED', 'INVALID_DISCORD_PAYLOAD'];
const sha = value => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
const nonceOf = (...parts) => sha(parts.join(':')).slice(0, 24);

/** The record's application as the post shows it: the transcription's messages, or one reserved line. */
function applicationMessages(application) {
  if (application?.status === 'found') return records.renderApplication(application);
  if (application?.status === 'none') return [records.APPLICATION_NONE];
  if (application?.status === 'unavailable') return [records.APPLICATION_UNAVAILABLE];
  return [records.RESERVED.application];
}

/**
 * Keeps the member records forum in step with the records (owner decisions, 30 October 2026). One record per run, under
 * its lease: open the post if it has none (the header is its first message), post the reserved messages, look up the
 * approved application once, post each new entry, then bring the application, ledger, header, title and tags up to date,
 * add a changelog line for each entry, and archive the post again if Sophie opened or woke it. Each confirmed message is
 * recorded at once, and nonces come from the record and slot, so a retry continues rather than posting twice. Messages
 * name members without notifying anyone. No AI, no ticket data.
 */
export function createMemberRecordDispatcher({ store, transport: discord, botUserId, tagIds, protectedCategoryId, enabled, trace = () => {},
  wait = ms => new Promise(resolve => setTimeout(resolve, ms)), clock = Date.now }) {
  requireId(botUserId); requireId(protectedCategoryId); requireRecord(tagIds);
  const methods = ['createMemberRecordThread', 'editMemberRecordThread', 'createMemberRecordMessage', 'editMemberRecordMessage', 'getChannel', 'getMemberRecordThreads', 'getApprovedJoinRequests', 'getMessageDeleteAudit', 'getRoleUpdateAudit', 'getRoles'];
  requireCondition(typeof enabled === 'function' && typeof trace === 'function' && typeof wait === 'function' && ['claim', 'progress', 'finish', 'retry', 'renew', 'ensureExclusions', 'excludedChannels'].every(key => typeof store?.[key] === 'function') &&
    methods.every(key => typeof discord?.[key] === 'function') && discord.guildId === store.guildId, 'TRUSTED_ADAPTERS_REQUIRED');
  for (const name of records.TAGS) requireId(tagIds[name]);
  const { guildId, changelogThreadId } = store;
  let excluded = false, changelogCheckedAt = 0;
  // Each message Sophie posts comes back as a Gateway event, and while it is being recorded the delivery gate reads "not
  // current" for a moment, so the next request is refused before it leaves (and the transport's queue can be briefly
  // busy). A request refused that way was never sent: it waits a moment and is asked again, rather than failing the record.
  const transport = Object.freeze(Object.fromEntries(methods.map(name => [name, async (...input) => {
    for (let attempt = 0; ; attempt += 1) {
      try { return await discord[name](...input); }
      catch (error) { if (attempt >= 7 || !['DISCORD_TRANSPORT_DISABLED', 'DISCORD_BUSY'].includes(error?.code)) throw error; await wait(250); }
    }
  }])));

  /**
   * A leaver's latest messages that Staff may be pointed at, newest first, at most five: never in the protected category
   * (the other bot's tickets) or a channel or thread under it, and never in a channel Sophie's case records exclude. A
   * channel that no longer exists is left out. Channel reads are kept for this process.
   */
  const parents = new Map();
  async function parentsOf(channelId) {
    if (!parents.has(channelId)) {
      const channel = await transport.getChannel(channelId);
      parents.set(channelId, channel === null ? null : channel.parent_id ?? '');
      if (parents.size > 500) parents.delete(parents.keys().next().value);
    }
    return parents.get(channelId);
  }
  async function linkable(recent) {
    const shown = [];
    const candidates = recent.filter(item => typeof item?.channelId === 'string' && typeof item.messageId === 'string' && Number.isSafeInteger(item.atMs));
    const excludedIds = await store.excludedChannels([...new Set(candidates.map(item => item.channelId))].slice(0, 50));
    for (const item of candidates) {
      if (shown.length >= records.RECENT_MESSAGES_SHOWN) break;
      const parent = await parentsOf(item.channelId); if (parent === null) continue;
      const grandparent = parent ? await parentsOf(parent) : '';
      const lineage = [item.channelId, parent, grandparent].filter(Boolean);
      if (lineage.includes(protectedCategoryId) || excludedIds.has(item.channelId) || (parent && (await store.excludedChannels([parent])).size)) continue;
      shown.push(item);
    }
    return shown;
  }

  /** The newest approved application Discord holds for a member who just joined; one page is enough for a fresh join. */
  async function lookupApplication(userId) {
    let list;
    try { list = await transport.getApprovedJoinRequests({ limit: 50 }); }
    catch (error) { if (error?.code === 'DISCORD_AUTHORIZATION_FAILED') return { status: 'unavailable' }; throw error; }
    const found = list.filter(item => item.userId === userId && item.status === 'APPROVED' && item.reviewedAtMs !== null)
      .sort((a, b) => b.reviewedAtMs - a.reviewedAtMs)[0];
    if (!found) return { status: 'none' };
    return { status: 'found', requestId: found.id, approvedAtMs: found.reviewedAtMs, approvedBy: found.approvedBy, answers: records.applicationAnswers(found.formResponses) };
  }

  /**
   * Who deleted a member's message, from the audit log: Discord logs only deletions of someone else's messages, grouped by
   * who deleted, whose and where, with a count; a purge is logged against the channel. No matching entry means the author,
   * most likely. Read once per record, after a short wait (see converge).
   */
  async function deletedBy(event, userId, audit) {
    if (audit === null) return 'unknown';
    const near = (entry, before, after) => entry.createdAtMs >= event.atMs - before && entry.createdAtMs <= event.atMs + after;
    const found = event.bulk ? audit.find(entry => entry.bulk && entry.channelId === event.channelId && near(entry, 120_000, 60_000))
      : audit.find(entry => !entry.bulk && entry.targetId === userId && entry.channelId === event.channelId && near(entry, 15 * 60_000, 60_000));
    return found ? { userId: found.byUserId } : 'author';
  }

  /** The server's role names and positions, read at most every ten minutes. */
  let roleCache = null;
  async function roleNames() {
    if (roleCache === null || clock() - roleCache.at > ROLE_NAMES_KEPT_MS) {
      const roles = await transport.getRoles();
      requireCondition(Array.isArray(roles) && roles.length <= 500, 'DISCORD_RESPONSE_INVALID');
      roleCache = { at: clock(), names: Object.fromEntries(roles.filter(role => typeof role?.id === 'string' && typeof role.name === 'string').map(role => [role.id, role.name])),
        positions: Object.fromEntries(roles.filter(role => typeof role?.id === 'string').map(role => [role.id, Number(role.position) || 0])) };
    }
    return roleCache;
  }

  /**
   * Who changed a member's roles, from the audit log: every entry for this member within the change's time span (a minute
   * either side) that added a role the change added or touched, or removed one it removed or touched. Several people
   * are all named, first to act first.
   */
  function changedBy(event, userId, audit) {
    if (audit === null) return 'unknown';
    // A role that came and went matches either direction; a net addition or removal only its own.
    const brief = (event.touched ?? []).filter(id => !(event.added ?? []).includes(id) && !(event.removed ?? []).includes(id));
    const added = [...(event.added ?? []), ...brief], removed = [...(event.removed ?? []), ...brief];
    const matches = entry => added.some(id => entry.added.includes(id)) || removed.some(id => entry.removed.includes(id));
    const last = event.lastAtMs ?? event.atMs;
    const found = audit.filter(entry => entry.targetId === userId && entry.createdAtMs >= event.atMs - 60_000 && entry.createdAtMs <= last + 60_000 && matches(entry))
      .sort((a, b) => a.createdAtMs - b.createdAtMs);
    const userIds = [...new Set(found.map(entry => entry.byUserId))];
    return userIds.length ? { userId: userIds[0], userIds } : 'none';
  }

  /**
   * How long an entry still waits before it is posted: a deletion 15 s, for the audit log; a role change until the member's
   * roles have been quiet for 20 s, and never more than two minutes after the first change, so quick changes are one entry.
   */
  function waitFor(event) {
    if (event.messageId) return 0;
    if (event.kind === 'message.deleted') return DELETION_WAIT_MS - (clock() - event.atMs);
    if (event.kind === 'roles.changed') return Math.min(ROLE_QUIET_MS - (clock() - (event.detail?.lastAtMs ?? event.atMs)), ROLE_WINDOW_MS - (clock() - event.atMs));
    return 0;
  }

  async function converge(job) {
    const { lease, record } = job, { userId, profile } = record;
    const events = job.events.map(event => ({ ...event }));
    const waits = events.map(waitFor).filter(ms => ms > 0);
    if (waits.length) {
      const error = new Error('MEMBER_RECORD_DEFERRED'); error.code = 'MEMBER_RECORD_DEFERRED';
      error.retryAfterMs = Math.max(1_000, Math.min(...waits)); throw error;
    }
    const messages = { ...record.messages }, delivered = { ...record.delivered };
    let renewedAt = Date.now();
    const step = async () => { if (Date.now() - renewedAt > RENEW_AFTER_MS) { await store.renew(lease); renewedAt = Date.now(); } };
    const post = async (channelId, slot, content) => (await transport.createMemberRecordMessage(channelId, nonceOf('member-record', userId, slot), content)).id;

    // The application, looked up once for a member who joined after records began (the backfill brings the rest), and
    // again after a rejoin.
    let application = record.application;
    if (application === null || application.recheck === true) {
      const looked = await lookupApplication(userId);
      const same = looked.status !== 'found' && application?.status === 'found' || looked.requestId !== undefined && looked.requestId === application?.requestId;
      const previous = application?.status === 'found' ? application : null;
      application = same ? { ...application, recheck: false } : looked;
      const added = !same && application.status === 'found' ? [{ eventId: `application.${application.requestId}`, kind: 'application', atMs: application.approvedAtMs,
        detail: { approvedAtMs: application.approvedAtMs } }] : [];
      // A new application replaces the earlier one in the post's third message; an entry says so and keeps the earlier one
      // as it was (owner direction, 30 October 2026).
      if (added.length && previous) added.push({ eventId: `application.replaced.${application.requestId}`, kind: 'application.replaced', atMs: clock(),
        detail: { approvedAtMs: application.approvedAtMs, approvedBy: application.approvedBy ?? null,
          previous: { requestId: previous.requestId, approvedAtMs: previous.approvedAtMs, approvedBy: previous.approvedBy ?? null, answers: previous.answers } } });
      await store.progress(lease, { application, ...(added.length ? { applicationEvent: added } : {}) });
      for (const event of added) if (!events.some(item => item.eventId === event.eventId)) events.push({ ...event, messageId: null, changelogMessageId: null });
      events.sort((a, b) => a.atMs - b.atMs || (a.eventId < b.eventId ? -1 : 1));
    }
    const facts = application?.status === 'found' ? records.applicationFacts(application.answers, application.approvedAtMs) : null;
    const mutes = job.mutes;
    // The member's roles by name, highest first, once the record holds their role IDs.
    const roleList = Array.isArray(profile.roleIds) && profile.present ? await (async () => {
      const { names, positions } = await roleNames();
      return profile.roleIds.filter(id => names[id]).sort((a, b) => (positions[b] ?? 0) - (positions[a] ?? 0)).map(id => names[id]);
    })() : undefined;
    const header = records.renderHeader({ userId, username: profile.username, displayName: profile.displayName, present: profile.present, roles: profile.roles,
      joinedAtMs: profile.joinedAtMs ?? null, joinCount: profile.joinCount ?? null, lastLeftAtMs: profile.lastLeftAtMs ?? null, shuttle: job.shuttle, mutes,
      application: facts, earlierNames: profile.earlierNames ?? [], note: profile.note ?? null, updatedAtMs: record.updatedAtMs, roleNames: roleList });
    const appMessages = applicationMessages(application);
    // The games message: the reserved text until the games feed has read the member (owner direction, 31 October 2026).
    // Posts made before then were given the reserved text, so that is what they are taken to show.
    const games = record.games ? records.renderGames(record.games, facts?.games ?? null) : records.RESERVED.games;
    const deliveredGames = delivered.games ?? sha(records.RESERVED.games);
    const title = records.recordTitle({ userId, username: profile.username, displayName: profile.displayName });

    // The post. A creation whose outcome was never confirmed is looked for before trying again.
    let threadId = record.threadId, rearchive = false, current = null;
    if (threadId === null) {
      if (record.createStarted) {
        const mine = (await transport.getMemberRecordThreads()).filter(thread => thread.ownerId === botUserId && thread.name === title);
        if (mine.length === 1) threadId = mine[0].id;
        else if (mine.length > 1) { const error = new Error('MEMBER_RECORD_POST_AMBIGUOUS'); error.code = 'MEMBER_RECORD_POST_AMBIGUOUS'; throw error; }
      }
      if (threadId === null) {
        await store.progress(lease, { createStarted: true });
        const tags = records.recordTags({ present: profile.present, roles: profile.roles }).map(name => tagIds[name]);
        let created;
        try {
          created = await transport.createMemberRecordThread({ name: title, auto_archive_duration: 1440, applied_tags: tags,
            message: { content: header, allowed_mentions: { ...QUIET }, flags: SUPPRESS_EMBEDS } });
        } catch (error) {
          // Refused before any post was made (a rate limit, the gate, a refusal): the next try need not look for one.
          if (NOT_CREATED.includes(error?.code)) await store.progress(lease, { createStarted: false });
          throw error;
        }
        requireId(created?.id); threadId = created.id;
        Object.assign(delivered, { header: sha(header), title, tags: [...tags].sort().join(',') });
      }
      await store.progress(lease, { threadId }); messages.header = threadId; rearchive = true;
    }

    const entryOf = event => ({ kind: event.kind, atMs: event.atMs, ...event.detail });
    const pendingEntries = events.filter(event => event.kind !== 'application' && !event.messageId);
    const ledgerOf = () => records.renderLedger([
      // Deleted and edited messages stay in the post only; listing each would crowd the ledger.
      ...events.filter(event => event.messageId && !QUIET_KINDS.includes(event.kind)).map(event => ({ atMs: event.atMs, label: records.entryLabel(entryOf(event)), messageId: event.messageId })),
      ...appMessages.slice(1).map((_, index) => messages[`application${index + 2}`]).filter(Boolean)
        .map(messageId => ({ atMs: application.approvedAtMs, label: 'Access application, continued', messageId })),
    ], { guildId, channelId: threadId });
    const desiredTags = watch => records.recordTags({ present: profile.present, roles: profile.roles, watch }).map(name => tagIds[name]);
    // Watch as Staff set it with /member watch; a record never set keeps whatever the post has.
    const wantWatch = typeof profile.watch === 'boolean' ? profile.watch : null;
    const tagKey = [...desiredTags(wantWatch === true)].sort().join(',');
    const appHashes = appMessages.map(sha);
    const threadWork = RESERVED_SLOTS.some(slot => !messages[slot]) || appMessages.slice(1).some((_, index) => !messages[`application${index + 2}`]) ||
      pendingEntries.length > 0 || appHashes.some((hash, index) => delivered.application?.[index] !== hash) || delivered.header !== sha(header) ||
      deliveredGames !== sha(games) ||
      delivered.title !== title || delivered.tags !== tagKey ||
      (application?.status === 'found' && events.some(event => event.kind === 'application' && !event.messageId));

    if (threadWork && !rearchive) {
      // An archived post cannot be edited: wake it, and archive it again afterwards. One a Staff discussion keeps open is
      // left open.
      current = await transport.getChannel(threadId);
      if (current === null) { const error = new Error('MEMBER_RECORD_POST_MISSING'); error.code = 'MEMBER_RECORD_POST_MISSING'; throw error; }
      if (current.thread_metadata?.archived === true) { await transport.editMemberRecordThread(threadId, { archived: false }); rearchive = true; }
    }
    if (threadWork) {
      // Sophie's five messages open the post; Staff discuss below them.
      for (const slot of RESERVED_SLOTS) {
        if (messages[slot]) continue;
        const content = slot === 'ledger' ? records.renderLedger([], { guildId, channelId: threadId }) : slot === 'application' ? appMessages[0]
          : slot === 'games' ? games : records.RESERVED[slot];
        messages[slot] = await post(threadId, slot, content);
        await store.progress(lease, { slots: { [slot]: messages[slot] } }); await step();
        if (slot === 'application') delivered.application = [appHashes[0]];
        if (slot === 'ledger') delivered.ledger = sha(content);
        if (slot === 'games') delivered.games = sha(content);
      }
      // The games message follows the feed. One deleted by hand is posted again, below the discussion, like the application.
      if ((delivered.games ?? sha(records.RESERVED.games)) !== sha(games)) {
        const edited = await transport.editMemberRecordMessage(threadId, messages.games, games);
        if (edited === null) {
          messages.games = await post(threadId, `games.again.${sha(games).slice(0, 8)}`, games);
          await store.progress(lease, { slots: { games: messages.games } });
        }
        delivered.games = sha(games); await step();
      }
      // A transcription longer than one message continues below.
      const applicationHashes = [...(delivered.application ?? [])];
      for (const [index, content] of appMessages.entries()) {
        const slot = index === 0 ? 'application' : `application${index + 1}`;
        if (!messages[slot]) {
          messages[slot] = await post(threadId, slot, content);
          await store.progress(lease, { slots: { [slot]: messages[slot] } });
        } else if (applicationHashes[index] !== appHashes[index]) {
          const edited = await transport.editMemberRecordMessage(threadId, messages[slot], content);
          if (edited === null) { messages[slot] = await post(threadId, `${slot}.again.${sha(content).slice(0, 8)}`, content); await store.progress(lease, { slots: { [slot]: messages[slot] } }); }
        }
        applicationHashes[index] = appHashes[index]; await step();
      }
      // A shorter application than before leaves continuation messages it no longer needs: they say so rather than keep
      // the earlier text (the earlier application is kept as its own entry).
      for (let index = appMessages.length; index < 9; index += 1) {
        const slot = `application${index + 1}`;
        if (!messages[slot] || applicationHashes[index] === sha(records.APPLICATION_UNUSED)) continue;
        await transport.editMemberRecordMessage(threadId, messages[slot], records.APPLICATION_UNUSED);
        applicationHashes[index] = sha(records.APPLICATION_UNUSED); await step();
      }
      delivered.application = applicationHashes;
      const applicationEvents = events.filter(event => event.kind === 'application' && !event.messageId);
      if (application?.status === 'found' && applicationEvents.length) {
        for (const event of applicationEvents) event.messageId = messages.application;
        await store.progress(lease, { entries: Object.fromEntries(applicationEvents.map(event => [event.eventId, messages.application])) });
      }
      // Each new entry, oldest first; a replaced application's entry is followed by the earlier application.
      let audit, roleAudit;
      for (const event of pendingEntries) {
        if (event.kind === 'roles.changed' && roleAudit === undefined) {
          try { roleAudit = await transport.getRoleUpdateAudit(); }
          catch (error) { if (error?.code !== 'DISCORD_AUTHORIZATION_FAILED') throw error; roleAudit = null; }
        }
        if (event.kind === 'message.deleted' && audit === undefined) {
          try { audit = await transport.getMessageDeleteAudit(); }
          catch (error) { if (error?.code !== 'DISCORD_AUTHORIZATION_FAILED') throw error; audit = null; }
        }
        const context = event.kind === 'left' && Array.isArray(event.detail.recent) ? { guildId, recent: await linkable(event.detail.recent) }
          : event.kind === 'message.deleted' ? { guildId, deletedBy: await deletedBy(entryOf(event), userId, audit) }
          : event.kind === 'roles.changed' ? { guildId, roleNames: (await roleNames()).names, changedBy: changedBy(entryOf(event), userId, roleAudit) } : { guildId };
        // Every part is checked against Discord's limit before any is sent, and each part's message is recorded as soon as it
        // is posted, so a part that fails is tried again without posting the earlier ones twice (audit, 30 October 2026).
        const parts = records.entryParts(entryOf(event), context).map(text => text.length <= records.MESSAGE_MAX ? text : `${text.slice(0, records.MESSAGE_MAX - 2)} …`);
        const postedParts = Array.isArray(event.detail.postedParts) ? [...event.detail.postedParts] : [];
        for (const [index, text] of parts.entries()) {
          if (postedParts[index]) continue;
          postedParts[index] = await post(threadId, index === 0 ? `entry.${event.eventId}` : `entry.${event.eventId}.${index + 1}`, text);
          if (index < parts.length - 1) await store.progress(lease, { entryParts: { [event.eventId]: postedParts } });
        }
        event.messageId = postedParts[0];
        await store.progress(lease, { entries: { [event.eventId]: event.messageId } }); await step();
      }
      const ledger = ledgerOf();
      if (delivered.ledger !== sha(ledger)) {
        const edited = await transport.editMemberRecordMessage(threadId, messages.ledger, ledger);
        if (edited === null) trace('MEMBER_RECORD_LEDGER_MISSING');
        delivered.ledger = sha(ledger);
      }
      if (delivered.header !== sha(header)) {
        const edited = await transport.editMemberRecordMessage(threadId, messages.header, header);
        if (edited === null) trace('MEMBER_RECORD_HEADER_MISSING');
        delivered.header = sha(header);
      }
      // Watch follows /member watch; before anyone used it, a Watch tag already on the post stays.
      const tags = desiredTags(wantWatch ?? (current?.applied_tags ?? []).includes(tagIds.Watch));
      if (delivered.title !== title || delivered.tags !== tagKey) {
        await transport.editMemberRecordThread(threadId, { ...(delivered.title !== title ? { name: title } : {}), applied_tags: tags });
        delivered.title = title; delivered.tags = tagKey;
      }
      await step();
    }
    // Every entry gets one line in the changelog, linking to it. The changelog post archives itself after a quiet week, so
    // it is checked (at most every ten minutes) and woken before Sophie writes there.
    const unlisted = events.filter(item => item.messageId && !item.changelogMessageId && !QUIET_KINDS.includes(item.kind));
    if (unlisted.length && Date.now() - changelogCheckedAt > 600_000) {
      const changelog = await transport.getChannel(changelogThreadId);
      if (changelog === null) { const error = new Error('MEMBER_RECORD_CHANGELOG_MISSING'); error.code = 'MEMBER_RECORD_CHANGELOG_MISSING'; throw error; }
      if (changelog.thread_metadata?.archived === true) await transport.editMemberRecordThread(changelogThreadId, { archived: false });
      changelogCheckedAt = Date.now();
    }
    for (const event of unlisted) {
      const line = records.changelogLine(entryOf(event), { guildId, userId, username: profile.username, threadId, messageId: event.messageId });
      event.changelogMessageId = await post(changelogThreadId, `changelog.${event.eventId}`, line);
      await store.progress(lease, { changelog: { [event.eventId]: event.changelogMessageId } }); await step();
    }
    // Archived straight away, so posts do not crowd the server's active threads.
    if (rearchive) await transport.editMemberRecordThread(threadId, { archived: true });
    await store.finish(lease, { revision: job.revision, delivered });
  }

  return Object.freeze({
    async runOnce(owner) {
      requireName(owner);
      if (await enabled() !== true) return { status: 'disabled' };
      if (!excluded) { await store.ensureExclusions(); excluded = true; }
      const job = await store.claim(owner);
      if (!job) return { status: 'idle' };
      try {
        await converge(job);
        return { status: 'settled' };
      } catch (error) {
        const code = typeof error?.code === 'string' && /^[A-Z0-9_]{1,64}$/u.test(error.code) ? error.code : 'MEMBER_RECORD_DELIVERY_FAILED';
        if (code === 'MEMBER_RECORD_LEASE_LOST') return { status: 'lease_lost', code };
        await store.retry(job.lease, code, ['RATE_LIMITED', 'MEMBER_RECORD_DEFERRED'].includes(code) && Number.isSafeInteger(error.retryAfterMs) ? Math.min(86_400_000, error.retryAfterMs) : 0).catch(() => {});
        if (code === 'MEMBER_RECORD_DEFERRED') return { status: 'deferred' };
        return { status: 'retry', code, attempts: job.attempts };
      }
    },
  });
}
