import { SYSTEM_WORDING_ROUTES } from './system-wording.js';
import { createServer } from 'node:http';
import { ContractError, requireCondition, requireInteger } from '../../../contracts/validation.js';
import { validateDashboardAuth, dashboardCookies, dashboardCookie } from '../../../contracts/dashboard-auth.js';
import { ONBOARDING_AUTHORING_ROUTES } from './onboarding-authoring.js';
import { CASE_FORM_AUTHORING_ROUTES } from './case-form-authoring.js';
import { CASE_TRANSCRIPT_ROUTES } from './case-transcripts.js';
import { CASE_NOTE_ROUTES } from './case-notes.js';
import { CASE_REPLY_ROUTES } from './case-replies.js';
import { CURATED_ANSWER_ROUTES } from './curated-answers.js';
import { PERMISSION_EDITOR_ROUTES } from './permission-editor.js';
import { AUTOMATION_ROUTES } from './automation-policies.js';
import { CASE_LABEL_ROUTES } from './case-labels.js';
import { CASE_MANAGEMENT_ROUTES } from './case-management.js';
import { CONTACT_NAVIGATION_ROUTES } from './contact-navigation.js';
import { CONTACT_ENTRY_ROUTES } from './contact-entry.js';
import { CASE_EXPORT_ROUTES, sendCaseExport } from './case-exports.js';
import { sendDashboardAsset } from './dashboard-assets.js';
import { dashboardReturnPath, dashboardPageAllowed, dashboardSessionView } from '../../../contracts/dashboard-navigation.js';

/** Fixed authenticated routes and presentation. Case reads stay inside core; TLS remains separate. */
export function createDashboardAuthHttpServer({ configuration, auth, authorization, wording = null, authoring = null, formAuthoring = null, transcripts = null, caseExports = null, notes = null, replies = null, answers = null, automation = null, permissions = null, labels = null, management = null, contactEntry = null, contactNavigation = null, presentation = null, enabled, onFault }) {
  validateDashboardAuth(configuration);
  requireCondition(typeof enabled === 'function' && typeof onFault === 'function', 'TRUSTED_ADAPTERS_REQUIRED');
  const fixed = structuredClone(configuration), host = new URL(fixed.origin).host, running = new Set();
  const available = { 'shuttle.publish': authoring !== null, 'case.forms.publish': formAuthoring !== null,
    'answers.publish': answers !== null, 'automation.publish': automation !== null, 'permissions.publish': permissions !== null };
  let reserved = false, stopping = false;
  const fault = () => { try { onFault('DASHBOARD_AUTH_UNAVAILABLE'); } catch { /* Never expose request material through logging. */ } };
  function send(response, status, data, extra = {}) {
    response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
      'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'; base-uri 'none'", ...extra });
    response.end(JSON.stringify(data));
  }
  async function handle(request, response) {
    requireCondition(request.headers.host === host && request.url?.startsWith('/') && !request.url.startsWith('//') && request.url.length <= 4_096, 'DASHBOARD_REQUEST_INVALID');
    for (const name of ['host', 'cookie', 'origin', 'x-csrf-token', 'content-type']) requireCondition(
      request.rawHeaders.filter((value, index) => index % 2 === 0 && value.toLowerCase() === name).length <= 1, 'DASHBOARD_REQUEST_INVALID');
    const url = new URL(request.url, fixed.origin), path = url.pathname;
    const login = path === '/login' && presentation !== null;
    let asset = presentation?.get(login ? '/login' : request.url);
    if (asset) {
      requireCondition(!stopping && request.method === 'GET' && request.headers['content-encoding'] === undefined &&
        request.headers['transfer-encoding'] === undefined && [undefined, '0'].includes(request.headers['content-length']), 'DASHBOARD_REQUEST_INVALID');
      if (login) {
        requireCondition([...url.searchParams.keys()].every(key => key === 'returnTo') && url.searchParams.getAll('returnTo').length <= 1, 'DASHBOARD_REQUEST_INVALID');
        const returnPath = dashboardReturnPath(url.searchParams.get('returnTo') ?? '/');
        asset = { ...asset, bytes: Buffer.from(asset.bytes.toString('utf8').replace('returnTo=%2F"', `returnTo=${encodeURIComponent(returnPath)}"`)) };
      } else if (asset.contentType.startsWith('text/html')) {
        const redirect = () => send(response, 303, { status: 'sign_in_required' }, { Location: `/login?returnTo=${encodeURIComponent(path)}` });
        const cookies = dashboardCookies(request.headers.cookie);
        if (cookies.session === null) { redirect(); return; }
        if (await enabled() !== true) { send(response, 503, { error: 'Sign-in is currently unavailable.' }); return; }
        try {
          const { proof, csrfToken } = await auth.authenticate({ token: cookies.session });
          const actor = await authorization.dashboardAccess(proof);
          await auth.resolvePrincipal(proof);
          const session = dashboardSessionView(actor, csrfToken, available);
          if (!dashboardPageAllowed(path, session)) {
            send(response, 303, { status: 'page_unavailable' }, { Location: '/cases' }); return;
          }
          asset = presentation.get(path, session);
          const maxAge = await auth.refreshSession(cookies.session);
          response.setHeader('Set-Cookie', dashboardCookie('session', cookies.session, maxAge));
        } catch (error) {
          if (error instanceof ContractError && ['DASHBOARD_SESSION_INVALID', 'DASHBOARD_CREDENTIAL_INVALID', 'DASHBOARD_POLICY_CHANGED',
            'UNTRUSTED_PRINCIPAL', 'OPERATION_DENIED', 'MEMBER_ABSENT', 'CAPABILITY_REVOKED'].includes(error.code)) { redirect(); return; }
          throw error;
        }
      }
      sendDashboardAsset(response, asset); return;
    }
    const methods = { '/auth/start': 'GET', '/auth/callback': 'GET', '/auth/session': 'GET', '/auth/logout': 'POST',
      ...(wording ? SYSTEM_WORDING_ROUTES : {}), ...(authoring ? ONBOARDING_AUTHORING_ROUTES : {}), ...(formAuthoring ? CASE_FORM_AUTHORING_ROUTES : {}), ...(transcripts ? CASE_TRANSCRIPT_ROUTES : {}),
      ...(caseExports ? CASE_EXPORT_ROUTES : {}), ...(notes ? CASE_NOTE_ROUTES : {}), ...(replies ? CASE_REPLY_ROUTES : {}), ...(answers ? CURATED_ANSWER_ROUTES : {}), ...(automation ? AUTOMATION_ROUTES : {}), ...(permissions ? PERMISSION_EDITOR_ROUTES : {}), ...(labels ? CASE_LABEL_ROUTES : {}), ...(management ? CASE_MANAGEMENT_ROUTES : {}), ...(contactEntry ? CONTACT_ENTRY_ROUTES : {}), ...(contactNavigation ? CONTACT_NAVIGATION_ROUTES : {}) };
    if (!Object.hasOwn(methods, path)) { send(response, 404, { error: 'Not found.' }); return; }
    requireCondition(request.method === methods[path] && request.headers['content-encoding'] === undefined, 'DASHBOARD_REQUEST_INVALID');
    const editor = Object.hasOwn(SYSTEM_WORDING_ROUTES, path) ? wording : Object.hasOwn(PERMISSION_EDITOR_ROUTES, path) ? permissions : Object.hasOwn(AUTOMATION_ROUTES, path) ? automation : Object.hasOwn(CURATED_ANSWER_ROUTES, path) ? answers : Object.hasOwn(CASE_REPLY_ROUTES, path) ? replies : Object.hasOwn(CONTACT_NAVIGATION_ROUTES, path) ? contactNavigation : Object.hasOwn(CONTACT_ENTRY_ROUTES, path) ? contactEntry : Object.hasOwn(CASE_MANAGEMENT_ROUTES, path) ? management : Object.hasOwn(CASE_LABEL_ROUTES, path) ? labels : Object.hasOwn(CASE_NOTE_ROUTES, path) ? notes : Object.hasOwn(CASE_EXPORT_ROUTES, path) ? caseExports : Object.hasOwn(CASE_TRANSCRIPT_ROUTES, path) ? transcripts : Object.hasOwn(CASE_FORM_AUTHORING_ROUTES, path) ? formAuthoring : Object.hasOwn(ONBOARDING_AUTHORING_ROUTES, path) ? authoring : null;
    const editing = editor !== null, json = editing && request.method === 'POST';
    if (json) requireCondition(['application/json', 'application/json; charset=utf-8'].includes(request.headers['content-type']), 'AUTHORING_INPUT_INVALID');
    const timeout = setTimeout(() => request.destroy(), 1_500); timeout.unref(); const chunks = []; let bytes = 0;
    try { for await (const chunk of request) { bytes += chunk.length; requireCondition(bytes <= (json ? 131_072 : 0), 'DASHBOARD_REQUEST_INVALID'); chunks.push(chunk); } }
    finally { clearTimeout(timeout); }
    const cookies = dashboardCookies(request.headers.cookie);
    if (stopping || await enabled() !== true) { send(response, 503, { error: 'Sign-in is currently unavailable.' }); return; }
    if (reserved) { send(response, 503, { error: 'Sign-in is busy. Please try again shortly.' }); return; }
    reserved = true;
    try {
      if (!editing && !['/auth/callback','/auth/start'].includes(path)) requireCondition(url.search === '', 'DASHBOARD_REQUEST_INVALID');
      if (editing) {
        let body = null;
        if (json) { try { body = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))); }
          catch { requireCondition(false, 'AUTHORING_INPUT_INVALID'); } }
        const result = await editor.execute({ path, method: request.method, query: url.searchParams, body,
          credentials: { token: cookies.session, origin: request.headers.origin, csrfToken: request.headers['x-csrf-token'] } });
        if (path === '/api/cases/export/download') sendCaseExport(response, result);
        else send(response, 200, result);
      } else if (path === '/auth/start') {
        requireCondition([...url.searchParams.keys()].every(key => key === 'returnTo') && url.searchParams.getAll('returnTo').length <= 1, 'DASHBOARD_REQUEST_INVALID');
        const result = await auth.begin(cookies.login, dashboardReturnPath(url.searchParams.get('returnTo') ?? '/'));
        send(response, 303, { status: 'redirect' }, { Location: result.location, 'Set-Cookie': dashboardCookie('login', result.binding, 300) });
      } else if (path === '/auth/callback') {
        const names = [...url.searchParams.keys()], cancelled = url.searchParams.has('error');
        requireCondition(new Set(names).size === names.length && names.includes('state') &&
          (cancelled ? names.includes('error') && names.every(name => ['state', 'error', 'error_description'].includes(name)) :
            names.length === 2 && names.includes('code')), 'DASHBOARD_LOGIN_INVALID');
        const result = await auth.complete({ state: url.searchParams.get('state'), binding: cookies.login,
          code: url.searchParams.get('code'), previousToken: cookies.session, cancelled });
        const cleared = dashboardCookie('login', null, 0);
        if (result === null) send(response, 403, { error: 'Sign-in was not completed.' }, { 'Set-Cookie': cleared });
        else send(response, 303, { status: 'signed_in' }, { Location: dashboardReturnPath(result.returnPath), 'Set-Cookie': [cleared, dashboardCookie('session', result.token, 3_600)] });
      } else if (path === '/auth/session') {
        const { proof, csrfToken } = await auth.authenticate({ token: cookies.session });
        const actor = await authorization.dashboardAccess(proof);
        await auth.resolvePrincipal(proof);
        const maxAge = await auth.refreshSession(cookies.session);
        const session = dashboardSessionView(actor, csrfToken, available);
        send(response, 200, { ...session, canEditShuttle: session.canEditOnboarding },
          { 'Set-Cookie': dashboardCookie('session', cookies.session, maxAge) });
      } else {
        await auth.logout({ token: cookies.session, method: 'POST', origin: request.headers.origin, csrfToken: request.headers['x-csrf-token'] });
        send(response, 200, { status: 'signed_out' }, { 'Set-Cookie': dashboardCookie('session', null, 0) });
      }
    } finally { reserved = false; }
  }
  const server = createServer({ maxHeaderSize: 16_384 }, (request, response) => {
    let task;
    task = handle(request, response).catch(error => {
      const denied = error instanceof ContractError && ['DASHBOARD_REQUEST_INVALID', 'DASHBOARD_LOGIN_INVALID', 'DASHBOARD_SESSION_INVALID',
        'DASHBOARD_CREDENTIAL_INVALID', 'DASHBOARD_ORIGIN_INVALID', 'DASHBOARD_CSRF_INVALID', 'DASHBOARD_POLICY_CHANGED', 'DASHBOARD_RETURN_PATH_INVALID',
        'UNTRUSTED_PRINCIPAL', 'OPERATION_DENIED', 'FOREIGN_GUILD', 'OAUTH_CODE_INVALID', 'CASE_ACCESS_DENIED', 'CASE_CHILD_ACCESS_DENIED', 'CAPABILITY_REVOKED',
        'CASE_EXPORT_DISABLED', 'CASE_EXPORT_POLICY_CHANGED', 'CASE_ASSIGNEE_DENIED', 'CASE_PARTICIPANT_DENIED', 'MEMBER_ABSENT', 'CASE_FORM_OWNER_MISMATCH', 'CASE_DESTINATION_DENIED'].includes(error.code);
      const conflict = error instanceof ContractError && ['PERMISSION_APPLICATION_BUSY', 'PERMISSION_APPLICATION_UNAVAILABLE', 'PERMISSION_DEPLOYMENT_BLOCKED', 'SYSTEM_WORDING_CONFLICT', 'PERMISSION_STALE', 'PERMISSION_BASE_STALE', 'PERMISSION_REQUEST_COLLISION', 'PERMISSION_SELECTION_UNAVAILABLE', 'AUTOMATION_RECOVERY_STALE', 'AUTOMATION_RECOVERY_UNAVAILABLE', 'AUTOMATION_STALE', 'AUTOMATION_REVIEW_STALE', 'AUTOMATION_REQUEST_COLLISION', 'AUTOMATION_CHANNEL_UNAVAILABLE', 'ANSWER_STALE', 'ANSWER_REVIEW_STALE', 'ANSWER_REQUEST_COLLISION', 'ANSWER_LIMIT', 'SHUTTLE_DRAFT_STALE', 'SHUTTLE_PUBLICATION_STALE', 'SHUTTLE_EDITOR_REQUEST_COLLISION',
        'PERMISSION_DEPLOYMENT_REVIEW_STALE', 'CASE_FORM_DRAFT_STALE', 'CASE_FORM_PUBLICATION_STALE', 'CASE_FORM_VERSION_STALE', 'CASE_FORM_EDITOR_REQUEST_COLLISION',
        'CASE_EXPORT_REVIEW_STALE', 'CASE_EXPORT_REQUEST_COLLISION', 'CASE_NOTE_REQUEST_COLLISION', 'CASE_LABEL_REQUEST_COLLISION', 'STALE_CASE_VERSION', 'CASE_REPLY_REQUEST_COLLISION',
        'CASE_STATE_CONFLICT', 'CASE_ASSIGNMENT_CONFLICT', 'CASE_PARTICIPANT_CONFLICT', 'STALE_CASE_QUEUE', 'INTERACTION_ID_COLLISION',
        'MEMBER_CASE_LIMIT', 'GUILD_PROVISIONING_LIMIT', 'CASE_COOLDOWN', 'CASE_FORM_BUSY', 'CASE_FORM_EXPIRED', 'CASE_FORM_ALREADY_SUBMITTED', 'CASE_CONTACT_CONFIRMATION_REQUIRED'].includes(error.code);
      const missing = error instanceof ContractError && ['PERMISSION_NOT_FOUND', 'AUTOMATION_RECOVERY_NOT_FOUND', 'AUTOMATION_UNAVAILABLE', 'ANSWER_UNAVAILABLE', 'SHUTTLE_DRAFT_NOT_FOUND', 'SHUTTLE_PUBLICATION_NOT_FOUND', 'CASE_FORM_DRAFT_NOT_FOUND', 'CASE_FORM_UNAVAILABLE'].includes(error.code);
      const invalid = error instanceof ContractError && ['SYSTEM_WORDING_INVALID', 'SYSTEM_WORDING_PLACEHOLDERS', 'PERMISSION_INPUT_INVALID', 'PERMISSION_LOCKOUT', 'PERMISSION_CONFIRMATION_REQUIRED', 'INVALID_CAPABILITY_MAP', 'INVALID_RESPONDER_MAP', 'HEAD_ADMIN_AUDIENCE_REQUIRED', 'ROLE_OWNERSHIP_CONFLICT', 'CASE_CONFIGURATION_INVALID', 'AUTOMATION_INPUT_INVALID', 'AUTOMATION_PREVIEW_INVALID', 'AUTOMATION_CONFIRMATION_REQUIRED', 'ANSWER_INPUT_INVALID', 'ANSWER_CONFIRMATION_REQUIRED', 'SHUTTLE_EDITOR_INPUT_INVALID', 'SHUTTLE_EDITOR_REQUEST_INVALID', 'SHUTTLE_DRAFT_INVALID',
        'SHUTTLE_WITHDRAWAL_CONFIRMATION_REQUIRED', 'INVALID_FIELDS', 'INVALID_RECORD', 'INVALID_INTEGER', 'INVALID_IDENTIFIER',
        'SHUTTLE_DOCUMENT_TOO_LARGE', 'INVALID_STATIC_COPY', 'INVALID_STATIC_TITLE', 'INVALID_SHUTTLE_STEPS', 'INVALID_SHUTTLE_SCREENS', 'SHUTTLE_SCREENS_MISMATCH', 'SHUTTLE_HELP_MODE_UNSUPPORTED', 'AUTHORING_INPUT_INVALID',
        'CASE_FORM_EDITOR_INPUT_INVALID', 'CASE_FORM_EDITOR_REQUEST_INVALID', 'CASE_FORM_DRAFT_INVALID', 'CASE_FORM_WITHDRAWAL_INVALID',
        'INVALID_CASE_FORM_TYPE', 'INVALID_CASE_FORM_TEXT', 'INVALID_CASE_FORM_FIELDS', 'INVALID_CASE_FORM_FIELD', 'INVALID_CASE_FORM_OPTIONS',
        'TRANSCRIPT_INPUT_INVALID', 'INVALID_CASE_REFERENCE', 'INVALID_CASE_OPERATION_TOKEN', 'INVALID_DISCORD_ID',
        'CASE_EXPORT_INPUT_INVALID', 'CASE_EXPORT_CONFIRMATION_REQUIRED', 'CASE_EXPORT_TOO_LARGE', 'CASE_NOTE_INPUT_INVALID', 'CASE_NOTE_TEXT_INVALID', 'CASE_NOTE_REQUEST_INVALID',
        'CASE_LABEL_INPUT_INVALID', 'CASE_LABEL_REQUEST_INVALID', 'CASE_LABELS_INVALID', 'CASE_MANAGEMENT_INPUT_INVALID',
        'INVALID_CASE_REASON', 'INVALID_CASE_PARTICIPANT_ACTION', 'CASE_PARTICIPANT_CONFIRMATION_REQUIRED', 'INVALID_CASE_QUEUE_FILTER',
        'CONTACT_NAVIGATION_INPUT_INVALID', 'CONTACT_ENTRY_INPUT_INVALID', 'INVALID_CASE_FORM_TOKEN', 'INVALID_CASE_FORM_ANSWERS', 'INVALID_CONTACT_RECIPIENTS',
        'INVALID_CASE_REPLY', 'CASE_REPLY_INPUT_INVALID', 'CASE_REPLY_CONFIRMATION_REQUIRED', 'CASE_REPLY_REQUEST_INVALID', 'CASE_REPLY_CURSOR_INVALID'].includes(error.code);
      const limited = error instanceof ContractError && error.code === 'CASE_REPLY_LIMIT';
      if (!denied && !conflict && !missing && !invalid && !limited) fault();
      if (!response.headersSent && !response.destroyed) send(response, denied ? 403 : limited ? 429 : conflict ? 409 : missing ? 404 : invalid ? 400 : 503,
        { error: denied ? 'Sign-in or request could not be verified.' : limited ? 'Reply queue or cooldown limit reached. Retry later using the same request.' : conflict ? 'This configuration changed. Reload and review it again.' :
          missing ? 'Configuration was not found.' : invalid ? 'Check the configuration and request fields.' : 'This operation is currently unavailable.' });
      else response.destroy();
    }).finally(() => running.delete(task));
    running.add(task);
  });
  server.requestTimeout = 5_000; server.headersTimeout = 5_000; server.keepAliveTimeout = 1_000; server.maxConnections = 16;
  return Object.freeze({
    async listen(port = 0) {
      requireInteger(port, 0, 65_535);
      await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
      return { host: '127.0.0.1', port: server.address().port };
    },
    async drain() { await Promise.all([...running]); },
    async close() {
      stopping = true;
      await new Promise((resolve, reject) => { server.close(error => error ? reject(error) : resolve()); server.closeIdleConnections(); });
      await Promise.all([...running]);
    },
  });
}
