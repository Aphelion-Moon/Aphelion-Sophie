import test from 'node:test';
import assert from 'node:assert/strict';
import { ContractError } from '../contracts/validation.js';
import { validateDashboardAuth, dashboardCookies, dashboardCookie } from '../contracts/dashboard-auth.js';
import { createDiscordOAuth } from '../apps/core/discord/oauth.js';
import { createCorePrincipals } from '../apps/core/security/principals.js';
import { authDigest, sessionCsrf } from '../apps/core/security/dashboard-auth.js';
import { dashboardConfiguration, syntheticClientSecret, simulatedOAuth } from './fixtures/oauth.js';
import { GUILD, OTHER, NOW } from './fixtures/domain.js';

const token = 'ab'.repeat(32);
const create = (provider, extra = {}) => createDiscordOAuth({ configuration: dashboardConfiguration, clientSecret: syntheticClientSecret,
  fetch: provider.fetch, clock: () => NOW, enabled: () => true, ...extra });

test('dashboard origin and host-only cookie contracts reject downgraded or ambiguous credentials', () => {
  for (const origin of ['http://sophie.example.test', 'https://sophie.example.test/', 'https://sophie.example.test/next',
    'https://user:pass@sophie.example.test', 'https://sophie.example.test?next=bad']) assert.throws(() => validateDashboardAuth({ ...dashboardConfiguration, origin }));
  const cookie = dashboardCookie('session', token, 3_600);
  assert.match(cookie, /Path=\/; HttpOnly; Secure; SameSite=Lax; Max-Age=3600$/); assert.equal(cookie.includes('Domain='), false);
  assert.deepEqual(dashboardCookies(`unrelated=value; __Host-sophie-session=${token}`), { login: null, session: token });
  assert.throws(() => dashboardCookies(`__Host-sophie-session=${token}; __Host-sophie-session=${token}`), /DASHBOARD_CREDENTIAL_INVALID/);
  assert.throws(() => dashboardCookies('__Host-sophie-session=%20bad'), /DASHBOARD_CREDENTIAL_INVALID/);
  assert.throws(() => validateDashboardAuth({ ...dashboardConfiguration, version: 2_147_483_648 }), /INVALID_INTEGER/);
});

test('OAuth requests bind one exact callback and identify scope without client-selected return paths', async () => {
  const provider = simulatedOAuth(), oauth = create(provider), url = new URL(oauth.authorizationUrl(token));
  assert.equal(url.origin, 'https://discord.com'); assert.equal(url.pathname, '/oauth2/authorize');
  assert.equal(url.searchParams.get('scope'), 'identify'); assert.equal(url.searchParams.get('redirect_uri'), `${dashboardConfiguration.origin}/auth/callback`);
  assert.equal(url.searchParams.get('state'), token); assert.equal(provider.state.calls.length, 0);
  const proof = await oauth.exchange(provider.issueCode()); assert.deepEqual(oauth.resolveIdentity(proof), { guildId: GUILD, userId: OTHER });
  assert.deepEqual(Object.keys(proof), []); assert.throws(() => oauth.resolveIdentity({ ...proof }), /OAUTH_IDENTITY_INVALID/);
  assert.deepEqual(provider.state.calls.map(call => call.method), ['POST', 'GET']);
});

test('OAuth failures are bounded and redacted, never retried or accepted with broader scopes', async () => {
  for (const tokenOverride of [{ scope: 'identify email' }, { token_type: 'Unknown' }, { access_token: '\r\nsecret' }]) {
    const provider = simulatedOAuth(); provider.state.tokenOverride = tokenOverride;
    await assert.rejects(create(provider).exchange(provider.issueCode()), /OAUTH_RESPONSE_INVALID/); assert.equal(provider.state.calls.length, 1);
  }
  const provider = simulatedOAuth(); provider.state.before = () => { throw new Error('synthetic-secret-and-provider-body'); };
  await assert.rejects(create(provider).exchange(provider.issueCode()), error => error.message === 'OAUTH_PROVIDER_UNAVAILABLE');
  assert.equal(provider.state.calls.length, 1);
  for (const response of [new Response('not-json'), Response.json([]), new Response('x'.repeat(16_385)),
    Response.json({}, { headers: { 'content-length': '16385' } }), Response.json({}, { status: 429 })]) {
    const bounded = simulatedOAuth(); bounded.state.before = () => response;
    await assert.rejects(create(bounded).exchange(bounded.issueCode()), /^ContractError: OAUTH_PROVIDER_UNAVAILABLE$/);
    assert.equal(bounded.state.calls.length, 1);
  }
});

test('disabled OAuth makes no request and expired identity proofs cannot issue a local session', async () => {
  const provider = simulatedOAuth(); await assert.rejects(create(provider, { enabled: () => false }).exchange(provider.issueCode()), /OAUTH_DISABLED/);
  assert.equal(provider.state.calls.length, 0);
  let now = NOW; const oauth = create(provider, { clock: () => now }), proof = await oauth.exchange(provider.issueCode());
  now += 30_001; assert.throws(() => oauth.resolveIdentity(proof), /OAUTH_IDENTITY_INVALID/);
});

test('session hashes and CSRF proofs use separate cryptographic derivations', () => {
  assert.match(authDigest(token), /^[a-f0-9]{64}$/); assert.notEqual(authDigest(token), token);
  assert.notEqual(sessionCsrf(token), authDigest(token)); assert.notEqual(sessionCsrf(token), sessionCsrf('cd'.repeat(32)));
});

test('the principal union falls through only on an untrusted proof, never a provider outage', async () => {
  let calls = 0;
  const dashboard = { resolvePrincipal: () => { calls++; return { guildId: GUILD, userId: OTHER }; } };
  const configured = createCorePrincipals({ interactions: { resolvePrincipal: () => { throw new ContractError('UNTRUSTED_PRINCIPAL'); } }, dashboard });
  assert.deepEqual(await configured.resolvePrincipal({}), { guildId: GUILD, userId: OTHER }); assert.equal(calls, 1);
  const unavailable = createCorePrincipals({ interactions: { resolvePrincipal: () => { throw new Error('unavailable'); } }, dashboard });
  await assert.rejects(unavailable.resolvePrincipal({}), /unavailable/); assert.equal(calls, 1);
});
