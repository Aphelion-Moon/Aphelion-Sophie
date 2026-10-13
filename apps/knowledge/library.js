import { createHash } from 'node:crypto';
import { requireCondition, requireId, requireInteger } from '../../contracts/validation.js';
import { canonicalKnowledgeDocument, requireKnowledgeSourceId } from '../../modules/assistant/knowledge.js';
import { createWikiImports, mediaWikiDocumentCurrent, mediaWikiReviewEpoch } from './imports.js';
import { createSourceMirror, insertPublication, SYNC_PREFIXES } from './mirror.js';

const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const hash = value => requireCondition(typeof value === 'string' && /^[a-f0-9]{64}$/.test(value), 'KNOWLEDGE_HASH_INVALID');

/** Approved public records only; this service must use a principal with no case/AI-consent access. */
export function createKnowledgeLibrary({ pool, guildId, authorize, restoreCurrent, clock, collector = null, extractor = null, invalidate = () => {}, syncAuthorized = async()=>false }) {
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
  async function runTransaction(check,work) {
    await check(); const client = await pool.connect(); let broken = false;
    try {
      await client.query('BEGIN'); await client.query('SELECT pg_advisory_xact_lock(182745,58)'); await ready(client);
      const result = await work(client); await check(); requireCondition(await restoreCurrent() === true, 'KNOWLEDGE_RESTORE_QUARANTINED');
      await client.query('COMMIT'); return result;
    } catch (error) { try { await client.query('ROLLBACK'); } catch { broken = true; } throw error; }
    finally { client.release(broken); }
  }
  const transaction=(actor,work)=>runTransaction(()=>access(actor),work);
  const syncTransaction=work=>runTransaction(async()=>requireCondition(await syncAuthorized()===true,'KNOWLEDGE_SYNC_UNQUALIFIED'),work);
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
    ...createWikiImports({ guildId, transaction, syncTransaction, collector, extractor, invalidate, clock }),
    mirror: createSourceMirror({ guildId, syncTransaction, editorTransaction: transaction, invalidate, clock }),
    async catalogue({ actor }) {
      return transaction(actor, async client => {
        const rows = (await client.query(`SELECT d.id,d.epoch,d.revision,d.withdrawn,d.source_current AS "sourceCurrent",
          d.valid_until AS "validUntil",p.document->>'title' AS title,p.document-'sections'-'aliases' AS source FROM sophie_knowledge.documents d JOIN sophie_knowledge.publications p
          ON p.guild_id=d.guild_id AND p.document_id=d.id AND p.revision=d.revision WHERE d.guild_id=$1 ORDER BY d.id LIMIT 2500`, [guildId])).rows;
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
        // Synced sources have their own cap (mirror.js); this one bounds owner-written documents.
        if (!previous) requireCondition(Number((await client.query("SELECT count(*)::int AS count FROM sophie_knowledge.documents WHERE guild_id=$1 AND NOT split_part(id,'-',1) = ANY($2)",
          [guildId,[...SYNC_PREFIXES]])).rows[0].count) < 500, 'KNOWLEDGE_LIMIT');
        const revision = (previous?.revision ?? 0) + 1, epoch = expectedEpoch + 1, publicationHash = digest(input.document); requireInteger(revision,1,2147483646);
        const doc = input.document;
        await insertPublication(client, guildId, doc, revision, epoch, publicationHash);
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
    /**
     * Chat questions rarely contain every word of a passage, so any query word may match. Each word counts by its rarity
     * across the published passages ("station" little, "CR" a lot), more in a title or alias and a little more in a
     * heading; words of five or more letters also match longer words ("antag" finds "antagonist"). A passage qualifies
     * when its words cover half of the question's weight (a third if they are in its title), or with one word plus one from
     * the recent conversation, which counts half. Her name and question filler ("explain", "supposed", "wiki") are not
     * search words unless nothing else is left. Identical passages (a page transcluded into another) count once; at most
     * two passages per document; a page the question names leads with its opening sections. A rule code in the question
     * ("CR 1", "CR1", "CR-01", "Core Rule 1") selects the passages whose heading carries that code, first, whatever else
     * the message says: "CR" and "1" are too common for the word weights to find them in a chatty message.
     */
    async lookup(query, request, conversation = '') {
      requireCondition(typeof query === 'string' && query.trim().length > 0 && query.length <= 4000 && typeof conversation === 'string' && conversation.length <= 4000 &&
        request.guildId === guildId && clock() < request.deadline, 'KNOWLEDGE_QUERY_INVALID');
      await ready();
      // Rule codes are written CR10, CR 10 or CR-10; the pages index "cr" and "10", so a joined code also searches its parts.
      const codes = value => value.replace(/\b(\p{L}{1,8})-?(\d{1,4})\b/gu, '$&  $1 $2');
      const filler = /\b(?:sophie|soph|explain|tell|say|says|said|know|supposed|mean|means|please|pls|omg|lol|wiki|page|whats|hows|whos|wheres|whys|thats|dont|cant|wont|isnt|arent|im|ive|youre|gonna|wanna|gotta)\b/giu;
      const terms = codes(query), recent = codes(conversation).replace(filler, ' '), focus = terms.replace(filler, ' ');
      // Heading patterns for the codes asked about; "CR 1" never matches "CR 10". Only letters and digits reach the pattern.
      const named = [...new Set([...query.matchAll(/(?<![\p{L}\p{N}])(\p{L}{1,10})[ -]?0*(\d{1,4})(?![\p{L}\p{N}])/gu)]
        .map(([, letters, number]) => `(^|[^[:alnum:]])${letters.toLowerCase()}[ -]?0*${Number(number)}([^0-9]|$)`))].slice(0, 4);
      // Constant text for ts_stat (word rarity); only the validated guild ID is formatted into it, as a literal.
      const live = `FROM sophie_knowledge.chunks c JOIN sophie_knowledge.documents d ON d.guild_id=c.guild_id AND d.id=c.document_id
        WHERE c.guild_id=%L AND c.revision=d.revision AND c.text IS NOT NULL AND NOT d.withdrawn AND d.source_current AND (d.valid_until IS NULL OR d.valid_until>clock_timestamp())`;
      const rows = (await pool.query(`WITH terms AS (
          SELECT coalesce(nullif(ARRAY(SELECT DISTINCT lexeme FROM unnest(to_tsvector('english',$4))),'{}'),ARRAY(SELECT DISTINCT lexeme FROM unnest(to_tsvector('english',$3)))) AS current,
            ARRAY(SELECT DISTINCT lexeme FROM unnest(to_tsvector('english',$5))) AS spoken
        ), stat AS (
          SELECT word, ndoc FROM ts_stat(format('SELECT c.search ${live}', $1::text))
        ), total AS (
          SELECT greatest(count(*),1)::float8 AS passages FROM sophie_knowledge.chunks c JOIN sophie_knowledge.documents d ON d.guild_id=c.guild_id AND d.id=c.document_id
          WHERE c.guild_id=$1 AND c.revision=d.revision AND c.text IS NOT NULL AND NOT d.withdrawn AND d.source_current AND (d.valid_until IS NULL OR d.valid_until>clock_timestamp())
        ), asked AS (
          SELECT unnest(t.current) AS term, false AS recent FROM terms t
          UNION SELECT word, true FROM terms t, unnest(t.spoken) word WHERE NOT word = ANY(t.current)
        ), base_terms AS (
          SELECT a.term, a.recent, ln(1 + total.passages / max(s.ndoc)) AS idf FROM asked a CROSS JOIN total
          JOIN stat s ON s.word = a.term OR length(a.term) >= 5 AND left(s.word, length(a.term)) = a.term GROUP BY a.term, a.recent, total.passages
        ), query_terms AS (
          -- A follow-up with nothing specific of its own ("what about the other one?") searches the conversation instead.
          SELECT b.term, b.recent AND NOT w.vague AS recent, b.idf FROM base_terms b,
            (SELECT coalesce(sum(idf) FILTER (WHERE NOT recent),0) < 1.9 AS vague FROM base_terms) w
        ), need AS (
          SELECT coalesce(sum(idf) FILTER (WHERE NOT recent),0) AS wanted,
            to_tsquery('simple', coalesce(string_agg(quote_literal(term) || CASE WHEN length(term) >= 5 THEN ':*' ELSE '' END, ' | '),'')) AS probe FROM query_terms
        ), matched AS (
          SELECT c.source_id AS id,c.document_id,c.title,c.heading,c.text,c.url,c.authority,c.publication_sha256 AS "publicationHash",d.epoch,d.valid_until AS "validUntil",
            p.document->>'rights' AS rights,p.document->>'attribution' AS attribution,p.document->>'sourceRevision' AS "sourceRevision",
            (lower(c.title)=lower($2) OR EXISTS(SELECT 1 FROM unnest(c.aliases) alias WHERE lower(alias)=lower($2))) AS exact,
            m.*, n.wanted, ts_rank(c.search,n.probe,1) AS rank,
            c.document_id NOT LIKE '%-p%' AND c.source_id ~ '\\.s[01]$' AS opening,
            EXISTS(SELECT 1 FROM unnest($6::text[]) code WHERE c.heading ~* code) AS coded
          FROM need n, sophie_knowledge.chunks c JOIN sophie_knowledge.documents d ON d.guild_id=c.guild_id AND d.id=c.document_id
          JOIN sophie_knowledge.publications p ON p.guild_id=c.guild_id AND p.document_id=c.document_id AND p.revision=c.revision
          CROSS JOIN LATERAL (
            SELECT coalesce(sum(q.idf * CASE WHEN q.recent THEN 0.5 ELSE f.factor END),0) AS score,
              coalesce(sum(q.idf) FILTER (WHERE NOT q.recent),0) AS covered, coalesce(sum(q.idf) FILTER (WHERE NOT q.recent AND f.title),0) AS title_covered,
              count(*) FILTER (WHERE NOT q.recent) AS hits, coalesce(sum(q.idf) FILTER (WHERE q.recent),0) AS context_covered
            FROM query_terms q CROSS JOIN LATERAL (
              SELECT max(CASE WHEN 'A' = ANY(u.weights) THEN 1.75 WHEN 'B' = ANY(u.weights) THEN 1.5 ELSE 1 END) AS factor, bool_or('A' = ANY(u.weights)) AS title
              FROM unnest(c.search) u WHERE u.lexeme = q.term OR length(q.term) >= 5 AND left(u.lexeme, length(q.term)) = q.term) f
            WHERE f.factor IS NOT NULL) m
          WHERE c.guild_id=$1 AND c.revision=d.revision AND c.text IS NOT NULL AND NOT d.withdrawn AND d.source_current
            AND (d.valid_until IS NULL OR d.valid_until>clock_timestamp()) AND
            (lower(c.title)=lower($2) OR EXISTS(SELECT 1 FROM unnest(c.aliases) alias WHERE lower(alias)=lower($2)) OR c.search @@ n.probe
              OR EXISTS(SELECT 1 FROM unnest($6::text[]) code WHERE c.heading ~* code))
        ), ranked AS (
          SELECT *, score + CASE WHEN opening AND title_covered > 0 AND title_covered >= wanted / 3 THEN 4 ELSE 0 END AS total_score
          -- A passage needs at least one fairly specific word (in at most about one passage in six: ln 7 = 1.95) unless the conversation backs it.
          FROM matched WHERE exact OR coded OR hits >= 1 AND covered >= 1.9 AND covered >= wanted / 2 OR title_covered > 0 AND title_covered >= wanted / 3 OR hits >= 1 AND context_covered >= 3
        ), kept AS (
          SELECT *, row_number() OVER (PARTITION BY document_id ORDER BY exact DESC,coded DESC,total_score DESC,rank DESC,id) AS within,
            row_number() OVER (PARTITION BY md5(text) ORDER BY exact DESC,coded DESC,total_score DESC,rank DESC,id) AS copy FROM ranked
        )
        SELECT id,title,heading,text,url,authority,"publicationHash",epoch,"validUntil",rights,attribution,"sourceRevision",exact FROM kept
        WHERE (within<=2 OR coded) AND copy=1 ORDER BY exact DESC,coded DESC,total_score DESC,rank DESC,id LIMIT 5`,
      [guildId,query,terms,focus,recent,named])).rows.map(row => ({ ...row, epoch: Number(row.epoch), validUntil: row.validUntil?.getTime() ?? null }));
      // Each passage is checked on its own: one that is no longer current is dropped, not every passage with it.
      const kept = [];
      for (const row of rows) if (await available([row], request)) kept.push(row);
      return clock() < request.deadline ? kept : [];
    },
    current: available,
    currentReferences: (sources, request) => available(sources, request, true),
  });
}
