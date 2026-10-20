import { readFile } from 'node:fs/promises';
import { closeTestCase } from '../../tests/fixtures/case-lifecycle.js';
import assert from 'node:assert/strict';
import { onboardingWorkflow } from '../../tests/fixtures/onboarding-workflow.js';
import { STAFF, USER, OTHER, GUILD } from '../../tests/fixtures/domain.js';
import { WHITELIST, MUZZLED } from '../../tests/fixtures/discord.js';

export async function runOnboardingAlertSuite(cluster, run) {
  const scenario = (name, work, options = {}) => run(name, async () => work(await onboardingWorkflow(cluster, options)));
  const records = f => f.rows('shuttle_alerts');
  const help = async f => { await f.open(); assert.equal(await f.help(), 'shuttle_help_recorded'); return (await records(f))[0]; };
  const posts = f => f.discord.state.calls.filter(call => call.method === 'POST' && call.path.includes('/messages')).length;
  const due = f => f.admin.query("UPDATE sophie_core.outbox SET available_at = clock_timestamp() - interval '1 second' WHERE status = 'ready'");

  await scenario('L01 help commits one alert and confirms only an observed Staff mention in the bound case', async f => {
    const alert = await help(f), before = posts(f); await f.drain(f.screens);
    assert.equal(await f.help(), 'shuttle_help_recorded'); assert.equal((await records(f)).length, 1);
    const screenPosts = posts(f), progress = await f.session(); await f.drain(f.alerts);
    assert.deepEqual(await f.session(), progress);
    assert.equal(f.discord.state.calls.some(call => ['PUT', 'DELETE'].includes(call.method) && call.path.includes('/roles/')), false);
    assert.equal(posts(f), screenPosts + 1); const delivered = (await records(f))[0];
    assert.equal(delivered.state, 'confirmed'); assert.ok(delivered.confirmed_at);
    const message = f.discord.state.messages.get(delivered.message_id);
    assert.equal(message.channel_id, (await f.current()).channel_id); assert.deepEqual(message.mention_roles, [STAFF]);
    assert.equal(message.content, `<@&${STAFF}>`); assert.equal(message.mention_everyone, false);
    assert.equal(message.embeds[0].footer.text, `sophie:shuttle-alert:v1:${alert.id}`); assert.equal(posts(f) > before, true);
    await f.drain(f.alerts); assert.equal(posts(f), screenPosts + 1);
    await f.resolve((await f.rows('shuttle_help_requests'))[0]); await f.drain(f.screens);
    assert.equal(await f.help(), 'shuttle_help_recorded'); await f.drain(f.alerts);
    assert.equal((await records(f)).length, 2); assert.equal((await records(f)).every(row => row.state === 'confirmed'), true);
  });

  await scenario('L02 a retired Ask Staff control records no alert, request, pause, receipt or screen change', async f => {
    const screen = await f.open(), before = await f.session(), receipts = (await f.rows('receipts')).length;
    const jobs = (await f.rows('outbox')).length;
    assert.equal(await f.execute(f.control(screen, 'help')), 'shuttle_stale');
    assert.deepEqual(await f.session(), before); assert.equal((await records(f)).length, 0);
    assert.equal((await f.rows('shuttle_help_requests')).length, 0); assert.equal((await f.rows('receipts')).length, receipts);
    assert.equal((await f.rows('outbox')).length, jobs);
  }, { helpPauses: true });

  await scenario('L03 resolving before delivery suppresses the obsolete help ping without deleting its record', async f => {
    await help(f); const before = posts(f); await f.resolve((await f.rows('shuttle_help_requests'))[0]);
    await f.drain(f.alerts); assert.equal(posts(f), before);
    assert.equal((await records(f))[0].state, 'obsolete'); assert.equal((await records(f))[0].message_id, null);
  });

  await scenario('L04 a blocked Whitelist grant pings no one and completes on its own once the role order is fixed', async f => {
    await f.pending(); f.discord.state.roles.find(role => role.id === WHITELIST).position = 20;
    assert.equal((await f.grants.runOnce('blocked-grant')).code, 'ROLE_HIERARCHY_BLOCKED');
    assert.equal((await f.session()).status, 'role_pending'); assert.equal(f.discord.state.members.get(USER).includes(WHITELIST), false);
    assert.equal((await records(f)).length, 0); assert.equal((await f.alerts.runOnce('no-alert')).status, 'idle');
    // Still blocked: the automatic recheck parks it again and waits longer before the next one.
    await f.admin.query("UPDATE sophie_core.outbox SET parked_at = clock_timestamp() - interval '3 minutes' WHERE status = 'parked'");
    assert.equal(await f.outbox.recheckParkedShuttleWork(), 1);
    for (let index = 0; index < 3; index++) await f.grants.runOnce('still-blocked');
    const grant = (await f.rows('outbox')).find(row => row.kind === 'whitelist.grant');
    assert.deepEqual([grant.status, grant.last_error_code, grant.auto_rechecks], ['parked', 'ROLE_HIERARCHY_BLOCKED', 1]);
    await f.admin.query("UPDATE sophie_core.outbox SET parked_at = clock_timestamp() - interval '3 minutes' WHERE status = 'parked'");
    assert.equal(await f.outbox.recheckParkedShuttleWork(), 0);
    // Once the bot's role order is fixed, the next automatic recheck completes it. No Staff action was taken.
    f.discord.state.roles.find(role => role.id === WHITELIST).position = 1;
    await f.admin.query("UPDATE sophie_core.outbox SET parked_at = clock_timestamp() - interval '5 minutes' WHERE status = 'parked'");
    assert.equal(await f.outbox.recheckParkedShuttleWork(), 1); await f.drain(f.grants); await f.drain(f.screens);
    assert.equal((await f.rows('sessions'))[0].state.status, 'complete'); assert.equal(f.discord.state.members.get(USER).includes(WHITELIST), true);
    assert.equal((await records(f)).length, 0); assert.equal((await f.rows('shuttle_delivery_rechecks')).length, 0);
  });

  await scenario('L05 a lost role response records uncertainty, pings no one and claims no completion', async f => {
    await f.pending();
    f.discord.state.afterWrite = call => { if (call.method === 'PUT') { f.discord.state.afterWrite = null; throw new Error('SYNTHETIC_LOST_ROLE_RESPONSE'); } };
    assert.equal((await f.grants.runOnce('uncertain-role')).status, 'retry_scheduled');
    assert.equal((await f.session()).status, 'role_pending'); assert.equal((await records(f)).length, 0);
    assert.ok((await f.rows('outbox')).some(row => row.kind === 'whitelist.reconcile'));
    assert.equal((await f.rows('outbox')).some(row => row.kind === 'shuttle.alert'), false);
  });

  await scenario('L06 a recovered role failure completes without any Staff notice', async f => {
    await f.pending();
    f.discord.state.before = call => call.method === 'PUT' ? new Response(null, { status: 503 }) : null;
    assert.equal((await f.grants.runOnce('temporary-failure')).status, 'retry_scheduled');
    f.discord.state.before = null; await due(f); await f.drain(f.grants);
    assert.equal((await f.rows('sessions'))[0].state.status, 'complete');
    const before = posts(f); await f.drain(f.alerts); assert.equal(posts(f), before); assert.equal((await records(f)).length, 0);
  });

  await scenario('L07 a lost alert create response parks without issuing another POST or recursive alert', async f => {
    await help(f); const before = posts(f);
    f.discord.state.afterWrite = call => { if (call.method === 'POST' && call.path.includes('/messages')) {
      f.discord.state.afterWrite = null; throw new Error('SYNTHETIC_LOST_ALERT_RESPONSE');
    } };
    assert.equal((await f.alerts.runOnce('lost-alert')).status, 'retry_scheduled');
    assert.equal((await records(f))[0].message_id, null); assert.equal((await records(f))[0].create_started, true);
    await due(f); assert.equal((await f.alerts.runOnce('lost-alert-retry')).code, 'SHUTTLE_ALERT_UNCERTAIN');
    assert.equal(posts(f), before + 1); assert.equal((await records(f)).length, 1); assert.equal((await records(f))[0].state, 'pending');
  });

  await scenario('L08 a known alert survives failed confirmation and retries only its own message read', async f => {
    await help(f); const before = posts(f);
    f.discord.state.afterWrite = call => { if (call.method === 'POST' && call.path.includes('/messages')) {
      f.discord.state.afterWrite = null; f.discord.state.before = read => read.method === 'GET' && read.path.includes('/messages/') ? new Response(null, { status: 503 }) : null;
    } };
    assert.equal((await f.alerts.runOnce('lost-confirmation')).status, 'retry_scheduled'); assert.ok((await records(f))[0].message_id);
    f.discord.state.before = null; await due(f); await f.drain(f.alerts);
    assert.equal((await records(f))[0].state, 'confirmed'); assert.equal(posts(f), before + 1);
  });

  await scenario('L09 a definite 429 retains the cooldown and permits one later alert attempt', async f => {
    await help(f); const before = posts(f);
    f.discord.state.before = call => call.method === 'POST' && call.path.includes('/messages') ? Response.json({ retry_after: 2 }, { status: 429 }) : null;
    assert.equal((await f.alerts.runOnce('limited-alert')).code, 'RATE_LIMITED');
    assert.equal((await records(f))[0].create_started, false); assert.equal((await f.alerts.runOnce('cooldown')).status, 'idle');
    f.discord.state.before = null; f.clock.now += 2_001; await due(f);
    await f.admin.query("UPDATE sophie_core.discord_backoff SET until_at = '-infinity'");
    await f.drain(f.alerts); assert.equal((await records(f))[0].state, 'confirmed'); assert.equal(posts(f), before + 2);
    assert.equal([...f.discord.state.messages.values()].filter(row => row.embeds[0]?.footer?.text?.startsWith('sophie:shuttle-alert:')).length, 1);
  });

  await scenario('L10 lost leases retain late own-message IDs but cannot confirm through the old worker', async f => {
    await help(f); const before = posts(f); let replacement;
    f.discord.state.afterWrite = async call => { if (call.method === 'POST' && call.path.includes('/messages')) {
      f.discord.state.afterWrite = null;
      await f.admin.query("UPDATE sophie_core.outbox SET lease_until = clock_timestamp() - interval '1 second' WHERE kind = 'shuttle.alert' AND status = 'leased'");
      replacement = await f.outbox.claim('replacement', 30_000, ['shuttle.alert']); assert.ok(replacement);
    } };
    assert.equal((await f.alerts.runOnce('expired-alert')).status, 'lease_lost');
    assert.ok((await records(f))[0].message_id); assert.equal((await records(f))[0].state, 'pending');
    await f.admin.query("UPDATE sophie_core.outbox SET lease_until = clock_timestamp() - interval '1 second' WHERE kind = 'shuttle.alert' AND status = 'leased'");
    await f.drain(f.alerts); assert.equal((await records(f))[0].state, 'confirmed'); assert.equal(posts(f), before + 1);
    await assert.rejects(f.outbox.renew(replacement.claim), /OUTBOX_LEASE_LOST/);
  });

  await scenario('L11 absent mentions or changed messages cannot be called confirmed or trigger another ping', async f => {
    await help(f); const before = posts(f);
    f.discord.state.afterWrite = call => { if (call.method === 'POST' && call.path.includes('/messages')) {
      f.discord.state.afterWrite = null; [...f.discord.state.messages.values()].at(-1).mention_roles = [];
    } };
    assert.equal((await f.alerts.runOnce('missing-mention')).code, 'SHUTTLE_ALERT_CHANGED');
    assert.equal((await records(f))[0].state, 'pending'); assert.equal((await records(f))[0].confirmed_at, null);
    assert.equal((await f.alerts.runOnce('no-reping')).status, 'idle'); assert.equal(posts(f), before + 1);
  });

  await scenario('L12 closed cases and departed membership suppress queued help alerts', async f => {
    await help(f); const before = posts(f);
    await closeTestCase({ store: f.store, actor: await f.actor(OTHER), observation: await f.discord.roles.observe(USER), interactionId: f.nextId(), id: (await f.rows('shuttle_cases'))[0].case_id, worker: f.cases });
    await f.drain(f.alerts); assert.equal((await records(f))[0].state, 'obsolete'); assert.equal(posts(f), before);
    const departed = await onboardingWorkflow(cluster); await help(departed); const departedPosts = posts(departed);
    departed.discord.state.members.delete(USER); await departed.drain(departed.alerts);
    assert.equal((await records(departed))[0].state, 'obsolete'); assert.equal(posts(departed), departedPosts);
  });

  await scenario('L13 unavailable Staff mentions park without broadening permissions', async f => {
    await help(f); const before = posts(f), callsBefore = f.discord.state.calls.length;
    f.discord.state.roles.find(role => role.id === STAFF).mentionable = false;
    assert.equal((await f.alerts.runOnce('unmentionable')).code, 'STAFF_MENTION_UNAVAILABLE');
    assert.equal(posts(f), before); assert.equal((await records(f)).length, 1);
    assert.equal(f.discord.state.calls.slice(callsBefore).some(call => call.method === 'PATCH'), false);
  });

  await scenario('L14 delivery stops and invalid case audiences cannot authorize an alert', async f => {
    await help(f); const before = posts(f); f.clock.enabled = false;
    assert.equal((await f.alerts.runOnce('disabled-alert')).status, 'disabled'); f.clock.enabled = true;
    f.discord.state.channels.get((await f.rows('case_reservations'))[0].channel_id).permission_overwrites = [];
    assert.equal((await f.alerts.runOnce('changed-audience')).code, 'CASE_CHANNEL_ACL_MISMATCH'); assert.equal(posts(f), before);
    assert.equal((await records(f))[0].create_started, false);
  });

  await scenario('L15 attempt exhaustion pings no one; the automatic recheck gives the grant fresh attempts', async f => {
    await f.pending(); await f.admin.query("UPDATE sophie_core.outbox SET attempts = 10 WHERE kind = 'whitelist.grant'");
    assert.equal((await f.grants.runOnce('exhausted-role')).code, 'ATTEMPT_LIMIT');
    assert.equal((await records(f)).length, 0); assert.equal((await f.session()).status, 'role_pending');
    await f.admin.query("UPDATE sophie_core.outbox SET parked_at = clock_timestamp() - interval '3 minutes' WHERE status = 'parked'");
    assert.equal(await f.outbox.recheckParkedShuttleWork(), 1);
    const job = (await f.rows('outbox')).find(row => row.kind === 'whitelist.grant');
    assert.deepEqual([job.status, job.attempts, job.auto_rechecks], ['ready', 0, 1]);
    await f.drain(f.grants); assert.equal((await f.rows('sessions'))[0].state.status, 'complete');
  });

  await scenario('L16 parked Shuttle work waits before its automatic recheck; a global rate-limit halt stays with the operator', async f => {
    await f.pending(); f.discord.state.roles.find(role => role.id === WHITELIST).position = 20;
    assert.equal((await f.grants.runOnce('blocked')).code, 'ROLE_HIERARCHY_BLOCKED');
    assert.equal(await f.outbox.recheckParkedShuttleWork(), 0);
    await f.admin.query("UPDATE sophie_core.outbox SET parked_at = clock_timestamp() - interval '1 minute' WHERE status = 'parked'");
    assert.equal(await f.outbox.recheckParkedShuttleWork(), 0);
    await f.admin.query("UPDATE sophie_core.outbox SET parked_at = clock_timestamp() - interval '3 minutes', last_error_code = 'DISCORD_RATE_LIMIT_INVALID' WHERE status = 'parked'");
    assert.equal(await f.outbox.recheckParkedShuttleWork(), 0);
    await f.admin.query("UPDATE sophie_core.outbox SET last_error_code = 'ROLE_HIERARCHY_BLOCKED' WHERE status = 'parked'");
    assert.equal(await f.outbox.recheckParkedShuttleWork(), 1);
    assert.ok((await f.rows('outbox')).find(row => row.kind === 'whitelist.grant').fence > 1);
  });

  await scenario('L17 resolution during a POST retains its late receipt without claiming current delivery', async f => {
    await help(f); const request = (await f.rows('shuttle_help_requests'))[0], before = posts(f);
    f.discord.state.afterWrite = async call => { if (call.method === 'POST' && call.path.includes('/messages')) {
      f.discord.state.afterWrite = null;
      assert.equal(await f.resolve(request), 'shuttle_help_resolved');
    } };
    const result = await f.alerts.runOnce('resolved-in-flight');
    assert.equal(result.status, 'settled'); assert.equal((await f.rows('shuttle_help_requests'))[0].status, 'resolved');
    assert.ok((await records(f))[0].message_id); assert.equal((await records(f))[0].state, 'obsolete'); assert.equal(posts(f), before + 1);
  });

  await scenario('L18 alert metadata remains core-only and foreign case types cannot be notified', async f => {
    await help(f); const before = posts(f);
    await assert.rejects(cluster.knowledgePool.query('SELECT * FROM sophie_core.shuttle_alerts'), { code: '42501' });
    await assert.rejects(f.pool.query('DELETE FROM sophie_core.shuttle_alerts'), { code: '42501' });
    await f.admin.query("UPDATE sophie_core.case_reservations SET type = 'head-admin-contact'");
    assert.equal((await f.alerts.runOnce('wrong-case')).code, 'SHUTTLE_CASE_UNAVAILABLE'); assert.equal(posts(f), before);
  });

  await scenario('L19 competing alert workers send only one message for the retained request', async f => {
    await help(f); const before = posts(f);
    const outcomes = await Promise.all([f.alerts.runOnce('alert-a'), f.alerts.runOnce('alert-b')]);
    assert.deepEqual(outcomes.map(value => value.status).sort(), ['idle', 'settled']);
    assert.equal(posts(f), before + 1); assert.equal((await records(f))[0].state, 'confirmed');
  });

  await scenario('L20 Staff can be alerted for a Muzzled member without clearing the pause or granting access', async f => {
    await f.open(); assert.equal(await f.help(), 'shuttle_help_paused'); const paused = await f.session();
    f.discord.state.members.get(USER).push(MUZZLED); await f.drain(f.alerts);
    assert.equal((await records(f))[0].state, 'confirmed'); assert.deepEqual(await f.session(), paused);
    assert.equal(await f.execute(f.payload()), 'denied');
    assert.equal(await f.resolve((await f.rows('shuttle_help_requests'))[0]), 'shuttle_help_waiting');
    assert.equal((await f.session()).helpPaused, true); assert.equal(f.discord.state.members.get(USER).includes(WHITELIST), false);
    assert.equal(f.discord.state.calls.some(call => ['PUT', 'DELETE'].includes(call.method) && call.path.includes('/roles/')), false);
  }, { helpPauses: true });

  await scenario('L21 migration 072 releases pauses, closes help requests and withdraws unsent notices without Staff', async f => {
    await f.open(); assert.equal(await f.help(), 'shuttle_help_paused'); await f.drain(f.screens);
    assert.ok((await f.group()).nav.components[0].components.every(button => button.disabled));
    const sql = await readFile(new URL('../../apps/core/storage/migrations/072-shuttle-autonomy.sql', import.meta.url), 'utf8');
    await f.admin.query(sql.slice(sql.indexOf('-- Release:')));
    assert.equal((await f.session()).helpPaused, false); assert.equal((await f.rows('shuttle_help_requests'))[0].status, 'resolved');
    assert.equal((await records(f))[0].state, 'obsolete'); assert.equal((await f.rows('shuttle_help_resolutions')).length, 0);
    await f.drain(f.screens); const before = posts(f); await f.drain(f.alerts); assert.equal(posts(f), before);
    const shown = await f.group();
    assert.deepEqual(shown.nav.components[0].components.map(button => button.disabled), [true, false]);
    assert.doesNotMatch(shown.nav.embeds[0].description, /Staff/); assert.doesNotMatch(shown.status.embeds[0].description, /Staff/);
    assert.equal(await f.click('advance'), 'shuttle_progress_recorded');
  }, { helpPauses: true });

}
