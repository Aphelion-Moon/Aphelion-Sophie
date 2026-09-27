import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createDashboardPresentation, DASHBOARD_CSP } from '../apps/core/http/dashboard-assets.js';
import { createDashboardAuthHttpServer } from '../apps/core/http/dashboard-auth.js';
import { dashboardConfiguration } from './fixtures/oauth.js';
import { dashboardBytes } from './fixtures/dashboard-http.js';
import { ContractError } from '../contracts/validation.js';

test('authenticated shell serves fixed bytes and anonymous visitors receive only the login page', async () => {
  const presentation = await createDashboardPresentation();
  const server = createDashboardAuthHttpServer({ configuration: dashboardConfiguration, presentation, enabled: () => true,
    authoring: {}, formAuthoring: {}, answers: {}, automation: {}, permissions: {},
    auth: { authenticate: async () => ({ proof: {}, csrfToken: 'ab'.repeat(32) }), resolvePrincipal: async () => ({}), refreshSession: async () => 3600 },
    authorization: { dashboardAccess: async () => ({ guildId: '123', userId: '456', canManageCases: true, canCreateContacts: true,
      capabilities: Object.fromEntries(['shuttle.publish', 'case.forms.publish', 'answers.publish', 'permissions.publish', 'automation.publish'].map(key => [key, true])) }) }, onFault: () => assert.fail('Unexpected fault') });
  const address = await server.listen();
  try {
    const paths = ['/', '/ticket-forms', '/cases', '/staff-notes', '/case-labels', '/manage-cases', '/contact-entry', '/contacts', '/dashboard/styles.css', ...['app', 'api', 'controller', 'view', 'authoring-controller', 'shell', 'form-app', 'form-controller', 'form-view', 'case-app', 'case-controller', 'case-view', 'notes-app', 'notes-controller', 'notes-view', 'labels-app', 'labels-controller', 'labels-view', 'management-app', 'management-controller', 'management-view', 'contact-app', 'contact-controller', 'contact-view', 'contacts-app', 'contacts-controller', 'contacts-view'].map(name => `/dashboard/${name}.js`), '/dashboard/sophie-avatar.png'];
    paths.splice(paths.length - 1, 0, '/case-replies', '/dashboard/replies-app.js', '/dashboard/replies-controller.js', '/dashboard/replies-view.js');
    paths.splice(paths.length - 1, 0, '/answers', '/dashboard/answers-app.js', '/dashboard/answers-controller.js', '/dashboard/answers-view.js');
    paths.splice(paths.length - 1, 0, '/automation', '/dashboard/automation-app.js', '/dashboard/automation-controller.js', '/dashboard/automation-view.js', '/modules/automation/index.js', '/contracts/validation.js');
    const results = [];
    for (const path of paths) {
      if (presentation.get(path).contentType.startsWith('text/html')) {
        const anonymous = await dashboardBytes(address, path);
        assert.equal(anonymous.status, 303); assert.equal(anonymous.headers.location, '/login?returnTo=' + encodeURIComponent(path));
        assert.equal(anonymous.text.includes('service-nav'), false);
      }
      results.push(await dashboardBytes(address, path, { headers: { Cookie: '__Host-sophie-session=' + 'ab'.repeat(32) } }));
    }
    const login = await dashboardBytes(address, '/login?returnTo=%2Flocalizations');
    assert.equal(login.status, 200); assert.match(login.text, /returnTo=%2Flocalizations/);
    assert.equal(login.text.includes('service-nav'), false); assert.equal(login.text.includes('workspace'), false);
    for (const path of ['/login?returnTo=https%3A%2F%2Fevil.test', '/login?returnTo=%2F&returnTo=%2Fcases', '/login?unknown=1']) assert.equal((await dashboardBytes(address, path)).status, 403);
    for (const result of results) { assert.equal(result.status, 200); assert.equal(result.headers['content-security-policy'], DASHBOARD_CSP); assert.equal(result.headers['cache-control'], 'no-store'); }
    assert.match(results[0].text, /Sign in with Discord/); assert.equal(results[0].text.includes('SYNTHETIC PREVIEW'), false);
    assert.equal(results[0].text.includes('onboarding-session'), false);
    assert.match(results[1].text, /Ticket forms/); assert.equal(results[1].text.includes('Synthetic support form'), false);
    assert.match(results[1].text, /href="\/auth\/start\?returnTo=%2Fticket-forms"/);
    assert.equal((results[0].text.match(/class="nav-group"/g) ?? []).length, 3);
    for (const path of ['/dashboard/markdown.js', '/modules/onboarding/presentation.js']) assert.equal((await dashboardBytes(address, path)).status, 200);
    assert.match(results[2].text, /Case records/); assert.equal(results[2].text.includes('Synthetic case message'), false);
    assert.equal(createHash('sha256').update(results.at(-1).bytes).digest('hex'), '3d79dde5215683c2ba6183e98d06b21a66523318a3a20e20c20ca9b579f12a65');
    for (const path of ['/dashboard/../api.js', '/dashboard/%2e%2e/api.js', '/?draft=1', '/ticket-forms?caseType=admin-help', '/dashboard/app.js?cache=1', '/dashboard/asset-manifest.json', '/__preview/control']) {
      assert.equal((await dashboardBytes(address, path)).status, 404);
    }
    assert.equal((await dashboardBytes(address, '/', { headers: { Host: 'other.example.test' } })).status, 403);
    assert.equal((await dashboardBytes(address, '/', { method: 'POST', body: 'unauthorized content' })).status, 403);
    assert.equal((await dashboardBytes(address, '/case-replies?channelId=123')).status, 404);
    assert.equal((await dashboardBytes(address, '/api/cases/replies?channelId=123')).status, 404);
  } finally { await server.close(); }
});
test('presentation is absent by default and cannot turn an authentication-only listener into an editor', async () => {
  const server = createDashboardAuthHttpServer({ configuration: dashboardConfiguration, enabled: () => false, auth: null, authorization: null, onFault: () => {} });
  const address = await server.listen();
  try { assert.equal((await dashboardBytes(address, '/')).status, 404); assert.equal((await dashboardBytes(address, '/dashboard/app.js')).status, 404);
    for (const path of ['/api/onboarding/draft', '/api/ticket-forms/draft']) assert.equal((await dashboardBytes(address, path)).status, 404); }
  finally { await server.close(); }
});

test('expired sessions return to login while dependency failures never reveal page HTML', async () => {
  const presentation = await createDashboardPresentation();
  let code = 'DASHBOARD_SESSION_INVALID', faults = 0;
  const server = createDashboardAuthHttpServer({ configuration: dashboardConfiguration, presentation, enabled: () => true,
    auth: { authenticate: async () => { throw new ContractError(code); } }, authorization: {}, onFault: () => { faults++; } });
  const address = await server.listen();
  try {
    const options = { headers: { Cookie: '__Host-sophie-session=' + 'ab'.repeat(32) } };
    const expired = await dashboardBytes(address, '/localizations', options);
    assert.equal(expired.status, 303); assert.equal(expired.headers.location, '/login?returnTo=%2Flocalizations');
    code = 'DATABASE_UNAVAILABLE';
    const unavailable = await dashboardBytes(address, '/localizations', options);
    assert.equal(unavailable.status, 503); assert.equal(unavailable.text.includes('wording-workspace'), false);
    assert.equal(faults, 1);
  } finally { await server.close(); }
});

test('navigation and direct editor pages follow current access without exposing editor HTML', async () => {
  const presentation = await createDashboardPresentation(); let publisher = false, refreshed = 0;
  const server = createDashboardAuthHttpServer({ configuration: dashboardConfiguration, presentation, enabled: () => true,
    authoring: {},
    auth: { authenticate: async () => ({ proof: {}, csrfToken: 'ab'.repeat(32) }), resolvePrincipal: async () => ({}), refreshSession: async () => { refreshed++; return 3600; } },
    authorization: { dashboardAccess: async () => ({ guildId: '123', userId: '456', capabilities: { 'shuttle.publish': publisher } }) }, onFault: () => assert.fail('Unexpected fault') });
  const address = await server.listen(), options = { headers: { Cookie: '__Host-sophie-session=' + 'ab'.repeat(32) } };
  try {
    const ordinary = await dashboardBytes(address, '/cases', options);
    assert.equal(ordinary.status, 200); assert.match(ordinary.text, /sophie-session/);
    assert.equal(refreshed, 1); assert.match(ordinary.headers['set-cookie'][0], /Max-Age=3600/);
    for (const target of ['/', '/localizations', '/permissions', '/staff-notes', '/contact-entry']) {
      assert.equal(ordinary.text.includes(`href="${target}"`), false);
      const denied = await dashboardBytes(address, target, options);
      assert.equal(denied.status, 303); assert.equal(denied.headers.location, '/cases'); assert.doesNotMatch(denied.text, /<html/);
    }
    publisher = true;
    const editor = await dashboardBytes(address, '/', options); assert.equal(editor.status, 200);
    assert.match(editor.text, /href="\/localizations"/); assert.doesNotMatch(editor.text, /href="\/permissions"/);
    publisher = false; assert.equal((await dashboardBytes(address, '/', options)).status, 303);
    assert.equal(refreshed, 2);
  } finally { await server.close(); }
});
