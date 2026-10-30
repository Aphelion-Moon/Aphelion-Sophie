import { requireCondition, requireId, requireInteger, requireRecord } from '../../../contracts/validation.js';
import { applicationAnswers } from '../../../modules/member-records/index.js';
import { memberRoleFlags, profileOf } from '../storage/member-records.js';

const BACKFILL_NOTE = 'Joined before records began: join date from Discord, earlier events not recorded.';
const STAFF_RUN_NOTE = `${BACKFILL_NOTE} Opened in the Staff test run, 30 October 2026.`;
const SLOTS = /^(?:ledger|application|application[2-9]|games|spare)$/u;

/** The member's newest approved application, as stored in the record (form answers, who approved and when; never the interview). */
function applicationOf(request) {
  if (!request) return { status: 'none' };
  requireId(request.id); requireInteger(request.reviewedAtMs, 1);
  return { status: 'found', requestId: request.id, approvedAtMs: request.reviewedAtMs, approvedBy: request.approvedBy ?? null,
    answers: applicationAnswers(request.formResponses) };
}

/**
 * The records the host-only backfill opens (owner decisions, 30 October 2026: "New post for everyone"): one for each
 * current member without a record, bots excluded. A Staff test-run post is adopted with its message IDs, so core takes it
 * over instead of opening a second post; every other member's post is opened by core, behind live work.
 * @param {object} input
 * @param {{ userId: string, bot: boolean, username: string|null, globalName: string|null, nick: string|null, roleIds: string[], joinedAtMs: number|null }[]} input.members
 * @param {Map<string, object>} input.approved each member's newest approved join request (from the transport's reader)
 * @param {Set<string>} input.recorded members who already have a record
 * @param {object} input.staffRun the Staff test run's state file (`members`: user ID to post and message IDs)
 * @param {object} input.mapping the runtime role mapping
 * @param {number} input.now
 */
export function planMemberRecordBackfill({ members, approved, recorded, staffRun, mapping, now }) {
  requireCondition(Array.isArray(members) && approved instanceof Map && recorded instanceof Set, 'MEMBER_RECORD_BACKFILL_INVALID');
  requireRecord(staffRun?.members); requireInteger(now, 1);
  const plan = [];
  for (const member of members) {
    requireId(member.userId);
    if (member.bot || member.userId === mapping.botUserId || recorded.has(member.userId)) continue;
    const application = applicationOf(approved.get(member.userId));
    const staff = staffRun.members[member.userId];
    const profile = profileOf({ username: member.username, globalName: member.globalName, nick: member.nick, present: true,
      roles: memberRoleFlags(member.roleIds, mapping), roleIds: member.roleIds.filter(id => id !== mapping.guildId), joinedAtMs: member.joinedAtMs, joinCount: null, note: staff ? STAFF_RUN_NOTE : BACKFILL_NOTE });
    const applicationEvent = application.status === 'found' ? { eventId: `application.${application.requestId}`, kind: 'application',
      atMs: application.approvedAtMs, detail: { approvedAtMs: application.approvedAtMs } } : null;
    if (staff?.threadId && staff.ledgerLinked && staff.messages?.opened) {
      const messages = { header: staff.threadId, ...Object.fromEntries(Object.entries(staff.messages).filter(([slot]) => SLOTS.test(slot))) };
      requireCondition(['ledger', 'application', 'games', 'spare'].every(slot => messages[slot]), 'MEMBER_RECORD_BACKFILL_INVALID');
      const openedAt = Date.parse(staff.createdAt); requireInteger(openedAt, 1);
      plan.push({ userId: member.userId, profile, application, thread: { threadId: staff.threadId, messages }, background: true, events: [
        { eventId: `opened.${member.userId}`, kind: 'record.opened', atMs: openedAt, detail: { joinedAtMs: member.joinedAtMs }, messageId: staff.messages.opened },
        ...(applicationEvent ? [{ ...applicationEvent, messageId: messages.application }] : [])] });
      continue;
    }
    plan.push({ userId: member.userId, profile, application, thread: null, background: true, events: [
      { eventId: `opened.${member.userId}`, kind: 'record.opened', atMs: now, detail: { joinedAtMs: member.joinedAtMs } },
      ...(applicationEvent ? [applicationEvent] : [])] });
  }
  return plan;
}

const DEPARTED_NOTE = 'Not in the server when records began: known from an approved application or Sophie\'s earlier records; join and leave dates not recorded.';

/**
 * Records for people who have left (owner direction, 30 October 2026: "Logs should be kept on all members, including those
 * who have left."). Discord lists no former members, so these are the people Sophie can name: everyone with an approved
 * application, and everyone her own records saw, who is not in the server now. Each opens as Left, with no join or leave
 * date. Discord's account lookup supplies the names; a deleted account has none.
 * @param {object} input
 * @param {{ userId: string, source: 'application'|'records', user: { username: string|null, globalName: string|null, bot: boolean }|null }[]} input.people
 * @param {Set<string>} input.current members in the server now
 * @param {Set<string>} input.recorded members who already have a record
 * @param {Map<string, object>} input.approved each person's newest approved join request
 */
export function planDepartedMemberRecords({ people, current, recorded, approved, mapping, now }) {
  requireCondition(Array.isArray(people) && current instanceof Set && recorded instanceof Set && approved instanceof Map, 'MEMBER_RECORD_BACKFILL_INVALID');
  requireInteger(now, 1);
  const plan = [], seen = new Set();
  for (const person of people) {
    requireId(person.userId);
    if (seen.has(person.userId) || current.has(person.userId) || recorded.has(person.userId) || person.userId === mapping.botUserId || person.user?.bot) continue;
    seen.add(person.userId);
    const application = applicationOf(approved.get(person.userId));
    const profile = { ...profileOf({ username: person.user?.username ?? null, globalName: person.user?.globalName ?? null, present: false, roles: {},
      joinedAtMs: null, joinCount: null, note: DEPARTED_NOTE }) };
    const source = application.status === 'found' ? 'application' : 'records';
    plan.push({ userId: person.userId, profile, application, thread: null, background: true, events: [
      { eventId: `opened.${person.userId}`, kind: 'record.opened', atMs: now, detail: { present: false, source } },
      ...(application.status === 'found' ? [{ eventId: `application.${application.requestId}`, kind: 'application', atMs: application.approvedAtMs,
        detail: { approvedAtMs: application.approvedAtMs } }] : [])] });
  }
  return plan;
}
