import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { transcriptWorkflow } from './case-transcripts-suite.mjs';
import { createCaseExports } from '../../apps/core/storage/case-exports.js';
import { createCaseExportsHttp } from '../../apps/core/http/case-exports.js';
import { createDashboardAuthHttpServer } from '../../apps/core/http/dashboard-auth.js';
import { migrateCore } from '../../apps/core/storage/migrate.js';
import { dashboardBytes, dashboardHttp } from '../../tests/fixtures/dashboard-http.js';
import { dashboardConfiguration } from '../../tests/fixtures/oauth.js';
import { DASHBOARD_COOKIES } from '../../contracts/dashboard-auth.js';
import { GUILD, USER, OTHER } from '../../tests/fixtures/domain.js';
import { CREW } from '../../tests/fixtures/discord.js';
import { authDigest } from '../../apps/core/security/dashboard-auth.js';
import { transcriptCursor } from '../../modules/tickets/transcript.js';
import { recordCaseCaptureGap } from '../../apps/core/storage/case-capture-coverage.js';

const requestId = () => randomBytes(32).toString('hex');
export async function runCaseExportsSuite(cluster, run) {
  async function fixture() {
    const f = await transcriptWorkflow(cluster);
    await f.admin.query('TRUNCATE sophie_core.case_export_attempts, sophie_core.case_export_policies');
    const policy = { version: 1, enabled: true, audience: 'responders', maxObservations: 100, maxGaps: 200, maxBytes: 2_097_152 };
    const exports = createCaseExports({ pool: f.pool, transcripts: f.transcripts, readPolicy: () => policy });
    await f.message({ content: 'Synthetic <script>alert(1)</script> @everyone export sentinel' });
    const { actor, session } = await f.loginActor(OTHER);
    const scope = { actor, caseToken: f.caseToken, channelId: f.opened.channel_id, after: null, gapsAfter: null };
    const confirm = async (review, extra = {}) => exports.confirm({ ...scope, requestId: requestId(), reviewHash: review.reviewHash, confirmed: true, ...extra });
    return { ...f, policy, exports, scope, session, confirm };
  }
  const scenario = (name, work) => run(name, async () => work(await fixture()));
  await scenario('EX01 exact confirmed export retains metadata audit and retries without duplicate records or active content', async f => {
    const review = await f.exports.review(f.scope); assert.equal('body' in review, false); assert.equal(review.completeHistory, false);
    await assert.rejects(f.confirm(review, { confirmed: false }), /CASE_EXPORT_CONFIRMATION_REQUIRED/);
    await assert.rejects(f.confirm(review, { reviewHash: 'a'.repeat(64) }), /CASE_EXPORT_REVIEW_STALE/);
    assert.equal((await f.rows('case_export_attempts')).length, 0);
    const id = requestId(), first = await f.confirm(review, { requestId: id }), retry = await f.confirm(review, { requestId: id });
    assert.equal(first.body, retry.body); assert.ok(first.body.includes('&lt;script&gt;')); assert.equal(first.body.includes('<script>'), false);
    assert.equal(createHash('sha256').update(first.body).digest('hex'), review.sha256);
    assert.equal((await f.rows('case_export_attempts')).length, 1);
    assert.equal(Object.hasOwn((await f.rows('case_export_attempts'))[0], 'body'), false);
    assert.ok(first.body.includes('Partial record only')); assert.ok(first.body.includes('file bytes are not included'));
  });
  await scenario('EX02 export audience and disabled policy deny before reading content, reader permission remains separate', async f => {
    const member = (await f.loginActor(USER)).actor; f.hooks.contentReads = 0;
    await assert.rejects(f.exports.review({ ...f.scope, actor: member }), /CASE_ACCESS_DENIED/); assert.equal(f.hooks.contentReads, 0);
    f.policy.audience = 'current-readers'; assert.equal((await f.exports.review({ ...f.scope, actor: member })).observations, 1);
    f.policy.enabled = false; f.hooks.contentReads = 0;
    await assert.rejects(f.exports.review(f.scope), /CASE_EXPORT_DISABLED/); assert.equal(f.hooks.contentReads, 0);
  });
  await scenario('EX03 changed observations or audience invalidate review and revoked child access suppresses export', async f => {
    f.policy.maxObservations = 1;
    await f.send('MESSAGE_UPDATE', { guild_id: GUILD, channel_id: f.opened.channel_id, id: '730000000000000001', content: 'Synthetic second observation' });
    Object.assign(f.scope, (await f.exports.review(f.scope)).continuation);
    const old = await f.exports.review(f.scope);
    await f.send('MESSAGE_UPDATE', { guild_id: GUILD, channel_id: f.opened.channel_id, id: '730000000000000001', content: 'Synthetic changed copy' });
    await assert.rejects(f.confirm(old), /CASE_EXPORT_REVIEW_STALE/);
    const next = await f.exports.review(f.scope);
    await f.admin.query('UPDATE sophie_core.case_provisions SET audience_version = audience_version + 1 WHERE case_id = $1', [f.opened.id]);
    await assert.rejects(f.confirm(next), /CASE_EXPORT_REVIEW_STALE/);
    await f.child(); f.policy.audience = 'current-readers'; const actor = (await f.loginActor(USER)).actor;
    const child = { ...f.scope, actor, channelId: '720000000000000001', after: null, gapsAfter: null };
    await f.send('MESSAGE_UPDATE', { guild_id: GUILD, channel_id: child.channelId, id: '730000000000000001', content: 'Synthetic child revision' });
    Object.assign(child, (await f.exports.review(child)).continuation);
    const review = await f.exports.review(child);
    f.discord.state.threadMembers.delete(`${child.channelId}:${USER}`);
    await assert.rejects(f.exports.confirm({ ...child, requestId: requestId(), reviewHash: review.reviewHash, confirmed: true }));
    assert.equal((await f.rows('case_export_attempts')).length, 0);
  });
  await scenario('EX04 logout and role loss during reads or after audit never deliver bytes', async f => {
    f.policy.maxObservations = 1;
    await f.send('MESSAGE_UPDATE', { guild_id: GUILD, channel_id: f.opened.channel_id, id: '730000000000000001', content: 'Synthetic continued observation' });
    Object.assign(f.scope, (await f.exports.review(f.scope)).continuation);
    f.hooks.afterRead = () => f.authStore.revokeSession(authDigest(f.session.token));
    await assert.rejects(f.exports.review(f.scope), /CASE_ACCESS_DENIED/); f.hooks.afterRead = null;
    f.scope.actor = (await f.loginActor(OTHER)).actor; const review = await f.exports.review(f.scope); let reads = 0;
    const exports = createCaseExports({ pool: f.pool, readPolicy: () => f.policy, transcripts: { async prepareExport(...args) {
      if (++reads === 2) f.discord.state.members.set(OTHER, [CREW]);
      return f.transcripts.prepareExport(...args);
    } } });
    await assert.rejects(exports.confirm({ ...f.scope, requestId: requestId(), reviewHash: review.reviewHash, confirmed: true }), /CASE_ACCESS_DENIED/);
    assert.equal((await f.rows('case_export_attempts')).length, 1); // Generation audit is not a delivery receipt.
  });
  await scenario('EX05 size bounds fail without silent truncation and policy versions cannot be relabelled', async f => {
    const review = await f.exports.review(f.scope); await f.confirm(review);
    f.policy.maxBytes = 1024; await assert.rejects(f.exports.review(f.scope), /CASE_EXPORT_TOO_LARGE/);
    f.policy.maxBytes = 2_097_152; f.policy.maxObservations = 1;
    const altered = await f.exports.review(f.scope); await assert.rejects(f.confirm(altered), /CASE_EXPORT_POLICY_CHANGED/);
    await f.send('MESSAGE_UPDATE', { guild_id: GUILD, channel_id: f.opened.channel_id, id: '730000000000000001', content: 'Synthetic second observation' });
    const part = await f.exports.review(f.scope); assert.equal(part.observations, 1); assert.ok(part.continuation);
    assert.equal((await f.rows('case_export_attempts')).length, 1);
  });
  await scenario('EX06 audit failure rolls back generation and conflicting request IDs do not replace the first attempt', async f => {
    const review = await f.exports.review(f.scope);
    const broken = createCaseExports({ transcripts: f.transcripts, readPolicy: () => f.policy, pool: { async connect() {
      const client = await f.pool.connect(); return { release: () => client.release(), async query(sql, values) {
        if (sql.startsWith('INSERT INTO sophie_core.case_export_attempts')) throw new Error('SYNTHETIC_AUDIT_FAILURE');
        return client.query(sql, values);
      } };
    } } });
    await assert.rejects(broken.confirm({ ...f.scope, requestId: requestId(), reviewHash: review.reviewHash, confirmed: true }), /SYNTHETIC_AUDIT_FAILURE/);
    assert.equal((await f.rows('case_export_policies')).length, 0); assert.equal((await f.rows('case_export_attempts')).length, 0);
    const id = requestId(); await f.confirm(review, { requestId: id });
    await f.send('MESSAGE_UPDATE', { guild_id: GUILD, channel_id: f.opened.channel_id, id: '730000000000000001', content: 'Synthetic later observation' });
    await assert.rejects(f.confirm(await f.exports.review(f.scope), { requestId: id }), /CASE_EXPORT_REQUEST_COLLISION/);
    assert.equal((await f.rows('case_export_attempts'))[0].review_hash, review.reviewHash);
  });
  await scenario('EX07 authenticated loopback export requires CSRF confirmation and serves an inert no-store attachment', async f => {
    const route = createCaseExportsHttp({ auth: f.auth, authorization: f.authorization, exports: f.exports });
    const server = createDashboardAuthHttpServer({ configuration: dashboardConfiguration, auth: f.auth, authorization: f.authorization,
      caseExports: route, enabled: () => true, onFault: () => {} }); const address = await server.listen();
    const { csrfToken } = await f.auth.authenticate({ token: f.session.token });
    const headers = { Cookie: `${DASHBOARD_COOKIES.session}=${f.session.token}`, Origin: dashboardConfiguration.origin,
      'X-CSRF-Token': csrfToken, 'Content-Type': 'application/json' }, body = { caseToken: f.caseToken, channelId: f.opened.channel_id, after: null, gapsAfter: null };
    try {
      const review = await dashboardHttp(address, '/api/cases/export/review', { method: 'POST', headers, body: JSON.stringify(body) }); assert.equal(review.status, 200);
      for (const invalid of [{ caseToken: body.caseToken, channelId: body.channelId }, { ...body, after: '!' },
        { ...body, gapsAfter: transcriptCursor('a'.repeat(48), body.channelId, ['b'.repeat(48)]) }, { ...body, extra: true }]) {
        assert.equal((await dashboardHttp(address, '/api/cases/export/review', { method: 'POST', headers, body: JSON.stringify(invalid) })).status, 400);
      }
      const request = { ...body, requestId: requestId(), reviewHash: review.body.reviewHash, confirmed: true };
      const denied = await dashboardBytes(address, '/api/cases/export/download', { method: 'POST', headers: { ...headers, 'X-CSRF-Token': '0'.repeat(64) }, body: JSON.stringify(request) });
      assert.equal(denied.status, 403); assert.equal((await f.rows('case_export_attempts')).length, 0);
      const file = await dashboardBytes(address, '/api/cases/export/download', { method: 'POST', headers, body: JSON.stringify(request) });
      assert.equal(file.status, 200); assert.equal(file.headers['cache-control'], 'no-store'); assert.ok(file.headers['content-disposition'].startsWith('attachment; filename="sophie-transcript-'));
      assert.ok(file.headers['content-security-policy'].includes('sandbox')); assert.equal(createHash('sha256').update(file.bytes).digest('hex'), review.body.sha256);
      await f.authStore.revokeSession(authDigest(f.session.token));
      assert.equal((await dashboardBytes(address, '/api/cases/export/download', { method: 'POST', headers, body: JSON.stringify(request) })).status, 403);
    } finally { await server.close(); }
  });
  await scenario('EX08 export audit survives idempotent migrations and core or knowledge cannot delete/read outside its boundary', async f => {
    await f.confirm(await f.exports.review(f.scope)); const before = await f.rows('case_export_attempts');
    assert.deepEqual(await migrateCore(f.admin), { migrations: 69 }); assert.deepEqual(await f.rows('case_export_attempts'), before);
    await assert.rejects(f.pool.query('DELETE FROM sophie_core.case_export_attempts'), error => error.code === '42501');
    await assert.rejects(cluster.knowledgePool.query('SELECT * FROM sophie_core.case_export_attempts'), error => error.code === '42501');
  });
  for (const [name, total, extraGaps, maxObservations, maxGaps] of [
    ['EX09 long history parts retain observation position after exhaustion while gaps continue', 105, 6, 25, 1],
    ['EX10 parts retain gap position after exhaustion while observations continue', 7, 0, 2, 200],
  ]) await scenario(name, async f => {
    Object.assign(f.policy, { maxObservations, maxGaps });
    for (let i = 1; i < total; i++) await f.send('MESSAGE_UPDATE', { guild_id: GUILD, channel_id: f.opened.channel_id,
      id: '730000000000000001', content: `Synthetic paged revision ${i}` });
    for (let i = 0; i < extraGaps; i++) await recordCaseCaptureGap(f.admin, { guildId: GUILD, channelId: f.scope.channelId,
      from: f.clock.now, to: f.clock.now, reason: 'gateway-sequence-gap', recovery: 'observed' });
    const expected = (await f.admin.query(`SELECT token FROM sophie_core.case_capture_gaps
      WHERE guild_id=$1 AND (channel_id IS NULL OR channel_id=$2) ORDER BY token COLLATE "C"`, [GUILD, f.scope.channelId])).rows.map(row => row.token);
    let scope = { ...f.scope }, observations = 0, parts = 0, first = null, exhausted = false;
    const gaps = [], bodies = [], filenames = new Set(), request = requestId();
    do {
      const review = await f.exports.review(scope);
      assert.equal(review.after, scope.after); assert.equal(review.gapsAfter, scope.gapsAfter); assert.equal(review.completeHistory, false);
      assert.ok(review.observations <= maxObservations && review.gaps <= maxGaps && review.bytes <= f.policy.maxBytes);
      if (parts === 1) {
        await assert.rejects(f.exports.confirm({ ...scope, reviewHash: first.reviewHash, requestId: request, confirmed: true }), /CASE_EXPORT_REVIEW_STALE/);
        await assert.rejects(f.exports.confirm({ ...scope, reviewHash: review.reviewHash, requestId: request, confirmed: true }), /CASE_EXPORT_REQUEST_COLLISION/);
      }
      const input = { ...scope, reviewHash: review.reviewHash, requestId: parts ? requestId() : request, confirmed: true };
      const file = await f.exports.confirm(input);
      if (!parts) { first = review; assert.equal((await f.exports.confirm(input)).body, file.body); }
      observations += review.observations; bodies.push(file.body); filenames.add(file.filename);
      gaps.push(...[...file.body.matchAll(/&quot;token&quot;: &quot;([a-f0-9]{48})&quot;/g)].map(match => match[1]));
      if (review.observations === 0 || review.gaps === 0) exhausted = true;
      if (review.continuation) {
        if (review.observations === 0) assert.equal(review.continuation.after, scope.after);
        if (review.gaps === 0) assert.equal(review.continuation.gapsAfter, scope.gapsAfter);
        assert.notDeepEqual(review.continuation, { after: scope.after, gapsAfter: scope.gapsAfter });
        scope = { ...scope, ...review.continuation };
      } else scope = null;
      assert.ok(++parts <= total + expected.length, 'Pagination must terminate');
    } while (scope);
    assert.equal(observations, total); assert.deepEqual(gaps, expected); assert.ok(exhausted);
    assert.equal(filenames.size, parts); assert.equal((await f.rows('case_export_attempts')).length, parts);
    for (let i = 1; i < total; i++) assert.equal(bodies.join('').split(`Synthetic paged revision ${i}&quot;`).length - 1, 1);
  });
}
