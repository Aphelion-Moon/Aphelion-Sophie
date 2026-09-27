import test from 'node:test';
import assert from 'node:assert/strict';
import { canonicalCaseForm, requireCaseSubject, caseIntakeCommandOptions, PUBLIC_CASE_TYPES } from '../modules/tickets/intake.js';
import { caseIntakePages, renderCaseIntakeMessage } from '../modules/tickets/intake-messages.js';
import { requireCaseAccess } from '../modules/tickets/index.js';
import { caseChannelPayload } from '../modules/tickets/channel-policy.js';
import { createFormController, FORM_CATEGORIES } from '../apps/dashboard/form-controller.js';
import { createDashboardApi } from '../apps/dashboard/api.js';
import { createSyntheticFormApi } from './fixtures/dashboard-forms.js';
import { playerReportPayload, syntheticCaseForm, syntheticCaseValues } from './fixtures/case-intake.js';
import { syntheticInteractions } from './fixtures/interactions.js';
import { casePolicy, casePlan } from './fixtures/cases.js';
import { GUILD, USER, OTHER, NOW } from './fixtures/domain.js';

test('signed report entry keeps the requester and optional subject separate and rejects malformed user choices', () => {
  const f = syntheticInteractions();
  for (const subjectId of [null, OTHER]) {
    const payload = playerReportPayload(f, subjectId), envelope = f.verifier.verify(f.signed(payload));
    assert.equal(envelope.command, 'ticket.begin'); assert.equal(envelope.caseType, 'player-report');
    assert.equal(envelope.targetId, payload.member.user.id); assert.equal(envelope.subjectId, subjectId);
  }
  for (const field of [{ type: 6, name: 'player', value: null }, { type: 6, name: 'player' }, { type: 3, name: 'player', value: OTHER },
    { type: 6, name: 'participant', value: OTHER }, { type: 6, name: 'player', value: 'not-an-id' }]) {
    const payload = playerReportPayload(f); payload.data.options[0].options = [field]; assert.throws(() => f.verifier.verify(f.signed(payload)));
  }
  const duplicate = playerReportPayload(f, OTHER); duplicate.data.options[0].options.push({ ...duplicate.data.options[0].options[0] });
  assert.throws(() => f.verifier.verify(f.signed(duplicate)));
  assert.equal(PUBLIC_CASE_TYPES.includes('player-report'), false);
  assert.deepEqual(caseIntakeCommandOptions().find(row => row.name === 'report').options.map(row => row.type), [6]);
});

test('reported identity never changes case overwrites or grants participant access', () => {
  assert.doesNotThrow(() => requireCaseSubject('player-report', OTHER)); assert.doesNotThrow(() => requireCaseSubject('player-report', null));
  assert.throws(() => requireCaseSubject('admin-help', OTHER)); assert.throws(() => requireCaseSubject('player-report', '0'));
  const plan = { ...casePlan, type: 'player-report' }, payload = caseChannelPayload(plan, casePolicy, false);
  assert.equal(payload.permission_overwrites.some(row => row.id === OTHER), false);
  assert.throws(() => caseChannelPayload({ ...plan, subjectId: OTHER }, casePolicy, false));
  const actor = { guildId: GUILD, userId: OTHER, observedAt: NOW, known: true, present: true, roleIds: [] };
  assert.throws(() => requireCaseAccess({ actor, caseRecord: { guildId: GUILD, type: 'player-report', openerId: USER,
    participantIds: [], subjectId: OTHER }, roles: { staff: casePolicy.staff, leadOps: casePolicy.leadOps }, operation: 'read', now: NOW }), /CASE_ACCESS_DENIED/);
});

test('report delivery retains the exact selected identity as text with no user mention or extra audience', () => {
  const form = syntheticCaseForm('player-report'); assert.deepEqual(canonicalCaseForm(form), form);
  const pages = caseIntakePages({ caseType: form.caseType, form, formVersion: 1, answers: syntheticCaseValues(), subjectId: OTHER });
  assert.equal(pages.length, 3); assert.match(pages.at(-1).description, new RegExp(`user ID: ${OTHER}`));
  const payload = renderCaseIntakeMessage({ id: 'ab'.repeat(16), page: pages.at(-1), caseType: form.caseType, policy: casePolicy });
  assert.deepEqual(payload.allowed_mentions.users, []); assert.deepEqual(payload.allowed_mentions.roles, [casePolicy.staff]);
  assert.equal(JSON.stringify(payload).includes(`<@${OTHER}>`), false);
  const empty = caseIntakePages({ caseType: form.caseType, form, formVersion: 1, answers: syntheticCaseValues() });
  assert.match(empty.at(-1).description, /No Discord subject/);
});

test('the form editor and fixed transport independently author player-report configuration', async () => {
  const f = createSyntheticFormApi(); let sequence = 0;
  const controller = createFormController({ api: f.api, onChange: () => {}, newRequestId: () => (++sequence).toString(16).padStart(64, '0') });
  await controller.start(); await controller.selectResource('player-report'); assert.equal(controller.snapshot().overview.draft, null);
  controller.updateTitle('Synthetic report configuration'); controller.addField(); controller.updateField(0, 'label', 'Synthetic report question');
  await controller.save(); await controller.review(); assert.equal(controller.snapshot().review.valid, true); await controller.publish();
  assert.equal(f.state.records.get('player-report').publications.length, 1); assert.equal(f.state.records.get('admin-help').publications.length, 1);
  assert.equal(FORM_CATEGORIES.some(([id]) => id === 'player-report'), true);
  const paths = [], api = createDashboardApi({ fetch: async path => { paths.push(path); return Response.json({}); } });
  await api.formDraft('player-report'); assert.deepEqual(paths, ['/api/ticket-forms/draft?caseType=player-report']);
});
