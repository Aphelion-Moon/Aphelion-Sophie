import assert from 'node:assert/strict';
import { formAuthoringWorkflow, formAuthoringServices, formRequestId } from '../../tests/fixtures/case-form-authoring.js';
import { syntheticCaseForm, syntheticCaseValues } from '../../tests/fixtures/case-intake.js';
import { dashboardHttp as http } from '../../tests/fixtures/dashboard-http.js';
import { dashboardConfiguration } from '../../tests/fixtures/oauth.js';
import { GUILD, USER, OTHER, STAFF, LEAD } from '../../tests/fixtures/domain.js';
import { FORM_CASE_TYPES } from '../../modules/tickets/intake.js';
import { DASHBOARD_COOKIES } from '../../contracts/dashboard-auth.js';
import { createDashboardAuthHttpServer } from '../../apps/core/http/dashboard-auth.js';
import { authDigest, sessionCsrf } from '../../apps/core/security/dashboard-auth.js';
import { createDashboardApi } from '../../apps/dashboard/api.js';
import { createFormController } from '../../apps/dashboard/form-controller.js';

/** Authored synthetic configuration and locally simulated intake only. */
export async function runCaseFormAuthoringSuite(cluster, run) {
  const scenario = (name, work) => run(name, async () => work(await formAuthoringWorkflow(cluster)));
  const read = async (f, caseType = 'admin-help') => f.formEditor.readCaseFormDraft({ actor: await f.formActor(), caseType });
  const saveRequest = async f => ({ actor: await f.formActor(), caseType: 'admin-help', requestId: formRequestId(), expectedRevision: 0, document: syntheticCaseForm() });
  const publishRequest = async f => ({ actor: await f.formActor(), ...f.publishFormRequest(await f.reviewForm((await read(f)).draft.revision)) });
  const withdrawRequest = async (f, version = 1) => ({ actor: await f.formActor(), caseType: 'admin-help', requestId: formRequestId(), version, confirm: true,
    expectedHash: (await f.formEditor.readCaseFormPublication({ actor: await f.formActor(), caseType: 'admin-help', version })).sha256 });
  const age = f => f.admin.query("UPDATE sophie_core.case_form_slots SET issued_at = clock_timestamp() - interval '4 seconds'");
  async function withServer(f, work) {
    const session = await f.login(), headers = { Cookie: `${DASHBOARD_COOKIES.session}=${session.token}`,
      Origin: dashboardConfiguration.origin, 'X-CSRF-Token': sessionCsrf(session.token), 'Content-Type': 'application/json' };
    const faults = [], server = createDashboardAuthHttpServer({ configuration: dashboardConfiguration, auth: f.auth,
      authorization: f.dashboardAuthorization, formAuthoring: f.formHttp, enabled: () => f.clock.enabled, onFault: value => faults.push(value) });
    try {
      const address = await server.listen(), get = (path, options = {}) => http(address, path, { headers, ...options });
      const post = (path, body, extra = {}) => http(address, path, { method: 'POST', headers: { ...headers, ...extra }, body: JSON.stringify(body) });
      await work({ get, post, address, headers, session, faults });
    } finally { await server.close(); }
  }

  await scenario('Z01 incomplete form drafts retain exact revision provenance without publishing or reserving any case', async f => {
    assert.equal((await read(f)).draft, null);
    const empty = { caseType: 'admin-help', title: '', fields: [] }, first = await f.saveForm(empty), second = await f.saveForm(syntheticCaseForm(), 1);
    assert.equal(first.revision, 1); assert.equal(second.revision, 2); assert.notEqual(first.sha256, second.sha256);
    assert.deepEqual((await f.formEditor.readCaseFormDraft({ actor: await f.formActor(), caseType: 'admin-help', revision: 1 })).draft.document, empty);
    assert.equal((await read(f)).draft.authorId, OTHER); assert.equal((await f.rows('case_form_drafts')).length, 2);
    assert.deepEqual((await f.rows('case_form_editor_actions')).map(row => [row.before_revision, row.after_revision]), [[0, 1], [1, 2]]);
    for (const table of ['case_forms', 'case_intakes', 'case_form_slots', 'outbox']) assert.equal((await f.rows(table)).length, 0);
    assert.equal(f.discord.state.calls.some(call => call.method !== 'GET'), false);
  });

  await scenario('Z02 replay is bound to the actor, category and exact canonical action and cannot use copied authority', async f => {
    const request = await saveRequest(f); assert.equal((await f.formEditor.saveCaseFormDraft(request)).duplicate, false);
    assert.equal((await f.formEditor.saveCaseFormDraft(request)).duplicate, true);
    await assert.rejects(f.formEditor.saveCaseFormDraft({ ...request, document: { ...request.document, title: 'Changed' } }), /CASE_FORM_EDITOR_REQUEST_COLLISION/);
    await assert.rejects(f.formEditor.saveCaseFormDraft({ ...request, caseType: 'tech-support', document: syntheticCaseForm('tech-support') }), /CASE_FORM_EDITOR_REQUEST_COLLISION/);
    f.discord.state.members.set(USER, [LEAD]); await assert.rejects(f.formEditor.saveCaseFormDraft({ ...request, actor: await f.formActor(USER) }), /CASE_FORM_EDITOR_REQUEST_COLLISION/);
    await assert.rejects(f.formEditor.saveCaseFormDraft({ ...request, actor: { ...request.actor } }), /OPERATION_DENIED/);
    await assert.rejects(f.formEditor.publishCaseFormDraft({ ...await publishRequest(f), requestId: request.requestId }), /CASE_FORM_EDITOR_REQUEST_COLLISION/);
    assert.equal((await f.rows('case_form_editor_actions')).length, 1);
  });

  await scenario('Z03 concurrent editors cannot overwrite revisions and identical retries append once', async f => {
    const request = await saveRequest(f), results = await Promise.allSettled([
      f.formEditor.saveCaseFormDraft(request), f.formEditor.saveCaseFormDraft({ ...request, requestId: formRequestId(), document: { ...request.document, title: 'Another editor' } }),
    ]);
    assert.equal(results.filter(row => row.status === 'fulfilled').length, 1);
    assert.match(results.find(row => row.status === 'rejected').reason.message, /CASE_FORM_DRAFT_STALE/);
    const next = { ...request, requestId: formRequestId(), expectedRevision: 1 };
    assert.deepEqual((await Promise.all([f.formEditor.saveCaseFormDraft(next), f.formEditor.saveCaseFormDraft(next)])).map(row => row.duplicate).sort(), [false, true]);
    assert.equal((await read(f)).draft.revision, 2);
  });

  await scenario('Z04 each form category has independent immutable versions and Quick Help remains formless', async f => {
    for (const caseType of FORM_CASE_TYPES) {
      await f.saveForm(syntheticCaseForm(caseType)); const result = await f.publishForm(1, caseType);
      assert.equal(result.version, 1); assert.equal((await read(f, caseType)).newRequestVersion, 1);
    }
    assert.equal((await f.rows('case_forms')).length, 7);
    await assert.rejects(f.formEditor.readCaseFormDraft({ actor: await f.formActor(), caseType: 'quick-help' }), /INVALID_CASE_FORM_TYPE/);
    await assert.rejects(f.formEditor.saveCaseFormDraft({ ...await saveRequest(f), caseType: 'head-admin-contact' }), /INVALID_CASE_FORM_TYPE/);
    const old = (await f.rows('case_forms'))[0]; await assert.rejects(f.publish({ ...old.form, title: 'Overwritten' }, 1), /CASE_FORM_IMMUTABLE/);
  });

  await scenario('Z05 incomplete review has no usable preview or publication and valid review uses the live modal contract', async f => {
    await f.saveForm({ caseType: 'admin-help', title: '', fields: [] }); const invalid = await f.reviewForm(1);
    assert.equal(invalid.valid, false); assert.equal(invalid.preview, null); assert.equal(invalid.form, null);
    await assert.rejects(f.formEditor.publishCaseFormDraft({ actor: await f.formActor(), ...f.publishFormRequest(invalid) }), /CASE_FORM_DRAFT_INVALID/);
    assert.equal((await f.rows('case_forms')).length, 0);
    await f.saveForm(syntheticCaseForm(), 1); const review = await f.reviewForm(2);
    assert.equal(review.valid, true); assert.equal(review.nextVersion, 1); assert.equal(review.preservesSubmittedAnswers, true);
    assert.equal(Object.hasOwn(review.preview, 'custom_id'), false); assert.equal(review.preview.components[1].component.type, 3);
    await f.publishForm(2); const prepared = await f.prepare(); assert.equal(prepared.result.status, 'modal');
    assert.deepEqual(prepared.result.modal.form, review.form);
  });

  await scenario('Z06 stale revisions, altered hashes and concurrent publication cannot bypass the reviewed state', async f => {
    await f.saveForm(); const request = await publishRequest(f);
    await assert.rejects(f.formEditor.publishCaseFormDraft({ ...request, expectedHash: '0'.repeat(64) }), /CASE_FORM_DRAFT_STALE/);
    await f.saveForm({ ...syntheticCaseForm(), title: 'Second draft' }, 1);
    await assert.rejects(f.formEditor.publishCaseFormDraft(request), /CASE_FORM_DRAFT_STALE/);
    const latest = await publishRequest(f), results = await Promise.allSettled([
      f.formEditor.publishCaseFormDraft(latest), f.formEditor.publishCaseFormDraft({ ...latest, requestId: formRequestId() }),
    ]);
    assert.equal(results.filter(row => row.status === 'fulfilled').length, 1); assert.match(results.find(row => row.status === 'rejected').reason.message, /CASE_FORM_PUBLICATION_STALE/);
    assert.equal((await f.rows('case_forms')).length, 1);
  });

  await scenario('Z07 the original publisher and editor share their guild lock and immutable write path', async f => {
    await f.saveForm({ ...syntheticCaseForm(), title: 'Editor form' }); const request = await publishRequest(f);
    const results = await Promise.allSettled([f.formEditor.publishCaseFormDraft(request), f.publish()]);
    assert.equal(results.filter(row => row.status === 'fulfilled').length, 1);
    assert.match(results.find(row => row.status === 'rejected').reason.message, /CASE_FORM_PUBLICATION_STALE|CASE_FORM_IMMUTABLE/);
    assert.equal((await f.rows('case_forms')).length, 1); assert.equal((await f.rows('case_form_actions')).length, 1);
  });

  await scenario('Z08 withdrawal invalidates a reviewed latest state and replay cannot reactivate a withdrawn publication', async f => {
    await f.saveForm(); const first = await publishRequest(f); await f.formEditor.publishCaseFormDraft(first);
    const stale = await publishRequest(f), withdrawal = await withdrawRequest(f); await f.formEditor.withdrawCaseFormPublication(withdrawal);
    await assert.rejects(f.formEditor.publishCaseFormDraft(stale), /CASE_FORM_PUBLICATION_STALE/);
    assert.equal((await f.formEditor.publishCaseFormDraft(first)).duplicate, true);
    assert.equal((await f.formEditor.withdrawCaseFormPublication(withdrawal)).duplicate, true);
    assert.equal((await f.publish()).status, 'withdrawn'); assert.equal((await read(f)).newRequestVersion, null);
    assert.equal((await f.publishForm(1)).version, 2); assert.equal((await f.formEditor.withdrawCaseFormPublication(withdrawal)).newRequestVersionAtWithdrawal, null);
    assert.equal((await read(f)).newRequestVersion, 2); assert.equal((await f.rows('case_form_actions')).length, 3);
  });

  await scenario('Z09 publication leaves existing form pins and submitted answers unchanged across later withdrawal', async f => {
    await f.saveForm(); await f.publishForm(1); const held = (await f.prepare()).result.modal.token;
    await f.saveForm({ ...syntheticCaseForm(), title: 'New guidance' }, 1); await f.publishForm(2);
    assert.equal(await f.submit(held), 'ticket_recorded'); const retained = await f.rows('case_intakes');
    assert.equal(retained[0].form_version, 1); assert.deepEqual(retained[0].answers, syntheticCaseValues());
    const result = await f.formEditor.withdrawCaseFormPublication(await withdrawRequest(f)); assert.equal(result.newRequestVersionAtWithdrawal, 2);
    assert.equal(await f.submit(held), 'ticket_recorded'); assert.deepEqual(await f.rows('case_intakes'), retained);
    const record = await f.formEditor.readCaseFormPublication({ actor: await f.formActor(), caseType: 'admin-help', version: 1 });
    assert.equal(record.status, 'withdrawn'); assert.equal(record.newRequestVersionAfterWithdrawal, 2);
    assert.equal(JSON.stringify(record).includes('Synthetic intake fixture.'), false);
  });

  await scenario('Z10 latest withdrawal has no fallback; old published pins survive while withdrawn pins cannot submit', async f => {
    await f.saveForm(); await f.publishForm(1); const old = (await f.prepare()).result.modal.token;
    await f.publishForm(1); await age(f); const current = (await f.prepare()).result.modal.token;
    const record = await f.formEditor.readCaseFormPublication({ actor: await f.formActor(), caseType: 'admin-help', version: 2 });
    assert.equal(record.newRequestVersionAfterWithdrawal, null); await f.formEditor.withdrawCaseFormPublication(await withdrawRequest(f, 2));
    await age(f); assert.equal((await f.prepare()).result.status, 'ticket_form_unavailable');
    assert.equal(await f.submit(current), 'ticket_form_unavailable'); assert.equal(await f.submit(old), 'ticket_recorded');
    assert.equal((await read(f)).newRequestVersion, null); assert.equal((await f.rows('case_intakes'))[0].form_version, 1);
  });

  await scenario('Z11 every editor operation and receipt requires current explicitly granted authority', async f => {
    const save = await saveRequest(f); await f.formEditor.saveCaseFormDraft(save); const publish = await publishRequest(f);
    await f.formEditor.publishCaseFormDraft(publish); const withdraw = await withdrawRequest(f), actor = await f.formActor();
    f.discord.state.members.set(OTHER, [STAFF]);
    for (const operation of [() => f.formEditor.readCaseFormDraft({ actor, caseType: 'admin-help' }),
      () => f.formEditor.listCaseFormHistory({ actor, caseType: 'admin-help', kind: 'publications' }),
      () => f.formEditor.reviewCaseFormDraft({ actor, caseType: 'admin-help', revision: 1 }),
      () => f.formEditor.readCaseFormPublication({ actor, caseType: 'admin-help', version: 1 }),
      () => f.formEditor.saveCaseFormDraft(save), () => f.formEditor.publishCaseFormDraft(publish), () => f.formEditor.withdrawCaseFormPublication(withdraw)]) {
      await assert.rejects(operation(), /OPERATION_DENIED/);
    }
    assert.equal((await f.rows('case_form_editor_actions')).length, 2); assert.equal((await f.rows('case_forms'))[0].status, 'published');
  });

  await scenario('Z12 revoked capability or browser logout before commit rolls back draft and audit together', async f => {
    const request = await saveRequest(f); let calls = 0;
    f.discord.state.before = call => { if (call.path.endsWith(`/members/${OTHER}`) && ++calls === 2) f.discord.state.members.set(OTHER, [STAFF]); };
    await assert.rejects(f.formEditor.saveCaseFormDraft(request), /OPERATION_DENIED/); f.discord.state.before = null;
    f.discord.state.members.set(OTHER, [LEAD]); const session = await f.login(), identity = await f.auth.authenticate({ token: session.token });
    const actor = await f.dashboardAuthorization.resolveActor(identity.proof); calls = 0;
    f.discord.state.before = async call => { if (call.path.endsWith(`/members/${OTHER}`) && ++calls === 2) await f.authStore.revokeSession(authDigest(session.token)); };
    await assert.rejects(f.formEditor.saveCaseFormDraft({ ...request, actor }), /OPERATION_DENIED/); f.discord.state.before = null;
    assert.equal((await f.rows('case_form_drafts')).length, 0); assert.equal((await f.rows('case_form_editor_actions')).length, 0);
  });

  await scenario('Z13 audit insertion failure rolls back saving, publication and withdrawal without partial form actions', async f => {
    await f.saveForm(); await f.publishForm(1); const publish = await publishRequest(f), withdraw = await withdrawRequest(f);
    const forms = await f.rows('case_forms'), actions = await f.rows('case_form_actions');
    await f.admin.query(`CREATE FUNCTION sophie_core.synthetic_form_editor_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic_form_editor_failure'; END $$;
      CREATE TRIGGER synthetic_form_editor_failure BEFORE INSERT ON sophie_core.case_form_editor_actions FOR EACH ROW EXECUTE FUNCTION sophie_core.synthetic_form_editor_failure()`);
    try {
      await assert.rejects(f.saveForm(syntheticCaseForm(), 1), /synthetic_form_editor_failure/);
      await assert.rejects(f.formEditor.publishCaseFormDraft(publish), /synthetic_form_editor_failure/);
      await assert.rejects(f.formEditor.withdrawCaseFormPublication(withdraw), /synthetic_form_editor_failure/);
    } finally { await f.admin.query('DROP TRIGGER synthetic_form_editor_failure ON sophie_core.case_form_editor_actions; DROP FUNCTION sophie_core.synthetic_form_editor_failure()'); }
    assert.equal((await read(f)).draft.revision, 1); assert.deepEqual(await f.rows('case_forms'), forms); assert.deepEqual(await f.rows('case_form_actions'), actions);
    assert.equal((await f.rows('case_form_editor_actions')).length, 2);
  });

  await scenario('Z14 form histories have stable bounded metadata pagination and never cross categories', async f => {
    for (let revision = 1; revision <= 12; revision++) { await f.saveForm(syntheticCaseForm(), revision - 1); await f.publishForm(revision); }
    await f.saveForm(syntheticCaseForm('head-admin-contact')); await f.publishForm(1, 'head-admin-contact');
    for (const kind of ['drafts', 'publications']) {
      const request = { actor: await f.formActor(), caseType: 'admin-help', kind }, first = await f.formEditor.listCaseFormHistory(request);
      assert.equal(first.entries.length, 10); assert.equal(first.nextBefore, 3);
      const second = await f.formEditor.listCaseFormHistory({ ...request, before: first.nextBefore }); assert.equal(second.entries.length, 2); assert.equal(second.nextBefore, null);
      assert.equal(new Set([...first.entries, ...second.entries].map(row => row.revision ?? row.version)).size, 12);
      assert.equal(JSON.stringify(first).includes('Synthetic support form'), false);
    }
    const old = await f.formEditor.readCaseFormPublication({ actor: await f.formActor(), caseType: 'admin-help', version: 1 });
    assert.equal(old.version, 1); assert.equal(old.newRequestVersion, 12); assert.equal(old.newRequestVersionAfterWithdrawal, 12);
  });

  await scenario('Z15 knowledge cannot read authored configuration and core cannot delete retained draft or audit history', async f => {
    await f.saveForm(); await f.publishForm(1);
    for (const table of ['case_form_drafts', 'case_form_editor_actions', 'case_forms', 'case_form_actions']) {
      await assert.rejects(cluster.knowledgePool.query(`SELECT * FROM sophie_core.${table}`), { code: '42501' });
      await assert.rejects(f.pool.query(`DELETE FROM sophie_core.${table}`), { code: '42501' });
    }
  });

  await scenario('Z16 authenticated form routes share save/review/publication/history/withdraw semantics and current capability hints', async f => {
    await withServer(f, async ({ get, post, faults }) => {
      const session = (await get('/auth/session')).body; assert.equal(session.canEditForms, true); assert.equal(session.canEditOnboarding, false);
      assert.equal((await get('/api/ticket-forms/draft?caseType=admin-help')).body.draft, null);
      const request = { caseType: 'admin-help', requestId: formRequestId(), expectedRevision: 0, document: syntheticCaseForm() };
      assert.equal((await post('/api/ticket-forms/save', request)).status, 200);
      const review = await get('/api/ticket-forms/review?caseType=admin-help&revision=1'); assert.equal(review.status, 200); assert.equal(review.body.valid, true);
      const published = await post('/api/ticket-forms/publish', f.publishFormRequest(review.body)); assert.equal(published.status, 200); assert.equal(published.body.version, 1);
      const record = await get('/api/ticket-forms/publication?caseType=admin-help&version=1'); assert.equal(record.status, 200); assert.equal(record.body.newRequestVersionAfterWithdrawal, null);
      assert.equal((await get('/api/ticket-forms/history?caseType=admin-help&kind=publications')).body.entries.length, 1);
      const withdrawn = await post('/api/ticket-forms/withdraw', { caseType: 'admin-help', requestId: formRequestId(), version: 1, expectedHash: record.body.sha256, confirm: true });
      assert.equal(withdrawn.status, 200); assert.equal(withdrawn.body.newRequestVersionAtWithdrawal, null);
      assert.equal((await post('/api/ticket-forms/save', request)).body.duplicate, true); assert.equal((await f.rows('case_form_editor_actions')).length, 3);
      assert.equal(record.headers['cache-control'], 'no-store'); assert.deepEqual(faults, []);
    });
  });

  await scenario('Z17 form routes reject forged authority, CSRF, ambiguous queries, unknown keys and stale reviews without mutation', async f => {
    await withServer(f, async ({ get, post, headers, faults }) => {
      const body = { caseType: 'admin-help', requestId: formRequestId(), expectedRevision: 0, document: syntheticCaseForm() };
      assert.equal((await post('/api/ticket-forms/save', { ...body, actor: { userId: OTHER } })).status, 400);
      assert.equal((await post('/api/ticket-forms/save', body, { Origin: 'https://other.example.test' })).status, 403);
      assert.equal((await post('/api/ticket-forms/save', body, { 'X-CSRF-Token': formRequestId() })).status, 403);
      assert.equal((await post('/api/ticket-forms/save', body, { 'Content-Type': 'text/plain' })).status, 400);
      for (const path of ['/api/ticket-forms/review?caseType=admin-help&revision=1&revision=2', '/api/ticket-forms/draft?caseType=admin-help&guildId=1',
        '/api/ticket-forms/draft?caseType=quick-help', '/api/ticket-forms/history?caseType=admin-help&kind=answers']) assert.equal((await get(path)).status, 400);
      assert.equal((await get('/api/ticket-forms/publication?caseType=admin-help&version=999')).status, 404);
      assert.equal((await get('/api/ticket-forms/draft?caseType=admin-help', { headers: { ...headers, Cookie: '' } })).status, 403);
      assert.equal((await f.rows('case_form_editor_actions')).length, 0); assert.equal((await post('/api/ticket-forms/save', body)).status, 200);
      assert.equal((await post('/api/ticket-forms/save', { ...body, requestId: formRequestId() })).status, 409);
      f.discord.state.members.set(OTHER, [STAFF]); assert.equal((await get('/api/ticket-forms/draft?caseType=admin-help')).status, 403);
      assert.equal((await get('/auth/session')).body.canEditForms, false); assert.equal((await f.rows('case_form_editor_actions')).length, 1); assert.deepEqual(faults, []);
    });
  });

  await scenario('Z18 revocation after commit suppresses the HTTP result and an authorized retry resolves the retained receipt', async f => {
    await withServer(f, async ({ post, faults }) => {
      const request = { caseType: 'admin-help', requestId: formRequestId(), expectedRevision: 0, document: syntheticCaseForm() }; let calls = 0;
      f.discord.state.before = call => { if (call.path.endsWith(`/members/${OTHER}`) && ++calls === 4) f.discord.state.members.set(OTHER, [STAFF]); };
      assert.equal((await post('/api/ticket-forms/save', request)).status, 403); f.discord.state.before = null;
      assert.equal((await f.rows('case_form_editor_actions')).length, 1); f.discord.state.members.set(OTHER, [LEAD]);
      const replay = await post('/api/ticket-forms/save', request); assert.equal(replay.status, 200); assert.equal(replay.body.duplicate, true);
      assert.equal((await f.rows('case_form_drafts')).length, 1); assert.deepEqual(faults, []);
    });
  });

  await scenario('Z19 malformed or oversized input and disabled delivery never expose form data or create authoring records', async f => {
    await withServer(f, async ({ address, headers, get, faults }) => {
      for (const body of ['{broken', Buffer.from([0xff])]) assert.equal((await http(address, '/api/ticket-forms/save', { method: 'POST', headers, body })).status, 400);
      assert.equal((await http(address, '/api/ticket-forms/save', { method: 'POST', headers, body: ' '.repeat(131_073) })).status, 403);
      assert.equal((await get('/api/ticket-forms/answers?caseType=admin-help')).status, 404);
      assert.equal((await get('/api/shuttle/draft')).status, 404);
      f.clock.enabled = false; assert.equal((await get('/api/ticket-forms/draft?caseType=admin-help')).status, 503);
      assert.equal((await f.rows('case_form_editor_actions')).length, 0); assert.deepEqual(faults, []);
    });
  });

  await scenario('Z20 lost commit acknowledgements for save, publish and withdraw resolve without repeating the recorded effect', async f => {
    const uncertain = () => {
      let armed = false, lost = false;
      return formAuthoringServices({ ...f, pool: { connect: async () => {
        const client = await f.pool.connect(); return { release: discard => client.release(discard), query: async (...args) => {
          const result = await client.query(...args); if (String(args[0]).includes('INSERT INTO sophie_core.case_form_editor_actions')) armed = true;
          if (args[0] === 'COMMIT' && armed && !lost) { lost = true; throw new Error('SYNTHETIC_FORM_COMMIT_ACK_LOST'); } return result;
        } };
      } } });
    };
    const save = await saveRequest(f); await assert.rejects(uncertain().formEditor.saveCaseFormDraft(save), /SYNTHETIC_FORM_COMMIT_ACK_LOST/);
    assert.equal((await f.formEditor.saveCaseFormDraft(save)).duplicate, true);
    const publish = await publishRequest(f); await assert.rejects(uncertain().formEditor.publishCaseFormDraft(publish), /SYNTHETIC_FORM_COMMIT_ACK_LOST/);
    assert.equal((await f.formEditor.publishCaseFormDraft(publish)).duplicate, true);
    const withdraw = await withdrawRequest(f); await assert.rejects(uncertain().formEditor.withdrawCaseFormPublication(withdraw), /SYNTHETIC_FORM_COMMIT_ACK_LOST/);
    assert.equal((await f.formEditor.withdrawCaseFormPublication(withdraw)).duplicate, true);
    assert.equal((await f.rows('case_form_editor_actions')).length, 3); assert.equal((await f.rows('case_form_actions')).length, 2);
    assert.equal((await f.rows('case_form_drafts')).length, 1); assert.equal((await f.rows('case_forms'))[0].status, 'withdrawn');
  });

  await scenario('Z21 corrupted drafts and publications cannot be reviewed, copied or used to withdraw a different form', async f => {
    await f.saveForm(); await f.publishForm(1);
    await f.admin.query("UPDATE sophie_core.case_form_drafts SET sha256 = repeat('0', 64)");
    await assert.rejects(f.reviewForm(1), /CASE_FORM_DRAFT_CORRUPT/);
    await f.admin.query("UPDATE sophie_core.case_forms SET sha256 = repeat('0', 64)");
    await assert.rejects(f.formEditor.readCaseFormPublication({ actor: await f.formActor(), caseType: 'admin-help', version: 1 }), /CASE_FORM_CORRUPT/);
    await assert.rejects(f.formEditor.withdrawCaseFormPublication({ actor: await f.formActor(), caseType: 'admin-help', version: 1,
      requestId: formRequestId(), expectedHash: '0'.repeat(64), confirm: true }), /CASE_FORM_CORRUPT/);
    assert.equal((await f.rows('case_forms'))[0].status, 'published');
  });
  await scenario('Z22 the browser controller and transport exercise real authenticated form storage with uncertain response recovery', async f => {
    await withServer(f, async ({ address, headers, faults }) => {
      let loseSave = true;
      const api = createDashboardApi({ fetch: async (path, options) => {
        const result = await http(address, path, { method: options.method, headers: { ...headers, ...options.headers }, body: options.body ?? '' });
        if (loseSave && path === '/api/ticket-forms/save' && result.status === 200) { loseSave = false; throw new Error('SYNTHETIC_BROWSER_RESPONSE_LOST'); }
        return Response.json(result.body, { status: result.status });
      } });
      const controller = createFormController({ api, newRequestId: formRequestId, onChange: () => {} });
      await controller.start(); assert.equal(controller.snapshot().phase, 'ready'); assert.equal(controller.snapshot().overview.draft, null);
      controller.updateTitle('Synthetic integrated browser'); controller.addField(); controller.updateField(0, 'label', 'Synthetic question');
      await controller.save(); assert.ok(controller.snapshot().pending); assert.equal((await f.rows('case_form_drafts')).length, 1);
      await controller.retry(); assert.equal(controller.snapshot().pending, null); assert.equal((await f.rows('case_form_drafts')).length, 1);
      await controller.review(); assert.equal(controller.snapshot().review.valid, true); await controller.publish(); assert.equal(controller.snapshot().overview.newRequestVersion, 1);
      controller.updateTitle('Synthetic second publication'); await controller.save(); await controller.review(); await controller.publish();
      await controller.history(); await controller.inspect('publications', 2); controller.reviewWithdrawal(); await controller.withdraw();
      assert.equal(controller.snapshot().overview.newRequestVersion, null); assert.equal((await f.rows('case_forms')).find(row => row.version === 1).status, 'published');
      await controller.selectResource('head-admin-contact'); assert.equal(controller.snapshot().overview.draft, null); assert.deepEqual(controller.snapshot().history.entries, []);
      controller.updateTitle('Synthetic leadership draft'); await controller.save(); assert.equal((await f.rows('case_form_drafts')).length, 3);
      f.discord.state.members.set(OTHER, [STAFF]); await controller.checkAccess(); assert.equal(controller.snapshot().phase, 'denied'); assert.equal(controller.snapshot().document, null);
      assert.equal((await f.rows('case_form_editor_actions')).length, 6); assert.equal((await f.rows('case_intakes')).length, 0); assert.deepEqual(faults, []);
    });
  });
}
