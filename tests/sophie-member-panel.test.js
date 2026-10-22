import test from 'node:test';
import assert from 'node:assert/strict';
import { ContractError } from '../contracts/validation.js';
import { parseSophieControl, parseSophieNotes, renderSophieNotice, renderSophiePanel, renderSophieInvitation, sophieNotesModal,
  validateSophiePanel, SOPHIE_NOTES_FORM } from '../modules/assistant/member-panel.js';
import { createSophieMemberCommands } from '../apps/core/discord/sophie-member.js';
import { createAiMemberControls } from '../apps/core/runtime/ai-member.js';
import { syntheticInteractions } from './fixtures/interactions.js';
import { GUILD, OTHER } from './fixtures/domain.js';

const binding = 'b'.repeat(64);
const view = (state, extra = {}) => ({ state, optInAvailable: true, noticeRevision: 4, noticeText: 'Synthetic notice text.', noticeBinding: binding,
  notes: ['Synthetic note'], memories: { active: true, count: 2 }, retainOnLeave: false, direct: false, ...extra });
const ids = panel => panel.components.flatMap(row => row.components.map(item => item.custom_id));

test('panel controls parse to fixed commands and refuse anything else', () => {
  assert.deepEqual(parseSophieControl('sophie:me:v1:panel'), { command: 'sophie.panel' });
  assert.deepEqual(parseSophieControl('sophie:me:v1:delete-ask'), { command: 'sophie.delete.ask' });
  assert.deepEqual(parseSophieControl(`sophie:me:v1:agree:4:${binding}`), { command: 'sophie.agree', noticeRevision: 4, noticeBinding: binding });
  assert.deepEqual(parseSophieControl('sophie:me:v1:agree:1:none'), { command: 'sophie.agree', noticeRevision: 1, noticeBinding: null });
  assert.deepEqual(parseSophieControl('sophie:me:v1:retain:on'), { command: 'sophie.retain', retainOnLeave: true });
  for (const id of ['sophie:me:v1:grant', 'sophie:me:v1:agree:0:none', 'sophie:me:v1:agree:4:short', 'sophie:me:v1:retain:maybe', 'sophie:me:v1:panel:extra',
    'sophie:me:v2:panel', `sophie:me:v1:${'x'.repeat(100)}`]) assert.throws(() => parseSophieControl(id), /INTERACTION_COMPONENT_UNSUPPORTED/);
});

test('notes form keeps one note per line within the preference limits', () => {
  const form = value => ({ custom_id: SOPHIE_NOTES_FORM, components: [{ type: 1, components: [{ type: 4, custom_id: 'notes', value }] }] });
  assert.deepEqual(parseSophieNotes(form(' I play engineers \n\nCall me Sam\nCall me Sam')), ['I play engineers', 'Call me Sam']);
  assert.deepEqual(parseSophieNotes(form('')), []);
  assert.throws(() => parseSophieNotes(form(Array.from({ length: 9 }, (_, i) => `Note ${i}`).join('\n'))), /INTERACTION_FORM_INVALID/);
  assert.throws(() => parseSophieNotes(form('x'.repeat(201))), /INTERACTION_FORM_INVALID/);
  assert.throws(() => parseSophieNotes({ ...form('ok'), custom_id: 'sophie:me:v1:other' }), /INTERACTION_FORM_INVALID/);
  const modal = sophieNotesModal(['One', 'Two']);
  assert.equal(modal.type, 9); assert.equal(modal.data.components[0].components[0].value, 'One\nTwo');
});

test('the panel offers Yes only with an approved notice, No only after a Yes, and stays within Discord limits', () => {
  assert.deepEqual(ids(renderSophiePanel(view('none'))).slice(0, 2), ['sophie:me:v1:notice', 'sophie:me:v1:notes']);
  const yes = ids(renderSophiePanel(view('yes')));
  assert.equal(yes.includes('sophie:me:v1:notice'), false); assert.ok(yes.includes('sophie:me:v1:no'));
  assert.ok(ids(renderSophiePanel(view('renew'))).includes('sophie:me:v1:notice'));
  assert.equal(ids(renderSophiePanel(view('none', { optInAvailable: false }))).includes('sophie:me:v1:notice'), false);
  assert.equal(ids(renderSophiePanel(view('yes', { direct: true }))).includes('sophie:me:v1:dm'), false);
  assert.deepEqual(ids(renderSophiePanel(view('deleting'))), ['sophie:me:v1:panel']);
  for (const state of ['yes', 'renew', 'no', 'none', 'deleting', 'unavailable']) validateSophiePanel(renderSophiePanel(view(state)));
  validateSophiePanel(renderSophieInvitation());
  assert.throws(() => validateSophiePanel({ content: '', components: [{ type: 1, components: [{ type: 2, label: 'x', custom_id: 'sophie:ticket:v1:open' }] }] }), /SOPHIE_PANEL_INVALID/);
});

test('a Yes is offered only for the whole notice, naming its revision and binding', () => {
  assert.ok(ids(renderSophieNotice(view('none'))).includes(`sophie:me:v1:agree:4:${binding}`));
  for (const variant of [{ noticeText: 'x'.repeat(4097) }, { optInAvailable: false }, { noticeText: null }])
    assert.deepEqual(ids(renderSophieNotice(view('none', variant))), ['sophie:me:v1:panel']);
});

test('the verifier admits /sophie, panel buttons and the notes form, and panel buttons in the bot DM only', () => {
  const f = syntheticInteractions();
  const command = f.mint({ data: { type: 1, name: 'sophie' } });
  assert.equal(command.command, 'sophie.panel'); assert.equal(command.component, false); assert.equal(command.userId, OTHER);
  const button = f.mint({ type: 3, message: { id: '800000000000000001' }, data: { component_type: 2, custom_id: 'sophie:me:v1:export' } });
  assert.equal(button.command, 'sophie.export'); assert.equal(button.component, true); assert.equal(button.direct, false);
  const dm = { type: 3, guild_id: undefined, context: 1, authorizing_integration_owners: { '0': '0' }, member: undefined, user: { id: OTHER, bot: false },
    message: { id: '800000000000000002' }, data: { component_type: 2, custom_id: 'sophie:me:v1:panel' } };
  const direct = f.mint(dm);
  assert.equal(direct.direct, true); assert.equal(direct.guildId, GUILD); assert.equal(direct.userId, OTHER);
  assert.deepEqual(f.verifier.resolvePrincipal(direct), { guildId: GUILD, userId: OTHER });
  assert.throws(() => f.mint({ ...dm, data: { component_type: 2, custom_id: 'sophie:ticket:v1:open:general' } }), /FOREIGN_GUILD/);
  assert.throws(() => f.mint({ ...dm, authorizing_integration_owners: { '0': GUILD } }), /FOREIGN_GUILD/);
  assert.throws(() => f.mint({ ...dm, user: { id: OTHER, bot: true } }), /BOT_ACTOR_DENIED/);
  const notes = f.mint({ type: 5, data: { custom_id: SOPHIE_NOTES_FORM, components: [{ type: 1, components: [{ type: 4, custom_id: 'notes', value: 'Synthetic note' }] }] } });
  assert.equal(notes.command, 'sophie.notes.save'); assert.equal(Object.hasOwn(notes, 'notes'), false);
  assert.deepEqual(f.verifier.takeSophieNotes(notes), ['Synthetic note']);
  assert.throws(() => f.verifier.takeSophieNotes(notes), /UNTRUSTED_SOPHIE_NOTES/);
});

function adapter({ member: overrides = {}, notes = ['Synthetic note'] } = {}) {
  const calls = [], actor = Object.freeze({ guildId: GUILD, userId: OTHER });
  const member = { status: async () => view('none'), setChoice: async input => { calls.push(['setChoice', input]); }, saveNotes: async input => { calls.push(['saveNotes', input]); },
    setRetainOnLeave: async input => { calls.push(['retain', input]); }, forgetMemories: async () => { calls.push(['forget']); }, deleteData: async () => { calls.push(['delete']); },
    exportData: async () => ({ kind: 'sophie-member-data', notes: { notes } }), ...overrides };
  const sent = [];
  const commands = createSophieMemberCommands({ authorization: { resolveActor: async () => actor }, member, verifier: { takeSophieNotes: () => notes },
    transport: { createSophieDm: async () => ({ id: '900000000000000001' }), sendSophieDm: async (id, panel) => { sent.push([id, panel]); } },
    guildId: GUILD, enabled: async () => true });
  const envelope = (command, extra = {}) => Object.freeze({ guildId: GUILD, userId: OTHER, targetId: OTHER, command, component: true, direct: false, ...extra });
  return { commands, calls, sent, envelope, actor };
}

test('panel commands do one action each and show the current state afresh', async () => {
  const f = adapter(), agree = f.envelope('sophie.agree', { noticeRevision: 4, noticeBinding: binding });
  assert.equal(await f.commands.execute(agree), 'sophie_panel');
  assert.deepEqual(f.calls.at(-1), ['setChoice', { actor: f.actor, enabled: true, noticeRevision: 4, noticeBinding: binding }]);
  assert.match((await f.commands.view(agree)).content, /Sophie can talk with you now/);
  const exported = f.envelope('sophie.export');
  assert.equal(await f.commands.execute(exported), 'sophie_panel');
  const body = await f.commands.view(exported);
  assert.equal(body.files[0].name, 'sophie-my-data.json'); assert.match(body.files[0].content, /Synthetic note/);
  const refreshed = f.envelope('sophie.panel'); await f.commands.execute(refreshed);
  assert.deepEqual((await f.commands.view(refreshed)).attachments, []);
  const dm = f.envelope('sophie.dm'); await f.commands.execute(dm);
  assert.equal(f.sent.length, 1); assert.equal(f.sent[0][1].components.flatMap(row => row.components).some(item => item.custom_id === 'sophie:me:v1:dm'), false);
  assert.equal((await f.commands.view(f.envelope('sophie.delete.ask')).catch(error => error.code)), 'INTERACTION_RESPONSE_INVALID');
});

test('a stale Yes shows the current panel, refusals stay refusals, and someone else\'s envelope is denied', async () => {
  const stale = adapter({ member: { setChoice: async () => { throw new ContractError('AI_NOTICE_STALE'); } } });
  const agree = stale.envelope('sophie.agree', { noticeRevision: 3, noticeBinding: binding });
  assert.equal(await stale.commands.execute(agree), 'sophie_panel'); assert.match((await stale.commands.view(agree)).content, /changed while you were looking/);
  const denied = adapter({ member: { deleteData: async () => { throw new ContractError('OPERATION_DENIED'); } } });
  assert.equal(await denied.commands.execute(denied.envelope('sophie.delete')), 'denied');
  const broken = adapter({ member: { forgetMemories: async () => { throw new Error('synthetic failure'); } } });
  assert.equal(await broken.commands.execute(broken.envelope('sophie.forget')), 'unavailable');
  const f = adapter();
  assert.equal(await f.commands.execute(f.envelope('sophie.panel', { targetId: '123456789012345678' })), 'denied');
  const invalid = adapter({ member: { saveNotes: async () => { throw new ContractError('AI_PREFERENCE_INVALID'); } } });
  const notes = invalid.envelope('sophie.notes.save');
  assert.equal(await invalid.commands.execute(notes), 'sophie_panel'); assert.match((await invalid.commands.view(notes)).content, /couldn’t be saved/);
});

test('member use cases accept only the notice shown, share notes under the Yes and queue erasure after the No', async () => {
  const actor = { guildId: GUILD, userId: OTHER }, calls = [];
  const choice = { deletionPending: false, noticeRevision: 4, noticeBinding: binding, noticeText: 'Synthetic', optInAvailable: true, choice: { enabled: false, epoch: 2, current: false } };
  const controls = { ownChoice: async () => choice, memberConsent: async input => { calls.push(['consent', input]); return {}; },
    ownPreferences: async () => ({ available: true, quarantined: false, epoch: 7, settings: null, retainOnLeave: false, expiresAt: null }),
    savePreferences: async input => { calls.push(['save', input]); }, saveRetention: async input => { calls.push(['retention', input]); },
    ownMemories: async () => ({ available: true, active: true, memories: [] }), forgetAllMemories: async () => {}, exportConsents: async () => ({ choice: null, channels: [] }),
    prepareDeletion: async input => { calls.push(['prepare', input]); } };
  const member = createAiMemberControls({ controls, requestErasure: async userId => { calls.push(['erase', userId]); } });
  await assert.rejects(member.setChoice({ actor, enabled: true, noticeRevision: 3, noticeBinding: binding }), /AI_NOTICE_STALE/);
  await member.setChoice({ actor, enabled: true, noticeRevision: 4, noticeBinding: binding });
  assert.deepEqual(calls.at(-1), ['consent', { actor, enabled: true, expectedEpoch: 2, acceptedNoticeRevision: 4, acceptedNoticeBinding: binding }]);
  await member.saveNotes({ actor, notes: ['Synthetic'] });
  assert.deepEqual(calls.at(-1)[1].settings, { replyLength: null, language: null, notes: ['Synthetic'], useWithAi: true });
  await member.deleteData({ actor });
  assert.deepEqual(calls.slice(-2).map(call => call[0]), ['prepare', 'erase']);
  assert.equal((await member.status({ actor })).state, 'no');
  const exported = await member.exportData({ actor });
  assert.equal(exported.kind, 'sophie-member-data'); assert.deepEqual(exported.memories, []);
});
