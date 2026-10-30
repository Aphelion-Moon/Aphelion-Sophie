import { requireCondition, requireId, requireName } from '../../../contracts/validation.js';
import { planDepartedMemberRecords } from '../operator/member-record-backfill.js';

const NOTE = 'Opened by Sophie\'s regular check: already in the server then; join date from Discord, earlier events not recorded.';
const USERS_PER_RUN = 25;

/**
 * Sophie's regular member records check (owner, 30 October 2026: "Backfill script should probably have an automatic run?
 * You decide."): when core starts and every six hours, it reads Discord's member list and approved applications (reads
 * only) and brings the records in line: a record for every current member who lacks one, the joins, leaves, role and name
 * changes made while Sophie was offline (marked as noticed, not seen), and a Left record for people who have left that
 * Sophie can name (approved applicants and members her records saw; at most 25 account lookups a run). Core then posts
 * the changes as usual, behind live work. A member list that would mean more than a few leaves at once is not trusted.
 */
export function createMemberRecordReconciler({ store, transport, mapping, enabled, clock, intervalMs = 6 * 3_600_000 }) {
  requireCondition(['reconcile', 'seenUserIds', 'recordedMembers', 'open'].every(key => typeof store?.[key] === 'function') &&
    ['getMemberRecordMembers', 'getApprovedJoinRequests', 'getRecordUser'].every(key => typeof transport?.[key] === 'function') &&
    typeof enabled === 'function' && typeof clock === 'function' && Number.isSafeInteger(intervalMs) && intervalMs >= 60_000, 'TRUSTED_ADAPTERS_REQUIRED');
  requireId(mapping?.botUserId);
  let nextAt = 0;
  async function run() {
    const startedAtMs = clock();
    const members = [];
    for (let after = '0', page = 0; ; page += 1) {
      requireCondition(page < 50, 'MEMBER_RECORD_RECONCILE_LIMIT');
      const rows = await transport.getMemberRecordMembers({ after, limit: 200 });
      members.push(...rows);
      if (rows.length < 200) break;
      after = rows.at(-1).userId;
    }
    const approved = new Map();
    for (let before = null, page = 0; page < 40; page += 1) {
      const list = await transport.getApprovedJoinRequests({ before, limit: 50 });
      for (const request of list) {
        if (request.status !== 'APPROVED' || request.reviewedAtMs === null) continue;
        const previous = approved.get(request.userId);
        if (!previous || request.reviewedAtMs > previous.reviewedAtMs) approved.set(request.userId, request);
      }
      if (list.length < 50 || list.at(-1).id === before) break;
      before = list.at(-1).id;
    }
    const counts = await store.reconcile({ members, approved, startedAtMs, mapping, note: NOTE });
    // People who have left that Sophie can name, a few account lookups at a time.
    const current = new Set(members.map(member => member.userId)), recorded = new Set(await store.recordedMembers());
    const candidates = [...new Set([...approved.keys(), ...await store.seenUserIds()])].filter(id => !current.has(id) && !recorded.has(id)).slice(0, USERS_PER_RUN);
    const people = [];
    for (const userId of candidates) {
      const user = await transport.getRecordUser(userId);
      people.push({ userId, source: approved.has(userId) ? 'application' : 'records', user });
    }
    let departed = 0;
    for (const item of planDepartedMemberRecords({ people, current, recorded, approved, mapping, now: clock() })) if ((await store.open(item)).opened) departed += 1;
    return { ...counts, departed };
  }
  return Object.freeze({
    /** Runs when due (at start, then every interval); a failed run is tried again in ten minutes. */
    async runDue(owner) {
      requireName(owner);
      if (clock() < nextAt) return { status: 'idle' };
      if (await enabled() !== true) return { status: 'disabled' };
      nextAt = clock() + 600_000;
      try {
        const result = await run();
        nextAt = clock() + intervalMs;
        return { status: 'reconciled', ...result };
      } catch (error) {
        return { status: 'failed', code: typeof error?.code === 'string' && /^[A-Z0-9_]{1,64}$/u.test(error.code) ? error.code : 'MEMBER_RECORD_RECONCILE_FAILED' };
      }
    },
  });
}
