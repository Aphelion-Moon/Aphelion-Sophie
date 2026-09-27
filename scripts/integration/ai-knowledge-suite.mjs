import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { migrateCore } from '../../apps/core/storage/migrate.js';
import { createKnowledgeLibrary } from '../../apps/knowledge/library.js';

export async function runAiKnowledgeSuite(cluster, run) {
  const { adminPool: admin, knowledgePool: pool, corePool } = cluster;
  await admin.query('GRANT USAGE ON SCHEMA sophie_knowledge TO sophie_test_knowledge');
  await admin.query('GRANT SELECT,INSERT,UPDATE ON ALL TABLES IN SCHEMA sophie_knowledge TO sophie_test_knowledge');
  const actor = { userId: '202' }; let restoreReady = true;
  const options = { pool, guildId: '101', authorize: async (_action, candidate) => candidate === actor, restoreCurrent: async () => restoreReady, clock: Date.now };
  const library = createKnowledgeLibrary(options), request = () => ({ guildId: '101', deadline: Date.now() + 15000 });
  const document = { id: 'synthetic-shuttle', title: 'Synthetic shuttle guide', kind: 'owner-publication', authority: 'reference', url: 'https://example.test/approved/shuttle',
    rights: 'Synthetic fixture authored for this check', attribution: 'Synthetic author', sourceRevision: 'synthetic-1', dependencyHash: 'a'.repeat(64),
    fetchedAt: Date.now(), validUntil: null, aliases: ['arrival lights'], sections: [{ heading: 'Arrival', text: 'The synthetic shuttle uses blue arrival lights.' }] };
  let publication, sources;
  await run('AI14 reviewed knowledge publishes exactly once with lexical and alias lookup independent of inference', async () => {
    const review = await library.review({ actor, expectedEpoch: 0, document });
    publication = { actor, expectedEpoch: 0, document, reviewHash: review.reviewHash, requestId: 'a'.repeat(64), confirmed: true };
    assert.equal((await library.publish(publication)).revision, 1); assert.equal((await library.publish(publication)).duplicate, true);
    assert.equal((await library.catalogue({ actor })).documents[0].id,document.id);
    assert.equal((await library.read({ actor, id: document.id })).document.title,document.title);
    await assert.rejects(library.catalogue({ actor: { userId: '999' } }),/OPERATION_DENIED/);
    sources = await library.lookup('arrival lights', request()); assert.equal(sources.length, 1); assert.equal(sources[0].exact, true);
    assert.equal((await library.lookup('blue arrival', request())).length, 1); assert.equal(await library.current(sources,request()), true);
    assert.equal(await library.current([{ ...sources[0], text: 'Changed unpublished instructions' }],request()),false);
    assert.equal(await library.current([{ ...sources[0], rights: 'Changed rights' }],request()),false);
    await admin.query("UPDATE sophie_knowledge.chunks SET text='Changed indexed instructions' WHERE source_id=$1",[sources[0].id]);
    assert.deepEqual(await library.lookup('arrival lights',request()),[]);
    await admin.query('UPDATE sophie_knowledge.chunks SET text=$2 WHERE source_id=$1',[sources[0].id,document.sections[0].text]);
  });
  await run('AI15 source/template invalidation immediately removes retrieval and pending-answer authority', async () => {
    await library.markSourceStale({ actor, id: document.id, expectedEpoch: 1 });
    assert.deepEqual(await library.lookup('arrival lights', request()), []); assert.equal(await library.current(sources,request()), false);
    const review = await library.review({ actor, expectedEpoch: 2, document });
    await library.publish({ ...publication, expectedEpoch: 2, reviewHash: review.reviewHash, requestId: 'b'.repeat(64) });
    assert.equal((await library.lookup('arrival lights',request()))[0].epoch, 3);
  });
  await run('AI16 withdrawal deletes every plaintext revision and delayed reviewed work cannot recreate it', async () => {
    const review = await library.review({ actor, expectedEpoch: 3, document });
    await library.withdraw({ actor, id: document.id, expectedEpoch: 3 });
    assert.equal((await library.lookup('blue arrival',request())).length, 0);
    assert.equal((await library.read({ actor, id: document.id })).document,null);
    assert.equal((await pool.query('SELECT count(*)::int AS count FROM sophie_knowledge.publications WHERE document IS NOT NULL')).rows[0].count, 0);
    assert.equal((await pool.query('SELECT count(*)::int AS count FROM sophie_knowledge.chunks WHERE text IS NOT NULL OR search<>\'\'::tsvector')).rows[0].count, 0);
    await assert.rejects(library.publish({ ...publication, expectedEpoch: 3, reviewHash: review.reviewHash, requestId: 'c'.repeat(64) }), /KNOWLEDGE_STALE/);
    assert.equal((await library.publish(publication)).duplicate,true); assert.equal((await library.lookup('blue arrival',request())).length,0);
  });
  await run('AI17 knowledge identity and current restore guard cannot be bypassed with a core pool or stale backup', async () => {
    const invalid = createKnowledgeLibrary({ ...options, pool: corePool });
    await assert.rejects(invalid.lookup('anything', request()), /KNOWLEDGE_IDENTITY_INVALID/);
    restoreReady = false; await assert.rejects(library.lookup('anything', request()), /KNOWLEDGE_RESTORE_QUARANTINED/); restoreReady = true;
    await assert.rejects(pool.query('SELECT * FROM sophie_core.case_exclusions'), error => error.code === '42501');
    await assert.rejects(pool.query('SELECT * FROM sophie_ai.consents'), error => error.code === '42501');
  });
  await run('AI18 schema056 upgrade preserves the Gateway lease and AI controls without enabling inference', async () => {
    const previous = await cluster.recovery.createHistoricalSource(), db = previous.pool;
    const directory = new URL('../../apps/core/storage/migrations/',import.meta.url);
    await db.query('CREATE SCHEMA sophie_migrations; REVOKE ALL ON SCHEMA sophie_migrations FROM PUBLIC; CREATE TABLE sophie_migrations.applied(id text PRIMARY KEY,sha256 text NOT NULL)');
    for (const id of (await readdir(directory)).filter(name => /^0\d\d-.*\.sql$/.test(name)).sort().slice(0,56)) {
      const sql = await readFile(new URL(id,directory),'utf8'); await db.query(sql);
      await db.query('INSERT INTO sophie_migrations.applied VALUES($1,$2)',[id,createHash('sha256').update(sql).digest('hex')]);
    }
    await db.query("INSERT INTO sophie_core.gateway_lifecycle(guild_id,mapping_hash,lease_owner,fence,lease_until,continuity_epoch,status) VALUES('101',repeat('a',64),'synthetic-prior',3,clock_timestamp(),9,'offline')");
    await db.query("INSERT INTO sophie_ai.state(guild_id) VALUES('101')");
    const gateway = (await db.query('SELECT to_jsonb(g) AS value FROM sophie_core.gateway_lifecycle g')).rows[0].value;
    const controls = (await db.query('SELECT * FROM sophie_ai.state')).rows;
    assert.deepEqual(await migrateCore(db),{ migrations: 57 });
    assert.deepEqual((await db.query('SELECT to_jsonb(g) AS value FROM sophie_core.gateway_lifecycle g')).rows[0].value,{ ...gateway, ai_boundary_epoch: 0 });
    assert.deepEqual((await db.query('SELECT * FROM sophie_ai.state')).rows,controls); assert.equal(controls[0].disabled,true);
    assert.equal((await db.query('SELECT count(*)::int AS count FROM sophie_knowledge.documents')).rows[0].count,0);
    assert.deepEqual(await migrateCore(db),{ migrations: 57 });
  });
}
