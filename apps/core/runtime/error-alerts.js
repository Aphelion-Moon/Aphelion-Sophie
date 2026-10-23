import { randomBytes } from 'node:crypto';
import { requireCondition, requireId } from '../../../contracts/validation.js';
import { roleByName } from '../../../modules/onboarding/activity-post.js';

// Routine outcomes that come through the fault channel: AI turns skipped, admitted or delivered, members refused at the
// dashboard, state hydrated, work deferred. Never alerted.
const ROUTINE = /^(AI_ADMISSION_SKIPPED_|AI_TURN_ADMITTED_|AI_TURN_DELIVERED_|AI_GUILD_STATE_HYDRATED|DASHBOARD_DENIED_|AI_EFFECT_CHECK_DEFERRED|AI_EXPIRY_DEFERRED)/u;
// What makes a code an error.
const ERROR = /(UNAVAILABLE|FAILED|FAULT|UNCERTAIN|RELAUNCHED|SILENT|INVALID|TIMEOUT|MISMATCH|REFUSED)/u;
const CODE = /^[A-Z][A-Z0-9_]{2,63}$/u;
/** Whether a fault code is an error worth a ping, not a routine trace. */
export function alertable(code) { return typeof code === 'string' && CODE.test(code) && !ROUTINE.test(code) && ERROR.test(code); }

/**
 * Sophie's errors in a Discord channel (owner request, 24 October 2026: "Sophie's errors should output to a channel … and
 * should ping me @matriarch"). Only the fault code goes out: never a message, ID, member or payload, as in the log. Each
 * code alerts at most once per cooldown (6 hours for the background knowledge sync, which fails in runs), with how many
 * times it happened since; at most hourlyCap alerts an hour; the role is pinged at most once per pingCooldownMs. The role
 * is found by name in the server (roleByName), looked up again at most hourly. Posting never throws and never reports
 * its own failure, so an alert cannot loop.
 */
export function createErrorAlerts({ transport, channelId, roleName, clock, cooldownMs = 30 * 60_000, knowledgeCooldownMs = 6 * 3_600_000,
  hourlyCap = 12, pingCooldownMs = 30 * 60_000, nonce = () => randomBytes(12).toString('hex') }) {
  requireId(channelId);
  requireCondition(typeof roleName === 'string' && /^[A-Za-z0-9 _-]{1,100}$/u.test(roleName) && typeof clock === 'function' &&
    typeof transport?.createErrorAlert === 'function' && typeof transport.getRoles === 'function', 'TRUSTED_ADAPTERS_REQUIRED');
  const codes = new Map(), sent = [];
  let lastPing = -Infinity, role = { id: null, at: -Infinity }, sending = Promise.resolve();
  async function roleId(now) {
    if (now - role.at < 3_600_000) return role.id;
    role = { id: roleByName(await transport.getRoles(), roleName)?.id ?? null, at: now };
    return role.id;
  }
  async function send(code, count, since) {
    const now = clock();
    const id = now - lastPing >= pingCooldownMs ? await roleId(now).catch(() => null) : null;
    const times = count > 1 ? ` ×${count} since <t:${Math.floor(since / 1000)}:R>` : '';
    const content = `**Sophie error** \`${code}\`${times}${id ? `\n<@&${id}>` : ''}`;
    await transport.createErrorAlert(channelId, nonce(), { content, allowed_mentions: { parse: [], users: [], roles: id ? [id] : [], replied_user: false } });
    if (id) lastPing = now;
  }
  return Object.freeze({
    /** Counts a fault code, and posts an alert when it is an error and its cooldown has passed. Never throws. */
    report(code) {
      try {
        if (!alertable(code)) return;
        const now = clock(), wait = code.startsWith('KNOWLEDGE_') ? knowledgeCooldownMs : cooldownMs;
        const seen = codes.get(code) ?? { count: 0, since: now, last: -Infinity };
        seen.count++;
        if (codes.size >= 200 && !codes.has(code)) return;
        codes.set(code, seen);
        while (sent.length && now - sent[0] >= 3_600_000) sent.shift();
        if (now - seen.last < wait || sent.length >= hourlyCap) return;
        const { count, since } = seen;
        seen.last = now; seen.count = 0; seen.since = now; sent.push(now);
        sending = sending.then(() => send(code, count, since)).catch(() => {});
      } catch { /* An alert never affects the runtime. */ }
    },
    /** Resolves once queued alerts have been attempted (for shutdown and tests). */
    settled: () => sending,
  });
}
