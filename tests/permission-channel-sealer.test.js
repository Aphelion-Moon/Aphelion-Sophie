import test from 'node:test';
import assert from 'node:assert/strict';
import { createPermissionChannelSealer, sealedPermissionOverwrites } from '../apps/core/discord/permission-channel-sealer.js';
import { caseChannelPayload } from '../modules/tickets/channel-policy.js';
import { simulatedCases, casePolicy, casePlan, CATEGORY } from './fixtures/cases.js';
import { BOT, BOT_ROLE, mapping } from './fixtures/discord.js';
import { GUILD, NOW } from './fixtures/domain.js';

function fixture() {
  const clock={now:NOW},discord=simulatedCases({clock:()=>clock.now});
  const target={guildId:GUILD,channelId:'300000000000000001',parentId:CATEGORY,marker:`sophie:case:v1:${casePlan.token}`};
  discord.state.channels.set(target.channelId,{id:target.channelId,guild_id:GUILD,...caseChannelPayload(casePlan,casePolicy,'open')});
  const sealer=createPermissionChannelSealer({transport:discord.transport,roles:discord.roles,mapping,clock:()=>clock.now});
  const writes=()=>discord.state.calls.filter(call=>call.method!=='GET');
  return {clock,discord,target,sealer,writes};
}
test('sealing uses the existing bot-only ACL contract and reads no case participants or messages',async()=>{
  const f=fixture();assert.deepEqual(sealedPermissionOverwrites(GUILD,BOT),caseChannelPayload(casePlan,casePolicy,'sealed').permission_overwrites);
  await f.sealer.apply(await f.sealer.prepare(f.target),f.target,async()=>true);
  assert.equal(f.sealer.verify(await f.sealer.inspect(f.target),f.target),true);assert.equal(f.writes().length,1);
  assert.ok(f.discord.state.calls.every(call=>!call.path.includes('/messages')&&(!call.path.includes('/members/')||call.path.endsWith(`/members/${BOT}`))));
});
test('forged reused expired or differently bound seal proofs cannot write',async()=>{
  const f=fixture(),proof=await f.sealer.prepare(f.target);
  await assert.rejects(f.sealer.apply({...proof},f.target,async()=>true),/PERMISSION_SEAL_UNTRUSTED/);
  await assert.rejects(f.sealer.apply(proof,{...f.target,channelId:'999'},async()=>true),/PERMISSION_SEAL_UNTRUSTED/);
  f.clock.now+=5001;await assert.rejects(f.sealer.apply(proof,f.target,async()=>true),/MEMBERSHIP_STALE/);
  await assert.rejects(f.sealer.apply(proof,f.target,async()=>true),/PERMISSION_SEAL_UNTRUSTED/);assert.equal(f.writes().length,0);
});
test('bot permission loss channel identity mismatch and refused durable authorization stop writes',async()=>{
  for(const mode of ['permissions','identity','authorization']) {
    const f=fixture();
    if(mode==='permissions')f.discord.state.roles.find(row=>row.id===BOT_ROLE).permissions='0';
    if(mode==='identity')f.discord.state.channels.get(f.target.channelId).topic='synthetic-unrelated-channel';
    await assert.rejects((async()=>f.sealer.apply(await f.sealer.prepare(f.target),f.target,async()=>false))());
    assert.equal(f.writes().length,0);
  }
});
test('already sealed channels skip writes but verification is fresh and opaque',async()=>{
  const f=fixture();f.discord.state.channels.get(f.target.channelId).permission_overwrites=sealedPermissionOverwrites(GUILD,BOT);
  assert.deepEqual(await f.sealer.apply(await f.sealer.prepare(f.target),f.target,async()=>true),{written:false});assert.equal(f.writes().length,0);
  const proof=await f.sealer.inspect(f.target);assert.throws(()=>f.sealer.verify({...proof},f.target),/PERMISSION_SEAL_UNTRUSTED/);
  f.clock.now+=5001;assert.throws(()=>f.sealer.verify(proof,f.target),/MEMBERSHIP_STALE/);
  f.discord.state.channels.get(f.target.channelId).permission_overwrites=[];
  assert.throws(()=>f.sealer.verify(proof,f.target),/MEMBERSHIP_STALE/);
  const reopened=await f.sealer.inspect(f.target);assert.throws(()=>f.sealer.verify(reopened,f.target),/PERMISSION_CHANNEL_NOT_SEALED/);
});
