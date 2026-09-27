import assert from 'node:assert/strict';
import { intakeDeliveryWorkflow } from '../../tests/fixtures/case-intake-delivery.js';
import { casePolicy } from '../../tests/fixtures/cases.js';
import { BOT, CREW } from '../../tests/fixtures/discord.js';
import { USER, OTHER } from '../../tests/fixtures/domain.js';
import { createCaseDirectNotices } from '../../apps/core/discord/case-direct-notices.js';
import { createCaseDirectNoticeStore } from '../../apps/core/storage/case-direct-notices.js';
import { createCaseDirectNoticeDispatcher } from '../../apps/core/discord/case-direct-notice-dispatcher.js';
import { createOutbox } from '../../apps/core/storage/outbox.js';
import { ticketDirectNotice } from '../../modules/tickets/direct-notice.js';

export async function runCaseDirectNoticeSuite(cluster, run) {
  const services = f => {
    const clock = () => f.clock.now, roles = f.intakeRoles, channels = f.intakeChannels;
    const messages = createCaseDirectNotices({ transport: f.intakeTransport, roles, channels, botUserId: BOT, clock });
    const store = createCaseDirectNoticeStore({ pool: f.pool, clock, policy: casePolicy, channels: channels.verification, messages: messages.verification });
    const worker = createCaseDirectNoticeDispatcher({ outbox: createOutbox({ pool: f.pool }), store, roles, channels, messages, enabled: () => f.clock.enabled });
    return { worker, store };
  };
  const scenario = (name, work) => run(name, async () => { const f = await intakeDeliveryWorkflow(cluster); await work(f, services(f)); });
  const records = f => f.rows('case_direct_notices');
  const posts = f => f.discord.state.calls.filter(call => call.method === 'POST' && /\/messages$/.test(call.path));
  const due = async f => { await f.admin.query("UPDATE sophie_core.outbox SET available_at = '-infinity' WHERE kind = 'case.dm' AND status = 'ready'");
    await f.admin.query("UPDATE sophie_core.discord_backoff SET until_at = '-infinity'"); };

  await scenario('DM01 verified ordinary channel queues one durable DM with only a fixed link, and fresh workers do not repeat it', async (f, { worker }) => {
    const row = await f.openTicket('quick-help'); assert.equal((await records(f)).length, 1);
    assert.deepEqual(await worker.runOnce('dm-test'), { status: 'settled', sent: true });
    const notice = (await records(f))[0], message = f.discord.state.messages.get(notice.message_id);
    assert.equal(notice.state, 'sent'); assert.equal(message.content, ticketDirectNotice(row.guild_id, row.channel_id).content);
    assert.deepEqual(message.mentions, []); assert.deepEqual(message.mention_roles, []); assert.equal(message.mention_everyone, false);
    assert.equal(posts(f).length, 1); assert.equal((await services(f).worker.runOnce('restarted')).status, 'idle');
    await f.drain(f.cases); assert.equal((await records(f)).length, 1); assert.equal(posts(f).length, 1);
  });
  await scenario('DM02 Discord blocking DMs is terminal and leaves the existing ticket open', async (f, { worker }) => {
    const row = await f.openTicket('quick-help');
    f.discord.state.before = call => call.path.endsWith('/users/@me/channels') ? Response.json({ code: 50007 }, { status: 403 }) : null;
    assert.deepEqual(await worker.runOnce('blocked'), { status: 'settled', blocked: true });
    assert.equal((await records(f))[0].state, 'blocked'); assert.equal((await f.rows('case_reservations'))[0].state, 'open');
    assert.equal((await services(f).worker.runOnce('blocked-again')).status, 'idle'); assert.equal(posts(f).length, 0); assert.ok(row.channel_id);
  });
  await scenario('DM03 a lost send response survives reconstruction without a blind repeat', async (f, { worker }) => {
    await f.openTicket('quick-help'); f.discord.state.afterWrite = call => { if (/\/messages$/.test(call.path)) throw new Error('Synthetic lost response'); };
    assert.equal((await worker.runOnce('lost')).status, 'retry_scheduled'); await due(f);
    assert.equal((await services(f).worker.runOnce('restart')).code, 'CASE_DM_UNCERTAIN');
    assert.equal((await records(f))[0].create_started, true); assert.equal(posts(f).length, 1);
  });
  await scenario('DM04 an authentic late send receipt is retained after lease expiry and a new worker sends nothing', async (f, { worker }) => {
    await f.openTicket('quick-help'); f.discord.state.afterWrite = async call => { if (/\/messages$/.test(call.path)) {
      await f.admin.query("UPDATE sophie_core.outbox SET lease_until = '-infinity' WHERE kind = 'case.dm' AND status = 'leased'");
    } };
    assert.equal((await worker.runOnce('late')).status, 'lease_lost'); assert.equal((await records(f))[0].state, 'sent');
    assert.equal((await services(f).worker.runOnce('replacement')).status, 'settled'); assert.equal(posts(f).length, 1);
  });
  await scenario('DM05 a departure while opening the DM cancels delivery and rejoining does not revive it', async (f, { worker }) => {
    await f.openTicket('quick-help'); f.discord.state.afterWrite = call => { if (call.path.endsWith('/users/@me/channels')) f.discord.state.members.delete(USER); };
    assert.equal((await worker.runOnce('departure')).status, 'settled'); assert.equal((await records(f))[0].state, 'obsolete');
    f.discord.state.members.set(USER, [CREW]); assert.equal((await worker.runOnce('return')).status, 'idle'); assert.equal(posts(f).length, 0);
  });
  await scenario('DM06 channel closure or audience drift prevents a private link from being sent', async (f, { worker }) => {
    const row = await f.openTicket('quick-help'); f.discord.state.channels.get(row.channel_id).permission_overwrites = [];
    assert.equal((await worker.runOnce('drift')).code, 'CASE_CHANNEL_ACL_MISMATCH'); assert.equal(posts(f).length, 0);
    assert.equal((await records(f))[0].create_started, false);
  });
  await scenario('DM07 wrong-recipient and group-DM responses never authorize a send', async (f, { worker }) => {
    await f.openTicket('quick-help'); f.discord.state.before = call => call.path.endsWith('/users/@me/channels') ?
      Response.json({ id: '999', type: 1, recipients: [{ id: OTHER }] }) : null;
    assert.equal((await worker.runOnce('foreign-recipient')).code, 'CASE_DM_UNTRUSTED'); assert.equal(posts(f).length, 0);
  });
  await scenario('DM08 definite rate-limit refusal preserves the barrier and permits a later safe send', async (f, { worker }) => {
    await f.openTicket('quick-help'); f.discord.state.before = call => { if (/\/messages$/.test(call.path)) {
      f.discord.state.before = null; return Response.json({ retry_after: 2 }, { status: 429, headers: { 'retry-after': '2' } });
    } };
    assert.equal((await worker.runOnce('limited')).code, 'RATE_LIMITED'); assert.equal((await records(f))[0].create_started, false);
    assert.equal((await worker.runOnce('too-soon')).status, 'idle'); f.clock.now += 2001; await due(f);
    assert.equal((await worker.runOnce('later')).sent, true); assert.equal(f.discord.state.messages.size, 1);
  });
  await scenario('DM09 blocked message sends retain a safe fallback without closing the channel', async (f, { worker }) => {
    await f.openTicket('quick-help'); f.discord.state.before = call => /\/messages$/.test(call.path) ? Response.json({ code: 50278 }, { status: 403 }) : null;
    assert.equal((await worker.runOnce('blocked-send')).blocked, true); assert.equal((await records(f))[0].state, 'blocked');
    assert.equal((await f.rows('case_reservations'))[0].state, 'open'); assert.equal((await worker.runOnce('repeat')).status, 'idle');
  });
  await scenario('DM10 a closed ticket does not send its queued notice', async (f, { worker }) => {
    const row = await f.openTicket('quick-help');
    await f.admin.query("UPDATE sophie_core.case_reservations SET state = 'closed', desired_access = 'closed' WHERE id = $1", [row.id]);
    assert.equal((await worker.runOnce('closed')).status, 'settled'); assert.equal((await records(f))[0].state, 'obsolete'); assert.equal(posts(f).length, 0);
  });
}
