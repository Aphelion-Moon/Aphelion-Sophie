import { requireCondition, requireInteger, requireKeys } from '../../contracts/validation.js';

export const DEFAULT_AI_BUDGET = Object.freeze({ monthlyLimitNanos: '20000000000', dailyLimitNanos: null,
  timezone: 'Europe/Vienna', dailyAttempts: 2000, maxUnresolved: 4, priceRevision: 'deepseek-flash-2026-09-28',
  priceValidUntil: null, hitNanos: 6, missNanos: 300, outputNanos: 1200 });

export function canonicalAiBudget(value) {
  requireKeys(value, Object.keys(DEFAULT_AI_BUDGET), 'AI_BUDGET_INVALID');
  for (const key of ['monthlyLimitNanos', 'dailyLimitNanos']) {
    if (key === 'dailyLimitNanos' && value[key] === null) continue;
    requireCondition(typeof value[key] === 'string' && /^[1-9][0-9]{0,12}$/.test(value[key]), 'AI_BUDGET_INVALID');
  }
  requireCondition(value.timezone === 'Europe/Vienna', 'AI_BUDGET_TIMEZONE_INVALID');
  requireInteger(value.dailyAttempts, 1, 2000); requireInteger(value.maxUnresolved, 1, 4);
  requireCondition(typeof value.priceRevision === 'string' && /^[a-zA-Z0-9._-]{1,96}$/.test(value.priceRevision), 'AI_PRICE_INVALID');
  if (value.priceValidUntil !== null) requireInteger(value.priceValidUntil);
  for (const key of ['hitNanos', 'missNanos', 'outputNanos']) requireInteger(value[key], 1, 1000000);
  requireCondition(value.hitNanos <= value.missNanos, 'AI_PRICE_INVALID');
  return Object.freeze({ ...value });
}

const calendar = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Vienna', year: 'numeric', month: '2-digit', day: '2-digit' });
export function aiBudgetPeriods(milliseconds) {
  requireInteger(milliseconds);
  const parts = Object.fromEntries(calendar.formatToParts(milliseconds).map(part => [part.type, part.value]));
  return { month: `${parts.year}-${parts.month}`, day: `${parts.year}-${parts.month}-${parts.day}` };
}

export function aiReservationNanos({ bytes, outputTokens }, policy) {
  requireInteger(bytes, 1, 32768); requireInteger(outputTokens, 1, 512);
  // Conservative estimate, not an exact tokenizer/framing guarantee. Overruns hold new admission.
  return BigInt(bytes + 1024) * BigInt(policy.missNanos) + BigInt(outputTokens) * BigInt(policy.outputNanos);
}

export function aiUsageCostNanos(usage, policy) {
  if (!usage) return null;
  for (const key of ['prompt_tokens', 'completion_tokens', 'total_tokens', 'prompt_cache_hit_tokens', 'prompt_cache_miss_tokens']) {
    if (!Number.isSafeInteger(usage[key]) || usage[key] < 0 || usage[key] > 2000000) return null;
  }
  if (usage.prompt_tokens + usage.completion_tokens !== usage.total_tokens ||
    usage.prompt_cache_hit_tokens + usage.prompt_cache_miss_tokens !== usage.prompt_tokens) return null;
  // Peak accounting deliberately overestimates off-peak/holiday bills until the calendar is qualified.
  return BigInt(usage.prompt_cache_hit_tokens) * BigInt(policy.hitNanos) + BigInt(usage.prompt_cache_miss_tokens) * BigInt(policy.missNanos) +
    BigInt(usage.completion_tokens) * BigInt(policy.outputNanos);
}
