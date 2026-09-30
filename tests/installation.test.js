import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { installationHash, installationPaths, loadInstallationConfiguration, verifyInstallationManifest } from '../apps/installation/configuration.js';
import { installationChecks, installationQualification } from '../apps/installation/qualification.js';
import { isPublicAiAddress } from '../apps/knowledge-worker/public-address.js';
import { publicAiLookup } from '../apps/knowledge-worker/http-transport.js';
import { AI_WORKER_ROOTS } from '../apps/knowledge-worker/bootstrap.js';
import { createInstalledCoreService } from '../apps/core/runtime/installed.js';
import { createInstalledCoreLifecycle } from '../apps/core/runtime/installed-lifecycle.js';
import { createInstalledSupervisorService, AI_WORKER_SERVICE } from '../apps/inference-host/installed.js';
import { createServer, connect } from 'node:net';
import { canonicalProcessingPolicy, createProcessingApproval } from '../modules/assistant/processing-policy.js';

test('AI-INST06 processing authority and notice remain public-only, current and separately approved', async () => {
  const policy={schemaVersion:1,provider:'deepseek',domain:'public',approved:true,evidenceHash:hash(),validUntil:NOW+1000,noticeRevision:3,noticeText:'Synthetic processing notice'};
  let qualified=true,now=NOW;
  const approval=createProcessingApproval({policy,qualified:async()=>qualified,clock:()=>now});
  assert.equal(await approval.current(),true);assert.equal((await approval.notice()).revision,3);
  policy.approved=false;assert.equal(await approval.current(),true);
  qualified=false;assert.equal(await approval.current(),false);assert.equal((await approval.notice()).approved,false);
  qualified=true;now+=1000;assert.equal(await approval.current(),false);assert.equal(await approval.evidence(),null);
  assert.throws(()=>canonicalProcessingPolicy({...policy,domain:'staff'}),/AI_PROCESSING_POLICY_INVALID/);
  assert.throws(()=>canonicalProcessingPolicy({...policy,evidenceHash:'0'.repeat(64)}),/AI_PROCESSING_POLICY_INVALID/);
  assert.equal(await createProcessingApproval({qualified:async()=>true}).current(),false);
});

const hash=()=>createHash('sha256').update(randomBytes(32)).digest('hex');
const NOW=1_800_000_000_000;
const files={'runtime/node.exe':'node','runtime/LICENSE':'licence','source/package.json':'{}','source/apps/knowledge-worker/main.mjs':'worker',
  'source/apps/core/installed.mjs':'core','source/apps/inference-host/installed.mjs':'supervisor'};
const manifestText=(entries=files)=>Object.entries(entries).map(([name,body])=>`${installationHash(body)} ${name}`).join('\n')+'\n';

function fixture(role,{changes={},manifest=manifestText(),packageFiles=files}={}) {
  const release={name:'synthetic-release',workerId:hash(),releaseHash:hash(),profileHash:hash(),provider:'deepseek',domain:'public',evidenceHash:hash()};
  const installationId=hash(),expires=NOW+3600000;
  const value={version:1,role,installationId,expires,manifest:installationHash(manifest),release,
    qualification:{installationId,releaseHash:release.releaseHash,profileHash:release.profileHash,expiresAt:expires,checks:{}},
    keys:{core:hash()},...(role==='core'?{core:{runtime:{}}}:{acceptedFingerprints:['synthetic']}),...changes};
  const paths=installationPaths(role),reads=[];
  const read=async path=>{reads.push(path);if(path===paths.configuration)return JSON.stringify(value);if(path===paths.manifest)return manifest;throw Object.assign(Error('missing'),{code:'ENOENT'});};
  const digest=async path=>{
    const name=Object.keys(packageFiles).find(key=>path===`${paths.packageRoot}\\${key.replaceAll('/','\\')}`);
    if(name===undefined)throw Object.assign(Error('missing'),{code:'ENOENT'});
    return {sha256:installationHash(packageFiles[name]),size:packageFiles[name].length};
  };
  return {value,read,reads,digest,paths,load:()=>loadInstallationConfiguration(role,{read,hash:digest,now:NOW})};
}

test('AI-INST01 installed core receives its installation id and core runtime block; the supervisor receives fingerprints only', async () => {
  const core=fixture('core'),loaded=await core.load();
  assert.equal(loaded.configuration.installationId,core.value.installationId);
  assert.deepEqual(loaded.configuration.core,{runtime:{}});
  assert.equal(Object.hasOwn(loaded.configuration,'acceptedFingerprints'),false);
  assert.equal(loaded.owner.role,'core');assert.equal(loaded.owner.installation,core.value.installationId);
  assert.equal(core.paths.configuration,'C:\\Aphelion\\Sophie\\trust\\core.json');
  const supervisor=fixture('supervisor'),other=await supervisor.load();
  assert.deepEqual(other.configuration.acceptedFingerprints,['synthetic']);
  assert.equal(Object.hasOwn(other.configuration,'core'),false);
  assert.throws(()=>installationPaths('worker'),/AI_INSTALLATION_INVALID/);
});

test('AI-INST02 wrong role, expired, over-24-hour or cross-role configuration is rejected', async () => {
  for(const [role,changes] of [
    ['core',{role:'supervisor'}],['core',{expires:NOW}],['core',{expires:NOW+86400001}],['core',{version:2}],
    ['core',{keys:{core:hash(),egress:hash()}}],['core',{keys:{core:'0'.repeat(64)}}],['core',{acceptedFingerprints:['x']}],
    ['supervisor',{core:{}}],['core',{core:null}],['core',{installationId:'short'}],
  ]) await assert.rejects(fixture(role,{changes}).load(),/AI_INSTALLATION_INVALID/,JSON.stringify(changes));
});

test('AI-INST03 the source manifest is bound by hash and every listed file is re-hashed before composition', async () => {
  await assert.rejects(fixture('core',{changes:{manifest:hash()}}).load(),/AI_PACKAGE_CHANGED/);
  await assert.rejects(fixture('core',{packageFiles:{...files,'source/apps/core/installed.mjs':'tampered'}}).load(),/AI_PACKAGE_CHANGED/);
  const {['source/apps/core/installed.mjs']:_omitted,...withoutCore}=files;
  await assert.rejects(fixture('core',{manifest:manifestText(withoutCore),packageFiles:withoutCore}).load(),/AI_MANIFEST_INCOMPLETE/);
  const dotfiles={...files,'source/node_modules/.package-lock.json':'lock'};
  await assert.doesNotReject(fixture('core',{manifest:manifestText(dotfiles),packageFiles:dotfiles}).load());
  for(const text of ['',`${hash()} ../escape.js\n`,`${hash()} source/../escape.js\n`,`${hash()} source/./a.js\n`,`${hash()} other/file.js\n`,`${hash()} source/a.js`,`${hash()} source/a.js\n${hash()} SOURCE/A.js\n`])
    await assert.rejects(verifyInstallationManifest({role:'core',text,packageRoot:'C:\\p',hash:async()=>({sha256:hash(),size:1})}),/AI_MANIFEST_INVALID|AI_PACKAGE_CHANGED/);
});

test('AI-INST04 the qualification receipt must match the configured release, expiry and three OS-account checks', async () => {
  const f=fixture('core'),loaded=await f.load(),{configuration,owner}=loaded;
  const report={...configuration.qualification,checks:Object.fromEntries(installationChecks.map(name=>[name,hash()]))};
  const release={...configuration.release,evidenceHash:installationHash(JSON.stringify(report))};
  const qualified=installationQualification({configuration:{release,qualification:report},owner},new AbortController().signal,()=>NOW);
  assert.equal(await qualified(),true);
  assert.equal(await installationQualification({configuration:{release,qualification:report},owner},new AbortController().signal,()=>report.expiresAt)(),false);
  assert.throws(()=>installationQualification({configuration:{release:{...release,evidenceHash:hash()},qualification:report},owner},new AbortController().signal),/AI_INSTALLATION_UNQUALIFIED/);
});

test('DS04-E01 provider lookups resolve only to public IPv4 addresses', async () => {
  for(const address of ['0.1.2.3','10.0.0.1','100.64.0.1','127.0.0.1','169.254.169.254','172.16.0.1','192.168.0.1','198.18.0.1','224.0.0.1',
    '255.255.255.255','::1','::ffff:127.0.0.1','127.1','2130706433','api.deepseek.com'])
    assert.equal(isPublicAiAddress(address),false,address);
  assert.equal(isPublicAiAddress('93.184.215.14'),true);
  const lookup=answers=>publicAiLookup((hostname,options,callback)=>{assert.equal(hostname,'api.deepseek.com');assert.deepEqual(options,{family:4,all:true});callback(null,answers);});
  const call=(answers,options={})=>new Promise(resolve=>lookup(answers)('api.deepseek.com',options,(error,...result)=>resolve({error,result})));
  assert.deepEqual((await call([{address:'93.184.215.14',family:4}])).result,['93.184.215.14',4]);
  assert.deepEqual((await call([{address:'93.184.215.14',family:4}],{all:true})).result,[[{address:'93.184.215.14',family:4}]]);
  for(const answers of [[],[{address:'127.0.0.1',family:4}],[{address:'93.184.215.14',family:4},{address:'10.0.0.1',family:4}]])
    assert.match((await call(answers)).error?.message??'',/AI_HTTP_UNAVAILABLE/);
});

// A port nothing listens on, so composition never reaches a live supervisor on this host.
const unusedPort=await new Promise(resolve=>{const probe=createServer();probe.listen(0,'127.0.0.1',()=>{const {port}=probe.address();probe.close(()=>resolve(port));});});

async function installedPipes(role) {
  const f=fixture(role),loaded=await f.load(),report={...loaded.configuration.qualification,checks:Object.fromEntries(installationChecks.map(name=>[name,hash()]))};
  const release={...loaded.configuration.release,evidenceHash:installationHash(JSON.stringify(report))};
  // Receipts are verified against the live clock, so this fixture expires an hour from now.
  const expires=Date.now()+3600000;report.expiresAt=expires;release.evidenceHash=installationHash(JSON.stringify(report));
  const lifetime=new AbortController();
  return {lifetime,pipes:{profile:'installed',signal:lifetime.signal,createServer,connect:options=>connect({...options,port:unusedPort}),
    installation:{owner:{...loaded.owner,expires:String(expires)},configuration:{...loaded.configuration,release,qualification:report}}}};
}

test('AI-INST05 installed core and supervisor compose from the loaded configuration shape', async () => {
  const core=await installedPipes('core'),signal=new AbortController().signal;
  const lifecycle=createInstalledCoreLifecycle({pipes:core.pipes,signal,onFault:()=>{}});
  // No supervisor is listening, so the orderly quiesce on stop is refused rather than assumed.
  await assert.rejects(lifecycle.stop(),/AI_CONTROL_UNAVAILABLE/);
  // A complete core block reaches database composition instead of failing on the configuration shape.
  const database=user=>({host:'127.0.0.1',port:5432,database:'sophie_stage_ai',user,password:'synthetic'});
  core.pipes.installation.configuration={...core.pipes.installation.configuration,core:{runtime:{mapping:{guildId:'1'}},database:database('sophie_stage_core'),ownerDatabase:null,
    controlDatabase:database('sophie_stage_control'),knowledgeDatabase:database('sophie_stage_knowledge'),credentials:{token:'synthetic',clientSecret:'synthetic'}}};
  await assert.rejects(createInstalledCoreService({pipes:core.pipes,signal,onFault:()=>{},createPool:()=>{throw Error('POOL_REACHED');}}),/POOL_REACHED/);
  const supervisor=await installedPipes('supervisor'),registrations=[];
  const service=await createInstalledSupervisorService({pipes:supervisor.pipes,signal,onFault:()=>{},createService:({registration})=>{registrations.push(registration);
    return {inspect:async()=>null,create:async()=>({id:AI_WORKER_SERVICE}),start:async()=>{},remove:async()=>({removed:true}),qualified:async()=>true,close:async()=>{}};}});
  assert.equal(registrations[0].serviceName,'aphelion-bot-ai-worker');
  assert.equal(registrations[0].bootRoot,AI_WORKER_ROOTS.boots);assert.equal(AI_WORKER_ROOTS.boots,'C:\\Aphelion\\Sophie\\state\\boots');
  assert.equal(registrations[0].providerDirectory,AI_WORKER_ROOTS.provider);
  await service.stop();supervisor.lifetime.abort();core.lifetime.abort();
});

test('AI-INST07 installed composition carries approved notices, independent preferences and a knowledge-only editor', async () => {
  const core=await installedPipes('core'),signal=new AbortController().signal,closed=[];
  const database=user=>({host:'127.0.0.1',port:5432,database:'sophie_stage_ai',user,password:'synthetic'});
  const options={runtime:{mapping:{guildId:'101'}},database:database('sophie_stage_core'),ownerDatabase:database('sophie_stage_owner'),
    controlDatabase:database('sophie_stage_control'),knowledgeDatabase:database('sophie_stage_knowledge'),knowledgeOwnerDatabase:database('sophie_stage_editor'),
    credentials:{token:'synthetic',clientSecret:'synthetic'},processingPolicy:{schemaVersion:1,provider:'deepseek',domain:'public',approved:true,evidenceHash:hash(),validUntil:Date.now()+3600000,noticeRevision:4,noticeText:'Synthetic notice'},
    preferenceJournal:{id:hash(),evidenceHash:hash(),expiresAt:Number(core.pipes.installation.owner.expires)}};
  core.pipes.installation.configuration={...core.pipes.installation.configuration,core:options};let input;
  const createPool=configuration=>({async query(sql){
    if(sql.includes('restore_name'))return {rows:[{restore_name:false,quarantined:false}]};
    if(sql.includes('rolsuper'))return {rows:[{rolsuper:false,rolcreatedb:false,rolcreaterole:false,rolreplication:false,rolbypassrls:false,core:false,
      ai:configuration.user==='sophie_stage_control',knowledge:configuration.user.includes('knowledge')||configuration.user.includes('editor')}]};
    return {rows:[{schema_create:false,knowledge_write:configuration.user==='sophie_stage_editor'}]};
  },async end(){closed.push(configuration.user);}});
  const service=await createInstalledCoreService({pipes:core.pipes,signal,onFault:()=>{},createPool,
    configurableFactory:async args=>args.runtimeFactory(args),runtimeFactory:async args=>{input=args;return {start:async()=>{},stop:async()=>{},status:()=>({})};}});
  assert.equal(await input.aiApproval.current(),true);assert.equal((await input.aiApproval.notice()).revision,4);
  assert.equal(typeof input.aiPreferenceJournal.advance,'function');assert.ok(input.aiActivationPool);
  const knowledge=input.aiKnowledgeAdminFactory({authorize:async()=>false,invalidate:()=>{}});
  assert.equal(typeof knowledge.editor.publish,'function');await knowledge.stop();
  await service.start();await assert.rejects(service.stop(),/AI_CORE_STOP_UNCONFIRMED/);
  assert.equal(closed.length,5);core.lifetime.abort();
});
