import { createHash } from 'node:crypto';
import { requireCondition, requireId, requireName, requireRecord } from '../../../contracts/validation.js';
import * as records from '../../../modules/member-records/index.js';

const QUIET = Object.freeze({ parse: [], users: [], roles: [], replied_user: false });
const SUPPRESS_EMBEDS = 1 << 2;
const RESERVED_SLOTS = ['ledger', 'application', 'games', 'spare'];
const RENEW_AFTER_MS = 20_000;
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
export function createMemberRecordDispatcher({ store, transport, botUserId, tagIds, enabled, trace = () => {} }) {
  requireId(botUserId); requireRecord(tagIds);
  requireCondition(typeof enabled === 'function' && typeof trace === 'function' && ['claim', 'progress', 'finish', 'retry', 'renew', 'ensureExclusions'].every(key => typeof store?.[key] === 'function') &&
    ['createMemberRecordThread', 'editMemberRecordThread', 'createMemberRecordMessage', 'editMemberRecordMessage', 'getChannel', 'getMemberRecordThreads', 'getApprovedJoinRequests']
      .every(key => typeof transport?.[key] === 'function') && transport.guildId === store.guildId, 'TRUSTED_ADAPTERS_REQUIRED');
  for (const name of records.TAGS) requireId(tagIds[name]);
  const { guildId, changelogThreadId } = store;
  let excluded = false, changelogCheckedAt = 0;

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

  async function converge(job) {
    const { lease, record } = job, { userId, profile } = record;
    const events = job.events.map(event => ({ ...event }));
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
      application = same ? { ...application, recheck: false } : looked;
      const event = !same && application.status === 'found' ? { eventId: `application.${application.requestId}`, kind: 'application', atMs: application.approvedAtMs,
        detail: { approvedAtMs: application.approvedAtMs } } : undefined;
      await store.progress(lease, { application, ...(event ? { applicationEvent: event } : {}) });
      if (event && !events.some(item => item.eventId === event.eventId)) {
        events.push({ ...event, messageId: null, changelogMessageId: null });
        events.sort((a, b) => a.atMs - b.atMs || (a.eventId < b.eventId ? -1 : 1));
      }
    }
    const facts = application?.status === 'found' ? records.applicationFacts(application.answers, application.approvedAtMs) : null;
    const mutes = job.mutes;
    const header = records.renderHeader({ userId, username: profile.username, displayName: profile.displayName, present: profile.present, roles: profile.roles,
      joinedAtMs: profile.joinedAtMs ?? null, joinCount: profile.joinCount ?? null, lastLeftAtMs: profile.lastLeftAtMs ?? null, shuttle: job.shuttle, mutes,
      application: facts, earlierNames: profile.earlierNames ?? [], note: profile.note ?? null, updatedAtMs: record.updatedAtMs });
    const appMessages = applicationMessages(application);
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
        const created = await transport.createMemberRecordThread({ name: title, auto_archive_duration: 1440, applied_tags: tags,
          message: { content: header, allowed_mentions: { ...QUIET }, flags: SUPPRESS_EMBEDS } });
        requireId(created?.id); threadId = created.id;
        Object.assign(delivered, { header: sha(header), title, tags: [...tags].sort().join(',') });
      }
      await store.progress(lease, { threadId }); messages.header = threadId; rearchive = true;
    }

    const entryOf = event => ({ kind: event.kind, atMs: event.atMs, ...event.detail });
    const pendingEntries = events.filter(event => event.kind !== 'application' && !event.messageId);
    const ledgerOf = () => records.renderLedger([
      ...events.filter(event => event.messageId).map(event => ({ atMs: event.atMs, label: records.entryLabel(entryOf(event)), messageId: event.messageId })),
      ...appMessages.slice(1).map((_, index) => messages[`application${index + 2}`]).filter(Boolean)
        .map(messageId => ({ atMs: application.approvedAtMs, label: 'Access application, continued', messageId })),
    ], { guildId, channelId: threadId });
    const desiredTags = watch => records.recordTags({ present: profile.present, roles: profile.roles, watch }).map(name => tagIds[name]);
    const appHashes = appMessages.map(sha);
    const threadWork = RESERVED_SLOTS.some(slot => !messages[slot]) || appMessages.slice(1).some((_, index) => !messages[`application${index + 2}`]) ||
      pendingEntries.length > 0 || appHashes.some((hash, index) => delivered.application?.[index] !== hash) || delivered.header !== sha(header) ||
      delivered.title !== title || delivered.tags !== [...desiredTags(false)].sort().join(',') ||
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
        const content = slot === 'ledger' ? records.renderLedger([], { guildId, channelId: threadId }) : slot === 'application' ? appMessages[0] : records.RESERVED[slot];
        messages[slot] = await post(threadId, slot, content);
        await store.progress(lease, { slots: { [slot]: messages[slot] } }); await step();
        if (slot === 'application') delivered.application = [appHashes[0]];
        if (slot === 'ledger') delivered.ledger = sha(content);
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
      delivered.application = applicationHashes.slice(0, appMessages.length);
      const applicationEvents = events.filter(event => event.kind === 'application' && !event.messageId);
      if (application?.status === 'found' && applicationEvents.length) {
        for (const event of applicationEvents) event.messageId = messages.application;
        await store.progress(lease, { entries: Object.fromEntries(applicationEvents.map(event => [event.eventId, messages.application])) });
      }
      // Each new entry, oldest first.
      for (const event of pendingEntries) {
        event.messageId = await post(threadId, `entry.${event.eventId}`, records.entryText(entryOf(event)));
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
      // A Watch tag a person set stays.
      const watch = (current?.applied_tags ?? []).includes(tagIds.Watch);
      const tags = desiredTags(watch), tagKey = [...desiredTags(false)].sort().join(',');
      if (delivered.title !== title || delivered.tags !== tagKey) {
        await transport.editMemberRecordThread(threadId, { ...(delivered.title !== title ? { name: title } : {}), applied_tags: tags });
        delivered.title = title; delivered.tags = tagKey;
      }
      await step();
    }
    // Every entry gets one line in the changelog, linking to it. The changelog post archives itself after a quiet week, so
    // it is checked (at most every ten minutes) and woken before Sophie writes there.
    const unlisted = events.filter(item => item.messageId && !item.changelogMessageId);
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
        await store.retry(job.lease, code, code === 'RATE_LIMITED' && Number.isSafeInteger(error.retryAfterMs) ? Math.min(86_400_000, error.retryAfterMs) : 0).catch(() => {});
        return { status: 'retry', code, attempts: job.attempts };
      }
    },
  });
}
