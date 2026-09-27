/** Stable errors contain codes, never arbitrary case content or credentials. */
export class ContractError extends Error {
  constructor(code) {
    super(code);
    this.name = 'ContractError';
    this.code = code;
  }
}

export function requireCondition(condition, code) {
  if (!condition) throw new ContractError(code);
}

export function requireRecord(value, code = 'INVALID_RECORD') {
  requireCondition(value !== null && typeof value === 'object' && !Array.isArray(value), code);
}

export function requireKeys(value, keys, code = 'INVALID_FIELDS') {
  requireRecord(value, code);
  requireCondition(Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key)), code);
}

export function requireId(value) {
  requireCondition(typeof value === 'string' && /^[1-9][0-9]{0,19}$/.test(value), 'INVALID_DISCORD_ID');
}

export function requireName(value) {
  requireCondition(typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,95}$/.test(value), 'INVALID_IDENTIFIER');
}

export function requireInteger(value, min = 0, max = Number.MAX_SAFE_INTEGER) {
  requireCondition(Number.isSafeInteger(value) && value >= min && value <= max, 'INVALID_INTEGER');
}

/** Pure policy consumes adapter-verified observations, never HTTP request bodies. */
export function requireFreshObservation(observation, now) {
  requireRecord(observation);
  requireInteger(now);
  requireInteger(observation.observedAt);
  requireCondition(observation.known === true, 'MEMBERSHIP_UNKNOWN');
  // A conservative development bound; production must validate its observation contract.
  requireCondition(observation.observedAt <= now && now - observation.observedAt <= 5_000, 'MEMBERSHIP_STALE');
}
