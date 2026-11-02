// A pinned knowledge snapshot for AI evaluation (workplan P55a). Synced documents change revision at least weekly, so a
// gate run on the live knowledge base drifts; a snapshot freezes the published documents and loads them into a disposable
// test cluster through the same insertPublication the mirror and owner publication use, so search vectors match.
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { canonicalKnowledgeDocument } from '../../../modules/assistant/knowledge.js';
import { insertPublication } from '../../../apps/knowledge/mirror.js';
import { familyOf } from '../../../apps/knowledge/source-family.js';
import { goldMatches } from './asserts.mjs';

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const digest = value => sha256(JSON.stringify(value));
const VALID_FOR_MS = 6 * 86400000;

/** documents.json (canonical documents) checked against manifest.json's SHA-256. */
export async function readSnapshot(directory) {
  const manifest = JSON.parse(await readFile(resolve(directory, 'manifest.json'), 'utf8'));
  const bytes = await readFile(resolve(directory, 'documents.json'));
  if (sha256(bytes) !== manifest.sha256) throw new Error('AI_EVAL_SNAPSHOT_CHANGED');
  const documents = JSON.parse(bytes.toString('utf8'));
  if (!Array.isArray(documents) || documents.length !== manifest.documents) throw new Error('AI_EVAL_SNAPSHOT_INVALID');
  return { manifest, documents };
}

/**
 * Documents as they load for an evaluation run, overlays last (an overlay replaces a snapshot document with its ID).
 * Freshness is re-stamped to the load time. Policies-importer documents (kind mediawiki) only stay current beside their
 * import snapshot tables, which a snapshot does not carry; for evaluation they load as owner publications.
 */
export function documentsForLoad(documents, now, overlays = []) {
  const byId = new Map();
  for (const value of [...documents, ...overlays]) {
    const kind = value.kind === 'mediawiki' ? 'owner-publication' : value.kind;
    const validUntil = value.validUntil === null && kind === 'owner-publication' ? null : now + VALID_FOR_MS;
    const document = canonicalKnowledgeDocument({ ...value, kind, fetchedAt: now, validUntil });
    byId.set(document.id, document);
  }
  return [...byId.values()].sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0);
}

/** Inserts revision 1 of every document; returns the loaded documents with their publication hashes. */
export async function loadDocuments(pool, guildId, documents) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const document of documents) await insertPublication(client, guildId, document, 1, 1, digest(document));
    await client.query('COMMIT');
  } catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; }
  finally { client.release(); }
  return documents.map(document => ({ document, publicationHash: digest(document) }));
}

/** Every loaded passage, shaped as library.lookup returns it (revision 1, epoch 1). */
export function passagesOf(loaded) {
  return loaded.flatMap(({ document, publicationHash }) => document.sections.map((section, index) => ({
    id: `${document.id}.r1.s${index}`, title: document.title, heading: section.heading, text: section.text, url: document.url,
    authority: document.authority, publicationHash, epoch: 1, validUntil: document.validUntil, rights: document.rights,
    attribution: document.attribution, sourceRevision: document.sourceRevision, exact: false,
    family: familyOf({ documentId: document.id, url: document.url }), game: document.game ?? null })));
}

/**
 * The gold passages a case names, for the oracle mode and the coverage check: for `any`, every passage matching each item,
 * item by item; for `all`, the first passage matching each item. At most six, as a turn's prompt allows.
 */
export function goldPassages(passages, gold, limit = 6) {
  if (!gold) return [];
  const picked = [];
  for (const item of gold.all ?? gold.any ?? []) {
    for (const passage of passages.filter(row => goldMatches(row, item))) {
      if (picked.length >= limit) return picked;
      if (!picked.includes(passage)) { picked.push(passage); if (gold.all) break; }
    }
  }
  return picked;
}
