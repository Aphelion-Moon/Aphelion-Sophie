import test from 'node:test';
import assert from 'node:assert/strict';
import { createAutomationIngress } from '../apps/core/discord/automation-ingress.js';
import { validateStagingRuntime } from '../apps/core/runtime/configuration.js';
import { stagingConfiguration } from './fixtures/staging.js';
import { GUILD, USER } from './fixtures/domain.js';
import { BOT } from './fixtures/discord.js';
import { PUBLIC_CHANNEL } from './fixtures/automation.js';

const payload = (changes = {}) => ({t:'MESSAGE_CREATE',d:{guild_id:GUILD,id:'901',channel_id:PUBLIC_CHANNEL,type:0,author:{id:USER},content:'Synthetic input',...changes}});
test('ingress filters bots webhooks self foreign system and edited events without reading content',()=>{
  const ingress = createAutomationIngress({guildId:GUILD,botUserId:BOT,clock:()=>0});
  for(const changes of [{author:{id:BOT}},{author:{id:USER,bot:true}},{webhook_id:'123'},{interaction_metadata:{}},{type:1},{guild_id:'999'},{flags:64}]){
    const event = payload(changes); Object.defineProperty(event.d,'content',{get(){throw Error('content inspected');}});
    assert.equal(ingress.prepare(event),null);
  }
  assert.equal(ingress.prepare({...payload(),t:'MESSAGE_UPDATE'}),null);
});
test('opaque ingress proofs expose metadata only and bind source instance lifetime and discard',()=>{
  let now=0;const ingress=createAutomationIngress({guildId:GUILD,botUserId:BOT,clock:()=>now}),event=payload(),proof=ingress.prepare(event);
  assert.deepEqual(proof,{});assert.equal(Object.hasOwn(ingress.inspect(proof),'content'),false);assert.equal(ingress.content(proof),'Synthetic input');
  assert.throws(()=>ingress.inspect({...proof}),/UNTRUSTED_AUTOMATION_EVENT/);
  now=60001;assert.throws(()=>ingress.content(proof),/AUTOMATION_EVENT_EXPIRED/);
  now=0;ingress.discard(proof);assert.throws(()=>ingress.inspect(proof),/UNTRUSTED_AUTOMATION_EVENT/);
});
test('invalid or oversized content never becomes a partial matching string',()=>{
  const ingress=createAutomationIngress({guildId:GUILD,botUserId:BOT,clock:()=>0});
  for(const content of [null,{},'x'.repeat(4001),'\ud800'])assert.equal(ingress.content(ingress.prepare(payload({content}))),null);
});
test('automation ingress activation is a separate optional boolean and does not change capture settings',()=>{
  const configuration=stagingConfiguration('a'.repeat(64));validateStagingRuntime(configuration);
  validateStagingRuntime({...configuration,automationEnabled:false});validateStagingRuntime({...configuration,captureEnabled:false,automationEnabled:true});
  assert.throws(()=>validateStagingRuntime({...configuration,automationEnabled:'yes'}));
});
