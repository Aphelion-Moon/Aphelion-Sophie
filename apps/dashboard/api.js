import { dashboardPageAllowed } from '../../contracts/dashboard-navigation.js';

/** Browser-only, fixed same-origin routes. Credentials never enter browser storage. */
export class DashboardFailure extends Error {
  constructor(kind, status = 0) { super(kind); this.name = 'DashboardFailure'; this.kind = kind; this.status = status; }
}

export function createDashboardApi({ fetch, navigate = path => globalThis.location?.replace(path), document = globalThis.document }) {
  let csrf = null;
  let initial = document?.querySelector('meta[name="sophie-session"]') ?? null;
  const login = () => navigate('/login?returnTo=' + encodeURIComponent(globalThis.location?.pathname ?? '/'));
  async function request(path, body, post = body !== undefined, download = false) {
    if (post && csrf === null) throw new DashboardFailure('denied', 403);
    let response;
    try {
      response = await fetch(path, { method: post ? 'POST' : 'GET', credentials: 'same-origin', mode: 'same-origin',
        cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(12_000),
        headers: { Accept: download ? 'text/html' : 'application/json', ...(post ? { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf } : {}) },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
    } catch { throw new DashboardFailure('connection'); }
    if (!response.ok) throw new DashboardFailure(response.status === 403 ? 'denied' : response.status === 409 ? 'conflict' :
      response.status === 400 ? 'invalid' : response.status === 404 ? 'missing' : 'unavailable', response.status);
    try {
      if (download) {
        const filename = `sophie-transcript-${body.caseToken}-${body.channelId}.html`;
        const length = Number(response.headers.get('content-length'));
        if (response.headers.get('content-type') !== 'text/html; charset=utf-8' ||
            response.headers.get('content-disposition') !== `attachment; filename="${filename}"` ||
            !Number.isSafeInteger(length) || length < 1 || length > 2_097_152) throw new Error('shape');
        const blob = await response.blob();
        if (blob.size !== length) throw new Error('shape');
        return { filename, blob };
      }
      const value = await response.json();
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('shape'); return value;
    } catch { throw new DashboardFailure('unavailable'); }
  }
  const number = value => { if (!Number.isSafeInteger(value) || value < 1 || value > 2_147_483_647) throw new DashboardFailure('invalid', 400); return value; };
  const category = value => { if (!['admin-help', 'staff-report', 'tech-support', 'database-support', 'head-admin-contact', 'player-report', 'staff-contact'].includes(value)) throw new DashboardFailure('invalid', 400); return value; };
  const channel = value => { if (typeof value !== 'string' || !/^[1-9][0-9]{0,19}$/.test(value)) throw new DashboardFailure('invalid', 400); return value; };
  const ledger = value => { if (typeof value !== 'string' || !/^[a-f0-9]{48}$/.test(value)) throw new DashboardFailure('invalid', 400); return value; };
  const answer = value => { if (typeof value !== 'string' || !/^[a-z][a-z0-9-]{0,39}$/.test(value)) throw new DashboardFailure('invalid', 400); return value; };
  const cursor = value => { if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,320}$/.test(value)) throw new DashboardFailure('invalid', 400); return value; };
  return Object.freeze({
    knowledgeCatalogue: () => request('/api/ai/knowledge'),
    knowledgeDocument: id => request(`/api/ai/knowledge/document?id=${encodeURIComponent(id)}`),
    knowledgeReview: body => request('/api/ai/knowledge/review', body),
    knowledgePublish: body => request('/api/ai/knowledge/publish', body),
    knowledgeWithdraw: body => request('/api/ai/knowledge/withdraw', body),
    aiPublication: kind => {
      if (!['configuration', 'personality'].includes(kind)) throw new DashboardFailure('invalid', 400);
      return request(`/api/ai/publication?kind=${kind}`);
    },
    aiReview: body => request('/api/ai/review', body),
    aiPublish: body => request('/api/ai/publish', body),
    aiDisable: () => request('/api/ai/disable', {}),
    aiConsents: () => request('/api/ai/consents'),
    aiConsent: body => request('/api/ai/consent', body),
    async session() {
      let value;
      try {
        if (initial !== null) {
          const node = initial; initial = null; node.remove();
          try { value = JSON.parse(decodeURIComponent(node.content)); } catch { throw new DashboardFailure('unavailable'); }
        } else value = await request('/auth/session');
      }
      catch (error) { if (error.kind === 'denied') login(); throw error; }
      if (!/^[a-f0-9]{64}$/.test(value.csrfToken ?? '') || !/^[1-9][0-9]{0,19}$/.test(value.userId ?? '') ||
        !/^[1-9][0-9]{0,19}$/.test(value.guildId ?? '') || typeof value.canEditOnboarding !== 'boolean' || typeof value.canEditForms !== 'boolean') throw new DashboardFailure('unavailable');
      if (value.canEditAnswers !== undefined && typeof value.canEditAnswers !== 'boolean') throw new DashboardFailure('unavailable');
      if (value.canEditPermissions !== undefined && typeof value.canEditPermissions !== 'boolean') throw new DashboardFailure('unavailable');
      if (value.canEditAutomation !== undefined && typeof value.canEditAutomation !== 'boolean') throw new DashboardFailure('unavailable');
      for (const key of ['canControlAi', 'canEditPersonality', 'canEditKnowledge', 'aiAvailable']) if (value[key] !== undefined && typeof value[key] !== 'boolean') throw new DashboardFailure('unavailable');
      for (const group of document?.querySelectorAll('.nav-group') ?? []) {
        const links = [...group.querySelectorAll('a')];
        for (const link of links) link.hidden = !dashboardPageAllowed(link.getAttribute('href'), value);
        group.hidden = links.every(link => link.hidden);
      }
      csrf = value.csrfToken; return { userId: value.userId, guildId: value.guildId, canEditOnboarding: value.canEditOnboarding, canEditForms: value.canEditForms, canEditPermissions: value.canEditPermissions === true, canEditAnswers: value.canEditAnswers === true, canEditAutomation: value.canEditAutomation === true,
        canEditKnowledge: value.canEditKnowledge === true, canControlAi: value.canControlAi === true, canEditPersonality: value.canEditPersonality === true, aiAvailable: value.aiAvailable === true };
    },
    automation: () => request('/api/automation'),
    automationHistory: (before = null) => request('/api/automation/history' + (before === null ? '' : '?before=' + number(before))),
    reviewAutomation: body => request('/api/automation/review', body),
    previewAutomation: body => request('/api/automation/preview', body),
    changeAutomation: body => request('/api/automation/change', body),
    automationIssues: (before = null) => {
      if (before !== null && (typeof before !== 'string' || !/^[a-f0-9]{32}$/.test(before))) throw new DashboardFailure('invalid', 400);
      return request('/api/automation/issues' + (before === null ? '' : '?before=' + before));
    },
    automationIssue: (deliveryId, before = null) => {
      if (typeof deliveryId !== 'string' || !/^[a-f0-9]{32}$/.test(deliveryId)) throw new DashboardFailure('invalid', 400);
      return request('/api/automation/issue?deliveryId=' + deliveryId + (before === null ? '' : '&before=' + number(before)));
    },
    repairAutomation: body => request('/api/automation/repair', body),
    permissionDraft: (revision = null) => request('/api/permissions/draft' + (revision === null ? '' : '?revision=' + number(revision))),
    permissionReview: revision => request('/api/permissions/review?revision=' + number(revision)),
    permissionPublication: version => request('/api/permissions/publication?version=' + number(version)),
    permissionHistory(kind, before = null) {
      if (!['drafts', 'publications'].includes(kind)) throw new DashboardFailure('invalid', 400);
      return request('/api/permissions/history?kind=' + kind + (before === null ? '' : '&before=' + number(before)));
    },
    permissionSave: body => request('/api/permissions/save', body),
    permissionPublish: body => request('/api/permissions/publish', body),
    permissionWithdraw: body => request('/api/permissions/withdraw', body),
    permissionDeploymentReview: version => request('/api/permissions/deployment-review?version=' + number(version)),
    permissionApply: body => request('/api/permissions/apply', body),
    permissionApplication: () => request('/api/permissions/application'),
    permissionRetryApplication: body => request('/api/permissions/retryApplication', body),
    systemWording: () => request('/api/system-wording'),
    saveSystemWording: body => request('/api/system-wording/save', body),
    draft: (revision = null) => request(`/api/onboarding/draft${revision === null ? '' : `?revision=${number(revision)}`}`),
    history(kind, before = null) {
      if (!['drafts', 'publications'].includes(kind)) throw new DashboardFailure('invalid', 400);
      return request(`/api/onboarding/history?kind=${kind}${before === null ? '' : `&before=${number(before)}`}`);
    },
    review: revision => request(`/api/onboarding/review?revision=${number(revision)}`),
    publication: version => request(`/api/onboarding/publication?version=${number(version)}`),
    save: body => request('/api/onboarding/save', body),
    publish: body => request('/api/onboarding/publish', body),
    withdraw: body => request('/api/onboarding/withdraw', body),
    formDraft: (caseType, revision = null) => request(`/api/ticket-forms/draft?caseType=${category(caseType)}${revision === null ? '' : `&revision=${number(revision)}`}`),
    formHistory(caseType, kind, before = null) {
      if (!['drafts', 'publications'].includes(kind)) throw new DashboardFailure('invalid', 400);
      return request(`/api/ticket-forms/history?caseType=${category(caseType)}&kind=${kind}${before === null ? '' : `&before=${number(before)}`}`);
    },
    formReview: (caseType, revision) => request(`/api/ticket-forms/review?caseType=${category(caseType)}&revision=${number(revision)}`),
    formPublication: (caseType, version) => request(`/api/ticket-forms/publication?caseType=${category(caseType)}&version=${number(version)}`),
    formSave: body => request('/api/ticket-forms/save', body),
    formPublish: body => request('/api/ticket-forms/publish', body),
    formWithdraw: body => request('/api/ticket-forms/withdraw', body),
    transcriptChannel: channelId => request(`/api/cases/transcript/channel?channelId=${channel(channelId)}`),
    caseNotes: (channelId, before = null) => request(`/api/cases/notes?channelId=${channel(channelId)}${before === null ? '' : `&before=${number(before)}`}`),
    appendCaseNote: body => request('/api/cases/notes/append', { ...body, channelId: channel(body.channelId) }),
    caseReplies(channelId, before = null) {
      if (before !== null && (!Number.isSafeInteger(before.createdAt) || before.createdAt < 0 || typeof before.id !== 'string' || !/^[a-f0-9]{32}$/.test(before.id))) throw new DashboardFailure('invalid', 400);
      return request(`/api/cases/replies?channelId=${channel(channelId)}${before === null ? '' : `&beforeAt=${before.createdAt}&beforeId=${before.id}`}`);
    },
    requestCaseReply: body => request('/api/cases/replies/request', { ...body, channelId: channel(body.channelId) }),
    answers: (after = null) => request(`/api/answers${after === null ? '' : `?after=${answer(after)}`}`),
    answer: name => request(`/api/answers/lookup?name=${answer(name)}`),
    answerHistory: (name, before = null) => request(`/api/answers/history?name=${answer(name)}${before === null ? '' : `&before=${number(before)}`}`),
    reviewAnswer: body => request('/api/answers/review', { ...body, name: answer(body.name) }),
    changeAnswer: body => request('/api/answers/change', { ...body, name: answer(body.name) }),
    caseLabels: (channelId, before = null) => request(`/api/cases/labels?channelId=${channel(channelId)}${before === null ? '' : `&before=${number(before)}`}`),
    saveCaseLabels: body => request('/api/cases/labels/save', { ...body, channelId: channel(body.channelId) }),
    managedCase: channelId => request(`/api/cases/manage?channelId=${channel(channelId)}`),
    caseQueue(filter = 'active', after = null) {
      if (!['active', 'closed', 'failed'].includes(filter)) throw new DashboardFailure('invalid', 400);
      return request(`/api/cases/queue?filter=${filter}${after === null ? '' : `&after=${ledger(after)}`}`);
    },
    changeCase: body => request('/api/cases/manage/change', { ...body, channelId: channel(body.channelId) }),
    contactAccess: () => request('/api/contacts/access'),
    receivedContacts: (after = null) => request(`/api/contacts/received${after === null ? '' : `?after=${ledger(after)}`}`),
    receivedContactDestination: caseToken => request(`/api/contacts/received/destination?caseToken=${ledger(caseToken)}`),
    contactReview: requestId => request(`/api/contacts/review?requestId=${encodeURIComponent(requestId)}`),
    contactDestination: requestId => request(`/api/contacts/destination?requestId=${encodeURIComponent(requestId)}`),
    contactChange(action, body) {
      if (!['select', 'confirm', 'cancel', 'submit'].includes(action)) throw new DashboardFailure('invalid', 400);
      return request(`/api/contacts/${action}`, body);
    },
    transcript({ caseToken, channelId, after = null, gapsAfter = null }) {
      return request(`/api/cases/transcript?caseToken=${ledger(caseToken)}&channelId=${channel(channelId)}` +
        (after === null ? '' : `&after=${cursor(after)}`) + (gapsAfter === null ? '' : `&gapsAfter=${cursor(gapsAfter)}`));
    },
    exportReview: ({ caseToken, channelId }) => request('/api/cases/export/review', { caseToken: ledger(caseToken), channelId: channel(channelId) }),
    exportDownload: body => request('/api/cases/export/download', { ...body, caseToken: ledger(body.caseToken), channelId: channel(body.channelId) }, true, true),
    async logout() { await request('/auth/logout', undefined, true); csrf = null; navigate('/login'); },
  });
}
