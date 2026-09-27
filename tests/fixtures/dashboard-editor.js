import { createHash } from 'node:crypto';
import { emptyDraft } from '../../apps/dashboard/controller.js';
import { DashboardFailure } from '../../apps/dashboard/api.js';
import { canonicalOnboardingDraft, reviewOnboardingDraft } from '../../modules/onboarding/authoring.js';

const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const clone = value => structuredClone(value);
export function syntheticGuidance() {
  const document = emptyDraft();
  const bodies = [
    'SYNTHETIC REVIEW COPY\n\nWelcome aboard. This is a local demonstration of the guidance editor. No member records or live Discord services are connected.\n\nTake time to read each page. You can return to an earlier page whenever you need a reminder.',
    'Before travelling, take a moment to check your supplies.\n\nThis sample text stands in for approved community links and guidance. It is not the community’s published onboarding copy.',
    'Step aboard when you are ready.\n\nIf something is unclear, ask a member of staff for help. This demonstration does not send any messages.',
    'Enjoy the view from the observation deck.\n\nThis page is a place for useful orientation material. The text is deliberately synthetic and can be edited safely in this local preview.',
    'You have reached the end of this example journey.\n\nReview any earlier page before continuing. Saving or publishing in this demonstration changes only temporary in-memory fixtures.',
  ];
  // Retain a legacy publication to exercise editing without rewriting saved hashes.
  document.stages.forEach((stage, index) => { stage.body = bodies[index]; delete stage.screens; }); return document;
}

/** Test-only in-memory API: not authentication, persistence or permission evidence. Never composed by runtime code. */
export function createSyntheticEditorApi({ initial = true } = {}) {
  const state = { userId: '100000000000000002', guildId: '100000000000000001', canEditOnboarding: true, signedIn: true,
    drafts: [], publications: [], receipts: new Map(), calls: [], faults: [], csrf: 'ab'.repeat(32) };
  const meta = (number, document, publication = false) => ({ [publication ? 'version' : 'revision']: number, sha256: hash(document),
    authorId: state.userId, createdAt: '2026-09-19T10:00:00.000Z', ...(publication ? { status: 'published', contentAvailable: true } : {}) });
  if (initial) {
    const document = syntheticGuidance(); state.drafts.push({ ...meta(1, document), document });
    const publication = reviewOnboardingDraft('shuttle', 1, document).publication;
    state.publications.push({ ...meta(1, publication, true), publication });
  }
  const latest = () => state.publications.at(-1) ?? null;
  const current = (except = null) => state.publications.filter(p => p.status === 'published' && p.version !== except).at(-1)?.version ?? null;
  const metadata = value => { if (!value) return null; const { document, publication, ...metadata } = value; return metadata; };
  const overview = revision => ({ definitionId: 'shuttle', draft: revision ? state.drafts.find(d => d.revision === revision) : state.drafts.at(-1) ?? null,
    latest: metadata(latest()), currentPublishedVersion: current() });
  const conflict = () => { throw new DashboardFailure('conflict', 409); };
  const effect = (kind, payload, work) => {
    const old = state.receipts.get(payload.requestId);
    if (old) { if (old.kind !== kind || old.userId !== state.userId || old.input !== JSON.stringify(payload)) conflict(); return { ...old.result, duplicate: true }; }
    const result = work(); state.receipts.set(payload.requestId, { kind, input: JSON.stringify(payload), userId: state.userId, result }); return { ...result, duplicate: false };
  };
  const methods = {
    session: () => ({ userId: state.userId, guildId: state.guildId, canEditOnboarding: state.canEditOnboarding }),
    draft(revision = null) { const result = overview(revision); if (revision && !result.draft) throw new DashboardFailure('missing', 404); return result; },
    history(kind, before = null) {
      const key = kind === 'drafts' ? 'revision' : 'version';
      const rows = [...state[kind]].reverse().filter(row => before === null || row[key] < before);
      return { definitionId: 'shuttle', entries: rows.slice(0, 10).map(metadata), nextBefore: rows.length > 10 ? rows[9][key] : null };
    },
    review(revision) {
      const draft = state.drafts.find(d => d.revision === revision); if (!draft) throw new DashboardFailure('missing', 404);
      return { definitionId: 'shuttle', draft: metadata(draft), currentRevision: state.drafts.at(-1).revision, latest: metadata(latest()),
        ...reviewOnboardingDraft('shuttle', (latest()?.version ?? 0) + 1, draft.document), currentPublishedVersion: current(), preservesExistingRuns: true,
        latestImpact: { active: 0, rolePending: 0, complete: 0 } };
    },
    publication(version) {
      const publication = state.publications.find(p => p.version === version); if (!publication) throw new DashboardFailure('missing', 404);
      return { definitionId: 'shuttle', ...publication, currentPublishedVersion: current(), newRunVersionAfterWithdrawal: current(version), impact: { active: 0, rolePending: 0, complete: 0 } };
    },
    save: payload => effect('save', payload, () => {
      if (payload.expectedRevision !== (state.drafts.at(-1)?.revision ?? 0)) conflict();
      const document = canonicalOnboardingDraft(payload.document), revision = payload.expectedRevision + 1;
      state.drafts.push({ ...meta(revision, document), document }); return { action: 'save', revision, sha256: hash(document) };
    }),
    publish: payload => effect('publish', payload, () => {
      const draft = state.drafts.at(-1); if (draft?.revision !== payload.expectedRevision || draft.sha256 !== payload.expectedHash ||
        (latest()?.version ?? 0) !== payload.expectedLatestVersion || (latest()?.status ?? 'none') !== payload.expectedLatestStatus) conflict();
      const version = (latest()?.version ?? 0) + 1, review = reviewOnboardingDraft('shuttle', version, draft.document);
      if (!review.valid) throw new DashboardFailure('invalid', 400);
      const publication = review.publication; state.publications.push({ ...meta(version, publication, true), publication });
      return { action: 'publish', revision: draft.revision, version, sha256: hash(publication) };
    }),
    withdraw: payload => effect('withdraw', payload, () => {
      const record = state.publications.find(p => p.version === payload.version);
      if (record?.sha256 !== payload.expectedHash || record.status !== 'published' || payload.confirm !== true) conflict();
      record.status = 'withdrawn'; return { action: 'withdraw', version: record.version, newRunVersionAtWithdrawal: current(), sha256: record.sha256 };
    }),
    logout() { state.signedIn = false; return { status: 'signed_out' }; },
  };
  const api = Object.fromEntries(Object.entries(methods).map(([name, method]) => [name, async (...args) => {
    state.calls.push({ name, args: clone(args) });
    if (!state.signedIn || (name !== 'session' && name !== 'logout' && !state.canEditOnboarding)) throw new DashboardFailure('denied', 403);
    const index = state.faults.findIndex(fault => fault.method === name), fault = index >= 0 ? state.faults.splice(index, 1)[0] : null;
    if (fault && !fault.after) throw new DashboardFailure(fault.kind, fault.status);
    const result = clone(method(...args)); if (fault) throw new DashboardFailure(fault.kind, fault.status); return result;
  }]));
  return { api, state };
}
