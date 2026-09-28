import { runPermissionPolicyApplicationSuite } from './permission-policy-application-suite.mjs';
import { runConfigurationApplicationSuite } from './configuration-application-suite.mjs';
import { runPermissionSealingSuite } from './permission-sealing-suite.mjs';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { createPermissionEditor } from '../../apps/core/storage/permission-editor.js';
import { createPermissionEditorHttp } from '../../apps/core/http/permission-editor.js';
import { createDashboardAuthHttpServer } from '../../apps/core/http/dashboard-auth.js';
import { createCoreAuthorization } from '../../apps/core/security/authorization.js';
import { createActorAuthorityStore } from '../../apps/core/storage/actor-authority.js';
import { migrateCore } from '../../apps/core/storage/migrate.js';
import { createRecoveryBundle, prepareRecoveryBundle, restoreRecoveryBundle } from '../../apps/core/recovery/bundle.js';
import { reviewedRecoveryTools } from '../../apps/core/recovery/local-operations.js';
import { onboardingWorkflow } from '../../tests/fixtures/onboarding-workflow.js';
import { stagingConfiguration } from '../../tests/fixtures/staging.js';
import { dashboardServices } from '../../tests/fixtures/dashboard-auth.js';
import { dashboardHttp } from '../../tests/fixtures/dashboard-http.js';
import { dashboardConfiguration } from '../../tests/fixtures/oauth.js';
import { DASHBOARD_COOKIES } from '../../contracts/dashboard-auth.js';
import { GUILD, USER, OTHER, STAFF } from '../../tests/fixtures/domain.js';
import { BYOND_ROLE } from '../../tests/fixtures/discord.js';
import { createCaseStaffStore } from '../../apps/core/storage/case-staff.js';
import { createCaseDeliveryIssueStore } from '../../apps/core/storage/case-delivery-issues.js';
import { operatorGrant } from '../../contracts/operator-grant.js';
import { createPermissionMaintenance, runtimeDatabaseAvailable, verifyRuntimeWriteGuards } from '../../apps/core/storage/runtime-maintenance.js';
import { waitForGateway } from '../../tests/fixtures/gateway-server.js';
import { createStagingRuntime } from '../../apps/core/runtime/staging.js';
import { createPermissionChannelInventory } from '../../apps/core/discord/permission-channel-inventory.js';
import { createPermissionChannelSealer } from '../../apps/core/discord/permission-channel-sealer.js';
import { caseChannelPayload } from '../../modules/tickets/channel-policy.js';

export async function runPermissionEditorSuite(cluster,run,configurationOnly=false) {
  const scenario=(name,work)=>run(name,async()=>{
    await cluster.adminPool.query('TRUNCATE sophie_core.permission_applications,sophie_core.permission_editor_actions,sophie_core.permission_candidates,sophie_core.permission_drafts');
    const f=await onboardingWorkflow(cluster,{extraCapabilities:{'permissions.publish':[STAFF]}});
    const configuration=stagingConfiguration('a'.repeat(64)); configuration.capabilityPolicy=f.policy;
    const available={roles:f.discord.state.roles.filter(row=>!row.managed).map(row=>({id:row.id,name:'Synthetic role'})),categories:[{id:configuration.casePolicy.categoryId,name:'Synthetic category'}]};
    const services=(changes={})=>createPermissionEditor({pool:f.pool,authorize:f.authorization.authorize,configuration,
      options:{read:async()=>structuredClone(available)},observeActor:id=>f.discord.roles.observeActor(id),clock:()=>f.clock.now,...changes});
    const store=services(); let sequence=0; const id=()=>(++sequence).toString(16).padStart(64,'0');
    async function prepare(change=()=>{}) {
      const actor=await f.actor(OTHER), overview=await store.read({actor}), document=structuredClone(overview.draft?.document??overview.initial); change(document);
      const save=await store.save({actor,requestId:id(),expectedRevision:overview.draft?.revision??0,document}), review=await store.review({actor,revision:save.revision});
      return {actor,requestId:id(),expectedRevision:save.revision,expectedHash:save.sha256,expectedLatestVersion:review.latest?.version??0,expectedLatestStatus:review.latest?.status??'none'};
    }
    async function retainCase({ name='synthetic-review', access='open', state='open', channel='100000000000000091', token='b', type='quick-help' }={}) {
      await f.admin.query(`INSERT INTO sophie_core.case_policies (guild_id,version,policy) VALUES ($1,1,$2) ON CONFLICT DO NOTHING`,[GUILD,configuration.casePolicy]);
      await f.admin.query(`INSERT INTO sophie_core.case_reservations (id,guild_id,user_id,type,state,created_at_ms,channel_id,desired_access)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,[name,GUILD,USER,type,state,f.clock.now,channel,access]);
      await f.admin.query(`INSERT INTO sophie_core.case_provisions (case_id,guild_id,policy_version,operation_token,presence_epoch,create_started,channel_id,phase)
        VALUES ($1,$2,1,$3,0,true,$4,'confirmed')`,[name,GUILD,token.repeat(48),channel]);
      if(channel) await f.admin.query('INSERT INTO sophie_core.case_channels (guild_id,channel_id,case_id) VALUES ($1,$2,$3)',[GUILD,channel,name]);
      return name;
    }
    const inventory=createPermissionChannelInventory({transport:f.discord.transport,clock:()=>f.clock.now});
    const sealer=createPermissionChannelSealer({transport:f.discord.transport,roles:f.discord.roles,mapping:configuration.mapping,clock:()=>f.clock.now});
    const maintenanceServices=(changes={})=>createPermissionMaintenance({pool:f.admin,configuration,channelInventory:inventory,channelSealer:sealer,...changes});
    const maintenance=maintenanceServices();
    async function retainVisibleCase(options={}) {
      const spec={name:'synthetic-review',access:'open',state:'open',channel:'100000000000000091',token:'b',type:'quick-help',...options};
      await retainCase(spec);
      f.discord.state.channels.set(spec.channel,{id:spec.channel,guild_id:GUILD,
        ...caseChannelPayload({id:spec.name,guildId:GUILD,openerId:USER,type:spec.type,policyVersion:1,token:spec.token.repeat(48),presenceEpoch:0},configuration.casePolicy,spec.access)});
      return spec;
    }
    async function maintenanceRequest(change) {
      const request=await prepare(change),candidate=await store.publish(request),review=await store.deploymentReview({actor:request.actor,version:candidate.version});
      return {operationId:id(),version:candidate.version,expectedHash:candidate.sha256,expectedReviewHash:review.reviewHash};
    }
    async function sealRequest() {
      const held=await maintenance.begin(await maintenanceRequest(d=>{d.responders['tech-support']=[BYOND_ROLE];}));
      const inventory=await maintenance.inspectChannels({...held,requestId:id(),expectedRevision:0});
      return {...held,requestId:id(),inventoryRevision:inventory.revision,expectedInventoryHash:inventory.sha256,confirm:true};
    }
    await work({...f,configuration,available,services,editor:store,id,prepare,retainCase,retainVisibleCase,maintenance,maintenanceRequest,inventory,sealer,sealRequest,maintenanceServices});
  });
  if(configurationOnly){await runConfigurationApplicationSuite(cluster,scenario);return;}
  await scenario('PC01 saved review and approval retain mappings author receipts and leave active policies unchanged',async f=>{
    const request=await f.prepare(d=>{d.grants['shuttle.publish']=[BYOND_ROLE];}), before=await f.rows('capability_policies');
    const receipt=await f.editor.publish(request); assert.equal(receipt.version,1); assert.equal((await f.editor.publish(request)).duplicate,true);
    const candidate=await f.editor.publication({actor:request.actor,version:1}); assert.equal(candidate.authorId,OTHER);
    assert.equal(candidate.candidate.capabilityPolicy.version,2); assert.equal(candidate.candidate.casePolicy.version,1);
    assert.deepEqual(candidate.candidate.capabilityPolicy.grants['shuttle.publish'],[BYOND_ROLE]);
    assert.deepEqual(await f.rows('capability_policies'),before); assert.equal((await f.rows('outbox')).length,0);
    assert.equal((await f.editor.history({actor:request.actor,kind:'drafts'})).entries.length,1);
  });
  await scenario('PC02 current permission editor authority cannot be forged and does not confer case access',async f=>{
    const actor=await f.actor(USER); await assert.rejects(f.editor.read({actor}),/OPERATION_DENIED/);
    const request=await f.prepare(); await assert.rejects(f.editor.publish({...request,actor:{...request.actor}}),/OPERATION_DENIED/);
    const policy=structuredClone(f.policy); policy.version++; policy.grants['permissions.publish']=[BYOND_ROLE];
    const auth=createCoreAuthorization({principals:f.identities.verifier,discord:f.discord.roles,policy,clock:()=>f.clock.now,
      authorityStore:createActorAuthorityStore({pool:f.pool,clock:()=>f.clock.now}),isAuthorityCurrent:()=>true,readContinuity:f.discord.roles.readContinuity});
    f.discord.state.members.set(OTHER,[BYOND_ROLE]); const editor=await auth.resolveActor(f.verified(f.payload({member:{user:{id:OTHER}}})));
    assert.equal(await auth.authorize('permissions.publish',editor,{guildId:GUILD}),true);
    for(const type of ['admin-help','head-admin-contact']) assert.equal(await auth.authorize('case.manage',editor,{guildId:GUILD,type}),false);
  });
  await scenario('PC03 empty grants or removal of every currently held editor role cannot pass review or approval',async f=>{
    const actor=await f.actor(OTHER), overview=await f.editor.read({actor}); const document=overview.initial; document.grants['permissions.publish']=[];
    const saved=await f.editor.save({actor,requestId:f.id(),expectedRevision:0,document});
    await assert.rejects(f.editor.review({actor,revision:1}),/PERMISSION_LOCKOUT/);
    await assert.rejects(f.editor.publish({actor,requestId:f.id(),expectedRevision:1,expectedHash:saved.sha256,expectedLatestVersion:0,expectedLatestStatus:'none'}),/PERMISSION_LOCKOUT/);
    assert.equal((await f.rows('permission_candidates')).length,0);
  });
  await scenario('PC04 roles or categories deleted after review block approval and preserve the saved draft',async f=>{
    const request=await f.prepare(); f.available.categories=[];
    await assert.rejects(f.editor.publish(request),/PERMISSION_SELECTION_UNAVAILABLE/);
    f.available.categories=[{id:f.configuration.casePolicy.categoryId,name:'Synthetic category'}]; f.available.roles=f.available.roles.filter(row=>row.id!==STAFF);
    await assert.rejects(f.editor.publish(request),/PERMISSION_SELECTION_UNAVAILABLE/);
    assert.equal((await f.rows('permission_drafts')).length,1); assert.equal((await f.rows('permission_candidates')).length,0);
  });
  await scenario('PC05 stale revisions review hashes and reused request identifiers reject competing changes',async f=>{
    const first=await f.prepare(), second=await f.prepare(d=>{d.grants['answers.publish']=[STAFF];});
    await assert.rejects(f.editor.publish(first),/PERMISSION_STALE/);
    await assert.rejects(f.editor.publish({...second,expectedHash:'f'.repeat(64)}),/PERMISSION_STALE/);
    const competing={...second,requestId:f.id()}, result=await Promise.allSettled([f.editor.publish(second),f.editor.publish(competing)]);
    assert.equal(result.filter(row=>row.status==='fulfilled').length,1); assert.equal(result.find(row=>row.status==='rejected').reason.code,'PERMISSION_STALE');
    const winner=result[0].status==='fulfilled'?second:competing;
    await assert.rejects(f.editor.publish({...winner,expectedLatestVersion:1}),/PERMISSION_REQUEST_COLLISION/);
  });
  await scenario('PC06 revoked roles and late authorization failure roll back draft approval and audit together',async f=>{
    const request=await f.prepare(); let calls=0;
    const store=f.services({authorize:async(...args)=>++calls<2&&await f.authorization.authorize(...args)});
    await assert.rejects(store.publish(request),/OPERATION_DENIED/); assert.equal((await f.rows('permission_candidates')).length,0);
    assert.equal((await f.rows('permission_editor_actions')).length,1);
    f.discord.state.members.set(OTHER,[]); await assert.rejects(f.editor.publish(request),/OPERATION_DENIED/);
  });
  await scenario('PC07 withdrawal is confirmed retained and does not turn a duplicate approval into activation',async f=>{
    const request=await f.prepare(), candidate=await f.editor.publish(request), withdrawal={actor:request.actor,requestId:f.id(),version:1,expectedHash:candidate.sha256,confirm:true};
    await assert.rejects(f.editor.withdraw({...withdrawal,confirm:false}),/PERMISSION_CONFIRMATION_REQUIRED/);
    await f.editor.withdraw(withdrawal); assert.equal((await f.editor.withdraw(withdrawal)).duplicate,true);
    assert.equal((await f.editor.publish(request)).duplicate,true); assert.equal((await f.editor.publication({actor:request.actor,version:1})).status,'withdrawn');
    assert.equal((await f.rows('permission_drafts')).length,1);
  });
  await scenario('PC08 uncertain commit is recovered by exact request after fresh service construction',async f=>{
    const request=await f.prepare(); let lose=true;
    const pool={connect:async()=>{const client=await f.pool.connect();return {release:discard=>client.release(discard),query:async(...args)=>{
      const result=await client.query(...args);if(args[0]==='COMMIT'&&lose){lose=false;throw Error('Synthetic lost commit');}return result;
    }};}};
    await assert.rejects(f.services({pool}).publish(request),/Synthetic lost commit/);
    assert.equal((await f.services().publish(request)).duplicate,true); assert.equal((await f.rows('permission_candidates')).length,1);
  });
  await scenario('PC09 changed deployment base requires rebasing and corrupt stored review data fails closed',async f=>{
    const request=await f.prepare(), configuration=structuredClone(f.configuration); configuration.capabilityPolicy.version++;
    await assert.rejects(f.services({configuration}).review({actor:request.actor,revision:1}),/PERMISSION_BASE_STALE/);
    await f.admin.query("UPDATE sophie_core.permission_drafts SET sha256=repeat('f',64)");
    await assert.rejects(f.editor.review({actor:request.actor,revision:1}),/PERMISSION_RECORD_CORRUPT/);
  });
  await scenario('PC10 authenticated HTTP enforces CSRF closed fields and immediate editor-role loss',async f=>{
    const d=dashboardServices(f), authorization=d.dashboardAuthorization, store=f.services({authorize:authorization.authorize});
    const server=createDashboardAuthHttpServer({configuration:dashboardConfiguration,auth:d.auth,authorization,
      permissions:createPermissionEditorHttp({auth:d.auth,authorization,store}),enabled:()=>true,onFault:()=>assert.fail('Unexpected HTTP fault')});
    const address=await server.listen();
    try {
      const login=await d.login(OTHER), session=await d.auth.authenticate({token:login.token});
      const headers={Cookie:`${DASHBOARD_COOKIES.session}=${login.token}`,Origin:dashboardConfiguration.origin,'X-CSRF-Token':session.csrfToken,'Content-Type':'application/json'};
      const get=path=>dashboardHttp(address,path,{headers});
      assert.equal((await get('/auth/session')).body.canEditPermissions,true);
      const overview=await get('/api/permissions/draft'); assert.equal(overview.status,200);
      const body={requestId:f.id(),expectedRevision:0,document:overview.body.initial};
      const post=(value,extra={})=>dashboardHttp(address,'/api/permissions/save',{method:'POST',headers:{...headers,...extra},body:JSON.stringify(value)});
      assert.equal((await post(body,{'X-CSRF-Token':''})).status,403); assert.equal((await post({...body,actor:{}})).status,400);
      assert.equal((await post(body)).status,200); assert.equal((await get('/api/permissions/review?revision=1&revision=1')).status,400);
      const candidate=await f.editor.publish(await f.prepare());
      const assessment=await get(`/api/permissions/deployment-review?version=${candidate.version}`);
      assert.equal(assessment.status,200);assert.equal(assessment.body.canActivate,false);
      assert.equal((await get('/api/permissions/deployment-review?version=1&version=1')).status,400);
      assert.equal((await get('/api/permissions/deployment-review?version=1&activate=true')).status,400);
      assert.equal((await get(`/api/permissions/deployment-review?version=1&expectedReviewHash=${'f'.repeat(64)}`)).status,409);
      f.discord.state.members.set(OTHER,[]); assert.equal((await get('/api/permissions/draft')).status,403);
      assert.equal((await get('/api/permissions/deployment-review?version=1')).status,403);
    } finally {await server.close();}
  });
  await scenario('PC12 custom per-type responders control queues and recorded authority and cannot inherit Head Admin access',async f=>{
    const request=await f.prepare(d=>{d.responders['tech-support']=[BYOND_ROLE];});await f.editor.publish(request);
    const candidate=(await f.editor.publication({actor:request.actor,version:1})).candidate;
    const makeAuth=policy=>createCoreAuthorization({principals:f.identities.verifier,discord:f.discord.roles,policy,clock:()=>f.clock.now,
      authorityStore:createActorAuthorityStore({pool:f.pool,clock:()=>f.clock.now}),isAuthorityCurrent:()=>true,readContinuity:f.discord.roles.readContinuity});
    const auth=makeAuth(candidate.capabilityPolicy),proof=()=>f.verified(f.payload({member:{user:{id:OTHER}}}));
    f.discord.state.members.set(OTHER,[BYOND_ROLE]);const actor=await auth.resolveActor(proof()),scope={guildId:GUILD,type:'tech-support'};
    assert.equal(await auth.authorizeRecorded('case.manage',actor,scope),true);
    for(const type of ['admin-help','head-admin-contact'])assert.equal(await auth.authorize('case.manage',actor,{...scope,type}),false);
    const staff=createCaseStaffStore({pool:f.pool,clock:()=>f.clock.now,authorize:auth.authorize,policy:candidate.casePolicy});
    assert.equal((await staff.listCases({actor,guildId:GUILD})).entries.length,0);
    const issues=createCaseDeliveryIssueStore({pool:f.pool,clock:()=>f.clock.now,authorize:auth.authorize,policy:candidate.casePolicy});
    assert.equal((await issues.listCaseDeliveryIssues({actor,guildId:GUILD})).entries.length,0);
    f.discord.state.members.set(OTHER,[]);await auth.resolveActor(proof());f.discord.state.members.set(OTHER,[BYOND_ROLE]);
    assert.equal(await auth.authorizeRecorded('case.manage',actor,scope),false);
    const fresh=await auth.resolveActor(proof()),removed=structuredClone(candidate.capabilityPolicy);removed.version++;removed.responders['tech-support']=[STAFF];
    const next=makeAuth(removed);await next.resolveActor(proof());assert.equal(await next.authorizeRecorded('case.manage',fresh,scope),false);
    await assert.rejects(auth.resolveActor(proof()),/CAPABILITY_POLICY_ROLLBACK/);
  });
  await scenario('PC11 migration replay restricted grants and encrypted restore preserve candidates drafts and audit',async f=>{
    const request=await f.prepare(), saved=await f.editor.publish(request);await f.editor.withdraw({actor:request.actor,requestId:f.id(),version:1,expectedHash:saved.sha256,confirm:true});
    assert.deepEqual(await migrateCore(f.admin),{migrations: 63});
    for(const table of ['permission_drafts','permission_candidates','permission_editor_actions']) {
      await assert.rejects(f.pool.query(`DELETE FROM sophie_core.${table}`),error=>error.code==='42501');
      await assert.rejects(f.pool.query(`TRUNCATE sophie_core.${table}`),error=>error.code==='42501');
    }
    const {configuration:database,binaryRoot,directory:parent}=cluster.recovery, tools=await reviewedRecoveryTools(binaryRoot),key=randomBytes(32),maxDatabaseBytes=33554432;
    const backup=await createRecoveryBundle({pool:f.admin,database,tools,configuration:f.configuration,buildId:'a'.repeat(64),vaultRoots:[],parent,key,maxDatabaseBytes});
    const prepared=await prepareRecoveryBundle({directory:backup.directory,parent,key,maxDatabaseBytes,confirmGuildId:GUILD,expectedManifestSha256:backup.manifestSha256});
    const target=await cluster.recovery.createTarget(),restored=await restoreRecoveryBundle({prepared,pool:target.pool,database:target.configuration,tools});
    assert.equal(restored.tableCountsVerified,true);
    for(const table of ['permission_drafts','permission_candidates','permission_editor_actions']) assert.deepEqual((await target.pool.query(`SELECT * FROM sophie_core.${table}`)).rows,await f.rows(table));
    assert.equal((await target.pool.query('SHOW default_transaction_read_only')).rows[0].default_transaction_read_only,'on');
  });
  await scenario('PC13 deployment assessment preserves open closed and legacy sealed access without exposing case identities',async f=>{
    await f.retainCase();
    await f.retainCase({name:'synthetic-closed',access:'closed',state:'closed',channel:'100000000000000092',token:'c',type:'head-admin-contact'});
    await f.retainCase({name:'synthetic-sealed',access:'sealed',state:'failed',channel:'100000000000000093',token:'d'});
    const request=await f.prepare(d=>{d.responders['tech-support']=[BYOND_ROLE];}), before=await f.rows('case_reservations');
    const draft=await f.editor.review({actor:request.actor,revision:request.expectedRevision});
    assert.equal(draft.deployment.casePolicyChanged,true);
    await f.editor.publish(request);
    const result=await f.editor.deploymentReview({actor:request.actor,version:1});
    assert.deepEqual([result.inventory.cases.total,result.inventory.cases.open,result.inventory.cases.closed,result.inventory.cases.sealed],[3,1,1,1]);
    assert.equal(result.inventory.channels,3);assert.deepEqual(result.blockers,[]);assert.equal(result.canActivate,false);
    assert.ok(result.requirements.includes('seal-and-reconcile-retained-channels'));
    assert.notEqual(result.reviewHash,draft.deployment.reviewHash,'A saved draft is not an approved candidate');
    for(const secret of ['synthetic-review','synthetic-closed','synthetic-sealed',USER,'100000000000000091']) assert.equal(JSON.stringify(result).includes(secret),false);
    assert.deepEqual(await f.rows('case_reservations'),before);assert.equal((await f.rows('outbox')).length,0);
    assert.equal((await f.rows('case_policies')).length,1);assert.equal((await f.rows('capability_policies')).length,1);
  });
  await scenario('PC14 equal-count channel replacement and audience changes invalidate exact deployment reviews',async f=>{
    await f.retainCase();const request=await f.prepare();await f.editor.publish(request);
    const args={actor:request.actor,version:1};let review=await f.editor.deploymentReview(args);
    assert.equal((await f.editor.deploymentReview({...args,expectedReviewHash:review.reviewHash})).reviewHash,review.reviewHash);
    await f.admin.query("UPDATE sophie_core.case_channels SET channel_id='100000000000000094'");
    await assert.rejects(f.editor.deploymentReview({...args,expectedReviewHash:review.reviewHash}),/PERMISSION_DEPLOYMENT_REVIEW_STALE/);
    review=await f.editor.deploymentReview(args);assert.ok(review.blockers.includes('channel-selection-unresolved'));
    await f.admin.query('UPDATE sophie_core.case_provisions SET audience_version=audience_version+1');
    await assert.rejects(f.editor.deploymentReview({...args,expectedReviewHash:review.reviewHash}),/PERMISSION_DEPLOYMENT_REVIEW_STALE/);
  });
  await scenario('PC15 uncertain creates duplicates pending invitations and queued effects remain explicit blockers',async f=>{
    const caseId=await f.retainCase({state:'pending'});await f.retainCase({name:'unlocated',channel:null,token:'c'});
    await f.admin.query("INSERT INTO sophie_core.case_channels (guild_id,channel_id,case_id) VALUES ($1,'100000000000000095',$2)",[GUILD,caseId]);
    const request=await f.prepare();await f.editor.publish(request);
    await f.admin.query(`INSERT INTO sophie_core.case_participants (guild_id,case_id,version,user_id,presence_epoch,operator_grant)
      VALUES ($1,$2,1,$3,1,$4)`,[GUILD,caseId,OTHER,operatorGrant(request.actor)]);
    await f.admin.query(`INSERT INTO sophie_core.outbox (guild_id,operation_id,user_id,kind,effect,status)
      VALUES ($1,'synthetic-review-effect',$2,'case.provision',$3,'parked')`,[GUILD,USER,{guildId:GUILD,userId:USER,kind:'case.provision',operationId:'synthetic-review-effect',caseId}]);
    const result=await f.editor.deploymentReview({actor:request.actor,version:1});
    for(const code of ['created-channels-not-located','channel-selection-unresolved','case-transitions-pending','invitations-pending','deliveries-unsettled']) assert.ok(result.blockers.includes(code),code);
    assert.equal(result.inventory.deliveries.parked,1);assert.equal(result.inventory.invitations.pending,1);
    await f.admin.query(`UPDATE sophie_core.case_provisions SET chosen_channel_id='100000000000000091',
      chosen_candidates=ARRAY['100000000000000095','100000000000000091'] WHERE case_id=$1`,[caseId]);
    const selected=await f.editor.deploymentReview({actor:request.actor,version:1});
    assert.equal(selected.blockers.includes('channel-selection-unresolved'),false);assert.equal(selected.canActivate,false);
  });
  await scenario('PC16 withdrawn superseded stale-base deleted-role and revoked-editor candidates cannot be deployment reviewed',async f=>{
    const request=await f.prepare(), first=await f.editor.publish(request),args={actor:request.actor,version:1};
    await f.editor.withdraw({actor:request.actor,requestId:f.id(),version:1,expectedHash:first.sha256,confirm:true});
    await assert.rejects(f.editor.deploymentReview(args),/PERMISSION_STALE/);
    const second=await f.prepare();await f.editor.publish(second);await assert.rejects(f.editor.deploymentReview(args),/PERMISSION_STALE/);
    args.version=2;
    const configuration=structuredClone(f.configuration);configuration.capabilityPolicy.version++;
    await assert.rejects(f.services({configuration}).deploymentReview(args),/PERMISSION_BASE_STALE/);
    f.available.categories=[];await assert.rejects(f.editor.deploymentReview(args),/PERMISSION_SELECTION_UNAVAILABLE/);
    f.discord.state.members.set(OTHER,[]);await assert.rejects(f.editor.deploymentReview(args),/OPERATION_DENIED/);
  });
  await scenario('PC17 authority epochs invalidate reviews while harmless observation refresh does not',async f=>{
    await f.retainCase();const request=await f.prepare();await f.editor.publish(request);const args={actor:request.actor,version:1};
    await f.actor(USER);let review=await f.editor.deploymentReview(args);f.clock.now++;
    assert.equal((await f.editor.deploymentReview({...args,expectedReviewHash:review.reviewHash})).reviewHash,review.reviewHash);
    f.discord.state.members.set(USER,[BYOND_ROLE]);await f.actor(USER);
    await assert.rejects(f.editor.deploymentReview({...args,expectedReviewHash:review.reviewHash}),/PERMISSION_DEPLOYMENT_REVIEW_STALE/);
    review=await f.editor.deploymentReview(args);
    await f.admin.query('UPDATE sophie_core.case_provisions SET presence_epoch=presence_epoch+1');
    await assert.rejects(f.editor.deploymentReview({...args,expectedReviewHash:review.reviewHash}),/PERMISSION_DEPLOYMENT_REVIEW_STALE/);
    let calls=0;const store=f.services({authorize:async(...values)=>++calls<2&&await f.authorization.authorize(...values)});
    await assert.rejects(store.deploymentReview(args),/OPERATION_DENIED/);
  });
  await scenario('PC18 work fences and newer retained policy invalidate preparation without activating either policy',async f=>{
    const caseId=await f.retainCase(),request=await f.prepare();await f.editor.publish(request);const args={actor:request.actor,version:1};
    await f.admin.query(`INSERT INTO sophie_core.outbox (guild_id,operation_id,user_id,kind,effect)
      VALUES ($1,'synthetic-fenced-effect',$2,'case.provision',$3)`,[GUILD,USER,{guildId:GUILD,userId:USER,kind:'case.provision',operationId:'synthetic-fenced-effect',caseId}]);
    let review=await f.editor.deploymentReview(args);
    await f.admin.query('UPDATE sophie_core.outbox SET fence=fence+1');
    await assert.rejects(f.editor.deploymentReview({...args,expectedReviewHash:review.reviewHash}),/PERMISSION_DEPLOYMENT_REVIEW_STALE/);
    review=await f.editor.deploymentReview(args);const policy={...f.configuration.casePolicy,version:2};
    await f.admin.query('INSERT INTO sophie_core.case_policies (guild_id,version,policy) VALUES ($1,2,$2)',[GUILD,policy]);
    await assert.rejects(f.editor.deploymentReview({...args,expectedReviewHash:review.reviewHash}),/PERMISSION_DEPLOYMENT_REVIEW_STALE/);
    assert.ok((await f.editor.deploymentReview(args)).blockers.includes('registered-case-policy-changed'));
    await f.admin.query('UPDATE sophie_core.case_provisions SET policy_version=2');
    assert.ok((await f.editor.deploymentReview(args)).blockers.includes('retained-case-policy-mismatch'));
    assert.equal((await f.rows('capability_policies')).length,1);
  });
  await scenario('PM01 owner-only barrier rejects runtime control access and blocks every retained core table',async f=>{
    const request=await f.maintenanceRequest();
    await assert.rejects(createPermissionMaintenance({pool:f.pool,configuration:f.configuration}).begin(request),e=>e.code==='42501'||e.code==='MAINTENANCE_OWNER_REQUIRED');
    await assert.rejects(f.pool.query('SELECT * FROM sophie_control.runtime_gate'),e=>e.code==='42501');
    const held=await f.maintenance.begin(request);assert.equal(held.phase,'held');assert.equal(await runtimeDatabaseAvailable(f.pool),false);
    const tables=(await f.admin.query("SELECT tablename FROM pg_tables WHERE schemaname='sophie_core'")).rows;
    for(const {tablename} of tables) {
      assert.match(tablename,/^[a-z_]+$/);
      await assert.rejects(f.pool.query(`INSERT INTO sophie_core.${tablename} DEFAULT VALUES`),e=>e.code==='55000'&&e.message==='RUNTIME_MAINTENANCE_ACTIVE');
    }
    await f.admin.query('UPDATE sophie_core.case_reservations SET version=version WHERE false');
    assert.equal((await f.rows('outbox')).length,0);
    await assert.rejects(createStagingRuntime({configuration:f.configuration,pool:f.pool,onFault:()=>{}}),/RUNTIME_MAINTENANCE_ACTIVE/);
    await f.maintenance.cancelPreparation(held);assert.equal(await runtimeDatabaseAvailable(f.pool),true);
    assert.equal((await f.admin.query('SELECT phase FROM sophie_control.maintenance_operations')).rows[0].phase,'cancelled');
  });
  await scenario('PM02 writer barrier drains already-started runtime transactions before persisting a hold',async f=>{
    const request=await f.maintenanceRequest(),client=await f.pool.connect();let pending;
    try {
      await client.query('BEGIN');await client.query('INSERT INTO sophie_core.case_budgets (guild_id) VALUES ($1)',[GUILD]);
      pending=f.maintenance.begin(request);pending.catch(()=>{});
      await waitForGateway(async()=>(await f.admin.query("SELECT EXISTS(SELECT 1 FROM pg_locks WHERE locktype='advisory' AND classid=182745 AND objid=47 AND NOT granted) AS waiting")).rows[0].waiting);
      assert.equal(await runtimeDatabaseAvailable(f.pool),true);
      await client.query('COMMIT');const held=await pending;assert.equal(await runtimeDatabaseAvailable(f.pool),false);
      await f.maintenance.cancelPreparation(held);
    } finally {await client.query('ROLLBACK');client.release();await pending?.catch(()=>{});}
  });
  await scenario('PM03 repeatable-read snapshots cannot reuse availability observed before maintenance',async f=>{
    const request=await f.maintenanceRequest(),client=await f.pool.connect();let held;
    try {
      await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ');assert.equal(await runtimeDatabaseAvailable(client),true);
      held=await f.maintenance.begin(request);
      await assert.rejects(client.query('INSERT INTO sophie_core.case_budgets (guild_id) VALUES ($1)',[GUILD]),e=>e.code==='40001');
    } finally {await client.query('ROLLBACK');client.release();if(held)await f.maintenance.cancelPreparation(held);}
  });
  await scenario('PM04 current leases and stale reviews prevent entry and changed preparation cannot be cancelled',async f=>{
    const request=await f.maintenanceRequest();
    await f.admin.query(`INSERT INTO sophie_core.outbox (guild_id,operation_id,user_id,kind,effect,status,lease_owner,lease_until)
      VALUES ($1,'synthetic-maintenance-lease',$2,'case.provision',$3,'leased','synthetic-worker',clock_timestamp()+interval '30 seconds')`,
    [GUILD,USER,{guildId:GUILD,userId:USER,kind:'case.provision',operationId:'synthetic-maintenance-lease'}]);
    await assert.rejects(f.maintenance.begin(request),/MAINTENANCE_ACTIVE_LEASES/);
    await f.admin.query("UPDATE sophie_core.outbox SET status='done',lease_owner=NULL,lease_until=NULL");
    const held=await f.maintenance.begin(request);
    await f.admin.query("UPDATE sophie_core.outbox SET status='parked'");
    await assert.rejects(f.maintenance.cancelPreparation(held),/PERMISSION_DEPLOYMENT_REVIEW_STALE/);
    assert.equal(await runtimeDatabaseAvailable(f.pool),false);
    await f.admin.query("UPDATE sophie_core.outbox SET status='done'");await f.maintenance.cancelPreparation(held);
    await assert.rejects(f.maintenance.begin({...request,operationId:f.id(),expectedReviewHash:'f'.repeat(64)}),/PERMISSION_DEPLOYMENT_REVIEW_STALE/);
  });
  await scenario('PM05 lost commit and duplicate cancellation retain one generation without reviving a cancelled hold',async f=>{
    const request=await f.maintenanceRequest();let lose=true;
    const pool={connect:async()=>{const client=await f.admin.connect();return {release:discard=>client.release(discard),query:async(...args)=>{
      const result=await client.query(...args);if(args[0]==='COMMIT'&&lose){lose=false;throw Error('Synthetic lost maintenance commit');}return result;
    }};}};
    await assert.rejects(createPermissionMaintenance({pool,configuration:f.configuration}).begin(request),/Synthetic lost maintenance commit/);
    const held=await f.maintenance.begin(request);assert.equal(held.duplicate,true);assert.equal(held.generation,1);
    await assert.rejects(f.maintenance.begin({...request,expectedHash:'f'.repeat(64)}),/MAINTENANCE_REQUEST_COLLISION/);
    await assert.rejects(f.maintenance.begin({...request,operationId:f.id()}),/RUNTIME_MAINTENANCE_ACTIVE/);
    await f.maintenance.cancelPreparation(held);assert.equal((await f.maintenance.cancelPreparation(held)).duplicate,true);
    assert.equal((await f.maintenance.begin(request)).phase,'cancelled');assert.equal(await runtimeDatabaseAvailable(f.pool),true);
    const next=await f.maintenance.begin({...request,operationId:f.id()});assert.equal(next.generation,2);
    await assert.rejects(f.maintenance.cancelPreparation({...held,generation:2}),/MAINTENANCE_STALE/);
    await f.maintenance.cancelPreparation(next);
  });
  await scenario('PM06 missing or disabled table guards fail startup verification even when migration hashes remain valid',async f=>{
    await verifyRuntimeWriteGuards(f.pool);
    await f.admin.query('ALTER TABLE sophie_core.outbox DISABLE TRIGGER runtime_write_guard');
    try {await assert.rejects(verifyRuntimeWriteGuards(f.pool),/RUNTIME_WRITE_GUARDS_INCOMPLETE/);}
    finally {await f.admin.query('ALTER TABLE sophie_core.outbox ENABLE TRIGGER runtime_write_guard');}
  });
  await scenario('PM07 encrypted recovery retains the held barrier and its receipt in an owner-only quarantined restore',async f=>{
    const held=await f.maintenance.begin(await f.maintenanceRequest());
    const {configuration:database,binaryRoot,directory:parent}=cluster.recovery,tools=await reviewedRecoveryTools(binaryRoot),key=randomBytes(32),maxDatabaseBytes=33554432;
    const backup=await createRecoveryBundle({pool:f.admin,database,tools,configuration:f.configuration,buildId:'a'.repeat(64),vaultRoots:[],parent,key,maxDatabaseBytes});
    const prepared=await prepareRecoveryBundle({directory:backup.directory,parent,key,maxDatabaseBytes,confirmGuildId:GUILD,expectedManifestSha256:backup.manifestSha256});
    const target=await cluster.recovery.createTarget();await restoreRecoveryBundle({prepared,pool:target.pool,database:target.configuration,tools});
    assert.equal(await runtimeDatabaseAvailable(target.pool),false);
    for(const table of ['runtime_gate','maintenance_operations']) assert.deepEqual((await target.pool.query(`SELECT * FROM sophie_control.${table}`)).rows,(await f.admin.query(`SELECT * FROM sophie_control.${table}`)).rows);
    assert.equal((await target.pool.query('SHOW default_transaction_read_only')).rows[0].default_transaction_read_only,'on');
    key.fill(0);await f.maintenance.cancelPreparation(held);
  });
  await scenario('PI01 held candidate records open closed and sealed channel metadata without changing Discord or case state',async f=>{
    await f.retainVisibleCase();await f.retainVisibleCase({name:'closed',state:'closed',access:'closed',channel:'100000000000000092',token:'c',type:'head-admin-contact'});
    await f.retainVisibleCase({name:'legacy-sealed',state:'failed',access:'sealed',channel:'100000000000000093',token:'d'});
    const held=await f.maintenance.begin(await f.maintenanceRequest()),before=await f.rows('case_reservations'),callCount=f.discord.state.calls.length;
    const result=await f.maintenance.inspectChannels({...held,requestId:f.id(),expectedRevision:0});
    assert.deepEqual(result.summary,{cases:3,recorded:3,discovered:0,missing:0,mismatched:0,orphaned:0,open:1,closed:1,sealed:1});
    assert.deepEqual(result.blockers,[]);assert.equal(result.canActivate,false);
    assert.equal(f.discord.state.calls.slice(callCount).some(call=>call.method!=='GET'),false);
    assert.deepEqual(await f.rows('case_reservations'),before);assert.equal((await f.rows('outbox')).length,0);
    for(const text of ['synthetic-review','legacy-sealed',USER,'100000000000000091']) assert.equal(JSON.stringify(result).includes(text),false);
    await f.maintenance.cancelPreparation(held);
    assert.equal((await f.maintenance.channelInventory({operationId:held.operationId,revision:1})).sha256,result.sha256);
  });
  await scenario('PI02 late duplicate discovery requires an exact channel choice and orphan markers never become owned cases',async f=>{
    const spec=await f.retainVisibleCase(),first=f.discord.state.channels.get(spec.channel);
    f.discord.state.channels.set('100000000000000094',{...structuredClone(first),id:'100000000000000094'});
    f.discord.state.channels.set('100000000000000095',{...structuredClone(first),id:'100000000000000095',topic:`sophie:case:v1:${'e'.repeat(48)}`});
    const held=await f.maintenance.begin(await f.maintenanceRequest());
    const result=await f.maintenance.inspectChannels({...held,requestId:f.id(),expectedRevision:0});
    assert.equal(result.summary.discovered,1);assert.equal(result.summary.orphaned,1);
    for(const code of ['channel-choice-required','orphan-case-marker'])assert.ok(result.blockers.some(row=>row.code===code));
    const row=(await f.admin.query('SELECT inventory FROM sophie_control.maintenance_inventories')).rows[0].inventory;
    assert.equal(row.cases[0].selectedChannelId,null);assert.equal(row.channels.find(c=>c.classification==='orphan-marker').caseId,null);
    assert.equal((await f.rows('case_channels')).length,1,'Observation must not adopt a discovered channel');
    await f.maintenance.cancelPreparation(held);
  });
  await scenario('PI03 missing mismatched moved and unavailable-selection metadata remain distinguishable',async f=>{
    const first=await f.retainVisibleCase();const second=await f.retainVisibleCase({name:'missing',channel:'100000000000000092',token:'c'});
    const held=await f.maintenance.begin(await f.maintenanceRequest());
    f.discord.state.channels.get(first.channel).parent_id=null;
    f.discord.state.channels.delete(second.channel);
    f.discord.state.roles=f.discord.state.roles.filter(row=>row.id!==STAFF);
    const moved=await f.maintenance.inspectChannels({...held,requestId:f.id(),expectedRevision:0});
    assert.equal(moved.summary.recorded,1);assert.equal(moved.summary.missing,1);assert.equal(moved.summary.mismatched,0);
    for(const code of ['retained-channel-missing','candidate-role-unavailable'])assert.ok(moved.blockers.some(row=>row.code===code));
    f.discord.state.channels.get(first.channel).topic='Untrusted synthetic topic';
    f.discord.state.channels.delete(f.configuration.casePolicy.categoryId);
    const changed=await f.maintenance.inspectChannels({...held,requestId:f.id(),expectedRevision:1});
    assert.equal(changed.summary.mismatched,1);assert.ok(changed.blockers.some(row=>row.code==='candidate-category-unavailable'));
    const serialized=JSON.stringify((await f.admin.query('SELECT inventory FROM sophie_control.maintenance_inventories')).rows);
    assert.equal(serialized.includes('Untrusted synthetic topic'),false);
    await f.maintenance.cancelPreparation(held);
  });
  await scenario('PI04 changed case controls invalidate observations before inventory commit',async f=>{
    await f.retainVisibleCase();const held=await f.maintenance.begin(await f.maintenanceRequest());
    const changed=f.maintenanceServices({channelInventory:{...f.inventory,read:async request=>{
      const proof=await f.inventory.read(request);await f.admin.query('UPDATE sophie_core.case_reservations SET version=version+1');return proof;
    }}});
    await assert.rejects(changed.inspectChannels({...held,requestId:f.id(),expectedRevision:0}),/PERMISSION_DEPLOYMENT_REVIEW_STALE/);
    assert.equal((await f.admin.query('SELECT count(*)::int AS total FROM sophie_control.maintenance_inventories')).rows[0].total,0);
  });
  await scenario('PI08 cancelled holds reject a late observation without retaining an inventory',async f=>{
    await f.retainVisibleCase();const held=await f.maintenance.begin(await f.maintenanceRequest());
    const cancelled=f.maintenanceServices({channelInventory:{...f.inventory,read:async request=>{
      const proof=await f.inventory.read(request);await f.maintenance.cancelPreparation(held);return proof;
    }}});
    await assert.rejects(cancelled.inspectChannels({...held,requestId:f.id(),expectedRevision:0}),/MAINTENANCE_STALE/);
    assert.equal((await f.admin.query('SELECT count(*)::int AS total FROM sophie_control.maintenance_inventories')).rows[0].total,0);
  });
  await scenario('PI05 exact inventory retries survive lost commit and reject request or revision collisions',async f=>{
    await f.retainVisibleCase();const held=await f.maintenance.begin(await f.maintenanceRequest()),request={...held,requestId:f.id(),expectedRevision:0};
    let commits=0;const pool={connect:async()=>{const client=await f.admin.connect();return {release:discard=>client.release(discard),query:async(...args)=>{
      const result=await client.query(...args);if(args[0]==='COMMIT'&&++commits===2)throw Error('Synthetic lost inventory commit');return result;
    }};}};
    await assert.rejects(f.maintenanceServices({pool}).inspectChannels(request),/Synthetic lost inventory commit/);
    const calls=f.discord.state.calls.length,result=await f.maintenance.inspectChannels(request);assert.equal(result.duplicate,true);assert.equal(f.discord.state.calls.length,calls);
    await assert.rejects(f.maintenance.inspectChannels({...request,expectedRevision:1}),/MAINTENANCE_REQUEST_COLLISION/);
    await assert.rejects(f.maintenance.inspectChannels({...request,requestId:f.id()}),/PERMISSION_INVENTORY_STALE/);
    assert.equal((await f.admin.query('SELECT count(*)::int AS total FROM sophie_control.maintenance_inventories')).rows[0].total,1);
    await f.maintenance.cancelPreparation(held);
  });
  await scenario('PI06 unregistered references are inspected and corrupted retained inventory fails closed',async f=>{
    const spec=await f.retainVisibleCase();await f.admin.query('DELETE FROM sophie_core.case_channels');
    f.discord.state.channels.get(spec.channel).topic='Synthetic mismatched marker';
    const held=await f.maintenance.begin(await f.maintenanceRequest()),result=await f.maintenance.inspectChannels({...held,requestId:f.id(),expectedRevision:0});
    assert.equal(result.summary.mismatched,1);assert.ok(result.blockers.some(row=>row.code==='channel-reference-unregistered'));
    await assert.rejects(f.pool.query('SELECT * FROM sophie_control.maintenance_inventories'),e=>e.code==='42501');
    await f.admin.query("UPDATE sophie_control.maintenance_inventories SET sha256=repeat('f',64)");
    await assert.rejects(f.maintenance.channelInventory({operationId:held.operationId,revision:1}),/PERMISSION_RECORD_CORRUPT/);
    await f.maintenance.cancelPreparation(held);
  });
  await scenario('PI07 encrypted recovery preserves channel inventory and observations stay owner-only in quarantine',async f=>{
    await f.retainVisibleCase();const held=await f.maintenance.begin(await f.maintenanceRequest());
    await f.maintenance.inspectChannels({...held,requestId:f.id(),expectedRevision:0});
    const {configuration:database,binaryRoot,directory:parent}=cluster.recovery,tools=await reviewedRecoveryTools(binaryRoot),key=randomBytes(32),maxDatabaseBytes=33554432;
    const backup=await createRecoveryBundle({pool:f.admin,database,tools,configuration:f.configuration,buildId:'a'.repeat(64),vaultRoots:[],parent,key,maxDatabaseBytes});
    const prepared=await prepareRecoveryBundle({directory:backup.directory,parent,key,maxDatabaseBytes,confirmGuildId:GUILD,expectedManifestSha256:backup.manifestSha256});
    const target=await cluster.recovery.createTarget();await restoreRecoveryBundle({prepared,pool:target.pool,database:target.configuration,tools});
    assert.deepEqual((await target.pool.query('SELECT * FROM sophie_control.maintenance_inventories')).rows,(await f.admin.query('SELECT * FROM sophie_control.maintenance_inventories')).rows);
    assert.equal(await runtimeDatabaseAvailable(target.pool),false);key.fill(0);await f.maintenance.cancelPreparation(held);
  });
  await scenario('PI09 exact duplicate-channel choices remain valid only for the observed set',async f=>{
    const spec=await f.retainVisibleCase(),second='100000000000000094';
    f.discord.state.channels.set(second,{...structuredClone(f.discord.state.channels.get(spec.channel)),id:second});
    await f.admin.query('INSERT INTO sophie_core.case_channels (guild_id,channel_id,case_id) VALUES ($1,$2,$3)',[GUILD,second,spec.name]);
    await f.admin.query('UPDATE sophie_core.case_provisions SET chosen_channel_id=$1,chosen_candidates=$2',[second,[second,spec.channel]]);
    const held=await f.maintenance.begin(await f.maintenanceRequest());
    const exact=await f.maintenance.inspectChannels({...held,requestId:f.id(),expectedRevision:0});assert.deepEqual(exact.blockers,[]);
    assert.equal((await f.admin.query('SELECT inventory FROM sophie_control.maintenance_inventories')).rows[0].inventory.cases[0].selectedChannelId,second);
    f.discord.state.channels.delete(spec.channel);
    const missing=await f.maintenance.inspectChannels({...held,requestId:f.id(),expectedRevision:1});
    assert.ok(missing.blockers.some(row=>row.code==='channel-choice-stale'));assert.notEqual(missing.sha256,exact.sha256);
    await f.maintenance.cancelPreparation(held);
  });
  await scenario('PI10 serialized or expired channel proofs cannot be committed as inventory',async f=>{
    await f.retainVisibleCase();const held=await f.maintenance.begin(await f.maintenanceRequest());
    for(const mode of ['copied','expired']) {
      const service=f.maintenanceServices({channelInventory:{...f.inventory,read:async request=>{
        const proof=await f.inventory.read(request);if(mode==='expired')f.clock.now+=5001;return mode==='copied'?{...proof}:proof;
      }}});
      await assert.rejects(service.inspectChannels({...held,requestId:f.id(),expectedRevision:0}),mode==='copied'?/PERMISSION_INVENTORY_UNTRUSTED/:/MEMBERSHIP_STALE/);
    }
    assert.equal((await f.admin.query('SELECT count(*)::int AS total FROM sophie_control.maintenance_inventories')).rows[0].total,0);
    await f.maintenance.cancelPreparation(held);
  });
  await runPermissionSealingSuite(cluster,scenario);
  await runPermissionPolicyApplicationSuite(cluster,scenario);
  await runConfigurationApplicationSuite(cluster,scenario);
  // Only the owned synthetic fixture is reset; sealing has no runtime-release API.
  await cluster.adminPool.query('TRUNCATE sophie_control.configuration_members, sophie_control.runtime_configuration, sophie_control.configuration_applications, sophie_control.maintenance_policy_applications, sophie_control.runtime_gate, sophie_control.maintenance_seal_effects, sophie_control.maintenance_seal_plans, sophie_control.maintenance_inventories, sophie_control.maintenance_operations; INSERT INTO sophie_control.runtime_gate (singleton) VALUES (true)');
}
