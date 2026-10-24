/** Thrown with the server's fixed outcome word ('closed', 'stale', 'signin', …) or 'offline'. */
export class ShuttleApiError extends Error {
  constructor(word, status) { super(word); this.word = word; this.status = status; }
}

const RETRY_MS = Object.freeze([1_000, 2_000, 4_000]);
export const RENEWAL_MS = 10_000;

/**
 * The Activity's calls to core (P43). The bearer token from sign-in lives only in this closure. A click keeps one
 * request key through its retries, so a retried Continue never moves the run twice.
 *
 * A session ends after an hour, or when core restarts. Once Discord has signed the member in, a request refused for an
 * ended session signs in again through Discord without a prompt (setRenewal) and is sent once more with the same
 * request key, so a member back from being away keeps reading (owner report, 24 October 2026).
 */
export function createShuttleApi({ fetch, randomBytes, wait = ms => new Promise(resolve => setTimeout(resolve, ms)), onSignal = () => {} }) {
  let token = null, renewal = null, renewing = null;
  const requestId = () => [...randomBytes(16)].map(byte => byte.toString(16).padStart(2, '0')).join('');
  async function call(path, { method = 'GET', body } = {}) {
    let renewedOnce = false;
    for (let attempt = 0; ; attempt++) {
      let response = null;
      try {
        response = await fetch(path, { method, cache: 'no-store', credentials: 'omit',
          headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
          ...(body ? { body: JSON.stringify(body) } : {}) });
      } catch { response = null; }
      // 503 (core busy) and 429 (this member's own requests too fast) are tried again after a pause; a 429 is not a lost
      // signal, so the status line is left alone.
      const later = response === null || response.status === 503 || response.status === 429;
      if (!later) {
        onSignal(true);
        const value = response.status === 204 ? null : await response.json().catch(() => null);
        if (response.ok) return value;
        const word = typeof value?.error === 'string' ? value.error : 'failed';
        if (word === 'signin' && response.status === 401 && path !== '/api/session' && !renewedOnce) { renewedOnce = true; if (await renewed()) continue; }
        throw new ShuttleApiError(word, response.status);
      }
      if (response?.status !== 429) onSignal(false);
      if (attempt >= RETRY_MS.length) throw new ShuttleApiError(response?.status === 429 ? 'slow' : response ? 'retry' : 'offline', response?.status ?? 0);
      await wait(RETRY_MS[attempt]);
    }
  }
  /**
   * Signs in again, once per call that needs it; requests refused together share one renewal. False when it cannot, or
   * when Discord has not answered within RENEWAL_MS: a renewal that never settled was shared by every later request, so
   * the link could not come back without reopening the Shuttle.
   */
  async function renewed() {
    if (renewal === null || token === null) return false;
    renewing ??= new Promise(resolve => {
      const timer = setTimeout(() => resolve(false), RENEWAL_MS);
      renewal().then(() => true, () => false).then(value => { clearTimeout(timer); resolve(value); });
    }).finally(() => { renewing = null; });
    return renewing;
  }
  return Object.freeze({
    config: () => call('/api/config'),
    async signIn({ code, instanceId }) {
      const signed = await call('/api/session', { method: 'POST', body: { code, instanceId } });
      token = signed.token;
      return signed;
    },
    describe: () => call('/api/shuttle'),
    board: () => call('/api/shuttle/board', { method: 'POST', body: { requestId: requestId() } }),
    act: (action, expectedVersion) => call('/api/shuttle/act', { method: 'POST', body: { requestId: requestId(), action, expectedVersion } }),
    reset: () => call('/api/shuttle/reset', { method: 'POST', body: { requestId: requestId() } }),
    /** How to sign in again without a prompt (Discord's authorize, then signIn); set once the first sign-in worked. */
    setRenewal(renew) { renewal = typeof renew === 'function' ? renew : null; },
    async signOut() { renewal = null; if (token) await call('/api/session/end', { method: 'POST' }).catch(() => {}); token = null; },
    get signedIn() { return token !== null; },
  });
}
