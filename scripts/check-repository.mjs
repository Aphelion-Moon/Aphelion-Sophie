import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { checkModuleImports, checkWorkplan, sha256, sourceFiles, verifyAssetManifest, verifyReferencePackage } from './lib/repository-checks.mjs';
import { renderWorkplan } from './build-workplan.mjs';
import { validateOfflineConfiguration } from '../platform/configuration/index.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const json = async path => JSON.parse(await readFile(resolve(root, path), 'utf8'));
const plan = await json('docs/workplan.json');
const catalogue = await json('docs/acceptance-cases.json');
const graph = checkWorkplan(plan, catalogue);
if (await readFile(resolve(root, 'docs/workplan.md'), 'utf8') !== renderWorkplan(plan)) throw new Error('WORKPLAN_REGENERATION_REQUIRED');
validateOfflineConfiguration(await json('config/example.json'));
const pkg = await json('package.json');
const lock = await json('package-lock.json');
const review = await json('legal/storage-packages.json');
const knowledgeReview = await json('legal/knowledge-packages.json');
if (JSON.stringify(pkg.dependencies) !== JSON.stringify({ parse5: '8.0.1', pg: '8.23.0' }) || Object.keys(pkg.devDependencies ?? {}).length ||
    JSON.stringify(pkg.overrides) !== JSON.stringify({ entities: '8.1.0' })) throw new Error('DEPENDENCY_REVIEW_REQUIRED');
if (Object.keys(lock.packages).length !== review.packages.length + knowledgeReview.packages.length + 1) throw new Error('DEPENDENCY_REVIEW_REQUIRED');
for (const item of review.packages) {
  const locked = lock.packages[`node_modules/${item.name}`];
  if (!locked || ['version', 'integrity', 'resolved', 'license'].some(key => locked[key] !== item[key])) throw new Error('DEPENDENCY_PIN_MISMATCH');
  if (sha256(await readFile(resolve(root, item.noticePath))) !== item.noticeSha256) throw new Error('DEPENDENCY_NOTICE_MISMATCH');
  if (!['MIT', 'ISC'].includes(item.license) || item.scopeDecision !== 'docs/decisions/0003-storage-dependencies.md') throw new Error('DEPENDENCY_SCOPE_REQUIRED');
}
if (knowledgeReview.packages.length !== 2) throw new Error('DEPENDENCY_SCOPE_REQUIRED');
for (const [index, item] of knowledgeReview.packages.entries()) {
  const expected = [{ name: 'parse5', version: '8.0.1', license: 'MIT' }, { name: 'entities', version: '8.1.0', license: 'BSD-2-Clause' }][index];
  const locked = lock.packages[`node_modules/${item.name}`];
  if (Object.entries(expected).some(([key, value]) => item[key] !== value) || item.scopeDecision !== 'docs/decisions/0005-mediawiki-extraction.md' || item.installScripts !== false) throw new Error('DEPENDENCY_SCOPE_REQUIRED');
  if (!locked || ['version', 'integrity', 'resolved', 'license'].some(key => locked[key] !== item[key])) throw new Error('DEPENDENCY_PIN_MISMATCH');
  if (sha256(await readFile(resolve(root, item.noticePath))) !== item.noticeSha256) throw new Error('DEPENDENCY_NOTICE_MISMATCH');
}
if (lock.packages[''].version !== pkg.version || lock.packages[''].engines.node !== pkg.engines.node) throw new Error('LOCKFILE_METADATA_MISMATCH');
if (JSON.stringify(lock.packages[''].dependencies) !== JSON.stringify(pkg.dependencies)) throw new Error('LOCKFILE_METADATA_MISMATCH');
const files = await sourceFiles(root);
const errors = [];
for (const file of files) {
  const source = await readFile(resolve(root, file), 'utf8');
  errors.push(...checkModuleImports(file, source));
  const parsed = spawnSync(process.execPath, ['--check', resolve(root, file)], { encoding: 'utf8', windowsHide: true, timeout: 10_000 });
  if (parsed.status !== 0) errors.push(`Syntax check failed: ${file}`);
}
if (errors.length) throw new Error(errors.join('\n'));
const referenceChecksums = await verifyReferencePackage(root);
const assetCopies = await verifyAssetManifest(resolve(root, 'Sophie-Implementation-Plans-v1.1')) +
  await verifyAssetManifest(resolve(root, 'Sophie-Visual-Assets-v1'));
console.log(JSON.stringify({ ...graph, sourceFilesChecked: files.length, referenceChecksums, assetCopies, moduleConventions: 'passed', productionReady: false }, null, 2));
