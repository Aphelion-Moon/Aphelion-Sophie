import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { onboardingWorkflow } from '../../tests/fixtures/onboarding-workflow.js';
import { caseStaffPayload, caseStaffControl } from '../../tests/fixtures/case-staff.js';
import { ticketPayload } from '../../tests/fixtures/case-lifecycle.js';
import { GUILD, USER, OTHER, STAFF, LEAD } from '../../tests/fixtures/domain.js';
import { MUZZLED, BYOND_ROLE } from '../../tests/fixtures/discord.js';
import { APPLICATION } from '../../tests/fixtures/interactions.js';
import { casePolicy } from '../../tests/fixtures/cases.js';
import { createInteractionResponder } from '../../apps/core/discord/interaction-response.js';
import { createInteractionHttpServer } from '../../apps/core/discord/interaction-http.js';

const THIRD = '100000000000000030';

/** No real case content: only synthetic records, identities and Discord metadata. */
export async function runCaseStaffSuite(cluster, run) {
  const scenario = (name, work) => run(name, async () => work(await onboardingWorkflow(cluster)));
  const state = async (f, id = null) => (await f.rows('case_reservations')).find(row => id === null || row.id === id);
  const audits = f => f.rows('case_staff_actions');
  const writes = f => f.discord.state.calls.filter(call => call.method !== 'GET').length;
  const act = async (f, action, row, options) => f.execute(caseStaffPayload(f, action, row ?? await state(f), options));
  const queue = (f, options = {}) => f.caseStaff.queue(f.verified(caseStaffPayload(f, 'queue', null, options)));
  async function reserve(f, type = 'admin-help', id = `case-${f.nextId()}`) {
    f.clock.now += 1_000;
    await f.store.reserveCase({ actor: await f.actor(USER), interactionId: f.nextId(), id, type,
      observation: await f.discord.roles.observe(USER), limits: { memberOpen: 20, guildPending: 100, cooldownMs: 1_000 } });
    return id;
  }

  await scenario('K01 queue visibility follows current case-type permissions without trusting Administrator or incoming roles', async f => {
    const ordinary = await reserve(f), head = await reserve(f, 'head-admin-contact');
    assert.deepEqual((await queue(f)).entries.map(row => row.id), [ordinary]);
    assert.deepEqual(await queue(f, { userId: USER }), { state: 'denied' });
    f.discord.state.members.set(OTHER, [LEAD]); assert.deepEqual((await queue(f)).entries.map(row => row.id), [ordinary, head]);
    f.discord.state.members.set(OTHER, [STAFF, MUZZLED]); assert.deepEqual(await queue(f), { state: 'denied' });
    f.discord.state.members.set(OTHER, [BYOND_ROLE]); f.discord.state.roles.find(row => row.id === BYOND_ROLE).permissions = '8';
    assert.deepEqual(await queue(f), { state: 'denied' });
    const forged = caseStaffPayload(f, 'queue'); forged.member.roles = [LEAD]; forged.member.permissions = '8';
    assert.equal(await f.execute(forged), 'denied'); assert.equal(writes(f), 0);
  });

  await scenario('K02 claiming records the actor, reason and shared version without changing audience, outbox or Shuttle state', async f => {
    await f.open(); const row = await state(f), oldSession = await f.session(), jobs = await f.rows('outbox'), count = writes(f);
    assert.equal(await act(f, 'claim', row), 'case_staff_recorded'); const updated = await state(f), audit = (await audits(f))[0];
    assert.equal(updated.version, row.version + 1); assert.equal(updated.assignee_grant.userId, OTHER);
    assert.equal(audit.operator_grant.userId, OTHER); assert.equal(audit.assignee_grant.userId, OTHER); assert.equal(audit.previous_assignee_grant, null);
    assert.equal(audit.reason, 'self-claim'); assert.equal(audit.version, updated.version);
    assert.deepEqual(await f.session(), oldSession); assert.deepEqual(await f.rows('outbox'), jobs); assert.equal(writes(f), count);
    const page = await queue(f); assert.equal(page.entries[0].assigneeId, OTHER); assert.equal(page.entries[0].assignmentStatus, 'current');
  });

  await scenario('K03 duplicate claims commit once and competing responders cannot overwrite the same case version', async f => {
    await f.open(); const row = await state(f), payload = caseStaffPayload(f, 'claim', row);
    assert.deepEqual(await Promise.all([f.execute(payload), f.execute(payload)]), ['case_staff_recorded', 'case_staff_recorded']);
    assert.equal((await audits(f)).length, 1); assert.equal(await act(f, 'unclaim'), 'case_staff_recorded');
    f.discord.state.members.set(THIRD, [STAFF]); const current = await state(f);
    const results = await Promise.all([act(f, 'claim', current), act(f, 'claim', current, { userId: THIRD })]);
    assert.deepEqual(results.sort(), ['case_staff_recorded', 'case_stale']); assert.equal((await audits(f)).length, 3);
    const collision = structuredClone(payload); collision.data.options[0].name = 'unclaim';
    assert.equal(await f.execute(collision), 'unavailable'); assert.equal((await audits(f)).length, 3);
  });

  await scenario('K04 assignment requires a current responder and only the assignee can unclaim their own work', async f => {
    await f.open(); assert.equal(await act(f, 'claim'), 'case_staff_recorded'); f.discord.state.members.set(THIRD, [STAFF]);
    assert.equal(await act(f, 'assign', null, { assigneeId: USER }), 'case_assignee_denied');
    assert.equal(await act(f, 'assign', null, { assigneeId: THIRD }), 'case_staff_recorded');
    assert.equal(await act(f, 'unclaim'), 'case_stale'); assert.equal(await act(f, 'unclaim', null, { userId: THIRD }), 'case_staff_recorded');
    const records = (await audits(f)).sort((a, b) => a.version - b.version);
    assert.equal(records[1].previous_assignee_grant.userId, OTHER); assert.equal(records[1].assignee_grant.userId, THIRD);
    assert.equal(records[1].reason, 'handoff'); assert.equal(records[2].reason, 'self-release'); assert.equal(records[2].assignee_grant, null);
    assert.equal((await state(f)).assignee_grant, null);
  });

  await scenario('K05 Head Admin assignment cannot make an ordinary Staff member or requester a responder', async f => {
    const id = await reserve(f, 'head-admin-contact'); await f.drain(f.cases); f.discord.state.members.set(THIRD, [STAFF]);
    const row = await state(f, id); assert.equal(await act(f, 'claim', row), 'denied');
    assert.equal(await act(f, 'claim', row, { userId: USER }), 'denied');
    assert.equal(await act(f, 'claim', { ...row, id: 'unknown-case' }), 'denied');
    f.discord.state.members.set(OTHER, [LEAD]); assert.equal(await act(f, 'claim', row), 'case_staff_recorded');
    assert.equal(await act(f, 'assign', null, { assigneeId: THIRD }), 'case_assignee_denied');
    f.discord.state.members.set(THIRD, [LEAD]); const count = writes(f);
    assert.equal(await act(f, 'assign', null, { assigneeId: THIRD, reason: 'coverage' }), 'case_staff_recorded'); assert.equal(writes(f), count);
    assert.equal((await state(f)).user_id, USER); assert.equal((await audits(f)).length, 2);
  });

  await scenario('K06 lost assignee authority remains visible for review after roles return until explicitly reassigned', async f => {
    await f.open(); f.discord.state.members.set(THIRD, [STAFF]);
    assert.equal(await act(f, 'assign', null, { assigneeId: THIRD }), 'case_staff_recorded');
    const retained = (await state(f)).assignee_grant; f.discord.state.members.set(THIRD, []);
    assert.equal((await queue(f)).entries[0].assignmentStatus, 'needs_review'); f.discord.state.members.set(THIRD, [STAFF]);
    assert.equal((await queue(f)).entries[0].assignmentStatus, 'needs_review'); assert.deepEqual((await state(f)).assignee_grant, retained);
    assert.equal(await act(f, 'claim'), 'case_stale');
    assert.equal(await act(f, 'assign', null, { assigneeId: THIRD, reason: 'coverage' }), 'case_staff_recorded');
    assert.equal((await queue(f)).entries[0].assignmentStatus, 'current'); assert.equal((await audits(f)).length, 2);
  });

  await scenario('K07 failed audit or receipt writes roll back assignment and version while records remain core-only', async f => {
    await f.open(); const before = await state(f), receipts = await f.rows('receipts');
    for (const table of ['case_staff_actions', 'receipts']) {
      await f.admin.query(`REVOKE INSERT ON sophie_core.${table} FROM sophie_test_core`);
      try { assert.equal(await act(f, 'claim'), 'unavailable'); }
      finally { await f.admin.query(`GRANT INSERT ON sophie_core.${table} TO sophie_test_core`); }
      assert.deepEqual(await state(f), before); assert.deepEqual(await f.rows('receipts'), receipts); assert.equal((await audits(f)).length, 0);
    }
    await assert.rejects(cluster.knowledgePool.query('SELECT * FROM sophie_core.case_staff_actions'), { code: '42501' });
    await assert.rejects(f.pool.query('DELETE FROM sophie_core.case_staff_actions'), { code: '42501' });
  });

  await scenario('K08 losing target authority during an assignment rejects a stale grant even with supplied Staff roles', async f => {
    await f.open(); f.discord.state.members.set(THIRD, [STAFF]); let seen = 0;
    f.discord.state.before = call => { if (call.method === 'GET' && call.path.endsWith(`/members/${THIRD}`) && ++seen === 2) f.discord.state.members.set(THIRD, []); };
    const payload = caseStaffPayload(f, 'assign', await state(f), { assigneeId: THIRD }); payload.data.resolved = { members: { [THIRD]: { roles: [STAFF] } } };
    assert.equal(await f.execute(payload), 'case_assignee_denied'); assert.equal((await state(f)).assignee_grant, null); assert.equal((await audits(f)).length, 0);
  });

  await scenario('K09 losing the acting Staff role while checking an assignee rolls back the human action', async f => {
    await f.open(); f.discord.state.members.set(THIRD, [STAFF]); let seen = 0;
    f.discord.state.before = call => { if (call.method === 'GET' && call.path.endsWith(`/members/${THIRD}`) && ++seen === 2) f.discord.state.members.set(OTHER, []); };
    assert.equal(await act(f, 'assign', null, { assigneeId: THIRD }), 'denied'); assert.equal((await audits(f)).length, 0); assert.equal((await state(f)).assignee_grant, null);
  });

  await scenario('K10 permission-filtered pagination survives closure of its boundary and keeps restricted cursors opaque', async f => {
    const ids = [];
    for (let index = 0; index < 9; index++) ids.push(await reserve(f, [2, 7].includes(index) ? 'head-admin-contact' : 'admin-help', index === 0 ? 'c'.repeat(96) : `page-${index}`));
    await f.drain(f.cases); const first = await queue(f); assert.equal(first.entries.length, 5); assert.equal(first.next, first.entries.at(-1).token);
    assert.equal(first.entries.some(row => row.type === 'head-admin-contact'), false);
    const boundary = await state(f, first.entries.at(-1).id);
    assert.equal(await f.execute(ticketPayload(f, 'close', boundary, { member: { user: { id: OTHER } } })), 'case_change_recorded'); await f.drain(f.cases);
    const page = await f.caseStaff.queue(f.verified(caseStaffControl(f, `sophie:case-queue:v1:active:${first.next}`)));
    assert.equal(page.entries.length, 2); assert.equal(page.next, null); assert.equal(new Set([...first.entries, ...page.entries].map(row => row.id)).size, 7);
    const head = (await f.rows('case_provisions')).find(row => row.case_id === ids[2]);
    assert.deepEqual(await f.caseStaff.queue(f.verified(caseStaffControl(f, `sophie:case-queue:v1:active:${head.operation_token}`))), { state: 'stale' });
    assert.equal((await queue(f, { filter: 'closed' })).entries[0].id, boundary.id);
  });

  await scenario('K11 assignment and closure share optimistic versions, and unclaim cannot supersede closing intent', async f => {
    await f.open(); const old = await state(f); assert.equal(await act(f, 'claim', old), 'case_staff_recorded');
    const close = row => f.execute(ticketPayload(f, 'close', row, { member: { user: { id: OTHER } } }));
    assert.equal(await close(old), 'case_stale'); assert.equal(await close(await state(f)), 'case_change_recorded');
    assert.equal(await act(f, 'unclaim'), 'case_staff_recorded'); assert.equal((await state(f)).state, 'closing');
    await f.drain(f.cases); assert.equal((await state(f)).state, 'closed'); assert.equal((await f.rows('case_lifecycle_actions'))[0].status, 'confirmed');
    assert.equal(await act(f, 'claim'), 'case_stale'); assert.equal(await act(f, 'assign', null, { assigneeId: OTHER }), 'case_stale');
    assert.equal((await queue(f)).entries.length, 0); assert.equal((await queue(f, { filter: 'closed' })).entries[0].assigneeId, null);
  });

  await scenario('K12 forged actors, changed policy and a disabled delivery gate cannot read or change ownership', async f => {
    await f.open(); const row = await state(f), actor = await f.actor(OTHER);
    await assert.rejects(f.store.changeCaseAssignment({ actor: { ...actor }, guildId: GUILD, interactionId: f.nextId(), id: row.id,
      expectedVersion: row.version, action: 'claim' }), /OPERATION_DENIED/);
    assert.equal(await f.commands.execute({ ...f.verified(caseStaffPayload(f, 'claim', row)) }), 'denied');
    await f.admin.query('INSERT INTO sophie_core.case_policies (guild_id, version, policy) VALUES ($1, 2, $2)', [GUILD, { ...casePolicy, version: 2 }]);
    assert.deepEqual(await queue(f), { state: 'unavailable' }); assert.equal(await act(f, 'claim'), 'unavailable');
    f.clock.enabled = false; const count = f.discord.state.calls.length; assert.deepEqual(await queue(f), { state: 'disabled' });
    assert.equal(await act(f, 'claim'), 'disabled'); assert.equal(f.discord.state.calls.length, count); assert.equal((await audits(f)).length, 0);
  });

  await scenario('K13 signed loopback queue and ownership commands acknowledge privately and reauthorize every rendered reply', async f => {
    await f.open(); f.discord.state.members.set(THIRD, [STAFF]); const replies = [], faults = [];
    const responder = createInteractionResponder({ verifier: f.identities.verifier, applicationId: APPLICATION, clock: () => f.clock.now,
      enabled: () => f.clock.enabled, caseStaff: f.caseStaff, fetch: async (_, value) => { replies.push(JSON.parse(value.body)); return Response.json({}); } });
    const server = createInteractionHttpServer({ verifier: f.identities.verifier, commands: f.commands, respond: responder.respond,
      enabled: () => f.clock.enabled, onFault: code => faults.push(code) }); const address = await server.listen();
    async function send(value) {
      const signed = f.identities.signed(value), response = await fetch(`http://${address.host}:${address.port}/discord/interactions`, { method: 'POST', body: signed.body,
        headers: { 'Content-Type': 'application/json', 'X-Signature-Ed25519': signed.signature, 'X-Signature-Timestamp': signed.timestamp } });
      assert.deepEqual(await response.json(), { type: 5, data: { flags: 64 } }); await server.drain();
    }
    try {
      await send(caseStaffPayload(f, 'queue')); assert.equal(replies[0].embeds.length, 1);
      await send(caseStaffControl(f, replies[0].components[0].components[0].custom_id)); assert.match(replies[1].embeds[0].description, new RegExp(`Assigned: <@${OTHER}>`));
      await send(caseStaffPayload(f, 'assign', await state(f), { assigneeId: THIRD })); assert.match(replies[2].embeds[0].description, new RegExp(`Assigned: <@${THIRD}>`));
      await send(caseStaffPayload(f, 'unclaim', await state(f), { userId: THIRD })); assert.match(replies[3].embeds[0].description, /Assigned: Unassigned/);
      const proof = f.verified(caseStaffPayload(f, 'claim', await state(f))); assert.equal(await f.commands.execute(proof), 'case_staff_recorded');
      f.discord.state.members.set(OTHER, []); await responder.respond(proof, 'case_staff_recorded'); assert.deepEqual(replies.at(-1).embeds, []);
      for (const reply of replies) assert.deepEqual(reply.allowed_mentions, { parse: [], users: [], roles: [], replied_user: false });
      assert.deepEqual(faults, []); assert.equal((await audits(f)).length, 4);
    } finally { await server.close(); }
  });

  await scenario('K14 migration leaves prior cases unassigned without inventing audits and requires unique routing tokens', async f => {
    await f.open(); const second = await reserve(f); const rows = await f.rows('case_provisions'), before = await state(f), client = await f.admin.connect();
    await assert.rejects(f.admin.query('UPDATE sophie_core.case_provisions SET operation_token = $1 WHERE case_id = $2', [rows[0].operation_token, second]), { code: '23505' });
    try {
      await client.query('BEGIN'); await client.query('DROP TABLE sophie_core.case_staff_actions');
      await client.query('ALTER TABLE sophie_core.case_reservations DROP COLUMN assignee_grant');
      await client.query('ALTER TABLE sophie_core.case_provisions DROP CONSTRAINT case_provisions_guild_token_key');
      await client.query(await readFile(new URL('../../apps/core/storage/migrations/017-case-staff.sql', import.meta.url), 'utf8'));
      const record = (await client.query('SELECT * FROM sophie_core.case_reservations WHERE id = $1', [before.id])).rows[0];
      assert.deepEqual(record, before); assert.equal(record.assignee_grant, null); assert.equal((await client.query('SELECT * FROM sophie_core.case_staff_actions')).rowCount, 0);
    } finally { await client.query('ROLLBACK'); client.release(); }
  });
}
