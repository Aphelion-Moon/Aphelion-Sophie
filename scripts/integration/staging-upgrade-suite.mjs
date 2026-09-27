import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { createHash, randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import { createRecoveryBundle, prepareRecoveryBundle, restoreRecoveryBundle } from '../../apps/core/recovery/bundle.js';
import { reviewedRecoveryTools } from '../../apps/core/recovery/local-operations.js';
import { migrateCore, verifyCoreMigrations, verifyStaging032Migrations } from '../../apps/core/storage/migrate.js';
import { checkRuntimeDatabase } from '../../apps/core/runtime/database.js';
import { requireUnquarantinedDatabase } from '../../apps/core/runtime/recovery.js';
import { attachmentWorkflow, syntheticFileBytes } from '../../tests/fixtures/case-attachments.js';
import { stagingConfiguration } from '../../tests/fixtures/staging.js';
import { GUILD } from '../../tests/fixtures/domain.js';
import { dashboardConfiguration } from '../../tests/fixtures/oauth.js';

/** Exact immutable historical DDL, synthetic retained data only. No existing database or credentials. */
export async function runStagingUpgradeSuite(cluster, run) {
  const f=await attachmentWorkflow(cluster);await f.addFile();assert.equal((await f.attachmentWorker.runOnce('upgrade-file')).status,'retained');
  const source=await cluster.recovery.createHistoricalSource(),pool=source.pool;
  const directory=resolve('apps/core/storage/migrations'),files=(await readdir(directory)).filter(name=>/^0\d\d-.*\.sql$/.test(name)).sort().slice(0,32);
  await pool.query('CREATE SCHEMA sophie_migrations; REVOKE ALL ON SCHEMA sophie_migrations FROM PUBLIC; CREATE TABLE sophie_migrations.applied (id text PRIMARY KEY, sha256 text NOT NULL)');
  for(const id of files){const sql=await readFile(resolve(directory,id),'utf8');await pool.query(sql);await pool.query('INSERT INTO sophie_migrations.applied VALUES ($1,$2)',[id,createHash('sha256').update(sql).digest('hex')]);}
  // Migration 002 seeds this singleton. Replace only its synthetic initial value before copying the fixture.
  await pool.query('DELETE FROM sophie_core.discord_backoff');
  // Project current synthetic rows onto the old columns, with every historical FK/check still enforced.
  const tables=(await pool.query("SELECT tablename FROM pg_tables WHERE schemaname='sophie_core' ORDER BY tablename")).rows.map(r=>r.tablename);
  const dependencies=(await pool.query("SELECT c.relname AS child,p.relname AS parent FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid JOIN pg_class p ON p.oid=k.confrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE k.contype='f' AND n.nspname='sophie_core'")).rows;
  const pending=new Set(tables),before=new Map(),columns=new Map(),retainedJobs=[],sorted=rows=>[...rows].sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)));
  while(pending.size){const table=[...pending].find(t=>dependencies.filter(d=>d.child===t&&d.parent!==t&&!(t==='case_attachment_jobs'&&d.parent==='case_attachment_attempts')).every(d=>!pending.has(d.parent)));assert.ok(table,'Historical fixture has no other FK cycle');
    assert.match(table,/^[a-z_]+$/);const names=(await pool.query("SELECT column_name FROM information_schema.columns WHERE table_schema='sophie_core' AND table_name=$1 ORDER BY ordinal_position",[table])).rows.map(r=>r.column_name);
    columns.set(table,names.join(','));const rows=(await f.admin.query(`SELECT to_jsonb(projected) AS value FROM (SELECT ${names.join(',')} FROM sophie_core.${table}) projected`)).rows;
    for(const {value} of rows){
      // The real attachment transition creates job, then attempt, then retained reference; preserve that FK order.
      if(table==='case_attachment_jobs'&&value.status==='retained'){retainedJobs.push(value);await pool.query(`INSERT INTO sophie_core.${table} SELECT * FROM jsonb_populate_record(NULL::sophie_core.${table},$1)`,[JSON.stringify({...value,status:'pending',retained_slot:null,retained_sha256:null,retained_bytes:null,retained_at:null})]);}
      else await pool.query(`INSERT INTO sophie_core.${table} SELECT * FROM jsonb_populate_record(NULL::sophie_core.${table},$1)`,[JSON.stringify(value)]);
    }
    before.set(table,(await pool.query(`SELECT ${names.join(',')} FROM sophie_core.${table}`)).rows);pending.delete(table);
  }
  for(const value of retainedJobs)await pool.query("UPDATE sophie_core.case_attachment_jobs SET status='retained',retained_slot=$2,retained_sha256=$3,retained_bytes=$4,retained_at=$5 WHERE token=$1",[value.token,value.retained_slot,value.retained_sha256,value.retained_bytes,value.retained_at]);
  before.set('case_attachment_jobs',(await pool.query('SELECT * FROM sophie_core.case_attachment_jobs')).rows);
  const {binaryRoot,directory:parent}=cluster.recovery,tools=await reviewedRecoveryTools(binaryRoot),key=randomBytes(32),maxDatabaseBytes=33554432;
  const options={pool,database:source.configuration,tools,configuration:stagingConfiguration('a'.repeat(64)),buildId:'a'.repeat(64),vaultRoots:[f.vaultRoot],parent,key,maxDatabaseBytes};
  let backup;
  await run('SU01 exact schema 032 preservation requires explicit mode and retains no invented control watermark',async()=>{
    assert.deepEqual(await verifyStaging032Migrations(pool),{migrations:32});await assert.rejects(verifyCoreMigrations(pool),/DATABASE_MIGRATIONS_INCOMPLETE/);
    await assert.rejects(createRecoveryBundle(options),/DATABASE_MIGRATIONS_INCOMPLETE/);
    backup=await createRecoveryBundle({...options,preserveStaging032:true});assert.equal(backup.artifacts,1);assert.equal(backup.independentRecoveryVerified,false);assert.equal(backup.controlHistoryAvailable,false);
    await assert.rejects(createRecoveryBundle({...options,pool:cluster.adminPool,database:cluster.recovery.configuration,preserveStaging032:true}),/DATABASE_MIGRATIONS_INCOMPLETE/);
  });
  await run('SU02 historical checksum drift is rejected before a completed preservation bundle exists',async()=>{
    const id=files[0],prior=(await pool.query('SELECT sha256 FROM sophie_migrations.applied WHERE id=$1',[id])).rows[0].sha256;
    await pool.query('UPDATE sophie_migrations.applied SET sha256=$2 WHERE id=$1',[id,'f'.repeat(64)]);
    try{await assert.rejects(createRecoveryBundle({...options,preserveStaging032:true}),/MIGRATION_CHECKSUM_MISMATCH/);}finally{await pool.query('UPDATE sophie_migrations.applied SET sha256=$2 WHERE id=$1',[id,prior]);}
  });
  await run('SU03 encrypted historical restore preserves observations files and references while fencing jobs and runtime',async()=>{
    const prepared=await prepareRecoveryBundle({directory:backup.directory,parent,key,maxDatabaseBytes,confirmGuildId:GUILD,expectedManifestSha256:backup.manifestSha256}),target=await cluster.recovery.createTarget();
    const result=await restoreRecoveryBundle({prepared,pool:target.pool,database:target.configuration,tools});assert.equal(result.preservationOnly,true);assert.equal(result.sourceMigrations,32);assert.equal(result.controlHistoryAvailable,false);
    assert.deepEqual(await verifyStaging032Migrations(target.pool),{migrations:32});await assert.rejects(requireUnquarantinedDatabase(target.pool),/RECOVERY_QUARANTINED/);
    for(const table of tables.filter(t=>!['outbox','gateway_lifecycle','dashboard_sessions','dashboard_login_flows'].includes(t)))
      assert.deepEqual(sorted((await target.pool.query(`SELECT ${columns.get(table)} FROM sophie_core.${table}`)).rows),sorted(before.get(table)),table);
    const slot=(await f.jobs())[0].retained_slot;assert.deepEqual(await readFile(resolve(prepared.working,`${slot}.blob`)),syntheticFileBytes);
    assert.equal((await target.pool.query("SELECT count(*)::int AS total FROM sophie_core.outbox WHERE status IN ('ready','leased')")).rows[0].total,0);
    assert.equal((await target.pool.query('SHOW default_transaction_read_only')).rows[0].default_transaction_read_only,'on');
  });
  await run('SU04 missing migrations 033 through 055 preserve historical rows and install current restricted runtime grants',async()=>{
    assert.deepEqual(await migrateCore(pool),{migrations: 56});assert.deepEqual(await migrateCore(pool),{migrations: 56});
    for(const table of tables)assert.deepEqual(sorted((await pool.query(`SELECT ${columns.get(table)} FROM sophie_core.${table}`)).rows),sorted(before.get(table)),table);
    await pool.query(`GRANT CONNECT ON DATABASE ${source.configuration.database} TO sophie_test_core`);
    await pool.query('GRANT USAGE ON SCHEMA sophie_core,sophie_migrations TO sophie_test_core; GRANT SELECT,INSERT,UPDATE ON ALL TABLES IN SCHEMA sophie_core TO sophie_test_core; GRANT SELECT ON sophie_migrations.applied TO sophie_test_core');
    const checked=await checkRuntimeDatabase(source.corePool);assert.equal(checked.migrations, 56);assert.ok(checked.checkedTables>54);
    await assert.rejects(source.corePool.query('SELECT * FROM sophie_control.events'),e=>e.code==='42501');
    await assert.rejects(source.corePool.query('DELETE FROM sophie_core.case_message_observations'),e=>e.code==='42501');
    assert.ok((await pool.query("SELECT count(*)::int AS total FROM sophie_control.events WHERE operation='baseline'")).rows[0].total>0);
  });
  await run('SU05 upgraded database requires current backup mode and historical preservation cannot masquerade as rollback',async()=>{
    await assert.rejects(verifyStaging032Migrations(pool),/DATABASE_MIGRATIONS_INCOMPLETE/);
    await assert.rejects(createRecoveryBundle({...options,preserveStaging032:true}),/DATABASE_MIGRATIONS_INCOMPLETE/);
    const current=await createRecoveryBundle(options);assert.equal(current.artifacts,1);assert.equal(current.independentRecoveryVerified,false);
  });
  await run('SU06 upgrading exact schema 045 retains active sessions and binds existing login flows to the default return page',async()=>{
    const prior=await cluster.recovery.createHistoricalSource(), db=prior.pool;
    await db.query('CREATE SCHEMA sophie_migrations; REVOKE ALL ON SCHEMA sophie_migrations FROM PUBLIC; CREATE TABLE sophie_migrations.applied (id text PRIMARY KEY, sha256 text NOT NULL)');
    for(const id of (await readdir(directory)).filter(name=>/^0\d\d-.*\.sql$/.test(name)).sort().slice(0,45)) {
      const sql=await readFile(resolve(directory,id),'utf8');await db.query(sql);
      await db.query('INSERT INTO sophie_migrations.applied VALUES ($1,$2)',[id,createHash('sha256').update(sql).digest('hex')]);
    }
    await db.query('INSERT INTO sophie_core.dashboard_auth_policies VALUES ($1,1,$2)',[GUILD,dashboardConfiguration]);
    await db.query("INSERT INTO sophie_core.dashboard_login_flows VALUES ($1,1,1,$2,$3,clock_timestamp()+interval '5 minutes','pending')",[GUILD,'a'.repeat(64),'b'.repeat(64)]);
    await db.query("INSERT INTO sophie_core.dashboard_sessions (guild_id,slot,policy_version,user_id,token_hash,expires_at) VALUES ($1,1,1,$1,$2,clock_timestamp()+interval '1 hour')",[GUILD,'c'.repeat(64)]);
    const session=(await db.query('SELECT * FROM sophie_core.dashboard_sessions')).rows;
    const flow=(await db.query('SELECT to_jsonb(f) AS value FROM sophie_core.dashboard_login_flows f')).rows[0].value;
    assert.deepEqual(await migrateCore(db),{migrations: 56});
    assert.deepEqual((await db.query('SELECT * FROM sophie_core.dashboard_sessions')).rows,session);
    assert.deepEqual((await db.query('SELECT to_jsonb(f) AS value FROM sophie_core.dashboard_login_flows f')).rows[0].value,{...flow,return_path:'/'});
    await assert.rejects(db.query("UPDATE sophie_core.dashboard_login_flows SET return_path='https://other.example.test'"),e=>e.code==='23514');
    assert.deepEqual(await verifyCoreMigrations(db),{migrations: 56});
  });
  await run('SU07 schema 046 retained candidates survive additive maintenance guards and inventory with the barrier initially open',async()=>{
    const prior=await cluster.recovery.createHistoricalSource(),db=prior.pool;
    await db.query('CREATE SCHEMA sophie_migrations; REVOKE ALL ON SCHEMA sophie_migrations FROM PUBLIC; CREATE TABLE sophie_migrations.applied (id text PRIMARY KEY, sha256 text NOT NULL)');
    for(const id of (await readdir(directory)).filter(name=>/^0\d\d-.*\.sql$/.test(name)).sort().slice(0,46)) {
      const sql=await readFile(resolve(directory,id),'utf8');await db.query(sql);
      await db.query('INSERT INTO sophie_migrations.applied VALUES ($1,$2)',[id,createHash('sha256').update(sql).digest('hex')]);
    }
    await db.query(`INSERT INTO sophie_core.permission_drafts (guild_id,revision,document,sha256,operator_grant)
      VALUES ($1,1,'{"synthetic":"retained-control-data"}',repeat('a',64),$2)`,[GUILD,{guildId:GUILD,userId:GUILD,capabilityEpoch:1,policyVersion:1}]);
    const tables=(await db.query("SELECT tablename FROM pg_tables WHERE schemaname='sophie_core' ORDER BY tablename")).rows;
    const before=new Map();for(const {tablename} of tables)before.set(tablename,(await db.query(`SELECT to_jsonb(t) AS row FROM sophie_core.${tablename} t`)).rows);
    assert.deepEqual(await migrateCore(db),{migrations: 56});assert.deepEqual(await migrateCore(db),{migrations: 56});
    for(const {tablename} of tables)assert.deepEqual((await db.query(`SELECT to_jsonb(t) AS row FROM sophie_core.${tablename} t`)).rows,before.get(tablename));
    assert.equal((await db.query('SELECT sophie_core.runtime_available() AS available')).rows[0].available,true);
    assert.equal((await db.query('SELECT count(*)::int AS total FROM sophie_control.maintenance_operations')).rows[0].total,0);
    assert.deepEqual(await verifyCoreMigrations(db),{migrations: 56});
  });
  await run('SU08 schema 047 held maintenance and its generation survive inventory migration',async()=>{
    const prior=await cluster.recovery.createHistoricalSource(),db=prior.pool;
    await db.query('CREATE SCHEMA sophie_migrations; REVOKE ALL ON SCHEMA sophie_migrations FROM PUBLIC; CREATE TABLE sophie_migrations.applied (id text PRIMARY KEY, sha256 text NOT NULL)');
    for(const id of (await readdir(directory)).filter(name=>/^0\d\d-.*\.sql$/.test(name)).sort().slice(0,47)) {
      const sql=await readFile(resolve(directory,id),'utf8');await db.query(sql);
      await db.query('INSERT INTO sophie_migrations.applied VALUES ($1,$2)',[id,createHash('sha256').update(sql).digest('hex')]);
    }
    const operationId='a'.repeat(64);
    await db.query(`INSERT INTO sophie_control.maintenance_operations
      (operation_id,guild_id,candidate_version,request_sha256,review_sha256,generation,phase,database_actor)
      VALUES ($1,$2,1,$1,$1,14,'held',session_user)`,[operationId,GUILD]);
    await db.query('UPDATE sophie_control.runtime_gate SET generation=14,operation_id=$1 WHERE singleton',[operationId]);
    const gate=(await db.query('SELECT * FROM sophie_control.runtime_gate')).rows,operations=(await db.query('SELECT * FROM sophie_control.maintenance_operations')).rows;
    assert.deepEqual(await migrateCore(db),{migrations: 56});assert.deepEqual(await verifyCoreMigrations(db),{migrations: 56});
    assert.deepEqual((await db.query('SELECT * FROM sophie_control.runtime_gate')).rows,gate);
    assert.deepEqual((await db.query('SELECT * FROM sophie_control.maintenance_operations')).rows,operations);
    assert.equal((await db.query('SELECT sophie_core.runtime_available() AS available')).rows[0].available,false);
    assert.equal((await db.query('SELECT count(*)::int AS total FROM sophie_control.maintenance_inventories')).rows[0].total,0);
  });
  await run('SU09 schema 048 inventory revisions survive sealing migration without starting effects',async()=>{
    const prior=await cluster.recovery.createHistoricalSource(),db=prior.pool;
    await db.query('CREATE SCHEMA sophie_migrations; REVOKE ALL ON SCHEMA sophie_migrations FROM PUBLIC; CREATE TABLE sophie_migrations.applied (id text PRIMARY KEY, sha256 text NOT NULL)');
    for(const id of (await readdir(directory)).filter(name=>/^0\d\d-.*\.sql$/.test(name)).sort().slice(0,48)) {
      const sql=await readFile(resolve(directory,id),'utf8');await db.query(sql);
      await db.query('INSERT INTO sophie_migrations.applied VALUES ($1,$2)',[id,createHash('sha256').update(sql).digest('hex')]);
    }
    const operationId='a'.repeat(64);
    await db.query(`INSERT INTO sophie_control.maintenance_operations
      (operation_id,guild_id,candidate_version,request_sha256,review_sha256,generation,phase,database_actor)
      VALUES ($1,$2,1,$1,$1,15,'held',session_user)`,[operationId,GUILD]);
    await db.query('UPDATE sophie_control.runtime_gate SET generation=15,operation_id=$1 WHERE singleton',[operationId]);
    await db.query(`INSERT INTO sophie_control.maintenance_inventories
      (operation_id,revision,request_id,request_sha256,candidate_sha256,control_sha256,inventory,sha256)
      VALUES ($1,1,$1,$1,$1,$1,'{"synthetic":"metadata"}',$1)`,[operationId]);
    const before=new Map();for(const table of ['runtime_gate','maintenance_operations','maintenance_inventories'])before.set(table,(await db.query(`SELECT * FROM sophie_control.${table}`)).rows);
    assert.deepEqual(await migrateCore(db),{migrations: 56});assert.deepEqual(await verifyCoreMigrations(db),{migrations: 56});
    for(const [table,rows] of before)assert.deepEqual((await db.query(`SELECT * FROM sophie_control.${table}`)).rows,rows);
    assert.equal((await db.query('SELECT sophie_core.runtime_available() AS available')).rows[0].available,false);
    for(const table of ['maintenance_seal_plans','maintenance_seal_effects'])assert.equal((await db.query(`SELECT count(*)::int AS total FROM sophie_control.${table}`)).rows[0].total,0);
  });
  await run('SU10 schema 049 sealed journals survive policy-application migration without applying policies',async()=>{
    const prior=await cluster.recovery.createHistoricalSource(),db=prior.pool;
    await db.query('CREATE SCHEMA sophie_migrations; REVOKE ALL ON SCHEMA sophie_migrations FROM PUBLIC; CREATE TABLE sophie_migrations.applied (id text PRIMARY KEY, sha256 text NOT NULL)');
    for(const id of (await readdir(directory)).filter(name=>/^0\d\d-.*\.sql$/.test(name)).sort().slice(0,49)) {
      const sql=await readFile(resolve(directory,id),'utf8');await db.query(sql);
      await db.query('INSERT INTO sophie_migrations.applied VALUES ($1,$2)',[id,createHash('sha256').update(sql).digest('hex')]);
    }
    const operationId='a'.repeat(64);
    await db.query(`INSERT INTO sophie_control.maintenance_operations
      (operation_id,guild_id,candidate_version,request_sha256,review_sha256,generation,phase,database_actor)
      VALUES ($1,$2,1,$1,$1,16,'sealed',session_user)`,[operationId,GUILD]);
    await db.query('UPDATE sophie_control.runtime_gate SET generation=16,operation_id=$1 WHERE singleton',[operationId]);
    await db.query(`INSERT INTO sophie_control.maintenance_inventories
      (operation_id,revision,request_id,request_sha256,candidate_sha256,control_sha256,inventory,sha256)
      VALUES ($1,1,$1,$1,$1,$1,'{"synthetic":"metadata"}',$1)`,[operationId]);
    await db.query(`INSERT INTO sophie_control.maintenance_seal_plans
      (operation_id,inventory_revision,inventory_sha256,request_id,request_sha256,plan_sha256,sealed_inventory_sha256) VALUES ($1,1,$1,$1,$1,$1,$1)`,[operationId]);
    await db.query(`INSERT INTO sophie_control.maintenance_seal_effects
      (operation_id,channel_id,case_id,target,state,had_uncertainty,verified_at) VALUES ($1,'123','synthetic','{"channelId":"123"}','verified',true,clock_timestamp())`,[operationId]);
    const before=new Map();for(const table of ['runtime_gate','maintenance_operations','maintenance_inventories','maintenance_seal_plans','maintenance_seal_effects'])before.set(table,(await db.query(`SELECT * FROM sophie_control.${table}`)).rows);
    assert.deepEqual(await migrateCore(db),{migrations: 56});assert.deepEqual(await verifyCoreMigrations(db),{migrations: 56});
    for(const [table,rows] of before)assert.deepEqual((await db.query(`SELECT * FROM sophie_control.${table}`)).rows,rows);
    assert.equal((await db.query('SELECT sophie_core.runtime_available() AS available')).rows[0].available,false);
    assert.equal((await db.query('SELECT count(*)::int AS total FROM sophie_control.maintenance_policy_applications')).rows[0].total,0);
  });
  key.fill(0);
}
