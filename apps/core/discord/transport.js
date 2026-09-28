import { requireCondition, requireId, requireKeys } from '../../../contracts/validation.js';
import { validateOverwrites } from '../../../platform/authorization/discord-permissions.js';
import { validateOnboardingPayload } from '../../../modules/onboarding/screens.js';
import { validateOnboardingAlertPayload } from '../../../modules/onboarding/alerts.js';
import { validateCaseIntakePayload } from '../../../modules/tickets/intake-messages.js';
import { requireReplyId, validateCaseReplyPayload } from '../../../modules/tickets/replies.js';
import { stagingRolePayload, stagingChannelPayload } from './staging-resources.js';
import { ticketDirectNotice } from '../../../modules/tickets/direct-notice.js';
import { automationPayload, automationEmoji } from '../../../modules/automation/delivery.js';
import { validateAiMessagePayload } from '../../../modules/assistant/output.js';

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

/** Fixed Discord routes. No default fetch, environment-token lookup or live activation. */
export function createDiscordTransport({ guildId, token, fetch, clock, enabled }) {
  requireId(guildId);
  requireCondition(typeof token === 'string' && token.length >= 20 && !/\s/.test(token), 'DISCORD_TOKEN_REQUIRED');
  requireCondition(typeof fetch === 'function' && typeof clock === 'function' && typeof enabled === 'function', 'TRUSTED_ADAPTERS_REQUIRED');
  const cooldowns = new Map();
  let globalUntil = 0;
  let rateLimitInvalid = false;
  let busy = false;
  async function request(method, path, route, body = undefined, jsonResult = false, deadline = null) {
    requireCondition(await enabled() === true, 'DISCORD_TRANSPORT_DISABLED');
    if (rateLimitInvalid) throw new DiscordError('DISCORD_RATE_LIMIT_INVALID');
    const remaining = Math.max(globalUntil, cooldowns.get(route) ?? 0) - clock();
    if (remaining > 0) throw new DiscordError('RATE_LIMITED', Math.ceil(remaining));
    if (busy) throw new DiscordError('DISCORD_BUSY', 250);
    if (deadline !== null) requireCondition(Number.isSafeInteger(deadline) && deadline > clock() && deadline - clock() <= 15000, 'AI_DEADLINE_EXPIRED');
    busy = true;
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
      if (response.headers.get('x-ratelimit-remaining') === '0') {
        const delay = delayMs(response.headers.get('x-ratelimit-reset-after'));
        cooldowns.set(route, clock() + Math.max(delay, 1_000));
      }
      if (response.status === 429) {
        let data;
        try { data = await boundedJson(response); } catch { data = {}; }
        if (data === null || typeof data !== 'object' || Array.isArray(data)) data = {};
        const delay = Math.max(delayMs(response.headers.get('retry-after')), delayMs(data.retry_after));
        // An unbounded or unreadable limit cannot be guessed shorter. Halt this transport
        // for operator review instead of retrying early or feeding invalid-request limits.
        if (!delay || [response.headers.get('retry-after'), data.retry_after].some(value => Number(value) > 86_400)) {
          rateLimitInvalid = true;
          throw new DiscordError('DISCORD_RATE_LIMIT_INVALID');
        }
        const retry = delay;
        if (data.global === true || response.headers.get('x-ratelimit-global') === 'true') globalUntil = clock() + retry;
        cooldowns.set(route, clock() + retry);
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
        if (!write && ['shuttle-message', 'case-intake-message', 'case-reply-message'].includes(route) && data.code === 10008) return null;
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
    } finally { controller.abort(); clearTimeout(timeout); await response?.body?.cancel().catch(() => {}); busy = false; }
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
        nonce: messageId, enforce_nonce: true, message_reference: { message_id: messageId, channel_id: channelId, fail_if_not_exists: true } }, true, deadline);
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
      requireCondition(definition?.type === 1 && ['whitelist', 'ticket', 'answer', 'lookup', 'mute', 'unmute'].includes(definition.name), 'COMMAND_REGISTRATION_INVALID');
      return request('POST', `/applications/${applicationId}/guilds/${guildId}/commands`, 'guild-command', definition, true);
    },
    async getGuild() { return request('GET', `/guilds/${guildId}`, 'guild'); },
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
    async createOnboardingAlert(channelId, alertId, body) {
      requireId(channelId); validateOnboardingAlertPayload(body, alertId);
      return request('POST', `/channels/${channelId}/messages`, 'shuttle-message-create',
        { ...body, nonce: alertId.slice(0, 24), enforce_nonce: true }, true);
    },
    async createOnboardingMessage(channelId, screenId, body) {
      requireId(channelId); validateOnboardingPayload(body, screenId);
      return request('POST', `/channels/${channelId}/messages`, 'shuttle-message-create',
        { ...body, nonce: screenId.slice(0, 24), enforce_nonce: true }, true);
    },
    async editOnboardingMessage(channelId, messageId, screenId, body) {
      requireId(channelId); requireId(messageId); validateOnboardingPayload(body, screenId);
      return request('PATCH', `/channels/${channelId}/messages/${messageId}`, 'shuttle-message-edit', body, true);
    },
    async createCaseTextChannel(body) {
      requireKeys(body, ['name', 'type', 'parent_id', 'topic', 'permission_overwrites']);
      requireId(body.parent_id); validateOverwrites(body.permission_overwrites);
      requireCondition(body.type === 0 && /^case-[a-f0-9]{12}$/.test(body.name) && /^sophie:case:v1:[a-f0-9]{48}$/.test(body.topic), 'INVALID_CASE_CHANNEL_REQUEST');
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
    cooldownRemaining() { const result = Math.max(globalUntil, ...cooldowns.values(), 0) - clock(); return Math.max(0, Math.ceil(result)); },
  });
}
