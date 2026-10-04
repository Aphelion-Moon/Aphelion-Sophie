import assert from 'node:assert/strict';
import { DASHBOARD_COOKIES } from '../../contracts/dashboard-auth.js';
import { dashboardHttp, dashboardBytes } from './dashboard-http.js';
import { syntheticCaseForm, syntheticCaseValues } from './case-intake.js';
import { waitForGateway } from './gateway-server.js';
import { USER, OTHER, LEAD } from './domain.js';
import { PUBLIC_CHANNEL } from './automation.js';

/** Actual composed routes, synthetic contents and identities only. */
export async function exerciseExcludedCaseArtifacts(f, sendMessage) {
  f.discord.state.members.set(OTHER, [LEAD]);
  const start = await dashboardHttp(f.addresses.dashboard, '/auth/start');
  assert.equal(start.status, 303);
  const state = new URL(start.headers.location).searchParams.get('state'), cookie = start.headers['set-cookie'][0].split(';')[0];
  const done = await dashboardHttp(f.addresses.dashboard, `/auth/callback?state=${state}&code=${f.oauth.issueCode(OTHER)}`, { headers: { Cookie: cookie } });
  assert.equal(done.status, 303);
  const session = done.headers['set-cookie'].find(value => value.startsWith(`${DASHBOARD_COOKIES.session}=`)).split(';')[0];
  const status = await dashboardHttp(f.addresses.dashboard, '/auth/session', { headers: { Cookie: session } });
  assert.equal(status.status, 200); assert.equal(status.body.canEditForms, true);
  const headers = { Cookie: session, Origin: f.config.dashboard.origin, 'Content-Type': 'application/json', 'X-CSRF-Token': status.body.csrfToken };
  const get = path => dashboardHttp(f.addresses.dashboard, path, { headers });
  const post = (path, body) => dashboardHttp(f.addresses.dashboard, path, { method: 'POST', headers, body: JSON.stringify(body) });
  async function publishForm(caseType, requestPrefix) {
    const draft = await post('/api/ticket-forms/save', { caseType, requestId: requestPrefix.repeat(64), expectedRevision: 0, document: syntheticCaseForm(caseType) });
    assert.equal(draft.status, 200, JSON.stringify(draft.body));
    const review = await get(`/api/ticket-forms/review?caseType=${caseType}&revision=${draft.body.revision}`);
    assert.equal(review.status, 200); assert.equal(review.body.valid, true);
    const published = await post('/api/ticket-forms/publish', { caseType, requestId: (requestPrefix + 'a').repeat(32), expectedRevision: review.body.draft.revision,
      expectedHash: review.body.draft.sha256, expectedLatestVersion: review.body.latest?.version ?? 0, expectedLatestStatus: review.body.latest?.status ?? 'none' });
    assert.equal(published.status, 200, JSON.stringify(published.body));
  }
  await publishForm('staff-contact', '1');
  const selection = await post('/api/contacts/select', { requestId: '2'.repeat(64), recipientIds: [USER] });
  assert.equal(selection.status, 200, JSON.stringify(selection.body));
  const confirmed = await post('/api/contacts/confirm', { formToken: selection.body.token, confirmed: true });
  assert.equal(confirmed.status, 200); assert.equal(confirmed.body.form.caseType, 'staff-contact');
  const values = syntheticCaseValues(); values[0].value = 'EXCLUDED_SENTINEL_FORM';
  const submitted = await post('/api/contacts/submit', { requestId: '3'.repeat(64), formToken: selection.body.token, values, confirmed: true });
  assert.equal(submitted.status, 200); assert.equal(submitted.body.recorded, true);
  // Intake can first run while provisioning is pending. Respect its real database
  // retry time rather than treating a few immediate worker ticks as delivery.
  await waitForGateway(async () => {
    await f.runtime.runOnce();
    const messages = await f.rows('case_intake_messages');
    return messages.length === 3 && messages.every(row => row.state === 'confirmed');
  }, 10000);
  const destination = await get(`/api/contacts/destination?requestId=${'3'.repeat(64)}`);
  assert.equal(destination.status, 200); assert.equal(destination.body.state, 'ready');
  const channelId = destination.body.channelId;
  const ticket = (await f.rows('case_reservations')).find(row => row.channel_id === channelId);
  const provision = (await f.rows('case_provisions')).find(row => row.case_id === ticket.id);
  assert.deepEqual((await f.rows('case_intakes'))[0].answers, values);
  assert.ok([...f.discord.state.messages.values()].some(message => message.channel_id === channelId &&
    message.embeds?.some(embed => embed.description.includes('EXCLUDED\\_SENTINEL\\_FORM'))),
  'The confirmed private intake must contain the escaped form sentinel');
  assert.ok((await f.rows('case_exclusions')).some(row => row.channel_id === channelId));
  await f.aiProbe.qualifyCase(channelId);

  const note = await post('/api/cases/notes/append', { channelId, requestId: '4'.repeat(64), text: 'EXCLUDED_SENTINEL_NOTE' });
  assert.equal(note.status, 200);
  const notes = await get(`/api/cases/notes?channelId=${channelId}`);
  assert.equal(notes.status, 200); assert.ok(JSON.stringify(notes.body).includes('EXCLUDED_SENTINEL_NOTE'));
  const messageId = await sendMessage(channelId, 'EXCLUDED_SENTINEL_MESSAGE', { attachments: [{ id: '991', filename: 'EXCLUDED_SENTINEL_FILE.txt',
    size: 32, content_type: 'text/plain', url: `https://cdn.discordapp.com/attachments/${channelId}/991/synthetic.txt` }] });
  await waitForGateway(async () => (await f.rows('case_message_observations')).some(row => row.message_id === messageId));
  const transcriptPath = `/api/cases/transcript?caseToken=${provision.operation_token}&channelId=${channelId}`;
  const transcript = await get(transcriptPath);
  assert.equal(transcript.status, 200); assert.ok(transcript.body.html.includes('EXCLUDED_SENTINEL_MESSAGE'));
  assert.ok(transcript.body.html.includes('EXCLUDED_SENTINEL_FILE')); assert.equal(transcript.body.html.includes('EXCLUDED_SENTINEL_NOTE'), false);
  const scope = { caseToken: provision.operation_token, channelId };
  const review = await post('/api/cases/export/review', scope);
  assert.equal(review.status, 200); assert.equal(review.body.observations, 1);
  const exported = await dashboardBytes(f.addresses.dashboard, '/api/cases/export/download', { method: 'POST', headers,
    body: JSON.stringify({ ...scope, requestId: '5'.repeat(64), reviewHash: review.body.reviewHash, confirmed: true }) });
  assert.equal(exported.status, 200); assert.ok(exported.text.includes('EXCLUDED_SENTINEL_MESSAGE'));
  assert.ok(exported.text.includes('EXCLUDED_SENTINEL_FILE')); assert.equal(exported.text.includes('EXCLUDED_SENTINEL_NOTE'), false);

  const positiveLookup = await post('/api/knowledge/lookup', { query: 'public beacon' });
  assert.equal(positiveLookup.status, 200); assert.equal(positiveLookup.body.sources.length, 1);
  for (const query of [ticket.id, `${f.config.dashboard.origin}${transcriptPath}`]) {
    const result = await post('/api/knowledge/lookup', { query });
    assert.equal(result.status, 200, JSON.stringify(result.body)); assert.deepEqual(result.body.sources, []);
  }
  // The standalone member command in the public channel opens an unfilled form.
  // This does not stand in for acceptance of a separate AI-to-Staff contact control.
  await publishForm('admin-help', '6');
  const modal = await f.send(f.identities.payload({ channel_id: PUBLIC_CHANNEL, member: { user: { id: USER } }, data: { type: 1, name: 'ticket',
    options: [{ type: 1, name: 'open', options: [{ type: 3, name: 'type', value: 'admin-help' }] }] } }));
  assert.equal(modal.body.type, 9);
  const fields = modal.body.data.components.map(row => row.component);
  assert.equal(fields.length, 2); assert.ok(fields.every(field => field.value === undefined && field.values === undefined));
  assert.equal(JSON.stringify(modal.body).includes('public beacon'), false);
  assert.equal(f.aiProbe.calls.worker.length, 1); assert.equal(f.aiProbe.calls.knowledge.length, 1);
  return messageId;
}

export async function assertNoCaseSentinelsInAiStorage(admin) {
  const tables = (await admin.query("SELECT schemaname,tablename FROM pg_tables WHERE schemaname IN ('sophie_ai','sophie_knowledge') ORDER BY 1,2")).rows;
  assert.ok(tables.some(row => row.schemaname === 'sophie_knowledge' && row.tablename === 'chunks'));
  for (const { schemaname, tablename } of tables) {
    assert.match(schemaname, /^sophie_(ai|knowledge)$/); assert.match(tablename, /^[a-z_]+$/);
    const found = await admin.query(`SELECT 1 FROM ${schemaname}.${tablename} stored
      WHERE strpos(replace(to_jsonb(stored)::text,chr(92),''),'EXCLUDED_SENTINEL')>0 LIMIT 1`);
    assert.equal(found.rowCount, 0, `${schemaname}.${tablename} retained excluded material`);
  }
}
