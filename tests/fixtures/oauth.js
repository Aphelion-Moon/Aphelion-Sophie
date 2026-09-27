import { randomBytes } from 'node:crypto';
import { GUILD, OTHER } from './domain.js';
import { APPLICATION } from './interactions.js';

export const dashboardConfiguration = Object.freeze({ guildId: GUILD, applicationId: APPLICATION, version: 1, origin: 'https://sophie.example.test' });
export const syntheticClientSecret = 'synthetic-client-secret-for-tests';

/** An injected provider fixture. No request leaves the process; every code/token is synthetic. */
export function simulatedOAuth() {
  const state = { calls: [], codes: new Map(), tokens: new Map(), before: null, tokenOverride: null, userOverride: null };
  return {
    state,
    issueCode(userId = OTHER) { const code = randomBytes(24).toString('hex'); state.codes.set(code, userId); return code; },
    async fetch(url, options) {
      if (options.redirect !== 'error') throw new Error('SYNTHETIC_OAUTH_REDIRECT_UNSAFE');
      const call = { url, ...options }; state.calls.push(call); const override = await state.before?.(call); if (override) return override;
      if (url === 'https://discord.com/api/oauth2/token' && options.method === 'POST') {
        const fields = new URLSearchParams(options.body), userId = state.codes.get(fields.get('code'));
        const expected = `Basic ${Buffer.from(`${APPLICATION}:${syntheticClientSecret}`).toString('base64')}`;
        if (options.headers.Authorization !== expected || fields.get('grant_type') !== 'authorization_code' ||
          fields.get('redirect_uri') !== `${dashboardConfiguration.origin}/auth/callback` || !userId) return Response.json({}, { status: 400 });
        state.codes.delete(fields.get('code'));
        const access = randomBytes(24).toString('hex'); state.tokens.set(access, userId);
        return Response.json({ access_token: access, refresh_token: 'synthetic-refresh-not-retained', token_type: 'Bearer', scope: 'identify', expires_in: 604800, ...state.tokenOverride });
      }
      if (url === 'https://discord.com/api/v10/users/@me' && options.method === 'GET') {
        const userId = state.tokens.get(options.headers.Authorization?.slice('Bearer '.length));
        return userId ? Response.json({ id: userId, username: 'synthetic-profile-not-retained', ...state.userOverride }) : Response.json({}, { status: 401 });
      }
      throw new Error('SYNTHETIC_OAUTH_ROUTE_UNSUPPORTED');
    },
  };
}
