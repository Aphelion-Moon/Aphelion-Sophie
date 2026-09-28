import assert from 'node:assert/strict';
import { createAiEffects } from '../../apps/core/storage/ai-effects.js';
import { createAiMessages } from '../../apps/core/discord/ai-messages.js';
import { renderAiReply } from '../../modules/assistant/output.js';
import { automationEmoji } from '../../modules/automation/delivery.js';

/** Synthetic isolated database and transport; no real Discord effects. */
export async function runAiEffectsSuite(cluster, run) {
  const { adminPool: admin, corePool: pool } = cluster;
  await admin.query('GRANT SELECT,INSERT,UPDATE,DELETE ON sophie_ai.effects TO sophie_test_core');
  const guildId = '818', clock = Date.now, store = () => createAiEffects({ pool, guildId, clock });
  await admin.query('INSERT INTO sophie_ai.state(guild_id) VALUES($1)', [guildId]);
  const binding = { epoch: 1, consentEpoch: 1, presenceEpoch: 1, accessEpoch: 1, inputRevision: 'a'.repeat(64) };
  const emoji = { key: 'wave', id: null, name: '👋' };
  async function request(messageId) {
    const value = { guildId, channelId: '202', userId: '303', messageId, receivedAt: clock(), deadline: clock()+15000,
      binding, inputRevision: 'a'.repeat(64), text: 'SYNTHETIC_NEVER_STORE_THIS', config: { emojis: [emoji] } };
    await admin.query(`INSERT INTO sophie_ai.request_receipts(guild_id,message_id,channel_id,user_id,input_revision,state,deadline)
      VALUES($1,$2,$3,$4,$5,'sending',$6)`, [guildId,messageId,value.channelId,value.userId,value.inputRevision,new Date(value.deadline)]);
    return value;
  }
  const rows = async () => (await admin.query('SELECT * FROM sophie_ai.effects WHERE guild_id=$1 ORDER BY message_id',[guildId])).rows;
  await run('DS-09 E01 one durable claimant, stale owner rejected and metadata excludes source text', async () => {
    const value = await request('101');
    const claims = await Promise.allSettled([store().claim(value,'reply',null),store().claim(value,'reply',null)]);
    assert.equal(claims.filter(row => row.status === 'fulfilled').length,1);
    const held = claims.find(row => row.status === 'fulfilled').value;
    await assert.rejects(store().begin({ ...held, owner: '00000000-0000-0000-0000-000000000000' }), /AI_EFFECT_REVOKED/);
    await store().begin(held); await assert.rejects(store().begin(held), /AI_EFFECT_REVOKED/);
    assert.equal(JSON.stringify(await rows()).includes(value.text),false);
    await store().recover(); assert.equal((await rows())[0].state,'cleanup');
    assert.deepEqual(await store().pending(),[]); // Unknown send is never searched for or resent.
  });
  await run('DS-09 E02 late positive receipt survives restart and revocation for exact cleanup', async () => {
    const value = await request('102'), held = await store().claim(value,'reply',null); await store().begin(held);
    await store().invalidate({ userId: value.userId });
    const receipt = await store().note(held,'909');
    const deleted = [], messages = createAiMessages({ effects: store(), clock, botUserId:'505', revalidate:async()=>false,canReact:async()=>false,
      transport:{deleteAutomationMessage:async(...args)=>deleted.push(args)} });
    const pending = await store().pending(); assert.equal(pending.length,1); assert.equal(pending[0].state,'cleanup');
    await messages.remove(value,receipt); assert.deepEqual(deleted,[['202','909']]);
    await assert.rejects(messages.remove(value,receipt),/AI_EFFECT_UNTRUSTED/); assert.equal(deleted.length,1);
    assert.deepEqual((await rows()).find(row=>row.message_id==='102').dependencies,[]);
  });
  await run('DS-09 E03 preexisting reaction cannot be claimed and confirmed own reaction has exact removal', async () => {
    const value = await request('103'), calls = []; let canReact = false;
    const messages = createAiMessages({effects:store(),clock,botUserId:'505',revalidate:async()=>true,canReact:async()=>canReact,
      transport:{createAiReaction:async(...args)=>calls.push(['create',...args]),deleteAutomationReaction:async(...args)=>{assert.equal(automationEmoji(args[2]),emoji.name);calls.push(['delete',...args]);}} });
    await assert.rejects(messages.react(value,emoji),/AI_REACTION_UNAVAILABLE/);
    assert.equal((await rows()).some(row=>row.message_id==='103'),false);
    canReact = true; const effect = await messages.react(value,emoji);
    await messages.remove(value,effect); assert.equal(calls.length,2);
    assert.deepEqual(calls[1],['delete','202','103',{kind:'reaction',emoji:{id:null,name:emoji.name}}]);
  });
  await run('DS-09 E04 positive reply persists before return and invalidation before dispatch prevents send', async () => {
    const value = await request('104'), calls = [], effects = store();
    const messages = createAiMessages({effects,clock,botUserId:'505',revalidate:async()=>true,canReact:async()=>false,
      transport:{createAiMessage:async()=>{calls.push('send');return {id:'910',channel_id:'202',author:{id:'505',bot:true}};}} });
    const payload = renderAiReply({kind:'reply',text:'Synthetic reply',purpose:'conversation',support:'general_knowledge',citations:[]},[]);
    await messages.reply(value,payload); assert.equal((await rows()).find(row=>row.message_id==='104').receipt_id,'910');
    const revoked = await request('105'), held = await effects.claim(revoked,'reply',null);
    await effects.invalidate({messageId:'105'}); await assert.rejects(effects.begin(held),/AI_EFFECT_REVOKED/);
    assert.deepEqual(calls,['send']);
  });
}
