import { renderLegacyOnboardingScreen } from '../../modules/onboarding/legacy-screen.js';
import { publication } from '../../tests/fixtures/domain.js';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { onboardingWorkflow } from '../../tests/fixtures/onboarding-workflow.js';
import { parkedOnboardingMessage, recoveryQueue, issueRecheck, messageRecovery, recoveryPayload, makeDue } from '../../tests/fixtures/onboarding-recovery.js';
import { GUILD, USER, OTHER, STAFF } from '../../tests/fixtures/domain.js';
import { MUZZLED, WHITELIST } from '../../tests/fixtures/discord.js';

export async function runOnboardingArtifactRecoverySuite(cluster, run) {
  const scenario = (name, work) => run(name, async () => work(await onboardingWorkflow(cluster)));
  const posts = f => f.discord.state.calls.filter(call => call.method === 'POST').length;
  const audits = f => f.rows('shuttle_delivery_rechecks');
  const freshIssue = async (f, id) => (await f.rows('shuttle_delivery_issues')).find(row => row.id === id);
  const recorded = async (f, kind, id) => (await f.rows(kind === 'screen' ? 'shuttle_screens' : 'shuttle_alerts')).find(row => row.id === id);
  async function lostCase(f) {
    assert.equal(await f.execute(f.payload()), 'shuttle_recorded'); let missing;
    f.discord.state.afterWrite = call => { if (call.method === 'POST' && call.path.endsWith('/channels')) {
      f.discord.state.afterWrite = null; missing = [...f.discord.state.channels.values()].find(row => row.type === 0);
      f.discord.state.channels.delete(missing.id); throw new Error('SYNTHETIC_LATE_CHANNEL');
    } };
    assert.equal((await f.cases.runOnce('lost-case')).status, 'retry_scheduled'); await makeDue(f);
    assert.equal((await f.cases.runOnce('unknown-case')).code, 'CASE_CREATION_UNCERTAIN');
    return { issue: (await f.rows('shuttle_delivery_issues'))[0], channel: missing };
  }
  async function direct(f, issue, messageId, kind = 'screen') {
    const actor = await f.actor(OTHER), description = await f.store.describeOnboardingDeliveryIssue({ actor, guildId: GUILD, issueId: issue.id });
    return { actor, interactionId: f.nextId(), issueId: issue.id, expectedRevision: issue.revision, resultId: messageId,
      proof: await f.discord.channels.inspect(description.plan, description.channelId),
      message: await (kind === 'screen' ? f.discord.messages : f.discord.alerts).inspect({ plan: description.plan,
        channelId: description.channelId, messageId, ...(kind === 'screen' ? { screenId: description.recordId } : { alertId: description.recordId }) }),
      observation: await f.discord.roles.observe(USER) };
  }

  await scenario('F01 a late marked case is recovered by inspection without another channel create', async f => {
    const { issue, channel } = await lostCase(f), before = posts(f);
    assert.equal((await f.deliveryIssues.queue(recoveryQueue(f))).entries[0].kind, 'case');
    f.discord.state.channels.set(channel.id, channel);
    assert.equal(await issueRecheck(f, issue), 'shuttle_issue_recorded'); await f.drain(f.cases);
    assert.equal((await f.rows('case_reservations'))[0].channel_id, channel.id);
    assert.equal((await f.rows('case_reservations'))[0].state, 'open'); assert.equal(posts(f), before);
    assert.equal((await audits(f))[0].action, 'recheck'); assert.equal((await f.rows('case_exclusions'))[0].channel_id, channel.id);
  });

  await scenario('F02 an unidentified case stays parked and retains its quota and possible-create marker', async f => {
    const { issue } = await lostCase(f), before = posts(f);
    assert.equal(await issueRecheck(f, issue), 'shuttle_issue_recorded');
    assert.equal((await f.cases.runOnce('still-unknown')).code, 'CASE_CREATION_UNCERTAIN');
    assert.equal(posts(f), before); assert.equal((await f.rows('case_reservations'))[0].state, 'pending');
    assert.equal((await f.rows('case_provisions'))[0].create_started, true);
    assert.ok((await freshIssue(f, issue.id)).revision > issue.revision); assert.equal(await issueRecheck(f, issue), 'shuttle_issue_stale');
  });

  await scenario('F03 a late case after departure is retained and sealed instead of restoring requester access', async f => {
    const { issue, channel } = await lostCase(f); f.discord.state.members.delete(USER);
    f.discord.state.channels.set(channel.id, channel);
    assert.equal(await issueRecheck(f, issue), 'shuttle_issue_recorded'); await f.drain(f.cases);
    const description = await f.store.describeOnboardingDeliveryIssue({ actor: await f.actor(OTHER), guildId: GUILD, issueId: issue.id });
    const proof = await f.discord.channels.inspect(description.plan, channel.id);
    await f.discord.channels.verification.channel(proof, description.plan, true);
    assert.equal((await f.rows('case_reservations'))[0].state, 'failed');
    assert.equal((await f.rows('case_exclusions'))[0].channel_id, channel.id);
  });

  await scenario('F04 Staff can identify a lost screen response while only the worker activates its controls', async f => {
    const { issue, record, messageId } = await parkedOnboardingMessage(f), before = posts(f), progress = await f.session();
    const view = await f.deliveryIssues.queue(recoveryQueue(f)); assert.equal(view.entries[0].needsMessageId, true);
    assert.equal(view.entries[0].recheckable, false); assert.equal(await issueRecheck(f, issue), 'shuttle_issue_message_needed');
    assert.equal(await messageRecovery(f, issue, messageId), 'shuttle_recovery_recorded');
    const identified = await recorded(f, 'screen', record.id); assert.equal(identified.message_id, messageId); assert.equal(identified.ready, false);
    assert.equal(identified.create_started, true); assert.deepEqual(await f.session(), progress); assert.equal(posts(f), before);
    await f.drain(f.screens); assert.equal((await recorded(f, 'screen', record.id)).ready, true); assert.equal(posts(f), before);
    const [audit] = await audits(f); assert.equal(audit.action, 'adopt_message'); assert.equal(audit.result_id, messageId);
  });

  await scenario('F05 identifying a lost Staff alert permits read confirmation without a second mention', async f => {
    const { issue, record, messageId } = await parkedOnboardingMessage(f, 'alert'), before = posts(f);
    delete f.discord.state.messages.get(messageId).components;
    assert.equal(await issueRecheck(f, issue), 'shuttle_issue_message_needed');
    assert.equal(await messageRecovery(f, issue, messageId), 'shuttle_recovery_recorded');
    assert.equal((await recorded(f, 'alert', record.id)).state, 'pending'); await f.drain(f.alerts);
    assert.equal((await recorded(f, 'alert', record.id)).state, 'confirmed'); assert.equal(posts(f), before);
    assert.equal((await audits(f))[0].result_id, messageId);
  });

  await scenario('F06 wrong authors, markers, bodies, attachments and mention evidence cannot be adopted', async f => {
    const { issue, record, messageId } = await parkedOnboardingMessage(f, 'alert');
    const original = structuredClone(f.discord.state.messages.get(messageId));
    const changes = [message => { message.author = { id: USER, bot: false }; }, message => { message.webhook_id = OTHER; },
      message => { message.embeds[0].footer.text = 'foreign-marker'; }, message => { message.content += ' changed'; },
      message => { message.attachments = [{ id: OTHER }]; }, message => { message.mention_roles = []; },
      message => { message.channel_id = OTHER; }];
    for (const change of changes) {
      const message = structuredClone(original); change(message); f.discord.state.messages.set(messageId, message);
      assert.equal(await messageRecovery(f, issue, messageId), 'shuttle_recovery_rejected');
    }
    f.discord.state.messages.set(messageId, original);
    assert.equal((await recorded(f, 'alert', record.id)).message_id, null); assert.equal((await audits(f)).length, 0);
  });

  await scenario('F07 missing and foreign messages cannot replace an unknown result', async f => {
    const { issue, record, messageId } = await parkedOnboardingMessage(f);
    assert.equal(await messageRecovery(f, issue, OTHER), 'shuttle_recovery_rejected');
    const original = structuredClone(f.discord.state.messages.get(messageId));
    f.discord.state.messages.set(messageId, { ...original, embeds: [{ description: 'synthetic foreign body', footer: { text: 'sophie:shuttle:v1:' + '0'.repeat(32) } }] });
    assert.equal(await messageRecovery(f, issue, messageId), 'shuttle_recovery_rejected');
    assert.equal((await recorded(f, 'screen', record.id)).message_id, null); assert.equal((await audits(f)).length, 0);
  });

  await scenario('F08 duplicate and competing recovery actions preserve one message identity and one audit', async f => {
    const { issue, messageId } = await parkedOnboardingMessage(f), request = await direct(f, issue, messageId);
    const outcomes = await Promise.all([f.store.recoverOnboardingMessage(request), f.store.recoverOnboardingMessage(request)]);
    assert.deepEqual(outcomes.map(row => row.duplicate).sort(), [false, true]); assert.equal((await audits(f)).length, 1);
    assert.equal(await messageRecovery(f, issue, messageId), 'shuttle_issue_stale');
    await assert.rejects(f.store.recoverOnboardingMessage({ ...request, resultId: OTHER }), /INTERACTION_ID_COLLISION/);
  });

  await scenario('F09 unauthorized or newly revoked Staff cannot identify messages or persist recovery', async f => {
    const { issue, record, messageId } = await parkedOnboardingMessage(f), count = f.discord.state.calls.length;
    assert.equal(await messageRecovery(f, issue, messageId, { member: { user: { id: USER }, roles: [STAFF] } }), 'denied');
    assert.equal(f.discord.state.calls.slice(count).some(call => call.path.includes('/messages/')), false);
    f.discord.state.before = call => { if (call.path.endsWith(`/messages/${messageId}`)) f.discord.state.members.set(OTHER, []); return null; };
    assert.equal(await messageRecovery(f, issue, messageId), 'denied'); f.discord.state.before = null;
    assert.equal((await recorded(f, 'screen', record.id)).message_id, null); assert.equal((await audits(f)).length, 0);
  });

  await scenario('F10 forged or expired proofs and broader audiences cannot authorize message recovery', async f => {
    const { issue, record, messageId } = await parkedOnboardingMessage(f), request = await direct(f, issue, messageId);
    await assert.rejects(f.store.recoverOnboardingMessage({ ...request, proof: {} }), /CASE_OBSERVATION_UNTRUSTED/);
    await assert.rejects(f.store.recoverOnboardingMessage({ ...request, message: { messageId, missing: false } }), /SHUTTLE_MESSAGE_UNTRUSTED/);
    const channel = f.discord.state.channels.get(record.channel_id), overwrites = structuredClone(channel.permission_overwrites);
    channel.permission_overwrites = []; assert.equal(await messageRecovery(f, issue, messageId), 'shuttle_issue_review'); channel.permission_overwrites = overwrites;
    f.clock.now += 5_001; await assert.rejects(f.store.recoverOnboardingMessage({ ...request, actor: await f.actor(OTHER), observation: await f.discord.roles.observe(USER) }));
    assert.equal((await recorded(f, 'screen', record.id)).message_id, null); assert.equal((await audits(f)).length, 0);
  });

  await scenario('F11 an already resolved notice remains historical when its late message is identified', async f => {
    const { issue, record, messageId } = await parkedOnboardingMessage(f, 'alert'), before = posts(f);
    await f.resolve((await f.rows('shuttle_help_requests'))[0]);
    assert.equal(await messageRecovery(f, issue, messageId), 'shuttle_recovery_recorded'); await f.drain(f.alerts);
    const alert = await recorded(f, 'alert', record.id); assert.equal(alert.state, 'obsolete'); assert.equal(alert.message_id, messageId);
    assert.equal(posts(f), before); assert.equal((await f.rows('shuttle_help_requests'))[0].status, 'resolved');
  });

  await scenario('F12 recovery while Muzzled retains the ID but makes the old screen inert without granting roles', async f => {
    const { issue, record, messageId } = await parkedOnboardingMessage(f), before = posts(f);
    f.discord.state.members.get(USER).push(MUZZLED);
    assert.equal(await messageRecovery(f, issue, messageId), 'shuttle_recovery_recorded');
    assert.equal((await recorded(f, 'screen', record.id)).ready, false); await f.drain(f.screens);
    assert.ok(f.discord.state.messages.get(messageId).components.flatMap(row => row.components).every(button => button.disabled)); assert.equal(posts(f), before);
    assert.equal(f.discord.state.members.get(USER).includes(WHITELIST), false); assert.equal(f.discord.state.members.get(USER).includes(MUZZLED), true);
    assert.equal((await recorded(f, 'screen', record.id)).current, false);
  });

  await scenario('F13 adopting an older unknown screen cannot replace a newer current screen', async f => {
    const { issue, record, messageId } = await parkedOnboardingMessage(f);
    assert.equal(await f.execute(f.payload()), 'shuttle_recorded'); await f.drain(f.screens);
    const current = await f.current(), before = posts(f); assert.notEqual(current.id, record.id);
    assert.equal(await messageRecovery(f, issue, messageId), 'shuttle_recovery_recorded'); await f.drain(f.screens);
    assert.equal((await f.current()).id, current.id); assert.equal((await f.current()).ready, true);
    assert.ok(f.discord.state.messages.get(messageId).components.flatMap(row => row.components).every(button => button.disabled)); assert.equal(posts(f), before);
  });

  await scenario('F14 known changed alerts are inspected without reposting and can confirm after exact restoration', async f => {
    const { issue, record, messageId } = await parkedOnboardingMessage(f, 'alert');
    assert.equal(await messageRecovery(f, issue, messageId), 'shuttle_recovery_recorded');
    const original = structuredClone(f.discord.state.messages.get(messageId)), before = posts(f);
    f.discord.state.messages.get(messageId).content += ' changed';
    assert.equal((await f.alerts.runOnce('changed-alert')).code, 'SHUTTLE_ALERT_CHANGED');
    const current = await freshIssue(f, issue.id);
    assert.equal(await issueRecheck(f, current), 'shuttle_issue_recorded');
    assert.equal((await f.alerts.runOnce('still-changed')).code, 'SHUTTLE_ALERT_CHANGED'); assert.equal(posts(f), before);
    f.discord.state.messages.set(messageId, original);
    assert.equal(await issueRecheck(f, await freshIssue(f, issue.id)), 'shuttle_issue_recorded'); await f.drain(f.alerts);
    assert.equal((await recorded(f, 'alert', record.id)).state, 'confirmed'); assert.equal(posts(f), before);
  });

  await scenario('F15 failed recovery audit rolls back the message reference, receipt and requeue together', async f => {
    const { issue, record, messageId } = await parkedOnboardingMessage(f), receipts = (await f.rows('receipts')).length;
    await f.admin.query('ALTER TABLE sophie_core.shuttle_delivery_rechecks ADD CONSTRAINT synthetic_recovery_failure CHECK (false) NOT VALID');
    try { assert.equal(await messageRecovery(f, issue, messageId), 'unavailable'); }
    finally { await f.admin.query('ALTER TABLE sophie_core.shuttle_delivery_rechecks DROP CONSTRAINT synthetic_recovery_failure'); }
    assert.equal((await recorded(f, 'screen', record.id)).message_id, null); assert.equal((await audits(f)).length, 0);
    assert.equal((await freshIssue(f, issue.id)).revision, issue.revision); assert.equal((await f.rows('receipts')).length, receipts);
    assert.equal((await f.rows('outbox')).find(row => row.operation_id === issue.operation_id).status, 'parked');
  });

  await scenario('F16 message recovery cannot become case selection or a route into another case type', async f => {
    const { issue, channel } = await lostCase(f), count = f.discord.state.calls.length;
    assert.equal(await messageRecovery(f, issue, channel.id), 'shuttle_recovery_rejected');
    assert.equal(f.discord.state.calls.slice(count).some(call => call.path.includes('/messages/')), false);
    await f.admin.query("UPDATE sophie_core.case_reservations SET type = 'head-admin-contact'");
    assert.equal((await f.deliveryIssues.queue(recoveryQueue(f))).entries.length, 0);
    assert.equal(await issueRecheck(f, issue), 'shuttle_issue_stale'); assert.equal((await audits(f)).length, 0);
  });

  await scenario('F17 a definitely unattempted notice can be sent after its missing mention permission is repaired', async f => {
    await f.open(); await f.click('help'); await f.drain(f.screens);
    f.discord.state.roles.find(role => role.id === STAFF).mentionable = false;
    assert.equal((await f.alerts.runOnce('missing-mention')).code, 'STAFF_MENTION_UNAVAILABLE');
    const issue = (await f.rows('shuttle_delivery_issues'))[0], before = posts(f);
    assert.equal((await f.rows('shuttle_alerts'))[0].create_started, false);
    f.discord.state.roles.find(role => role.id === STAFF).mentionable = true;
    assert.equal(await issueRecheck(f, issue), 'shuttle_issue_recorded'); await f.drain(f.alerts);
    assert.equal((await f.rows('shuttle_alerts'))[0].state, 'confirmed'); assert.equal(posts(f), before + 1);
  });

  await scenario('F18 artifact migration backfills only bound parked deliveries and never clears possible creates', async f => {
    const { issue, record } = await parkedOnboardingMessage(f), client = await f.admin.connect();
    try {
      await client.query('BEGIN');
      await client.query('TRUNCATE sophie_core.case_participant_actions, sophie_core.case_participants, sophie_core.case_form_editor_actions, sophie_core.case_form_drafts, sophie_core.case_delivery_actions, sophie_core.case_delivery_issues, sophie_core.case_intake_messages, sophie_core.case_intakes, sophie_core.case_form_slots, sophie_core.case_form_actions, sophie_core.case_forms, sophie_core.shuttle_editor_actions, sophie_core.shuttle_draft_revisions, sophie_core.dashboard_sessions, sophie_core.dashboard_login_flows, sophie_core.dashboard_auth_limits, sophie_core.dashboard_auth_policies, sophie_core.case_inspection_sweeps, sophie_core.case_staff_actions, sophie_core.case_lifecycle_actions, sophie_core.shuttle_delivery_rechecks, sophie_core.shuttle_delivery_issues CASCADE');
      await client.query('ALTER TABLE sophie_core.shuttle_delivery_rechecks DROP COLUMN action, DROP COLUMN result_id');
      await client.query(await readFile(new URL('../../apps/core/storage/migrations/014-shuttle-artifact-recovery.sql', import.meta.url), 'utf8'));
      const rows = (await client.query('SELECT * FROM sophie_core.shuttle_delivery_issues')).rows;
      assert.equal(rows.length, 1); assert.equal(rows[0].operation_id, issue.operation_id); assert.equal(rows[0].session_id, record.session_id);
      const screen = (await client.query('SELECT create_started, message_id FROM sophie_core.shuttle_screens WHERE id = $1', [record.id])).rows[0];
      assert.deepEqual(screen, { create_started: true, message_id: null });
    } finally { await client.query('ROLLBACK'); client.release(); }
    assert.equal((await freshIssue(f, issue.id)).id, issue.id);
  });

  await scenario('F19 read-only recovery descriptors do not take session locks against an active worker', async f => {
    const { issue, record } = await parkedOnboardingMessage(f), actor = await f.actor(OTHER), client = await f.admin.connect();
    let pending, deadline;
    try {
      await client.query('BEGIN'); await client.query('SELECT id FROM sophie_core.sessions WHERE id = $1 FOR UPDATE', [record.session_id]);
      pending = f.store.describeOnboardingDeliveryIssue({ actor, guildId: GUILD, issueId: issue.id });
      const description = await Promise.race([pending, new Promise((_, reject) => { deadline = setTimeout(() => reject(new Error('Descriptor blocked on session row')), 1_000); })]);
      assert.equal(description.recordId, record.id);
    } finally { clearTimeout(deadline); await client.query('ROLLBACK'); client.release(); await pending?.catch(() => {}); }
  });
  await scenario('F20 uncertain pre-upgrade screens remain recoverable and are refreshed without another post', async f => {
    const { issue, record, messageId } = await parkedOnboardingMessage(f), before = posts(f);
    const old = renderLegacyOnboardingScreen({ screenId: record.id, session: record.snapshot, publication });
    Object.assign(f.discord.state.messages.get(messageId), old);
    assert.equal(await messageRecovery(f, issue, messageId), 'shuttle_recovery_recorded');
    await f.drain(f.screens); assert.equal(posts(f), before);
    assert.equal((await f.current()).message_id, messageId);
    assert.ok(f.discord.state.messages.get(messageId).embeds.every(embed => embed.footer === undefined));
  });
}
