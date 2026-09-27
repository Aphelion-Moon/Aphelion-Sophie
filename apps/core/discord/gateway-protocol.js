import { requireCondition, requireInteger, requireRecord } from '../../../contracts/validation.js';
import { validateGatewayUrl } from '../../../contracts/gateway.js';

/** Narrow metadata projection; never return the raw discovery response. */
export function gatewayDiscovery(raw) {
  requireRecord(raw, 'GATEWAY_DISCOVERY_INVALID'); validateGatewayUrl(raw.url);
  requireCondition(raw.shards === 1, 'GATEWAY_SHARDING_UNSUPPORTED');
  const limit = raw.session_start_limit; requireRecord(limit, 'GATEWAY_DISCOVERY_INVALID');
  requireInteger(limit.total, 1, 1_000_000); requireInteger(limit.remaining, 0, limit.total);
  requireInteger(limit.reset_after, 0, 86_400_000); requireInteger(limit.max_concurrency, 1, 1_000_000);
  return { url: raw.url, remaining: limit.remaining, resetAfterMs: limit.reset_after };
}

export function gatewayWireUrl(value) {
  validateGatewayUrl(value);
  const url = new URL(value); url.search = '?v=10&encoding=json'; return url.href;
}

/** The native client assembles frames first; this bounds application parsing, not its allocation. */
export function parseGatewayFrame(data) {
  requireCondition(typeof data === 'string' && Buffer.byteLength(data, 'utf8') <= 1_048_576, 'GATEWAY_PAYLOAD_INVALID');
  let value;
  try { value = JSON.parse(data); } catch { requireCondition(false, 'GATEWAY_PAYLOAD_INVALID'); }
  requireRecord(value, 'GATEWAY_PAYLOAD_INVALID');
  requireCondition([0, 1, 7, 9, 10, 11].includes(value.op), 'GATEWAY_PAYLOAD_INVALID');
  if (value.op === 0) requireInteger(value.s);
  if (value.op === 9) requireCondition(typeof value.d === 'boolean', 'GATEWAY_PAYLOAD_INVALID');
  if (value.op === 10) requireInteger(value.d?.heartbeat_interval, 1_000, 60_000);
  return value;
}

export function gatewayClosePolicy(code) {
  if ([4001, 4002, 4003, 4004, 4005, 4010, 4011, 4012, 4013, 4014].includes(code) ||
      (code >= 4000 && ![4000, 4007, 4008, 4009].includes(code))) {
    return { code: 'GATEWAY_CONFIGURATION_REJECTED', fatal: true, resume: false, waitMs: 0 };
  }
  return { code: code === 4008 ? 'GATEWAY_RATE_LIMITED' : 'GATEWAY_DISCONNECTED', fatal: false,
    resume: ![1000, 1001, 4007, 4009].includes(code), waitMs: code === 4008 ? 60_000 : 0 };
}
