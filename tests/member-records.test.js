import test from 'node:test';
import assert from 'node:assert/strict';
import {
  APPLICATION_NONE, MESSAGE_MAX, TITLE_MAX, accountCreatedMs, applicationAnswers, ageAt, birthLine, cleanLine, entryLabel, entryText, interpretBirth,
  interpretGameNames, jumpUrl, literal, recordTags, recordTitle, renderApplication, renderHeader, renderLedger, shortLabel, stamp, utcText,
} from '../modules/member-records/index.js';

// Synthetic data only. IDs are made up; the first is Discord's documented example snowflake.
const USER = '175928847299117063', GUILD = '100000000000000001', POST = '100000000000000002', STAFFER = '100000000000000003';
const APPROVED = Date.UTC(2026, 9, 30, 13, 2);

test('MR-01 account creation time comes from the Discord ID', () => {
  assert.equal(accountCreatedMs(USER), Date.UTC(2016, 3, 30, 11, 18, 25, 796));
  assert.throws(() => accountCreatedMs('not-an-id'), /INVALID_DISCORD_ID/);
});

test('MR-02 times: Discord timestamps for readers, written UTC for search', () => {
  assert.equal(stamp(APPROVED), `<t:${APPROVED / 1000}:D>`);
  assert.equal(stamp(APPROVED, 'R'), `<t:${APPROVED / 1000}:R>`);
  assert.equal(utcText(APPROVED), '30 Oct 2026, 13:02 UTC');
  assert.equal(jumpUrl(GUILD, POST, STAFFER), `https://discord.com/channels/${GUILD}/${POST}/${STAFFER}`);
});

test('MR-03 titles carry username, display name and ID, cleaned and within Discord\'s limit', () => {
  assert.equal(recordTitle({ userId: USER, username: 'vexthecat', displayName: 'Vex' }), `vexthecat · Vex · ${USER}`);
  assert.equal(recordTitle({ userId: USER, username: 'vex', displayName: 'VEX' }), `vex · ${USER}`);
  assert.equal(recordTitle({ userId: USER, username: 'vex', displayName: null }), `vex · ${USER}`);
  const long = recordTitle({ userId: USER, username: 'a'.repeat(60), displayName: `B\u0000\u200b${'b'.repeat(200)}` });
  assert.ok(long.length <= TITLE_MAX && long.endsWith(` · ${USER}`) && long.includes('…'));
  assert.ok(!/[\u0000\u200b]/.test(long));
  // NFC first composes Z and the acute into one letter; at most two further marks stay on each letter.
  assert.equal(cleanLine('Z\u0301\u0302\u0303\u0304alg\u0300\u0301\u0302o  \n x', 50), '\u0179\u0302\u0303alg\u0300\u0301o x');
});

test('MR-04 literal text cannot format, mention or link', () => {
  const shown = literal('# Heading\n**bold** @everyone <@123> [link](https://x.test) -# small\n1. list');
  assert.ok(!shown.includes('<@123>') && shown.includes('\\<\\@123\\>'));
  assert.ok(shown.startsWith('\\# Heading') && shown.includes('\\*\\*bold\\*\\*') && shown.includes('\\@everyone'));
  assert.ok(shown.includes('\\[link\\]\\(https://x.test\\)') && shown.includes('\\-\\# small') && shown.includes('1\\. list'));
  assert.equal(literal('a\r\n\r\n\r\n\r\nb'), 'a\n\nb');
});

test('MR-05 date of birth is read as a month and year', () => {
  const at = APPROVED;
  const month = (year, m) => ({ status: 'month', year, month: m, monthUnclear: false });
  for (const text of ['04/1998', '4/1998', '04-1998', '04.1998', '1998-04', '1998/4', 'April 1998', 'apr 1998', 'Apr. 98', '04/98', '041998', '25/04/1998', '04/25/1998', '1998-04-25', '4th April 1998'])
    assert.deepEqual(interpretBirth(text, at), month(1998, 4), text);
  assert.deepEqual(interpretBirth('12/04/1998', at), { status: 'year', year: 1998, month: null, monthUnclear: true });
  assert.deepEqual(interpretBirth('04/04/1998', at), month(1998, 4));
  assert.deepEqual(interpretBirth('1998', at), { status: 'year', year: 1998, month: null, monthUnclear: false });
  assert.deepEqual(interpretBirth('06/05', at), month(2005, 6));
  for (const text of ['', 'hello', '13/1998', '00/1998', '04/2031', '1850', 'April', '1/2/3/4'])
    assert.equal(interpretBirth(text, at).status, 'unreadable', text);
});

test('MR-06 age at approval is fixed, with a range where a month cannot settle it', () => {
  assert.deepEqual(ageAt({ status: 'month', year: 1998, month: 4 }, APPROVED), { min: 28, max: 28 });
  assert.deepEqual(ageAt({ status: 'month', year: 1998, month: 10 }, APPROVED), { min: 27, max: 28 });
  assert.deepEqual(ageAt({ status: 'month', year: 1998, month: 11 }, APPROVED), { min: 27, max: 27 });
  assert.equal(birthLine(interpretBirth('04/1998', APPROVED), APPROVED), '04/1998 (28 at approval)');
  assert.equal(birthLine(interpretBirth('12/04/1998', APPROVED), APPROVED), '1998, month unclear (27 or 28 at approval)');
  assert.equal(birthLine(interpretBirth('1998', APPROVED), APPROVED), '1998, month not given (27 or 28 at approval)');
  assert.equal(birthLine(interpretBirth('soon', APPROVED), APPROVED), 'could not be read; see the application');
});

test('MR-07 game accounts: labelled values as labelled, short unlabelled answers as named, prose left alone', () => {
  const games = (ckey, ckeyAsWritten, ss14, unlabelled = []) => ({ ckey, ckeyAsWritten, ss14, unlabelled });
  assert.deepEqual(interpretGameNames('BYOND: Vex Wolf, SS14: VexWolf'), games('vexwolf', 'Vex Wolf', 'VexWolf'));
  assert.deepEqual(interpretGameNames('ckey - vex_wolf / ss14 - none'), games('vexwolf', 'vex_wolf', null));
  assert.deepEqual(interpretGameNames('SS13: VexWolf (ckey vexwolf) SS14: n/a'), games('vexwolf', 'VexWolf', null));
  assert.deepEqual(interpretGameNames('My SS14 username is Vex_Wolf and my byond is vexwolf'), games('vexwolf', 'vexwolf', 'Vex_Wolf'));
  assert.deepEqual(interpretGameNames('vexwolf for both'), games('vexwolf', 'vexwolf', 'vexwolf'));
  assert.deepEqual(interpretGameNames(''), games(null, null, null));
  // Unlabelled names: what the question asked decides what they are.
  const current = 'What is your BYOND ckey and/or SS14 username? Please identify each.';
  assert.deepEqual(interpretGameNames('vexwolf', current), games(null, null, null, ['vexwolf']));
  assert.deepEqual(interpretGameNames('vexwolf, VexW', current), games(null, null, null, ['vexwolf', 'VexW']));
  assert.deepEqual(interpretGameNames('Vex Wolf, 04/1998', 'What is your BYOND Ckey? What is your MM/YYYY date of birth?'), games(null, null, null, ['Vex', 'Wolf']));
  assert.deepEqual(interpretGameNames('vexwolf2000 - 04/1998', 'What is your BYOND Ckey? What is your MM/YYYY date of birth?'), games('vexwolf2000', 'vexwolf2000', null));
  assert.deepEqual(interpretGameNames('DOB: 04/1998, ckey vexwolf', 'What is your BYOND Ckey? What is your MM/YYYY date of birth?'), games('vexwolf', 'vexwolf', null));
  assert.deepEqual(interpretGameNames('I have played on many servers over the years and this is my name', current), games(null, null, null));
});

test('MR-07b dates are found inside combined answers from older forms', () => {
  const month = (year, m) => ({ status: 'month', year, month: m, monthUnclear: false });
  for (const text of ['vexwolf 04/1998', 'vexwolf, 04/1998', 'vexwolf2000 - 04/1998', '04/1998 vexwolf', 'vex_wolf 04/1998', 'ckey: vex | 04/1998', 'Marcus 04/1998', 'vex 25/04/1998'])
    assert.deepEqual(interpretBirth(text, APPROVED), month(1998, 4), text);
  assert.deepEqual(interpretBirth('vexwolf', APPROVED).status, 'unreadable');
});

test('MR-08 the live questions get short labels; others keep a cut copy of their own', () => {
  assert.deepEqual([
    'We age-verify every applicant. … Do you agree to an age check?',
    'What is your date of birth? Month and year only, MM/YYYY (e.g. 04/1998).',
    'What is your BYOND ckey and/or SS14 username? Please identify each.',
    'What SS13 / SS14 servers have you played on before? Have you played any other true roleplaying games, TTRPGs, MMOs, or MUDs?',
    'How did you find Aphelion, and why do you want to join? If someone referred you, who? Separately: …',
  ].map(shortLabel), ['Age check', 'Born', 'Game accounts', 'Played before', 'Found us · why · furries']);
  assert.deepEqual([
    'What is your BYOND Ckey? What is your MM/YYYY date of birth?',
    'Do you accept having an age-check performed during the interview? You will need to provide an OBSCURED official document proving your age, with your CKEY',
    'Have you been banned from any other Space Station 13 server before? This isn\'t automatically disqualifying.',
    'What SS13 servers or roleplaying games have you played before?',
    'How did you find us? Why are you applying? What are your thoughts on furries?',
  ].map(shortLabel), ['Game account · born', 'Age check', 'Banned elsewhere', 'Played before', 'Found us · why · furries']);
  assert.equal(shortLabel('Favourite colour?'), 'Favourite colour?');
});

test('MR-09 tags follow presence and roles, at most five, keeping Watch', () => {
  assert.deepEqual(recordTags({ present: true, roles: { whitelist: true, staff: true } }), ['In server', 'Whitelisted', 'Staff']);
  assert.deepEqual(recordTags({ present: false, roles: {} }), ['Left']);
  assert.equal(recordTags({ present: true, roles: { whitelist: true, muzzled: true, leadOps: true }, watch: true }).length, 5);
});

const base = {
  userId: USER, username: 'vexthecat', displayName: 'Vex', present: true, roles: { crew: true, whitelist: true },
  joinedAtMs: APPROVED, joinCount: 1, lastLeftAtMs: null, shuttle: null, mutes: 0, application: null, earlierNames: [],
  note: null, updatedAtMs: APPROVED,
};

test('MR-10 the header summarises the member within one message', () => {
  const header = renderHeader({
    ...base, mutes: 2, earlierNames: ['oldvex'],
    shuttle: { startedAtMs: APPROVED - 3_130_000, completedAtMs: APPROVED, timing: { focusedMs: 845_000, pages: 23, wallMs: 3_130_000, fromStop: 0 } },
    application: { approvedAtMs: APPROVED, birth: interpretBirth('04/1998', APPROVED), games: interpretGameNames('BYOND: Vex Wolf, SS14: VexWolf') },
  });
  assert.ok(header.startsWith('## Vex (\\@vexthecat)\n'), 'the @ is escaped, so a name never reads as a mention');
  for (const part of [`<@${USER}>`, `\`${USER}\``, '**Status:** In server · Crew · Whitelisted', '· first join', '14m 05s focused (52m 10s from boarding) · 23 pages, average 37s a page',
    '2 mutes on record', '**Born:** 04/1998 (28 at approval)', '**Earlier names:** oldvex', 'SS13, Meridian Rift: vexwolf \\(written Vex Wolf\\) (given on application)',
    'SS14, Wolfgate: VexWolf (given on application)'])
    assert.ok(header.includes(part), part);
  assert.ok(header.length <= MESSAGE_MAX);
});

test('MR-11 a backfilled header says what it could not know', () => {
  const header = renderHeader({ ...base, displayName: 'vexthecat', joinCount: null, mutes: null, roles: { crew: true, staff: true, leadOps: true },
    note: 'Joined before records began: join date from Discord, earlier events not recorded.' });
  assert.ok(header.startsWith('## \\@vexthecat\n'));
  for (const part of ['earlier joins not recorded', '**Moderation:** not read yet', '**Born:** no application on record', 'In server · Crew · Staff · Lead Ops',
    'SS13, Meridian Rift: not on record', '-# Joined before records began'])
    assert.ok(header.includes(part), part);
  const old = Date.UTC(2026, 9, 24);
  assert.ok(renderHeader({ ...base, shuttle: { startedAtMs: old, completedAtMs: null, finished: true, timing: null } })
    .includes(`**Shuttle:** finished (boarded ${stamp(old)}) · reading time not recorded`));
  assert.ok(renderHeader({ ...base, shuttle: { startedAtMs: old, completedAtMs: null, finished: false, timing: null } })
    .includes(`**Shuttle:** boarded ${stamp(old)}, not finished`));
  assert.ok(renderHeader(base).includes('**Shuttle:** no Activity run on record'));
  const hostile = renderHeader({ ...base, displayName: '# @everyone **x**', earlierNames: Array.from({ length: 50 }, (_, i) => `n${i}${'x'.repeat(60)}`) });
  assert.ok(hostile.startsWith('## \\# \\@everyone \\*\\*x\\*\\* (\\@vexthecat)') && hostile.length <= MESSAGE_MAX);
});

test('MR-12 the ledger lists entries newest first as links and stays within one message', () => {
  const ledger = renderLedger([
    { atMs: APPROVED, label: 'Record opened · already in the server', messageId: '100000000000000010' },
    { atMs: APPROVED + 86_400_000, label: 'Muzzled', messageId: '100000000000000011' },
  ], { guildId: GUILD, channelId: POST });
  assert.equal(ledger, [
    '**Ledger** · 2 automatic entries · newest first',
    `\`2026-10-31\` [Muzzled](https://discord.com/channels/${GUILD}/${POST}/100000000000000011)`,
    `\`2026-10-30\` [Record opened · already in the server](https://discord.com/channels/${GUILD}/${POST}/100000000000000010)`,
  ].join('\n'));
  assert.equal(renderLedger([], { guildId: GUILD, channelId: POST }), '**Ledger** · no automatic entries yet');
  const many = renderLedger(Array.from({ length: 40 }, (_, i) => ({ atMs: APPROVED + i, label: `Entry ${i}`, messageId: String(100000000000000100n + BigInt(i)) })),
    { guildId: GUILD, channelId: POST });
  assert.ok(many.length <= MESSAGE_MAX && /-# \d+ older entries not listed here$/.test(many) && many.includes('[Entry 39]'));
});

test('MR-13 the application is transcribed with short labels, literally, split when long', () => {
  const short = renderApplication({ approvedAtMs: APPROVED, approvedBy: STAFFER, answers: [
    { label: 'Do you agree to an age check?', value: ['Yes'] }, { label: 'What is your date of birth?', value: '04/1998' },
    { label: 'What is your BYOND ckey and/or SS14 username?', value: 'BYOND: vex <@1>' }, { label: 'Rules', value: true }, { label: 'Other', value: '' },
  ] });
  assert.equal(short.length, 1);
  assert.ok(short[0].startsWith(`**Access application** · approved <t:${APPROVED / 1000}:D> by <@${STAFFER}>`));
  for (const part of ['**Age check**\nYes', '**Born**\n04/1998', '**Game accounts**\nBYOND: vex \\<\\@1\\>', '**Rules**\nAgreed', '**Other**\n*(no answer)*'])
    assert.ok(short[0].includes(part), part);
  const long = renderApplication({ approvedAtMs: APPROVED, approvedBy: null, answers: [
    { label: 'What SS13 / SS14 servers have you played on before?', value: 'word '.repeat(300) },
    { label: 'How did you find Aphelion?', value: `${'story '.repeat(330)}*end*` },
  ] });
  assert.ok(long.length >= 2 && long.every(message => message.length <= MESSAGE_MAX));
  assert.ok(long.slice(1).every(message => message.startsWith('-# Access application, continued')));
  assert.ok(long.join(' ').includes('\\*end\\*'));
  assert.throws(() => renderApplication({ approvedAtMs: APPROVED, approvedBy: 'x', answers: [] }), /INVALID_DISCORD_ID/);
});

test('MR-15 join-request form responses become answers; nothing else is read', () => {
  assert.deepEqual(applicationAnswers([
    { field_type: 'MULTIPLE_CHOICE', label: 'Age check?', choices: ['Yes', 'No'], response: 0 },
    { field_type: 'MULTIPLE_CHOICE', label: 'Odd', choices: ['Yes'], response: 7 },
    { field_type: 'TEXT_INPUT', label: 'Born?', response: '04/1998' },
    { field_type: 'PARAGRAPH', label: 'Why?', response: 42 },
    { field_type: 'TERMS', label: 'Rules', response: true },
    { field_type: 'TERMS', label: 'Rules again' },
  ]), [
    { label: 'Age check?', value: ['Yes'] }, { label: 'Odd', value: null }, { label: 'Born?', value: '04/1998' },
    { label: 'Why?', value: null }, { label: 'Rules', value: true }, { label: 'Rules again', value: true },
  ]);
  assert.throws(() => applicationAnswers(null), /INVALID_APPLICATION/);
  assert.ok(APPLICATION_NONE.startsWith('-# Reserved by Sophie: the access application.'));
});

test('MR-14 automatic entries carry a written UTC time; unknown kinds are refused', () => {
  assert.equal(entryText({ kind: 'record.opened', atMs: APPROVED, joinedAtMs: APPROVED - 1_000 }),
    `**Record opened** · 30 Oct 2026, 13:02 UTC · already in the server, joined ${stamp(APPROVED - 1_000)}. Events before this are not recorded.`);
  assert.equal(entryText({ kind: 'joined', atMs: APPROVED, joinCount: 2 }), '**Joined** · 30 Oct 2026, 13:02 UTC · join 2');
  assert.equal(entryText({ kind: 'left', atMs: APPROVED, hadWhitelist: true }),
    '**Left or removed** · 30 Oct 2026, 13:02 UTC (<t:1793365320:f>) · Whitelist ends; a fresh Shuttle run is needed to regain it');
  assert.equal(entryText({ kind: 'whitelist.granted', atMs: APPROVED, bySophie: true, timing: { focusedMs: 845_000, pages: 23, wallMs: 3_130_000, fromStop: 0 } }),
    '**Whitelist granted by Sophie** · 30 Oct 2026, 13:02 UTC · 14m 05s focused (52m 10s from boarding) · 23 pages');
  assert.equal(entryText({ kind: 'muzzled', atMs: APPROVED, by: STAFFER }), `**Muzzled** by <@${STAFFER}> · 30 Oct 2026, 13:02 UTC`);
  assert.equal(entryText({ kind: 'name.changed', atMs: APPROVED, from: 'a_b', to: 'c' }), '**Name changed** · 30 Oct 2026, 13:02 UTC · a\\_b → c');
  assert.equal(entryLabel({ kind: 'joined', joinCount: 1 }), 'Joined · first join');
  assert.throws(() => entryText({ kind: 'nope', atMs: APPROVED }), /MEMBER_RECORD_EVENT_UNKNOWN/);
  assert.throws(() => entryLabel({ kind: 'nope' }), /MEMBER_RECORD_EVENT_UNKNOWN/);
});
