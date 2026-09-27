import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { createAutomationPolicies } from '../../apps/core/storage/automation-policies.js';
import { createAutomationPoliciesHttp } from '../../apps/core/http/automation-policies.js';
import { createDashboardAuthHttpServer } from '../../apps/core/http/dashboard-auth.js';
import { onboardingWorkflow } from '../../tests/fixtures/onboarding-workflow.js';
import { dashboardServices } from '../../tests/fixtures/dashboard-auth.js';
import { dashboardHttp } from '../../tests/fixtures/dashboard-http.js';
import { dashboardConfiguration } from '../../tests/fixtures/oauth.js';
import { DASHBOARD_COOKIES } from '../../contracts/dashboard-auth.js';
import { GUILD, USER, OTHER, STAFF } from '../../tests/fixtures/domain.js';
import { automationRule, automationDocument, automationEvent, automationChannel, PUBLIC_CHANNEL, SECOND_CHANNEL, PROTECTED_CATEGORY } from '../../tests/fixtures/automation.js';
import { migrateCore } from '../../apps/core/storage/migrate.js';
import { createRecoveryBundle, prepareRecoveryBundle, restoreRecoveryBundle } from '../../apps/core/recovery/bundle.js';
import { reviewedRecoveryTools } from '../../apps/core/recovery/local-operations.js';
import { stagingConfiguration } from '../../tests/fixtures/staging.js';

export async function runAutomationPoliciesSuite(cluster,run) {
  const scenario = (name,work) => run(name,async()=>{
    const f = await onboardingWorkflow(cluster,{extraCapabilities:{'automation.publish':[STAFF]}});
    const records = new Map([PUBLIC_CHANNEL,SECOND_CHANNEL].map(id=>[id,automationChannel({id})]));
    const channels = {inspect:async id=>records.get(id) ?? null};
    const services = (options = {}) => createAutomationPolicies({pool:f.pool,authorize:f.authorization.authorize,guildId:GUILD,channels,protectedCategoryId:PROTECTED_CATEGORY,...options});
    const automation = services(); let sequence = 0;
    const fields = (changes = {}) => ({expectedRevision:0,action:'publish',document:automationDocument(),...changes});
    const prepare = async (changes = {}) => {
      const actor = await f.actor(OTHER), request = fields(changes), review = await automation.review({actor,...request});
      return {actor,...request,requestId:(++sequence).toString(16).padStart(64,'0'),reviewSha256:review.reviewSha256,confirmed:true,approvedPublic:true};
    };
    await work({...f,records,channels,services,automation,fields,prepare});
  });
  await scenario('AP01 reviewed publication retains canonical public configuration and one exact receipt without delivery',async f=>{
    const request = await f.prepare(), first = await f.automation.change(request);
    assert.equal(first.revision,1); assert.equal((await f.automation.change(request)).duplicate,true);
    const current = (await f.automation.current({actor:await f.actor(OTHER)})).current;
    assert.deepEqual(current.document,request.document); assert.equal(current.authorId,OTHER);
    assert.equal((await f.rows('automation_policies')).length,1); assert.equal((await f.rows('outbox')).length,0);
    assert.equal((await f.rows('case_reservations')).length,0);
  });
  await scenario('AP02 all policy and preview operations require current explicitly configured publisher authority',async f=>{
    const request = await f.prepare(), member = await f.actor(USER);
    for (const operation of ['current','history']) await assert.rejects(f.automation[operation]({actor:member}),/OPERATION_DENIED/);
    await assert.rejects(f.automation.review({actor:member,...f.fields()}),/OPERATION_DENIED/);
    await assert.rejects(f.automation.change({...request,actor:member}),/OPERATION_DENIED/);
    await assert.rejects(f.automation.preview({actor:member,expectedRevision:0,document:request.document,events:[automationEvent()],synthetic:true}),/OPERATION_DENIED/);
    await assert.rejects(f.automation.current({actor:{...request.actor}}),/OPERATION_DENIED/);
    f.discord.state.members.delete(OTHER); await assert.rejects(f.automation.change(request),/OPERATION_DENIED/);
  });
  await scenario('AP03 source attestation confirmation and canonical review hash bind every mutation',async f=>{
    const request = await f.prepare();
    for (const changes of [{confirmed:false},{approvedPublic:false}]) await assert.rejects(f.automation.change({...request,...changes}),/AUTOMATION_CONFIRMATION_REQUIRED/);
    await assert.rejects(f.automation.change({...request,document:{...request.document,source:'changed'}}),/AUTOMATION_REVIEW_STALE/);
    await assert.rejects(f.automation.review({actor:request.actor,...f.fields({document:{...request.document,caseId:'123'}})}),/AUTOMATION_INPUT_INVALID/);
    assert.equal((await f.rows('automation_policies')).length,0);
  });
  await scenario('AP04 stale drafts reject while exact accepted requests recover through later withdrawal',async f=>{
    const request = await f.prepare(); await f.automation.change(request);
    await assert.rejects(f.automation.review({actor:request.actor,...f.fields()}),/AUTOMATION_STALE/);
    await f.automation.change(await f.prepare({expectedRevision:1,action:'withdraw',document:null}));
    assert.equal((await f.automation.change(request)).duplicate,true);
    assert.equal((await f.automation.current({actor:request.actor})).current.action,'withdraw');
    const changed = await f.prepare({expectedRevision:2});
    await assert.rejects(f.automation.change({...changed,requestId:request.requestId}),/AUTOMATION_REQUEST_COLLISION/);
    assert.equal((await f.rows('automation_policies')).length,2);
  });
  await scenario('AP05 foreign missing thread category and retained closed or moved case channels cannot be published',async f=>{
    const actor = await f.actor(OTHER);
    for (const record of [null,automationChannel({guildId:'999'}),automationChannel({type:11}),automationChannel({type:4}),automationChannel({parentId:PROTECTED_CATEGORY})]) {
      f.records.set(PUBLIC_CHANNEL,record); await assert.rejects(f.automation.review({actor,...f.fields()}),/AUTOMATION_CHANNEL_UNAVAILABLE/);
    }
    f.records.set(PUBLIC_CHANNEL,automationChannel());
    await f.admin.query('INSERT INTO sophie_core.case_exclusions (guild_id,channel_id,parent_id) VALUES ($1,$2,null)',[GUILD,PUBLIC_CHANNEL]);
    await assert.rejects(f.automation.review({actor,...f.fields()}),/AUTOMATION_CHANNEL_UNAVAILABLE/);
    f.records.set('714',automationChannel({id:'714',parentId:SECOND_CHANNEL}));
    await f.admin.query('INSERT INTO sophie_core.case_exclusions (guild_id,channel_id,parent_id) VALUES ($1,$2,null)',[GUILD,SECOND_CHANNEL]);
    await assert.rejects(f.automation.review({actor,...f.fields({document:automationDocument([automationRule({channels:['714']})])})}),/AUTOMATION_CHANNEL_UNAVAILABLE/);
  });
  await scenario('AP06 publication rechecks channel exclusion after review without retaining a partial policy',async f=>{
    const request = await f.prepare();
    await f.admin.query('INSERT INTO sophie_core.case_exclusions (guild_id,channel_id,parent_id) VALUES ($1,$2,null)',[GUILD,PUBLIC_CHANNEL]);
    await assert.rejects(f.automation.change(request),/AUTOMATION_CHANNEL_UNAVAILABLE/);
    assert.equal((await f.rows('automation_policies')).length,0);
  });
  await scenario('AP07 final publisher revocation rolls back configuration and its request receipt',async f=>{
    const request = await f.prepare(); let count = 0;
    const service = f.services({authorize:async(...args)=>{if (++count === 2) f.discord.state.members.set(OTHER,[]);return f.authorization.authorize(...args);}});
    await assert.rejects(service.change(request),/OPERATION_DENIED/); assert.equal(count,2);
    assert.equal((await f.rows('automation_policies')).length,0);
  });
  await scenario('AP08 competing publishers serialize the expected revision and keep one winner',async f=>{
    const first = await f.prepare(), second = await f.prepare({document:automationDocument([automationRule({id:'different'})])});
    const results = await Promise.allSettled([f.automation.change(first),f.automation.change(second)]);
    assert.equal(results.filter(r=>r.status === 'fulfilled').length,1);
    assert.equal(results.find(r=>r.status === 'rejected').reason.code,'AUTOMATION_STALE');
    assert.equal((await f.rows('automation_policies')).length,1);
  });
  await scenario('AP09 dry runs apply current exclusions cooldowns and suppression without retaining sample content or jobs',async f=>{
    const actor = await f.actor(OTHER), hidden = '713', sentinel = 'SYNTHETIC_PREVIEW_SENTINEL help';
    f.records.set(hidden,automationChannel({id:hidden}));
    await f.admin.query('INSERT INTO sophie_core.case_exclusions (guild_id,channel_id,parent_id) VALUES ($1,$2,null)',[GUILD,hidden]);
    const request = {actor,expectedRevision:0,document:automationDocument(),synthetic:true,
      events:[automationEvent({content:sentinel}),automationEvent({atMs:500}),automationEvent({atMs:3000,channelId:hidden}),automationEvent({atMs:4000,bot:true}),automationEvent({atMs:5000})]};
    const preview = await f.automation.preview(request);
    assert.deepEqual(preview.results.map(r=>r.actions.length),[1,0,0,0,1]); assert.equal(preview.results[2].suppressed,true);
    assert.equal(preview.mentions,'none'); assert.equal(preview.deliveryEnabled,false); assert.equal(preview.sampleRetained,false);
    assert.equal(JSON.stringify(preview).includes(sentinel),false);
    await assert.rejects(f.automation.preview({...request,synthetic:false}),/AUTOMATION_PREVIEW_INVALID/);
    assert.equal((await f.rows('automation_policies')).length,0); assert.equal((await f.rows('outbox')).length,0);
  });
  await scenario('AP10 retained history pages exact publication withdrawal revisions and preserves authored text',async f=>{
    for (let revision = 0; revision < 12; revision++) await f.automation.change(await f.prepare({expectedRevision:revision}));
    const actor = await f.actor(OTHER), first = await f.automation.history({actor}), second = await f.automation.history({actor,before:first.nextBefore});
    assert.deepEqual(first.entries.map(row=>row.revision),[12,11,10,9,8,7,6,5,4,3]); assert.deepEqual(second.entries.map(row=>row.revision),[2,1]);
    assert.equal(second.nextBefore,null); assert.equal(first.entries[0].document.rules[0].action.text,automationRule().action.text);
  });
  await scenario('AP11 corrupt retained configuration cannot authorize current history or duplicate receipts',async f=>{
    const request = await f.prepare(); await f.automation.change(request);
    await f.admin.query("UPDATE sophie_core.automation_policies SET document_sha256 = repeat('f',64)");
    for (const method of ['current','history']) await assert.rejects(f.automation[method]({actor:request.actor}),/AUTOMATION_CORRUPT/);
    await assert.rejects(f.automation.change(request),/AUTOMATION_CORRUPT/);
  });
  await scenario('AP12 authenticated APIs enforce CSRF closed inputs preview attestation and publisher revocation',async f=>{
    const d = dashboardServices(f), authorization = d.dashboardAuthorization, faults = [], automation = f.services({authorize:authorization.authorize});
    const server = createDashboardAuthHttpServer({configuration:dashboardConfiguration,auth:d.auth,authorization,
      automation:createAutomationPoliciesHttp({auth:d.auth,authorization,automation}),enabled:()=>true,onFault:value=>faults.push(value)});
    const address = await server.listen();
    try {
      const login = await d.login(OTHER), session = await d.auth.authenticate({token:login.token}),
        headers = {Cookie:`${DASHBOARD_COOKIES.session}=${login.token}`,Origin:dashboardConfiguration.origin,'X-CSRF-Token':session.csrfToken,'Content-Type':'application/json'};
      const post = (path,body,extra = {}) => dashboardHttp(address,`/api/automation/${path}`,{method:'POST',headers:{...headers,...extra},body:JSON.stringify(body)});
      assert.equal((await post('review',f.fields(),{'X-CSRF-Token':''})).status,403);
      const review = await post('review',f.fields()); assert.equal(review.status,200);
      const request = {...f.fields(),requestId:'a'.repeat(64),reviewSha256:review.body.reviewSha256,confirmed:true,approvedPublic:true};
      assert.equal((await post('change',{...request,caseId:'123'})).status,400);
      assert.equal((await post('change',request)).status,200); assert.equal((await post('change',request)).body.duplicate,true);
      const preview = await post('preview',{expectedRevision:1,document:request.document,events:[automationEvent()],synthetic:true});
      assert.equal(preview.status,200); assert.equal(preview.body.dryRun,true); assert.equal(preview.headers['cache-control'],'no-store');
      assert.equal((await post('review',f.fields())).status,409);
      f.discord.state.members.set(OTHER,[]);
      assert.equal((await dashboardHttp(address,'/api/automation',{headers})).status,403); assert.deepEqual(faults,[]);
    } finally {await server.close();}
  });
  await scenario('AP13 migration replay preserves policy records and restricted runtime cannot delete retained history',async f=>{
    await f.automation.change(await f.prepare()); const before = await f.rows('automation_policies');
    assert.deepEqual(await migrateCore(f.admin),{migrations: 58}); assert.deepEqual(await f.rows('automation_policies'),before);
    await assert.rejects(f.pool.query('DELETE FROM sophie_core.automation_policies'),error=>error.code === '42501');
    await assert.rejects(f.pool.query('TRUNCATE sophie_core.automation_policies'),error=>error.code === '42501');
  });
  await scenario('AP14 encrypted restore retains rule configuration withdrawal history and exact author receipts',async f=>{
    await f.automation.change(await f.prepare()); await f.automation.change(await f.prepare({expectedRevision:1,action:'withdraw',document:null}));
    const configuration = stagingConfiguration('a'.repeat(64)); configuration.capabilityPolicy = f.policy;
    const {configuration:database,binaryRoot,directory:parent} = cluster.recovery, tools = await reviewedRecoveryTools(binaryRoot),key = randomBytes(32),maxDatabaseBytes = 33554432;
    const backup = await createRecoveryBundle({pool:f.admin,database,tools,configuration,buildId:'a'.repeat(64),vaultRoots:[],parent,key,maxDatabaseBytes});
    const prepared = await prepareRecoveryBundle({directory:backup.directory,parent,key,maxDatabaseBytes,confirmGuildId:GUILD,expectedManifestSha256:backup.manifestSha256});
    const target = await cluster.recovery.createTarget(), restored = await restoreRecoveryBundle({prepared,pool:target.pool,database:target.configuration,tools});
    assert.equal(restored.tableCountsVerified,true);
    assert.deepEqual((await target.pool.query('SELECT * FROM sophie_core.automation_policies ORDER BY revision')).rows,await f.rows('automation_policies'));
    assert.equal((await target.pool.query('SHOW default_transaction_read_only')).rows[0].default_transaction_read_only,'on');
  });
  await scenario('AP15 a lost commit response recovers the original receipt after a later withdrawal',async f=>{
    const request = await f.prepare(); let lose = true;
    const pool = {connect:async()=>{const client = await f.pool.connect();return {release:discard=>client.release(discard),query:async(...args)=>{
      const result = await client.query(...args); if (args[0] === 'COMMIT' && lose) {lose = false;throw Error('Synthetic lost commit');} return result;
    }};}};
    await assert.rejects(f.services({pool}).change(request),/Synthetic lost commit/);
    await f.automation.change(await f.prepare({expectedRevision:1,action:'withdraw',document:null}));
    assert.equal((await f.services().change(request)).duplicate,true); assert.equal((await f.rows('automation_policies')).length,2);
  });
}
