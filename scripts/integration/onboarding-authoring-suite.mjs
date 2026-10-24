import assert from 'node:assert/strict';
import { authoringWorkflow, draftDocument, editorRequestId } from '../../tests/fixtures/onboarding-authoring.js';
import { dashboardHttp as http } from '../../tests/fixtures/dashboard-http.js';
import { dashboardConfiguration } from '../../tests/fixtures/oauth.js';
import { GUILD, USER, OTHER, STAFF, LEAD, publication } from '../../tests/fixtures/domain.js';
import { CREW, WHITELIST } from '../../tests/fixtures/discord.js';
import { shuttleGroup } from '../../tests/fixtures/onboarding-group.js';
import { DASHBOARD_COOKIES } from '../../contracts/dashboard-auth.js';
import { createDashboardAuthHttpServer } from '../../apps/core/http/dashboard-auth.js';
import { authDigest, sessionCsrf } from '../../apps/core/security/dashboard-auth.js';
import { createLocalShuttlePublisher } from '../../apps/core/operator/local-shuttle-publisher.js';
import { createOnboardingAuthoringStore } from '../../apps/core/storage/onboarding-authoring.js';
import { createOnboardingAuthoringHttp } from '../../apps/core/http/onboarding-authoring.js';

export async function runOnboardingAuthoringSuite(cluster, run) {
  const scenario = (name, work) => run(name, async () => { await work(await authoringWorkflow(cluster)); });
  const read = async f => f.editorStore.readOnboardingDraft({ actor: await f.editorActor() });
  const savedRequest = async (f, extra = {}) => ({ actor: await f.editorActor(), requestId: editorRequestId(), expectedRevision: 0, document: draftDocument(), ...extra });
  const withdrawRequest = async (f, version = 1) => ({ actor: await f.editorActor(), requestId: editorRequestId(), version, confirm: true,
    expectedHash: (await f.editorStore.readOnboardingPublication({ actor: await f.editorActor(), version })).sha256 });
  const publishing = async f => ({ actor: await f.editorActor(), ...f.publishRequest(await f.review((await read(f)).draft.revision)) });
  async function withServer(f, work) {
    const session = await f.login(), headers = { Cookie: `${DASHBOARD_COOKIES.session}=${session.token}`,
      Origin: dashboardConfiguration.origin, 'X-CSRF-Token': sessionCsrf(session.token), 'Content-Type': 'application/json' };
    const faults = [], server = createDashboardAuthHttpServer({ configuration: dashboardConfiguration, auth: f.auth,
      authorization: f.dashboardAuthorization, authoring: f.editorHttp, enabled: () => f.clock.enabled, onFault: value => faults.push(value) });
    try {
      const address = await server.listen();
      const get = (path, options = {}) => http(address, path, { headers, ...options });
      const post = (path, body, extra = {}) => http(address, path, { method: 'POST', headers: { ...headers, ...extra }, body: JSON.stringify(body) });
      await work({ get, post, address, headers, session, faults });
    } finally { await server.close(); }
  }

  await scenario('E01 saved drafts retain exact authored revisions and provenance without publishing or changing sessions', async f => {
    assert.equal((await read(f)).draft, null); const document = draftDocument(); document.stages[0].title = ''; document.stages[0].body = '';
    const first = await f.save(document), second = await f.save(draftDocument(), 1);
    assert.equal(first.revision, 1); assert.equal(second.revision, 2); assert.notEqual(first.sha256, second.sha256);
    assert.deepEqual((await f.editorStore.readOnboardingDraft({ actor: await f.editorActor(), revision: 1 })).draft.document, document);
    assert.equal((await read(f)).draft.authorId, OTHER); assert.equal((await f.rows('shuttle_draft_revisions')).length, 2);
    const actions = await f.rows('shuttle_editor_actions'); assert.deepEqual(actions.map(row => [row.before_revision, row.after_revision]), [[0, 1], [1, 2]]);
    assert.equal((await f.rows('shuttle_publications')).length, 1); assert.equal((await f.rows('sessions')).length, 0);
    assert.equal(f.discord.state.calls.some(call => call.method !== 'GET'), false);
  });

  await scenario('E02 a copied actor cannot borrow an editor authority', async f => {
    const request = await savedRequest(f);
    await assert.rejects(f.editorStore.saveOnboardingDraft({ ...request, actor: { ...request.actor } }), /OPERATION_DENIED/);
    assert.equal((await f.rows('shuttle_draft_revisions')).length, 0); assert.equal((await f.rows('shuttle_editor_actions')).length, 0);
  });

  await scenario('E03 concurrent editors cannot overwrite a revision and a resent save is stale rather than repeated', async f => {
    const request = await savedRequest(f), result = await Promise.allSettled([
      f.editorStore.saveOnboardingDraft(request), f.editorStore.saveOnboardingDraft({ ...request, requestId: editorRequestId(), document: { ...draftDocument(), helpPauses: true } }),
    ]);
    assert.equal(result.filter(row => row.status === 'fulfilled').length, 1); assert.match(result.find(row => row.status === 'rejected').reason.message, /SHUTTLE_DRAFT_STALE/);
    await assert.rejects(f.editorStore.saveOnboardingDraft({ ...request, requestId: editorRequestId() }), /SHUTTLE_DRAFT_STALE/);
    assert.equal((await read(f)).draft.revision, 1);
  });

  await scenario('E04 publishing new guidance preserves active runs and only new runs select its immutable version', async f => {
    await f.open(); const old = await f.session(), document = draftDocument(); document.helpPauses = true;
    document.stages.reverse(); document.stages.pop(); document.stages[0].body = 'New synthetic guidance.';
    await f.save(document); const result = await f.publish(1); assert.equal(result.version, 2); assert.equal(result.preservesExistingRuns, true);
    assert.deepEqual(await f.session(), old); assert.equal((await f.rows('shuttle_publications')).find(row => row.definition_version === 1).publication.helpPauses, false);
    const newcomer = '100000000000000030'; f.discord.state.members.set(newcomer, [CREW]);
    assert.equal(await f.execute(f.payload({ member: { user: { id: newcomer } } })), 'shuttle_recorded'); await f.drain(f.cases); await f.drain(f.screens);
    assert.equal((await f.rows('sessions')).find(row => row.user_id === newcomer).state.definitionVersion, 2);
    assert.equal((await f.rows('sessions')).find(row => row.user_id === USER).state.definitionVersion, 1);
    const newScreen = (await f.rows('shuttle_screens')).find(row => row.user_id === newcomer && row.current);
    assert.deepEqual((await shuttleGroup(f.admin, f.discord.state, newScreen)).content.map(message => message.content), [document.stages[0].body]);
  });

  for (const count of [1, 20]) await scenario(`E${count === 1 ? '21' : '22'} a published ${count}-step journey reaches only its own final acknowledgement and observed grant`, async f => {
    const document = { helpPauses: false, stages: Array.from({ length: count }, (_, i) => ({ id: `step-${i}`, title: `Synthetic step ${i + 1}`, body: 'Synthetic variable-step guidance.' })) };
    await f.save(document); await f.publish(1); await f.open();
    assert.equal((await f.session()).definitionVersion, 2);
    for (let i = 0; i < count; i++) {
      const screen = await f.current(), shown = await shuttleGroup(f.admin, f.discord.state, screen);
      assert.equal(shown.nav.embeds[0].title, `Step ${i + 1} of ${count} · Synthetic step ${i + 1}`);
      assert.equal(shown.status.embeds[0].description.split('\n').filter(line => /\d+\. Synthetic step \d+/u.test(line)).length, count);
      assert.equal(f.discord.state.members.get(USER).includes(WHITELIST), false);
      assert.equal(await f.click('advance'), 'shuttle_progress_recorded'); await f.drain(f.screens);
      assert.equal((await f.session()).status, i === count - 1 ? 'role_pending' : 'active');
    }
    const pendingId = (await f.session()).id;
    await f.drain(f.grants); await f.drain(f.screens);
    assert.equal((await f.rows('sessions')).find(row => row.id === pendingId).state.status, 'complete');
    assert.equal(f.discord.state.members.get(USER).includes(WHITELIST), true);
    assert.equal((await f.rows('shuttle_publications')).find(row => row.definition_version === 1).publication.stages.length, 5);
  });

  await scenario('E23 oversized authored journeys are rejected as bounded input without losing the saved revision', async f => {
    await f.save();
    const document = { helpPauses: false, stages: Array.from({ length: 20 }, (_, i) => ({ id: `step-${i}`, title: 'Synthetic step', body: 'x '.repeat(2500) })) };
    await withServer(f, async ({ post }) => {
      const result = await post('/api/shuttle/save', { requestId: editorRequestId(), expectedRevision: 1, document });
      assert.equal(result.status, 400);
    });
    assert.equal((await read(f)).draft.revision, 1);
  });

  await scenario('E26 publishing new guidance resets Activity runs still being read on older versions; channel runs keep theirs', async f => {
    // Owner decision, 24 October 2026: a story update disposes of Activity progress, so nobody finishes an outdated story.
    await f.open(); const channelRun = await f.session();
    const reader = '100000000000000031'; f.discord.state.members.set(reader, [CREW]);
    assert.equal(await f.execute(f.payload({ member: { user: { id: reader } } })), 'shuttle_recorded'); await f.drain(f.cases); await f.drain(f.screens);
    const activityRun = (await f.rows('sessions')).find(row => row.user_id === reader);
    await f.admin.query('INSERT INTO sophie_core.shuttle_activity_runs (session_id, guild_id, user_id, started_at_ms) VALUES ($1, $2, $3, 1)',
      [activityRun.id, activityRun.guild_id, activityRun.user_id]);
    await f.save(draftDocument()); const result = await f.publish(1);
    assert.equal(result.version, 2); assert.equal(result.activityRunsReset, 1);
    const sessions = await f.rows('sessions');
    assert.equal(sessions.find(row => row.id === activityRun.id).current, false, 'the Activity run is set aside, not deleted');
    assert.deepEqual(await f.session(), channelRun, 'the channel run keeps its version and progress');
    assert.equal((await f.rows('shuttle_editor_actions')).at(-1).result.activityRunsReset, 1);
  });

  await scenario('E05 publishing is version-checked, a resend is stale, and it cannot ignore another operator withdrawing the reviewed latest version', async f => {
    await f.save(); const request = await publishing(f);
    const results = await Promise.allSettled([f.editorStore.publishOnboardingDraft(request), f.editorStore.publishOnboardingDraft({ ...request, requestId: editorRequestId() })]);
    assert.equal(results.filter(row => row.status === 'fulfilled').length, 1); assert.match(results.find(row => row.status === 'rejected').reason.message, /SHUTTLE_PUBLICATION_STALE/);
    await assert.rejects(f.editorStore.publishOnboardingDraft({ ...request, requestId: editorRequestId() }), /SHUTTLE_PUBLICATION_STALE/);
    const next = await publishing(f); await f.store.withdrawDefinition({ actor: await f.actor(OTHER), id: publication.id, version: 2 });
    await assert.rejects(f.editorStore.publishOnboardingDraft(next), /SHUTTLE_PUBLICATION_STALE/); assert.equal((await f.rows('shuttle_publications')).length, 2);
    assert.equal((await f.editorStore.readOnboardingPublication({ actor: await f.editorActor(), version: 2 })).status, 'withdrawn');
  });

  await scenario('E06 incomplete or unrenderable guidance stays a draft and returns bounded validation errors', async f => {
    const document = draftDocument(); document.stages[0].body = 'x'.repeat(1_801); await f.save(document);
    const review = await f.review(1); assert.equal(review.valid, false); assert.deepEqual(review.errors, ['STATIC_COPY_BLOCK_TOO_LONG']); assert.deepEqual(review.pages, []);
    await assert.rejects(f.editorStore.publishOnboardingDraft({ actor: await f.editorActor(), ...f.publishRequest(review) }), /SHUTTLE_DRAFT_INVALID/);
    assert.equal((await f.rows('definitions')).length, 1); assert.equal((await f.rows('shuttle_editor_actions')).length, 1);
  });

  await scenario('E07 stale draft revisions and hashes cannot publish guidance different from the reviewed copy', async f => {
    await f.save(); const request = await publishing(f);
    await assert.rejects(f.editorStore.publishOnboardingDraft({ ...request, expectedHash: '0'.repeat(64) }), /SHUTTLE_DRAFT_STALE/);
    await f.save({ ...draftDocument(), helpPauses: true }, 1);
    await assert.rejects(f.editorStore.publishOnboardingDraft(request), /SHUTTLE_DRAFT_STALE/);
    await assert.rejects(f.editorStore.publishOnboardingDraft({ ...await publishing(f), expectedLatestVersion: 0, expectedLatestStatus: 'none' }), /SHUTTLE_PUBLICATION_STALE/);
    assert.equal((await f.rows('shuttle_publications')).length, 1);
  });

  await scenario('E08 confirmed withdrawal retains records, retires screens and blocks already queued Whitelist delivery', async f => {
    await f.pending(); const request = await withdrawRequest(f), view = await f.editorStore.readOnboardingPublication({ actor: await f.editorActor(), version: 1 });
    assert.deepEqual(view.impact, { active: 0, rolePending: 1, complete: 0 }); assert.equal(JSON.stringify(view.impact).includes(USER), false);
    await assert.rejects(f.editorStore.withdrawOnboardingPublication({ ...request, confirm: false }), /SHUTTLE_WITHDRAWAL_CONFIRMATION_REQUIRED/);
    const result = await f.editorStore.withdrawOnboardingPublication(request); assert.deepEqual(result.impactAtWithdrawal, view.impact);
    await assert.rejects(f.editorStore.withdrawOnboardingPublication({ ...request, requestId: editorRequestId() }), /SHUTTLE_PUBLICATION_STALE/);
    await f.drain(f.screens); assert.equal((await f.grants.runOnce('withdrawn-grant')).code, 'DEFINITION_WITHDRAWN');
    assert.equal(f.discord.state.members.get(USER).includes(WHITELIST), false); assert.equal(await f.current(), undefined);
    assert.equal((await f.rows('shuttle_editor_actions')).length, 1); assert.equal((await f.rows('shuttle_publications')).length, 1);
    assert.equal((await f.rows('sessions')).length, 1); assert.equal((await f.rows('case_exclusions')).length, 1);
  });

  await scenario('E09 withdrawing completed guidance never revokes earned Whitelist and repeated visits use the latest publication', async f => {
    await f.pending(); await f.drain(f.grants); await f.drain(f.screens); assert.equal((await f.rows('sessions'))[0].state.status, 'complete');
    assert.deepEqual((await f.editorStore.readOnboardingPublication({ actor: await f.editorActor(), version: 1 })).impact, { active: 0, rolePending: 0, complete: 1 });
    await f.save(); const request = await publishing(f); await f.editorStore.publishOnboardingDraft(request);
    await f.editorStore.withdrawOnboardingPublication(await withdrawRequest(f)); await f.drain(f.screens);
    await assert.rejects(f.editorStore.publishOnboardingDraft({ ...request, requestId: editorRequestId() }), /SHUTTLE_PUBLICATION_STALE/); // A resend does not republish.
    assert.equal(f.discord.state.members.get(USER).includes(WHITELIST), true);
    assert.equal(await f.execute(f.payload()), 'shuttle_recorded'); await f.drain(f.cases); await f.drain(f.screens);
    assert.equal((await f.session()).definitionVersion, 2); assert.equal((await f.session()).mode, 'refresh');
    assert.equal(f.discord.state.members.get(USER).includes(WHITELIST), true);
  });

  await scenario('E10 the original publication use case shares the editor lock and cannot overwrite competing published copy', async f => {
    const changed = draftDocument(); changed.stages[0].body = 'Competing synthetic guidance.';
    await f.save(changed); const request = await publishing(f);
    const results = await Promise.allSettled([f.editorStore.publishOnboardingDraft(request),
      f.store.publishOnboarding({ actor: await f.actor(OTHER), publication: { ...publication, version: 2 } })]);
    assert.equal(results.filter(row => row.status === 'fulfilled').length, 1);
    assert.match(results.find(row => row.status === 'rejected').reason.message, /SHUTTLE_PUBLICATION_STALE|SHUTTLE_COPY_IMMUTABLE/);
    assert.equal((await f.rows('shuttle_publications')).length, 2);
  });

  await scenario('E11 editor access requires configured current capability and corrupt draft/publication hashes fail closed', async f => {
    await f.save(); const actor = await f.editorActor(); f.discord.state.members.set(OTHER, [STAFF]); f.discord.announce();
    await assert.rejects(f.editorStore.readOnboardingDraft({ actor }), /OPERATION_DENIED/);
    await assert.rejects(f.editorStore.listOnboardingHistory({ actor, kind: 'publications' }), /OPERATION_DENIED/);
    f.discord.state.members.set(OTHER, [LEAD]); const latest = await f.editorActor();
    await f.admin.query("UPDATE sophie_core.shuttle_draft_revisions SET sha256 = repeat('0', 64)");
    await assert.rejects(f.editorStore.reviewOnboardingDraft({ actor: latest, revision: 1 }), /SHUTTLE_DRAFT_CORRUPT/);
    await f.admin.query("UPDATE sophie_core.shuttle_publications SET sha256 = repeat('0', 64)");
    await assert.rejects(f.editorStore.readOnboardingPublication({ actor: latest, version: 1 }), /SHUTTLE_COPY_INVALID/);
  });

  await scenario('E12 permission loss or logout after writing a draft rolls back both its revision and audit', async f => {
    // The change lands before the save's second check: an announced role loss, then a logout.
    const request = await savedRequest(f); let calls = 0, change = null;
    const racing = createOnboardingAuthoringStore({ pool: f.pool, guildId: GUILD, definitionId: publication.id, authorize: async (...args) => {
      if (++calls === 2) await change(); return f.dashboardAuthorization.authorize(...args);
    } });
    change = async () => { f.discord.state.members.set(OTHER, [STAFF]); f.discord.announce(); };
    await assert.rejects(racing.saveOnboardingDraft(request), /OPERATION_DENIED/);
    assert.equal((await f.rows('shuttle_draft_revisions')).length, 0); assert.equal((await f.rows('shuttle_editor_actions')).length, 0);
    f.discord.state.members.set(OTHER, [LEAD]); const session = await f.login(), identity = await f.auth.authenticate({ token: session.token });
    const actor = await f.dashboardAuthorization.resolveActor(identity.proof); calls = 0;
    change = () => f.authStore.revokeSession(authDigest(session.token));
    await assert.rejects(racing.saveOnboardingDraft({ ...request, actor }), /OPERATION_DENIED/);
    assert.equal((await f.rows('shuttle_draft_revisions')).length, 0); assert.equal((await f.rows('shuttle_editor_actions')).length, 0);
  });

  await scenario('E13 audit failure rolls back draft saving, publication and withdrawal cleanup as one operation', async f => {
    await f.open(); await f.save(); const publish = await publishing(f), withdraw = await withdrawRequest(f), jobs = await f.rows('outbox');
    await f.admin.query(`CREATE FUNCTION sophie_core.synthetic_editor_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic_editor_failure'; END $$;
      CREATE TRIGGER synthetic_editor_failure BEFORE INSERT ON sophie_core.shuttle_editor_actions FOR EACH ROW EXECUTE FUNCTION sophie_core.synthetic_editor_failure()`);
    try {
      await assert.rejects(f.save(draftDocument(), 1), /synthetic_editor_failure/);
      await assert.rejects(f.editorStore.publishOnboardingDraft(publish), /synthetic_editor_failure/);
      await assert.rejects(f.editorStore.withdrawOnboardingPublication(withdraw), /synthetic_editor_failure/);
    } finally { await f.admin.query('DROP TRIGGER synthetic_editor_failure ON sophie_core.shuttle_editor_actions; DROP FUNCTION sophie_core.synthetic_editor_failure()'); }
    assert.equal((await read(f)).draft.revision, 1); assert.equal((await f.rows('shuttle_publications')).length, 1);
    assert.equal((await f.rows('definitions'))[0].definition.status, 'published'); assert.deepEqual(await f.rows('outbox'), jobs);
    assert.equal((await f.rows('shuttle_editor_actions')).length, 1);
  });

  await scenario('E14 publication and draft histories use bounded stable pagination without returning every stored body', async f => {
    for (let revision = 1; revision <= 12; revision++) { await f.save(draftDocument(), revision - 1); await f.publish(revision); }
    for (const kind of ['drafts', 'publications']) {
      const first = await f.editorStore.listOnboardingHistory({ actor: await f.editorActor(), kind }); assert.equal(first.entries.length, 10); assert.notEqual(first.nextBefore, null);
      const second = await f.editorStore.listOnboardingHistory({ actor: await f.editorActor(), kind, before: first.nextBefore });
      assert.equal(second.entries.length, kind === 'drafts' ? 2 : 3); assert.equal(second.nextBefore, null);
      assert.equal(JSON.stringify(first).includes('Synthetic published guidance'), false);
      const values = [...first.entries, ...second.entries].map(row => row.revision ?? row.version); assert.equal(new Set(values).size, values.length);
    }
  });

  await scenario('E15 knowledge cannot read authored drafts/audits and core cannot delete their retained history', async f => {
    await f.save();
    for (const table of ['shuttle_draft_revisions', 'shuttle_editor_actions']) {
      await assert.rejects(cluster.knowledgePool.query(`SELECT * FROM sophie_core.${table}`), { code: '42501' });
      await assert.rejects(f.pool.query(`DELETE FROM sophie_core.${table}`), { code: '42501' });
    }
  });

  await scenario('E16 browser save/review/publish/history/withdraw routes exercise the same durable authoring services', async f => {
    await withServer(f, async ({ get, post, faults }) => {
      assert.equal((await get('/api/shuttle/draft')).body.draft, null);
      const request = { requestId: editorRequestId(), expectedRevision: 0, document: draftDocument() };
      const saved = await post('/api/shuttle/save', request); assert.equal(saved.status, 200); assert.equal(saved.body.revision, 1);
      const reviewed = await get('/api/shuttle/review?revision=1'); assert.equal(reviewed.status, 200); assert.equal(reviewed.body.valid, true);
      const published = await post('/api/shuttle/publish', f.publishRequest(reviewed.body)); assert.equal(published.status, 200); assert.equal(published.body.version, 2);
      const record = await get('/api/shuttle/publication?version=2'); assert.equal(record.status, 200); assert.equal(record.body.status, 'published');
      assert.equal(record.body.currentPublishedVersion, 2); assert.equal(record.body.newRunVersionAfterWithdrawal, 1);
      assert.equal((await get('/api/shuttle/history?kind=publications')).body.entries.length, 2);
      const withdrawn = await post('/api/shuttle/withdraw', { requestId: editorRequestId(), version: 2, expectedHash: record.body.sha256, confirm: true });
      assert.equal(withdrawn.status, 200); assert.equal(withdrawn.body.newRunVersionAtWithdrawal, 1);
      const after = (await get('/api/shuttle/publication?version=2')).body; assert.equal(after.status, 'withdrawn'); assert.equal(after.currentPublishedVersion, 1);
      assert.equal((await post('/api/shuttle/save', request)).status, 409, 'a resent save is stale');
      assert.equal((await f.rows('shuttle_editor_actions')).length, 3); assert.deepEqual(faults, []);
    });
  });

  await scenario('E17 HTTP rejects forged actors, CSRF, ambiguous fields and stale reviews without authoring mutations', async f => {
    await withServer(f, async ({ get, post, headers, faults }) => {
      const body = { requestId: editorRequestId(), expectedRevision: 0, document: draftDocument() };
      assert.equal((await post('/api/shuttle/save', { ...body, actor: { userId: OTHER } })).status, 400);
      assert.equal((await post('/api/shuttle/save', body, { Origin: 'https://other.example.test' })).status, 403);
      assert.equal((await post('/api/shuttle/save', body, { 'X-CSRF-Token': editorRequestId() })).status, 403);
      assert.equal((await post('/api/shuttle/save', body, { 'Content-Type': 'text/plain' })).status, 400);
      assert.equal((await get('/api/shuttle/review?revision=1&revision=2')).status, 400);
      assert.equal((await get('/api/shuttle/draft?definitionId=another')).status, 400);
      assert.equal((await get('/api/shuttle/publication?version=999')).status, 404);
      assert.equal((await get('/api/shuttle/draft', { headers: { ...headers, Cookie: '' } })).status, 403);
      assert.equal((await f.rows('shuttle_editor_actions')).length, 0);
      assert.equal((await post('/api/shuttle/save', body)).status, 200);
      assert.equal((await post('/api/shuttle/save', { ...body, requestId: editorRequestId() })).status, 409);
      f.discord.state.members.set(OTHER, [STAFF]); assert.equal((await get('/api/shuttle/draft')).status, 403);
      assert.equal((await f.rows('shuttle_editor_actions')).length, 1); assert.deepEqual(faults, []);
    });
  });

  await scenario('E18 permission loss after commit prevents the HTTP result and a resend is stale', async f => {
    // The editor loses the capability after the commit, before the route's final check, and Discord announces it.
    let revoke = true;
    const authorize = async (...args) => {
      if (revoke) { revoke = false; f.discord.state.members.set(OTHER, [STAFF]); f.discord.announce(); }
      return f.dashboardAuthorization.authorize(...args);
    };
    const editorHttp = createOnboardingAuthoringHttp({ auth: f.auth, authorization: { ...f.dashboardAuthorization, authorize }, store: f.editorStore });
    await withServer({ ...f, editorHttp }, async ({ post, faults }) => {
      const request = { requestId: editorRequestId(), expectedRevision: 0, document: draftDocument() };
      assert.equal((await post('/api/shuttle/save', request)).status, 403);
      assert.equal((await f.rows('shuttle_editor_actions')).length, 1); f.discord.state.members.set(OTHER, [LEAD]);
      assert.equal((await post('/api/shuttle/save', request)).status, 409);
      assert.equal((await f.rows('shuttle_draft_revisions')).length, 1); assert.deepEqual(faults, []);
    });
  });

  await scenario('E19 invalid JSON, malformed UTF-8 and oversized bodies never enter authoring storage', async f => {
    await withServer(f, async ({ address, headers, get, post, faults }) => {
      for (const body of ['{broken-json', Buffer.from([0xff])]) {
        const response = await http(address, '/api/shuttle/save', { method: 'POST', headers, body });
        assert.equal(response.status, 400); assert.equal(response.text.includes('broken-json'), false);
      }
      const oversized = await http(address, '/api/shuttle/save', { method: 'POST', headers, body: 'x'.repeat(131_073) }).catch(error => ({ code: error.code }));
      assert.ok(oversized.status === 403 || oversized.code === 'ECONNRESET');
      f.clock.enabled = false; assert.equal((await get('/api/shuttle/draft')).status, 503);
      assert.equal((await post('/api/shuttle/save', { requestId: editorRequestId(), expectedRevision: 0, document: draftDocument() })).status, 503);
      assert.equal((await f.rows('shuttle_draft_revisions')).length, 0); assert.equal((await f.rows('shuttle_editor_actions')).length, 0); assert.deepEqual(faults, []);
    });
  });

  await scenario('E24 explicit message breaks survive save/publication/reload and are posted together before one acknowledgement', async f => {
    const document = { helpPauses: false, stages: [{ id: 'screen-step', title: 'Synthetic screens',
      body: '**First** screen\n\nSecond screen', screens: ['**First** screen', 'Second screen'] }] };
    await f.save(document); const reviewed = await f.review(1);
    assert.deepEqual(reviewed.pages[0].segments, document.stages[0].screens); await f.publish(1);
    const configured = (await f.rows('definitions')).find(row => row.version === 2).definition;
    assert.deepEqual(configured.screenCounts, [2]);
    await f.open(); const first = await f.current(), shown = await shuttleGroup(f.admin, f.discord.state, first);
    // Each authored message is its own plain message, posted together before the step's one Continue card.
    assert.deepEqual(shown.content.map(message => [message.content, message.embeds.length]), [['**First** screen', 0], ['Second screen', 0]]);
    assert.deepEqual(shown.nav.components[0].components.map(button => button.label), ['Back', 'Complete Shuttle']);
    for (const action of ['next-screen', 'previous-screen']) assert.equal(await f.execute(f.control(first, action)), 'shuttle_stale');
    assert.equal((await f.session()).screenIndex, 0); assert.equal((await f.session()).status, 'active');
    assert.equal((await f.rows('outbox')).some(row => row.kind === 'whitelist.grant'), false);
    assert.equal(await f.click('advance'), 'shuttle_progress_recorded'); await f.drain(f.screens);
    assert.equal((await f.session()).screenIndex, 1);
    assert.equal((await f.session()).status, 'role_pending'); const pendingId = (await f.session()).id;
    await f.drain(f.grants); await f.drain(f.screens);
    assert.equal((await f.rows('sessions')).find(row => row.id === pendingId).state.status, 'complete');
    assert.equal(f.discord.state.members.get(USER).includes(WHITELIST), true);
    assert.deepEqual((await read(f)).draft.document, document);
  });

  await scenario('E20 browser session reports current editing capability and revokes the visible affordance after role loss', async f => {
    await withServer(f, async ({ get, post, address, headers }) => {
      assert.equal((await get('/auth/session')).body.canEditOnboarding, true);
      f.discord.state.members.set(OTHER, [STAFF]);
      const denied = await get('/auth/session'); assert.equal(denied.status, 200); assert.equal(denied.body.canEditOnboarding, false);
      assert.equal((await get('/api/shuttle/draft')).status, 403);
      f.discord.state.members.set(OTHER, [LEAD]); assert.equal((await get('/auth/session')).body.canEditOnboarding, true);
      assert.equal((await post('/api/shuttle/save', { requestId: editorRequestId(), expectedRevision: 0, document: draftDocument() })).status, 200);
      assert.equal((await http(address, '/auth/logout', { method: 'POST', headers })).status, 200);
      assert.equal((await get('/auth/session')).status, 403); assert.equal((await get('/api/shuttle/draft')).status, 403);
    });
  });

  await scenario('E25 the host-only command publishes as the recorded guild owner through the same store, marked in the audit; others are refused', async f => {
    const ownerId = f.discord.state.ownerId; f.discord.state.members.set(ownerId, []);
    // The owner signs in once (Sophie records her observation); the command then works from that record without Discord.
    await f.editorActor(ownerId);
    await f.save(); assert.equal((await f.rows('shuttle_editor_actions'))[0].result.origin, undefined, 'dashboard actions are unmarked');
    const calls = f.discord.state.calls.length;
    const local = authorId => createLocalShuttlePublisher({ pool: f.pool, guildId: GUILD, definitionId: publication.id, authorId });
    await assert.rejects(local(OTHER).status(), /LOCAL_OPERATOR_AUTHOR_NOT_OWNER/, 'a lead editor is not the owner');
    await assert.rejects(local('100000000000000031').status(), /LOCAL_OPERATOR_AUTHOR_UNKNOWN/);
    const document = draftDocument(); document.stages[0].body = 'New synthetic guidance from the host.';
    const saved = await local(ownerId).save(document);
    assert.equal(saved.revision, 2); assert.equal(saved.review.valid, true); assert.equal(saved.review.version, 2);
    await assert.rejects(local(ownerId).publish({ revision: 2, sha256: saved.sha256, expectedLatestVersion: 0, expectedLatestStatus: 'none' }), /SHUTTLE_PUBLICATION_STALE/);
    const published = await local(ownerId).publish({ revision: 2, sha256: saved.sha256, expectedLatestVersion: 1, expectedLatestStatus: 'published' });
    assert.equal(published.version, 2); assert.equal(published.preservesExistingRuns, true);
    const actions = (await f.rows('shuttle_editor_actions')).slice(1);
    assert.deepEqual(actions.map(row => [row.action, row.result.origin, row.operator_grant.userId]), [['save', 'local-operator', ownerId], ['publish', 'local-operator', ownerId]]);
    const row = (await f.rows('shuttle_publications')).find(item => item.definition_version === 2);
    assert.equal(row.publication.stages[0].body, document.stages[0].body); assert.equal(row.operator_grant.userId, ownerId);
    assert.equal(f.discord.state.calls.length, calls, 'no Discord call from the host-only command');
  });
}
