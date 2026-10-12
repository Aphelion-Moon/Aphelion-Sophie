import { createHash } from 'node:crypto';
import { requireCondition } from '../../contracts/validation.js';
import { canonicalKnowledgeDocument, SYNCED_KNOWLEDGE_KINDS } from '../../modules/assistant/knowledge.js';

const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const SYNC_PREFIXES = Object.freeze(['wiki', 'site', 'gh']);
export const SYNC_DOCUMENT_LIMIT = 2000;
const REFRESH_BEFORE_MS = 2 * 86400000;
const comparable = document => { const { fetchedAt: _fetched, validUntil: _valid, ...rest } = canonicalKnowledgeDocument(document); return digest(rest); };
const partOf = (id, base) => id === base || id.startsWith(`${base}-p`) && /^\d+$/u.test(id.slice(base.length + 2));

/** Shared by owner publication and the mirror so both index title, aliases and headings above body text. */
export const CHUNK_SEARCH_SQL = `setweight(to_tsvector('english',$6),'A') || setweight(to_tsvector('english',array_to_string($11::text[],' ')),'A') ||
  setweight(to_tsvector('english',$7),'B') || to_tsvector('english',$8)`;

export async function insertPublication(client, guildId, doc, revision, epoch, publicationHash) {
  await client.query(`INSERT INTO sophie_knowledge.documents(guild_id,id,epoch,revision,withdrawn,source_current,valid_until)
    VALUES($1,$2,$3,$4,false,true,$5) ON CONFLICT(guild_id,id) DO UPDATE SET epoch=$3,revision=$4,withdrawn=false,source_current=true,valid_until=$5`,
  [guildId,doc.id,epoch,revision,doc.validUntil === null ? null : new Date(doc.validUntil)]);
  await client.query('INSERT INTO sophie_knowledge.publications(guild_id,document_id,revision,sha256,document) VALUES($1,$2,$3,$4,$5)', [guildId,doc.id,revision,publicationHash,doc]);
  for (const [index, section] of doc.sections.entries()) await client.query(`INSERT INTO sophie_knowledge.chunks
    (guild_id,document_id,revision,source_id,publication_sha256,title,heading,text,url,authority,aliases,search)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,${CHUNK_SEARCH_SQL})`,
  [guildId,doc.id,revision,`${doc.id}.r${revision}.s${index}`,publicationHash,doc.title,section.heading,section.text,doc.url,doc.authority,doc.aliases]);
}

/**
 * Owner decision, 12 October 2026: synced public sources publish without a review click. The mirror owns only documents
 * whose current publication has a synced kind. A document the owner withdrew stays out (withdrawal is the exclusion),
 * and one the owner re-published by hand is the owner's from then on. Rows are never deleted: superseded revisions keep
 * metadata only, like a withdrawal.
 */
export function createSourceMirror({ guildId, syncTransaction, editorTransaction, invalidate, clock }) {
  requireCondition([syncTransaction, editorTransaction, invalidate, clock].every(fn => typeof fn === 'function'), 'TRUSTED_ADAPTERS_REQUIRED');
  const rowsFor = async (client, prefix) => (await client.query(`SELECT d.id,d.epoch,d.revision,d.withdrawn,d.source_current,d.valid_until,p.document
    FROM sophie_knowledge.documents d LEFT JOIN sophie_knowledge.publications p ON p.guild_id=d.guild_id AND p.document_id=d.id AND p.revision=d.revision
    WHERE d.guild_id=$1 AND d.id LIKE $2 ORDER BY d.id`, [guildId, `${prefix}-%`])).rows;
  const owned = row => !row.withdrawn && row.document && SYNCED_KNOWLEDGE_KINDS.includes(row.document.kind);
  async function retire(client, row) {
    await client.query('UPDATE sophie_knowledge.publications SET document=NULL WHERE guild_id=$1 AND document_id=$2 AND revision=$3', [guildId,row.id,row.revision]);
    await client.query("UPDATE sophie_knowledge.chunks SET text=NULL,title='',heading='',aliases='{}',search=''::tsvector WHERE guild_id=$1 AND document_id=$2 AND revision=$3", [guildId,row.id,row.revision]);
  }
  return Object.freeze({
    /** idBase → sourceRevision of current synced documents, so a collector can skip unchanged sources. */
    async knownRevisions(prefix) {
      requireCondition(SYNC_PREFIXES.includes(prefix), 'KNOWLEDGE_SYNC_INVALID');
      return syncTransaction(async client => new Map((await rowsFor(client, prefix))
        .filter(row => owned(row) && row.source_current && !/-p\d+$/u.test(row.id)).map(row => [row.id, row.document.sourceRevision])));
    },
    async apply(prefix, result) {
      requireCondition(SYNC_PREFIXES.includes(prefix) && Array.isArray(result?.entries), 'KNOWLEDGE_SYNC_INVALID');
      const counts = { published: 0, refreshed: 0, unchanged: 0, stale: 0, excluded: 0 };
      const changed = await syncTransaction(async client => {
        const now = clock(), rows = await rowsFor(client, prefix), byId = new Map(rows.map(row => [row.id, row]));
        const desired = new Map();
        for (const entry of result.entries) {
          requireCondition(typeof entry?.idBase === 'string' && entry.idBase.startsWith(`${prefix}-`), 'KNOWLEDGE_SYNC_INVALID');
          // Withdrawing the first part excludes the whole source.
          if (byId.get(entry.idBase)?.withdrawn) { counts.excluded++; continue; }
          if (entry.unchanged) {
            for (const row of rows) if (partOf(row.id, entry.idBase) && owned(row) && row.document.sourceRevision === entry.sourceRevision)
              desired.set(row.id, { ...canonicalKnowledgeDocument(row.document), refresh: true });
            continue;
          }
          for (const doc of entry.documents) {
            const canonical = canonicalKnowledgeDocument(doc);
            requireCondition(SYNCED_KNOWLEDGE_KINDS.includes(canonical.kind) && partOf(canonical.id, entry.idBase), 'KNOWLEDGE_SYNC_INVALID');
            desired.set(canonical.id, canonical);
          }
        }
        requireCondition(desired.size <= SYNC_DOCUMENT_LIMIT, 'KNOWLEDGE_SYNC_CAPACITY');
        let changes = 0;
        for (const [id, wanted] of desired) {
          const row = byId.get(id);
          if (row?.withdrawn) { counts.excluded++; continue; }
          if (row && !owned(row)) { counts.excluded++; continue; }
          const { refresh = false, ...candidate } = wanted;
          const current = row?.document ?? null;
          // Everything but the fetch window counts, so a changed citation line (rights, attribution) is republished too.
          const same = current && comparable(current) === comparable(candidate);
          if (same && row.source_current && row.valid_until && row.valid_until.getTime() - now > REFRESH_BEFORE_MS) { counts.unchanged++; continue; }
          // Unchanged content verified current at this sync: renew its validity window without re-reading the text.
          const doc = canonicalKnowledgeDocument(same || refresh ? { ...(current ?? candidate), fetchedAt: now, validUntil: now + 7 * 86400000 } : candidate);
          const revision = (row?.revision ?? 0) + 1, epoch = Number(row?.epoch ?? 0) + 1;
          if (row) await retire(client, row);
          await insertPublication(client, guildId, doc, revision, epoch, digest(doc));
          if (same || refresh) counts.refreshed++; else counts.published++;
          changes++;
        }
        // A complete listing proves absence; a partial one (some pages failed) only adds and renews.
        if (result.complete !== false) for (const row of rows) {
          if (desired.has(row.id) || !owned(row) || !row.source_current) continue;
          await client.query('UPDATE sophie_knowledge.documents SET epoch=epoch+1,source_current=false WHERE guild_id=$1 AND id=$2', [guildId,row.id]);
          counts.stale++; changes++;
        }
        return changes;
      });
      if (changed) invalidate();
      return counts;
    },
    async summary({ actor }) {
      return editorTransaction(actor, async client => {
        const rows = (await client.query(`SELECT split_part(d.id,'-',1) AS prefix,
          count(*) FILTER (WHERE NOT d.withdrawn AND d.source_current AND (d.valid_until IS NULL OR d.valid_until>clock_timestamp()))::int AS current,
          count(*) FILTER (WHERE NOT d.withdrawn AND NOT d.source_current)::int AS stale,
          count(*) FILTER (WHERE d.withdrawn)::int AS withdrawn
          FROM sophie_knowledge.documents d WHERE d.guild_id=$1 AND split_part(d.id,'-',1) = ANY($2) GROUP BY 1`, [guildId, [...SYNC_PREFIXES]])).rows;
        return Object.fromEntries(SYNC_PREFIXES.map(prefix => { const row = rows.find(item => item.prefix === prefix);
          return [prefix, { current: row?.current ?? 0, stale: row?.stale ?? 0, withdrawn: row?.withdrawn ?? 0 }]; }));
      });
    },
  });
}
