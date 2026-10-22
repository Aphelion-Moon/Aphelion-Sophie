import { requireCondition, requireId, requireInteger } from '../../../contracts/validation.js';
import { validateDashboardAuth, requireAuthToken, requireOAuthCode } from '../../../contracts/dashboard-auth.js';

/** Fixed confidential-client OAuth routes; no bot token, arbitrary scopes, URLs or token persistence. */
export function createDiscordOAuth({ configuration, clientSecret, fetch, clock, enabled }) {
  validateDashboardAuth(configuration);
  requireCondition(typeof clientSecret === 'string' && /^[A-Za-z0-9._~-]{16,256}$/.test(clientSecret) &&
    typeof fetch === 'function' && typeof clock === 'function' && typeof enabled === 'function', 'OAUTH_CONFIGURATION_INVALID');
  const fixed = structuredClone(configuration), identities = new WeakMap();
  const redirectUri = `${fixed.origin}/auth/callback`;
  async function request(url, options) {
    requireCondition(await enabled() === true, 'OAUTH_DISABLED');
    try {
      const response = await fetch(url, { ...options, redirect: 'error', signal: AbortSignal.timeout(5_000) });
      requireCondition(response.status === 200, 'OAUTH_PROVIDER_UNAVAILABLE');
      requireCondition(Number(response.headers.get('content-length') ?? 0) <= 16_384 && response.body, 'OAUTH_RESPONSE_INVALID');
      const reader = response.body.getReader(), parts = []; let size = 0;
      try {
        for (;;) { const { done, value } = await reader.read(); if (done) break; size += value.byteLength;
          requireCondition(size <= 16_384, 'OAUTH_RESPONSE_INVALID'); parts.push(value); }
        const value = JSON.parse(Buffer.concat(parts).toString('utf8'));
        requireCondition(value !== null && typeof value === 'object' && !Array.isArray(value), 'OAUTH_RESPONSE_INVALID'); return value;
      } finally { await reader.cancel().catch(() => {}); }
    } catch { requireCondition(false, 'OAUTH_PROVIDER_UNAVAILABLE'); }
  }
  return Object.freeze({
    authorizationUrl(state) {
      requireAuthToken(state);
      const url = new URL('https://discord.com/oauth2/authorize');
      url.search = new URLSearchParams({ response_type: 'code', client_id: fixed.applicationId, scope: 'identify',
        redirect_uri: redirectUri, state, prompt: 'consent' }).toString(); return url.href;
    },
    async exchange(code) {
      requireOAuthCode(code);
      const token = await request('https://discord.com/api/oauth2/token', { method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded',
          Authorization: `Basic ${Buffer.from(`${fixed.applicationId}:${clientSecret}`).toString('base64')}` },
        body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: redirectUri }).toString() });
      requireCondition(token.token_type === 'Bearer' && typeof token.access_token === 'string' &&
        /^[A-Za-z0-9._~-]{16,2048}$/.test(token.access_token), 'OAUTH_RESPONSE_INVALID'); requireInteger(token.expires_in, 1, 31_536_000);
      // Discord reports every scope the member has granted this application, so after a Shuttle Activity sign-in a
      // dashboard code also carries the Activity's presence scope. Only users/@me is ever called with it.
      const scopes = typeof token.scope === 'string' ? token.scope.split(' ') : [];
      requireCondition(scopes.includes('identify') && new Set(scopes).size === scopes.length &&
        scopes.every(scope => ['identify', 'rpc.activities.write'].includes(scope)), 'OAUTH_SCOPE_UNEXPECTED');
      const user = await request('https://discord.com/api/v10/users/@me', { method: 'GET', headers: { Authorization: `Bearer ${token.access_token}` } });
      requireId(user.id); requireCondition(user.bot !== true, 'OAUTH_IDENTITY_INVALID');
      requireCondition(await enabled() === true, 'OAUTH_DISABLED');
      const proof = Object.freeze({}); identities.set(proof, { guildId: fixed.guildId, userId: user.id, observedAt: clock() });
      return proof;
    },
    /**
     * Shuttle Activity sign-in: the Discord client's authorize command issues a code without a redirect URI. Only
     * `identify` and `rpc.activities.write` (the Activity's presence line) are accepted. The access token is returned
     * once for the Activity to authenticate its SDK with; core never stores it.
     */
    async exchangeActivity(code) {
      requireOAuthCode(code);
      const token = await request('https://discord.com/api/oauth2/token', { method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded',
          Authorization: `Basic ${Buffer.from(`${fixed.applicationId}:${clientSecret}`).toString('base64')}` },
        body: new URLSearchParams({ grant_type: 'authorization_code', code }).toString() });
      const scopes = typeof token.scope === 'string' ? token.scope.split(' ') : [];
      requireCondition(token.token_type === 'Bearer' && scopes.includes('identify') && new Set(scopes).size === scopes.length &&
        scopes.every(scope => ['identify', 'rpc.activities.write'].includes(scope)) && typeof token.access_token === 'string' &&
        /^[A-Za-z0-9._~-]{16,2048}$/.test(token.access_token), 'OAUTH_RESPONSE_INVALID'); requireInteger(token.expires_in, 1, 31_536_000);
      const user = await request('https://discord.com/api/v10/users/@me', { method: 'GET', headers: { Authorization: `Bearer ${token.access_token}` } });
      requireId(user.id); requireCondition(user.bot !== true, 'OAUTH_IDENTITY_INVALID');
      requireCondition(await enabled() === true, 'OAUTH_DISABLED');
      const proof = Object.freeze({}); identities.set(proof, { guildId: fixed.guildId, userId: user.id, observedAt: clock() });
      return { proof, accessToken: token.access_token, expiresIn: token.expires_in, scopes: [...scopes].sort() };
    },
    resolveIdentity(proof) {
      const value = identities.get(proof), now = clock();
      requireCondition(value && now >= value.observedAt && now - value.observedAt <= 30_000, 'OAUTH_IDENTITY_INVALID');
      return { guildId: value.guildId, userId: value.userId };
    },
  });
}
