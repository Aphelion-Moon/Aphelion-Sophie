import { createSyntheticPermissionsApi } from '../tests/fixtures/dashboard-permissions.js';
import { dashboardReturnPath } from '../contracts/dashboard-navigation.js';
import { createServer } from 'node:http';
import { createDashboardPresentation, sendDashboardAsset } from '../apps/core/http/dashboard-assets.js';
import { createSyntheticEditorApi } from '../tests/fixtures/dashboard-editor.js';
import { createSyntheticFormApi } from '../tests/fixtures/dashboard-forms.js';
import { createSyntheticAnswersApi } from '../tests/fixtures/dashboard-answers.js';
import { createSyntheticAutomationApi } from '../tests/fixtures/dashboard-automation.js';
import { createHash } from 'node:crypto';
import { sendCaseExport } from '../apps/core/http/case-exports.js';

// Deliberately separate from runtime composition: temporary synthetic data, no credentials, database or Discord.
const presentation = await createDashboardPresentation(), fixture = createSyntheticEditorApi(), forms = createSyntheticFormApi();
const permissionPreview = createSyntheticPermissionsApi();
const answerPreview = createSyntheticAnswersApi({ identity: () => ({ userId: fixture.state.userId, guildId: fixture.state.guildId }) });
const automationPreview = createSyntheticAutomationApi({ identity: () => ({ userId: fixture.state.userId, guildId: fixture.state.guildId }) });
const caseToken = 'a'.repeat(48), channelId = '123', exportBody = '<!doctype html><html lang="en"><title>Synthetic preview</title><p>Synthetic export only. No Discord connection.</p></html>';
const exportReview = { caseToken, channelId, completeHistory: false, reviewHash: 'b'.repeat(64), sha256: createHash('sha256').update(exportBody).digest('hex'),
  observations: 6, gaps: 26, bytes: Buffer.byteLength(exportBody), policyVersion: 1 };
let caseAllowed = true;
const notes = Array.from({ length: 27 }, (_, index) => ({ number: index + 1, authorId: '123', createdAt: 0,
  text: index === 26 ? 'Synthetic note <img src=x onerror=alert(1)>\n@everyone' : `Synthetic note ${index + 1}` }));
const noteReceipts = new Map(); let loseNoteResponse = false;
const replyPreview = { version: 1, canReply: true, loseResponse: false, receipts: new Map(), entries: Array.from({ length: 27 }, (_, i) => ({
  id: (27 - i).toString(16).padStart(32, '0'), authorId: fixture.state.userId, createdAt: 1700000000000 - i * 1000,
  text: i === 0 ? 'Synthetic reply <img src=x onerror=alert(1)>\n@everyone' : `Synthetic reply ${27 - i}`,
  state: 'confirmed', delivery: 'confirmed', messageId: String(1000 + i) })) };
const labelHistory = Array.from({ length: 27 }, (_, index) => ({ version: index + 1, priority: 'normal', tags: [`Synthetic-${index + 1}`], authorId: '123', createdAt: 0 }));
const labelReceipts = new Map(); let loseLabelResponse = false;
const managedCase = { state: 'ready', id: 'synthetic-managed-case', type: 'admin-help', caseState: 'open', version: 1,
  userId: '124', channelId, actorId: fixture.state.userId, assigneeId: null, assignmentStatus: null, participantIds: [], action: null, actionStatus: null };
const managementReceipts = new Map(); let loseManagementResponse = false;
const contactPreview = { audience: null, confirmed: false, request: null, ready: false, loseResponse: false };
const recipientPreview = { preparing: false, items: Array.from({ length: 6 }, (_, index) => ({ token: String(index + 1).padStart(48, '0'),
  openerId: '124', createdAt: 1700000000000 - index * 1000, access: index === 0 ? 'closed' : 'open' })) };
const contactForm = { caseType: 'staff-contact', title: 'Synthetic contact form', fields: [
  { id: 'details', kind: 'paragraph', label: 'Synthetic details', description: 'Synthetic test input only.', required: true, maxLength: 2000 },
  { id: 'choice', kind: 'select', label: 'Synthetic choice', description: '', required: false, options: [{ value: 'first', label: 'First synthetic option' }] }] };
const methods = {
  '/api/permissions/deployment-review':['GET','permissionDeploymentReview'],
  '/api/automation': ['GET','automation'], '/api/automation/history': ['GET','automationHistory'],
  '/api/automation/review': ['POST','reviewAutomation'], '/api/automation/change': ['POST','changeAutomation'],
  '/api/automation/preview': ['POST','previewAutomation'], '/api/automation/issues': ['GET','automationIssues'],
  '/api/automation/issue': ['GET','automationIssue'], '/api/automation/repair': ['POST','repairAutomation'],
  ...Object.fromEntries([['draft','GET'],['review','GET'],['publication','GET'],['history','GET'],['save','POST'],['publish','POST'],['withdraw','POST'],['application','GET'],['apply','POST'],['retryApplication','POST']]
    .map(([name,verb])=>['/api/permissions/'+name,[verb,'permission'+name[0].toUpperCase()+name.slice(1)]])), '/auth/session': ['GET', 'session'], '/auth/logout': ['POST', 'logout'],
  '/api/answers': ['GET','answers'], '/api/answers/lookup': ['GET','answer'], '/api/answers/history': ['GET','answerHistory'],
  '/api/answers/review': ['POST','reviewAnswer'], '/api/answers/change': ['POST','changeAnswer'],
  '/api/contacts/received': ['GET', 'receivedContacts'], '/api/contacts/received/destination': ['GET', 'receivedContactDestination'],
  ...Object.fromEntries(['access', 'review', 'select', 'confirm', 'cancel', 'submit', 'destination'].map(action =>
    [`/api/contacts/${action}`, [['access', 'review', 'destination'].includes(action) ? 'GET' : 'POST', `contact-${action}`]])),
  '/api/shuttle/draft': ['GET', 'draft'], '/api/shuttle/history': ['GET', 'history'], '/api/shuttle/review': ['GET', 'review'],
  '/api/shuttle/publication': ['GET', 'publication'], '/api/shuttle/save': ['POST', 'save'],
  '/api/shuttle/publish': ['POST', 'publish'], '/api/shuttle/withdraw': ['POST', 'withdraw'],
  ...Object.fromEntries([['draft', 'GET'], ['history', 'GET'], ['review', 'GET'], ['publication', 'GET'], ['save', 'POST'], ['publish', 'POST'], ['withdraw', 'POST']]
    .map(([name, verb]) => [`/api/ticket-forms/${name}`, [verb, `form${name[0].toUpperCase()}${name.slice(1)}`]])),
  '/api/cases/transcript/channel': ['GET', 'caseChannel'], '/api/cases/transcript': ['GET', 'caseRead'],
  '/api/cases/export/review': ['POST', 'caseReview'], '/api/cases/export/download': ['POST', 'caseDownload'],
  '/api/cases/notes': ['GET', 'notesRead'], '/api/cases/notes/append': ['POST', 'notesAppend'],
  '/api/cases/replies': ['GET', 'repliesRead'], '/api/cases/replies/request': ['POST', 'repliesRequest'],
  '/api/cases/labels': ['GET', 'labelsRead'], '/api/cases/labels/save': ['POST', 'labelsSave'],
  '/api/cases/manage': ['GET', 'manageRead'], '/api/cases/queue': ['GET', 'manageQueue'], '/api/cases/manage/change': ['POST', 'manageChange'] };
for (const [path, route] of Object.entries(methods)) if (path.startsWith('/api/shuttle/')) methods[path.replace('/shuttle/', '/onboarding/')] = route;
let origin, timer;
const send = (response, status, body) => { response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }); response.end(JSON.stringify(body)); };
const server = createServer({ maxHeaderSize: 16_384 }, async (request, response) => {
  try {
    if (request.headers.host !== new URL(origin).host) { send(response, 403, { error: 'Preview host only.' }); return; }
    const previewSession = presentation.get(request.url)?.contentType.startsWith('text/html') && fixture.state.signedIn ? { ...await fixture.api.session(), csrfToken: fixture.state.csrf,
      canEditForms: forms.state.canEditForms, canEditAutomation: automationPreview.state.allowed,
      canEditPermissions: permissionPreview.state.allowed, canEditAnswers: answerPreview.state.canEditAnswers,
      canManageCases: true, canCreateContacts: true } : null;
    const asset = presentation.get(request.url, previewSession);
    if (asset && request.method === 'GET') {
      const output = ['/', '/ticket-forms', '/cases'].includes(request.url) ? { ...asset, bytes: Buffer.from(asset.bytes.toString('utf8').replace('FIVE-PAGE JOURNEY', 'SYNTHETIC PREVIEW')
        .replace('AUTHORED CONFIGURATION', 'SYNTHETIC PREVIEW').replace('A considered welcome, one page at a time.', 'Synthetic preview · No Discord connection.')
        .replace('Clear questions, considered support.', 'Synthetic preview · No Discord connection.')
        .replace('Read retained observations and review a transcript export.', 'Synthetic preview · Channel ID 123 · No Discord connection.')) } : asset;
      sendDashboardAsset(response, output); return;
    }
    if (new URL(request.url, origin).pathname === '/auth/start') { const target = dashboardReturnPath(new URL(request.url, origin).searchParams.get('returnTo') ?? '/'); fixture.state.signedIn = true; forms.state.signedIn = true; response.writeHead(303, { Location: target }); response.end(); return; }
    const url = new URL(request.url, origin), route = methods[url.pathname];
    if (!route && url.pathname !== '/__preview/control') { send(response, 404, { error: 'Preview route not found.' }); return; }
    if (request.method !== (route?.[0] ?? 'POST') || request.method === 'POST' && request.headers.origin !== origin) { send(response, 403, {}); return; }
    let bytes = 0; const chunks = [];
    for await (const chunk of request) { bytes += chunk.length; if (bytes > 131_072) { request.destroy(); return; } chunks.push(chunk); }
    const raw = Buffer.concat(chunks).toString('utf8'), body = raw ? JSON.parse(raw) : undefined;
    if (url.pathname === '/__preview/control') {
      if (body?.target === 'automation') {
        if (body.action === 'deny') automationPreview.state.allowed = false;
        else if (body.action === 'allow') automationPreview.state.allowed = true;
        else if (body.action === 'lose-save-response') automationPreview.state.loseResponse = true;
        else if (body.action === 'competing-edit') automationPreview.append();
        else { send(response,400,{}); return; }
        send(response,200,{});return;
      }
      if (body?.target === 'permissions') {
        if (body.action === 'deny') permissionPreview.state.allowed = false;
        else if (body.action === 'allow') permissionPreview.state.allowed = true;
        else if (body.action === 'lose-save-response') permissionPreview.state.loseResponse = true;
        else if (body.action === 'complete-apply' && permissionPreview.state.application) permissionPreview.state.application.state='applied';
        else if (body.action === 'block-apply' && permissionPreview.state.application){permissionPreview.state.application.state='blocked';permissionPreview.state.application.summary={code:'ROLE_HIERARCHY_BLOCKED'};}
        else { send(response,400,{}); return; }
        send(response,200,{});return;
      }
      if (body?.target === 'answers') {
        if (body.action === 'deny') answerPreview.state.canEditAnswers = false;
        else if (body.action === 'allow') answerPreview.state.canEditAnswers = true;
        else if (body.action === 'lose-save-response') answerPreview.state.loseResponse = true;
        else if (body.action === 'competing-edit') answerPreview.append(body.name ?? 'sample-00', { ...answerPreview.publicDocument, text: 'Synthetic competing public text' });
        else if (body.action === 'withdraw') answerPreview.append(body.name ?? 'sample-00',null,'withdraw');
        else { send(response,400,{}); return; }
        send(response,200,{}); return;
      }
      if (body?.target === 'replies') {
        if (body.action === 'lose-submit-response') replyPreview.loseResponse = true;
        else if (body.action === 'competing-edit') replyPreview.version++;
        else if (body.action === 'close') { replyPreview.canReply = false; replyPreview.version++; }
        else if (body.action === 'settle') {
          for (const entry of replyPreview.entries) if (entry.state === 'pending') Object.assign(entry, { state: 'confirmed', delivery: 'confirmed', messageId: '2000' });
        } else { send(response, 400, {}); return; }
        send(response, 200, {}); return;
      }
      if (body?.target === 'contacts') {
        if (body.action === 'preparing') recipientPreview.preparing = true;
        else if (body.action === 'settle') recipientPreview.preparing = false;
        else if (body.action === 'remove-first') recipientPreview.items.shift();
        else { send(response, 400, {}); return; }
        send(response, 200, {}); return;
      }
      if (body?.target === 'contact') {
        if (body.action === 'lose-submit-response') contactPreview.loseResponse = true;
        else if (body.action === 'settle') contactPreview.ready = true;
        else { send(response, 400, {}); return; }
        send(response, 200, {}); return;
      }
      if (body?.target === 'management') {
        if (body.action === 'lose-save-response') loseManagementResponse = true;
        else if (body.action === 'competing-edit') managedCase.version++;
        else if (body.action === 'settle') { managedCase.caseState = managedCase.action === 'close' ? 'closed' : 'open'; managedCase.actionStatus = managedCase.action ? 'confirmed' : null; }
        else { send(response, 400, {}); return; }
        send(response, 200, {}); return;
      }
      if (body?.target === 'labels') {
        if (body.action === 'lose-save-response') loseLabelResponse = true;
        else if (body.action === 'competing-edit') labelHistory.push({ version: labelHistory.at(-1).version + 1, priority: 'low', tags: ['Other-Staff'], authorId: '124', createdAt: Date.now() });
        else { send(response, 400, {}); return; }
        send(response, 200, {}); return;
      }
      if (body?.target === 'notes' && body?.action === 'lose-save-response') { loseNoteResponse = true; send(response, 200, {}); return; }
      if (body?.target === 'cases' && ['deny', 'allow'].includes(body?.action)) { caseAllowed = body.action === 'allow'; send(response, 200, {}); return; }
      const target = body?.target === 'forms' ? forms : fixture, capability = target === forms ? 'canEditForms' : 'canEditOnboarding';
      if (body?.action === 'deny') target.state[capability] = false;
      else if (body?.action === 'allow') target.state[capability] = true;
      else if (body?.action === 'lose-save-response') target.state.faults.push({ method: target === forms ? 'formSave' : 'save', after: true, kind: 'connection', status: 503 });
      else if (body?.action === 'competing-edit' && target === forms) {
        const caseType = body.caseType ?? 'admin-help', current = forms.state.records.get(caseType)?.drafts.at(-1);
        if (!current) { send(response, 400, {}); return; }
        const document = structuredClone(current.document); document.title = 'Synthetic competing form';
        await forms.api.formSave({ caseType, requestId: 'ee'.repeat(32), expectedRevision: current.revision, document });
      }
      else if (body?.action === 'competing-edit') {
        const current = fixture.state.drafts.at(-1), document = structuredClone(current.document);
        document.stages[0].body = 'SYNTHETIC COMPETING EDIT\nAnother editor saved this example while this tab was open.';
        await fixture.api.save({ requestId: 'ee'.repeat(32), expectedRevision: current.revision, document });
      } else if (body?.action === 'stop') { send(response, 200, { status: 'stopping' }); stop(); return; }
      else { send(response, 400, {}); return; }
      send(response, 200, { status: 'synthetic_control_applied' }); return;
    }
    if (request.method === 'POST' && request.headers['x-csrf-token'] !== fixture.state.csrf) { send(response, 403, {}); return; }
    if (url.pathname === '/api/automation' || url.pathname.startsWith('/api/automation/')) {
      await fixture.api.session();
      const before = url.searchParams.has('before') ? Number(url.searchParams.get('before')) : null;
      const args = route[1] === 'automation' ? [] : route[1] === 'automationHistory' ? [before] :
        route[1] === 'automationIssues' ? [url.searchParams.get('before')] : route[1] === 'automationIssue' ? [url.searchParams.get('deliveryId'),before] : [body];
      send(response,200,await automationPreview.api[route[1]](...args)); return;
    }
    if (url.pathname === '/api/answers' || url.pathname.startsWith('/api/answers/')) {
      await fixture.api.session();
      const args = route[1] === 'answers' ? [url.searchParams.get('after')] : route[1] === 'answer' ? [url.searchParams.get('name')] :
        route[1] === 'answerHistory' ? [url.searchParams.get('name'), url.searchParams.has('before') ? Number(url.searchParams.get('before')) : null] : [body];
      send(response,200,await answerPreview.api[route[1]](...args)); return;
    }
    if (url.pathname.startsWith('/api/contacts/received')) {
      await fixture.api.session(); if (!caseAllowed) { send(response, 403, {}); return; }
      const identity = { guildId: fixture.state.guildId, actorId: fixture.state.userId };
      if (route[1] === 'receivedContacts') {
        const after = url.searchParams.get('after'), boundary = after === null ? -1 : recipientPreview.items.findIndex(item => item.token === after);
        if (after !== null && boundary < 0) { send(response, 403, {}); return; }
        const items = recipientPreview.items.slice(boundary + 1, boundary + 6);
        send(response, 200, { ...identity, state: 'queue', items, next: recipientPreview.items.length > boundary + 6 ? items.at(-1).token : null }); return;
      }
      const caseToken = url.searchParams.get('caseToken'), item = recipientPreview.items.find(value => value.token === caseToken);
      if (!item) { send(response, 403, {}); return; }
      send(response, 200, recipientPreview.preparing ? { ...identity, state: 'preparing', caseToken } : { ...identity, state: 'ready', channelId, access: item.access }); return;
    }
    if (url.pathname.startsWith('/api/contacts/')) {
      await fixture.api.session(); if (!caseAllowed) { send(response, 403, {}); return; }
      const action = url.pathname.split('/').at(-1);
      if (action === 'access') { send(response, 200, { canCreate: true }); return; }
      if (action === 'select') {
        contactPreview.audience = { state: 'review', token: 'd'.repeat(48), openerId: fixture.state.userId, recipientIds: body.recipientIds };
        contactPreview.confirmed = false; contactPreview.request = null; contactPreview.ready = false;
        send(response, 200, contactPreview.audience); return;
      }
      if (!contactPreview.audience) { send(response, 409, {}); return; }
      if (action === 'review') { send(response, 200, contactPreview.audience); return; }
      if (action === 'confirm') { contactPreview.confirmed = true; send(response, 200, { token: contactPreview.audience.token, version: 1, form: contactForm }); return; }
      if (action === 'cancel') { contactPreview.audience = null; send(response, 200, { cancelled: true }); return; }
      if (action === 'submit') {
        if (!contactPreview.confirmed || body.confirmed !== true) { send(response, 409, {}); return; }
        const key = JSON.stringify(body), duplicate = contactPreview.request !== null;
        if (duplicate && contactPreview.request !== key) { send(response, 409, {}); return; }
        contactPreview.request = key;
        if (contactPreview.loseResponse) { contactPreview.loseResponse = false; send(response, 503, {}); return; }
        send(response, 200, { recorded: true, duplicate }); return;
      }
      if (!contactPreview.request) { send(response, 403, {}); return; }
      send(response, 200, contactPreview.ready ? { state: 'ready', guildId: fixture.state.guildId, channelId } : { state: 'preparing', caseToken }); return;
    }
    if (url.pathname.startsWith('/api/cases/')) {
      await fixture.api.session();
      if (!caseAllowed) { send(response, 403, {}); return; }
      if (route[1] === 'repliesRead') {
        if (url.searchParams.get('channelId') !== channelId) { send(response, 403, {}); return; }
        const beforeId = url.searchParams.get('beforeId'), beforeAt = Number(url.searchParams.get('beforeAt'));
        const rows = replyPreview.entries.filter(row => beforeId === null || row.createdAt < beforeAt || row.createdAt === beforeAt && row.id < beforeId);
        const entries = rows.slice(0, 25), last = entries.at(-1);
        send(response, 200, { actorId: fixture.state.userId, guildId: fixture.state.guildId, channelId, version: replyPreview.version,
          canReply: replyPreview.canReply, entries, next: rows.length > 25 ? { id: last.id, createdAt: last.createdAt } : null }); return;
      }
      if (route[1] === 'repliesRequest') {
        const previous = replyPreview.receipts.get(body?.requestId), identity = { actorId: fixture.state.userId, guildId: fixture.state.guildId };
        if (previous) { send(response, previous.body === JSON.stringify(body) ? 200 : 409, { ...identity, id: previous.entry.id, state: previous.entry.state, duplicate: true }); return; }
        if (body?.confirmed !== true || body.channelId !== channelId || !/^[a-f0-9]{64}$/.test(body.requestId) || typeof body.text !== 'string' || !body.text.trim() || body.text.length > 4000) { send(response, 400, {}); return; }
        if (!replyPreview.canReply || body.expectedVersion !== replyPreview.version) { send(response, 409, {}); return; }
        if (body.answer) {
          let selected; try { selected = await answerPreview.api.answer(body.answer.name); } catch { send(response,409,{}); return; }
          if (selected.revision !== body.answer.revision || selected.sha256 !== body.answer.sha256 || selected.document.text !== body.text) { send(response,409,{}); return; }
        }
        const entry = { id: (replyPreview.entries.length + 1).toString(16).padStart(32, '0'), authorId: fixture.state.userId,
          createdAt: Date.now(), text: body.text, state: 'pending', delivery: 'pending', messageId: null, answer: body.answer ?? null };
        replyPreview.entries.unshift(entry); replyPreview.receipts.set(body.requestId, { body: JSON.stringify(body), entry });
        if (replyPreview.loseResponse) { replyPreview.loseResponse = false; send(response, 503, {}); return; }
        send(response, 200, { ...identity, id: entry.id, state: entry.state, duplicate: false }); return;
      }
      if (route[1] === 'manageQueue') {
        const filter = url.searchParams.get('filter') ?? 'active', states = { active: ['open', 'pending', 'closing'], closed: ['closed'], failed: ['failed'] };
        send(response, 200, { guildId: fixture.state.guildId, actorId: fixture.state.userId, filter, next: null,
          entries: states[filter]?.includes(managedCase.caseState) ? [{ ...managedCase, token: caseToken }] : [] }); return;
      }
      if (route[1] === 'manageRead') {
        if (url.searchParams.get('channelId') !== channelId) { send(response, 403, {}); return; }
        send(response, 200, managedCase); return;
      }
      if (route[1] === 'manageChange') {
        const previous = managementReceipts.get(body?.requestId);
        if (previous) { send(response, previous === JSON.stringify(body) ? 200 : 409, { recorded: true, duplicate: true }); return; }
        if (body?.confirmed !== true || body.channelId !== channelId) { send(response, 400, {}); return; }
        if (body.expectedVersion !== managedCase.version) { send(response, 409, {}); return; }
        if (['close', 'reopen'].includes(body.action)) { managedCase.caseState = body.action === 'close' ? 'closing' : 'pending'; managedCase.action = body.action; managedCase.actionStatus = 'pending'; }
        else if (['claim', 'unclaim', 'assign'].includes(body.action)) { managedCase.assigneeId = body.action === 'claim' ? managedCase.actorId : body.action === 'assign' ? body.targetId : null; managedCase.assignmentStatus = managedCase.assigneeId ? 'current' : null; }
        else if (['add-participant', 'remove-participant'].includes(body.action)) {
          managedCase.participantIds = body.action === 'add-participant' ? [...managedCase.participantIds, body.targetId] : managedCase.participantIds.filter(id => id !== body.targetId); managedCase.caseState = 'pending';
        } else { send(response, 400, {}); return; }
        managedCase.version++; managementReceipts.set(body.requestId, JSON.stringify(body));
        if (loseManagementResponse) { loseManagementResponse = false; send(response, 503, {}); return; }
        send(response, 200, { recorded: true, duplicate: false }); return;
      }
      if (route[1] === 'labelsSave') {
        const previous = labelReceipts.get(body?.requestId), current = labelHistory.at(-1);
        if (previous) { send(response, previous.body === JSON.stringify(body) ? 200 : 409, { version: previous.version, duplicate: true }); return; }
        if (body?.expectedVersion !== current.version) { send(response, 409, {}); return; }
        if (body.channelId !== channelId || !Array.isArray(body.tags) || body.tags.length > 8 ||
          !body.tags.every(tag => typeof tag === 'string' && /^[\p{L}\p{N}][\p{L}\p{N} ._-]{0,31}$/u.test(tag)) ||
          !['low', 'normal', 'high', 'urgent'].includes(body.priority)) { send(response, 400, {}); return; }
        const change = { version: current.version + 1, priority: body.priority, tags: body.tags, authorId: '123', createdAt: Date.now() };
        labelHistory.push(change); labelReceipts.set(body.requestId, { body: JSON.stringify(body), version: change.version });
        if (loseLabelResponse) { loseLabelResponse = false; send(response, 503, {}); return; }
        send(response, 200, { version: change.version, duplicate: false }); return;
      }
      if (route[1] === 'labelsRead') {
        if (url.searchParams.get('channelId') !== channelId) { send(response, 403, {}); return; }
        const history = labelHistory.filter(change => !url.searchParams.has('before') || change.version < Number(url.searchParams.get('before'))).toReversed();
        const current = labelHistory.at(-1);
        send(response, 200, { channelId, caseId: 'synthetic-case', version: current.version, priority: current.priority, tags: current.tags,
          history: history.slice(0, 25), next: history.length > 25 ? history[24].version : null }); return;
      }
      if (route[1] === 'notesAppend') {
        if (body?.channelId !== channelId || typeof body.text !== 'string' || !/^[a-f0-9]{64}$/.test(body.requestId)) { send(response, 400, {}); return; }
        const previous = noteReceipts.get(body.requestId);
        if (previous && previous.text !== body.text) { send(response, 409, {}); return; }
        const note = previous ?? { number: notes.length + 1, authorId: '123', createdAt: Date.now(), text: body.text };
        if (!previous) { notes.push(note); noteReceipts.set(body.requestId, note); }
        if (loseNoteResponse) { loseNoteResponse = false; send(response, 503, {}); return; }
        send(response, 200, { number: note.number, duplicate: Boolean(previous) }); return;
      }
      if (route[1] === 'notesRead') {
        if (url.searchParams.get('channelId') !== channelId) { send(response, 403, {}); return; }
        const entries = notes.filter(note => !url.searchParams.has('before') || note.number < Number(url.searchParams.get('before'))).toReversed();
        send(response, 200, { channelId, entries: entries.slice(0, 25), next: entries.length > 25 ? entries[24].number : null }); return;
      }
      if (route[1] === 'caseReview') { send(response, 200, exportReview); return; }
      if (route[1] === 'caseDownload') {
        if (body?.confirmed !== true || body?.reviewHash !== exportReview.reviewHash) { send(response, 409, {}); return; }
        sendCaseExport(response, { body: exportBody, bytes: exportReview.bytes, filename: `sophie-transcript-${caseToken}-${channelId}.html` }); return;
      }
      if (url.searchParams.get('channelId') !== channelId) { send(response, 403, {}); return; }
      send(response, 200, { caseToken, channelId, completeHistory: false, captureAvailable: true,
        next: url.searchParams.has('after') ? null : 'synthetic_next', gapsNext: url.searchParams.has('gapsAfter') ? null : 'synthetic_gaps',
        page: { observations: [{ messageId: '456', kind: 'create', patch: { content: url.searchParams.has('after') ? 'Synthetic second page.' : 'Synthetic case message </pre><img src=x onerror=alert(1)>' } }],
          gaps: [{ reasons: ['before-capture'], page: url.searchParams.has('gapsAfter') ? 2 : 1 }] } }); return;
    }
    const parameter = key => url.searchParams.has(key) ? Number(url.searchParams.get(key)) : null;
    if (route[1].startsWith('permission')) {
      const action = route[1].slice('permission'.length).toLowerCase();
      const args = request.method === 'POST' ? [body] : action === 'history' ? [url.searchParams.get('kind'), parameter('before')] :
        [parameter(['publication','deploymentreview'].includes(action) ? 'version' : 'revision')];
      send(response, 200, await permissionPreview.api[route[1]](...args)); return;
    }
    const args = route[1] === 'history' ? [url.searchParams.get('kind'), parameter('before')] :
      ['draft', 'review'].includes(route[1]) ? [parameter('revision')] : route[1] === 'publication' ? [parameter('version')] : request.method === 'POST' ? [body] : [];
    const formRoute = url.pathname.startsWith('/api/ticket-forms/'), method = url.pathname.split('/').at(-1);
    const formArgs = request.method === 'POST' ? [body] : [url.searchParams.get('caseType'), ...(method === 'history' ? [url.searchParams.get('kind'), parameter('before')] :
      [parameter(method === 'publication' ? 'version' : 'revision')])];
    const result = await (formRoute ? forms : fixture).api[route[1]](...(formRoute ? formArgs : args));
    if (route[1] === 'logout') { await forms.api.logout(); await permissionPreview.api.logout(); }
    send(response, 200, route[1] === 'session' ? { ...result, canManageCases: true, canCreateContacts: true, canEditAutomation: automationPreview.state.allowed, canEditPermissions: permissionPreview.state.allowed, canEditForms: forms.state.canEditForms, canEditAnswers: answerPreview.state.canEditAnswers, csrfToken: fixture.state.csrf } : result);
  } catch (error) { if (!response.headersSent && !response.destroyed) send(response, error.status || 503, { error: 'Synthetic preview operation failed.' }); }
});
server.maxConnections = 16; server.requestTimeout = 5_000; server.headersTimeout = 5_000; server.keepAliveTimeout = 1_000;
function stop() { clearTimeout(timer); server.close(); server.closeAllConnections(); }
process.on('SIGINT', stop); process.on('SIGTERM', stop);
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); origin = `http://127.0.0.1:${server.address().port}`;
timer = setTimeout(stop, 20 * 60_000); timer.unref();
console.log(JSON.stringify({ origin, syntheticOnly: true, expiresAfterMinutes: 20 }));
