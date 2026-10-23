import { requireCondition, requireId, requireKeys } from '../../../contracts/validation.js';
import { validateOverwrites } from '../../../platform/authorization/discord-permissions.js';
import { requireScreenId, validateOnboardingPart } from '../../../modules/onboarding/screens.js';
import { validateOnboardingAlertPayload } from '../../../modules/onboarding/alerts.js';
import { validateCaseIntakePayload } from '../../../modules/tickets/intake-messages.js';
import { requireReplyId, validateCaseReplyPayload } from '../../../modules/tickets/replies.js';
import { stagingRolePayload, stagingChannelPayload } from './staging-resources.js';
import { ticketDirectNotice } from '../../../modules/tickets/direct-notice.js';
import { automationPayload, automationEmoji } from '../../../modules/automation/delivery.js';
import { validateAiMessagePayload } from '../../../modules/assistant/output.js';
import { validateSophiePanel } from '../../../modules/assistant/member-panel.js';
import { AI_DEADLINE_MS } from '../../../modules/assistant/participation.js';
import { contactStaffControl } from '../../../modules/tickets/intake.js';
import { shuttleChannelName } from '../../../modules/tickets/channel-policy.js';

/** Stable errors never retain tokens, URLs, response bodies or the original fetch error. */
export class DiscordError extends Error {
  constructor(code, retryAfterMs = 0) {
    super(code);
    this.name = 'DiscordError'; this.code = code; this.retryAfterMs = retryAfterMs;
  }
}

async function boundedJson(response) {
  const max = 512 * 1024;
  if (Number(response.headers.get('content-length')) > max) throw new DiscordError('DISCORD_RESPONSE_INVALID');
  const reader = response.body?.getReader();
  if (!reader) throw new DiscordError('DISCORD_RESPONSE_INVALID');
  const parts = []; let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > max) throw new DiscordError('DISCORD_RESPONSE_INVALID');
      parts.push(value);
    }
    return JSON.parse(Buffer.concat(parts).toString('utf8'));
  } catch { throw new DiscordError('DISCORD_RESPONSE_INVALID'); }
  finally { await reader.cancel().catch(() => {}); }
}

function delayMs(value) {
  if (typeof value !== 'string' && typeof value !== 'number') return 0;
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds < 0 || seconds > 86_400) return 0;
  return Math.ceil(seconds * 1_000);
}

/**
 * Discord limits belong to the bot token, not to one transport. Every transport built for the same token must share one
 * registry, or each lane spends a bucket the others already emptied and earns real 429s. Holds timings only: no ids
 * beyond a route's major parameter, no token and no response content.
 */
export function createDiscordRateLimits() {
  return Object.seal({ cooldowns: new Map(), buckets: new Map(), globalUntil: 0, invalid: false });
}

const SHORT_WAIT_MS = 1_500;
const MAX_TRACKED = 2_000;

/** Discord buckets a route by its template and major parameter (channel, guild or webhook), never by other ids or the query. */
function limitKey(limits, method, path) {
  const bare = path.split('?')[0];
  const major = /^\/(?:channels|guilds|webhooks)\/(\d+)/.exec(bare)?.[1] ?? '';
  const template = `${method} ${bare.replace(/\/\d+(?=\/|$)/g, '/:id')}`;
  return { template, major, key: `${limits.buckets.get(template) ?? template}|${major}` };
}

function forgetExpired(cooldowns, now) {
  if (cooldowns.size < MAX_TRACKED) return;
  for (const [key, until] of cooldowns) if (until <= now) cooldowns.delete(key);
}

/** Fixed Discord routes. No default fetch, environment-token lookup or live activation. */
// Production, Activity and AI only (owner decision, 23 October 2026): the writes Sophie may make in a guild whose roles and
// channels another bot owns. Her own messages, reactions and typing; a DM to a member who asked; her guild commands.
// Every other write (roles, member roles, channels, permissions, nicknames, bans) is refused before it leaves.
const ACTIVITY_AI_WRITES = Object.freeze([
  ['POST', /^\/channels\/\d{17,20}\/messages$/u], ['PATCH', /^\/channels\/\d{17,20}\/messages\/\d{17,20}$/u], ['DELETE', /^\/channels\/\d{17,20}\/messages\/\d{17,20}$/u],
  ['PUT', /^\/channels\/\d{17,20}\/messages\/\d{17,20}\/reactions\/[^/]{1,200}\/@me$/u], ['DELETE', /^\/channels\/\d{17,20}\/messages\/\d{17,20}\/reactions\/[^/]{1,200}\/@me$/u],
  ['POST', /^\/channels\/\d{17,20}\/typing$/u], ['POST', /^\/users\/@me\/channels$/u],
  ['POST', /^\/applications\/\d{17,20}\/guilds\/\d{17,20}\/commands$/u],
]);
/**
 * Owner decision, 24 October 2026: Sophie grants Whitelist at the end of the Shuttle in production too. A transport may be
 * given the roles it may *add* (only Whitelist, in the administration lane); removing any role, and adding any other, stays
 * refused.
 */
const MEMBER_ROLE_ADD = /^\/guilds\/\d{17,20}\/members\/\d{17,20}\/roles\/(\d{17,20})$/u;
export const activityAiWriteAllowed = (method, path, grantRoleIds = []) => method === 'GET' || ACTIVITY_AI_WRITES.some(([verb, pattern]) => verb === method && pattern.test(path)) ||
  method === 'PUT' && grantRoleIds.includes(MEMBER_ROLE_ADD.exec(path)?.[1]);

export function createDiscordTransport({ guildId, token, fetch, clock, enabled, limits = createDiscordRateLimits(),
  wait = ms => new Promise(resolve => setTimeout(resolve, ms)), scope = 'full', grantRoleIds = [] }) {
  requireId(guildId); requireCondition(['full', 'activity-ai'].includes(scope), 'TRUSTED_ADAPTERS_REQUIRED');
  requireCondition(Array.isArray(grantRoleIds) && grantRoleIds.length <= 1 && grantRoleIds.every(id => /^[1-9][0-9]{16,19}$/u.test(id) && id !== guildId), 'TRUSTED_ADAPTERS_REQUIRED');
  requireCondition(typeof token === 'string' && token.length >= 20 && !/\s/.test(token), 'DISCORD_TOKEN_REQUIRED');
  requireCondition(typeof fetch === 'function' && typeof clock === 'function' && typeof enabled === 'function' && typeof wait === 'function', 'TRUSTED_ADAPTERS_REQUIRED');
  requireCondition(limits?.cooldowns instanceof Map && limits.buckets instanceof Map, 'TRUSTED_ADAPTERS_REQUIRED');
  // Requests stay serial per transport, but a caller queues briefly behind the one in flight instead of failing at once:
  // a failed outbox step re-runs all of its reads, spends an attempt and backs off exponentially.
  // Reads (GET) queue per rate-limit bucket instead, so independent reads (roles, a member, a channel) overlap rather than
  // each waiting a full round trip; reads of one bucket and all writes stay in order.
  let tail = Promise.resolve(), sent = 0;
  const readTails = new Map();
  async function turn(budgetMs, readKey = null) {
    const previous = readKey === null ? tail : readTails.get(readKey) ?? Promise.resolve(); let release;
    const mine = new Promise(resolve => { release = resolve; });
    const next = previous.then(() => mine);
    if (readKey === null) tail = next;
    else { readTails.set(readKey, next); void next.then(() => { if (readTails.get(readKey) === next) readTails.delete(readKey); }); }
    let timer;
    const ready = await Promise.race([previous.then(() => true),
      new Promise(resolve => { timer = setTimeout(() => resolve(false), budgetMs); })]);
    clearTimeout(timer);
    if (!ready) { release(); throw new DiscordError('DISCORD_BUSY', 250); }
    return release;
  }
  const blockedFor = key => Math.max(limits.globalUntil, limits.cooldowns.get(key) ?? 0) - clock();
  async function request(method, path, route, body = undefined, jsonResult = false, deadline = null) {
    if (scope === 'activity-ai') requireCondition(activityAiWriteAllowed(method, path.split('?')[0], grantRoleIds), 'DISCORD_SCOPE_REFUSED');
    const budget = () => Math.min(SHORT_WAIT_MS, deadline === null ? SHORT_WAIT_MS : deadline - clock() - 250);
    const release = await turn(Math.max(1, budget()), method === 'GET' ? limitKey(limits, method, path).key : null);
    try {
      // Checked after queueing, so the gate is current when the request leaves.
      requireCondition(await enabled() === true, 'DISCORD_TRANSPORT_DISABLED');
      if (limits.invalid) throw new DiscordError('DISCORD_RATE_LIMIT_INVALID');
      // A short cooldown is waited out once by a sleep that sends nothing; a long or repeated one fails as before.
      let remaining = blockedFor(limitKey(limits, method, path).key);
      if (remaining > 0 && remaining <= budget()) {
        await wait(Math.ceil(remaining));
        requireCondition(await enabled() === true, 'DISCORD_TRANSPORT_DISABLED');
        if (limits.invalid) throw new DiscordError('DISCORD_RATE_LIMIT_INVALID');
        remaining = blockedFor(limitKey(limits, method, path).key);
      }
      if (remaining > 0) throw new DiscordError('RATE_LIMITED', Math.ceil(remaining));
      if (deadline !== null) requireCondition(Number.isSafeInteger(deadline) && deadline > clock() && deadline - clock() <= AI_DEADLINE_MS, 'AI_DEADLINE_EXPIRED');
      return await send(method, path, route, body, jsonResult, deadline);
    } finally { release(); }
  }
  async function send(method, path, route, body, jsonResult, deadline) {
    const { template } = limitKey(limits, method, path);
    sent++;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), deadline === null ? 5_000 : Math.max(1, Math.min(5_000, deadline - clock())));
    const write = method !== 'GET';
    let response;
    try {
      response = await fetch(`https://discord.com/api/v10${path}`, {
        method, redirect: 'error', signal: controller.signal,
        headers: { Authorization: `Bot ${token}`, 'User-Agent': 'Sophie/0.1.0',
          ...(write ? { 'X-Audit-Log-Reason': 'Sophie%20verified%20administration' } : {}),
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      if (response.status >= 300 && response.status < 400) throw new DiscordError('DISCORD_RESPONSE_INVALID');
      const bucket = response.headers.get('x-ratelimit-bucket');
      if (typeof bucket === 'string' && /^[A-Za-z0-9:_-]{1,64}$/.test(bucket) && (limits.buckets.has(template) || limits.buckets.size < MAX_TRACKED)) {
        limits.buckets.set(template, bucket);
      }
      const { key } = limitKey(limits, method, path);
      forgetExpired(limits.cooldowns, clock());
      if (response.headers.get('x-ratelimit-remaining') === '0') {
        // Reset-after is exact; only a missing value falls back to a conservative second.
        const delay = delayMs(response.headers.get('x-ratelimit-reset-after'));
        limits.cooldowns.set(key, Math.max(limits.cooldowns.get(key) ?? 0, clock() + (delay || 1_000)));
      }
      if (response.status === 429) {
        let data;
        try { data = await boundedJson(response); } catch { data = {}; }
        if (data === null || typeof data !== 'object' || Array.isArray(data)) data = {};
        const delay = Math.max(delayMs(response.headers.get('retry-after')), delayMs(data.retry_after));
        // An unbounded or unreadable limit cannot be guessed shorter. Halt this transport
        // for operator review instead of retrying early or feeding invalid-request limits.
        if (!delay || [response.headers.get('retry-after'), data.retry_after].some(value => Number(value) > 86_400)) {
          limits.invalid = true;
          throw new DiscordError('DISCORD_RATE_LIMIT_INVALID');
        }
        const retry = delay;
        if (data.global === true || response.headers.get('x-ratelimit-global') === 'true') limits.globalUntil = Math.max(limits.globalUntil, clock() + retry);
        limits.cooldowns.set(key, Math.max(limits.cooldowns.get(key) ?? 0, clock() + retry));
        throw new DiscordError('RATE_LIMITED', retry);
      }
      if ([400, 403].includes(response.status) && ['ticket-dm-open', 'ticket-dm-send'].includes(route)) {
        const data = await boundedJson(response);
        if ([50007, 50278].includes(data?.code)) throw new DiscordError('CASE_DM_BLOCKED');
        throw new DiscordError('DISCORD_AUTHORIZATION_FAILED');
      }
      if (response.status === 401 || response.status === 403) throw new DiscordError('DISCORD_AUTHORIZATION_FAILED');
      if (response.status === 400 && ['automation-create','automation-react'].includes(route)) throw new DiscordError('AUTOMATION_ACTION_REJECTED');
      if (response.status === 404) {
        const data = await boundedJson(response);
        if (route === 'onboarding-channel-delete' && data.code === 10003) return;
        if (['automation-delete','automation-unreact'].includes(route) && [10003,10008].includes(data.code)) return;
        if (!write && ['automation-source','automation-message'].includes(route) && [10003,10008].includes(data.code)) return null;
        if (!write && route === 'automation-emoji' && data.code === 10014) return null;
        if (!write && route === 'member' && data.code === 10007) return null;
        if (!write && route === 'channel' && data.code === 10003) return null;
        // An Activity instance that has ended (or never existed) is simply absent.
        if (!write && route === 'activity-instance') return null;
        if (!write && ['shuttle-message', 'case-intake-message', 'case-reply-message'].includes(route) && data.code === 10008) return null;
        // A Shuttle message someone deleted is reported as missing, so its group can be posted again in order.
        if (route === 'shuttle-message-edit' && data.code === 10008) return null;
        if (route === 'shuttle-message-delete' && [10003, 10008].includes(data.code)) return null;
        throw new DiscordError('DISCORD_RESOURCE_MISSING');
      }
      if (response.status >= 500) throw new DiscordError(write ? 'DELIVERY_UNCERTAIN' : 'DISCORD_UNAVAILABLE');
      if (write) {
        const created = response.status === 201 && ['guild-command', 'staging-channel-create', 'channel-create'].includes(route);
        if (response.status !== (jsonResult ? 200 : 204) && !created) throw new DiscordError('DELIVERY_UNCERTAIN');
        if (jsonResult) return await boundedJson(response);
        return;
      }
      if (response.status !== 200) throw new DiscordError('DISCORD_RESPONSE_INVALID');
      return await boundedJson(response);
    } catch (error) {
      if (error instanceof DiscordError) throw error;
      throw new DiscordError(write ? 'DELIVERY_UNCERTAIN' : 'DISCORD_UNAVAILABLE');
    } finally { controller.abort(); clearTimeout(timeout); await response?.body?.cancel().catch(() => {}); }
  }
  return Object.freeze({
    guildId,
    async getAiSourceMetadata(channelId, messageId) {
      requireId(channelId); requireId(messageId);
      const raw = await request('GET', `/channels/${channelId}/messages/${messageId}`, 'automation-source');
      if (raw === null) return null;
      return { id: raw.id, channelId: raw.channel_id, authorId: raw.author?.id, bot: raw.author?.bot === true,
        webhook: raw.webhook_id != null, type: raw.type, revision: raw.edited_timestamp ?? 'original' };
    },
    async createAiMessage(channelId, messageId, payload, deadline) {
      requireId(channelId); requireId(messageId); validateAiMessagePayload(payload);
      return request('POST', `/channels/${channelId}/messages`, 'automation-create', { ...payload,
        components: [contactStaffControl()],
        nonce: messageId, enforce_nonce: true, message_reference: { message_id: messageId, channel_id: channelId, fail_if_not_exists: true } }, true, deadline);
    },
    /** The member's own Sophie panel, sent to their DMs at their request. Fixed panel components only. */
    async createSophieDm(userId) {
      requireId(userId); return request('POST', '/users/@me/channels', 'sophie-dm-open', { recipient_id: userId }, true);
    },
    async sendSophieDm(dmChannelId, panel) {
      requireId(dmChannelId); validateSophiePanel(panel);
      return request('POST', `/channels/${dmChannelId}/messages`, 'sophie-dm-send', { ...panel, allowed_mentions: { parse: [] } }, true);
    },
    /** The static "Set up Sophie" invitation, sent privately by DM (never in the channel): only the panel button, no AI output. */
    async sendSophieInvitation(userId, invitation) {
      requireId(userId); validateSophiePanel(invitation);
      const channel = await request('POST', '/users/@me/channels', 'sophie-dm-open', { recipient_id: userId }, true);
      requireId(channel?.id);
      return request('POST', `/channels/${channel.id}/messages`, 'sophie-dm-send', { ...invitation, allowed_mentions: { parse: [] } }, true);
    },
    async indicateAiTyping(channelId, deadline) {
      requireId(channelId);
      return request('POST', `/channels/${channelId}/typing`, 'ai-typing', undefined, false, deadline);
    },
    async createAiReaction(channelId, messageId, emoji, deadline) {
      requireId(channelId); requireId(messageId);
      return request('PUT', `/channels/${channelId}/messages/${messageId}/reactions/${encodeURIComponent(automationEmoji({ kind: 'reaction', emoji: { id: emoji.id, name: emoji.name } }))}/@me`, 'automation-react', undefined, false, deadline);
    },
    async getAutomationSource(channelId, messageId) {
      requireId(channelId); requireId(messageId);
      const raw = await request('GET', `/channels/${channelId}/messages/${messageId}`, 'automation-source');
      if (raw === null) return null;
      return { id: raw.id, channelId: raw.channel_id, authorId: raw.author?.id, bot: raw.author?.bot === true,
        webhook: raw.webhook_id !== undefined, interaction: raw.interaction_metadata !== undefined || raw.interaction !== undefined,
        type: raw.type, reactions: Array.isArray(raw.reactions) ? raw.reactions.map(item=>({me:item.me,emoji:{id:item.emoji?.id,name:item.emoji?.name}})) : [] };
    },
    async getAutomationMessage(channelId, messageId) {
      requireId(channelId); requireId(messageId);
      return request('GET', `/channels/${channelId}/messages/${messageId}`, 'automation-message');
    },
    async getAutomationEmoji(emojiId) {
      requireId(emojiId); return request('GET', `/guilds/${guildId}/emojis/${emojiId}`, 'automation-emoji');
    },
    async createAutomationMessage(channelId, id, action) {
      requireId(channelId);
      return request('POST', `/channels/${channelId}/messages`, 'automation-create',
        {...automationPayload(id,action),nonce:id.slice(0,24),enforce_nonce:true},true);
    },
    async deleteAutomationMessage(channelId, messageId) {
      requireId(channelId); requireId(messageId);
      return request('DELETE', `/channels/${channelId}/messages/${messageId}`, 'automation-delete');
    },
    async createAutomationReaction(channelId, messageId, action) {
      requireId(channelId); requireId(messageId);
      return request('PUT', `/channels/${channelId}/messages/${messageId}/reactions/${encodeURIComponent(automationEmoji(action))}/@me`, 'automation-react');
    },
    async deleteAutomationReaction(channelId, messageId, action) {
      requireId(channelId); requireId(messageId);
      return request('DELETE', `/channels/${channelId}/messages/${messageId}/reactions/${encodeURIComponent(automationEmoji(action))}/@me`, 'automation-unreact');
    },
    async createTicketDm(userId) {
      requireId(userId); return request('POST', '/users/@me/channels', 'ticket-dm-open', { recipient_id: userId }, true);
    },
    async sendTicketDm(dmChannelId, channelId, nonce, text) {
      requireId(dmChannelId); requireId(channelId);
      requireCondition(typeof nonce === 'string' && /^[a-f0-9]{24}$/.test(nonce), 'CASE_DM_UNTRUSTED');
      return request('POST', `/channels/${dmChannelId}/messages`, 'ticket-dm-send',
        { ...ticketDirectNotice(guildId, channelId, text), nonce, enforce_nonce: true }, true);
    },
    async getGatewayBot() { return request('GET', '/gateway/bot', 'gateway'); },
    async getCurrentUser() { return request('GET', '/users/@me', 'identity'); },
    async getCurrentApplication() { return request('GET', '/oauth2/applications/@me', 'application'); },
    async createStagingRole(key, marker) {
      return request('POST', `/guilds/${guildId}/roles`, 'staging-role-create', stagingRolePayload(key, marker), true);
    },
    async createStagingChannel(kind, marker, botUserId, roles) {
      return request('POST', `/guilds/${guildId}/channels`, 'staging-channel-create', stagingChannelPayload(kind, marker, guildId, botUserId, roles), true);
    },
    async upsertGuildCommand(applicationId, definition) {
      requireId(applicationId);
      requireCondition(definition?.type === 1 && ['whitelist', 'ticket', 'answer', 'lookup', 'sophie', 'mute', 'unmute'].includes(definition.name), 'COMMAND_REGISTRATION_INVALID');
      return request('POST', `/applications/${applicationId}/guilds/${guildId}/commands`, 'guild-command', definition, true);
    },
    async getGuild() { return request('GET', `/guilds/${guildId}`, 'guild'); },
    /** The guild with Discord's approximate member and presence counts (the Shuttle Activity's station board). */
    async getGuildCounts() { return request('GET', `/guilds/${guildId}?with_counts=true`, 'guild-counts'); },
    /** Where a running Activity instance was launched and who is in it (Shuttle Activity sign-in). */
    async getActivityInstance(applicationId, instanceId) {
      requireId(applicationId); requireCondition(typeof instanceId === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(instanceId), 'ACTIVITY_INSTANCE_INVALID');
      return request('GET', `/applications/${applicationId}/activity-instances/${instanceId}`, 'activity-instance');
    },
    async getGuildChannels() { return request('GET', `/guilds/${guildId}/channels`, 'guild-channels'); },
    async getChannel(channelId) { requireId(channelId); return request('GET', `/channels/${channelId}`, 'channel'); },
    async deleteOnboardingChannel(channelId) { requireId(channelId); return request('DELETE', `/channels/${channelId}`, 'onboarding-channel-delete', undefined, true); },
    async getThreadMember(channelId, userId) {
      requireId(channelId); requireId(userId);
      return request('GET', `/channels/${channelId}/thread-members/${userId}`, 'thread-member');
    },
    async getOnboardingMessage(channelId, messageId) {
      requireId(channelId); requireId(messageId);
      return request('GET', `/channels/${channelId}/messages/${messageId}`, 'shuttle-message');
    },
    async getOnboardingAlert(channelId, messageId) {
      requireId(channelId); requireId(messageId);
      return request('GET', `/channels/${channelId}/messages/${messageId}`, 'shuttle-message');
    },
    async getCaseIntakeMessage(channelId, messageId) {
      requireId(channelId); requireId(messageId);
      return request('GET', `/channels/${channelId}/messages/${messageId}`, 'case-intake-message');
    },
    async createCaseIntakeMessage(channelId, recordId, body) {
      requireId(channelId); validateCaseIntakePayload(body, recordId);
      return request('POST', `/channels/${channelId}/messages`, 'case-intake-create',
        { ...body, nonce: recordId.slice(0, 24), enforce_nonce: true }, true);
    },
    async getCaseReplyMessage(channelId, messageId) {
      requireId(channelId); requireId(messageId);
      return request('GET', `/channels/${channelId}/messages/${messageId}`, 'case-reply-message');
    },
    async createCaseReplyMessage(channelId, recordId, body) {
      requireId(channelId); validateCaseReplyPayload(body, recordId);
      return request('POST', `/channels/${channelId}/messages`, 'case-reply-create',
        { ...body, nonce: recordId.slice(0, 24), enforce_nonce: true }, true);
    },
    async deleteCaseReplyMessage(channelId, messageId, recordId) {
      requireId(channelId); requireId(messageId); requireReplyId(recordId);
      return request('DELETE', `/channels/${channelId}/messages/${messageId}`, 'case-reply-delete');
    },
    /**
     * The Shuttle's rules post as Sophie's own channel message (owner's pick of 24 October 2026): Components V2, no
     * mentions. Sent only by /whitelist post after its authorization and channel checks.
     */
    async createActivityPost(channelId, nonce, body) {
      requireId(channelId); requireCondition(typeof nonce === 'string' && /^[a-f0-9]{24}$/u.test(nonce), 'INVALID_DISCORD_PAYLOAD');
      requireCondition(body?.flags === 1 << 15 && Array.isArray(body.components) && body.components.length === 1 && body.components[0].type === 17 &&
        !('content' in body) && !('embeds' in body) && Array.isArray(body.allowed_mentions?.parse) && body.allowed_mentions.parse.length === 0, 'INVALID_DISCORD_PAYLOAD');
      return request('POST', `/channels/${channelId}/messages`, 'shuttle-message-create', { ...body, nonce, enforce_nonce: true }, true);
    },
    async createOnboardingAlert(channelId, alertId, body) {
      requireId(channelId); validateOnboardingAlertPayload(body, alertId);
      return request('POST', `/channels/${channelId}/messages`, 'shuttle-message-create',
        { ...body, nonce: alertId.slice(0, 24), enforce_nonce: true }, true);
    },
    /** One of a run's own messages: its status card, a step message or its navigation card. */
    async createOnboardingMessage(channelId, recordId, kind, screenId, body) {
      requireId(channelId); requireScreenId(recordId); validateOnboardingPart(kind, body, screenId);
      return request('POST', `/channels/${channelId}/messages`, 'shuttle-message-create',
        { ...body, nonce: recordId.slice(0, 24), enforce_nonce: true }, true);
    },
    async editOnboardingMessage(channelId, messageId, kind, screenId, body) {
      requireId(channelId); requireId(messageId); validateOnboardingPart(kind, body, screenId);
      return request('PATCH', `/channels/${channelId}/messages/${messageId}`, 'shuttle-message-edit', body, true);
    },
    /** Deletes one of this bot's own Shuttle messages; an already deleted one resolves the same way. */
    async deleteOnboardingMessage(channelId, messageId) {
      requireId(channelId); requireId(messageId);
      return request('DELETE', `/channels/${channelId}/messages/${messageId}`, 'shuttle-message-delete');
    },
    async createCaseTextChannel(body) {
      requireKeys(body, ['name', 'type', 'parent_id', 'topic', 'permission_overwrites']);
      requireId(body.parent_id); validateOverwrites(body.permission_overwrites);
      requireCondition(body.type === 0 && typeof body.name === 'string' && (/^case-[a-f0-9]{12}$/.test(body.name) || shuttleChannelName(body.name.slice(0, -"'s Shuttle".length)) === body.name) &&
        /^sophie:case:v1:[a-f0-9]{48}$/.test(body.topic), 'INVALID_CASE_CHANNEL_REQUEST');
      return request('POST', `/guilds/${guildId}/channels`, 'channel-create', body, true);
    },
    async replaceCaseAudience(channelId, parentId, overwrites) {
      requireId(channelId); requireId(parentId); validateOverwrites(overwrites);
      return request('PATCH', `/channels/${channelId}`, 'channel-edit', { parent_id: parentId, permission_overwrites: overwrites }, true);
    },
    async getMember(userId) { requireId(userId); return request('GET', `/guilds/${guildId}/members/${userId}`, 'member'); },
    async getMemberPage(after = null) {
      if (after !== null) requireId(after);
      const rows = await request('GET', `/guilds/${guildId}/members?limit=100${after === null ? '' : `&after=${after}`}`, 'member-list');
      requireCondition(Array.isArray(rows) && rows.length <= 100, 'DISCORD_RESPONSE_INVALID');
      return rows.map(row => {
        requireId(row?.user?.id); requireCondition(Array.isArray(row.roles) && row.roles.length <= 500, 'DISCORD_RESPONSE_INVALID');
        row.roles.forEach(requireId);
        return { userId: row.user.id, bot: row.user.bot === true, roleIds: [...row.roles] };
      });
    },
    async getRoles() { return request('GET', `/guilds/${guildId}/roles`, 'roles'); },
    async changeMemberRole(userId, roleId, add) {
      requireId(userId); requireId(roleId);
      requireCondition(typeof add === 'boolean', 'INVALID_ROLE_CHANGE');
      return request(add ? 'PUT' : 'DELETE', `/guilds/${guildId}/members/${userId}/roles/${roleId}`, 'role-write');
    },
    /** Requests this transport has sent, for timing diagnostics only. */
    requestCount() { return sent; },
    cooldownRemaining() { const result = Math.max(limits.globalUntil, ...limits.cooldowns.values(), 0) - clock(); return Math.max(0, Math.ceil(result)); },
  });
}
