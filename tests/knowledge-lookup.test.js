import test from 'node:test';
import assert from 'node:assert/strict';
import { syntheticInteractions,APPLICATION } from './fixtures/interactions.js';
import { GUILD,NOW } from './fixtures/domain.js';
import { createKnowledgeLookupCommands } from '../apps/core/discord/knowledge-lookup.js';
import { createAdministrationCommands } from '../apps/core/discord/onboarding-commands.js';
import { createInteractionResponder } from '../apps/core/discord/interaction-response.js';
import { knowledgeLookupReply } from '../modules/assistant/lookup.js';

const source={id:'guide.r1.s0',title:'Public guide',heading:'Topic',text:'Exact source @everyone <@123>',url:'https://example.test/guide',
  rights:'Synthetic permission',attribution:'Synthetic author',sourceRevision:'1',authority:'policy',validUntil:null,publicationHash:'a'.repeat(64),epoch:1};
function fixture() {
  const f=syntheticInteractions(),state={allowed:true,channel:true,current:true,lookups:0,sent:[]};
  const packet=query=>f.payload({data:{name:'lookup',type:1,options:[{type:3,name:'query',value:query}]}});
  const envelope=query=>f.verifier.verify(f.signed(packet(query)));
  const commands=createKnowledgeLookupCommands({verifier:f.verifier,guildId:GUILD,clock:()=>NOW,enabled:async()=>true,
    authorization:{resolveActor:async proof=>f.verifier.resolvePrincipal(proof),authorize:async()=>state.allowed},
    inspectChannel:async()=>state.channel ? {}:null,knowledge:{lookup:async query=>{state.lookups++;assert.equal(query,'topic');return [source];},current:async()=>state.current}});
  const responder=createInteractionResponder({verifier:f.verifier,applicationId:APPLICATION,clock:()=>NOW,enabled:async()=>true,knowledgeLookup:commands,
    fetch:async(_url,options)=>{state.sent.push(JSON.parse(options.body));return new Response(null,{status:200});}});
  return {...f,state,packet,envelope,commands,responder};
}
test('DS07-L01 signed lookup text is bounded, one-use and absent from routing metadata',()=>{
  const f=fixture(),envelope=f.envelope('topic');assert.equal(envelope.command,'knowledge.lookup');assert.equal(JSON.stringify(envelope).includes('topic'),false);
  assert.equal(f.verifier.takeLookupQuery(envelope),'topic');assert.throws(()=>f.verifier.takeLookupQuery(envelope),/UNTRUSTED_LOOKUP/);
  for(const value of ['',null,'x'.repeat(201),'two\nlines'])assert.throws(()=>f.envelope(value));
  for(const edit of [options=>options.push(options[0]),options=>{options[0].name='url';},options=>{options[0].type=6;},options=>{options[0].options=[];}]){
    const payload=f.packet('topic');edit(payload.data.options);assert.throws(()=>f.verifier.verify(f.signed(payload)));
  }
});
test('DS07-L02 lookup uses current membership and channel exclusions before consuming text, without inference',async()=>{
  const f=fixture(),router=createAdministrationCommands({knowledgeLookup:f.commands});
  f.state.channel=false;const excluded=f.envelope('topic');assert.equal(await router.execute(excluded),'denied');assert.equal((await f.commands.view(excluded)).status,'denied');
  assert.equal(f.state.lookups,0);assert.equal(f.verifier.takeLookupQuery(excluded),'topic');
  f.state.channel=true;f.state.allowed=false;assert.equal(await router.execute(f.envelope('topic')),'denied');assert.equal(f.state.lookups,0);
  f.state.allowed=true;const envelope=f.envelope('topic');assert.equal(await router.execute(envelope),'knowledge_lookup');assert.equal(f.state.lookups,0);
  await f.responder.respond(envelope,'knowledge_lookup');assert.equal(f.state.lookups,1);assert.equal(f.state.sent[0].embeds[0].description,source.text);
  assert.deepEqual(f.state.sent[0].allowed_mentions.parse,[]);assert.equal(JSON.stringify(f.state.sent[0]).includes(source.publicationHash),false);
  assert.equal(await createAdministrationCommands({}).execute(f.envelope('topic')),'denied');
});
test('DS07-L03 stale sources or later channel/authority loss cannot be delivered',async()=>{
  const f=fixture();f.state.current=false;assert.equal((await f.commands.view(f.envelope('topic'))).status,'unavailable');
  f.state.current=true;const view=await f.commands.view(f.envelope('topic'));f.state.channel=false;await assert.rejects(f.commands.current(view),/OPERATION_DENIED/);
  f.state.channel=true;f.state.current=false;await assert.rejects(f.commands.current(view),/KNOWLEDGE_SOURCE_STALE/);
  assert.equal(f.state.sent.length,0);
});
test('DS07-L04 maximum source text remains exact within one Discord embed and extra matches are disclosed',()=>{
  const full={...source,title:'t'.repeat(200),heading:'h'.repeat(160),text:'x'.repeat(4000),rights:'r'.repeat(300),attribution:'a'.repeat(500),sourceRevision:'v'.repeat(160)};
  const rendered=knowledgeLookupReply({status:'available',sources:[full,source]}),embed=rendered.embeds[0];
  assert.equal(embed.description,full.text);assert.match(rendered.content,/first of 2 matches/);
  assert.ok(embed.title.length+embed.description.length+embed.footer.text.length+embed.fields[0].name.length+embed.fields[0].value.length<=6000);
  assert.match(knowledgeLookupReply({status:'available',sources:[]}).content,/No current reviewed/);
  assert.throws(()=>knowledgeLookupReply({status:'available',sources:[{...source,url:'https://user:password@example.test/'}]}));
});
