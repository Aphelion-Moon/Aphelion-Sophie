import { requireCondition, requireId } from '../../contracts/validation.js';

/**
 * Member records (owner decisions, 30 October 2026): one post per member in a Staff forum, kept indefinitely. The post
 * opens with five of Sophie's messages: the header (a summary she keeps edited), the ledger (links to her automatic
 * entries further down) and three reserved messages (the access application, game records, a spare). Staff discuss the
 * member freely below them. Everything here is a pure function of the record: the same record always renders the same
 * post. No AI reads or writes any of it.
 */

export const TITLE_MAX = 100;
export const MESSAGE_MAX = 2_000;
export const TAGS = Object.freeze(['In server', 'Left', 'Whitelisted', 'Muzzled', 'Staff', 'Watch']);
const DISCORD_EPOCH = 1_420_070_400_000n;
const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const SHORT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pad = value => String(value).padStart(2, '0');
const MINUTE = 60_000, HOUR = 60 * MINUTE;

/**
 * A duration for Staff to read, in the same words as the Whitelist notice (`modules/onboarding/timing.js`; modules may not
 * import each other): `42s`, `14m 05s`, `2h 03m`, `3d 04h`.
 */
export function formatDuration(ms) {
  requireCondition(Number.isSafeInteger(ms) && ms >= 0, 'INVALID_DURATION');
  const seconds = Math.round(ms / 1_000);
  if (seconds < 60) return `${seconds}s`;
  if (ms < HOUR) return `${Math.floor(seconds / 60)}m ${pad(seconds % 60)}s`;
  const minutes = Math.floor(ms / MINUTE);
  if (minutes < 24 * 60) return `${Math.floor(minutes / 60)}h ${pad(minutes % 60)}m`;
  return `${Math.floor(minutes / 1_440)}d ${pad(Math.floor(minutes / 60) % 24)}h`;
}

/** An Activity run's timing: focused time, pages, time since boarding, first stop timed (as the Whitelist notice has it). */
function requireRunTiming(timing) {
  requireCondition(timing !== null && typeof timing === 'object' &&
    [timing.focusedMs, timing.pages, timing.wallMs, timing.fromStop].every(value => Number.isSafeInteger(value) && value >= 0) &&
    timing.pages <= 64 * 64, 'INVALID_RUN_TIMING');
  return timing;
}

/** When a Discord account was created, read from its ID. */
export function accountCreatedMs(userId) {
  requireId(userId);
  return Number((BigInt(userId) >> 22n) + DISCORD_EPOCH);
}

/** Discord's timestamp markup, shown in each reader's own time zone. */
export function stamp(ms, style = 'D') {
  requireCondition(Number.isSafeInteger(ms) && ms > 0 && ['D', 'f', 'R'].includes(style), 'INVALID_TIME');
  return `<t:${Math.floor(ms / 1_000)}:${style}>`;
}

/** A written UTC date and time, so Discord search can find an entry by date: `30 Oct 2026, 13:02 UTC`. */
export function utcText(ms) {
  requireCondition(Number.isSafeInteger(ms) && ms > 0, 'INVALID_TIME');
  const date = new Date(ms);
  return `${date.getUTCDate()} ${SHORT_MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}, ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())} UTC`;
}

/** A link that jumps to one message. */
export function jumpUrl(guildId, channelId, messageId) {
  [guildId, channelId, messageId].forEach(id => requireId(id));
  return `https://discord.com/channels/${guildId}/${channelId}/${messageId}`;
}

/** Cuts text to at most `max` UTF-16 units without splitting a character, ending with an ellipsis when cut. */
function cut(text, max) {
  if (text.length <= max) return text;
  let out = '';
  for (const char of text) { if (out.length + char.length > max - 1) break; out += char; }
  return `${out.trimEnd()}…`;
}

/**
 * One line of someone's own text (a name, a title): control and invisible format characters removed (the emoji joiner
 * kept), stacked combining marks capped, whitespace collapsed, cut to `max`.
 */
export function cleanLine(text, max) {
  requireCondition(Number.isSafeInteger(max) && max > 1, 'INVALID_LENGTH');
  const plain = String(text ?? '').normalize('NFC').replace(/\p{Cc}/gu, ' ').replace(/(?!\u200d)\p{Cf}/gu, '')
    .replace(/(\p{M}{2})\p{M}+/gu, '$1').replace(/\s+/gu, ' ').trim();
  return cut(plain, max);
}

/**
 * Someone else's text shown literally in a message: line breaks kept, Markdown, mention, heading, list and link syntax
 * escaped. Messages carrying it are also sent with no allowed mentions and with embeds suppressed.
 */
export function literal(text) {
  return String(text ?? '').normalize('NFC').replace(/\r\n?/g, '\n').replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, ' ')
    .replace(/(?!\u200d)\p{Cf}/gu, '').replace(/(\p{M}{2})\p{M}+/gu, '$1')
    .replace(/[\\`*_~|><#[\]()@-]/g, '\\$&').replace(/^(\s*\d+)\./gm, '$1\\.').replace(/\n{3,}/g, '\n\n').trim();
}

/** The post's title: username, display name and Discord ID, so the forum's search finds any of them. */
export function recordTitle({ userId, username, displayName }) {
  requireId(userId);
  const user = cleanLine(username, 40) || 'unknown';
  const shown = cleanLine(displayName, 60);
  const ending = ` · ${userId}`;
  const names = shown && shown.toLowerCase() !== user.toLowerCase() ? `${user} · ${shown}` : user;
  return `${cut(names, TITLE_MAX - ending.length)}${ending}`;
}

/** The tags Sophie applies (at most five). `watch` keeps a Watch tag a person set. */
export function recordTags({ present, roles, watch = false }) {
  const tags = [present ? 'In server' : 'Left'];
  if (roles?.whitelist) tags.push('Whitelisted');
  if (roles?.muzzled) tags.push('Muzzled');
  if (roles?.staff || roles?.leadOps) tags.push('Staff');
  if (watch) tags.push('Watch');
  return tags;
}

// ---------------------------------------------------------------------------------------------------------------------
// Following the member.

const ROLE_KEYS = ['crew', 'whitelist', 'muzzled', 'staff', 'leadOps'];
const EARLIER_NAMES_KEPT = 20;

/** JSON text with object keys sorted, so equal values compare equal whatever order their keys came in. */
function canonicalJson(value) {
  const sort = item => Array.isArray(item) ? item.map(sort) : item !== null && typeof item === 'object'
    ? Object.fromEntries(Object.keys(item).sort().map(key => [key, sort(item[key])])) : item;
  return JSON.stringify(sort(value));
}

/** How the member is named in a name-change entry: `Display (@username)`, or `@username`. */
function shownName(username, displayName) {
  const user = cleanLine(username, 40) || 'unknown', shown = cleanLine(displayName, 60);
  return shown && shown.toLowerCase() !== user.toLowerCase() ? `${shown} (@${user})` : `@${user}`;
}

/**
 * What a Gateway member change means for a record: the next profile, the entries it adds, and whether anything the post
 * shows changed. A join (from not present) counts the join when the count is known; a leave clears the roles. Role changes
 * while the member stays become entries: Whitelist given or removed (Sophie's own grant is entered by its confirmation,
 * so `whitelistBySophie` skips it here), Muzzled or not. A new username or display name becomes an entry and the old
 * one is kept in the earlier names. A leave carries no names, so none are compared.
 * @param {object} profile the record's profile
 * @param {{ present: boolean, roles: object, username?: string|null, globalName?: string|null, nick?: string|null, joinedAtMs?: number|null }} observation
 * @param {number} atMs when Sophie saw it
 * @returns {{ profile: object, events: object[], changed: boolean }}
 */
export function observeMember(profile, observation, atMs, { whitelistBySophie = false, ignoreRoleIds = [] } = {}) {
  requireCondition(Number.isSafeInteger(atMs) && atMs > 0, 'INVALID_TIME');
  const next = structuredClone(profile), events = [];
  const before = { ...Object.fromEntries(ROLE_KEYS.map(key => [key, false])), ...(profile.roles ?? {}) };
  const roles = Object.fromEntries(ROLE_KEYS.map(key => [key, observation.present && observation.roles?.[key] === true]));
  const joined = !profile.present && observation.present;
  if (joined) {
    next.present = true;
    next.joinCount = Number.isSafeInteger(profile.joinCount) ? profile.joinCount + 1 : null;
    if (Number.isSafeInteger(observation.joinedAtMs) && observation.joinedAtMs > 0) next.joinedAtMs = observation.joinedAtMs;
    events.push({ kind: 'joined', joinCount: next.joinCount });
  } else if (profile.present && !observation.present) {
    next.present = false; next.lastLeftAtMs = atMs;
    events.push({ kind: 'left', hadWhitelist: before.whitelist });
  }
  next.roles = roles;
  if (observation.present) {
    // On a join every role it arrives with is new; while staying, only a change is.
    const was = joined ? Object.fromEntries(ROLE_KEYS.map(key => [key, false])) : before;
    if (!was.whitelist && roles.whitelist && !whitelistBySophie) events.push({ kind: 'whitelist.granted', bySophie: false });
    if (was.whitelist && !roles.whitelist) events.push({ kind: 'whitelist.lost' });
    if (!was.muzzled && roles.muzzled) events.push({ kind: 'muzzled', by: null });
    if (was.muzzled && !roles.muzzled && !joined) events.push({ kind: 'unmuzzled', by: null });
    if (observation.username !== undefined) {
      const username = observation.username ?? profile.username ?? null;
      const displayName = observation.nick ?? observation.globalName ?? null;
      const from = shownName(profile.username, profile.displayName), to = shownName(username, displayName);
      if (from !== to) {
        events.push({ kind: 'name.changed', from, to });
        const earlier = [...(profile.earlierNames ?? [])];
        for (const name of [profile.username, profile.displayName]) if (name && ![username, displayName].includes(name) && !earlier.includes(name)) earlier.push(name);
        next.earlierNames = earlier.slice(-EARLIER_NAMES_KEPT);
      }
      next.username = username; next.displayName = displayName;
    }
  }
  // Every other role change while the member stays is an entry too (owner, 30 October 2026: "Add role changes to the
  // automatic entries."). Whitelist and Muzzled keep their own entries, so `ignoreRoleIds` leaves them out here. A record
  // that has never held role IDs takes them as they are, without an entry; a join or a leave is its own entry.
  if (Array.isArray(observation.roleIds)) {
    const now = observation.present ? [...new Set(observation.roleIds)].sort() : [];
    if (Array.isArray(profile.roleIds) && profile.present && observation.present) {
      const counted = id => !ignoreRoleIds.includes(id);
      const added = now.filter(id => !profile.roleIds.includes(id) && counted(id)), removed = profile.roleIds.filter(id => !now.includes(id) && counted(id));
      if (added.length || removed.length) events.push({ kind: 'roles.changed', added, removed });
    }
    next.roleIds = now;
  }
  // Compared with keys in a fixed order: PostgreSQL stores JSON objects in its own key order, so the stored profile and the
  // one built here can differ in order alone (seen in production, 30 October 2026: every check touched every record).
  return { profile: next, events, changed: canonicalJson(next) !== canonicalJson(profile) };
}

// ---------------------------------------------------------------------------------------------------------------------
// Interpreting the access application (owner: "Interpret and store DOB"; the form asks for MM/YYYY).

/**
 * Reads a date-of-birth answer as a month and year. Keeps only the month and year even when a day is given (the form
 * asks for month and year only). When day and month could be either way round, keeps the year only.
 * @returns {{ status: 'month'|'year'|'unreadable', year: number|null, month: number|null, monthUnclear: boolean }}
 */
export function interpretBirth(text, atMs) {
  requireCondition(Number.isSafeInteger(atMs) && atMs > 0, 'INVALID_TIME');
  const nowYear = new Date(atMs).getUTCFullYear();
  const raw = cleanLine(text, 120).toLowerCase();
  const unreadable = { status: 'unreadable', year: null, month: null, monthUnclear: false };
  const fullYear = value => { const digits = value.replace("'", ''); return digits.length === 4 ? Number(digits) : (2_000 + Number(digits) <= nowYear ? 2_000 : 1_900) + Number(digits); };
  const result = (year, month, monthUnclear = false) => {
    if (!Number.isInteger(year) || year < 1_900 || year > nowYear) return null;
    if (month !== null && (!Number.isInteger(month) || month < 1 || month > 12)) return null;
    return month === null ? { status: 'year', year, month: null, monthUnclear } : { status: 'month', year, month, monthUnclear: false };
  };
  const dayOrMonth = (year, first, second) => {
    if (first > 12 && second <= 12) return result(year, second);
    if (second > 12 && first <= 12) return result(year, first);
    if (first === second) return result(year, first);
    return result(year, null, true);
  };
  // Answers often carry other text (older forms asked for the ckey in the same question), so the date is found inside the
  // answer, most specific shape first.
  const numeric = [
    [/(?<!\d)(\d{4})[/.-](\d{1,2})[/.-](\d{1,2})(?!\d)/, m => result(Number(m[1]), Number(m[2]))],
    [/(?<!\d)(\d{1,2})[/.-](\d{1,2})[/.-](\d{4}|\d{2})(?!\d)/, m => dayOrMonth(fullYear(m[3]), Number(m[1]), Number(m[2]))],
    [/(?<!\d)(\d{1,2})\s*[/.-]\s*(\d{4})(?!\d)/, m => result(Number(m[2]), Number(m[1]))],
    [/(?<!\d)(\d{4})\s*[/.-]\s*(\d{1,2})(?!\d)/, m => result(Number(m[1]), Number(m[2]))],
  ];
  for (const [pattern, read] of numeric) { const match = raw.match(pattern); if (match) { const found = read(match); if (found) return found; } }
  for (const match of raw.matchAll(/(?<![a-z])([a-z]{3,9})\.?,?\s*(?:(\d{1,2})(?:st|nd|rd|th)?,?\s+)?('?\d{4}|'\d{2}|\d{2})(?!\d)/g)) {
    const month = MONTHS.findIndex(name => name.startsWith(match[1]));
    const found = month >= 0 ? result(fullYear(match[3]), month + 1) : null; if (found) return found;
  }
  for (const match of raw.matchAll(/(?<!\d)\d{1,2}(?:st|nd|rd|th)?\s+(?:of\s+)?([a-z]{3,9})\.?,?\s*(\d{4})(?!\d)/g)) {
    const month = MONTHS.findIndex(name => name.startsWith(match[1]));
    const found = month >= 0 ? result(Number(match[2]), month + 1) : null; if (found) return found;
  }
  const short = raw.match(/(?<!\d)(\d{1,2})\s*\/\s*(\d{2})(?!\d)/);
  if (short) { const found = result(fullYear(short[2]), Number(short[1])); if (found) return found; }
  const alone = raw.match(/^(\d{2})(\d{4})$/) ?? raw.match(/^()(\d{4})$/);
  if (alone) return result(Number(alone[2]), alone[1] ? Number(alone[1]) : null) ?? unreadable;
  return unreadable;
}

/** The answer with every date-of-birth shape taken out, for reading names from a combined question. */
function withoutDates(text) {
  return text.replace(/(?<!\d)\d{4}[/.-]\d{1,2}(?:[/.-]\d{1,2})?(?!\d)/g, ' ')
    .replace(/(?<!\d)\d{1,2}[/.-]\d{1,2}[/.-](?:\d{4}|\d{2})(?!\d)/g, ' ')
    .replace(/(?<!\d)\d{1,2}\s*[/.-]\s*(?:\d{4}|\d{2})(?!\d)/g, ' ')
    .replace(/(?<![a-z])(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?,?\s*(?:\d{1,2}(?:st|nd|rd|th)?,?\s+)?'?\d{2,4}(?!\d)/gi, ' ');
}

/** The age at a time from a month-and-year birth, as a range (a month is not a day). */
export function ageAt(birth, atMs) {
  requireCondition(birth?.status === 'month' || birth?.status === 'year', 'INVALID_BIRTH');
  const date = new Date(atMs), year = date.getUTCFullYear(), month = date.getUTCMonth() + 1;
  if (birth.status === 'year') return { min: year - birth.year - 1, max: year - birth.year };
  const age = year - birth.year - (month < birth.month ? 1 : 0);
  return month === birth.month ? { min: age - 1, max: age } : { min: age, max: age };
}

/** The header's birth line: `04/1998 (28 at approval)`. */
export function birthLine(birth, approvedAtMs) {
  if (!birth || birth.status === 'unreadable') return 'could not be read; see the application';
  const { min, max } = ageAt(birth, approvedAtMs);
  const age = min === max ? `${min}` : `${min} or ${max}`;
  return birth.status === 'month' ? `${pad(birth.month)}/${birth.year} (${age} at approval)`
    : `${birth.year}, month ${birth.monthUnclear ? 'unclear' : 'not given'} (${age} at approval)`;
}

const NONE = /^(?:n\/?a|none|no|nope|nothing|-+|x|not yet|don'?t have(?: one)?|do not have(?: one)?|haven'?t|no account|tbd)$/i;
const LABEL_WORDS = 'byond|ckey|ss\\s?13|ss\\s?14|space station 1[34]|robust(?:\\s?toolbox)?';
const LABEL = new RegExp(`\\b(${LABEL_WORDS})\\b`, 'gi');
const LEADING_LABEL = new RegExp(`^(${LABEL_WORDS})\\b`, 'i');
const LEADING_WORDS = new RegExp(`^(?:${LABEL_WORDS}|account|key|user\\s?name|name|is|my|[:=\\-–—()"'\`]|\\s)+`, 'i');

/** The BYOND key's canonical ckey: lower case letters and digits only. */
export function ckeyOf(key) { return String(key ?? '').toLowerCase().replace(/[^a-z0-9]/g, ''); }

const FILLER = /^(?:dob|d\.?o\.?b|born|birthday|birth|date|of|my|is|and|or|the|ckey|byond|key|username|user|name|ss1[34]|ss|both|for|n\/?a|none|same)$/i;

/**
 * Reads the game-account answer. Labelled values ("BYOND: x, SS14: y") are taken as labelled. Otherwise, a short answer
 * of one to three names is kept as named: as the ckey when the question asked only for a BYOND ckey, else with the game
 * not stated. Dates (older forms asked for the date of birth in the same question) and filler words are set aside;
 * longer prose is left to the transcription. Self-reported, never verified here.
 * @param {string} text the answer
 * @param {string} [label] the question, which says what an unlabelled name is
 */
export function interpretGameNames(text, label = '') {
  const raw = cleanLine(withoutDates(cleanLine(text, 300)), 300);
  const found = { ckey: null, ckeyAsWritten: null, ss14: null, unlabelled: [] };
  const setCkey = value => { if (!found.ckey && ckeyOf(value)) { found.ckeyAsWritten = cleanLine(value, 32); found.ckey = ckeyOf(value).slice(0, 30); } };
  const segments = raw.replace(LABEL, '\n$1').split(/\n|[,;|]|\s\/\s|\band\b/i).map(item => item.trim()).filter(Boolean);
  for (const segment of segments) {
    const kind = segment.match(LEADING_LABEL)?.[1]?.toLowerCase();
    if (!kind) continue;
    const value = segment.replace(LEADING_WORDS, '').split(/\s+\(/)[0].replace(/[\s()"'`.,:;!-]+$/g, '').trim();
    if (!value || NONE.test(value)) continue;
    if (/14|robust/.test(kind)) { if (!found.ss14) found.ss14 = cleanLine(value.split(/\s+/)[0], 32); }
    else setCkey(value);
  }
  if (found.ckey || found.ss14) return found;
  const names = [...new Set(raw.split(/[\s,;|/:()–—-]+/u)
    .map(item => item.replace(/^[^\p{L}\p{N}_]+|[^\p{L}\p{N}_]+$/gu, ''))
    .filter(item => item && /\p{L}/u.test(item) && !FILLER.test(item) && !NONE.test(item)))];
  if (names.length === 0 || names.length > 3) return found;
  const both = /\bss\s?13\s*(?:\/|&|\+|and)\s*(?:ss\s?)?14\b|\bboth\b|\bsame\b/i.test(String(text ?? ''));
  if (names.length === 1 && both) { setCkey(names[0]); found.ss14 = cleanLine(names[0], 32); }
  else if (names.length === 1 && /ckey|byond/i.test(label) && !/ss\s?14/i.test(label)) setCkey(names[0]);
  else found.unlabelled = names.map(name => cleanLine(name, 32));
  return found;
}

/** Short labels for the application questions, current and older forms; other questions keep their own, cut. */
export function shortLabel(label) {
  const text = String(label ?? '');
  if (/ckey|ss14/i.test(text) && /birth/i.test(text)) return 'Game account · born';
  if (/age[\s-]?check/i.test(text)) return 'Age check';
  if (/date of birth/i.test(text)) return 'Born';
  if (/ckey|ss14 user/i.test(text)) return 'Game accounts';
  if (/banned/i.test(text)) return 'Banned elsewhere';
  if (/have you played|played on before/i.test(text)) return 'Played before';
  if (/how did you find/i.test(text)) return 'Found us · why · furries';
  return cleanLine(text, 60);
}

// ---------------------------------------------------------------------------------------------------------------------
// Rendering.

function fit(lines, max = MESSAGE_MAX) {
  const text = lines.filter(line => line !== null).join('\n');
  requireCondition(text.length <= max, 'MEMBER_RECORD_MESSAGE_TOO_LONG');
  return text;
}

/**
 * The latest Activity run: `{ startedAtMs, completedAtMs, finished, timing }`. Runs finished before 25 October 2026
 * have no completion time (migration 079), so `finished` is read from the session's own status.
 */
function shuttleLine(shuttle) {
  if (shuttle === null || shuttle === undefined) return 'no Activity run on record';
  const finished = shuttle.finished === true || shuttle.completedAtMs !== null;
  if (!finished) return `boarded ${stamp(shuttle.startedAtMs)}, not finished`;
  if (shuttle.completedAtMs === null) return `finished (boarded ${stamp(shuttle.startedAtMs)}) · reading time not recorded`;
  if (!shuttle.timing) return `finished ${stamp(shuttle.completedAtMs)} · reading time not recorded`;
  const timing = requireRunTiming(shuttle.timing);
  const pages = timing.pages === 0 ? 'no pages reported'
    : `${timing.pages} ${timing.pages === 1 ? 'page' : 'pages'}, average ${formatDuration(Math.round(timing.focusedMs / timing.pages))} a page`;
  return `finished ${stamp(shuttle.completedAtMs)} · ${formatDuration(timing.focusedMs)} focused (${formatDuration(timing.wallMs)} from boarding) · ${pages}` +
    `${timing.fromStop > 0 ? ` · timed from stop ${timing.fromStop + 1}` : ''}`;
}

function gameValue(games, which) {
  if (!games) return null;
  if (which === 'ss14') return games.ss14;
  if (!games.ckey) return null;
  return games.ckeyAsWritten && games.ckeyAsWritten !== games.ckey ? `${games.ckey} (written ${games.ckeyAsWritten})` : games.ckey;
}

/**
 * The header: who the member is, where they stand now, and the facts Staff look for first.
 * @param {object} record
 * @param {string} record.userId
 * @param {string} record.username
 * @param {string|null} record.displayName
 * @param {boolean} record.present
 * @param {{crew?: boolean, whitelist?: boolean, muzzled?: boolean, staff?: boolean, leadOps?: boolean}} record.roles
 * @param {number|null} record.joinedAtMs the current (or last) membership's join time, from Discord
 * @param {number|null} record.joinCount joins on record, or null when joins before the record are unknown
 * @param {number|null} record.lastLeftAtMs
 * @param {object|null} record.shuttle the latest Activity run, or null
 * @param {number|null} record.mutes mutes on record, or null when not read
 * @param {object|null} record.application `{ approvedAtMs, birth, games }`, or null when there is none on record
 * @param {string[]} record.earlierNames
 * @param {string|null} record.note a closing note in small text
 * @param {number} record.updatedAtMs
 */
export function renderHeader(record) {
  requireId(record.userId);
  const user = cleanLine(record.username, 40) || 'unknown';
  const shown = cleanLine(record.displayName, 60);
  const heading = shown && shown.toLowerCase() !== user.toLowerCase() ? `${literal(shown)} (@${literal(user)})` : `@${literal(user)}`;
  const roles = record.roles ?? {};
  const status = [record.present ? 'In server' : 'Left or removed', roles.crew && 'Crew', roles.whitelist && 'Whitelisted',
    roles.muzzled && 'Muzzled', roles.staff && 'Staff', roles.leadOps && 'Lead Ops'].filter(Boolean).join(' · ');
  const when = record.joinedAtMs ? stamp(record.joinedAtMs) : 'date unknown';
  const joins = record.joinCount === null ? `${when} · earlier joins not recorded`
    : `${when} · ${record.joinCount === 1 ? 'first join' : `join ${record.joinCount}`}`;
  const left = record.lastLeftAtMs ? ` · last left ${stamp(record.lastLeftAtMs, 'f')}` : '';
  const application = record.application;
  const gameLine = (name, value) => `${name}: ${value ? `${literal(value)} (given on application)` : 'not on record'}`;
  const earlier = (record.earlierNames ?? []).map(name => literal(cleanLine(name, 40))).filter(Boolean);
  const mutes = record.mutes === null ? 'not read yet' : record.mutes === 0 ? 'no mutes on record'
    : `${record.mutes} ${record.mutes === 1 ? 'mute' : 'mutes'} on record`;
  return fit([
    `## ${heading}`,
    `<@${record.userId}> · \`${record.userId}\` · account created ${stamp(accountCreatedMs(record.userId))}`,
    `-# Member record kept by Sophie · updated ${stamp(record.updatedAtMs, 'R')} · her automatic entries are listed in the ledger below`,
    '',
    `**Status:** ${status}`,
    `**Joined:** ${joins}${left}`,
    `**Shuttle:** ${shuttleLine(record.shuttle)}`,
    `**Moderation:** ${mutes}`,
    `**Born:** ${application ? birthLine(application.birth, application.approvedAtMs) : 'no application on record'}`,
    `**Earlier names:** ${earlier.length ? earlier.slice(-8).join(', ') : 'none on record'}`,
    // The member's roles now, by name (owner, 30 October 2026, with role change entries).
    Array.isArray(record.roleNames) ? `**Roles:** ${record.roleNames.length ? cut(record.roleNames.map(name => literal(cleanLine(name, 60))).join(', '), 400) : 'none'}` : null,
    '',
    '**Game accounts**',
    gameLine('SS13, Meridian Rift', gameValue(application?.games, 'ckey')),
    gameLine('SS14, Wolfgate', gameValue(application?.games, 'ss14')),
    application?.games?.unlabelled?.length ? `Named on application, game not stated: ${application.games.unlabelled.map(name => literal(name)).join(', ')}` : null,
    record.note ? `-# ${record.note}` : null,
  ]);
}

/**
 * The ledger: Sophie's automatic entries, newest first, each a link to its message. When they no longer fit, the newest
 * that fit are shown with a count of the rest.
 * @param {{ atMs: number, label: string, messageId: string }[]} entries
 */
export function renderLedger(entries, { guildId, channelId }) {
  const sorted = [...entries].sort((a, b) => b.atMs - a.atMs || (BigInt(b.messageId) > BigInt(a.messageId) ? 1 : -1));
  const count = sorted.length;
  const lines = [`**Ledger** · ${count === 0 ? 'no automatic entries yet' : `${count} automatic ${count === 1 ? 'entry' : 'entries'} · newest first`}`];
  let length = lines[0].length;
  for (const [index, entry] of sorted.entries()) {
    const line = `\`${new Date(entry.atMs).toISOString().slice(0, 10)}\` [${literal(cleanLine(entry.label, 80))}](${jumpUrl(guildId, channelId, entry.messageId)})`;
    if (length + 1 + line.length > MESSAGE_MAX - 80) {
      const rest = count - index;
      lines.push(`-# ${rest} older ${rest === 1 ? 'entry' : 'entries'} not listed here`);
      break;
    }
    lines.push(line); length += 1 + line.length;
  }
  return fit(lines);
}

/** The three reserved messages' starting text. */
export const RESERVED = Object.freeze({
  application: '-# Reserved by Sophie: the access application.',
  games: '-# Reserved by Sophie: game records for Meridian Rift (SS13) and Wolfgate (SS14).',
  spare: '-# Reserved by Sophie.',
});

/** The application slot when Discord does not let Sophie read approved applications. */
export const APPLICATION_UNAVAILABLE = '-# Reserved by Sophie: the access application. Not available yet: Discord does not let Sophie read approved applications.';

/** The application slot when Discord holds no approved application for the member (for example, joined before Apply to Join). */
export const APPLICATION_NONE = '-# Reserved by Sophie: the access application. None on record: Discord holds no approved application for this member.';

/**
 * A Discord join request's form responses as answers for `renderApplication`: a multiple-choice answer becomes the chosen
 * text, a terms field becomes agreed or not, text stays as written. Only the form responses are read; the request's
 * interview field never is.
 */
export function applicationAnswers(formResponses) {
  requireCondition(Array.isArray(formResponses) && formResponses.length <= 50, 'INVALID_APPLICATION');
  return formResponses.map(field => {
    const label = String(field?.label ?? '');
    if (field?.field_type === 'MULTIPLE_CHOICE') {
      const choices = Array.isArray(field.choices) ? field.choices : [];
      return { label, value: Number.isInteger(field.response) && typeof choices[field.response] === 'string' ? [choices[field.response]] : null };
    }
    if (field?.field_type === 'TERMS') return { label, value: field.response === undefined ? true : field.response === true };
    return { label, value: typeof field?.response === 'string' ? field.response : null };
  });
}

/**
 * Born and game accounts from an application's answers, on the current form (separate questions) or older ones (the ckey
 * and date of birth in one question). The age-check answer is never read as a date.
 * @param {{ label: string, value: unknown }[]} answers from `applicationAnswers`
 */
export function applicationFacts(answers, approvedAtMs) {
  const asked = answer => !/age[\s-]?check/i.test(answer.label) && typeof answer.value === 'string';
  const birth = answers.find(answer => asked(answer) && /birth/i.test(answer.label));
  const games = answers.find(answer => asked(answer) && /ckey|byond|ss14 user/i.test(answer.label));
  return { approvedAtMs, birth: interpretBirth(birth?.value ?? '', approvedAtMs), games: interpretGameNames(games?.value ?? '', games?.label ?? '') };
}

/**
 * An approved access application, transcribed with short labels and the answers as written, over as many messages as
 * it needs. Interviews are never read.
 * @param {{ approvedAtMs: number, approvedBy: string|null, answers: { label: string, value: string|string[]|boolean|null }[] }} application
 */
export function renderApplication({ approvedAtMs, approvedBy, answers }) {
  if (approvedBy) requireId(approvedBy);
  const head = `**Access application** · approved ${stamp(approvedAtMs)}${approvedBy ? ` by <@${approvedBy}>` : ''}`;
  const blocks = answers.map(({ label, value }) => {
    const shown = value === null || value === undefined || value === '' ? '*(no answer)*'
      : value === true ? 'Agreed' : value === false ? 'Not agreed'
        : Array.isArray(value) ? value.map(item => literal(item)).join(', ') : literal(value);
    return `**${literal(shortLabel(label))}**\n${shown}`;
  });
  const messages = [];
  let current = head;
  for (let block of blocks) {
    while (block.length > 0) {
      const room = MESSAGE_MAX - current.length - 2;
      if (block.length <= room) { current += `\n\n${block}`; block = ''; break; }
      if (room > 200) {
        let split = block.lastIndexOf('\n', room);
        if (split < room / 2) split = block.lastIndexOf(' ', room);
        if (split < room / 2) split = room;
        while (split > 0 && block[split - 1] === '\\') split -= 1;
        current += `\n\n${block.slice(0, split)}`; block = block.slice(split).trimStart();
      }
      messages.push(current); current = '-# Access application, continued';
    }
  }
  messages.push(current);
  return messages;
}

/** A join's count in words; null when joins from before the record are unknown. */
function joinWords(joinCount) {
  return joinCount === null || joinCount === undefined ? 'rejoined (earlier joins not recorded)' : joinCount === 1 ? 'first join' : `join ${joinCount}`;
}

export const RECENT_MESSAGES_SHOWN = 5;

/**
 * A leaver's most recent messages, newest first, as links (owner direction, 30 October 2026). Sophie keeps only message and
 * channel IDs and times, never content; the caller has already left out channels Staff should not be pointed at.
 */
function recentLines(recent, guildId) {
  if (!Array.isArray(recent)) return [];
  if (recent.length === 0) return ['-# No recent messages on record.'];
  return ['Most recent messages:', ...recent.slice(0, RECENT_MESSAGES_SHOWN).map(item =>
    `- ${stamp(item.atMs, 'f')} in <#${item.channelId}> · [message](${jumpUrl(guildId, item.channelId, item.messageId)})`)];
}

/**
 * The text of one automatic entry. Each carries a written UTC time so Discord search can find it by date.
 * @param {{ kind: string, atMs: number }} event
 * @param {{ guildId?: string, recent?: { channelId: string, messageId: string, atMs: number }[] }} [context] a leave's recent
 *   messages, already filtered
 */
export function entryText(event, context = {}) {
  const at = utcText(event.atMs);
  switch (event.kind) {
    case 'record.opened':
      if (event.present === false) return `**Record opened** · ${at} · not in the server; known from ${event.source === 'application' ? 'an approved application' : 'Sophie\'s earlier records'}. Join and leave dates before this are not recorded.`;
      return `**Record opened** · ${at} · already in the server${event.joinedAtMs ? `, joined ${stamp(event.joinedAtMs)}` : ''}. Events before this are not recorded.`;
    case 'watched': return `**Watch on**${event.by ? ` by <@${event.by}>` : ''} · ${at}`;
    case 'unwatched': return `**Watch off**${event.by ? ` by <@${event.by}>` : ''} · ${at}`;
    case 'joined': return `**Joined** · ${at} · ${joinWords(event.joinCount)}`;
    case 'left': {
      // A leave seen live carries its exact time; one Sophie's check found later says so.
      const when = event.noticed ? `noticed ${at}, while Sophie's check ran; the member left while she was offline and the exact time is not known`
        : `${at} (${stamp(event.atMs, 'f')})`;
      return fit([`**Left or removed** · ${when}${event.hadWhitelist ? ' · Whitelist ends; a fresh Shuttle run is needed to regain it' : ''}`,
        ...recentLines(context.recent, context.guildId)]);
    }
    case 'application.replaced':
      return `**Access application replaced** · ${at} · the new application, approved ${stamp(event.approvedAtMs)}${event.approvedBy ? ` by <@${event.approvedBy}>` : ''}, is now in the post's third message. The earlier one follows as it was.`;
    case 'whitelist.granted': return event.bySophie
      ? `**Whitelist granted by Sophie** · ${at}${event.timing ? ` · ${formatDuration(event.timing.focusedMs)} focused (${formatDuration(event.timing.wallMs)} from boarding) · ${event.timing.pages} pages` : ''}`
      : `**Whitelist given** · ${at} · not by Sophie`;
    case 'whitelist.lost': return `**Whitelist removed** · ${at}`;
    case 'muzzled': return `**Muzzled**${event.by ? ` by <@${event.by}>` : ''} · ${at}`;
    case 'unmuzzled': return `**Unmuzzled**${event.by ? ` by <@${event.by}>` : ''} · ${at}`;
    case 'name.changed': return `**Name changed** · ${at} · ${literal(cleanLine(event.from, 60))} → ${literal(cleanLine(event.to, 60))}`;
    case 'roles.changed': {
      // Role names as they are when the entry is posted (a mention of a role is never sent); a deleted role says so.
      const names = ids => ids.map(id => context.roleNames?.[id] ? literal(cleanLine(context.roleNames[id], 60)) : 'a deleted role').join(', ');
      const actors = context.changedBy?.userIds ?? (context.changedBy?.userId ? [context.changedBy.userId] : []);
      const by = actors.length ? `by ${actors.slice(0, 5).map(id => `<@${id}>`).join(', ')}${actors.length > 5 ? ` and ${actors.length - 5} more` : ''} (audit log)`
        : context.changedBy === 'none' ? 'who changed them is not in the audit log' : 'who changed them could not be checked';
      // Quick changes are one entry (see the store's ROLE_WINDOW_MS): the net result, and roles that came and went.
      const span = (event.changes ?? 1) > 1 ? ` · ${event.changes} changes over ${formatDuration(Math.max(0, (event.lastAtMs ?? event.atMs) - event.atMs))}` : '';
      const added = event.added ?? [], removed = event.removed ?? [];
      const brief = (event.touched ?? []).filter(id => !added.includes(id) && !removed.includes(id));
      return fit([`**Roles changed** · ${at}${event.noticed ? ' (found by Sophie\'s check; she was offline when it happened)' : ''}${span} · ${by}`,
        ...(added.length ? [`Added: ${names(added)}`] : []), ...(removed.length ? [`Removed: ${names(removed)}`] : []),
        ...(brief.length ? [`Added and removed again: ${names(brief)}`] : []), ...(!added.length && !removed.length && !brief.length ? ['-# No change in the end.'] : [])]);
    }
    default: throw new Error('MEMBER_RECORD_EVENT_UNKNOWN');
  }
}

/** The ledger's label for an entry (plain words; the ledger escapes them). */
export function entryLabel(event) {
  switch (event.kind) {
    case 'record.opened': return event.present === false ? 'Record opened · not in the server' : 'Record opened · already in the server';
    case 'watched': return 'Watch on';
    case 'unwatched': return 'Watch off';
    case 'joined': return `Joined · ${joinWords(event.joinCount)}`;
    case 'left': return 'Left or removed';
    case 'whitelist.granted': return event.bySophie ? 'Whitelist granted by Sophie' : 'Whitelist given, not by Sophie';
    case 'whitelist.lost': return 'Whitelist removed';
    case 'muzzled': return 'Muzzled';
    case 'unmuzzled': return 'Unmuzzled';
    case 'name.changed': return 'Name changed';
    case 'roles.changed': return 'Roles changed';
    case 'application': return 'Access application';
    case 'application.replaced': return 'Access application replaced';
    case 'message.deleted': return event.count === 1 ? 'Message deleted' : 'Messages deleted';
    case 'message.edited': return 'Message edited';
    default: throw new Error('MEMBER_RECORD_EVENT_UNKNOWN');
  }
}

/** Someone's text as a literal block quote, in pieces that each fit a message with room to spare. */
function quotedPieces(text) {
  const pieces = [], characters = [...String(text ?? '')];
  // Escaping can double the length, so raw pieces stay under half a message.
  for (let start = 0; start < characters.length; start += 850) pieces.push(literal(characters.slice(start, start + 850).join('')).split('\n').map(line => `> ${line}`).join('\n'));
  return pieces.length ? pieces : ['> *(no text)*'];
}

/** Blocks joined into as few messages as fit. */
function pack(blocks) {
  const parts = [];
  for (const block of blocks) {
    if (parts.length && parts.at(-1).length + 1 + block.length <= MESSAGE_MAX) parts[parts.length - 1] += `\n${block}`;
    else parts.push(block);
  }
  return parts;
}

/** Who deleted a message, as the audit log tells it when the entry is posted. */
function deletedByText(by) {
  if (by?.userId) return `deleted by <@${by.userId}> (audit log)`;
  if (by === 'author') return 'no moderator deletion in the audit log, so most likely by the author';
  return 'who deleted it could not be checked';
}

/**
 * A deletion or an edit of a member's message (owner, 30 October 2026: Staff asked for deleted messages in each post; text
 * kept 30 days). The text is quoted literally, so it can mention, format or link nothing.
 */
function messageEntryParts(event, context) {
  const at = utcText(event.atMs);
  if (event.kind === 'message.edited') {
    return pack([`**Message edited** · ${at} · in <#${event.channelId}> · sent ${stamp(event.sentAtMs, 'f')} · [message](${jumpUrl(context.guildId, event.channelId, event.messageId)})`,
      '**Before**', ...(event.before === null || event.before === undefined ? ['-# Earlier text not kept.'] : quotedPieces(event.before)), '**After**', ...quotedPieces(event.after)]);
  }
  const shown = event.messages ?? [];
  const blocks = [`**${event.count === 1 ? 'Message deleted' : `${event.count} messages deleted`}** · ${at} · in <#${event.channelId}> · ${deletedByText(context.deletedBy)}`];
  for (const message of shown) {
    const files = (message.attachments ?? []).map(item => cleanLine(item.filename, 80)).filter(Boolean);
    blocks.push(`-# Sent ${stamp(message.sentAtMs, 'f')}${files.length ? ` · attachments: ${literal(files.join(', '))}` : ''}`);
    blocks.push(...(message.content === null || message.content === undefined ? ['-# Text no longer kept (Sophie keeps it for 30 days).'] : quotedPieces(message.content)));
  }
  if (event.count > shown.length) blocks.push(`-# ${event.count - shown.length} more not shown.`);
  return pack(blocks);
}

/**
 * The messages one entry is posted as: one, except a replaced application, whose entry is followed by the earlier
 * application as it was (owner direction, 30 October 2026: the old and new application documented in the post), and a
 * deleted or edited message, whose text can take several.
 */
export function entryParts(event, context = {}) {
  if (event.kind === 'message.deleted' || event.kind === 'message.edited') return messageEntryParts(event, context);
  const first = entryText(event, context);
  if (event.kind !== 'application.replaced' || !event.previous) return [first];
  return [first, ...renderApplication(event.previous).map((text, index) => index === 0 ? text.replace('**Access application**', '**Earlier access application**') : text)];
}

/**
 * One line in the changelog post: when, what, whose record, and a link to the entry. The member is named by mention (shown
 * as their name, never notified) and by username, so the changelog can be searched.
 * @param {{ kind: string, atMs: number }} event
 * @param {{ guildId: string, userId: string, username: string|null, threadId: string, messageId: string }} where
 */
export function changelogLine(event, { guildId, userId, username, threadId, messageId }) {
  requireId(userId);
  const user = cleanLine(username, 40);
  return `\`${utcText(event.atMs)}\` **${literal(entryLabel(event))}** · <@${userId}>${user ? ` (${literal(user)})` : ''} · [entry](${jumpUrl(guildId, threadId, messageId)})`;
}

/**
 * The changelog post's opening message (the post was opened by a host-only command of 30 October 2026, and this text set
 * there the same day at the owner's request: "Update the OP in the pinned thread to include a list of all features and types
 * of tracked information for this forum feature."). Keep it in step with what the records hold.
 */
export const CHANGELOG_OPENING = [
  '## Sophie\'s changelog',
  'Every automatic update Sophie makes to the member records appears here as it happens, newest at the bottom, each with a link to the entry in that member\'s post.',
  '',
  '### Each member\'s post',
  '- **Header**, kept up to date: names and Discord ID, account age, status (in server or left, Crew, Whitelisted, Muzzled, Staff, Lead Ops), join date and count, last leave, Shuttle run and reading time, mutes on record, birth month and year and game accounts (from the application), earlier names, current roles.',
  '- **Ledger:** links to Sophie\'s entries in the post.',
  '- **Access application:** the approved application, transcribed. A newer one replaces it; the older one is kept as an entry.',
  '- **Game records** (reserved for Meridian Rift and Wolfgate) and one spare message.',
  '- **Tags:** In server or Left, Whitelisted, Muzzled, Staff, Watch.',
  '',
  '### Automatic entries',
  '- Joined, rejoined, and left (with the time and links to their 5 latest messages)',
  '- Whitelist granted by Sophie (with Shuttle reading time) or given by someone else, and removed',
  '- Muzzled and unmuzzled',
  '- Other role changes: roles added or removed, and who changed them (from the audit log)',
  '- Name changes',
  '- Access application, and application replaced',
  '- Watch on or off (`/member watch`, all Staff)',
  '- Deleted messages (the text, attachments, and who deleted them from the audit log) and edited messages (before and after). These stay in the member\'s post and are not listed here.',
  '',
  '### Good to know',
  '- Sophie checks the member list when she starts and every 6 hours, catching joins, leaves and changes made while she was offline, and opens records for people who have left that she can name.',
  '- She keeps message text for 30 days and who wrote each message for a year, never from tickets.',
  '- Staff discussion in a member\'s post is copied into Sophie\'s records. No AI reads any of it.',
  '-# Kept by Sophie. Staff can reply here, but replies will end up between her entries.',
].join('\n');
