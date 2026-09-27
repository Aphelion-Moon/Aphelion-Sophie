import { createHash } from 'node:crypto';
import { DashboardFailure } from '../../apps/dashboard/api.js';

const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
/** Synthetic UI fixture only; real authorization and retention are verified by CA/RT suites. */
export function createSyntheticAnswersApi({ identity = () => ({ userId: '123', guildId: '456' }) } = {}) {
  const state = { canEditAnswers: true, signedIn: true, records: new Map(), receipts: new Map(), calls: [], loseResponse: false, failure: null };
  const actor = () => ({ actorId: identity().userId, guildId: identity().guildId });
  const publicDocument = { title: 'Synthetic public answer', text: 'Synthetic <img src=x onerror=alert(1)>\n@everyone\nHuman-authored preview copy.', source: 'Synthetic public source; not community policy' };
  function append(name, document, action = 'publish') {
    const rows = state.records.get(name) ?? [], row = { name, revision: rows.length + 1, action, document: structuredClone(document),
      sha256: document === null ? null : hash(document), authorId: identity().userId, createdAt: new Date(1700000000000 + rows.length * 1000).toISOString() };
    rows.push(row); state.records.set(name,rows); return structuredClone(row);
  }
  for (let i = 0; i < 27; i++) append(`sample-${String(i).padStart(2,'0')}`,publicDocument);
  for (let i = 1; i < 12; i++) append('sample-00', { ...publicDocument, title: `Synthetic revision ${i + 1}` });
  const access = editor => { if (!state.signedIn || editor && !state.canEditAnswers) throw new DashboardFailure('denied',403); if (state.failure) throw state.failure; };
  const record = name => state.records.get(name)?.at(-1) ?? null;
  const review = request => { access(true); if ((record(request.name)?.revision ?? 0) !== request.expectedRevision) throw new DashboardFailure('conflict',409);
    if (request.action === 'withdraw' && record(request.name)?.action !== 'publish') throw new DashboardFailure('missing',404);
    return { ...structuredClone(request), previous: structuredClone(record(request.name)), reviewSha256: hash(request), preservesHistory: true, audience: 'current-guild-members', ...actor() };
  };
  const api = {
    session: async () => { access(false); return { ...identity(), canEditAnswers: state.canEditAnswers }; },
    logout: async () => { state.signedIn = false; },
    answers: async (after = null) => { access(false); state.calls.push({ method: 'list', after });
      const rows = [...state.records.values()].map(rows => rows.at(-1)).filter(row => row.action === 'publish' && (after === null || row.name > after)).sort((a,b) => a.name < b.name ? -1 : 1);
      const entries = rows.slice(0,25).map(row => ({ name: row.name, revision: row.revision, title: row.document.title, sha256: row.sha256 }));
      return { ...actor(), entries, next: rows.length > 25 ? entries.at(-1).name : null };
    },
    answer: async name => { access(false); state.calls.push({ method: 'lookup', name }); const row = record(name); if (row?.action !== 'publish') throw new DashboardFailure('missing',404); return { ...structuredClone(row), ...actor() }; },
    answerHistory: async (name,before = null) => { access(true); state.calls.push({ method: 'history', name, before });
      const rows = [...state.records.get(name) ?? []].reverse().filter(row => before === null || row.revision < before), entries = structuredClone(rows.slice(0,10));
      return { ...actor(), name, entries, nextBefore: rows.length > 10 ? entries.at(-1).revision : null };
    },
    reviewAnswer: async request => { state.calls.push({ method: 'review', request: structuredClone(request) }); return review(request); },
    changeAnswer: async request => { access(true); state.calls.push({ method: 'change', request: structuredClone(request) });
      if (!/^[a-f0-9]{64}$/.test(request.requestId) || request.confirmed !== true || request.approvedPublic !== true) throw new DashboardFailure('invalid',400);
      const key = JSON.stringify(request), prior = state.receipts.get(request.requestId);
      if (prior) { if (prior.key !== key) throw new DashboardFailure('conflict',409); return { ...prior.result, duplicate: true, ...actor() }; }
      const fields = { name: request.name, expectedRevision: request.expectedRevision, action: request.action, document: request.document };
      const reviewed = review(fields); if (reviewed.reviewSha256 !== request.reviewSha256) throw new DashboardFailure('conflict',409);
      const row = append(request.name,request.document,request.action), result = { name: row.name, revision: row.revision, action: row.action, duplicate: false, ...actor() };
      state.receipts.set(request.requestId,{ key,result });
      if (state.loseResponse) { state.loseResponse = false; throw new DashboardFailure('connection',503); }
      return result;
    },
  };
  return { state, api, append, publicDocument };
}
