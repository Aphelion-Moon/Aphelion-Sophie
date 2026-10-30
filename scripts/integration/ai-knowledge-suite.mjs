import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { migrateCore } from '../../apps/core/storage/migrate.js';
import { createKnowledgeLibrary } from '../../apps/knowledge/library.js';
import { createMediaWikiCollector, POLICIES_SOURCE } from '../../apps/knowledge/mediawiki.js';
import { createWikiExtractor } from '../../apps/knowledge/extraction.js';
import { packDocuments } from '../../apps/knowledge/sources/sectioning.js';

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
    const refs = sources.map(({id,epoch,publicationHash}) => ({id,epoch,publicationHash}));
    assert.equal(await library.currentReferences(refs,request()),true);
    assert.equal(await library.currentReferences(refs.map(source=>({...source,epoch:source.epoch+1})),request()),false);
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
  await run('AI18 staged schema056-to063 upgrade preserves Gateway, AI controls and prior publication receipts without enabling inference', async () => {
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
    for (const id of ['057-ai-boundaries.sql','058-ai-accounting.sql']) {
      const sql = await readFile(new URL(id,directory),'utf8'); await db.query(sql);
      await db.query('INSERT INTO sophie_migrations.applied VALUES($1,$2)',[id,createHash('sha256').update(sql).digest('hex')]);
    }
    await db.query("INSERT INTO sophie_knowledge.documents VALUES('101','prior-publication',1,1,true,false,NULL)");
    await db.query("INSERT INTO sophie_knowledge.publications VALUES('101','prior-publication',1,repeat('a',64),NULL)");
    await db.query("INSERT INTO sophie_knowledge.receipts(guild_id,request_id,actor_id,review_sha256,document_id,revision) VALUES('101',repeat('b',64),'202',repeat('c',64),'prior-publication',1)");
    assert.deepEqual(await migrateCore(db),{ migrations: 83 });
    assert.deepEqual((await db.query('SELECT to_jsonb(g) AS value FROM sophie_core.gateway_lifecycle g')).rows[0].value,{ ...gateway, ai_boundary_epoch: 0 });
    assert.deepEqual((await db.query('SELECT * FROM sophie_ai.state')).rows,controls); assert.equal(controls[0].disabled,true);
    assert.equal((await db.query('SELECT count(*)::int AS count FROM sophie_knowledge.documents')).rows[0].count,1);
    assert.equal((await db.query('SELECT input_sha256 FROM sophie_knowledge.receipts')).rows[0].input_sha256,'c'.repeat(64));
    assert.equal((await db.query('SELECT count(*)::int AS count FROM sophie_knowledge.import_sources')).rows[0].count,0);
    assert.deepEqual(await migrateCore(db),{ migrations: 83 });
  });

  let templateVersion = 1, failWiki = false, pauseCollect = null, pauseExtract = null, invalidations = 0, fetched = 0;
  const revision = (title, pageid, ns, revid) => ({ title, pageid, ns, contentmodel: 'wikitext', lastrevid: revid,
    revisions: [{ revid, sha1: 'a'.repeat(40), timestamp: '2026-09-28T00:00:00Z' }] });
  const collector = createMediaWikiCollector({ fetchImpl: async url => {
    fetched++; if (failWiki) throw Error('synthetic upstream failure');
    if (url.searchParams.get('meta') === 'siteinfo') return Response.json({ query: { general: { server: 'https://meridian-wiki.a13.info', scriptpath: '', articlepath: '/wiki/$1', wikiid: 'wiki_meridian', generator: 'MediaWiki 1.46.0' }, rightsinfo: { url: POLICIES_SOURCE.licenceUrl, text: 'CC BY-NC-SA 4.0' } } });
    if (url.searchParams.get('action') === 'parse') return Response.json({ parse: { title: 'Policies', pageid: 878, revid: 12,
      text: `<h2 id="SYNTHETIC">Synthetic policy</h2><p>Do not omit exception ${templateVersion}.</p>`, templates: [{ ns: 10, title: 'Template:Policy', exists: true }], parsewarnings: [] } });
    return Response.json({ query: { pages: [url.searchParams.has('titles') ? revision('Template:Policy',11,10,templateVersion) : revision('Policies',878,0,12)] } });
  } });
  const extractor = createWikiExtractor();
  const imports = createKnowledgeLibrary({ ...options, invalidate: () => { invalidations++; },
    collector: { async collectPolicies(request) { const value = await collector.collectPolicies(request); if (pauseCollect) { const wait = pauseCollect; pauseCollect = null; await wait(); } return value; } },
    extractor: { async extract(snapshot) { if (pauseExtract) { const wait = pauseExtract; pauseExtract = null; await wait(); } return extractor.extract(snapshot); } } });
  const draft = snapshot => ({ id: 'synthetic-wiki', title: 'Synthetic wiki policy', kind: 'mediawiki', authority: 'policy', url: POLICIES_SOURCE.url,
    rights: POLICIES_SOURCE.licenceUrl, attribution: 'Synthetic fixture; https://meridian-wiki.a13.info/index.php?title=Policies&action=history',
    sourceRevision: `page:878:r${snapshot.page.revision}`, dependencyHash: snapshot.snapshotHash, fetchedAt: snapshot.fetchedAt,
    validUntil: snapshot.fetchedAt + 86400000, aliases: ['synthetic wiki policy'], sections: [{ heading: 'Synthetic policy', text: `Do not omit exception ${templateVersion}.` }] });
  let wikiDocument, wikiSources, firstHash, wikiPublication;
  async function publishWiki(expectedEpoch, requestId) {
    const status = await imports.policiesStatus({ actor });
    wikiDocument = draft((await imports.policiesSnapshot({ actor, snapshotHash: status.snapshotHash })).snapshot);
    const review = await imports.review({ actor, expectedEpoch, document: wikiDocument });
    wikiPublication = { actor, expectedEpoch, document: wikiDocument, reviewHash: review.reviewHash, requestId, confirmed: true };
    return imports.publish(wikiPublication);
  }
  await run('DS07-K01 synthetic collection/extraction persists immutable review snapshots without publishing, then binds manual publication', async () => {
    const collected = await imports.refreshPolicies({ actor }); firstHash = collected.snapshotHash;
    assert.equal(collected.publishedAutomatically,false); assert.equal(collected.changed,true);
    assert.deepEqual(await imports.lookup('synthetic wiki policy',request()),[]);
    const saved = await imports.policiesSnapshot({ actor, snapshotHash: firstHash });
    assert.equal(saved.reviewed,false); assert.equal(saved.extraction.reviewed,false);
    assert.equal((await publishWiki(0,'d'.repeat(64))).revision,1);
    wikiSources = await imports.lookup('synthetic wiki policy',request()); assert.equal(wikiSources.length,1);
    assert.equal(await imports.current(wikiSources,request()),true);
    const original = (await pool.query('SELECT snapshot,extraction FROM sophie_knowledge.import_snapshots WHERE sha256=$1',[firstHash])).rows[0];
    assert.equal((await imports.refreshPolicies({ actor })).changed,false);
    assert.deepEqual((await pool.query('SELECT snapshot,extraction FROM sophie_knowledge.import_snapshots WHERE sha256=$1',[firstHash])).rows[0],original);
    assert.equal((await pool.query('SELECT count(*)::int AS count FROM sophie_knowledge.import_snapshots')).rows[0].count,1);
    const calls = fetched; await assert.rejects(imports.refreshPolicies({ actor: { userId: '999' } }),/OPERATION_DENIED/); assert.equal(fetched,calls);
  });
  await run('DS07-K09 qualified service refresh has no publisher authority and cancellation cannot renew freshness',async()=>{
    let qualified=false;
    const service=createKnowledgeLibrary({...options,authorize:async()=>false,syncAuthorized:async()=>qualified,collector,extractor});
    const before=fetched;await assert.rejects(service.synchronizePolicies(),/KNOWLEDGE_SYNC_UNQUALIFIED/);assert.equal(fetched,before);
    qualified=true;assert.equal((await service.synchronizePolicies()).publishedAutomatically,false);
    await assert.rejects(service.review({actor,expectedEpoch:1,document:wikiDocument}),/OPERATION_DENIED/);
    const controller=new AbortController();controller.abort();const calls=fetched;
    await assert.rejects(service.synchronizePolicies({signal:controller.signal}),/KNOWLEDGE_IMPORT_CANCELLED/);assert.equal(fetched,calls);
    assert.equal((await pool.query('SELECT count(*)::int AS count FROM sophie_knowledge.publications WHERE document_id=$1',[wikiDocument.id])).rows[0].count,1);
  });
  await run('DS07-K02 template-only change invalidates current and pending answers before extraction and never automatically republishes', async () => {
    templateVersion = 2; let release, entered;
    const ready = new Promise(resolve => { entered = resolve; });
    pauseExtract = () => { entered(); return new Promise(resolve => { release = resolve; }); };
    const refresh = imports.refreshPolicies({ actor }); await ready;
    assert.equal(await imports.current(wikiSources,request()),false); assert.deepEqual(await imports.lookup('synthetic wiki policy',request()),[]);
    await assert.rejects(imports.review({ actor, expectedEpoch: 1, document: wikiDocument }),/KNOWLEDGE_SOURCE_STALE/);
    release(); const next = await refresh; assert.notEqual(next.snapshotHash,firstHash);
    assert.deepEqual(await imports.lookup('synthetic wiki policy',request()),[]);
    assert.equal((await publishWiki(2,'e'.repeat(64))).revision,2);
    wikiSources = await imports.lookup('synthetic wiki policy',request()); assert.match(wikiSources[0].text,/exception 2/);
    assert.equal(wikiDocument.sourceRevision,'page:878:r12'); assert.ok(invalidations >= 2);
  });
  await run('DS07-K03 source failures and freshness expiry exclude published material; unchanged recheck can restore only the same approved snapshot', async () => {
    failWiki = true; await assert.rejects(imports.refreshPolicies({ actor }),/WIKI_IMPORT_FAILED/); failWiki = false;
    assert.equal((await imports.policiesStatus({ actor })).state,'unavailable'); assert.equal(await imports.current(wikiSources,request()),false);
    await imports.refreshPolicies({ actor }); assert.equal(await imports.current(wikiSources,request()),true);
    await pool.query("UPDATE sophie_knowledge.import_sources SET valid_until=clock_timestamp()-interval '1 second'");
    assert.equal(await imports.current(wikiSources,request()),false); assert.deepEqual(await imports.lookup('synthetic wiki policy',request()),[]);
    assert.equal((await imports.read({ actor, id: wikiDocument.id })).sourceCurrent,false);
    assert.equal((await imports.catalogue({ actor })).documents.find(row => row.id === wikiDocument.id).sourceCurrent,false);
    await imports.refreshPolicies({ actor }); assert.equal(await imports.current(wikiSources,request()),true);
  });
  await run('DS07-K04 fenced expired import cannot overwrite a replacement job or clear its state', async () => {
    let release, entered; const ready = new Promise(resolve => { entered = resolve; });
    pauseCollect = () => { entered(); return new Promise(resolve => { release = resolve; }); };
    const pending = imports.refreshPolicies({ actor }); await ready;
    await assert.rejects(imports.refreshPolicies({ actor }),/KNOWLEDGE_IMPORT_BUSY/);
    await pool.query("UPDATE sophie_knowledge.import_sources SET lease_until=clock_timestamp()-interval '1 second'");
    await imports.refreshPolicies({ actor }); release(); await assert.rejects(pending,/KNOWLEDGE_IMPORT_STALE/);
    assert.equal((await imports.policiesStatus({ actor })).state,'ready'); assert.equal(await imports.current(wikiSources,request()),true);
  });
  await run('DS07-K05 refresh cannot revive a manually stale or withdrawn publication and restore quarantine blocks importer access', async () => {
    await imports.markSourceStale({ actor, id: wikiDocument.id, expectedEpoch: 3 });
    await imports.refreshPolicies({ actor }); assert.deepEqual(await imports.lookup('synthetic wiki policy',request()),[]);
    await publishWiki(4,'f'.repeat(64)); await imports.withdraw({ actor, id: wikiDocument.id, expectedEpoch: 5 });
    assert.equal((await imports.withdraw({ actor, id: wikiDocument.id, expectedEpoch: 5 })).duplicate,true);
    await imports.refreshPolicies({ actor }); assert.deepEqual(await imports.lookup('synthetic wiki policy',request()),[]);
    restoreReady = false; const calls = fetched;
    await assert.rejects(imports.refreshPolicies({ actor }),/KNOWLEDGE_RESTORE_QUARANTINED/);
    await assert.rejects(imports.policiesSnapshot({ actor, snapshotHash: firstHash }),/KNOWLEDGE_RESTORE_QUARANTINED/);
    assert.equal(fetched,calls); restoreReady = true;
    await assert.rejects(corePool.query('SELECT * FROM sophie_knowledge.import_snapshots'), error => error.code === '42501');
  });
  await run('DS07-K08 source reversion requires fresh publication review, while lost acknowledgements retain their exact receipts', async () => {
    await publishWiki(6,'1'.repeat(64)); const committed = wikiPublication;
    wikiSources = await imports.lookup('synthetic wiki policy',request());
    const oldReview = await imports.review({ actor, expectedEpoch: 7, document: wikiDocument });
    const newDocument = { ...wikiDocument, id: 'synthetic-new-wiki' };
    const newReview = await imports.review({ actor, expectedEpoch: 0, document: newDocument });
    templateVersion = 1; await imports.refreshPolicies({ actor });
    templateVersion = 2; await imports.refreshPolicies({ actor });
    assert.equal(await imports.current(wikiSources,request()),false);
    assert.equal((await imports.read({ actor, id: wikiDocument.id })).sourceCurrent,false);
    await assert.rejects(imports.publish({ ...committed, expectedEpoch: 7, reviewHash: oldReview.reviewHash, requestId: '2'.repeat(64) }),/KNOWLEDGE_REVIEW_STALE/);
    await assert.rejects(imports.publish({ ...committed, expectedEpoch: 0, document: newDocument, reviewHash: newReview.reviewHash, requestId: '3'.repeat(64) }),/KNOWLEDGE_REVIEW_STALE/);
    assert.equal((await imports.publish(committed)).duplicate,true);
    await assert.rejects(imports.publish({ ...committed, document: { ...committed.document, title: 'Changed retry' } }),/KNOWLEDGE_REQUEST_COLLISION/);
    await assert.rejects(imports.withdraw({ actor, id: wikiDocument.id, expectedEpoch: 5 }),/KNOWLEDGE_STALE/);
    await publishWiki(9,'4'.repeat(64)); wikiSources = await imports.lookup('synthetic wiki policy',request());
    assert.equal(await imports.current(wikiSources,request()),true);
  });
  await run('DS07-K06 extractor upgrades require review and import capacity fails closed without overwriting history', async () => {
    const status = await imports.policiesStatus({ actor });
    const original = (await pool.query('SELECT snapshot,extraction,extraction_integrity FROM sophie_knowledge.import_snapshots WHERE sha256=$1',[status.snapshotHash])).rows[0];
    const beforeCorruption = await imports.review({ actor, expectedEpoch: 10, document: wikiDocument });
    for (const [column,key] of [['snapshot','html'],['extraction','text']]) {
      await pool.query(`UPDATE sophie_knowledge.import_snapshots SET ${column}=jsonb_set(${column},$2,'"Changed text"') WHERE sha256=$1`,[status.snapshotHash,[key]]);
      assert.equal(await imports.current(wikiSources,request()),false);
      await assert.rejects(imports.review({ actor, expectedEpoch: 10, document: wikiDocument }),/KNOWLEDGE_SOURCE_STALE/);
      await assert.rejects(imports.publish({ ...wikiPublication, expectedEpoch: 10, requestId: '5'.repeat(64), reviewHash: beforeCorruption.reviewHash }),/KNOWLEDGE_SOURCE_STALE/);
      await pool.query(`UPDATE sophie_knowledge.import_snapshots SET ${column}=$2 WHERE sha256=$1`,[status.snapshotHash,original[column]]);
    }
    await pool.query("UPDATE sophie_knowledge.import_snapshots SET extraction=jsonb_set(extraction,'{extractorRevision}','\"unreviewed-next\"') WHERE sha256=$1",[status.snapshotHash]);
    await assert.rejects(imports.policiesSnapshot({ actor, snapshotHash: status.snapshotHash }),/KNOWLEDGE_IMPORT_CORRUPT/);
    await assert.rejects(imports.refreshPolicies({ actor }),/KNOWLEDGE_IMPORT_CORRUPT/);
    const next = { ...original.extraction, extractorRevision: 'unreviewed-next' };
    const sorted = value => Array.isArray(value) ? value.map(sorted) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key,sorted(value[key])])) : value;
    await pool.query('UPDATE sophie_knowledge.import_snapshots SET extraction=$2,extraction_integrity=$3 WHERE sha256=$1',
      [status.snapshotHash,next,createHash('sha256').update(JSON.stringify(sorted(next))).digest('hex')]);
    await assert.rejects(imports.refreshPolicies({ actor }),/KNOWLEDGE_EXTRACTOR_CHANGED/);
    assert.equal((await imports.policiesStatus({ actor })).state,'unavailable');
    await pool.query('UPDATE sophie_knowledge.import_snapshots SET extraction=$2,extraction_integrity=$3 WHERE sha256=$1',[status.snapshotHash,original.extraction,original.extraction_integrity]);
    const count = (await pool.query('SELECT count(*)::int AS count FROM sophie_knowledge.import_snapshots')).rows[0].count;
    for (let i=count; i<32; i++) await pool.query(`INSERT INTO sophie_knowledge.import_snapshots(guild_id,collection_id,sha256,snapshot,snapshot_integrity)
      SELECT guild_id,collection_id,$2,snapshot,snapshot_integrity FROM sophie_knowledge.import_snapshots WHERE sha256=$1`,[firstHash,String(i).padStart(64,'0')]);
    templateVersion = 3; await assert.rejects(imports.refreshPolicies({ actor }),/KNOWLEDGE_IMPORT_CAPACITY/);
    assert.equal((await imports.policiesStatus({ actor })).state,'unavailable');
    assert.equal((await pool.query('SELECT count(*)::int AS count FROM sophie_knowledge.import_snapshots')).rows[0].count,32);
  });
  let syncInvalidations = 0;
  const synced = createKnowledgeLibrary({ ...options, syncAuthorized: async () => true, invalidate: () => { syncInvalidations++; } });
  const wikiDoc = (idBase, title, sections, { revision = 'r1', fetchedAt = Date.now(), authority = 'reference' } = {}) => ({ idBase, sourceRevision: `wiki:page:1:${revision}`,
    documents: packDocuments({ idBase, title, kind: 'wiki-page', authority, url: `https://meridian-wiki.a13.info/wiki/${title.replaceAll(' ','_')}`, rights: 'CC BY-NC-SA 4.0',
      attribution: 'Meridian Wiki contributors', sourceRevision: `wiki:page:1:${revision}`, fetchedAt, sections }).documents });
  const captain = wikiDoc('wiki-captain-aaaaaa', 'Captain', [{ heading: 'Captain › Duties', text: 'Carry the nuclear authentication disk and call the heads to report.' }], { authority: 'policy' });
  const botany = wikiDoc('wiki-botanist-bbbbbb', 'Botanist', [{ heading: 'Botanist › Plants', text: 'Grow ambrosia vulgaris in hydroponics trays with good nutrients.' }]);
  await run('AI19 synced sources publish without review, renew unchanged text quietly and replace changed text', async () => {
    const before = syncInvalidations;
    assert.deepEqual(await synced.mirror.apply('wiki', { entries: [captain, botany], complete: true }), { published: 2, refreshed: 0, unchanged: 0, stale: 0, excluded: 0 });
    assert.equal(syncInvalidations, before + 1);
    assert.deepEqual([...(await synced.mirror.knownRevisions('wiki'))], [['wiki-botanist-bbbbbb','wiki:page:1:r1'],['wiki-captain-aaaaaa','wiki:page:1:r1']]);
    const found = await synced.lookup('how do I become captain on this station', request());
    assert.equal(found[0].title, 'Captain', 'one title word is enough'); assert.equal(await synced.current(found, request()), true);
    assert.deepEqual(await synced.mirror.apply('wiki', { entries: [captain, botany], complete: true }), { published: 0, refreshed: 0, unchanged: 2, stale: 0, excluded: 0 });
    assert.equal(syncInvalidations, before + 1, 'an unchanged sync invalidates nothing');
    const changed = wikiDoc('wiki-captain-aaaaaa', 'Captain', [{ heading: 'Captain › Duties', text: 'Carry the disk; the Blueshield guards you.' }], { revision: 'r2', authority: 'policy' });
    assert.equal((await synced.mirror.apply('wiki', { entries: [changed, botany], complete: true })).published, 1);
    assert.equal(await synced.current(found, request()), false, 'the earlier revision no longer authorizes a reply');
    assert.equal((await pool.query("SELECT count(*)::int AS count FROM sophie_knowledge.chunks WHERE document_id='wiki-captain-aaaaaa' AND text IS NOT NULL")).rows[0].count, 1, 'superseded text is removed');
    const near = wikiDoc('wiki-botanist-bbbbbb', 'Botanist', botany.documents[0].sections, { fetchedAt: Date.now() - 6 * 86400000 });
    await pool.query("UPDATE sophie_knowledge.documents SET valid_until=clock_timestamp()+interval '1 day' WHERE id='wiki-botanist-bbbbbb'");
    assert.equal((await synced.mirror.apply('wiki', { entries: [{ idBase: near.idBase, sourceRevision: near.sourceRevision, unchanged: true }, changed], complete: true })).refreshed, 1);
    assert.ok((await synced.read({ actor, id: 'wiki-botanist-bbbbbb' })).document.validUntil > Date.now() + 6 * 86400000, 'validity renewed for seven days');
  });
  await run('AI20 a complete listing retires removed pages, a partial one does not, and withdrawn or owner-held pages stay out', async () => {
    const changed = wikiDoc('wiki-captain-aaaaaa', 'Captain', [{ heading: 'Captain › Duties', text: 'Carry the disk; the Blueshield guards you.' }], { revision: 'r2', authority: 'policy' });
    assert.equal((await synced.mirror.apply('wiki', { entries: [changed], complete: false })).stale, 0);
    assert.equal((await synced.lookup('ambrosia hydroponics', request())).length, 1);
    assert.equal((await synced.mirror.apply('wiki', { entries: [changed], complete: true })).stale, 1);
    assert.deepEqual(await synced.lookup('ambrosia hydroponics', request()), []);
    assert.equal((await synced.mirror.apply('wiki', { entries: [changed, botany], complete: true })).refreshed, 1);
    assert.equal((await synced.lookup('ambrosia hydroponics', request())).length, 1, 'a page that returns is published again');
    const head = await synced.read({ actor, id: 'wiki-captain-aaaaaa' });
    await synced.withdraw({ actor, id: 'wiki-captain-aaaaaa', expectedEpoch: head.epoch });
    const again = await synced.mirror.apply('wiki', { entries: [changed, botany], complete: true });
    assert.equal(again.excluded, 1); assert.equal((await synced.read({ actor, id: 'wiki-captain-aaaaaa' })).withdrawn, true, 'withdrawal is the exclusion');
    const owned = { ...botany.documents[0], kind: 'owner-publication', validUntil: null, sections: [{ heading: 'Botanist', text: 'Owner-maintained botany notes.' }] };
    const botanyHead = await synced.read({ actor, id: 'wiki-botanist-bbbbbb' }), review = await synced.review({ actor, expectedEpoch: botanyHead.epoch, document: owned });
    await synced.publish({ actor, expectedEpoch: botanyHead.epoch, document: owned, reviewHash: review.reviewHash, requestId: '9a'.repeat(32), confirmed: true });
    assert.equal((await synced.mirror.apply('wiki', { entries: [botany], complete: true })).excluded, 1);
    assert.equal((await synced.read({ actor, id: 'wiki-botanist-bbbbbb' })).document.sections[0].text, 'Owner-maintained botany notes.', 'a hand-published page is the owner\'s');
    await assert.rejects(synced.mirror.apply('site', { entries: [captain] }), /KNOWLEDGE_SYNC_INVALID/, 'a collection cannot write another collection\'s documents');
    await assert.rejects(library.mirror.apply('wiki', { entries: [] }), /KNOWLEDGE_SYNC_UNQUALIFIED/, 'only the qualified sync identity writes');
    assert.deepEqual((await synced.mirror.summary({ actor })).wiki, { current: 1, stale: 0, withdrawn: 1 });
  });
  await run('AI21 lookup matches any query word, uses the recent conversation, and returns at most two passages per document', async () => {
    const guide = { idBase: 'site-guide-cccccc', sourceRevision: 'site:/docs/:1', documents: packDocuments({ idBase: 'site-guide-cccccc', title: 'Mapping guide', kind: 'website', authority: 'reference',
      url: 'https://meridian.a13.info/docs/mapping/', rights: 'Published by the Aphelion project', attribution: 'Meridian Rift website', sourceRevision: 'site:/docs/:1', fetchedAt: Date.now(),
      sections: ['airlocks need cycling sensors', 'airlocks need external doors', 'airlocks need pumps', 'shuttles dock at airlocks'].map((text, index) => ({ heading: `Mapping guide › Part ${index}`, text })) }).documents };
    await synced.mirror.apply('site', { entries: [guide], complete: true });
    const passages = await synced.lookup('which sensors do airlocks need?', request());
    assert.ok(passages.length >= 1 && passages.length <= 2 && passages.every(item => item.title === 'Mapping guide')); assert.match(passages[0].text, /sensors/u);
    assert.match((await synced.lookup('Sophie, what about pumps?', request()))[0].text, /pumps/u, 'her name and filler are not search words');
    assert.deepEqual(await synced.lookup('what about that one', request()), [], 'nothing specific, no conversation: nothing');
    const followUp = await synced.lookup('what about that one', request(), 'Member 1: how do I build airlocks?');
    assert.ok(followUp.length >= 1 && followUp.every(item => item.title === 'Mapping guide'), 'a vague follow-up searches the conversation');
    assert.match((await synced.lookup('airlock sensor', request()))[0].text, /sensors/u, 'a word of five or more letters also matches its longer forms');
    await assert.rejects(synced.lookup('x', request(), 'y'.repeat(4001)), /KNOWLEDGE_QUERY_INVALID/);
    const rules = section => ({ heading: `Policies › Core Rules › ${section.code}`, text: section.text });
    const policy = (idBase, title) => ({ idBase, sourceRevision: 'wiki:page:2:r1', documents: packDocuments({ idBase, title, kind: 'wiki-page', authority: 'policy',
      url: `https://meridian-wiki.a13.info/wiki/${title.replaceAll(' ','_')}`, rights: 'CC BY-NC-SA 4.0', attribution: 'Meridian Wiki contributors', sourceRevision: 'wiki:page:2:r1', fetchedAt: Date.now(),
      sections: [{ code: 'CR 1: The Social Contract CR-01 (Core Rule 1)', text: 'Act with the maturity expected in an adult community.' }, { code: 'CR 9: Station Infrastructure CR-09', text: 'Do not vent the station without cause.' }, { code: 'CR 10: The Rule of Cool CR-10', text: 'A cool scene may bend minor rules if everyone enjoys it.' }].map(rules) }).documents });
    // The same rules transcluded into a second page must not take two of the five slots.
    await synced.mirror.apply('wiki', { entries: [policy('wiki-policies-dddddd', 'Policies'), policy('wiki-server-policies-eeeeee', 'Server Policies')], complete: false });
    for (const question of ['explain CR10 to me', 'what is cr-10?', 'tell me about CR 10']) {
      const found = await synced.lookup(question, request());
      assert.match(found[0]?.heading ?? '', /CR 10/u, question);
      assert.equal(found.filter(item => /Rule of Cool/u.test(item.heading)).length, 1, `identical passages count once: ${question}`);
    }
    // A code is found however chatty the message is, and CR 1 never matches CR 10.
    for (const question of ['My finger slipped :< Anyways, sophie, can you summarize CR 1 for me?', 'CR1', 'what does core rule 1 say']) {
      const found = await synced.lookup(question, request());
      assert.match(found[0]?.heading ?? '', /CR 1: The Social Contract/u, question);
    }
    // A passage that is no longer current is dropped on its own; the other passages are still supplied.
    await admin.query("UPDATE sophie_knowledge.chunks SET text = text || ' (edited outside publication)' WHERE heading LIKE '%CR 9:%'");
    const remaining = await synced.lookup('what do CR 9 and CR 10 say?', request());
    assert.ok(remaining.some(item => /CR 10/u.test(item.heading)) && !remaining.some(item => /CR 9:/u.test(item.heading)));
    // A clear question is ranked by its own words: earlier talk about a tooling "dependency policy" cannot push the
    // blackout rule out of the answer to "what is blackout policy".
    const page = (idBase, title, authority, sections) => ({ idBase, sourceRevision: 'wiki:page:3:r1', documents: packDocuments({ idBase, title, kind: 'wiki-page', authority,
      url: `https://meridian-wiki.a13.info/wiki/${title.replaceAll(' ','_')}`, rights: 'CC BY-NC-SA 4.0', attribution: 'Meridian Wiki contributors', sourceRevision: 'wiki:page:3:r1',
      fetchedAt: Date.now(), sections }).documents });
    await synced.mirror.apply('wiki', { entries: [
      page('wiki-tooling-aaaaaa', 'Tooling', 'reference', [{ heading: 'Tooling › Dependency policy', text: 'The tooling dependency policy pins every package and records compatibility evidence for the release gate.' }]),
      page('wiki-death-bbbbbb', 'Death', 'policy', [{ heading: 'Death › Post Mortality Blackout', text: 'After revival you remember neither your death nor the events leading to it.' }]) ], complete: false });
    const blackout = await synced.lookup('Sophie what is blackout policy', request(), 'Member 1: what is the tooling dependency policy? it pins every package and records compatibility evidence for the release gate');
    assert.match(blackout[0]?.heading ?? '', /Post Mortality Blackout/u);
  });
}
