import { createHash } from 'node:crypto';
import { requireCondition, requireId, requireInteger } from '../../contracts/validation.js';
import { canonicalKnowledgeDocument, requireKnowledgeSourceId } from '../../modules/assistant/knowledge.js';
import { createWikiImports, mediaWikiDocumentCurrent, mediaWikiReviewEpoch } from './imports.js';

const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const hash = value => requireCondition(typeof value === 'string' && /^[a-f0-9]{64}$/.test(value), 'KNOWLEDGE_HASH_INVALID');

/** Approved public records only; this service must use a principal with no case/AI-consent access. */
export function createKnowledgeLibrary({ pool, guildId, authorize, restoreCurrent, clock, collector = null, extractor = null, invalidate = () => {} }) {
  requireId(guildId); requireCondition([authorize, restoreCurrent, clock].every(fn => typeof fn === 'function'), 'TRUSTED_ADAPTERS_REQUIRED');
  async function ready(client = pool) {
    requireCondition(await restoreCurrent() === true, 'KNOWLEDGE_RESTORE_QUARANTINED');
    const role = (await client.query(`SELECT rolsuper,rolbypassrls,has_schema_privilege(current_user,'sophie_core','USAGE') AS core_access,
      has_schema_privilege(current_user,'sophie_ai','USAGE') AS control_access FROM pg_roles WHERE rolname=current_user`)).rows[0];
    requireCondition(role && !role.rolsuper && !role.rolbypassrls && !role.core_access && !role.control_access, 'KNOWLEDGE_IDENTITY_INVALID');
  }
  async function access(actor) { requireCondition(await authorize('ai.knowledge.publish', actor, { guildId }) === true, 'OPERATION_DENIED'); }
  function candidate(expectedEpoch, document) {
    requireInteger(expectedEpoch); const canonical = canonicalKnowledgeDocument(document);
    return { expectedEpoch, document: canonical };
  }
  async function reviewedDigest(client, input) {
    const document = input.document;
    requireCondition(document.fetchedAt <= clock() && (document.validUntil === null || clock() < document.validUntil) &&
      await mediaWikiDocumentCurrent(client,guildId,document), 'KNOWLEDGE_SOURCE_STALE');
    const sourceEpoch = await mediaWikiReviewEpoch(client,guildId,document);
    return digest(sourceEpoch === null ? input : { ...input, sourceEpoch });
  }
  async function transaction(actor, work) {
    await access(actor); const client = await pool.connect(); let broken = false;
    try {
      await client.query('BEGIN'); await client.query('SELECT pg_advisory_xact_lock(182745,58)'); await ready(client);
      const result = await work(client); await access(actor); requireCondition(await restoreCurrent() === true, 'KNOWLEDGE_RESTORE_QUARANTINED');
      await client.query('COMMIT'); return result;
    } catch (error) { try { await client.query('ROLLBACK'); } catch { broken = true; } throw error; }
    finally { client.release(broken); }
  }
  const head = async (client, id) => (await client.query('SELECT * FROM sophie_knowledge.documents WHERE guild_id=$1 AND id=$2', [guildId,id])).rows[0];
  async function available(sources, request, referencesOnly = false) {
    if (request.guildId !== guildId || clock() >= request.deadline) return false;
    await ready();
    for (const source of sources) {
      requireKnowledgeSourceId(source.id);
      const row = (await pool.query(`SELECT c.text,c.title,c.heading,c.url,c.authority,p.document,p.sha256 FROM sophie_knowledge.chunks c JOIN sophie_knowledge.documents d ON d.guild_id=c.guild_id AND d.id=c.document_id
        JOIN sophie_knowledge.publications p ON p.guild_id=c.guild_id AND p.document_id=c.document_id AND p.revision=c.revision
        WHERE c.guild_id=$1 AND c.source_id=$2 AND c.publication_sha256=$3 AND c.revision=d.revision AND d.epoch=$4
          AND NOT d.withdrawn AND d.source_current AND (d.valid_until IS NULL OR d.valid_until>clock_timestamp()) AND c.text IS NOT NULL`,
      [guildId,source.id,source.publicationHash,source.epoch])).rows[0];
      if (!row) return false;
      const document = canonicalKnowledgeDocument(row.document), section = document.sections[Number(source.id.split('.s').at(-1))];
      if (!await mediaWikiDocumentCurrent(pool,guildId,document)) return false;
      if (digest(document) !== row.sha256 || !section || row.text !== section.text || row.heading !== section.heading || row.title !== document.title || row.url !== document.url || row.authority !== document.authority ||
        !referencesOnly && (source.text !== row.text || source.url !== row.url || source.authority !== row.authority || source.title !== document.title ||
        source.rights !== document.rights || source.attribution !== document.attribution || source.sourceRevision !== document.sourceRevision || source.validUntil !== document.validUntil)) return false;
    }
    return clock() < request.deadline && await restoreCurrent() === true;
  }
  return Object.freeze({
    ...createWikiImports({ guildId, transaction, collector, extractor, invalidate, clock }),
    async catalogue({ actor }) {
      return transaction(actor, async client => {
        const rows = (await client.query(`SELECT d.id,d.epoch,d.revision,d.withdrawn,d.source_current AS "sourceCurrent",
          d.valid_until AS "validUntil",p.document->>'title' AS title,p.document-'sections'-'aliases' AS source FROM sophie_knowledge.documents d JOIN sophie_knowledge.publications p
          ON p.guild_id=d.guild_id AND p.document_id=d.id AND p.revision=d.revision WHERE d.guild_id=$1 ORDER BY d.id LIMIT 500`, [guildId])).rows;
        const documents = [];
        for (const { source, ...row } of rows) documents.push({ ...row, epoch: Number(row.epoch),
          sourceCurrent: !row.withdrawn && row.sourceCurrent && (row.validUntil === null || clock() < row.validUntil.getTime()) && await mediaWikiDocumentCurrent(client,guildId,source) });
        return { documents };
      });
    },
    async read({ actor, id }) {
      requireCondition(typeof id === 'string' && /^[a-z][a-z0-9-]{0,47}$/.test(id), 'KNOWLEDGE_DOCUMENT_INVALID');
      return transaction(actor, async client => {
        const previous = await head(client,id); requireCondition(previous, 'KNOWLEDGE_NOT_FOUND');
        const row = (await client.query('SELECT document,sha256 FROM sophie_knowledge.publications WHERE guild_id=$1 AND document_id=$2 AND revision=$3',[guildId,id,previous.revision])).rows[0];
        const document = previous.withdrawn ? null : canonicalKnowledgeDocument(row.document);
        requireCondition(document === null || digest(document) === row.sha256, 'KNOWLEDGE_PUBLICATION_CORRUPT');
        const sourceCurrent = !previous.withdrawn && previous.source_current && (document.validUntil === null || clock() < document.validUntil) && await mediaWikiDocumentCurrent(client,guildId,document);
        return { id, epoch: Number(previous.epoch), revision: previous.revision, withdrawn: previous.withdrawn, sourceCurrent, document };
      });
    },
    async review({ actor, expectedEpoch, document }) {
      const input = candidate(expectedEpoch, document);
      return transaction(actor, async client => { const previous = await head(client,input.document.id);
        const reviewHash = await reviewedDigest(client,input);
        requireCondition(Number(previous?.epoch ?? 0) === expectedEpoch, 'KNOWLEDGE_STALE');
        return { ...input, reviewHash, previous: previous ? { epoch: Number(previous.epoch), revision: previous.revision, withdrawn: previous.withdrawn } : null }; });
    },
    async publish({ actor, expectedEpoch, document, reviewHash, requestId, confirmed }) {
      const input = candidate(expectedEpoch,document); hash(reviewHash); hash(requestId); requireCondition(confirmed === true, 'KNOWLEDGE_REVIEW_STALE');
      requireId(actor.userId);
      return transaction(actor, async client => {
        const receipt = (await client.query('SELECT * FROM sophie_knowledge.receipts WHERE guild_id=$1 AND request_id=$2', [guildId,requestId])).rows[0];
        if (receipt) { requireCondition(receipt.actor_id === actor.userId && receipt.review_sha256 === reviewHash && receipt.input_sha256 === digest(input), 'KNOWLEDGE_REQUEST_COLLISION'); return { revision: receipt.revision, duplicate: true }; }
        requireCondition(await reviewedDigest(client,input) === reviewHash, 'KNOWLEDGE_REVIEW_STALE');
        const previous = await head(client,input.document.id); requireCondition(Number(previous?.epoch ?? 0) === expectedEpoch, 'KNOWLEDGE_STALE');
        if (!previous) requireCondition(Number((await client.query('SELECT count(*)::int AS count FROM sophie_knowledge.documents WHERE guild_id=$1', [guildId])).rows[0].count) < 500, 'KNOWLEDGE_LIMIT');
        const revision = (previous?.revision ?? 0) + 1, epoch = expectedEpoch + 1, publicationHash = digest(input.document); requireInteger(revision,1,2147483646);
        const doc = input.document;
        await client.query(`INSERT INTO sophie_knowledge.documents(guild_id,id,epoch,revision,withdrawn,source_current,valid_until)
          VALUES($1,$2,$3,$4,false,true,$5) ON CONFLICT(guild_id,id) DO UPDATE SET epoch=$3,revision=$4,withdrawn=false,source_current=true,valid_until=$5`,
        [guildId,doc.id,epoch,revision,doc.validUntil === null ? null : new Date(doc.validUntil)]);
        await client.query('INSERT INTO sophie_knowledge.publications(guild_id,document_id,revision,sha256,document) VALUES($1,$2,$3,$4,$5)', [guildId,doc.id,revision,publicationHash,doc]);
        for (const [index, section] of doc.sections.entries()) await client.query(`INSERT INTO sophie_knowledge.chunks
          (guild_id,document_id,revision,source_id,publication_sha256,title,heading,text,url,authority,aliases,search)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,to_tsvector('english',$6 || ' ' || $7 || ' ' || $8))`,
        [guildId,doc.id,revision,`${doc.id}.r${revision}.s${index}`,publicationHash,doc.title,section.heading,section.text,doc.url,doc.authority,doc.aliases]);
        await client.query('INSERT INTO sophie_knowledge.receipts(guild_id,request_id,actor_id,review_sha256,document_id,revision,input_sha256) VALUES($1,$2,$3,$4,$5,$6,$7)', [guildId,requestId,actor.userId,reviewHash,doc.id,revision,digest(input)]);
        return { revision, epoch, duplicate: false };
      });
    },
    async withdraw({ actor, id, expectedEpoch }) {
      requireCondition(typeof id === 'string' && /^[a-z][a-z0-9-]{0,47}$/.test(id), 'KNOWLEDGE_DOCUMENT_INVALID'); requireInteger(expectedEpoch,1);
      return transaction(actor, async client => {
        const previous = await head(client,id);
        // Resolve an identical lost acknowledgement only while its resulting tombstone is still current.
        if (previous?.withdrawn && Number(previous.epoch) === expectedEpoch + 1) return { epoch: expectedEpoch + 1, withdrawn: true, duplicate: true };
        requireCondition(Number(previous?.epoch) === expectedEpoch, 'KNOWLEDGE_STALE');
        await client.query('UPDATE sophie_knowledge.documents SET epoch=epoch+1,withdrawn=true,source_current=false WHERE guild_id=$1 AND id=$2', [guildId,id]);
        // Metadata/tombstones remain; no previous text revision stays readable through history or FTS.
        await client.query('UPDATE sophie_knowledge.publications SET document=NULL WHERE guild_id=$1 AND document_id=$2', [guildId,id]);
        await client.query("UPDATE sophie_knowledge.chunks SET text=NULL,title='',heading='',aliases='{}',search=''::tsvector WHERE guild_id=$1 AND document_id=$2", [guildId,id]);
        return { epoch: expectedEpoch + 1, withdrawn: true };
      });
    },
    async markSourceStale({ actor, id, expectedEpoch }) {
      requireCondition(typeof id === 'string' && /^[a-z][a-z0-9-]{0,47}$/.test(id), 'KNOWLEDGE_DOCUMENT_INVALID'); requireInteger(expectedEpoch,1);
      return transaction(actor, async client => {
        requireCondition(Number((await head(client,id))?.epoch) === expectedEpoch,'KNOWLEDGE_STALE');
        await client.query('UPDATE sophie_knowledge.documents SET epoch=epoch+1,source_current=false WHERE guild_id=$1 AND id=$2',[guildId,id]); return { epoch: expectedEpoch + 1 };
      });
    },
    async lookup(query, request) {
      requireCondition(typeof query === 'string' && query.trim().length > 0 && query.length <= 4000 && request.guildId === guildId && clock() < request.deadline, 'KNOWLEDGE_QUERY_INVALID');
      await ready();
      const rows = (await pool.query(`SELECT c.source_id AS id,c.title,c.heading,c.text,c.url,c.authority,c.publication_sha256 AS "publicationHash",d.epoch,d.valid_until AS "validUntil",
        p.document->>'rights' AS rights,p.document->>'attribution' AS attribution,p.document->>'sourceRevision' AS "sourceRevision",
        (lower(c.title)=lower($2) OR EXISTS(SELECT 1 FROM unnest(c.aliases) alias WHERE lower(alias)=lower($2))) AS exact
        FROM sophie_knowledge.chunks c JOIN sophie_knowledge.documents d ON d.guild_id=c.guild_id AND d.id=c.document_id
        JOIN sophie_knowledge.publications p ON p.guild_id=c.guild_id AND p.document_id=c.document_id AND p.revision=c.revision
        WHERE c.guild_id=$1 AND c.revision=d.revision AND c.text IS NOT NULL AND NOT d.withdrawn AND d.source_current
          AND (d.valid_until IS NULL OR d.valid_until>clock_timestamp()) AND
          (lower(c.title)=lower($2) OR EXISTS(SELECT 1 FROM unnest(c.aliases) alias WHERE lower(alias)=lower($2)) OR c.search @@ plainto_tsquery('english',$2))
        ORDER BY exact DESC,ts_rank(c.search,plainto_tsquery('english',$2)) DESC,c.source_id LIMIT 4`, [guildId,query])).rows.map(row => ({ ...row, epoch: Number(row.epoch), validUntil: row.validUntil?.getTime() ?? null }));
      return await available(rows,request) ? rows : [];
    },
    current: available,
    currentReferences: (sources, request) => available(sources, request, true),
  });
}
