import { requireCondition } from '../../../contracts/validation.js';
import { createSourceReader } from './http.js';
import { cleanText, documentIdBase, markdownToSections, packDocuments } from './sectioning.js';

// Owner decision, 23 October 2026: the Wolfgate Guidebook (SS14) is a synced source. Its index is one JSON file built
// from the Wolfgate repository. Entries under the index's current rules root are the Wolfgate ruleset: policy for
// SS14/Wolfgate questions, with gaps deferring to the Meridian Rift wiki. Every other entry, including the other upstream
// rulesets the Guidebook carries, is reference. Titles say "Wolfgate Guidebook" so the model can tell the games apart.
export const GUIDE_SOURCE = Object.freeze({
  collection: 'guide', prefix: 'guide', origin: 'https://panel.a13.info', index: 'https://panel.a13.info/guide/wolfgate/index.json',
  server: 'wolfgate', repository: 'VanguardControl/Wolfgate', maxEntries: 600,
  rights: 'Wolfgate Guidebook text; see LEGAL.md in VanguardControl/Wolfgate', attribution: 'Wolfgate Guidebook (VanguardControl/Wolfgate)',
});
const ENTRY_ID = /^[A-Za-z0-9_.-]{1,100}$/u;

export const guideEntryUrl = id => `${GUIDE_SOURCE.origin}/guide/${GUIDE_SOURCE.server}#${encodeURIComponent(id)}`;

export function createGuideCollector({ fetchImpl = fetch, clock = Date.now }) {
  const reader = createSourceReader({ fetchImpl, origins: [GUIDE_SOURCE.origin], prefix: 'GUIDE' });
  return Object.freeze({ collection: GUIDE_SOURCE.collection, prefix: GUIDE_SOURCE.prefix,
    async collect({ signal, known = new Map() }) {
      const index = await reader.json(GUIDE_SOURCE.index, { signal, maxBytes: 4194304 });
      requireCondition(index?.server === GUIDE_SOURCE.server && index.repo === GUIDE_SOURCE.repository && typeof index.commit === 'string' &&
        /^[a-f0-9]{40}$/u.test(index.commit), 'GUIDE_SOURCE_SCOPE_CHANGED');
      const entries = index.entries;
      requireCondition(entries !== null && typeof entries === 'object' && !Array.isArray(entries) && typeof index.rulesRoot === 'string' &&
        ENTRY_ID.test(index.rulesRoot), 'GUIDE_RESPONSE_INVALID');
      const ids = Object.keys(entries).filter(id => ENTRY_ID.test(id)).sort();
      requireCondition(ids.length > 0, 'GUIDE_SOURCE_UNAVAILABLE'); requireCondition(ids.length <= GUIDE_SOURCE.maxEntries, 'GUIDE_SOURCE_LIMIT');
      // The active ruleset: the rules root and everything below it (bounded walk; the index is a tree).
      const ruleset = new Set(), pending = [index.rulesRoot];
      while (pending.length && ruleset.size < GUIDE_SOURCE.maxEntries) {
        const id = pending.pop();
        if (ruleset.has(id) || !Object.hasOwn(entries, id)) continue;
        ruleset.add(id);
        for (const child of Array.isArray(entries[id]?.children) ? entries[id].children : []) if (typeof child === 'string' && ENTRY_ID.test(child)) pending.push(child);
      }
      const results = [], fetchedAt = clock(); let skipped = 0, truncated = 0;
      for (const id of ids) {
        requireCondition(!signal.aborted, 'GUIDE_SYNC_CANCELLED');
        const entry = entries[id];
        const idBase = documentIdBase(GUIDE_SOURCE.prefix, String(entry?.title ?? id), id), sourceRevision = `guide:${GUIDE_SOURCE.server}:${index.commit}:${id}`;
        if (known.get(idBase) === sourceRevision) { results.push({ idBase, sourceRevision, unchanged: true }); continue; }
        if (typeof entry?.title !== 'string' || typeof entry.text !== 'string' || entry.text.length > 16384 || !entry.text.isWellFormed()) { skipped++; continue; }
        const title = `Wolfgate Guidebook: ${cleanText(entry.title).slice(0, 150)}`;
        const packed = packDocuments({ idBase, title, kind: 'guidebook', authority: ruleset.has(id) ? 'policy' : 'reference', url: guideEntryUrl(id),
          rights: GUIDE_SOURCE.rights, attribution: GUIDE_SOURCE.attribution, sourceRevision, fetchedAt, aliases: [entry.title, id],
          sections: markdownToSections(entry.text, title) });
        if (packed.truncated) truncated++;
        if (packed.documents.length) results.push({ idBase, sourceRevision, documents: packed.documents }); else skipped++;
      }
      // The roadmap the Guidebook page shows: names, descriptions and states, as one reference document.
      if (Array.isArray(index.roadmap) && index.roadmap.length) {
        const text = index.roadmap.slice(0, 10).map(stage => `${cleanText(String(stage?.name ?? 'Stage'))}:\n${(Array.isArray(stage?.items) ? stage.items : []).slice(0, 40)
          .map(item => `- ${cleanText(String(item?.name ?? ''))}${item?.state ? ` (${cleanText(String(item.state))})` : ''}: ${cleanText(String(item?.description ?? ''))}`).join('\n')}`).join('\n\n');
        const idBase = documentIdBase(GUIDE_SOURCE.prefix, 'Wolfgate roadmap', 'roadmap'), sourceRevision = `guide:${GUIDE_SOURCE.server}:${index.commit}:roadmap`;
        if (known.get(idBase) === sourceRevision) results.push({ idBase, sourceRevision, unchanged: true });
        else {
          const packed = packDocuments({ idBase, title: 'Wolfgate Guidebook: Roadmap', kind: 'guidebook', authority: 'reference', url: `${GUIDE_SOURCE.origin}/guide/${GUIDE_SOURCE.server}`,
            rights: GUIDE_SOURCE.rights, attribution: GUIDE_SOURCE.attribution, sourceRevision, fetchedAt, aliases: ['Wolfgate roadmap'],
            sections: markdownToSections(text, 'Wolfgate Guidebook: Roadmap') });
          if (packed.documents.length) results.push({ idBase, sourceRevision, documents: packed.documents });
        }
      }
      return { entries: results, listed: ids.length, skipped, truncated, complete: skipped === 0 };
    } });
}
