import { requireCondition, requireId, requireInteger, requireKeys } from './validation.js';

export const DASHBOARD_COOKIES = Object.freeze({ login: '__Host-sophie-login', session: '__Host-sophie-session' });

export function validateDashboardAuth(configuration) {
  requireKeys(configuration, ['guildId', 'applicationId', 'version', 'origin']);
  requireId(configuration.guildId); requireId(configuration.applicationId); requireInteger(configuration.version, 1, 2_147_483_647);
  requireCondition(typeof configuration.origin === 'string' && configuration.origin.length <= 256, 'DASHBOARD_ORIGIN_INVALID');
  let origin; try { origin = new URL(configuration.origin); } catch { requireCondition(false, 'DASHBOARD_ORIGIN_INVALID'); }
  requireCondition(origin.protocol === 'https:' && origin.origin === configuration.origin && !origin.username && !origin.password &&
    !origin.search && !origin.hash && origin.pathname === '/', 'DASHBOARD_ORIGIN_INVALID');
}

export function requireAuthToken(value) {
  requireCondition(typeof value === 'string' && /^[a-f0-9]{64}$/.test(value), 'DASHBOARD_CREDENTIAL_INVALID');
}

export function requireOAuthCode(value) {
  requireCondition(typeof value === 'string' && /^[A-Za-z0-9._~-]{1,2048}$/.test(value), 'OAUTH_CODE_INVALID');
}

/** Reject duplicate credentials and never interpret an untrusted cookie as identity. */
export function dashboardCookies(header = '') {
  requireCondition(typeof header === 'string' && header.length <= 8_192, 'DASHBOARD_CREDENTIAL_INVALID');
  const result = { login: null, session: null };
  for (const part of header.split(';')) {
    const item = part.trim(), split = item.indexOf('='); if (split < 0) continue;
    const key = Object.keys(DASHBOARD_COOKIES).find(name => DASHBOARD_COOKIES[name] === item.slice(0, split));
    if (!key) continue;
    const value = item.slice(split + 1); requireAuthToken(value);
    requireCondition(result[key] === null, 'DASHBOARD_CREDENTIAL_INVALID'); result[key] = value;
  }
  return result;
}

export function dashboardCookie(kind, value, maxAge) {
  requireCondition(Object.hasOwn(DASHBOARD_COOKIES, kind), 'DASHBOARD_CREDENTIAL_INVALID');
  requireInteger(maxAge, 0, 3_600); if (maxAge) requireAuthToken(value);
  return `${DASHBOARD_COOKIES[kind]}=${maxAge ? value : ''}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}
