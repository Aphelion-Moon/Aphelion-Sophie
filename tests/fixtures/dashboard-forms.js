import { createHash } from 'node:crypto';
import { DashboardFailure } from '../../apps/dashboard/api.js';
import { FORM_CATEGORIES } from '../../apps/dashboard/form-controller.js';
import { canonicalCaseFormDraft } from '../../modules/tickets/intake.js';
import { reviewCaseFormDraft } from '../../modules/tickets/form-authoring.js';
import { syntheticCaseForm } from './case-intake.js';

const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const copy = value => structuredClone(value);
/** UI fixture only; never composed by production and never evidence of authentication or persistence. */
export function createSyntheticFormApi({ initial = true } = {}) {
  const state = { userId: '100000000000000002', guildId: '100000000000000001', canEditOnboarding: true, canEditForms: true,
    signedIn: true, records: new Map(FORM_CATEGORIES.map(([id]) => [id, { drafts: [], publications: [] }])), receipts: new Map(), faults: [], calls: [], csrf: 'ab'.repeat(32) };
  const meta = (number, document, published = false) => ({ [published ? 'version' : 'revision']: number, sha256: hash(document),
    authorId: state.userId, createdAt: '2026-09-19T12:00:00.000Z', ...(published ? { status: 'published' } : {}) });
  if (initial) { const form = syntheticCaseForm(), record = state.records.get(form.caseType); record.drafts.push({ ...meta(1, form), document: form }); record.publications.push({ ...meta(1, form, true), form }); }
  const record = category => { const value = state.records.get(category); if (!value) throw new DashboardFailure('invalid', 400); return value; };
  const latest = category => record(category).publications.at(-1) ?? null;
  const current = category => latest(category)?.status === 'published' ? latest(category).version : null;
  const metadata = value => { if (!value) return null; const { document, form, ...meta } = value; return meta; };
  const conflict = () => { throw new DashboardFailure('conflict', 409); };
  const effect = (kind, payload, work) => {
    const old = state.receipts.get(payload.requestId);
    if (old) { if (old.kind !== kind || old.userId !== state.userId || old.input !== JSON.stringify(payload)) conflict(); return { ...old.result, duplicate: true }; }
    const result = work(); state.receipts.set(payload.requestId, { kind, input: JSON.stringify(payload), userId: state.userId, result }); return { ...result, duplicate: false };
  };
  const methods = {
    session: () => ({ userId: state.userId, guildId: state.guildId, canEditForms: state.canEditForms, canEditOnboarding: state.canEditOnboarding }),
    formDraft(caseType, revision = null) {
      const draft = revision === null ? record(caseType).drafts.at(-1) ?? null : record(caseType).drafts.find(row => row.revision === revision);
      if (revision !== null && !draft) throw new DashboardFailure('missing', 404);
      return { caseType, draft, latest: metadata(latest(caseType)), newRequestVersion: current(caseType) };
    },
    formHistory(caseType, kind, before = null) {
      const key = kind === 'drafts' ? 'revision' : 'version', rows = [...record(caseType)[kind]].reverse().filter(row => before === null || row[key] < before);
      return { caseType, entries: rows.slice(0, 10).map(metadata), nextBefore: rows.length > 10 ? rows[9][key] : null };
    },
    formReview(caseType, revision) {
      const draft = record(caseType).drafts.find(row => row.revision === revision); if (!draft) throw new DashboardFailure('missing', 404);
      return { caseType, draft: metadata(draft), currentRevision: record(caseType).drafts.at(-1).revision, latest: metadata(latest(caseType)),
        ...reviewCaseFormDraft(draft.document), nextVersion: (latest(caseType)?.version ?? 0) + 1, newRequestVersion: current(caseType), preservesOpenForms: true, preservesSubmittedAnswers: true };
    },
    formPublication(caseType, version) {
      const publication = record(caseType).publications.find(row => row.version === version); if (!publication) throw new DashboardFailure('missing', 404);
      return { caseType, ...publication, preview: reviewCaseFormDraft(publication.form).preview, newRequestVersion: current(caseType),
        newRequestVersionAfterWithdrawal: current(caseType) === version ? null : current(caseType), invalidatesOpenForms: true, preservesSubmittedAnswers: true };
    },
    formSave: payload => effect('save', payload, () => {
      const rows = record(payload.caseType).drafts; if (payload.expectedRevision !== (rows.at(-1)?.revision ?? 0)) conflict();
      const document = canonicalCaseFormDraft(payload.document); if (document.caseType !== payload.caseType) throw new DashboardFailure('invalid', 400);
      const revision = payload.expectedRevision + 1; rows.push({ ...meta(revision, document), document }); return { caseType: payload.caseType, action: 'save', revision, sha256: hash(document) };
    }),
    formPublish: payload => effect('publish', payload, () => {
      const draft = record(payload.caseType).drafts.at(-1), current = latest(payload.caseType);
      if (draft?.revision !== payload.expectedRevision || draft.sha256 !== payload.expectedHash || (current?.version ?? 0) !== payload.expectedLatestVersion || (current?.status ?? 'none') !== payload.expectedLatestStatus) conflict();
      const review = reviewCaseFormDraft(draft.document); if (!review.valid) throw new DashboardFailure('invalid', 400);
      const version = (current?.version ?? 0) + 1; record(payload.caseType).publications.push({ ...meta(version, review.form, true), form: review.form });
      return { caseType: payload.caseType, action: 'publish', revision: draft.revision, version, sha256: hash(review.form) };
    }),
    formWithdraw: payload => effect('withdraw', payload, () => {
      const row = record(payload.caseType).publications.find(row => row.version === payload.version);
      if (row?.sha256 !== payload.expectedHash || row.status !== 'published' || payload.confirm !== true) conflict();
      row.status = 'withdrawn'; return { caseType: payload.caseType, action: 'withdraw', version: row.version, newRequestVersionAtWithdrawal: current(payload.caseType), sha256: row.sha256 };
    }),
    logout() { state.signedIn = false; return { status: 'signed_out' }; },
  };
  const api = Object.fromEntries(Object.entries(methods).map(([name, method]) => [name, async (...args) => {
    state.calls.push({ name, args: copy(args) });
    if (!state.signedIn || !['session', 'logout'].includes(name) && !state.canEditForms) throw new DashboardFailure('denied', 403);
    const index = state.faults.findIndex(row => row.method === name), fault = index >= 0 ? state.faults.splice(index, 1)[0] : null;
    if (fault && !fault.after) throw new DashboardFailure(fault.kind, fault.status);
    const result = copy(method(...args)); if (fault) throw new DashboardFailure(fault.kind, fault.status); return result;
  }]));
  return { api, state };
}
