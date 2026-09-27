import { requireCondition, requireId, requireInteger, requireRecord } from '../../../contracts/validation.js';

const messages = { MESSAGE_CREATE: 'create', MESSAGE_UPDATE: 'update', MESSAGE_DELETE: 'delete', MESSAGE_DELETE_BULK: 'delete' };
const channelEvents = ['CHANNEL_CREATE', 'CHANNEL_UPDATE', 'CHANNEL_DELETE', 'THREAD_CREATE', 'THREAD_UPDATE', 'THREAD_DELETE'];
const bodyFields = ['content', 'timestamp', 'edited_timestamp', 'type', 'flags', 'pinned', 'tts', 'embeds', 'components', 'sticker_items', 'poll'];
const safeText = (value, limit) => typeof value === 'string' && value.length <= limit && !value.includes('\0') && value.isWellFormed();

/** Bounded inert JSON, never HTML, code, a URL fetch or an executable schema. */
function dataCopy(value, depth = 0, budget = { nodes: 0 }) {
  requireCondition(++budget.nodes <= 4096 && depth <= 12, 'CASE_MESSAGE_FIELD_LIMIT');
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'number') { requireCondition(Number.isFinite(value), 'CASE_MESSAGE_FIELD_INVALID'); return value; }
  if (typeof value === 'string') { requireCondition(safeText(value, 16384), 'CASE_MESSAGE_FIELD_INVALID'); return value; }
  if (Array.isArray(value)) { requireCondition(value.length <= 100, 'CASE_MESSAGE_FIELD_LIMIT'); return value.map(item => dataCopy(item, depth + 1, budget)); }
  requireRecord(value, 'CASE_MESSAGE_FIELD_INVALID'); const result = {};
  const entries = Object.entries(value); requireCondition(entries.length <= 100, 'CASE_MESSAGE_FIELD_LIMIT');
  for (const [key, item] of entries) {
    requireCondition(safeText(key, 100) && !['__proto__', 'prototype', 'constructor'].includes(key), 'CASE_MESSAGE_FIELD_INVALID');
    result[key] = dataCopy(item, depth + 1, budget);
  }
  return result;
}
function author(raw) {
  requireRecord(raw); requireId(raw.id);
  const result = { id: raw.id };
  for (const key of ['username', 'global_name']) if (Object.hasOwn(raw, key)) {
    requireCondition(raw[key] === null || safeText(raw[key], 256), 'CASE_MESSAGE_FIELD_INVALID'); result[key] = raw[key];
  }
  if (Object.hasOwn(raw, 'bot')) { requireCondition(typeof raw.bot === 'boolean', 'CASE_MESSAGE_FIELD_INVALID'); result.bot = raw.bot; }
  return result;
}
function attachments(raw) {
  requireCondition(Array.isArray(raw) && raw.length <= 100, 'CASE_MESSAGE_FIELD_LIMIT');
  return raw.map(item => {
    requireId(item?.id); const result = { id: item.id };
    for (const key of ['filename', 'title', 'description', 'content_type', 'url', 'proxy_url', 'size', 'width', 'height', 'ephemeral', 'duration_secs', 'waveform'])
      if (Object.hasOwn(item, key)) result[key] = dataCopy(item[key]);
    return result;
  });
}
function content(raw, kind) {
  const patch = {}, issues = [];
  for (const key of ['author', 'attachments', ...bodyFields]) {
    if (!Object.hasOwn(raw, key)) continue;
    try {
      const value = key === 'author' ? author(raw[key]) : key === 'attachments' ? attachments(raw[key]) : dataCopy(raw[key]);
      if (key === 'content') requireCondition(typeof value === 'string', 'CASE_MESSAGE_FIELD_INVALID');
      if (['embeds', 'components', 'sticker_items'].includes(key)) requireCondition(Array.isArray(value), 'CASE_MESSAGE_FIELD_INVALID');
      if (['timestamp', 'edited_timestamp'].includes(key)) requireCondition(value === null ||
        (safeText(value, 64) && Number.isFinite(Date.parse(value))), 'CASE_MESSAGE_FIELD_INVALID');
      if (['type', 'flags'].includes(key)) requireInteger(value, 0);
      if (['pinned', 'tts'].includes(key)) requireCondition(typeof value === 'boolean', 'CASE_MESSAGE_FIELD_INVALID');
      const next = { ...patch, [key]: value };
      requireCondition(Buffer.byteLength(JSON.stringify(next), 'utf8') <= 131072, 'CASE_MESSAGE_FIELD_LIMIT'); patch[key] = value;
    } catch { issues.push(`unavailable:${key}`); }
  }
  if (kind === 'create' && ['author', 'content', 'timestamp', 'attachments', 'embeds'].some(key => !Object.hasOwn(patch, key))) issues.push('incomplete-create');
  // Do not copy embedded messages from another channel or silently claim those surfaces were archived.
  if (raw.message_snapshots?.length) issues.push('forwarded-snapshot-not-captured');
  return { patch, issues };
}

/** Opaque, transient core handoff. Public/unregistered message bodies are never read by content(). */
export function createCaseMessageCapture({ guildId, clock }) {
  requireId(guildId); requireCondition(typeof clock === 'function', 'TRUSTED_ADAPTERS_REQUIRED');
  const pending = new WeakMap();
  function read(proof) {
    const saved = pending.get(proof); requireCondition(saved !== undefined, 'UNTRUSTED_CASE_CAPTURE');
    const now = clock(); requireInteger(now); requireCondition(now >= saved.at && now - saved.at <= 60000, 'CASE_CAPTURE_EXPIRED'); return saved;
  }
  return Object.freeze({
    guildId,
    prepare(payload) {
      const type = payload.t;
      if (!Object.hasOwn(messages, type) && !channelEvents.includes(type) && !['GUILD_CREATE', 'THREAD_LIST_SYNC'].includes(type)) return null;
      const raw = payload.d;
      if (raw?.[type === 'GUILD_CREATE' ? 'id' : 'guild_id'] !== guildId) return null;
      let header;
      if (Object.hasOwn(messages, type)) {
        requireId(raw.channel_id);
        if (Number.isSafeInteger(raw.flags) && (raw.flags & 64) !== 0) return null;
        const ids = type === 'MESSAGE_DELETE_BULK' ? raw.ids : [raw.id];
        if (!Array.isArray(ids) || !ids.length || ids.length > 100 || new Set(ids).size !== ids.length) header = { kind: 'rejected', channelId: raw.channel_id };
        else { ids.forEach(requireId); header = { kind: messages[type], channelId: raw.channel_id, messageIds: [...ids] }; }
      } else {
        const items = type === 'GUILD_CREATE' ? [...(raw.channels ?? []), ...(raw.threads ?? [])] : type === 'THREAD_LIST_SYNC' ? raw.threads : [raw];
        requireCondition(Array.isArray(items) && items.length <= 1000, 'CASE_CAPTURE_CHANNEL_LIMIT');
        header = { kind: 'channels', items: items.map(item => {
          requireId(item?.id); if (item.parent_id != null) requireId(item.parent_id);
          return { channelId: item.id, parentId: item.parent_id ?? null, deleted: type.endsWith('_DELETE') };
        }) };
      }
      const at = clock(); requireInteger(at); const proof = Object.freeze({});
      pending.set(proof, { header, raw, at }); return proof;
    },
    inspect(proof) { const saved = read(proof); return { ...structuredClone(saved.header), observedAt: saved.at }; },
    content(proof) { const saved = read(proof); requireCondition(['create', 'update'].includes(saved.header.kind), 'CASE_CAPTURE_CONTENT_UNAVAILABLE'); return content(saved.raw, saved.header.kind); },
    discard(proof) { pending.delete(proof); },
  });
}
