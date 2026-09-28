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

const requestId = () => randomBytes(32).toString('hex');
export async function runCaseExportsSuite(cluster, run) {
  async function fixture() {
    const f = await transcriptWorkflow(cluster);
    await f.admin.query('TRUNCATE sophie_core.case_export_attempts, sophie_core.case_export_policies');
    const policy = { version: 1, enabled: true, audience: 'responders', maxObservations: 100, maxGaps: 200, maxBytes: 2_097_152 };
    const exports = createCaseExports({ pool: f.pool, transcripts: f.transcripts, readPolicy: () => policy });
    await f.message({ content: 'Synthetic <script>alert(1)</script> @everyone export sentinel' });
    const { actor, session } = await f.loginActor(OTHER);
    const scope = { actor, caseToken: f.caseToken, channelId: f.opened.channel_id };
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
    const old = await f.exports.review(f.scope);
    await f.send('MESSAGE_UPDATE', { guild_id: GUILD, channel_id: f.opened.channel_id, id: '730000000000000001', content: 'Synthetic changed copy' });
    await assert.rejects(f.confirm(old), /CASE_EXPORT_REVIEW_STALE/);
    const next = await f.exports.review(f.scope);
    await f.admin.query('UPDATE sophie_core.case_provisions SET audience_version = audience_version + 1 WHERE case_id = $1', [f.opened.id]);
    await assert.rejects(f.confirm(next), /CASE_EXPORT_REVIEW_STALE/);
    await f.child(); f.policy.audience = 'current-readers'; const actor = (await f.loginActor(USER)).actor;
    const child = { ...f.scope, actor, channelId: '720000000000000001' }, review = await f.exports.review(child);
    f.discord.state.threadMembers.delete(`${child.channelId}:${USER}`);
    await assert.rejects(f.exports.confirm({ ...child, requestId: requestId(), reviewHash: review.reviewHash, confirmed: true }));
    assert.equal((await f.rows('case_export_attempts')).length, 0);
  });
  await scenario('EX04 logout and role loss during reads or after audit never deliver bytes', async f => {
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
    await assert.rejects(f.exports.review(f.scope), /CASE_EXPORT_TOO_LARGE/);
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
      'X-CSRF-Token': csrfToken, 'Content-Type': 'application/json' }, body = { caseToken: f.caseToken, channelId: f.opened.channel_id };
    try {
      const review = await dashboardHttp(address, '/api/cases/export/review', { method: 'POST', headers, body: JSON.stringify(body) }); assert.equal(review.status, 200);
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
    assert.deepEqual(await migrateCore(f.admin), { migrations: 60 }); assert.deepEqual(await f.rows('case_export_attempts'), before);
    await assert.rejects(f.pool.query('DELETE FROM sophie_core.case_export_attempts'), error => error.code === '42501');
    await assert.rejects(cluster.knowledgePool.query('SELECT * FROM sophie_core.case_export_attempts'), error => error.code === '42501');
  });
}
