import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { createAiControls } from '../../apps/core/storage/ai-controls.js';
import { createAiMemories, eraseAiMemories, MEMORY_MEMBER_CAP } from '../../apps/core/storage/ai-memories.js';
import { createPreferenceJournal, initializePreferenceJournal } from '../../apps/core/storage/preference-journal.js';

/** Sophie's own memories (owner decision, 20 October 2026), synthetic members only. */
export async function runAiMemoriesSuite(cluster, run) {
  const { adminPool: admin, corePool: pool } = cluster, guildId = '929', channelId = '717', otherChannel = '718';
  const alice = { guildId, userId: '202', capabilityEpoch: 1, policyVersion: 1 }, bob = { ...alice, userId: '303' };
  const path = resolve(cluster.recovery.directory, 'memory-preferences.jsonl'), id = '8'.repeat(64);
  await initializePreferenceJournal({ path, id });
  const journal = createPreferenceJournal({ path, id, qualified: async () => true });
  const departed = new Set();
  // Mirrors ai-privacy.current: the database epoch must match the independent watermark and no departure is pending.
  const privacyCurrent = async (userId, client = null) => !departed.has(userId) &&
    Number((await (client ?? pool).query('SELECT epoch FROM sophie_ai.response_preferences WHERE guild_id=$1 AND user_id=$2', [guildId, userId])).rows[0]?.epoch ?? 0) ===
      await journal.read(guildId, userId);
  let auditor = true;
  const memories = createAiMemories({ pool, guildId, journal, privacyCurrent });
  const controls = createAiControls({ pool, guildId, inspectChannel: async () => null, memberPresence: async () => 1, preferenceJournal: journal,
    privacyCurrent, memories, memoriesActive: async () => true,
    authorize: async (action, actor, scope) => action === 'ai.self' ? scope.userId === actor.userId : action === 'ai.memory.audit' && auditor });
  await admin.query('INSERT INTO sophie_ai.state(guild_id) VALUES($1) ON CONFLICT DO NOTHING', [guildId]);
  const rows = async () => (await admin.query('SELECT * FROM sophie_ai.memories WHERE guild_id=$1 ORDER BY created_at', [guildId])).rows;
  const prompt = (userIds, channel = channelId) => memories.forPrompt({ channelId: channel, userIds });
  const member = (userId, text) => ({ scope: 'member', subjects: [userId], text });

  await run('MEM-S01 Sophie keeps member and channel memories, offers them only to turns they belong to, and honours opt-out', async () => {
    assert.equal(await memories.record({ channelId, memories: [member(alice.userId, '{1} builds moth shuttles'),
      { scope: 'channel', subjects: [alice.userId, bob.userId], text: '{1} and {2} hosted a karaoke night' }] }), 2);
    assert.equal((await prompt([alice.userId])).length, 2);
    assert.deepEqual((await prompt([bob.userId], otherChannel)).map(item => item.scope), []);
    assert.equal(await memories.record({ channelId, memories: [member(alice.userId, '{1} BUILDS moth shuttles')] }), 0, 'a repeat only refreshes');
    await controls.setRemembering({ actor: bob, enabled: false, confirmed: true });
    assert.deepEqual((await prompt([alice.userId])).map(item => item.scope), ['member'], 'a memory naming someone who opted out is not used');
    assert.equal(await memories.record({ channelId, memories: [member(bob.userId, '{1} plays medical')] }), 0, 'nothing new is kept about them');
    await controls.setRemembering({ actor: bob, enabled: true, confirmed: true });
    assert.equal((await prompt([alice.userId])).length, 2);
  });

  await run('MEM-S02 members see, edit and forget what names them; a restored copy of a forgotten memory stays unusable', async () => {
    const own = await controls.ownMemories({ actor: alice });
    assert.equal(own.active, true); assert.equal(own.remembering, true);
    assert.deepEqual(own.memories.map(item => item.text).sort(), ['you and a member hosted a karaoke night', 'you builds moth shuttles'].sort());
    const mine = own.memories.find(item => item.scope === 'member'), shared = own.memories.find(item => item.scope === 'channel');
    await assert.rejects(controls.editMemory({ actor: bob, id: mine.id, text: 'not theirs', confirmed: true }), /AI_MEMORY_STALE/);
    await assert.rejects(controls.editMemory({ actor: alice, id: shared.id, text: 'channel memories are not editable', confirmed: true }), /AI_MEMORY_STALE/);
    const edited = await controls.editMemory({ actor: alice, id: mine.id, text: 'Builds moth shuttles on weekends', confirmed: true });
    assert.equal(edited.memories.find(item => item.id === mine.id).edited, true);
    const copy = (await rows()).find(row => row.id === shared.id);
    await controls.forgetMemory({ actor: alice, id: shared.id, confirmed: true });
    assert.equal((await rows()).some(row => row.id === shared.id), false, 'forgetting a channel memory removes it for everyone');
    await admin.query(`INSERT INTO sophie_ai.memories(guild_id,id,channel_id,scope,subject_ids,subject_epochs,text,created_at,used_at,expires_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, [guildId, copy.id, copy.channel_id, copy.scope, copy.subject_ids, copy.subject_epochs, copy.text, copy.created_at, copy.used_at, copy.expires_at]);
    assert.equal((await prompt([alice.userId, bob.userId])).some(item => item.id === shared.id), false, 'the old epoch keeps a restored copy out');
    assert.equal(await memories.current([{ id: shared.id, text: copy.text }]), false);
    assert.equal((await prompt([alice.userId])).find(item => item.id === mine.id).text, 'Builds moth shuttles on weekends');
  });

  await run('MEM-S03 a preference save moves memories to the new epoch; forgetting everything clears them', async () => {
    const saved = await controls.savePreferences({ actor: alice, expectedEpoch: await journal.read(guildId, alice.userId),
      settings: { replyLength: 'brief', language: null, notes: [], useWithAi: false }, confirmed: true });
    assert.ok(saved.epoch > 0);
    assert.equal((await prompt([alice.userId])).filter(item => item.scope === 'member').length, 1, 'still usable after the epoch moved');
    await controls.forgetAllMemories({ actor: alice, confirmed: true });
    assert.equal((await rows()).filter(row => row.subject_ids.includes(alice.userId) && row.scope === 'member').length, 0);
    assert.equal((await controls.ownMemories({ actor: alice })).memories.length, 0);
  });

  await run('MEM-S04 member memories are capped per member, least recently used first', async () => {
    for (let index = 0; index <= MEMORY_MEMBER_CAP; index++) await memories.record({ channelId, memories: [member(bob.userId, `{1} fact number ${index}`)] });
    const kept = (await rows()).filter(row => row.scope === 'member' && row.subject_ids[0] === bob.userId);
    assert.equal(kept.length, MEMORY_MEMBER_CAP); assert.equal(kept.some(row => row.text === '{1} fact number 0'), false);
    assert.equal((await prompt([bob.userId])).length, 8, 'a turn sees at most eight memories about its members');
  });

  await run('MEM-S05 the owner audit lists and deletes any memory; without ai.memory.audit it is refused', async () => {
    const audit = await controls.auditMemories({ actor: alice });
    assert.equal(audit.memories.length, Math.min(50, (await rows()).length));
    assert.match(audit.memories[0].text, /<@303>/u);
    const removed = await controls.removeMemory({ actor: alice, id: audit.memories[0].id, confirmed: true });
    assert.equal(removed.memories.some(item => item.id === audit.memories[0].id), false);
    auditor = false;
    await assert.rejects(controls.auditMemories({ actor: alice }), /OPERATION_DENIED/);
    await assert.rejects(controls.removeMemory({ actor: alice, id: audit.memories[1].id, confirmed: true }), /OPERATION_DENIED/);
    auditor = true;
  });

  await run('MEM-S06 departure erases every memory naming the member and their opt-out; pending departure hides them at once', async () => {
    await memories.record({ channelId, memories: [{ scope: 'channel', subjects: [alice.userId, bob.userId], text: '{1} taught {2} to fly' }] });
    await controls.setRemembering({ actor: bob, enabled: false, confirmed: true });
    departed.add(bob.userId);
    assert.equal((await prompt([alice.userId, bob.userId])).length, 0);
    const client = await admin.connect();
    try { await eraseAiMemories(client, guildId, bob.userId); } finally { client.release(); }
    assert.equal((await rows()).some(row => row.subject_ids.includes(bob.userId)), false);
    assert.equal((await admin.query('SELECT 1 FROM sophie_ai.memory_optouts WHERE guild_id=$1 AND user_id=$2', [guildId, bob.userId])).rowCount, 0);
    departed.delete(bob.userId);
  });

  await run('MEM-S07 expired memories are not used and are deleted; use extends a memory', async () => {
    await memories.record({ channelId, memories: [member(alice.userId, '{1} collects tiny spaceships')] });
    const [memory] = await prompt([alice.userId]);
    await admin.query("UPDATE sophie_ai.memories SET expires_at=clock_timestamp()-interval '1 second' WHERE id=$1", [memory.id]);
    assert.equal((await prompt([alice.userId])).length, 0);
    await memories.touch([memory]);
    assert.equal((await prompt([alice.userId])).length, 1, 'a turn that used it extends it');
    await admin.query("UPDATE sophie_ai.memories SET expires_at=clock_timestamp()-interval '1 second' WHERE id=$1", [memory.id]);
    await memories.expire();
    assert.equal((await rows()).some(row => row.id === memory.id), false);
  });
}
