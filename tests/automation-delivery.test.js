import test from 'node:test';
import assert from 'node:assert/strict';
import { createAutomationMessages } from '../apps/core/discord/automation-messages.js';
import { automationPayload } from '../modules/automation/delivery.js';
import { simulatedDiscord, BOT, BOT_ROLE } from './fixtures/discord.js';
import { GUILD, USER, NOW } from './fixtures/domain.js';
import { PUBLIC_CHANNEL, PROTECTED_CATEGORY } from './fixtures/automation.js';
import { PERMISSIONS as P } from '../platform/authorization/discord-permissions.js';

function fixture(action={kind:'message',text:'Synthetic @everyone <@123> ${literal}'}) {
  let now=NOW,version='automation-1';const clock=()=>now,discord=simulatedDiscord({clock,readContinuity:()=>version});
  discord.state.roles.find(role=>role.id===GUILD).permissions=String(P.viewChannel|P.sendMessages);
  discord.state.roles.find(role=>role.id===BOT_ROLE).permissions=String(P.viewChannel|P.sendMessages|P.readHistory|P.addReactions);
  discord.state.channels.set(PUBLIC_CHANNEL,{id:PUBLIC_CHANNEL,guild_id:GUILD,type:0,parent_id:null,permission_overwrites:[]});
  discord.state.messages.set('900',{id:'900',channel_id:PUBLIC_CHANNEL,author:{id:USER,bot:false},type:0,content:'Synthetic input is not copied',reactions:[]});
  const plan={id:'a'.repeat(32),guildId:GUILD,userId:USER,channelId:PUBLIC_CHANNEL,sourceMessageId:'900',policyRevision:1,action,expiresAt:NOW+60000};
  const messages=createAutomationMessages({transport:discord.transport,roles:discord.roles,botUserId:BOT,protectedCategoryId:PROTECTED_CATEGORY,clock});
  return {discord,plan,messages,advance:ms=>now+=ms,revoke:()=>version='automation-2'};
}
test('automatic static messages suppress mentions and previews and retain a disabled attribution marker',()=>{
  const {plan}=fixture(),body=automationPayload(plan.id,plan.action);
  assert.equal(body.content,plan.action.text);assert.deepEqual(body.allowed_mentions,{parse:[],roles:[],users:[],replied_user:false});
  assert.equal(body.flags,4);assert.equal(body.components[0].components[0].label,'Automated response');assert.equal(body.components[0].components[0].disabled,true);
});
test('opaque preparations reject cloning, stale permissions, Gateway revocation and expired deadlines before a write',async()=>{
  for(const kind of ['clone','stale','revoked','expired']) {
    const f=fixture(),proof=await f.messages.prepare(f.plan);
    if(kind==='stale')f.advance(5001);if(kind==='revoked')f.revoke();if(kind==='expired')f.advance(60000);
    await assert.rejects(f.messages.create(f.plan,kind==='clone'?{}:proof));
    assert.equal(f.discord.state.calls.filter(call=>call.method!=='GET').length,0);
  }
});
test('source metadata projection omits content files embeds referenced messages and profiles',async()=>{
  const f=fixture();const source=await f.discord.transport.getAutomationSource(PUBLIC_CHANNEL,'900');
  assert.deepEqual(Object.keys(source).sort(),['authorId','bot','channelId','id','interaction','reactions','type','webhook']);
  assert.equal(JSON.stringify(source).includes('Synthetic input'),false);
});
test('automatic message receipts bind exact action and target; verification detects an edited own effect',async()=>{
  const f=fixture(),receipt=await f.messages.create(f.plan,await f.messages.prepare(f.plan));
  const id=f.messages.verification.receipt(receipt,f.plan);
  assert.throws(()=>f.messages.verification.receipt({},f.plan));assert.throws(()=>f.messages.verification.receipt(receipt,{...f.plan,channelId:'711'}));
  assert.equal(await f.messages.verify(f.plan,await f.messages.prepare(f.plan),id),true);
  f.discord.state.messages.get(id).content='Synthetic modified';assert.equal(await f.messages.verify(f.plan,await f.messages.prepare(f.plan),id),false);
  const removed=await f.messages.remove(f.plan,id);f.messages.verification.removal(removed,f.plan,id);assert.equal(f.discord.state.messages.has(id),false);
});
test('current overwrite denial, missing membership and protected destinations cannot issue delivery proofs',async()=>{
  for(const kind of ['permission','member','protected']){
    const f=fixture();if(kind==='permission')f.discord.state.channels.get(PUBLIC_CHANNEL).permission_overwrites=[{id:USER,type:1,allow:'0',deny:String(P.viewChannel)}];
    if(kind==='member')f.discord.state.members.delete(USER);if(kind==='protected')f.discord.state.channels.get(PUBLIC_CHANNEL).parent_id=PROTECTED_CATEGORY;
    await assert.rejects(f.messages.prepare(f.plan),/AUTOMATION_INELIGIBLE/);
    assert.equal(f.discord.state.calls.some(call=>call.path.endsWith('/messages/900')),false);
  }
});
test('Unicode reaction paths are encoded, existing reactions are not adopted, and own removal is idempotent',async()=>{
  const f=fixture({kind:'reaction',emoji:{id:null,name:'✅'}}),receipt=await f.messages.create(f.plan,await f.messages.prepare(f.plan));
  assert.equal(f.messages.verification.receipt(receipt,f.plan),null);
  assert.equal(await f.messages.verify(f.plan,await f.messages.prepare(f.plan),null),true);
  await assert.rejects(f.messages.create(f.plan,await f.messages.prepare(f.plan)),/AUTOMATION_EXISTING_REACTION/);
  await f.messages.remove(f.plan,null);await f.messages.remove(f.plan,null);
  assert.ok(f.discord.state.calls.some(call=>call.method==='PUT'&&call.path.includes(encodeURIComponent('✅'))));
});
test('custom reactions require a current guild emoji, matching name and eligible bot role',async()=>{
  const f=fixture({kind:'reaction',emoji:{id:'880',name:'synthetic'}});
  await assert.rejects(f.messages.prepare(f.plan),/AUTOMATION_INELIGIBLE/);
  f.discord.state.emojis.set('880',{id:'880',name:'synthetic',roles:[USER],available:true});
  await assert.rejects(f.messages.prepare(f.plan),/AUTOMATION_INELIGIBLE/);
  f.discord.state.emojis.get('880').roles=[BOT_ROLE];assert.ok(await f.messages.prepare(f.plan));
  f.discord.state.emojis.get('880').available=false;await assert.rejects(f.messages.prepare(f.plan),/AUTOMATION_INELIGIBLE/);
});
test('automation transport distinguishes a definite rejected action from an uncertain write response',async()=>{
  for(const [status,code] of [[400,'AUTOMATION_ACTION_REJECTED'],[500,'DELIVERY_UNCERTAIN']]) {
    const f=fixture(),proof=await f.messages.prepare(f.plan);
    f.discord.state.before=call=>call.method==='POST'?new Response('{}',{status}):null;
    await assert.rejects(f.messages.create(f.plan,proof),error=>error.code===code);
  }
});
test('recovery verifies an existing own marked message after the send deadline without sending again',async()=>{
  const f=fixture(),receipt=await f.messages.create(f.plan,await f.messages.prepare(f.plan));
  const id=f.messages.verification.receipt(receipt,f.plan);f.advance(60001);f.discord.state.members.delete(USER);
  const proof=await f.messages.recover(f.plan,id);await f.messages.verification.recovery(proof,f.plan,id);
  await assert.rejects(f.messages.verification.recovery({},f.plan,id),/AUTOMATION_RECOVERY_INVALID/);
  await assert.rejects(f.messages.verification.recovery(proof,{...f.plan,channelId:'711'},id),/AUTOMATION_RECOVERY_INVALID/);
  assert.equal(f.discord.state.calls.filter(call=>call.method==='POST').length,1);
});
test('recovery rejects changed content ownership markers and protected channels',async()=>{
  for(const change of ['content','author','marker','channel']) {
    const f=fixture(),receipt=await f.messages.create(f.plan,await f.messages.prepare(f.plan)),id=f.messages.verification.receipt(receipt,f.plan),raw=f.discord.state.messages.get(id);
    if(change==='content')raw.content='Synthetic changed';if(change==='author')raw.author.id=USER;
    if(change==='marker')raw.components[0].components[0].custom_id='sophie:auto:'+'b'.repeat(32);
    if(change==='channel')f.discord.state.channels.get(PUBLIC_CHANNEL).parent_id=PROTECTED_CATEGORY;
    await assert.rejects(f.messages.recover(f.plan,id),/AUTOMATION_(RECOVERY|CHANNEL)_UNAVAILABLE/);
  }
});
test('recovery proofs expire and reject continuity changes at the retained receipt boundary',async()=>{
  for(const change of ['stale','revoked']) {
    const f=fixture(),receipt=await f.messages.create(f.plan,await f.messages.prepare(f.plan)),id=f.messages.verification.receipt(receipt,f.plan);
    const proof=await f.messages.recover(f.plan,id);if(change==='stale')f.advance(5001);else f.revoke();
    await assert.rejects(f.messages.verification.recovery(proof,f.plan,id));
  }
});
test('reaction recovery requires a currently present own matching reaction; absence is never proof of no send',async()=>{
  const f=fixture({kind:'reaction',emoji:{id:null,name:'✅'}});
  await assert.rejects(f.messages.recover(f.plan,null),/AUTOMATION_RECOVERY_UNAVAILABLE/);
  await f.messages.create(f.plan,await f.messages.prepare(f.plan));f.advance(60001);
  const proof=await f.messages.recover(f.plan,null);await f.messages.verification.recovery(proof,f.plan,null);
  f.discord.state.messages.get('900').reactions[0].me=false;await assert.rejects(f.messages.recover(f.plan,null),/AUTOMATION_RECOVERY_UNAVAILABLE/);
});
