import { requireCondition, requireId, requireInteger, requireKeys } from '../../contracts/validation.js';

export const requireAutomationHash = value => requireCondition(typeof value === 'string' && /^[a-f0-9]{64}$/.test(value), 'AUTOMATION_INPUT_INVALID');
function text(value, limit, multiline = false) {
  requireCondition(typeof value === 'string' && value.length > 0 && value.length <= limit && value.trim().length > 0 && value.isWellFormed() &&
    !(multiline ? /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/ : /[\x00-\x1f\x7f]/).test(value), 'AUTOMATION_INPUT_INVALID');
  return value;
}
export function canonicalAutomationAction(value) {
  requireCondition(value !== null && typeof value === 'object', 'AUTOMATION_INPUT_INVALID');
  if (value.kind === 'message') {
    requireKeys(value, ['kind','text'], 'AUTOMATION_INPUT_INVALID');
    return { kind: 'message', text: text(value.text, 2000, true) };
  }
  requireKeys(value, ['kind','emoji'], 'AUTOMATION_INPUT_INVALID');
  requireCondition(value.kind === 'reaction', 'AUTOMATION_INPUT_INVALID');
  requireKeys(value.emoji, ['id','name'], 'AUTOMATION_INPUT_INVALID');
  if (value.emoji.id !== null) {
    requireId(value.emoji.id); requireCondition(typeof value.emoji.name === 'string' && /^[A-Za-z0-9_]{2,32}$/.test(value.emoji.name), 'AUTOMATION_INPUT_INVALID');
  } else {
    text(value.emoji.name, 32);
    // Bounded Unicode emoji data, never a URL, expression or executable template.
    requireCondition(/\p{Emoji_Presentation}|\p{Extended_Pictographic}|[0-9#*]\uFE0F?\u20E3/u.test(value.emoji.name) &&
      /^(?:\p{Emoji}|\p{Emoji_Modifier}|\uFE0F|\u200D|\u20E3|[\u{E0020}-\u{E007F}])+$/u.test(value.emoji.name), 'AUTOMATION_INPUT_INVALID');
  }
  return { kind: 'reaction', emoji: { id: value.emoji.id, name: value.emoji.name } };
}
/** Authored bounded data. Literal matching only; no templates, regular expressions or imports. */
export function canonicalAutomation(document) {
  requireKeys(document, ['source','rules'], 'AUTOMATION_INPUT_INVALID');
  const source = text(document.source, 300);
  requireCondition(Array.isArray(document.rules) && document.rules.length > 0 && document.rules.length <= 25, 'AUTOMATION_INPUT_INVALID');
  const rules = document.rules.map(rule => {
    requireKeys(rule, ['id','channels','match','action','priority','stop','userCooldownMs','channelCooldownMs'], 'AUTOMATION_INPUT_INVALID');
    requireCondition(typeof rule.id === 'string' && /^[a-z][a-z0-9-]{0,39}$/.test(rule.id), 'AUTOMATION_INPUT_INVALID');
    requireCondition(Array.isArray(rule.channels) && rule.channels.length > 0 && rule.channels.length <= 20 && new Set(rule.channels).size === rule.channels.length, 'AUTOMATION_INPUT_INVALID');
    rule.channels.forEach(requireId);
    requireKeys(rule.match, ['kind','text','caseSensitive'], 'AUTOMATION_INPUT_INVALID');
    requireCondition(['exact','contains'].includes(rule.match.kind) && typeof rule.match.caseSensitive === 'boolean' && typeof rule.stop === 'boolean', 'AUTOMATION_INPUT_INVALID');
    requireInteger(rule.priority, 0, 1000); requireInteger(rule.userCooldownMs, 1000, 86400000); requireInteger(rule.channelCooldownMs, 1000, 86400000);
    return { id: rule.id, channels: [...rule.channels].sort(), match: { kind: rule.match.kind, text: text(rule.match.text, 100, true), caseSensitive: rule.match.caseSensitive },
      action: canonicalAutomationAction(rule.action), priority: rule.priority, stop: rule.stop, userCooldownMs: rule.userCooldownMs, channelCooldownMs: rule.channelCooldownMs };
  });
  requireCondition(new Set(rules.map(rule => rule.id)).size === rules.length && new Set(rules.flatMap(rule => rule.channels)).size <= 50, 'AUTOMATION_INPUT_INVALID');
  rules.sort((a,b) => b.priority - a.priority || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return { source, rules };
}

/** Pure matching contract. Core supplies current channel exclusion and retained cooldown timestamps. */
export function planAutomation(document, event, { excluded, userLast = {}, channelLast = {} }) {
  const policy = canonicalAutomation(document);
  requireKeys(event, ['atMs','channelId','userId','content','bot','webhook','self'], 'AUTOMATION_INPUT_INVALID');
  requireId(event.channelId); requireId(event.userId); requireInteger(event.atMs);
  requireCondition(typeof excluded === 'boolean' && ['bot','webhook','self'].every(key => typeof event[key] === 'boolean'), 'AUTOMATION_INPUT_INVALID');
  // Do not inspect content for excluded channels or bot/webhook/self events.
  if (excluded || event.bot || event.webhook || event.self) return { suppressed: true, decisions: [], actions: [] };
  requireCondition(typeof event.content === 'string' && event.content.length <= 4000 && event.content.isWellFormed(), 'AUTOMATION_INPUT_INVALID');
  const content = event.content.normalize('NFC'), decisions = [], actions = [];
  let stopped = false;
  for (const rule of policy.rules) {
    let state = 'unmatched';
    if (stopped) state = 'stopped';
    else if (!rule.channels.includes(event.channelId)) state = 'channel';
    else {
      const literal = rule.match.text.normalize('NFC'), haystack = rule.match.caseSensitive ? content : content.toLowerCase(),
        needle = rule.match.caseSensitive ? literal : literal.toLowerCase();
      if (rule.match.kind === 'exact' ? haystack === needle : haystack.includes(needle)) {
        const userAt = Object.hasOwn(userLast,rule.id) ? userLast[rule.id] : null, channelAt = Object.hasOwn(channelLast,rule.id) ? channelLast[rule.id] : null;
        for (const at of [userAt,channelAt]) if (at !== null) requireInteger(at);
        state = [ [userAt,rule.userCooldownMs],[channelAt,rule.channelCooldownMs] ].some(([at,ms]) => at !== null && event.atMs - at < ms) ? 'cooldown' : actions.length >= 3 ? 'limit' : 'selected';
        if (state === 'selected') actions.push({ ruleId: rule.id, action: structuredClone(rule.action) });
        // A matched stop rule blocks lower-priority fallbacks even while cooling down.
        stopped = rule.stop;
      }
    }
    decisions.push({ ruleId: rule.id, state });
  }
  return { suppressed: false, decisions, actions };
}

/** Hypothetical timeline only; contains no input-message text in its returned result. */
export function previewAutomation(document, events, excludedChannels) {
  const policy = canonicalAutomation(document);
  requireCondition(Array.isArray(events) && events.length > 0 && events.length <= 20 && excludedChannels instanceof Set, 'AUTOMATION_INPUT_INVALID');
  const users = new Map(), channels = new Map(), results = []; let previous = 0;
  for (const event of events) {
    requireInteger(event.atMs, previous, 86400000); previous = event.atMs;
    const userLast = Object.create(null), channelLast = Object.create(null);
    for (const rule of policy.rules) {
      userLast[rule.id] = users.get(`${rule.id}:${event.userId}`) ?? null;
      channelLast[rule.id] = channels.get(`${rule.id}:${event.channelId}`) ?? null;
    }
    const result = planAutomation(policy, event, { excluded: excludedChannels.has(event.channelId), userLast, channelLast });
    for (const selected of result.actions) { users.set(`${selected.ruleId}:${event.userId}`,event.atMs); channels.set(`${selected.ruleId}:${event.channelId}`,event.atMs); }
    results.push({ atMs: event.atMs, ...result });
  }
  return { dryRun: true, maxActionsPerMessage: 3, results };
}
