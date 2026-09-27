import { ContractError, requireCondition, requireId, requireInteger } from '../../../contracts/validation.js';
import { validateRoleMapping } from '../../../modules/membership/discord-policy.js';
import { projectGatewayDispatch } from './gateway-projection.js';

/** Core socket supervisor owns this interface. It is never an HTTP/component handler. */
export function createGatewayObserver({ journal, mapping, applicationId, clock, capacity = 64 }) {
  validateRoleMapping(mapping); requireId(applicationId); requireInteger(capacity, 1, 256);
  requireCondition(typeof clock === 'function', 'TRUSTED_ADAPTERS_REQUIRED');
  const configuration = { ...structuredClone(mapping), applicationId };
  let lease = null, connection = null, sessionId = null, revision = 0;
  let pending = 0, failed = true, acknowledgedAt = null, healthyUntil = 0;
  let tail = Promise.resolve();
  const own = value => requireCondition(value === connection && connection !== null, 'GATEWAY_CONNECTION_STALE');
  const healthy = () => !failed && pending === 0 && acknowledgedAt !== null && clock() >= acknowledgedAt && clock() < healthyUntil;
  async function stop(code) {
    failed = true; revision++; acknowledgedAt = null;
    await tail;
    if (lease) await journal.pause(lease, code);
  }
  async function begin(resume) {
    requireCondition(lease !== null, 'GATEWAY_NOT_ACQUIRED');
    await stop('DISCONNECTED');
    const previous = resume ? await journal.resume(lease) : (await journal.identify(lease), null);
    connection = Object.freeze({}); sessionId = previous?.sessionId ?? null;
    failed = false; revision++;
    return { connection, resume: previous };
  }
  async function readContinuity() {
    if (!healthy() || lease === null) return null;
    const version = revision;
    const persisted = await journal.readContinuity(lease);
    return healthy() && version === revision && persisted !== null ? `${persisted}.${revision}` : null;
  }
  return Object.freeze({
    intents: 3 + (journal.messageIntents ?? 0),
    async acquire(owner) {
      requireCondition(lease === null, 'GATEWAY_ALREADY_ACQUIRED');
      const result = await journal.acquire(owner); lease = result.lease;
      return { resumable: result.resume !== null };
    },
    beginIdentify: () => begin(false),
    beginResume: () => begin(true),
    readContinuity,
    async isCurrent() { return await readContinuity() !== null; },
    async renew() { requireCondition(lease !== null, 'GATEWAY_NOT_ACQUIRED'); await journal.renew(lease); },
    async reserveIdentify() { requireCondition(lease !== null, 'GATEWAY_NOT_ACQUIRED'); return journal.reserveIdentify(lease); },
    heartbeatAcknowledged(handle, validForMs) {
      own(handle); requireInteger(validForMs, 1_000, 120_000);
      requireCondition(!failed, 'GATEWAY_PROCESSING_FAILED');
      acknowledgedAt = clock(); requireInteger(acknowledgedAt); healthyUntil = acknowledgedAt + validForMs;
    },
    async pause(handle, code = 'DISCONNECTED') { own(handle); await stop(code); return { resumable: sessionId !== null }; },
    accept(handle, payload) {
      own(handle);
      requireCondition(!failed, 'GATEWAY_PROCESSING_FAILED');
      revision++;
      let projected, caseMessage = null, automationMessage = null;
      try {
        requireCondition(pending < capacity, 'GATEWAY_QUEUE_LIMIT');
        projected = projectGatewayDispatch(payload, configuration, clock());
        caseMessage = journal.prepareCaseMessage?.(payload) ?? null;
        automationMessage = journal.prepareAutomationMessage?.(payload) ?? null;
      } catch (error) {
        const paused = stop(error.code === 'GATEWAY_QUEUE_LIMIT' ? 'QUEUE_LIMIT' : 'PROCESSING_FAILED');
        return paused.then(() => { throw new ContractError('GATEWAY_PROCESSING_FAILED'); }, () => { throw new ContractError('GATEWAY_PROCESSING_FAILED'); });
      }
      pending++;
      const work = tail.then(async () => {
        requireCondition(!failed && handle === connection, 'GATEWAY_PROCESSING_FAILED');
        if (projected.ready) {
          requireCondition(sessionId === null, 'GATEWAY_STATE_CONFLICT');
          await journal.ready(lease, { ...projected.ready, sequence: projected.sequence });
          sessionId = projected.ready.sessionId;
          return { duplicate: false };
        }
        requireCondition(sessionId !== null, 'GATEWAY_STATE_CONFLICT');
        return journal.dispatch(lease, { sessionId, ...projected, caseMessage, automationMessage });
      }).catch(async () => {
        failed = true; revision++; acknowledgedAt = null;
        try { await journal.pause(lease, 'PROCESSING_FAILED'); } catch { /* Local delivery remains disabled if storage is unavailable. */ }
        throw new ContractError('GATEWAY_PROCESSING_FAILED');
      }).finally(() => { pending--; });
      tail = work.then(() => undefined, () => undefined);
      return work;
    },
  });
}
