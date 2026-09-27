import test from 'node:test';
import assert from 'node:assert/strict';
import { canonicalAutomation, planAutomation, previewAutomation } from '../modules/automation/index.js';
import { createAutomationChannels } from '../apps/core/discord/automation-channels.js';
import { createAutomationPoliciesHttp } from '../apps/core/http/automation-policies.js';
import { automationRule as rule, automationDocument as document, automationEvent as event, PUBLIC_CHANNEL, SECOND_CHANNEL } from './fixtures/automation.js';
import { GUILD, USER, OTHER } from './fixtures/domain.js';

test('bounded authored policy canonicalizes priority ties and rejects executable or unbounded fields', () => {
  const value = document([rule({id:'z',priority:2}),rule({id:'b'}),rule({id:'a'})]);
  assert.deepEqual(canonicalAutomation(value).rules.map(r => r.id),['a','b','z']); assert.equal(value.rules[0].id,'z');
  for (const invalid of [document([rule({regex:'x'})]),document([rule({channels:[]})]),document([rule(),rule()]),
    document([rule({match:{kind:'regex',text:'(a+)+',caseSensitive:true}})]),document([rule({userCooldownMs:0})]),
    document([rule({action:{kind:'message',text:'x'.repeat(2001)}})]),document(Array.from({length:26},(_,i)=>rule({id:`r${i}`})))])
    assert.throws(()=>canonicalAutomation(invalid));
  assert.equal(canonicalAutomation(document()).rules[0].action.text,rule().action.text);
});
test('Unicode and custom reactions remain bounded data without arbitrary routes', () => {
  for (const emoji of [{id:null,name:'👍'},{id:null,name:'🇵🇱'},{id:null,name:'1️⃣'},{id:'123',name:'approved_help'}])
    assert.deepEqual(canonicalAutomation(document([rule({action:{kind:'reaction',emoji}})])).rules[0].action.emoji,emoji);
  for (const emoji of [{id:null,name:'https://example.test'},{id:null,name:'text'},{id:'123',name:'x/y'},{id:'bad',name:'okay'}])
    assert.throws(()=>canonicalAutomation(document([rule({action:{kind:'reaction',emoji}})])));
});
test('literal matching normalizes Unicode and never executes patterns or template expressions', () => {
  const literal = document([rule({match:{kind:'exact',text:'é.*',caseSensitive:false}})]);
  assert.equal(planAutomation(literal,event({content:'E\u0301.*'}),{excluded:false}).actions.length,1);
  assert.equal(planAutomation(literal,event({content:'éABC'}),{excluded:false}).actions.length,0);
  assert.equal(planAutomation(document([rule({id:'constructor'})]),event(),{excluded:false}).actions.length,1);
});
test('matched stop rules block lower-priority fallback while cooling down', () => {
  const policy = document([rule(),rule({id:'fallback',priority:1,stop:false})]);
  const result = previewAutomation(policy,[event(),event({atMs:2000})],new Set());
  assert.equal(result.results[0].actions.length,1);
  assert.deepEqual(result.results[1].decisions,[{ruleId:'help',state:'cooldown'},{ruleId:'fallback',state:'stopped'}]);
  assert.equal(result.results[1].actions.length,0);
});
test('user cooldown spans channels and channel cooldown spans users with exact boundary admission', () => {
  const result = previewAutomation(document(),[event(),event({atMs:500,userId:OTHER}),event({atMs:1000,channelId:SECOND_CHANNEL}),
    event({atMs:3000,channelId:SECOND_CHANNEL}),event({atMs:4000,userId:OTHER})],new Set());
  assert.deepEqual(result.results.map(r=>r.actions.length),[1,0,0,1,1]);
  assert.equal(JSON.stringify(result).includes('Synthetic HELP question'),false);
});
test('excluded channels, bot, webhook and self messages are suppressed before reading content', () => {
  for (const flags of [{excluded:true},{bot:true},{webhook:true},{self:true}]) {
    const sample = event(); Object.defineProperty(sample,'content',{enumerable:true,get(){throw Error('must not inspect');}});
    for (const key of ['bot','webhook','self']) sample[key] = flags[key] === true;
    assert.deepEqual(planAutomation(document(),sample,{excluded:flags.excluded === true}),{suppressed:true,decisions:[],actions:[]});
  }
});
test('per-message action cap, backwards clocks and invalid timelines fail conservatively', () => {
  const policy = document(Array.from({length:5},(_,i)=>rule({id:`rule${i}`,stop:false})));
  assert.equal(planAutomation(policy,event(),{excluded:false}).actions.length,3);
  assert.equal(planAutomation(document(),event(),{excluded:false,userLast:{help:10}}).actions.length,0);
  assert.throws(()=>previewAutomation(document(),[event({atMs:10}),event({atMs:9})],new Set()));
  assert.throws(()=>previewAutomation(document(),Array.from({length:21},()=>event()),new Set()));
});
test('channel inspection returns only metadata and fails closed for missing or inaccessible channels', async () => {
  const adapter = value => createAutomationChannels({transport:{getChannel:async()=>value}});
  assert.equal(await adapter(null).inspect(PUBLIC_CHANNEL),null);
  assert.deepEqual(await adapter({id:PUBLIC_CHANNEL,guild_id:GUILD,type:0,parent_id:null,topic:'must not return'}).inspect(PUBLIC_CHANNEL),
    {id:PUBLIC_CHANNEL,guildId:GUILD,type:0,parentId:null});
  assert.equal(await createAutomationChannels({transport:{getChannel:async()=>{throw Object.assign(Error(),{code:'DISCORD_AUTHORIZATION_FAILED'});}}}).inspect(PUBLIC_CHANNEL),null);
});
test('HTTP adapter rejects extra inputs and uses fresh principals before and after synthetic previews', async () => {
  const actor = {userId:OTHER,guildId:GUILD}, calls = [];
  const handler = createAutomationPoliciesHttp({auth:{authenticate:async()=>({proof:'proof'}),resolvePrincipal:async()=>calls.push('final')},
    authorization:{resolveActor:async()=>actor},automation:{preview:async input=>{assert.equal(input.actor,actor);calls.push('preview');return {dryRun:true};}}});
  const input = {path:'/api/automation/preview',method:'POST',query:new URLSearchParams(),body:{expectedRevision:0,document:document(),events:[event()],synthetic:true},credentials:{}};
  assert.equal((await handler.execute(input)).actorId,OTHER); assert.deepEqual(calls,['preview','final']);
  await assert.rejects(handler.execute({...input,body:{...input.body,caseId:'123'}}));
});
