import test from 'node:test';
import assert from 'node:assert/strict';
import { initialPermissions, canonicalPermissions, permissionCandidate } from '../apps/core/runtime/permission-configuration.js';
import { requireCaseAccess } from '../modules/tickets/index.js';
import { caseChannelPayload, CASE_CLOSED_WRITE_BITS } from '../modules/tickets/channel-policy.js';
import { createPermissionOptions } from '../apps/core/discord/permission-options.js';
import { validateStagingRuntime } from '../apps/core/runtime/configuration.js';
import { stagingConfiguration } from './fixtures/staging.js';
import { casePlan, simulatedCases } from './fixtures/cases.js';
import { GUILD, USER, OTHER, STAFF, LEAD, NOW } from './fixtures/domain.js';
import { MUZZLED, CREW, BYOND_ROLE } from './fixtures/discord.js';

const configuration = stagingConfiguration('a'.repeat(64));
test('T04/T21 reviewed permission contracts preserve owned roles and reject arbitrary configuration', () => {
  const draft = initialPermissions(configuration), result = permissionCandidate(canonicalPermissions(draft,configuration),configuration);
  assert.deepEqual(result.mapping,configuration.mapping); assert.equal(result.capabilityPolicy.version,2); assert.equal(result.casePolicy.version,1);
  for (const change of [{ token:'secret' },{ staff:CREW },{ leadOps:STAFF }]) assert.throws(()=>canonicalPermissions({...draft,...change},configuration));
  assert.throws(()=>canonicalPermissions({...draft,grants:{...draft.grants,'permissions.publish':[MUZZLED]}},configuration));
});
test('T04/T21 responder configuration preserves Head Admin privacy, bounds and runtime parity', () => {
  const draft = initialPermissions(configuration);
  for (const ids of [[STAFF],[LEAD,STAFF],[],Array(21).fill(LEAD)]) {
    assert.throws(()=>canonicalPermissions({...draft,responders:{...draft.responders,'head-admin-contact':ids}},configuration));
  }
  draft.responders['tech-support']=['701']; const candidate=permissionCandidate(canonicalPermissions(draft,configuration),configuration);
  assert.equal(candidate.casePolicy.version,2); validateStagingRuntime({...configuration,...candidate});
  assert.throws(()=>validateStagingRuntime({...configuration,casePolicy:candidate.casePolicy}),/RUNTIME_MAPPING_MISMATCH/);
});
test('retained JSON object order does not create a new case-policy version', () => {
  const draft=initialPermissions(configuration), expected=permissionCandidate(draft,configuration);
  draft.responders=Object.fromEntries(Object.entries(draft.responders).reverse());
  assert.deepEqual(permissionCandidate(draft,configuration),expected);
});
test('T04/T36 custom responders agree in application access and open or closed Discord role overwrites', () => {
  const draft=initialPermissions(configuration); draft.responders['tech-support']=['701'];
  const {casePolicy,capabilityPolicy}=permissionCandidate(canonicalPermissions(draft,configuration),configuration);
  const roles={staff:STAFF,leadOps:LEAD,responders:capabilityPolicy.responders};
  const request={actor:{guildId:GUILD,userId:OTHER,known:true,observedAt:NOW,present:true,roleIds:['701']},
    caseRecord:{guildId:GUILD,type:'tech-support',openerId:USER,participantIds:[]},roles,operation:'manage',now:NOW};
  assert.doesNotThrow(()=>requireCaseAccess(request));
  assert.throws(()=>requireCaseAccess({...request,caseRecord:{...request.caseRecord,type:'head-admin-contact'}}),/CASE_ACCESS_DENIED/);
  assert.throws(()=>requireCaseAccess({...request,actor:{...request.actor,roleIds:[STAFF,LEAD]}}),/CASE_ACCESS_DENIED/);
  for (const mode of ['open','closed']) {
    const payload=caseChannelPayload({...casePlan,type:'tech-support',policyVersion:casePolicy.version},casePolicy,mode);
    assert.deepEqual(payload.permission_overwrites.filter(row=>row.type===0).map(row=>row.id),[GUILD,'701']);
    if(mode==='closed') assert.equal(BigInt(payload.permission_overwrites.find(row=>row.id==='701').deny)&CASE_CLOSED_WRITE_BITS,CASE_CLOSED_WRITE_BITS);
  }
  assert.equal(caseChannelPayload({...casePlan,type:'tech-support',policyVersion:casePolicy.version},casePolicy,'sealed').permission_overwrites.length,2);
});
test('T04 permission picker returns only role/category names and IDs', async () => {
  const options=createPermissionOptions({transport:{getRoles:async()=>[{id:'1',name:'Synthetic <img>',managed:false,permissions:'8'},{id:'2',name:'Managed',managed:true}],
    getGuildChannels:async()=>[{id:'3',name:'Synthetic category',type:4,topic:'must not be returned'}, {id:'4',name:'Synthetic case',type:0}]}});
  assert.deepEqual(await options.read(),{roles:[{id:'1',name:'Synthetic <img>'}],categories:[{id:'3',name:'Synthetic category'}]});
});
test('T21 current custom responder role existence is checked before any channel write', async () => {
  const draft=initialPermissions(configuration);draft.responders['tech-support']=[BYOND_ROLE];
  const {casePolicy}=permissionCandidate(canonicalPermissions(draft,configuration),configuration),plan={...casePlan,type:'tech-support',policyVersion:2};
  const discord=simulatedCases({policy:casePolicy});
  const preparation=await discord.channels.prepare(plan),proof=await discord.channels.create(preparation,plan);
  await discord.channels.verification.channel(proof,plan,true);
  const writes=discord.state.calls.filter(call=>call.method!=='GET').length;
  discord.state.roles=discord.state.roles.filter(row=>row.id!==BYOND_ROLE);
  // The synthetic member has this unrelated role; remove it too so the missing configured responder is the failure.
  for(const [id,roles] of discord.state.members)discord.state.members.set(id,roles.filter(role=>role!==BYOND_ROLE));
  await assert.rejects(discord.channels.prepare(plan),/CASE_CONFIGURATION_INVALID/);
  assert.equal(discord.state.calls.filter(call=>call.method!=='GET').length,writes);
});
