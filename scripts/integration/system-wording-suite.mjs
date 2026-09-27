import assert from 'node:assert/strict';
import { onboardingWorkflow } from '../../tests/fixtures/onboarding-workflow.js';
import { createSystemWordingReader, createSystemWordingStore, readSystemWording } from '../../apps/core/storage/system-wording.js';
import { GUILD, OTHER, LEAD, STAFF, publication } from '../../tests/fixtures/domain.js';

export async function runSystemWordingSuite(cluster, run) {
  async function fixture() {
    const f = await onboardingWorkflow(cluster);
    await f.admin.query('TRUNCATE sophie_core.system_wording');
    f.discord.state.members.set(OTHER, [LEAD]);
    const editor = createSystemWordingStore({ pool: f.pool, authorize: f.authorization.authorize, guildId: GUILD, definitionId: publication.id });
    const actor = () => f.actor(OTHER);
    return { ...f, editor, editorActor: actor };
  }
  await run('L01 wording persists, concurrent edits conflict, and uncertain retries are idempotent', async () => {
    const f = await fixture(), actor = await f.editorActor();
    const request = { actor, requestId: 'a'.repeat(64), expectedRevision: 0, wording: { 'onboarding.next': 'Next page' } };
    const first = await f.editor.save(request); assert.equal(first.revision, 1);
    assert.deepEqual(await f.editor.save(request), first);
    const restarted = createSystemWordingReader({ pool: f.pool, guildId: GUILD });
    assert.equal((await restarted())('onboarding.next'), 'Next page');
    await assert.rejects(f.editor.save({ ...request, wording: {} }), /SYSTEM_WORDING_CONFLICT/);
    const results = await Promise.allSettled(['b', 'c'].map(value => f.editor.save({ actor, requestId: value.repeat(64), expectedRevision: 1, wording: { 'onboarding.next': value } })));
    assert.equal(results.filter(value => value.status === 'fulfilled').length, 1);
    assert.match(results.find(value => value.status === 'rejected').reason.message, /SYSTEM_WORDING_CONFLICT/);
    assert.equal((await f.admin.query('SELECT count(*)::integer AS count FROM sophie_core.system_wording')).rows[0].count, 2);
    assert.equal((await readSystemWording(f.pool, GUILD, 1)).text('onboarding.next'), 'Next page');
    const saved = await f.editor.read({ actor });
    await f.editor.save({ actor, requestId: 'd'.repeat(64), expectedRevision: saved.revision, wording: {} });
    assert.equal((await restarted())('onboarding.next'), 'Next screen');
  });
  await run('L02 wording requires current publisher authority on reads, writes and duplicate requests', async () => {
    const f = await fixture(), actor = await f.editorActor();
    const input = { actor, requestId: 'e'.repeat(64), expectedRevision: 0, wording: { 'onboarding.next': 'Next page' } };
    await f.editor.save(input); f.discord.state.members.set(OTHER, [STAFF]);
    await assert.rejects(f.editor.read({ actor }), /OPERATION_DENIED|CAPABILITY_REVOKED/);
    await assert.rejects(f.editor.save(input), /OPERATION_DENIED|CAPABILITY_REVOKED/);
    await assert.rejects(f.editor.save({ ...input, actor: { ...actor } }), /OPERATION_DENIED|UNTRUSTED_PRINCIPAL/);
    await assert.rejects(cluster.knowledgePool.query('SELECT * FROM sophie_core.system_wording'), error => error.code === '42501');
    await assert.rejects(f.pool.query('DELETE FROM sophie_core.system_wording'), error => error.code === '42501');
  });
  await run('L03 authorization loss after insertion rolls back the wording revision', async () => {
    const f = await fixture(), actor = await f.editorActor(); let checked = 0;
    const editor = createSystemWordingStore({ pool: f.pool, guildId: GUILD, definitionId: publication.id, authorize: async () => ++checked === 1 });
    await assert.rejects(editor.save({ actor, requestId: 'f'.repeat(64), expectedRevision: 0, wording: {} }), /OPERATION_DENIED/);
    assert.equal((await f.admin.query('SELECT count(*)::integer AS count FROM sophie_core.system_wording')).rows[0].count, 0);
  });
  await run('L04 saved wording reaches the persistent page while in-flight alerts retain their pinned revision', async () => {
    const f = await fixture(), actor = await f.editorActor();
    const wording = { 'onboarding.continue': 'I understand', 'onboarding.alert.help.body': 'Synthetic help notice, first revision.' };
    await f.editor.save({ actor, requestId: '1'.repeat(64), expectedRevision: 0, wording });
    const first = await f.open();
    assert.equal(f.discord.state.messages.get(first.message_id).components[0].components[0].label, 'I understand');
    assert.equal(await f.click('help'), 'shuttle_help_recorded'); await f.drain(f.screens);
    assert.equal((await f.current()).message_id, first.message_id);
    f.discord.state.afterWrite = async call => {
      if (call.method === 'POST' && call.path.endsWith('/messages')) {
        f.discord.state.afterWrite = null;
        await f.editor.save({ actor: await f.editorActor(), requestId: '2'.repeat(64), expectedRevision: 1,
          wording: { ...wording, 'onboarding.alert.help.body': 'Synthetic help notice, second revision.' } });
      }
    };
    await f.drain(f.alerts);
    const alert = (await f.rows('shuttle_alerts'))[0];
    assert.equal(alert.wording_revision, 1);
    assert.equal(f.discord.state.messages.get(alert.message_id).embeds[0].description, wording['onboarding.alert.help.body']);
    assert.equal((await createSystemWordingReader({ pool: f.pool, guildId: GUILD })())('onboarding.alert.help.body'), 'Synthetic help notice, second revision.');
  });
}
