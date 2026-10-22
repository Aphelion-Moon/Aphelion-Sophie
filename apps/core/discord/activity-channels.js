import { requireCondition, requireId } from '../../../contracts/validation.js';
import { PERMISSIONS, channelPermissions } from '../../../platform/authorization/discord-permissions.js';

// Text, announcement and forum channels: the kinds a member can be pointed to.
const LISTED = new Set([0, 5, 15]);
const MENTION = /<#(\d{17,20})>/g;
const NAMED = /(^|[\s(*_>])#([a-z0-9][a-z0-9_-]{0,99})/gi;

/**
 * Channel links for the Shuttle Activity (owner decision of 22 October 2026). It finds the channels the current stop's
 * copy names (<#id> mentions and #channel-name text) and, once Whitelist is confirmed, the curated arrival list, and
 * keeps only channels the member can view now (their current roles and each channel's overwrites, as Discord would
 * compute them). It never returns the name of a channel the member cannot see. Read-only; no AI.
 */
export function createActivityChannels({ transport, roles, guildId, clock, cacheMs = 15_000 }) {
  requireId(guildId);
  requireCondition(typeof transport?.getGuild === 'function' && typeof transport.getGuildChannels === 'function' &&
    typeof roles?.prepare === 'function' && typeof clock === 'function', 'TRUSTED_ADAPTERS_REQUIRED');
  let directory = null;
  async function channels() {
    if (directory && clock() - directory.at < cacheMs) return directory;
    const [guild, list] = await Promise.all([transport.getGuild(), transport.getGuildChannels()]);
    requireCondition(guild?.id === guildId && Array.isArray(list), 'DISCORD_RESPONSE_INVALID'); requireId(guild.owner_id);
    const listed = list.filter(channel => channel && LISTED.has(channel.type) && typeof channel.name === 'string')
      .sort((a, b) => (a.position ?? 0) - (b.position ?? 0) || String(a.id).localeCompare(String(b.id)));
    directory = { at: clock(), ownerId: guild.owner_id, byId: new Map(listed.map(channel => [channel.id, channel])),
      byName: new Map([...listed].reverse().map(channel => [channel.name.toLowerCase(), channel])) };
    return directory;
  }
  return Object.freeze({
    /**
     * pages: the current stop's copy; arrival: [{ channelId, note? }] or null before Whitelist is confirmed.
     * Returns { mentions: { '#name' | '<#id>': { id, name } }, arrival: [{ id, name, note }] }.
     */
    async resolve({ userId, pages, arrival = null }) {
      requireId(userId);
      const wanted = new Map();
      for (const page of pages) {
        for (const match of page.matchAll(MENTION)) wanted.set(`<#${match[1]}>`, { id: match[1] });
        for (const match of page.matchAll(NAMED)) wanted.set(`#${match[2].toLowerCase()}`, { name: match[2].toLowerCase() });
      }
      if (!wanted.size && !arrival?.length) return { mentions: {}, arrival: [] };
      // Shared role reads, as other member observations use them: a clearance poll every few seconds costs no extra reads.
      const dir = await channels(), { context } = await roles.prepare(userId, { share: true });
      const projected = context.roles.map(role => ({ id: role.id, permissions: role.permissions }));
      const canView = channel => {
        const bits = channelPermissions({ guildId, userId, ownerId: dir.ownerId, roleIds: context.memberRoleIds, roles: projected,
          overwrites: channel.permission_overwrites ?? [] });
        return bits === -1n || (bits & PERMISSIONS.viewChannel) !== 0n;
      };
      const mentions = {};
      for (const [key, ref] of wanted) {
        const channel = ref.id ? dir.byId.get(ref.id) : dir.byName.get(ref.name);
        if (channel && canView(channel)) mentions[key] = { id: channel.id, name: channel.name };
      }
      const open = (arrival ?? []).map(entry => ({ entry, channel: dir.byId.get(entry.channelId) }))
        .filter(({ channel }) => channel && canView(channel))
        .map(({ entry, channel }) => ({ id: channel.id, name: channel.name, ...(entry.note ? { note: entry.note } : {}) }));
      return { mentions, arrival: open };
    },
  });
}
