import { requireCondition, requireId, requireInteger, requireKeys, requireName } from '../../contracts/validation.js';

export function canonicalKnowledgeDocument(value) {
  requireKeys(value, ['id', 'title', 'kind', 'authority', 'url', 'rights', 'attribution', 'sourceRevision', 'dependencyHash', 'fetchedAt', 'validUntil', 'aliases', 'sections'], 'KNOWLEDGE_DOCUMENT_INVALID');
  requireCondition(typeof value.id === 'string' && /^[a-z][a-z0-9-]{0,47}$/.test(value.id), 'KNOWLEDGE_DOCUMENT_INVALID');
  const text = (item, limit) => requireCondition(typeof item === 'string' && item.trim().length > 0 && item.length <= limit && item.isWellFormed() && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(item), 'KNOWLEDGE_DOCUMENT_INVALID');
  text(value.title, 200); text(value.rights, 300); text(value.attribution, 500); text(value.sourceRevision, 160);
  requireCondition(['owner-publication','mediawiki','repository'].includes(value.kind) && ['policy','lore','reference','community-event'].includes(value.authority), 'KNOWLEDGE_DOCUMENT_INVALID');
  text(value.url, 1000); const url = new URL(value.url);
  requireCondition(url.protocol === 'https:' && !url.username && !url.password && url.port === '' && !url.hash, 'KNOWLEDGE_URL_INVALID');
  requireCondition(/^[a-f0-9]{64}$/.test(value.dependencyHash), 'KNOWLEDGE_DOCUMENT_INVALID');
  requireInteger(value.fetchedAt); if (value.validUntil !== null) requireInteger(value.validUntil, value.fetchedAt + 1000, value.fetchedAt + 7 * 86400000);
  requireCondition(value.kind === 'owner-publication' || value.validUntil !== null, 'KNOWLEDGE_FRESHNESS_REQUIRED');
  requireCondition(Array.isArray(value.aliases) && value.aliases.length <= 20 && new Set(value.aliases).size === value.aliases.length, 'KNOWLEDGE_DOCUMENT_INVALID');
  value.aliases.forEach(alias => text(alias, 100));
  requireCondition(Array.isArray(value.sections) && value.sections.length > 0 && value.sections.length <= 16, 'KNOWLEDGE_DOCUMENT_INVALID');
  let size = 0;
  const sections = value.sections.map(section => { requireKeys(section, ['heading', 'text'], 'KNOWLEDGE_DOCUMENT_INVALID'); text(section.heading, 160); text(section.text, 4000); size += section.text.length; return { heading: section.heading, text: section.text }; });
  requireCondition(size <= 32000, 'KNOWLEDGE_DOCUMENT_INVALID');
  return { id: value.id, title: value.title, kind: value.kind, authority: value.authority, url: url.href, rights: value.rights, attribution: value.attribution,
    sourceRevision: value.sourceRevision, dependencyHash: value.dependencyHash, fetchedAt: value.fetchedAt, validUntil: value.validUntil, aliases: [...value.aliases].sort(), sections };
}

export function knowledgeScope({ guildId, channelId, boundaryEpoch }) {
  requireId(guildId); requireId(channelId); requireInteger(boundaryEpoch, 1); return { guildId, channelId, boundaryEpoch };
}

export function requireKnowledgeSourceId(id) { requireName(id); requireCondition(/^[a-z][a-z0-9-]{0,47}\.r[1-9][0-9]{0,9}\.s[0-9]{1,2}$/.test(id), 'KNOWLEDGE_SOURCE_INVALID'); }
