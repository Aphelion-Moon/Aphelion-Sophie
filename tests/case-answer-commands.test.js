import test from 'node:test';
import assert from 'node:assert/strict';
import { ContractError } from '../contracts/validation.js';
import { syntheticInteractions, APPLICATION } from './fixtures/interactions.js';
import { GUILD, NOW } from './fixtures/domain.js';
import { createCaseAnswerCommands } from '../apps/core/discord/case-answer-commands.js';
import { createAdministrationCommands } from '../apps/core/discord/onboarding-commands.js';
import { createInteractionResponder } from '../apps/core/discord/interaction-response.js';
import { administrationCommandDefinitions } from '../apps/core/discord/command-registration.js';
import { answerReplyReviewMessage } from '../apps/core/discord/answer-reply-message.js';

const token = 'a'.repeat(48), reference = { name: 'synthetic-help', revision: 1, sha256: 'b'.repeat(64) };
const view = { state: 'review', token, channelId: '123', version: 2, answer: reference,
  document: { title: 'Approved public answer', text: 'Synthetic public text @everyone', source: 'Synthetic public guide' } };
const entry = f => f.payload({ data: { type: 1, name: 'ticket', options: [{ type: 1, name: 'answer', options: [
  { type: 3, name: 'case', value: 'synthetic-case@2' }, { type: 3, name: 'name', value: reference.name },
] }] } });
const control = (f, action = 'confirm') => f.payload({ type: 3, message: { id: '123' },
  data: { component_type: 2, custom_id: `sophie:answer-reply:${action}:${token}` } });
function fixture() {
  const f = syntheticInteractions(), state = { enabled: true, calls: [], result: { state: 'pending' }, view };
  const call = async (method, args) => { state.calls.push({ method,args }); if (state.error) throw state.error;
    return method === 'read' ? state.view : method === 'cancel' ? { state: state.cancelState ?? 'cancelled' } : state.result; };
  const commands = createCaseAnswerCommands({ guildId: GUILD, enabled: () => state.enabled,
    authorization: { resolveActor: async envelope => f.verifier.resolvePrincipal(envelope) },
    store: { describeCase: async () => ({ channelId: '123' }) },
    replies: { prepareAnswerReview: args => call('prepare',args), readAnswerReview: args => call('read',args),
      confirmAnswerReview: args => call('confirm',args), cancelAnswerReview: args => call('cancel',args) } });
  return { ...f,state,commands, verify: raw => f.verifier.verify(f.signed(raw)) };
}
test('signed case-answer preparation and controls keep text out of routing and match fixed registration', () => {
  const f = fixture(), parsed = f.verify(entry(f)); assert.equal(parsed.command, 'ticket.answer');
  assert.equal(parsed.answerName, reference.name); assert.equal(parsed.expectedVersion, 2);
  for (const action of ['confirm','cancel']) { const value = f.verify(control(f,action)); assert.equal(value.command, `ticket.answer.${action}`); assert.equal(value.reviewToken, token); }
  assert.equal(JSON.stringify(parsed).includes(view.document.text), false);
  const command = administrationCommandDefinitions().find(value => value.name === 'ticket');
  assert.ok(command.options.length <= 25); assert.deepEqual(command.options.find(value => value.name === 'answer').options.map(value => value.name), ['case','name']);
});
test('invalid controls and extra or forged selection fields are rejected before routing', () => {
  const f = fixture();
  for (const change of [raw => { raw.data.options[0].options.push({ type: 3,name: 'text',value: 'Unapproved copy' }); },
    raw => { raw.data.options[0].options[1].value = 'https://example.invalid'; }, raw => { raw.data.options[0].options[1].name = 'case'; }]) {
    const raw = entry(f); change(raw); assert.throws(() => f.verify(raw));
  }
  for (const value of ['sophie:answer-reply:confirm:x',`sophie:answer-reply:send:${token}`,`sophie:answer-reply:cancel:${token}:extra`]) {
    const raw = control(f); raw.data.custom_id = value; assert.throws(() => f.verify(raw));
  }
});
test('preparation has stable redelivery identity; confirm/cancel use only the current signed actor and review token', async () => {
  const f = fixture(), raw = entry(f), router = createAdministrationCommands({ caseAnswers: f.commands });
  assert.equal(await router.execute(f.verify(raw)), 'case_answer_review'); await router.execute(f.verify(raw));
  assert.deepEqual(f.state.calls[0],f.state.calls[1]); assert.match(f.state.calls[0].args.requestId,/^[a-f0-9]{64}$/);
  assert.equal(await router.execute(f.verify(control(f))), 'case_reply_recorded'); assert.equal(f.state.calls.at(-1).args.token, token);
  assert.equal(await router.execute(f.verify(control(f,'cancel'))), 'case_answer_cancelled');
  f.state.cancelState = 'submitted'; assert.equal(await router.execute(f.verify(control(f,'cancel'))), 'case_answer_submitted');
  assert.equal(await createAdministrationCommands({}).execute(f.verify(raw)), 'denied');
});
test('stale, blocked, forged and uncertain actions give truthful bounded outcomes without source text', async () => {
  const f = fixture(); assert.equal(await f.commands.execute({ ...f.verify(entry(f)) }), 'denied');
  f.state.enabled = false; assert.equal(await f.commands.execute(f.verify(control(f))), 'disabled'); f.state.enabled = true;
  for (const [code,status] of [['ANSWER_REVIEW_STALE','case_answer_stale'],['CASE_ANSWER_REVIEW_STALE','case_answer_stale'],
    ['CASE_ACCESS_DENIED','denied'],['CASE_REPLY_LIMIT','case_reply_limit'],['CASE_ANSWER_REVIEW_LIMIT','case_answer_limit']]) {
    f.state.error = new ContractError(code); assert.equal(await f.commands.execute(f.verify(control(f))),status);
  }
  f.state.error = new Error(view.document.text);
  assert.equal(await f.commands.execute(f.verify(control(f))), 'case_reply_uncertain');
  assert.equal(await f.commands.execute(f.verify(control(f,'cancel'))), 'case_answer_cancel_uncertain');
  assert.equal(await f.commands.execute(f.verify(entry(f))), 'case_answer_unavailable');
});
test('private review renders full approved copy and bounded controls; follow-up responses remove controls and suppress mentions', async () => {
  const f = fixture(), sent = [], responder = createInteractionResponder({ verifier: f.verifier,applicationId: APPLICATION,clock: () => NOW,
    enabled: () => true,caseAnswers: f.commands,fetch: async (url,options) => { sent.push(JSON.parse(options.body)); return new Response(null,{status:200}); } });
  await responder.respond(f.verify(entry(f)),'case_answer_review'); assert.equal(sent[0].embeds[0].description,view.document.text);
  assert.deepEqual(sent[0].allowed_mentions.parse,[]); assert.ok(sent[0].components[0].components.every(button => button.custom_id.length <= 100));
  const maximal = answerReplyReviewMessage({ ...view,document: { title:'t'.repeat(80),text:'x'.repeat(4000),source:'s'.repeat(300) } });
  assert.equal(maximal.embeds[0].description.length,4000); assert.ok(maximal.content.length <= 2000);
  await responder.respond(f.verify(control(f)),'case_reply_recorded'); assert.deepEqual(sent[1].components,[]); assert.deepEqual(sent[1].embeds,[]);
  f.state.error = new ContractError('ANSWER_REVIEW_STALE'); await responder.respond(f.verify(entry(f)),'case_answer_review');
  assert.deepEqual(sent[2].components,[]); assert.deepEqual(sent[2].embeds,[]);
});
