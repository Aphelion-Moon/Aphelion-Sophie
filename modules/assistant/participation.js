import { requireCondition, requireId, requireInteger, requireKeys, requireName } from '../../contracts/validation.js';

export const AI_DEADLINE_MS = 15_000;
export const AI_MODES = Object.freeze(['ignore', 'addressed', 'questions', 'reactive', 'conversational']);

/** Presets describe initiative, never consent or Discord permissions. Unknown channels are ignored. */
export function defaultParticipation(mode = 'ignore') {
  requireCondition(AI_MODES.includes(mode), 'AI_MODE_INVALID');
  return { mode, evaluationIntervalMs: 30_000, replyIntervalMs: 60_000, reactionIntervalMs: 30_000,
    memberIntervalMs: 15_000, proactiveRepliesPerHour: 12, contextTtlMs: 300_000, contextMessages: 12,
    reactions: mode === 'reactive', typing: true, quietHours: null };
}

export function canonicalParticipation(value) {
  requireKeys(value, Object.keys(defaultParticipation()), 'AI_PROFILE_INVALID');
  requireCondition(AI_MODES.includes(value.mode), 'AI_MODE_INVALID');
  requireInteger(value.evaluationIntervalMs, 15_000, 3_600_000);
  requireInteger(value.replyIntervalMs, 15_000, 3_600_000);
  requireInteger(value.reactionIntervalMs, 15_000, 3_600_000);
  requireInteger(value.memberIntervalMs, 1_000, 3_600_000);
  requireInteger(value.proactiveRepliesPerHour, 0, 60);
  requireInteger(value.contextTtlMs, 10_000, 1_800_000);
  requireInteger(value.contextMessages, 0, 30);
  for (const key of ['reactions', 'typing']) requireCondition(typeof value[key] === 'boolean', 'AI_PROFILE_INVALID');
  if (value.quietHours !== null) {
    requireKeys(value.quietHours, ['startMinute', 'endMinute', 'utcOffsetMinutes'], 'AI_QUIET_HOURS_INVALID');
    requireInteger(value.quietHours.startMinute, 0, 1439); requireInteger(value.quietHours.endMinute, 0, 1439);
    requireInteger(value.quietHours.utcOffsetMinutes, -720, 840);
    requireCondition(value.quietHours.startMinute !== value.quietHours.endMinute, 'AI_QUIET_HOURS_INVALID');
  }
  return structuredClone(value);
}

export function canonicalAiConfiguration(value) {
  requireKeys(value, ['schemaVersion', 'enabled', 'deadlineMs', 'channels', 'emojis'], 'AI_CONFIGURATION_INVALID');
  requireCondition(value.schemaVersion === 1 && typeof value.enabled === 'boolean', 'AI_CONFIGURATION_INVALID');
  requireInteger(value.deadlineMs, 1_000, AI_DEADLINE_MS);
  requireCondition(Array.isArray(value.channels) && value.channels.length <= 100, 'AI_CHANNELS_INVALID');
  const ids = new Set();
  const channels = value.channels.map(channel => {
    requireKeys(channel, ['channelId', 'profile'], 'AI_CHANNELS_INVALID'); requireId(channel.channelId);
    requireCondition(!ids.has(channel.channelId), 'AI_CHANNELS_INVALID'); ids.add(channel.channelId);
    return { channelId: channel.channelId, profile: canonicalParticipation(channel.profile) };
  }).sort((a, b) => a.channelId.localeCompare(b.channelId));
  requireCondition(Array.isArray(value.emojis) && value.emojis.length <= 16, 'AI_EMOJIS_INVALID');
  const keys = new Set(), identities = new Set();
  const emojis = value.emojis.map(emoji => {
    requireKeys(emoji, ['key', 'id', 'name'], 'AI_EMOJIS_INVALID'); requireName(emoji.key);
    requireCondition(!keys.has(emoji.key), 'AI_EMOJIS_INVALID'); keys.add(emoji.key);
    requireCondition(typeof emoji.name === 'string' && emoji.name.isWellFormed(), 'AI_EMOJIS_INVALID');
    if (emoji.id === null) {
      requireCondition(emoji.name.length <= 16 && /\p{Extended_Pictographic}/u.test(emoji.name) &&
        !/[\p{L}\p{N}\s/:<>]/u.test(emoji.name) && !/[⏳⌛⚠✅☑✔🔒🔐]/u.test(emoji.name), 'AI_EMOJIS_INVALID');
    } else { requireId(emoji.id); requireCondition(/^[a-zA-Z0-9_]{2,32}$/.test(emoji.name), 'AI_EMOJIS_INVALID'); }
    const identity = emoji.id ?? emoji.name;
    requireCondition(!identities.has(identity), 'AI_EMOJIS_INVALID'); identities.add(identity);
    return { ...emoji };
  }).sort((a, b) => a.key.localeCompare(b.key));
  return { schemaVersion: 1, enabled: value.enabled, deadlineMs: value.deadlineMs, channels, emojis };
}

export function isQuiet(profile, now) {
  requireInteger(now);
  if (profile.quietHours === null) return false;
  const { startMinute, endMinute, utcOffsetMinutes } = profile.quietHours;
  const minute = ((Math.floor(now / 60_000) + utcOffsetMinutes) % 1440 + 1440) % 1440;
  return startMinute < endMinute ? minute >= startMinute && minute < endMinute : minute >= startMinute || minute < endMinute;
}

/** Cheap candidate selection on already eligible content. A match is not evidence of answerability. */
export function questionCandidate(text) {
  requireCondition(typeof text === 'string' && text.length <= 4000, 'AI_INPUT_INVALID');
  return /[?？]/u.test(text) || /^(?:can|could|would|will|does|do|is|are|has|have|how|what|where|when|why|who|which)\b/iu.test(text.trim()) ||
    /^(?:please\s+)?(?:help|explain|show me|tell me)\b/iu.test(text.trim());
}

/** The caller supplies verified addressing metadata after exclusion/consent checks. */
export function participationDecision(profile, { addressed, question, directedToOther, now }) {
  profile = canonicalParticipation(profile);
  for (const flag of [addressed, question, directedToOther]) requireCondition(typeof flag === 'boolean', 'AI_TRIGGER_INVALID');
  const none = { context: false, infer: false, outcomes: [], answerOnly: false, proactive: false };
  if (profile.mode === 'ignore') return none;
  if (addressed) return { context: true, infer: true, outcomes: ['reply', ...(profile.reactions ? ['react'] : []), 'silent'], answerOnly: false, proactive: false };
  if (profile.mode === 'addressed') return none;
  const passive = { ...none, context: true };
  if (isQuiet(profile, now) || directedToOther) return passive;
  if (profile.mode === 'questions') return question && profile.proactiveRepliesPerHour > 0
    ? { context: true, infer: true, outcomes: ['reply', 'silent'], answerOnly: true, proactive: true } : passive;
  if (profile.mode === 'reactive') return profile.reactions
    ? { context: true, infer: true, outcomes: ['react', 'silent'], answerOnly: false, proactive: true } : passive;
  return { context: true, infer: true,
    outcomes: [...(profile.proactiveRepliesPerHour > 0 ? ['reply'] : []), ...(profile.reactions ? ['react'] : []), 'silent'],
    answerOnly: false, proactive: true };
}
