import test from 'node:test';
import assert from 'node:assert/strict';
import { createAutomationPoliciesHttp } from '../apps/core/http/automation-policies.js';

test('recovery HTTP routes pass closed inputs and fresh authenticated actors to the shared service',async()=>{
  const calls=[],actor={userId:'123',guildId:'456'},handler=createAutomationPoliciesHttp({
    auth:{authenticate:async args=>{calls.push(args.method);return {proof:'proof'};},resolvePrincipal:async proof=>calls.push(proof)},
    authorization:{resolveActor:async()=>actor},automation:{},
    recovery:{change:async fields=>{assert.equal(fields.actor,actor);calls.push(fields.action);return {recorded:true};},
      list:async fields=>{assert.equal(fields.before,null);return {entries:[]};},detail:async fields=>{assert.equal(fields.before,10);return {events:[]};}}});
  const request={path:'/api/automation/repair',method:'POST',query:new URLSearchParams(),credentials:{},
    body:{deliveryId:'a'.repeat(32),expectedVersion:1,action:'recover',messageId:'789',requestId:'b'.repeat(64),confirmed:true}};
  assert.equal((await handler.execute(request)).recorded,true);assert.deepEqual(calls,['POST','recover','proof']);
  assert.equal((await handler.execute({...request,path:'/api/automation/issues',method:'GET',body:null})).entries.length,0);
  await handler.execute({...request,path:'/api/automation/issue',method:'GET',body:null,query:new URLSearchParams({deliveryId:'a'.repeat(32),before:'10'})});
  await assert.rejects(handler.execute({...request,body:{...request.body,force:true}}),/AUTOMATION_INPUT_INVALID/);
  await assert.rejects(handler.execute({...request,query:new URLSearchParams('channelId=123')}),/AUTOMATION_INPUT_INVALID/);
  await assert.rejects(handler.execute({...request,path:'/api/automation/issues',method:'GET',body:null,query:new URLSearchParams('before=aa&before=bb')}),/AUTOMATION_INPUT_INVALID/);
});
test('recovery responses fail closed when the dashboard session disappears during an operation',async()=>{
  const handler=createAutomationPoliciesHttp({auth:{authenticate:async()=>({proof:{}}),resolvePrincipal:async()=>{throw Error('SESSION_REVOKED');}},
    authorization:{resolveActor:async()=>({})},automation:{},recovery:{list:async()=>({entries:[]})}});
  await assert.rejects(handler.execute({path:'/api/automation/issues',method:'GET',query:new URLSearchParams(),body:null,credentials:{}}),/SESSION_REVOKED/);
});
