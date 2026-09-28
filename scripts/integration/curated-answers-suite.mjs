import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { createCuratedAnswers } from '../../apps/core/storage/curated-answers.js';
import { createCuratedAnswersHttp } from '../../apps/core/http/curated-answers.js';
import { createDashboardAuthHttpServer } from '../../apps/core/http/dashboard-auth.js';
import { onboardingWorkflow } from '../../tests/fixtures/onboarding-workflow.js';
import { dashboardServices } from '../../tests/fixtures/dashboard-auth.js';
import { dashboardHttp } from '../../tests/fixtures/dashboard-http.js';
import { dashboardConfiguration } from '../../tests/fixtures/oauth.js';
import { DASHBOARD_COOKIES } from '../../contracts/dashboard-auth.js';
import { GUILD, USER, OTHER, STAFF } from '../../tests/fixtures/domain.js';
import { migrateCore } from '../../apps/core/storage/migrate.js';
import { createRecoveryBundle, prepareRecoveryBundle, restoreRecoveryBundle } from '../../apps/core/recovery/bundle.js';
import { reviewedRecoveryTools } from '../../apps/core/recovery/local-operations.js';
import { stagingConfiguration } from '../../tests/fixtures/staging.js';

export async function runCuratedAnswersSuite(cluster, run) {
  const scenario = (name, work) => run(name, async () => {
    const f = await onboardingWorkflow(cluster, { extraCapabilities: { 'answers.publish': [STAFF] } });
    const answers = createCuratedAnswers({ pool: f.pool, authorize: f.authorization.authorize, guildId: GUILD });
    let sequence = 0;
    const fields = (changes = {}) => ({ name: 'synthetic-help', expectedRevision: 0, action: 'publish',
      document: { title: 'Synthetic public help', text: 'Authored synthetic public answer @everyone <@123>', source: 'Synthetic public reference' }, ...changes });
    const prepare = async (changes = {}) => {
      const actor = await f.actor(OTHER), request = fields(changes), review = await answers.review({ actor, ...request });
      return { actor, ...request, requestId: (++sequence).toString(16).padStart(64, '0'), reviewSha256: review.reviewSha256, confirmed: true, approvedPublic: true };
    };
    await work({ ...f, answers, fields, prepare });
  });
  await scenario('CA01 explicit public-source review publishes exact authored text and records one current-actor receipt', async f => {
    const request = await f.prepare(), first = await f.answers.change(request); assert.equal(first.revision, 1);
    assert.equal((await f.answers.change(request)).duplicate, true);
    const value = await f.answers.lookup({ actor: await f.actor(USER), name: request.name });
    assert.deepEqual(value.document, request.document); assert.equal(value.authorId, OTHER);
    assert.equal((await f.rows('curated_answers')).length, 1);
    assert.equal((await f.rows('outbox')).length, 0); assert.equal((await f.rows('case_reservations')).length, 0);
  });
  await scenario('CA02 members can read public answers but cannot publish or read editorial history', async f => {
    const request = await f.prepare(); await f.answers.change(request); const actor = await f.actor(USER);
    await assert.rejects(f.answers.review({ actor, ...f.fields() }), /OPERATION_DENIED/);
    await assert.rejects(f.answers.history({ actor, name: request.name }), /OPERATION_DENIED/);
    await assert.rejects(f.answers.change({ ...request, actor }), /OPERATION_DENIED/);
    assert.equal((await f.answers.list({ actor })).entries.length, 1);
    f.discord.state.members.delete(USER); await assert.rejects(f.answers.lookup({ actor, name: request.name }), /OPERATION_DENIED/);
    await assert.rejects(f.answers.lookup({ actor: { ...request.actor }, name: request.name }), /OPERATION_DENIED/);
  });
  await scenario('CA03 review digest, public-source attestation and confirmation bind every mutation', async f => {
    const request = await f.prepare();
    for (const changes of [{ confirmed: false }, { approvedPublic: false }]) await assert.rejects(f.answers.change({ ...request, ...changes }), /ANSWER_CONFIRMATION_REQUIRED/);
    await assert.rejects(f.answers.change({ ...request, document: { ...request.document, text: 'Changed after review' } }), /ANSWER_REVIEW_STALE/);
    await assert.rejects(f.answers.change({ ...request, caseId: 'not-imported' }), /ANSWER_INPUT_INVALID/);
    assert.equal((await f.rows('curated_answers')).length, 0);
  });
  await scenario('CA04 immutable revisions retain withdrawal history and exact old receipts cannot republish', async f => {
    const original = await f.prepare(); await f.answers.change(original);
    const update = await f.prepare({ expectedRevision: 1, document: { ...original.document, text: 'New synthetic public answer' } }); await f.answers.change(update);
    const withdraw = await f.prepare({ expectedRevision: 2, action: 'withdraw', document: null }); await f.answers.change(withdraw);
    await assert.rejects(f.answers.lookup({ actor: await f.actor(USER), name: original.name }), /ANSWER_UNAVAILABLE/);
    assert.equal((await f.answers.list({ actor: await f.actor(USER) })).entries.length, 0);
    assert.equal((await f.answers.change(original)).revision, 1); assert.equal((await f.rows('curated_answers')).length, 3);
    const history = await f.answers.history({ actor: original.actor, name: original.name });
    assert.deepEqual(history.entries.map(row => row.action), ['withdraw','publish','publish']); assert.deepEqual(history.entries[2].document, original.document);
    const republish = await f.prepare({ expectedRevision: 3 }); assert.equal((await f.answers.change(republish)).revision, 4);
  });
  await scenario('CA05 competing publication intents have one winner and reused receipt IDs cannot change meaning', async f => {
    const a = await f.prepare(), b = await f.prepare({ document: { ...a.document, text: 'Competing synthetic answer' } });
    const results = await Promise.allSettled([f.answers.change(a), f.answers.change(b)]);
    assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
    assert.match(results.find(result => result.status === 'rejected').reason.message, /ANSWER_STALE/);
    const won = results[0].status === 'fulfilled' ? a : b, lost = won === a ? b : a;
    await assert.rejects(f.answers.change({ ...lost, requestId: won.requestId }), /ANSWER_REQUEST_COLLISION/);
    assert.equal((await f.rows('curated_answers')).length, 1);
  });
  await scenario('CA06 final publisher revocation rolls back the publication and all retained metadata', async f => {
    const request = await f.prepare(); let calls = 0;
    const answers = createCuratedAnswers({ pool: f.pool, guildId: GUILD, authorize: async (...args) => {
      if (++calls === 2) f.discord.state.members.set(OTHER, []); return f.authorization.authorize(...args);
    } });
    await assert.rejects(answers.change(request), /OPERATION_DENIED/); assert.equal((await f.rows('curated_answers')).length, 0);
  });
  await scenario('CA07 final reader revocation denies the public result rather than trusting an earlier membership check', async f => {
    const request = await f.prepare(); await f.answers.change(request); const actor = await f.actor(USER); let calls = 0;
    const answers = createCuratedAnswers({ pool: f.pool, guildId: GUILD, authorize: async (...args) => {
      if (++calls === 2) f.discord.state.members.delete(USER); return f.authorization.authorize(...args);
    } });
    await assert.rejects(answers.lookup({ actor, name: request.name }), /OPERATION_DENIED/);
  });
  await scenario('CA08 bounded public pages and editorial history preserve distinct names and revision cursors', async f => {
    for (let i = 0; i < 26; i++) await f.answers.change(await f.prepare({ name: `answer-${String(i).padStart(2,'0')}` }));
    const actor = await f.actor(USER), page = await f.answers.list({ actor }); assert.equal(page.entries.length, 25); assert.equal(page.next, 'answer-24');
    const last = await f.answers.list({ actor, after: page.next }); assert.equal(last.entries[0].name, 'answer-25'); assert.equal(last.next, null);
    for (let i = 1; i < 12; i++) await f.answers.change(await f.prepare({ name: 'answer-00', expectedRevision: i }));
    const history = await f.answers.history({ actor: await f.actor(OTHER), name: 'answer-00' }); assert.equal(history.entries.length, 10); assert.equal(history.nextBefore, 3);
    assert.deepEqual((await f.answers.history({ actor: await f.actor(OTHER), name: 'answer-00', before: 3 })).entries.map(row => row.revision), [2,1]);
  });
  await scenario('CA09 corrupted publication text is withheld from lookup, listing, history and mutation', async f => {
    const request = await f.prepare(); await f.answers.change(request);
    await f.admin.query("UPDATE sophie_core.curated_answers SET document = jsonb_set(document, '{text}', '\"Changed outside workflow\"')");
    const actor = await f.actor(OTHER);
    for (const read of [() => f.answers.lookup({ actor, name: request.name }), () => f.answers.list({ actor }),
      () => f.answers.history({ actor, name: request.name }), () => f.answers.change(request)]) await assert.rejects(read(), /ANSWER_CORRUPT/);
  });
  await scenario('CA10 maximum library size counts withdrawn identities but allows reviewed revisions of existing names', async f => {
    const base = await f.prepare();
    for (let i = 0; i < 100; i++) {
      const request = { name: `synthetic-${i}`, expectedRevision: 0, action: 'publish', document: base.document };
      const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
      await f.admin.query(`INSERT INTO sophie_core.curated_answers (guild_id,name,revision,action,document,document_sha256,request_id,request_sha256,operator_grant,approved_public)
        VALUES ($1,$2,1,'publish',$3,$4,$5,$6,$7,true)`, [GUILD, request.name, request.document, hash(request.document), (1000+i).toString(16).padStart(64,'0'), hash(request), base.actor]);
    }
    await assert.rejects(f.answers.change(base), /ANSWER_LIMIT/);
    await f.answers.change(await f.prepare({ name: 'synthetic-0', expectedRevision: 1, action: 'withdraw', document: null }));
    await assert.rejects(f.answers.review({ actor: base.actor, ...f.fields() }), /ANSWER_LIMIT/);
    assert.equal((await f.answers.change(await f.prepare({ name: 'synthetic-0', expectedRevision: 2 }))).revision, 3);
  });
  await scenario('CA11 authenticated HTTP enforces CSRF, exact review, closed inputs and safe member lookup', async f => {
    const d = dashboardServices(f), authorization = d.dashboardAuthorization, faults = [];
    const answers = createCuratedAnswers({ pool: f.pool, authorize: authorization.authorize, guildId: GUILD });
    const server = createDashboardAuthHttpServer({ configuration: dashboardConfiguration, auth: d.auth, authorization,
      answers: createCuratedAnswersHttp({ auth: d.auth, authorization, answers }), enabled: () => true, onFault: code => faults.push(code) });
    const address = await server.listen();
    try {
      const login = await d.login(OTHER), session = await d.auth.authenticate({ token: login.token });
      const headers = { Cookie: `${DASHBOARD_COOKIES.session}=${login.token}`, Origin: dashboardConfiguration.origin,
        'X-CSRF-Token': session.csrfToken, 'Content-Type': 'application/json' };
      const post = (path, body, extras = {}) => dashboardHttp(address, `/api/answers/${path}`, { method: 'POST', headers: { ...headers, ...extras }, body: JSON.stringify(body) });
      const request = f.fields(); assert.equal((await post('review', request, { 'X-CSRF-Token': '' })).status, 403);
      const review = await post('review', request); assert.equal(review.status, 200); assert.equal(review.body.actorId, OTHER);
      const changed = { ...request, requestId: 'a'.repeat(64), reviewSha256: review.body.reviewSha256, confirmed: true, approvedPublic: true };
      assert.equal((await post('change', { ...changed, approvedPublic: false })).status, 400);
      assert.equal((await post('change', { ...changed, actorId: USER })).status, 400);
      assert.equal((await post('change', changed)).status, 200); assert.equal((await post('change', changed)).body.duplicate, true);
      assert.equal((await post('review', request)).status, 409);
      const member = await d.login(USER), memberHeaders = { Cookie: `${DASHBOARD_COOKIES.session}=${member.token}` };
      const lookup = await dashboardHttp(address, `/api/answers/lookup?name=${request.name}`, { headers: memberHeaders });
      assert.equal(lookup.status, 200); assert.deepEqual(lookup.body.document, request.document); assert.equal(lookup.headers['cache-control'], 'no-store');
      assert.equal((await dashboardHttp(address, `/api/answers/history?name=${request.name}`, { headers: memberHeaders })).status, 403);
      assert.equal((await dashboardHttp(address, `/api/answers/lookup?name=${request.name}&caseId=123`, { headers: memberHeaders })).status, 400);
      assert.equal((await dashboardHttp(address, '/api/answers/lookup?name=unpublished', { headers: memberHeaders })).status, 404);
      assert.deepEqual(faults, []);
    } finally { await server.close(); }
  });
  await scenario('CA12 migration replay retains publications and restricted core cannot delete their audit history', async f => {
    const request = await f.prepare(); await f.answers.change(request); const before = await f.rows('curated_answers');
    assert.deepEqual(await migrateCore(f.admin), { migrations: 60 }); assert.deepEqual(await f.rows('curated_answers'), before);
    await assert.rejects(f.pool.query('DELETE FROM sophie_core.curated_answers'), error => error.code === '42501');
    await assert.rejects(f.pool.query('TRUNCATE sophie_core.curated_answers'), error => error.code === '42501');
  });
  await scenario('CA13 encrypted core restore retains withdrawn public text, authorship and exact publication receipts', async f => {
    await f.answers.change(await f.prepare());
    await f.answers.change(await f.prepare({ expectedRevision: 1, action: 'withdraw', document: null }));
    const configuration = stagingConfiguration('a'.repeat(64)); configuration.capabilityPolicy = f.policy;
    const { configuration: database, binaryRoot, directory: parent } = cluster.recovery;
    const tools = await reviewedRecoveryTools(binaryRoot), key = randomBytes(32), maxDatabaseBytes = 33554432;
    const backup = await createRecoveryBundle({ pool: f.admin, database, tools, configuration, buildId: 'a'.repeat(64), vaultRoots: [], parent, key, maxDatabaseBytes });
    const prepared = await prepareRecoveryBundle({ directory: backup.directory, parent, key, maxDatabaseBytes, confirmGuildId: GUILD, expectedManifestSha256: backup.manifestSha256 });
    const target = await cluster.recovery.createTarget();
    const restored = await restoreRecoveryBundle({ prepared, pool: target.pool, database: target.configuration, tools });
    assert.equal(restored.tableCountsVerified, true);
    assert.deepEqual((await target.pool.query('SELECT * FROM sophie_core.curated_answers ORDER BY revision')).rows, await f.rows('curated_answers'));
    assert.equal((await target.pool.query('SHOW default_transaction_read_only')).rows[0].default_transaction_read_only, 'on');
  });
}
