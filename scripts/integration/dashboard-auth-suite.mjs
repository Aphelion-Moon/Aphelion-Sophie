import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { dashboardHttp as http } from '../../tests/fixtures/dashboard-http.js';
import { dashboardWorkflow, dashboardServices } from '../../tests/fixtures/dashboard-auth.js';
import { dashboardConfiguration } from '../../tests/fixtures/oauth.js';
import { GUILD, USER, OTHER, STAFF, LEAD } from '../../tests/fixtures/domain.js';
import { BOT, CREW, MUZZLED } from '../../tests/fixtures/discord.js';
import { authDigest, sessionCsrf } from '../../apps/core/security/dashboard-auth.js';
import { createDashboardAuthStore } from '../../apps/core/storage/dashboard-auth.js';
import { createDashboardAuthHttpServer } from '../../apps/core/http/dashboard-auth.js';
import { DASHBOARD_COOKIES } from '../../contracts/dashboard-auth.js';

const token = () => randomBytes(32).toString('hex');
const scope = { guildId: GUILD, caseId: 'synthetic-case', openerId: USER, type: 'head-admin-contact' };
const post = value => ({ token: value, method: 'POST', origin: dashboardConfiguration.origin, csrfToken: sessionCsrf(value) });

export async function runDashboardAuthSuite(cluster, run) {
  const scenario = (name, work) => run(name, async () => { const f = await dashboardWorkflow(cluster); await work(f); });
  const browserActor = async (f, session) => {
    const { proof } = await f.auth.authenticate({ token: session.token });
    return f.dashboardAuthorization.resolveActor(proof);
  };
  async function withServer(f, work, overrides = {}) {
    const faults = [], server = createDashboardAuthHttpServer({ configuration: dashboardConfiguration, auth: f.auth,
      authorization: f.dashboardAuthorization, enabled: () => f.clock.enabled, onFault: value => faults.push(value), ...overrides });
    try { await work(await server.listen(), faults); } finally { await server.close(); }
  }

  await scenario('O01 sign-in stores only digests and identity, with no role grants or retained provider credentials', async f => {
    const flow = await f.begin(), session = await f.complete(flow, USER), rows = await f.rows('dashboard_sessions');
    assert.equal(rows.length, 1); assert.equal(rows[0].token_hash, authDigest(session.token)); assert.equal(rows[0].user_id, USER);
    assert.ok(Math.abs(rows[0].expires_at - rows[0].issued_at - 3_600_000) < 100);
    const data = JSON.stringify([rows, await f.rows('dashboard_login_flows'), await f.rows('dashboard_auth_policies')]);
    for (const secret of [session.token, flow.state, flow.binding, 'synthetic-refresh-not-retained', 'synthetic-profile-not-retained', ...f.provider.state.tokens.keys()]) assert.equal(data.includes(secret), false);
    assert.equal(f.provider.state.calls.length, 2); assert.equal((await f.rows('dashboard_login_flows'))[0].phase, 'complete');
    const actor = await browserActor(f, session);
    assert.equal(await f.dashboardAuthorization.authorize('shuttle.self', actor, { guildId: GUILD, userId: USER }), true);
    assert.equal(await f.dashboardAuthorization.authorize('case.manage', actor, scope), false);
    assert.equal(f.discord.state.calls.some(call => call.method !== 'GET'), false);
  });

  await scenario('O02 browser binding, expiry and one-time state stop swapped, cancelled and competing callbacks', async f => {
    const flow = await f.begin(), code = f.provider.issueCode();
    await assert.rejects(f.auth.complete({ ...flow, code, binding: token() }), /DASHBOARD_LOGIN_INVALID/);
    await assert.rejects(f.auth.complete({ ...flow, code, state: token() }), /DASHBOARD_LOGIN_INVALID/);
    assert.equal(f.provider.state.calls.length, 0);
    const results = await Promise.allSettled([f.auth.complete({ ...flow, code }), f.auth.complete({ ...flow, code })]);
    assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
    assert.match(results.find(result => result.status === 'rejected').reason.message, /DASHBOARD_LOGIN_INVALID/);
    assert.equal(f.provider.state.calls.length, 2);
    const expired = await f.begin(); await f.admin.query("UPDATE sophie_core.dashboard_login_flows SET expires_at = '-infinity'");
    await assert.rejects(f.complete(expired), /DASHBOARD_LOGIN_INVALID/);
    const cancelled = await f.begin(); assert.equal(await f.auth.complete({ ...cancelled, cancelled: true }), null);
    await assert.rejects(f.complete(cancelled), /DASHBOARD_LOGIN_INVALID/); assert.equal(f.provider.state.calls.length, 2);
  });

  await scenario('O03 provider failure, broader scopes, bots and absent guild members never issue local sessions', async f => {
    const flow = await f.begin(); f.provider.state.before = () => { throw new Error('synthetic-private-provider-diagnostic'); };
    await assert.rejects(f.complete(flow), /^ContractError: OAUTH_PROVIDER_UNAVAILABLE$/);
    f.provider.state.before = null; await assert.rejects(f.complete(flow), /DASHBOARD_LOGIN_INVALID/);
    f.provider.state.tokenOverride = { scope: 'identify email' }; await assert.rejects(f.login(), /OAUTH_RESPONSE_INVALID/);
    f.provider.state.tokenOverride = null; f.provider.state.userOverride = { bot: true };
    await assert.rejects(f.login(), /OAUTH_IDENTITY_INVALID/); f.provider.state.userOverride = null;
    await assert.rejects(f.login(BOT), /OPERATION_DENIED/);
    f.discord.state.members.delete(OTHER); await assert.rejects(f.login(), /OPERATION_DENIED/);
    assert.equal((await f.rows('dashboard_sessions')).length, 0);
  });

  await scenario('O04 session and proof expiry reject serialized identities and database digests as credentials', async f => {
    const session = await f.login(), { proof } = await f.auth.authenticate({ token: session.token });
    await assert.rejects(f.auth.resolvePrincipal({ ...proof }), /UNTRUSTED_PRINCIPAL/);
    await assert.rejects(f.dashboardAuthorization.resolveActor({ guildId: GUILD, userId: OTHER, roleIds: [LEAD] }), /UNTRUSTED_PRINCIPAL/);
    await assert.rejects(f.auth.authenticate({ token: authDigest(session.token) }), /DASHBOARD_SESSION_INVALID/);
    f.clock.now += 300_001; await assert.rejects(f.auth.resolvePrincipal(proof), /UNTRUSTED_PRINCIPAL/);
    const fresh = await f.auth.authenticate({ token: session.token });
    await f.admin.query("UPDATE sophie_core.dashboard_sessions SET expires_at = '-infinity'");
    await assert.rejects(f.auth.resolvePrincipal(fresh.proof), /UNTRUSTED_PRINCIPAL/);
    await assert.rejects(f.auth.authenticate({ token: session.token }), /DASHBOARD_SESSION_INVALID/);
  });

  await scenario('O05 logout requires same-origin CSRF proof and invalidates every issued principal for that session', async f => {
    const session = await f.login(), { proof } = await f.auth.authenticate({ token: session.token });
    const actor = await f.dashboardAuthorization.resolveActor(proof), input = post(session.token);
    await assert.rejects(f.auth.logout({ ...input, method: 'GET' }), /DASHBOARD_METHOD_INVALID/);
    await assert.rejects(f.auth.logout({ ...input, origin: 'https://other.example.test' }), /DASHBOARD_ORIGIN_INVALID/);
    await assert.rejects(f.auth.logout({ ...input, csrfToken: token() }), /DASHBOARD_CSRF_INVALID/);
    assert.equal(await f.dashboardAuthorization.authorize('case.manage', actor, { ...scope, type: 'staff-report' }), true);
    await f.auth.logout(input); await assert.rejects(f.auth.resolvePrincipal(proof), /UNTRUSTED_PRINCIPAL/);
    assert.equal(await f.dashboardAuthorization.authorize('case.manage', actor, { ...scope, type: 'staff-report' }), false);
    assert.equal((await f.rows('dashboard_sessions'))[0].revoked, true);
  });

  await scenario('O06 fresh login rotates the browser credential and limits each identity to eight active sessions', async f => {
    const first = await f.login(), second = await f.login(OTHER, first.token); assert.notEqual(first.token, second.token);
    await assert.rejects(f.auth.authenticate({ token: first.token }), /DASHBOARD_SESSION_INVALID/);
    for (let index = 0; index < 8; index++) await f.login();
    assert.equal((await f.rows('dashboard_sessions')).filter(row => !row.revoked).length, 8);
    await assert.rejects(f.auth.authenticate({ token: second.token }), /DASHBOARD_SESSION_INVALID/);
    assert.equal((await f.rows('dashboard_sessions')).length, 8);
  });

  await scenario('O07 durable sign-in cadence and bounded slots reject flooding and recycle only obsolete auth metadata', async f => {
    const first = await f.begin(); await assert.rejects(f.auth.begin(), /DASHBOARD_LOGIN_BUSY/);
    for (let index = 1; index < 64; index++) await f.begin();
    await assert.rejects(f.begin(), /DASHBOARD_LOGIN_BUSY/); assert.equal((await f.rows('dashboard_login_flows')).length, 64);
    const replacement = await f.begin(first.binding); await assert.rejects(f.complete(first), /DASHBOARD_LOGIN_INVALID/);
    await f.admin.query(`INSERT INTO sophie_core.dashboard_sessions (guild_id, slot, policy_version, user_id, token_hash, expires_at)
      SELECT $1, n, 1, $2, lpad(to_hex(n), 64, '0'), clock_timestamp() + interval '1 hour' FROM generate_series(1, 256) n`, [GUILD, USER]);
    await assert.rejects(f.complete(replacement), /DASHBOARD_LOGIN_BUSY/);
    assert.equal((await f.rows('dashboard_sessions')).length, 256);
    const current = dashboardServices(f, { ...dashboardConfiguration, version: 2 });
    const next = await current.login(); assert.equal((await current.auth.authenticate({ token: next.token })).proof.userId, OTHER);
    assert.equal((await f.rows('dashboard_sessions')).length, 256); assert.equal((await f.rows('dashboard_login_flows')).length, 64);
    assert.equal((await f.rows('shuttle_publications')).length, 1);
  });

  await scenario('O08 immutable OAuth configuration invalidates older sessions and callbacks without permitting rollback', async f => {
    const session = await f.login(), flow = await f.begin(), saved = await f.rows('dashboard_auth_policies');
    const changed = dashboardServices(f, { ...dashboardConfiguration, applicationId: USER });
    await f.permitLogin(); await assert.rejects(changed.auth.begin(), /DASHBOARD_POLICY_CHANGED/);
    assert.deepEqual(await f.rows('dashboard_auth_policies'), saved);
    const next = dashboardServices(f, { ...dashboardConfiguration, version: 2 }); await next.begin();
    await assert.rejects(f.auth.authenticate({ token: session.token }), /DASHBOARD_POLICY_CHANGED/);
    await assert.rejects(next.auth.authenticate({ token: session.token }), /DASHBOARD_SESSION_INVALID/);
    await assert.rejects(f.complete(flow), /DASHBOARD_POLICY_CHANGED/);
    await assert.rejects(next.complete(flow), /DASHBOARD_LOGIN_INVALID/);
    await assert.rejects(f.begin(), /DASHBOARD_POLICY_CHANGED/);
  });

  await scenario('O09 browser actions share current case audiences and Muzzled policy, without trusting profile roles or Administrator', async f => {
    f.provider.state.userOverride = { roles: [LEAD], permissions: '8' };
    const session = await f.login(); let actor = await browserActor(f, session);
    assert.equal(await f.dashboardAuthorization.authorize('case.manage', actor, scope), false);
    assert.equal(await f.dashboardAuthorization.authorize('case.manage', actor, { ...scope, type: 'staff-report' }), true);
    f.discord.state.members.set(OTHER, [LEAD]); actor = await browserActor(f, session);
    assert.equal(await f.dashboardAuthorization.authorize('case.manage', actor, scope), true);
    f.discord.state.members.set(OTHER, [CREW]); f.discord.state.roles.find(role => role.id === CREW).permissions = '8';
    assert.equal(await f.dashboardAuthorization.authorize('case.manage', actor, scope), false);
    actor = await browserActor(f, session); assert.equal(await f.dashboardAuthorization.authorize('shuttle.publish', actor, {}), false);
    f.discord.state.members.set(OTHER, [STAFF, MUZZLED]); actor = await browserActor(f, session);
    assert.equal(await f.dashboardAuthorization.authorize('shuttle.self', actor, { guildId: GUILD, userId: OTHER }), false);
    assert.equal(await f.dashboardAuthorization.authorize('case.manage', actor, { ...scope, type: 'staff-report' }), false);
    f.discord.state.members.delete(OTHER); await assert.rejects(browserActor(f, session), /OPERATION_DENIED/);
  });

  await scenario('O10 logout during a current-role check blocks the protected mutation and its audit', async f => {
    await f.open(); const row = (await f.rows('case_reservations'))[0], session = await f.login(), actor = await browserActor(f, session);
    const observation = await f.discord.roles.observe(USER);
    f.discord.state.before = async call => {
      if (call.path.endsWith(`/members/${OTHER}`)) { f.discord.state.before = null; await f.authStore.revokeSession(authDigest(session.token)); }
    };
    await assert.rejects(f.protectedStore.closeCase({ actor, interactionId: f.nextId(), id: row.id,
      observation, expectedVersion: row.version, reason: 'resolved' }), /OPERATION_DENIED/);
    assert.equal((await f.rows('case_lifecycle_actions')).length, 0); assert.deepEqual((await f.rows('case_reservations'))[0], row);
  });

  await scenario('O11 signed commands and browser actors use the same durable case service without accepting copied proofs', async f => {
    await f.open(); const row = (await f.rows('case_reservations'))[0], session = await f.login(), actor = await browserActor(f, session);
    const proof = f.verified(f.payload({ member: { user: { id: OTHER } } })), commandActor = await f.dashboardAuthorization.resolveActor(proof);
    assert.equal(await f.dashboardAuthorization.authorize('case.manage', commandActor, { ...scope, type: 'shuttle' }), true);
    await assert.rejects(f.dashboardAuthorization.resolveActor({ ...proof }), /UNTRUSTED_PRINCIPAL/);
    await f.protectedStore.closeCase({ actor, interactionId: f.nextId(), id: row.id,
      observation: await f.discord.roles.observe(USER), expectedVersion: row.version, reason: 'resolved' });
    const action = (await f.rows('case_lifecycle_actions'))[0]; assert.equal(action.operator_grant.userId, OTHER);
    assert.equal(JSON.stringify(action).includes(session.token), false); assert.equal((await f.rows('case_reservations'))[0].state, 'closing');
    // Logout blocks future browser operations; an already committed action still uses its recorded authority grant.
    await f.auth.logout(post(session.token)); assert.equal(await f.dashboardAuthorization.authorizeRecorded('case.manage', action.operator_grant, { ...scope, type: 'shuttle' }), true);
  });

  await scenario('O12 failed or uncertain commits cannot exchange a code twice or partially rotate a session', async f => {
    const session = await f.login(), flow = await f.begin(), before = await f.rows('dashboard_sessions');
    await f.admin.query(`CREATE FUNCTION sophie_core.synthetic_auth_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic_auth_failure'; END $$;
      CREATE TRIGGER synthetic_auth_failure BEFORE INSERT OR UPDATE ON sophie_core.dashboard_sessions FOR EACH ROW EXECUTE FUNCTION sophie_core.synthetic_auth_failure()`);
    try { await assert.rejects(f.complete(flow, OTHER, session.token), /synthetic_auth_failure/); }
    finally { await f.admin.query('DROP TRIGGER synthetic_auth_failure ON sophie_core.dashboard_sessions; DROP FUNCTION sophie_core.synthetic_auth_failure()'); }
    assert.deepEqual(await f.rows('dashboard_sessions'), before); await assert.rejects(f.complete(flow), /DASHBOARD_LOGIN_INVALID/);
    const pending = await f.begin(), calls = f.provider.state.calls.length; let loseCommit = true;
    const uncertain = createDashboardAuthStore({ configuration: dashboardConfiguration, clock: () => f.clock.now, pool: {
      async connect() { const client = await f.pool.connect(); return { release: value => client.release(value), async query(sql, values) {
        const result = await client.query(sql, values); if (sql === 'COMMIT' && loseCommit) { loseCommit = false; throw new Error('SYNTHETIC_COMMIT_RESPONSE_LOST'); } return result;
      } }; },
    } });
    await assert.rejects(uncertain.consumeFlow({ stateHash: authDigest(pending.state), bindingHash: authDigest(pending.binding) }), /SYNTHETIC_COMMIT_RESPONSE_LOST/);
    await assert.rejects(f.complete(pending), /DASHBOARD_LOGIN_INVALID/); assert.equal(f.provider.state.calls.length, calls);
    await assert.rejects(f.authStore.finishLogin({ claim: {}, observation: await f.discord.roles.observeActor(OTHER), tokenHash: token() }), /DASHBOARD_LOGIN_INVALID/);
  });

  await scenario('O13 knowledge cannot read auth storage and the core cannot delete retained or ephemeral rows', async f => {
    await f.login();
    for (const table of ['dashboard_sessions', 'dashboard_login_flows', 'dashboard_auth_policies', 'dashboard_auth_limits']) {
      await assert.rejects(cluster.knowledgePool.query(`SELECT * FROM sophie_core.${table}`), { code: '42501' });
      await assert.rejects(f.pool.query(`DELETE FROM sophie_core.${table}`), { code: '42501' });
    }
  });

  await scenario('O14 loopback HTTP completes the fixed OAuth flow and protected logout with secure cookie and response headers', async f => {
    await withServer(f, async (server, faults) => {
      const start = await http(server, '/auth/start'); assert.equal(start.status, 303);
      const loginCookie = start.headers['set-cookie'][0], binding = loginCookie.split(';')[0], state = new URL(start.headers.location).searchParams.get('state');
      assert.match(loginCookie, /; Path=\/; HttpOnly; Secure; SameSite=Lax; Max-Age=300$/);
      const callback = await http(server, `/auth/callback?state=${state}&code=${f.provider.issueCode()}`, { headers: { Cookie: binding } });
      assert.equal(callback.status, 303); assert.equal(callback.headers.location, '/');
      const sessionCookie = callback.headers['set-cookie'].find(value => value.startsWith(`${DASHBOARD_COOKIES.session}=`));
      assert.match(sessionCookie, /; Path=\/; HttpOnly; Secure; SameSite=Lax; Max-Age=3600$/);
      const cookie = sessionCookie.split(';')[0], info = await http(server, '/auth/session', { headers: { Cookie: cookie } });
      assert.equal(info.status, 200); assert.equal(info.body.userId, OTHER); assert.equal(info.body.guildId, GUILD);
      for (const response of [start, callback, info]) {
        assert.equal(response.headers['cache-control'], 'no-store'); assert.equal(response.headers['referrer-policy'], 'no-referrer');
        assert.equal(response.headers['x-content-type-options'], 'nosniff'); assert.equal(response.headers['access-control-allow-origin'], undefined);
        assert.match(response.headers['content-security-policy'], /frame-ancestors 'none'/);
      }
      const logout = await http(server, '/auth/logout', { method: 'POST', headers: { Cookie: cookie, Origin: dashboardConfiguration.origin, 'X-CSRF-Token': info.body.csrfToken } });
      assert.equal(logout.status, 200); assert.match(logout.headers['set-cookie'][0], /Max-Age=0$/);
      assert.equal((await http(server, '/auth/session', { headers: { Cookie: cookie } })).status, 403); assert.deepEqual(faults, []);
    });
  });

  await scenario('O15 HTTP rejects ambiguous credentials, extra redirects, wrong hosts and CSRF without exposing provider errors', async f => {
    const session = await f.login(), cookie = `${DASHBOARD_COOKIES.session}=${session.token}`;
    await withServer(f, async (server, faults) => {
      for (const [path, options] of [
        ['/auth/start?return=https://other.example.test', {}], ['/auth/start', { headers: { Host: 'other.example.test' } }],
        ['/auth/session', { headers: { Cookie: `${cookie}; ${cookie}` } }], ['/auth/session', { method: 'POST' }],
        ['/auth/logout', { method: 'POST', headers: { Cookie: cookie } }],
        ['/auth/logout', { method: 'POST', headers: { Cookie: cookie, Origin: 'null', 'X-CSRF-Token': sessionCsrf(session.token) } }],
        ['/auth/callback?state=one&state=two&code=synthetic', {}], ['/auth/callback?state=one&code=two&return=elsewhere', {}],
      ]) assert.equal((await http(server, path, options)).status, 403);
      assert.equal((await http(server, '/cases')).status, 404); assert.equal(f.provider.state.calls.length, 2);
      const flow = await f.begin(); f.provider.state.before = () => { throw new Error('synthetic-do-not-log-credentials'); };
      const failed = await http(server, `/auth/callback?state=${flow.state}&code=${f.provider.issueCode()}`, { headers: { Cookie: `${DASHBOARD_COOKIES.login}=${flow.binding}` } });
      assert.equal(failed.status, 503); assert.equal(failed.text.includes('synthetic'), false); assert.deepEqual(faults, ['DASHBOARD_AUTH_UNAVAILABLE']);
    });
  });

  await scenario('O17 return paths are bound to one-time OAuth state and restricted to dashboard pages', async f => {
    await withServer(f, async server => {
      for (const value of ['https://other.example.test', '//other.example.test', '/unknown', '/cases?channel=123', '/\\other', '/auth/logout']) {
        assert.equal((await http(server, `/auth/start?returnTo=${encodeURIComponent(value)}`)).status, 403);
      }
      assert.equal((await http(server, '/auth/start?returnTo=/cases&returnTo=/')).status, 403);
      const start = await http(server, '/auth/start?returnTo=%2Fticket-forms');
      assert.equal(start.status, 303);
      const cookie = start.headers['set-cookie'][0].split(';')[0], state = new URL(start.headers.location).searchParams.get('state');
      const callback = await http(server, `/auth/callback?state=${state}&code=${f.provider.issueCode()}`, { headers: { Cookie: cookie } });
      assert.equal(callback.status, 303); assert.equal(callback.headers.location, '/ticket-forms');
      assert.equal((await http(server, `/auth/callback?state=${state}&code=${f.provider.issueCode()}`, { headers: { Cookie: cookie } })).status, 403);
    });
  });

  await scenario('O18 session renewal uses one current Discord observation, respects absolute expiry and cannot revive logout', async f => {
    const session = await f.login(), cookie = `${DASHBOARD_COOKIES.session}=${session.token}`;
    await withServer(f, async server => {
      await f.admin.query("UPDATE sophie_core.dashboard_sessions SET issued_at=clock_timestamp()-interval '2 hours', expires_at=clock_timestamp()+interval '5 minutes'");
      const before = f.discord.state.calls.filter(call => call.path.endsWith(`/members/${OTHER}`)).length;
      const renewed = await http(server, '/auth/session', { headers: { Cookie: cookie } });
      assert.equal(renewed.status, 200); assert.match(renewed.headers['set-cookie'][0], /Max-Age=359[89]$/);
      assert.equal(f.discord.state.calls.filter(call => call.path.endsWith(`/members/${OTHER}`)).length - before, 1);
      assert.ok((await f.rows('dashboard_sessions'))[0].expires_at - Date.now() > 3_500_000);
      await f.admin.query("UPDATE sophie_core.dashboard_sessions SET issued_at=clock_timestamp()-interval '11 hours 55 minutes'");
      const limited = await http(server, '/auth/session', { headers: { Cookie: cookie } });
      assert.equal(limited.status, 200); assert.match(limited.headers['set-cookie'][0], /Max-Age=29[89]$/);
      await f.admin.query("UPDATE sophie_core.dashboard_sessions SET issued_at=clock_timestamp()-interval '12 hours'");
      assert.equal((await http(server, '/auth/session', { headers: { Cookie: cookie } })).status, 403);
      await assert.rejects(f.auth.refreshSession(session.token), /DASHBOARD_SESSION_INVALID/);
      await f.admin.query("UPDATE sophie_core.dashboard_sessions SET issued_at=clock_timestamp(), expires_at=clock_timestamp()+interval '1 hour'");
      await f.auth.logout(post(session.token)); await assert.rejects(f.auth.refreshSession(session.token), /DASHBOARD_SESSION_INVALID/);
    });
  });

  await scenario('O19 logging out during session observation prevents renewal', async f => {
    const session = await f.login(), cookie = `${DASHBOARD_COOKIES.session}=${session.token}`;
    await withServer(f, async server => {
      f.discord.state.before = async call => { if (call.path.endsWith(`/members/${OTHER}`)) { f.discord.state.before = null; await f.authStore.revokeSession(authDigest(session.token)); } };
      const denied = await http(server, '/auth/session', { headers: { Cookie: cookie } });
      assert.equal(denied.status, 403); assert.equal(denied.headers['set-cookie'], undefined);
    });
  });

  await scenario('O16 auth ingress admits one operation at a time and a disabled gate starts no login or provider work', async f => {
    let entered, release; const started = new Promise(resolve => { entered = resolve; }), blocked = new Promise(resolve => { release = resolve; });
    await withServer(f, async server => {
      const first = http(server, '/auth/start'); await started;
      try { assert.equal((await http(server, '/auth/start')).status, 503); }
      finally { release(); }
      assert.equal((await first).status, 303); f.clock.enabled = false;
      assert.equal((await http(server, '/auth/start')).status, 503); assert.equal(f.provider.state.calls.length, 0);
      assert.equal((await f.rows('dashboard_login_flows')).length, 1);
    }, { auth: { ...f.auth, async begin(previous) { entered(); await blocked; return f.auth.begin(previous); } } });
  });
}
