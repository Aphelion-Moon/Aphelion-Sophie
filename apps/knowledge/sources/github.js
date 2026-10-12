import { requireCondition } from '../../../contracts/validation.js';
import { createSourceReader } from './http.js';
import { cleanText, documentIdBase, markdownToSections, packDocuments } from './sectioning.js';

// Owner decision, 12 October 2026: the organisation's own public repositories (no forks): documentation plus recent
// activity. Public repositories accept issues from anyone, so activity text is kept only from authors GitHub reports as
// owners, members, collaborators or earlier contributors; first-time and unaffiliated authors are left out.
export const GITHUB_SOURCE = Object.freeze({
  collection: 'github', prefix: 'gh', organisation: 'Aphelion-Moon',
  api: 'https://api.github.com', raw: 'https://raw.githubusercontent.com', site: 'https://github.com',
  trustedAuthors: ['OWNER', 'MEMBER', 'COLLABORATOR', 'CONTRIBUTOR'], maxRepositories: 40, maxDocsFiles: 30,
  // Sophie's own docs/ are internal engineering records (verification logs, case-system design, test sentinels),
  // not community information; only that repository's overview and README are used.
  docsExcluded: ['Aphelion-Sophie'],
});
const day = value => typeof value === 'string' && /^\d{4}-\d\d-\d\d/u.test(value) ? value.slice(0, 10) : 'unknown date';
const name = value => { requireCondition(typeof value === 'string' && /^[A-Za-z0-9._-]{1,100}$/u.test(value), 'GITHUB_RESPONSE_INVALID'); return value; };
// A rate limit ends the whole run (the mirror keeps what it holds); any other failure skips one part of one repository.
const rethrow = (error, signal) => { if (signal.aborted || error?.message === 'GITHUB_RATE_LIMITED') throw error; };
const short = (value, limit) => { const text = cleanText(String(value ?? '').replace(/<!--[\s\S]*?-->/gu, '')); return text.length <= limit ? text : `${text.slice(0, limit - 1).trimEnd()}…`; };

export function createGithubCollector({ fetchImpl = fetch, clock = Date.now }) {
  const reader = createSourceReader({ fetchImpl, origins: [GITHUB_SOURCE.api, GITHUB_SOURCE.raw], prefix: 'GITHUB' });
  const api = (path, signal, allowMissing = false) => reader.json(`${GITHUB_SOURCE.api}${path}`, { signal, allowMissing, maxBytes: 4194304,
    headers: { 'x-github-api-version': '2022-11-28' } });
  const raw = async (owner, repo, branch, path, signal) => (await reader.text(`${GITHUB_SOURCE.raw}/${owner}/${repo}/${encodeURIComponent(branch)}/${path.split('/').map(encodeURIComponent).join('/')}`,
    { signal, allowMissing: true, maxBytes: 524288 }))?.text ?? null;
  return Object.freeze({ collection: GITHUB_SOURCE.collection, prefix: GITHUB_SOURCE.prefix,
    async collect({ signal }) {
      const listed = await api(`/orgs/${GITHUB_SOURCE.organisation}/repos?type=public&per_page=100`, signal);
      requireCondition(Array.isArray(listed) && listed.length <= 100, 'GITHUB_RESPONSE_INVALID');
      const repositories = listed.filter(repo => repo && repo.fork === false && repo.private === false && repo.owner?.login === GITHUB_SOURCE.organisation)
        .slice(0, GITHUB_SOURCE.maxRepositories);
      requireCondition(repositories.length > 0, 'GITHUB_SOURCE_UNAVAILABLE');
      const entries = [], fetchedAt = clock(); let skipped = 0, truncated = 0;
      const add = (key, title, fields) => {
        const packed = packDocuments({ idBase: documentIdBase(GITHUB_SOURCE.prefix, title, key), title, kind: 'repository', fetchedAt, ...fields });
        if (packed.truncated) truncated++;
        if (packed.documents.length) entries.push({ idBase: packed.documents[0].id, sourceRevision: packed.documents[0].sourceRevision, documents: packed.documents });
      };
      for (const repo of repositories) {
        requireCondition(!signal.aborted, 'GITHUB_SYNC_CANCELLED');
        const owner = name(repo.owner.login), repoName = name(repo.name), branch = String(repo.default_branch ?? '');
        requireCondition(/^[A-Za-z0-9._/-]{1,100}$/u.test(branch), 'GITHUB_RESPONSE_INVALID');
        const home = `${GITHUB_SOURCE.site}/${owner}/${repoName}`, licence = repo.license?.spdx_id && repo.license.spdx_id !== 'NOASSERTION' ? repo.license.spdx_id : 'no stated licence';
        const rights = `${licence} (repository licence)`, attribution = `${owner}/${repoName} contributors on GitHub`;
        // Overview and README.
        const overview = [`${owner}/${repoName} is a public GitHub repository of the Aphelion project.`,
          repo.description ? `Description: ${short(repo.description, 500)}` : null, repo.language ? `Main language: ${repo.language}.` : null,
          `Licence: ${licence}.`, `Default branch: ${branch}.`, repo.homepage ? `Homepage: ${short(repo.homepage, 200)}` : null,
          Array.isArray(repo.topics) && repo.topics.length ? `Topics: ${repo.topics.slice(0, 20).join(', ')}.` : null,
          repo.archived ? 'This repository is archived (read-only).' : null, `Created ${day(repo.created_at)}.`].filter(Boolean).join('\n');
        try {
          const readme = await api(`/repos/${owner}/${repoName}/readme`, signal, true);
          const text = readme?.encoding === 'base64' && typeof readme.content === 'string' && readme.size <= 524288 ? Buffer.from(readme.content, 'base64').toString('utf8') : '';
          const contributing = await raw(owner, repoName, branch, 'CONTRIBUTING.md', signal) ?? await raw(owner, repoName, branch, '.github/CONTRIBUTING.md', signal);
          add(`${owner}/${repoName}`, `${repoName} repository`, { authority: 'reference', url: home, rights, attribution, aliases: [repoName, `${owner}/${repoName}`],
            sourceRevision: `github:${owner}/${repoName}:overview`, sections: [{ heading: `${repoName} › Overview`, text: overview },
              ...(text.isWellFormed() ? markdownToSections(text, `${repoName} README`) : []),
              ...(contributing?.isWellFormed() ? markdownToSections(contributing, `${repoName} contributing guide`) : [])] });
        } catch (error) { rethrow(error, signal); skipped++; }
        // Markdown files directly under docs/.
        try {
          const listing = GITHUB_SOURCE.docsExcluded.includes(repoName) ? null : await api(`/repos/${owner}/${repoName}/contents/docs?ref=${encodeURIComponent(branch)}`, signal, true);
          const files = Array.isArray(listing) ? listing.filter(item => item?.type === 'file' && /\.md$/iu.test(item.name) && item.size <= 524288).slice(0, GITHUB_SOURCE.maxDocsFiles) : [];
          for (const file of files) {
            const path = `docs/${name(file.name)}`, text = await raw(owner, repoName, branch, path, signal);
            if (!text?.isWellFormed()) { skipped++; continue; }
            const title = `${repoName}: ${file.name.replace(/\.md$/iu, '').replace(/[-_]+/gu, ' ')}`;
            add(`${owner}/${repoName}/${path}`, title, { authority: 'reference', url: `${home}/blob/${encodeURIComponent(branch)}/${path}`, rights, attribution,
              sourceRevision: `github:${owner}/${repoName}:${path}:${short(file.sha, 40)}`, sections: markdownToSections(text, title) });
          }
        } catch (error) { rethrow(error, signal); skipped++; }
        // Recent activity from trusted authors only.
        try {
          const trusted = item => GITHUB_SOURCE.trustedAuthors.includes(item?.author_association);
          const releases = (await api(`/repos/${owner}/${repoName}/releases?per_page=5`, signal, true)) ?? [];
          const open = ((await api(`/repos/${owner}/${repoName}/issues?state=open&sort=updated&direction=desc&per_page=40`, signal, true)) ?? []).filter(trusted).slice(0, 25);
          const merged = ((await api(`/repos/${owner}/${repoName}/pulls?state=closed&sort=updated&direction=desc&per_page=30`, signal, true)) ?? [])
            .filter(item => item?.merged_at && trusted(item)).slice(0, 15);
          const as = `as of ${new Date(fetchedAt).toISOString().slice(0, 10)}`;
          const sections = [];
          if (Array.isArray(releases) && releases.length) sections.push({ heading: `${repoName} › Releases`, text: releases.filter(item => !item.draft).map(item =>
            `${short(item.name || item.tag_name, 120)} (${short(item.tag_name, 60)}, ${day(item.published_at)})${item.prerelease ? ', pre-release' : ''}: ${short(item.body, 900)}`).join('\n\n') });
          const describe = item => `#${item.number} ${short(item.title, 200)} — ${item.pull_request ? 'pull request' : 'issue'}, updated ${day(item.updated_at)}` +
            `${Array.isArray(item.labels) && item.labels.length ? `, labels: ${item.labels.map(label => short(label.name, 40)).join(', ')}` : ''}${item.body ? `\n${short(item.body, 600)}` : ''}`;
          if (open.length) sections.push({ heading: `${repoName} › Open issues and pull requests ${as}`, text: open.map(describe).join('\n\n') });
          if (merged.length) sections.push({ heading: `${repoName} › Recently merged pull requests ${as}`, text: merged.map(item =>
            `#${item.number} ${short(item.title, 200)} — merged ${day(item.merged_at)}${item.body ? `\n${short(item.body, 400)}` : ''}`).join('\n\n') });
          if (!sections.length) sections.push({ heading: `${repoName} › Activity ${as}`, text: `No releases, open issues or open pull requests ${as}.` });
          add(`${owner}/${repoName}#activity`, `${repoName} recent activity`, { authority: 'reference', url: `${home}/pulls`,
            rights: 'Issue and pull request text belongs to its authors', attribution: `${owner}/${repoName} on GitHub`, sourceRevision: `github:${owner}/${repoName}:activity`, sections });
        } catch (error) { rethrow(error, signal); skipped++; }
      }
      return { entries, listed: repositories.length, skipped, truncated, complete: skipped === 0 };
    } });
}
