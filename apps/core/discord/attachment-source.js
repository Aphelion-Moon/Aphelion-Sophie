import { isIPv4 } from 'node:net';
import { attachmentUrl, attachmentTypes } from '../../../contracts/case-attachment.js';
import { ContractError, requireCondition, requireInteger } from '../../../contracts/validation.js';

/** Pin the connection to a validated A record; TLS still verifies cdn.discordapp.com. */
export function publicCdnLookup(lookup) {
  requireCondition(typeof lookup === 'function', 'TRUSTED_ADAPTERS_REQUIRED');
  return (hostname, options, callback) => {
    if (hostname !== 'cdn.discordapp.com') { callback(new ContractError('ATTACHMENT_REFERENCE_INVALID')); return; }
    lookup(hostname, { family: 4, all: true, verbatim: true }, (error, addresses) => {
      const valid = address => {
        if (!isIPv4(address)) return false;
        const [a, b, c] = address.split('.').map(Number);
        return !(a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127) ||
          (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) ||
          (a === 192 && b === 0) || (a === 192 && b === 88 && c === 99) || (a === 198 && [18, 19, 51].includes(b)) ||
          (a === 203 && b === 0 && c === 113));
      };
      if (error || !Array.isArray(addresses) || !addresses.length || addresses.some(item => item.family !== 4 || !valid(item.address))) {
        callback(new ContractError('ATTACHMENT_NETWORK_UNAVAILABLE')); return;
      }
      const selected = addresses[0];
      if (options?.all) callback(null, [selected]); else callback(null, selected.address, 4);
    });
  };
}

/** Inject native https.request and dns.lookup in core. No token, cookies, proxy or redirect support. */
export function createAttachmentSource({ request, lookup, enabled }) {
  requireCondition(typeof request === 'function' && typeof enabled === 'function', 'TRUSTED_ADAPTERS_REQUIRED');
  const resolve = publicCdnLookup(lookup);
  return Object.freeze({
    async acquire(reference, timeoutMs, consume) {
      requireCondition(await enabled() === true, 'ATTACHMENT_POLICY_DISABLED');
      const url = attachmentUrl(reference.url, reference.channelId, reference.attachmentId);
      requireInteger(reference.size, 1, 33554432); requireInteger(timeoutMs, 1000, 30000);
      requireCondition(attachmentTypes.includes(reference.type), 'ATTACHMENT_TYPE_DENIED');
      requireCondition(typeof consume === 'function', 'TRUSTED_ADAPTERS_REQUIRED');
      let connection, response;
      const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), timeoutMs);
      try {
        response = await new Promise((accept, reject) => {
          connection = request(url, { method: 'GET', agent: false, family: 4, lookup: resolve, signal: controller.signal,
            maxHeaderSize: 16384, headers: { 'User-Agent': 'Sophie/0.1.0', 'Accept-Encoding': 'identity', Accept: reference.type } }, accept);
          connection.on('error', reject); connection.end();
        });
        if ([403, 404, 410].includes(response.statusCode)) throw new ContractError('ATTACHMENT_SOURCE_UNAVAILABLE');
        if (response.statusCode === 429) {
          const retry = response.headers['retry-after'];
          requireCondition(typeof retry === 'string' && /^[0-9]+(?:\.[0-9]+)?$/.test(retry) && Number(retry) > 0 && Number(retry) <= 86400, 'ATTACHMENT_RATE_LIMIT_INVALID');
          const error = new ContractError('ATTACHMENT_RATE_LIMITED'); error.retryAfterMs = Math.ceil(Number(retry) * 1000); throw error;
        }
        if (response.statusCode >= 500) throw new ContractError('ATTACHMENT_NETWORK_UNAVAILABLE');
        requireCondition(response.statusCode === 200, 'ATTACHMENT_RESPONSE_INVALID');
        const length = response.headers['content-length'], encoding = response.headers['content-encoding'];
        requireCondition(length === undefined || (/^[0-9]+$/.test(length) && Number(length) === reference.size), 'ATTACHMENT_RESPONSE_INVALID');
        requireCondition(encoding === undefined || encoding === 'identity', 'ATTACHMENT_RESPONSE_INVALID');
        requireCondition(typeof response.headers['content-type'] === 'string' &&
          response.headers['content-type'].split(';')[0].trim().toLowerCase() === reference.type, 'ATTACHMENT_RESPONSE_INVALID');
        return await consume(response);
      } catch (error) {
        if (error instanceof ContractError) throw error;
        throw new ContractError('ATTACHMENT_NETWORK_UNAVAILABLE');
      } finally { clearTimeout(timeout); controller.abort(); response?.destroy(); connection?.destroy(); }
    },
  });
}
