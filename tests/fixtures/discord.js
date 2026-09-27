import { createDiscordTransport } from '../../apps/core/discord/transport.js';
import { createDiscordRoles } from '../../apps/core/discord/roles.js';
import { GUILD, USER, STAFF, LEAD, NOW } from './domain.js';

export const BOT = '100000000000000006';
export const CREW = '100000000000000007';
export const MUZZLED = '100000000000000008';
export const WHITELIST = '100000000000000009';
export const BOT_ROLE = '100000000000000010';
export const BYOND_ROLE = '100000000000000011';
export const mapping = Object.freeze({ guildId: GUILD, botUserId: BOT, crew: CREW, muzzled: MUZZLED,
  whitelist: WHITELIST, staff: STAFF, leadOps: LEAD, externallyOwnedRoleIds: Object.freeze([BYOND_ROLE]) });

export function roleList() {
  return [[GUILD, 0], [CREW, 1], [WHITELIST, 2], [MUZZLED, 3], [BYOND_ROLE, 4], [STAFF, 8], [LEAD, 9], [BOT_ROLE, 10]]
    .map(([id, position]) => ({ id, position, managed: id === BOT_ROLE, mentionable: id === STAFF,
      permissions: id === BOT_ROLE ? String(1n << 28n) : '0' }));
}

/** In-process HTTP fixture; only synthetic metadata/static bot screens, no real case data. */
export function simulatedDiscord({ clock = () => NOW, enabled = () => true, readContinuity = () => 'synthetic-continuity-1' } = {}) {
  const state = { roles: roleList(), ownerId: '100000000000000099', members: new Map([[BOT, [BOT_ROLE]], [USER, [CREW, BYOND_ROLE]]]),
    channels: new Map(), messages: new Map(), emojis: new Map(), threadMembers: new Map(), calls: [], before: null, afterWrite: null };
  let channelSequence = 300000000000000000n, messageSequence = 400000000000000000n;
  const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), { status, headers });
  const fetch = async (url, options) => {
    const parsed = new URL(url);
    if (parsed.origin !== 'https://discord.com' || options.redirect !== 'error') throw new Error('SIMULATION_ROUTE_ESCAPE');
    const call = { method: options.method, path: parsed.pathname };
    state.calls.push(call);
    const replacement = await state.before?.(call, options);
    if (replacement) return replacement;
    if (call.path === '/api/v10/users/@me' && call.method === 'GET') return json({ id: BOT, bot: true });
    if (call.path === '/api/v10/users/@me/channels' && call.method === 'POST') {
      const userId = JSON.parse(options.body).recipient_id;
      let channel = [...state.channels.values()].find(value => value.type === 1 && value.recipients[0].id === userId);
      if (!channel) { channel = { id: String(++channelSequence), type: 1, recipients: [{ id: userId }] }; state.channels.set(channel.id, channel); }
      await state.afterWrite?.(call); return json(channel);
    }
    if (call.path === `/api/v10/guilds/${GUILD}` && call.method === 'GET') return json({ id: GUILD, owner_id: state.ownerId });
    if (call.path === `/api/v10/guilds/${GUILD}/roles` && call.method === 'GET') return json(state.roles);
    if (call.path === `/api/v10/guilds/${GUILD}/members` && call.method === 'GET') {
      const after = BigInt(parsed.searchParams.get('after') ?? '0');
      return json([...state.members].filter(([id]) => BigInt(id) > after)
        .sort(([a],[b]) => BigInt(a) < BigInt(b) ? -1 : 1).slice(0,Number(parsed.searchParams.get('limit')))
        .map(([id,roles]) => ({user:{id,bot:id===BOT},roles})));
    }
    if (call.path === `/api/v10/guilds/${GUILD}/channels`) {
      if (call.method === 'GET') return json([...state.channels.values()].filter(channel => channel.guild_id === GUILD));
      if (call.method === 'POST') {
        const id = String(++channelSequence);
        const body = JSON.parse(options.body);
        state.channels.set(id, { ...body, id, guild_id: GUILD });
        await state.afterWrite?.(call);
        return json(state.channels.get(id), 201);
      }
    }
    const threadMember = /^\/api\/v10\/channels\/(\d+)\/thread-members\/(\d+)$/.exec(call.path);
    if (threadMember && call.method === 'GET') {
      const member = state.threadMembers.get(`${threadMember[1]}:${threadMember[2]}`);
      return member ? json(member) : json({ code: 10007 }, 404);
    }
    const messageRoute = /^\/api\/v10\/channels\/(\d+)\/messages(?:\/(\d+))?$/.exec(call.path);
    const emojiRoute = /^\/api\/v10\/guilds\/(\d+)\/emojis\/(\d+)$/.exec(call.path);
    if (emojiRoute && call.method === 'GET' && emojiRoute[1] === GUILD) return state.emojis.has(emojiRoute[2]) ? json(state.emojis.get(emojiRoute[2])) : json({code:10014},404);
    const reactionRoute = /^\/api\/v10\/channels\/(\d+)\/messages\/(\d+)\/reactions\/([^/]+)\/@me$/.exec(call.path);
    if (reactionRoute && ['PUT','DELETE'].includes(call.method)) {
      const [,channelId,messageId,encoded] = reactionRoute, message = state.messages.get(messageId);
      if (!message || message.channel_id !== channelId) return json({code:10008},404);
      const reference = decodeURIComponent(encoded), parts = reference.split(':'), emoji = parts.length === 2 ? {name:parts[0],id:parts[1]} : {name:reference,id:null};
      message.reactions ??= [];
      let reaction = message.reactions.find(item=>item.emoji.id === emoji.id && (emoji.id !== null || item.emoji.name === emoji.name));
      if (!reaction) { reaction = {emoji,me:false}; message.reactions.push(reaction); }
      reaction.me = call.method === 'PUT'; await state.afterWrite?.(call); return new Response(null,{status:204});
    }
    if (messageRoute) {
      const [, channelId, messageId] = messageRoute;
      if (!state.channels.has(channelId)) return json({ code: 10003 }, 404);
      if (call.method === 'POST' && !messageId) {
        const body = JSON.parse(options.body);
        const duplicate = body.enforce_nonce && [...state.messages.values()].find(message => message.nonce === body.nonce);
        if (duplicate) return json(duplicate);
        const id = String(++messageSequence);
        state.messages.set(id, { id, channel_id: channelId, author: { id: BOT, bot: true }, type: 0, attachments: [],
          content: body.content, embeds: body.embeds, components: body.components, nonce: body.nonce,
          mention_everyone: false, mentions: [], mention_roles: body.allowed_mentions.roles ?? [] });
        await state.afterWrite?.(call); return json(state.messages.get(id));
      }
      const message = state.messages.get(messageId);
      if (!message || message.channel_id !== channelId) return json({ code: 10008 }, 404);
      if (call.method === 'GET') return json(message);
      if (call.method === 'DELETE') {
        state.messages.delete(messageId); await state.afterWrite?.(call);
        return new Response(null, { status: 204 });
      }
      if (call.method === 'PATCH') {
        const body = JSON.parse(options.body);
        Object.assign(message, { content: body.content, embeds: body.embeds, components: body.components });
        await state.afterWrite?.(call); return json(message);
      }
      throw new Error('SIMULATION_ROUTE_UNSUPPORTED');
    }
    const channelRoute = /^\/api\/v10\/channels\/(\d+)$/.exec(call.path);
    if (channelRoute) {
      const channel = state.channels.get(channelRoute[1]);
      if (!channel) return json({ code: 10003 }, 404);
      if (call.method === 'GET') return json(channel);
      if (call.method === 'DELETE') {
        state.channels.delete(channel.id);
        for (const [id, message] of state.messages) if (message.channel_id === channel.id) state.messages.delete(id);
        await state.afterWrite?.(call); return json(channel);
      }
      if (call.method === 'PATCH') {
        const body = JSON.parse(options.body);
        Object.assign(channel, { parent_id: body.parent_id, permission_overwrites: body.permission_overwrites });
        await state.afterWrite?.(call);
        return json(channel);
      }
      throw new Error('SIMULATION_ROUTE_UNSUPPORTED');
    }
    const route = /^\/api\/v10\/guilds\/(\d+)\/members\/(\d+)(?:\/roles\/(\d+))?$/.exec(call.path);
    if (!route || route[1] !== GUILD) throw new Error('SIMULATION_ROUTE_UNSUPPORTED');
    const [, , userId, roleId] = route;
    if (!state.members.has(userId)) return json({ code: 10007 }, 404);
    const roles = state.members.get(userId);
    if (call.method === 'GET' && !roleId) return json({ user: { id: userId, bot: userId === BOT }, roles, communication_disabled_until: null });
    if (!roleId || !['PUT', 'DELETE'].includes(call.method)) throw new Error('SIMULATION_ROUTE_UNSUPPORTED');
    state.members.set(userId, call.method === 'PUT' ? [...new Set([...roles, roleId])] : roles.filter(id => id !== roleId));
    await state.afterWrite?.(call);
    return new Response(null, { status: 204 });
  };
  const transport = createDiscordTransport({ guildId: GUILD, token: 'synthetic-test-token-not-a-secret', fetch, clock, enabled });
  return { state, fetch, transport, roles: createDiscordRoles({ transport, mapping, clock, readContinuity }) };
}
