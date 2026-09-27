import { closeTestCase } from '../../tests/fixtures/case-lifecycle.js';
import assert from 'node:assert/strict';
import { onboardingWorkflow } from '../../tests/fixtures/onboarding-workflow.js';
import { createInteractionHttpServer } from '../../apps/core/discord/interaction-http.js';
import { createInteractionResponder } from '../../apps/core/discord/interaction-response.js';
import { GUILD, USER, OTHER, LEAD, definition, publication, command } from '../../tests/fixtures/domain.js';
import { CREW, BYOND_ROLE, MUZZLED, WHITELIST } from '../../tests/fixtures/discord.js';
import { APPLICATION } from '../../tests/fixtures/interactions.js';

export async function runOnboardingPauseSuite(cluster, run) {
  const scenario = (name, work) => run(name, async () => work(await onboardingWorkflow(cluster, { helpPauses: true })));
  const request = async f => (await f.rows('shuttle_help_requests')).find(row => row.status === 'open');
  const pause = async f => { assert.equal(await f.click('help'), 'shuttle_help_paused'); await f.drain(f.screens); return request(f); };

  await scenario('W01 a published pause freezes signed and shared-core progression until logged Staff resumption', async f => {
    await f.open(); assert.equal(await f.click('advance'), 'shuttle_progress_recorded'); await f.drain(f.screens);
    const before = await f.session(), help = await pause(f), paused = await f.session();
    assert.equal(paused.helpPaused, true); assert.equal(paused.stepIndex, 1); assert.equal(paused.version, before.version + 1);
    for (const action of ['advance', 'back', 'retry']) assert.equal(await f.click(action), 'shuttle_paused');
    await assert.rejects(f.store.transition({ actor: await f.actor(), action: 'advance', interactionId: f.nextId(), sessionId: paused.id,
      command: command(paused), observation: await f.discord.roles.observe(USER) }), /SHUTTLE_PAUSED/);
    assert.equal(await f.resolve(help), 'shuttle_help_resumed'); await f.drain(f.screens);
    const resumed = await f.session(); assert.equal(resumed.helpPaused, false); assert.equal(resumed.stepIndex, before.stepIndex);
    assert.equal((await f.rows('shuttle_help_resolutions'))[0].resumed_version, resumed.version);
    assert.equal((await f.rows('outbox')).filter(row => row.kind === 'whitelist.grant').length, 0);
    assert.equal(await f.click('advance'), 'shuttle_progress_recorded'); assert.equal((await f.session()).stepIndex, 2);
  });

  await scenario('W02 pausing queued Whitelist delivery cancels it and resume needs a fresh final acknowledgement', async f => {
    const pending = await f.pending(), help = await pause(f);
    assert.equal((await f.session()).status, 'active'); assert.equal((await f.session()).stepIndex, 4);
    assert.equal((await f.grants.runOnce('paused-grant')).code, 'SHUTTLE_PAUSED');
    assert.equal(f.discord.state.members.get(USER).includes(WHITELIST), false);
    assert.equal(await f.resolve(help), 'shuttle_help_resumed'); await f.drain(f.screens);
    assert.equal((await f.grants.runOnce('resumed-without-ack')).status, 'idle');
    assert.equal(await f.click('advance'), 'shuttle_progress_recorded'); await f.drain(f.grants); await f.drain(f.screens);
    assert.equal((await f.current()).snapshot.status, 'complete'); assert.equal(f.discord.state.members.get(USER).includes(WHITELIST), true);
    const jobs = (await f.rows('outbox')).filter(row => row.kind === 'whitelist.grant');
    assert.equal(jobs.length, 2); assert.equal(jobs.find(row => row.effect.expectedSessionVersion === pending.version).status, 'cancelled');
    assert.equal(jobs.find(row => row.status === 'done').effect.expectedSessionVersion > pending.version, true);
  });

  await scenario('W03 pausing while a grant is in flight rejects confirmation and compensates the late role', async f => {
    await f.pending(); const control = f.control(await f.current(), 'help');
    f.discord.state.afterWrite = async call => {
      if (call.method === 'PUT' && call.path.endsWith(WHITELIST)) {
        f.discord.state.afterWrite = null; assert.equal(await f.execute(control), 'shuttle_help_paused');
      }
    };
    assert.equal((await f.grants.runOnce('in-flight-pause')).code, 'SHUTTLE_PAUSED');
    assert.equal((await f.session()).helpPaused, true); assert.equal((await f.session()).status, 'active');
    await f.drain(f.grants); await f.drain(f.screens);
    assert.equal(f.discord.state.members.get(USER).includes(WHITELIST), false); assert.equal(await f.session(), undefined);
    const oldHelp = await request(f); await f.open(); const fresh = await f.session(); assert.equal(fresh.stepIndex, 0);
    assert.equal(await f.resolve(oldHelp), 'shuttle_help_resolved'); assert.equal((await f.session()).id, fresh.id);
  });

  await scenario('W04 Staff resume alone cannot legitimize an old grant already in flight', async f => {
    await f.pending(); const control = f.control(await f.current(), 'help');
    f.discord.state.afterWrite = async call => {
      if (call.method === 'PUT' && call.path.endsWith(WHITELIST)) {
        f.discord.state.afterWrite = null; assert.equal(await f.execute(control), 'shuttle_help_paused');
        assert.equal(await f.resolve(await request(f)), 'shuttle_help_resumed');
      }
    };
    assert.equal((await f.grants.runOnce('in-flight-resume')).status, 'settled');
    assert.equal((await f.session()).status, 'active'); assert.equal((await f.session()).helpPaused, false);
    await f.drain(f.grants); assert.equal(f.discord.state.members.get(USER).includes(WHITELIST), false);
    assert.equal((await f.rows('sessions')).some(row => row.state.status === 'complete'), false);
  });

  await scenario('W05 Muzzled or restrictive mute intent keeps the pause and request open', async f => {
    await f.open(); const help = await pause(f), before = await f.session();
    f.discord.state.members.get(USER).push(MUZZLED);
    assert.equal(await f.resolve(help), 'shuttle_help_waiting');
    assert.equal((await f.rows('shuttle_help_resolutions')).length, 0); assert.equal((await request(f)).interaction_id, help.interaction_id);
    assert.deepEqual(await f.session(), before);
    f.discord.state.members.set(USER, [CREW, BYOND_ROLE]); await f.open();
    f.discord.state.members.set(OTHER, [LEAD]);
    await f.store.requestMute({ actor: await f.actor(OTHER), interactionId: f.nextId(), observation: await f.discord.roles.observe(USER) });
    assert.equal(await f.resolve(help), 'shuttle_help_waiting'); assert.equal(f.discord.state.members.get(USER).includes(MUZZLED), false);
    await f.store.confirmUnmuted({ actor: await f.actor(OTHER), interactionId: f.nextId(), observation: await f.discord.roles.observe(USER) });
    assert.equal((await f.session()).helpPaused, true);
    assert.equal(await f.resolve(help), 'shuttle_help_resumed'); assert.equal((await f.session()).stepIndex, before.stepIndex);
  });

  await scenario('W06 duplicate help and resolution preserve one pause, one resumption and inert old controls', async f => {
    const original = await f.open(), body = f.control(original, 'help');
    assert.equal(await f.execute(body), 'shuttle_help_paused'); assert.equal(await f.execute(body), 'shuttle_help_paused');
    await f.drain(f.screens); const paused = await f.session(), help = await request(f), old = await f.current();
    assert.equal(await f.click('help'), 'shuttle_help_paused'); assert.equal((await f.session()).version, paused.version);
    const resolution = f.resolution(help);
    assert.equal(await f.execute(resolution), 'shuttle_help_resumed'); const version = (await f.session()).version;
    assert.equal(await f.execute(resolution), 'shuttle_help_resumed'); assert.equal((await f.session()).version, version);
    await f.drain(f.screens); assert.equal(await f.execute(f.control(old, 'advance')), 'shuttle_stale');
    assert.equal((await f.rows('shuttle_help_requests')).length, 1); assert.equal((await f.rows('shuttle_help_resolutions')).length, 1);
  });

  await scenario('W07 pause and resumption failures roll back state, audit and screen intents together', async f => {
    await f.open(); const before = await f.session();
    await f.admin.query("ALTER TABLE sophie_core.outbox ADD CONSTRAINT synthetic_pause_failure CHECK (kind <> 'shuttle.render') NOT VALID");
    try { assert.equal(await f.click('help'), 'unavailable'); }
    finally { await f.admin.query('ALTER TABLE sophie_core.outbox DROP CONSTRAINT synthetic_pause_failure'); }
    assert.deepEqual(await f.session(), before); assert.equal((await f.rows('shuttle_help_requests')).length, 0);
    const help = await pause(f), paused = await f.session(), screen = await f.current();
    await f.admin.query("ALTER TABLE sophie_core.outbox ADD CONSTRAINT synthetic_resume_failure CHECK (kind <> 'shuttle.render') NOT VALID");
    try { assert.equal(await f.resolve(help), 'unavailable'); }
    finally { await f.admin.query('ALTER TABLE sophie_core.outbox DROP CONSTRAINT synthetic_resume_failure'); }
    assert.deepEqual(await f.session(), paused); assert.equal((await f.current()).id, screen.id);
    assert.equal((await f.rows('shuttle_help_resolutions')).length, 0); assert.equal((await request(f)).status, 'open');
  });

  await scenario('W08 paused repeats keep earned Whitelist and their pinned rule across newer publications', async f => {
    f.discord.state.members.get(USER).push(WHITELIST); await f.open(); const help = await pause(f);
    f.discord.state.members.set(OTHER, [LEAD]);
    await f.store.publishOnboarding({ actor: await f.actor(OTHER), publication: { ...publication, version: 2, helpPauses: false } });
    assert.equal(await f.click('advance'), 'shuttle_paused'); assert.equal((await f.session()).definitionVersion, 1);
    assert.equal(await f.resolve(help), 'shuttle_help_resumed'); await f.drain(f.screens);
    for (let index = 0; index < 5; index++) { assert.equal(await f.click('advance'), 'shuttle_progress_recorded'); await f.drain(f.screens); }
    assert.equal(f.discord.state.members.get(USER).includes(WHITELIST), true);
    assert.equal(f.discord.state.calls.some(call => ['PUT', 'DELETE'].includes(call.method)), false);
    await f.open(); assert.equal((await f.session()).definitionVersion, 2);
    assert.equal(await f.click('help'), 'shuttle_help_recorded'); assert.equal((await f.session()).helpPaused, false);
  });

  await scenario('W09 withdrawal and closure permit retained resolution without resuming the obsolete run', async f => {
    await f.open(); const help = await pause(f);
    await closeTestCase({ store: f.store, actor: await f.actor(OTHER), observation: await f.discord.roles.observe(USER), interactionId: f.nextId(), id: (await f.rows('shuttle_cases'))[0].case_id, worker: f.cases });
    f.discord.state.members.set(OTHER, [LEAD]); await f.store.withdrawDefinition({ actor: await f.actor(OTHER), id: definition.id, version: 1 });
    assert.equal(await f.resolve(help), 'shuttle_help_resolved'); await f.drain(f.screens);
    assert.equal((await f.rows('shuttle_help_resolutions'))[0].resumed_version, null);
    assert.equal((await f.session()).helpPaused, true); assert.equal(await f.current(), undefined);
    assert.equal(await f.execute(f.payload()), 'shuttle_review');
  });

  await scenario('W10 lost Staff authority cannot clear a pause or create a resumption record', async f => {
    await f.open(); const help = await pause(f), before = await f.session();
    f.discord.state.members.set(OTHER, []); assert.equal(await f.resolve(help), 'denied');
    assert.deepEqual(await f.session(), before); assert.equal((await f.rows('shuttle_help_resolutions')).length, 0);
    assert.equal((await request(f)).status, 'open');
  });

  await scenario('W11 a lost role response after pause remains incomplete and is reconciled without another grant', async f => {
    await f.pending(); const control = f.control(await f.current(), 'help');
    f.discord.state.afterWrite = async call => {
      if (call.method === 'PUT' && call.path.endsWith(WHITELIST)) {
        f.discord.state.afterWrite = null; assert.equal(await f.execute(control), 'shuttle_help_paused');
        throw new Error('SYNTHETIC_LOST_PAUSED_GRANT_RESPONSE');
      }
    };
    assert.equal((await f.grants.runOnce('lost-paused-grant')).status, 'retry_scheduled');
    await f.admin.query("UPDATE sophie_core.outbox SET available_at = clock_timestamp() - interval '1 second' WHERE status = 'ready'");
    await f.drain(f.grants);
    assert.equal(f.discord.state.members.get(USER).includes(WHITELIST), false);
    assert.equal(f.discord.state.calls.filter(call => call.method === 'PUT' && call.path.endsWith(WHITELIST)).length, 1);
    assert.equal((await f.rows('sessions')).some(row => row.state.status === 'complete'), false);
  });

  await scenario('W12 signed loopback help and Staff resumption return private truthful statuses', async f => {
    await f.open(); const replies = [], faults = [];
    const responder = createInteractionResponder({ verifier: f.identities.verifier, applicationId: APPLICATION,
      clock: () => f.clock.now, enabled: () => f.clock.enabled, onboardingAssistance: f.assistance,
      fetch: async (_, value) => { replies.push(JSON.parse(value.body)); return Response.json({}); } });
    const server = createInteractionHttpServer({ verifier: f.identities.verifier, commands: f.commands, respond: responder.respond,
      enabled: () => f.clock.enabled, onFault: code => faults.push(code) }); const address = await server.listen();
    async function send(value) {
      const signed = f.identities.signed(value);
      const response = await fetch(`http://${address.host}:${address.port}/discord/interactions`, { method: 'POST', body: signed.body,
        headers: { 'Content-Type': 'application/json', 'X-Signature-Ed25519': signed.signature, 'X-Signature-Timestamp': signed.timestamp } });
      assert.deepEqual(await response.json(), f.verified(value).command === 'shuttle.control' ? { type: 6 } : { type: 5, data: { flags: 64 } }); await server.drain();
    }
    try {
      await send(f.control(await f.current(), 'help')); assert.equal(replies.length, 0);
      await send(f.payload({ member: { user: { id: OTHER } }, data: { type: 1, name: 'whitelist', options: [{ type: 1, name: 'queue' }] } }));
      assert.match(replies[0].components[0].components[0].label, /resume/);
      await send(f.resolution(await request(f))); assert.match(replies[1].content, /Staff resumption recorded/);
      assert.equal((await f.session()).helpPaused, false); assert.equal((await f.session()).stepIndex, 0);
      for (const reply of replies) assert.deepEqual(reply.allowed_mentions.parse, []); assert.deepEqual(faults, []);
    } finally { await server.close(); }
  });
}
