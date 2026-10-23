/** Thrown with the server's fixed outcome word ('closed', 'stale', 'signin', …) or 'offline'. */
export class ShuttleApiError extends Error {
  constructor(word, status) { super(word); this.word = word; this.status = status; }
}

const RETRY_MS = Object.freeze([1_000, 2_000, 4_000]);

/**
 * The Activity's calls to core (P43). The bearer token from sign-in lives only in this closure. A click keeps one
 * request key through its retries, so a retried Continue never moves the run twice.
 */
export function createShuttleApi({ fetch, randomBytes, wait = ms => new Promise(resolve => setTimeout(resolve, ms)), onSignal = () => {} }) {
  let token = null;
  const requestId = () => [...randomBytes(16)].map(byte => byte.toString(16).padStart(2, '0')).join('');
  async function call(path, { method = 'GET', body } = {}) {
    for (let attempt = 0; ; attempt++) {
      let response = null;
      try {
        response = await fetch(path, { method, cache: 'no-store', credentials: 'omit',
          headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
          ...(body ? { body: JSON.stringify(body) } : {}) });
      } catch { response = null; }
      if (response && response.status !== 503) {
        onSignal(true);
        const value = response.status === 204 ? null : await response.json().catch(() => null);
        if (response.ok) return value;
        throw new ShuttleApiError(typeof value?.error === 'string' ? value.error : 'failed', response.status);
      }
      onSignal(false);
      if (attempt >= RETRY_MS.length) throw new ShuttleApiError(response ? 'retry' : 'offline', response?.status ?? 0);
      await wait(RETRY_MS[attempt]);
    }
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
    async signOut() { if (token) await call('/api/session/end', { method: 'POST' }).catch(() => {}); token = null; },
    get signedIn() { return token !== null; },
  });
}
