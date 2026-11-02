import { GUIDE_SOURCE } from './sources/guide.js';
import { SITE_SOURCE } from './sources/website.js';

/**
 * Source families (plan of 2 November 2026). Players' words collide with developers' ("CI" is the Combat Indicator in game
 * and continuous integration on GitHub), so a gameplay question must never be answered from a developer page. The family
 * follows from where a document came from and needs no stored field: GitHub documents and the website's /docs/ pages are
 * development, except GitHub's recent-activity document, which with the roadmaps is general (players ask what changed);
 * everything else, owner publications included, is gameplay. Code search results are development.
 */
export const KNOWLEDGE_FAMILIES = Object.freeze(['gameplay', 'development', 'general']);
const SITE_DOCS = `${SITE_SOURCE.origin}/docs/`, SITE_ROADMAP = `${SITE_SOURCE.origin}/roadmap/`;
const GUIDE_PREFIX = `${GUIDE_SOURCE.prefix}-`;

export function familyOf({ documentId, url }) {
  if (documentId.startsWith('code-')) return 'development';
  if (documentId.startsWith('gh-')) return url.endsWith('/pulls') ? 'general' : 'development';
  if (documentId.startsWith('site-')) return url.startsWith(SITE_DOCS) ? 'development' : url.startsWith(SITE_ROADMAP) ? 'general' : 'gameplay';
  // Every Guidebook entry's address names it (#entry); the roadmap's is the Guidebook page itself.
  if (documentId.startsWith(GUIDE_PREFIX) && !url.includes('#')) return 'general';
  return 'gameplay';
}

/** familyOf for a sophie_knowledge.chunks row aliased c. Only these fixed origins reach the text (storage test KF-01). */
export const FAMILY_SQL = `CASE WHEN c.document_id LIKE 'code-%' THEN 'development'
  WHEN c.document_id LIKE 'gh-%' THEN CASE WHEN right(c.url,6)='/pulls' THEN 'general' ELSE 'development' END
  WHEN c.document_id LIKE 'site-%' THEN CASE WHEN left(c.url,${SITE_DOCS.length})='${SITE_DOCS}' THEN 'development'
    WHEN left(c.url,${SITE_ROADMAP.length})='${SITE_ROADMAP}' THEN 'general' ELSE 'gameplay' END
  WHEN c.document_id LIKE '${GUIDE_PREFIX}%' AND strpos(c.url,'#')=0 THEN 'general' ELSE 'gameplay' END`;
