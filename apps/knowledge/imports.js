import { createHash, randomUUID } from 'node:crypto';
import { ContractError, requireCondition } from '../../contracts/validation.js';
import { POLICIES_SOURCE } from './mediawiki.js';
import { MEDIAWIKI_EXTRACTOR_REVISION } from '../../modules/assistant/knowledge.js';

const sha = value => createHash('sha256').update(value).digest('hex');
const hash = value => sha(JSON.stringify(value));
const ordered = value => Array.isArray(value) ? value.map(ordered) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key,ordered(value[key])])) : value;
const integrity = value => hash(ordered(value));
const collection = POLICIES_SOURCE.id;

function verifySnapshot(snapshot) {
  requireCondition(snapshot?.schema === 1 && snapshot.approved === false && snapshot.collection === collection &&
    JSON.stringify(snapshot.source) === JSON.stringify(POLICIES_SOURCE) && snapshot.page?.pageId === POLICIES_SOURCE.pageId &&
    snapshot.page.title === POLICIES_SOURCE.title && snapshot.site?.rights?.url === POLICIES_SOURCE.licenceUrl &&
    Number.isSafeInteger(snapshot.fetchedAt) && snapshot.fetchedAt > 0 && typeof snapshot.html === 'string' &&
    Buffer.byteLength(snapshot.html) <= 786432 && snapshot.htmlHash === sha(snapshot.html) &&
    Array.isArray(snapshot.dependencies) && snapshot.dependencies.length <= 64 && snapshot.dependencyHash === hash(snapshot.dependencies) &&
    snapshot.snapshotHash === hash({ source: snapshot.source, site: snapshot.site, page: snapshot.page, dependencyHash: snapshot.dependencyHash, htmlHash: snapshot.htmlHash }) &&
    Buffer.byteLength(JSON.stringify(snapshot)) <= 1572864, 'KNOWLEDGE_IMPORT_INVALID');
  return snapshot;
}

/** Every published MediaWiki document must still bind to the current, freshly checked rendered snapshot. */
export async function mediaWikiDocumentCurrent(client, guildId, document) {
  if (document.kind !== 'mediawiki') return true;
  if (document.url !== POLICIES_SOURCE.url || !document.rights.includes(POLICIES_SOURCE.licenceUrl) ||
      !document.attribution.includes('https://meridian-wiki.a13.info/index.php?title=Policies&action=history')) return false;
  const row = (await client.query(`SELECT s.checked_at,p.snapshot,p.snapshot_integrity,p.extraction,p.extraction_integrity FROM sophie_knowledge.import_sources s
    JOIN sophie_knowledge.import_snapshots p ON p.guild_id=s.guild_id AND p.collection_id=s.collection_id AND p.sha256=s.snapshot_sha256
    WHERE s.guild_id=$1 AND s.collection_id=$2 AND s.state='ready' AND s.valid_until>clock_timestamp()
      AND s.snapshot_sha256=$3 AND p.extraction IS NOT NULL`, [guildId,collection,document.dependencyHash])).rows[0];
  return Boolean(row && integrity(row.snapshot) === row.snapshot_integrity && integrity(row.extraction) === row.extraction_integrity &&
    row.extraction.extractorRevision === MEDIAWIKI_EXTRACTOR_REVISION && document.sourceRevision === `page:878:r${row.snapshot.page.revision}` &&
    document.fetchedAt >= row.snapshot.fetchedAt && document.fetchedAt <= row.checked_at.getTime());
}

/** Bind even a first publication review to this source generation, including changes and reversions. */
export async function mediaWikiReviewEpoch(client, guildId, document) {
  if (document.kind !== 'mediawiki') return null;
  return (await client.query('SELECT epoch::text AS epoch FROM sophie_knowledge.import_sources WHERE guild_id=$1 AND collection_id=$2',[guildId,collection])).rows[0]?.epoch ?? null;
}

/** Uses the library's existing authorized transaction/identity guard and lock. No automatic publication. */
export function createWikiImports({ guildId, transaction, collector, extractor, invalidate, clock }) {
  const head = async client => (await client.query('SELECT * FROM sophie_knowledge.import_sources WHERE guild_id=$1 AND collection_id=$2', [guildId,collection])).rows[0];
  async function currentLease(client, fence) {
    const row = await head(client);
    requireCondition(row?.lease_fence === fence && row.lease_until > (await client.query('SELECT clock_timestamp() AS now')).rows[0].now, 'KNOWLEDGE_IMPORT_STALE');
    return row;
  }
  async function unavailable(actor, fence) {
    try {
      await transaction(actor, async client => {
        const row = await head(client); if (row?.lease_fence !== fence) return;
        await client.query("UPDATE sophie_knowledge.import_sources SET epoch=epoch+1,state='unavailable',lease_fence=NULL,lease_until=NULL WHERE guild_id=$1 AND collection_id=$2", [guildId,collection]);
      });
    } finally { invalidate(); }
  }
  return Object.freeze({
    async policiesStatus({ actor }) {
      return transaction(actor, async client => {
        const row = await head(client);
        const at = (await client.query('SELECT clock_timestamp() AS now')).rows[0].now;
        return { collection, available: Boolean(collector && extractor), state: row?.state ?? 'unavailable', epoch: Number(row?.epoch ?? 0),
          snapshotHash: row?.snapshot_sha256 ?? null, checkedAt: row?.checked_at?.getTime() ?? null, validUntil: row?.valid_until?.getTime() ?? null,
          fresh: Boolean(row?.state === 'ready' && row.valid_until > at),
          publishedAutomatically: false };
      });
    },
    async policiesSnapshot({ actor, snapshotHash }) {
      requireCondition(typeof snapshotHash === 'string' && /^[a-f0-9]{64}$/u.test(snapshotHash), 'KNOWLEDGE_HASH_INVALID');
      return transaction(actor, async client => {
        const row = (await client.query('SELECT snapshot,extraction,snapshot_integrity,extraction_integrity FROM sophie_knowledge.import_snapshots WHERE guild_id=$1 AND collection_id=$2 AND sha256=$3', [guildId,collection,snapshotHash])).rows[0];
        requireCondition(row, 'KNOWLEDGE_NOT_FOUND');
        requireCondition(integrity(row.snapshot) === row.snapshot_integrity &&
          (row.extraction === null || integrity(row.extraction) === row.extraction_integrity), 'KNOWLEDGE_IMPORT_CORRUPT');
        // Stored HTML is data for review only. Neither this path nor the importer creates a searchable publication.
        return { collection, snapshotHash, snapshot: row.snapshot, extraction: row.extraction, reviewed: false };
      });
    },
    async refreshPolicies({ actor }) {
      requireCondition(collector && typeof collector.collectPolicies === 'function' && extractor && typeof extractor.extract === 'function', 'KNOWLEDGE_IMPORT_UNAVAILABLE');
      const fence = randomUUID();
      await transaction(actor, async client => {
        await client.query('INSERT INTO sophie_knowledge.import_sources(guild_id,collection_id) VALUES($1,$2) ON CONFLICT DO NOTHING', [guildId,collection]);
        const row = await head(client), at = (await client.query('SELECT clock_timestamp() AS now')).rows[0].now;
        requireCondition(row.lease_until === null || row.lease_until <= at, 'KNOWLEDGE_IMPORT_BUSY');
        await client.query("UPDATE sophie_knowledge.import_sources SET lease_fence=$3,lease_until=clock_timestamp()+interval '60 seconds' WHERE guild_id=$1 AND collection_id=$2", [guildId,collection,fence]);
      });
      try {
        const snapshot = verifySnapshot(await collector.collectPolicies({ timeoutMs: 30000 }));
        requireCondition(snapshot.fetchedAt <= clock() && clock() - snapshot.fetchedAt < 60000, 'KNOWLEDGE_SOURCE_STALE');
        const collected = await transaction(actor, async client => {
          const previous = await currentLease(client,fence);
          const known = (await client.query('SELECT snapshot,snapshot_integrity,extraction,extraction_integrity FROM sophie_knowledge.import_snapshots WHERE guild_id=$1 AND collection_id=$2 AND sha256=$3', [guildId,collection,snapshot.snapshotHash])).rows[0];
          requireCondition(!known || integrity(known.snapshot) === known.snapshot_integrity &&
            (known.extraction === null || integrity(known.extraction) === known.extraction_integrity), 'KNOWLEDGE_IMPORT_CORRUPT');
          requireCondition(!known?.extraction || known.extraction.extractorRevision === MEDIAWIKI_EXTRACTOR_REVISION, 'KNOWLEDGE_EXTRACTOR_CHANGED');
          if (!known) {
            requireCondition((await client.query('SELECT count(*)::int AS count FROM sophie_knowledge.import_snapshots WHERE guild_id=$1 AND collection_id=$2', [guildId,collection])).rows[0].count < 32, 'KNOWLEDGE_IMPORT_CAPACITY');
            await client.query('INSERT INTO sophie_knowledge.import_snapshots(guild_id,collection_id,sha256,snapshot,snapshot_integrity) VALUES($1,$2,$3,$4,$5)', [guildId,collection,snapshot.snapshotHash,snapshot,integrity(snapshot)]);
          }
          const changed = previous.snapshot_sha256 !== snapshot.snapshotHash, ready = Boolean(known?.extraction);
          if (changed) await client.query(`UPDATE sophie_knowledge.documents d SET epoch=d.epoch+1,source_current=false
            FROM sophie_knowledge.publications p WHERE d.guild_id=$1 AND NOT d.withdrawn AND p.guild_id=d.guild_id AND p.document_id=d.id
              AND p.revision=d.revision AND p.document->>'kind'='mediawiki'`,[guildId]);
          await client.query(`UPDATE sophie_knowledge.import_sources SET epoch=epoch+$3,snapshot_sha256=$4,state=$5,checked_at=$6,valid_until=$7
            WHERE guild_id=$1 AND collection_id=$2`, [guildId,collection,changed ? 1 : 0,snapshot.snapshotHash,ready ? 'ready' : 'pending',new Date(snapshot.fetchedAt),new Date(snapshot.fetchedAt + 300000)]);
          return { changed, ready };
        });
        // Commit the changed source boundary before asynchronous parsing or human publication review.
        if (collected.changed || !collected.ready) invalidate();
        if (!collected.ready) {
          const extraction = await extractor.extract(snapshot), { htmlHash, extractHash, ...payload } = extraction;
          requireCondition(htmlHash === snapshot.htmlHash && extractHash === hash(payload) && payload.reviewed === false && payload.extractorRevision === MEDIAWIKI_EXTRACTOR_REVISION &&
            Buffer.byteLength(JSON.stringify(extraction)) <= 3145728, 'KNOWLEDGE_IMPORT_INVALID');
          await transaction(actor, async client => {
            const row = await currentLease(client,fence); requireCondition(row.snapshot_sha256 === snapshot.snapshotHash, 'KNOWLEDGE_IMPORT_STALE');
            await client.query('UPDATE sophie_knowledge.import_snapshots SET extraction=$4,extraction_integrity=$5 WHERE guild_id=$1 AND collection_id=$2 AND sha256=$3 AND extraction IS NULL', [guildId,collection,snapshot.snapshotHash,extraction,integrity(extraction)]);
          });
        }
        await transaction(actor, async client => {
          const row = await currentLease(client,fence); requireCondition(row.snapshot_sha256 === snapshot.snapshotHash, 'KNOWLEDGE_IMPORT_STALE');
          await client.query("UPDATE sophie_knowledge.import_sources SET state='ready',lease_fence=NULL,lease_until=NULL WHERE guild_id=$1 AND collection_id=$2", [guildId,collection]);
        });
        return { collection, snapshotHash: snapshot.snapshotHash, changed: collected.changed, publishedAutomatically: false };
      } catch (error) {
        await unavailable(actor,fence).catch(() => {});
        throw new ContractError(/^(?:KNOWLEDGE|WIKI|OPERATION)_[A-Z_]+$/u.test(error?.message) ? error.message : 'KNOWLEDGE_IMPORT_FAILED');
      }
    },
  });
}
