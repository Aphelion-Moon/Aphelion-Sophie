import { createHash } from 'node:crypto';
import { readFile, readdir, realpath } from 'node:fs/promises';
import { isAbsolute, relative, resolve, posix } from 'node:path';

export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

export async function sourceFiles(root) {
  const files = [];
  async function walk(directory) {
    for (const entry of await readdir(resolve(root, directory), { withFileTypes: true })) {
      const path = `${directory}/${entry.name}`;
      if (entry.isSymbolicLink()) throw new Error(`Source symlink requires review: ${path}`);
      if (entry.isDirectory()) await walk(path);
      else if (/\.(?:js|mjs)$/.test(entry.name)) files.push(path);
    }
  }
  for (const directory of ['apps', 'contracts', 'modules', 'platform', 'scripts', 'tests']) await walk(directory);
  return files.sort();
}

/** Conservative source-convention lint, not a JS sandbox or substitute for OS ACLs. */
export function checkModuleImports(file, source) {
  if (!/^(apps|contracts|modules|platform)\//.test(file)) return [];
  const failures = [];
  if (/\b(?:import\s*\(|require\s*\(|eval\s*\(|new\s+Function\s*\()/.test(source)) failures.push(`${file}: dynamic loading/evaluation is not permitted`);
  const imports = [...source.matchAll(/\b(?:import\s+(?:[\w\s{},*]+?\s+from\s+)?|export\s+(?:\*|\{[^}]*\})\s+from\s+)["']([^"']+)["']/g)].map(match => match[1]);
  for (const specifier of imports) {
    if (specifier.startsWith('node:')) {
      if (!file.startsWith('apps/')) failures.push(`${file}: pure domain/platform code cannot import ${specifier}`);
      continue;
    }
    if (!specifier.startsWith('.')) {
      if (!(file === 'apps/core/storage/pool.js' && specifier === 'pg') &&
          !(file === 'apps/knowledge/html-extractor.js' && specifier === 'parse5')) failures.push(`${file}: unreviewed external import ${specifier}`);
      continue;
    }
    const target = posix.normalize(posix.join(posix.dirname(file), specifier));
    if (target.startsWith('../') || target.startsWith('/')) {
      failures.push(`${file}: import leaves the repository`);
      continue;
    }
    if (file.startsWith('contracts/') && !target.startsWith('contracts/')) failures.push(`${file}: contracts cannot depend on application layers`);
    if (file.startsWith('platform/') && !/^(contracts|platform)\//.test(target)) failures.push(`${file}: platform cannot import a feature`);
    if (file.startsWith('modules/')) {
      const owner = file.split('/')[1];
      const allowedPeers = {
        onboarding: ['modules/membership/index.js'],
        tickets: ['modules/membership/index.js', 'modules/onboarding/index.js'],
        assistant: ['modules/knowledge/index.js'],
      };
      const allowed = target.startsWith(`modules/${owner}/`) || target.startsWith('contracts/') ||
        target.startsWith('platform/authorization/') || target.startsWith('platform/configuration/') ||
        (allowedPeers[owner] ?? []).includes(target);
      if (!allowed) failures.push(`${file}: forbidden module dependency ${target}`);
    }
    if (/^apps\/(knowledge-worker|knowledge|ai-egress|ai-supervisor|ai-control)\//.test(file) && /^(apps\/core|modules\/(tickets|onboarding|membership))\//.test(target)) failures.push(`${file}: knowledge/AI transport cannot access case/core modules`);
    if (!file.startsWith('apps/ai-supervisor/') && target.startsWith('apps/ai-supervisor/')) failures.push(`${file}: supervisor implementation cannot be imported into another identity`);
  }
  return failures;
}

export function checkWorkplan(plan, catalogue) {
  const tasks = new Map(plan.tasks.map(task => [task.id, task]));
  const tests = new Set(catalogue.cases.map(item => item.id));
  if (tasks.size !== plan.tasks.length || tests.size !== catalogue.cases.length) throw new Error('DUPLICATE_TASK_OR_TEST_ID');
  for (const task of tasks.values()) {
    if (task.depends_on.some(id => !tasks.has(id)) || task.acceptance_tests.some(id => !tests.has(id))) throw new Error('MISSING_TASK_OR_TEST_REFERENCE');
  }
  const active = new Set();
  const visited = new Set();
  function visit(id) {
    if (active.has(id)) throw new Error('CYCLIC_TASK_DEPENDENCY');
    if (visited.has(id)) return;
    active.add(id);
    tasks.get(id).depends_on.forEach(visit);
    active.delete(id);
    visited.add(id);
  }
  tasks.forEach((_, id) => visit(id));
  function closure(id, seen = new Set()) {
    for (const dependency of tasks.get(id).depends_on) {
      if (!seen.has(dependency)) { seen.add(dependency); closure(dependency, seen); }
    }
    return seen;
  }
  for (const release of ['P31', 'P39']) {
    if (['P23', 'P24', 'P25', 'P28', 'P32'].some(id => closure(release).has(id))) throw new Error('MODEL_INDEPENDENCE_VIOLATION');
  }
  return { tasks: tasks.size, acceptanceSpecifications: tests.size };
}

export async function verifyReferencePackage(root) {
  const directory = resolve(root, 'Sophie-Implementation-Plans-v1.1');
  const lines = (await readFile(resolve(directory, 'SHA256SUMS.txt'), 'utf8')).trim().split(/\r?\n/);
  for (const line of lines) {
    const match = /^([a-f0-9]{64})\s+(.+)$/.exec(line);
    if (!match) throw new Error('INVALID_REFERENCE_CHECKSUM');
    const path = resolve(directory, match[2]);
    const pathWithin = relative(directory, path);
    if (pathWithin.startsWith('..') || isAbsolute(pathWithin)) throw new Error('REFERENCE_PATH_ESCAPE');
    if (sha256(await readFile(path)) !== match[1]) throw new Error(`Reference bytes changed: ${match[2]}`);
  }
  return lines.length;
}

export async function verifyAssetManifest(base) {
  const manifest = JSON.parse(await readFile(resolve(base, 'asset-manifest.json'), 'utf8'));
  if (manifest.assets.length !== 4 || new Set(manifest.assets.map(asset => asset.id)).size !== 4) throw new Error('INVALID_ASSET_SET');
  const allowedRoot = await realpath(resolve(base, 'assets/sophie/neon-chibi-v1'));
  for (const asset of manifest.assets) {
    const path = await realpath(resolve(base, asset.path));
    const within = relative(allowedRoot, path);
    if (!within || within.startsWith('..') || isAbsolute(within)) throw new Error('ASSET_PATH_ESCAPE');
    const bytes = await readFile(path);
    if (bytes.length !== asset.bytes || sha256(bytes) !== asset.sha256) throw new Error(`Asset integrity failed: ${asset.id}`);
    if (bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a' || bytes.readUInt32BE(16) !== asset.width || bytes.readUInt32BE(20) !== asset.height) throw new Error('ASSET_DIMENSIONS_INVALID');
    if (bytes[25] !== (asset.has_transparency ? 6 : 2)) throw new Error('ASSET_COLOUR_TYPE_INVALID');
  }
  return manifest.assets.length;
}
