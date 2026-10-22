import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { moduleClosure } from '../apps/activity/module-closure.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const manifest = JSON.parse(await readFile(resolve(root, 'legal/embedded-app-sdk.json'), 'utf8'));
const dependencies = JSON.parse(await readFile(resolve(root, 'legal/DEPENDENCIES.json'), 'utf8'));

async function walk(directory) {
  const found = [];
  for (const entry of await readdir(resolve(root, directory), { withFileTypes: true })) {
    const path = `${directory}/${entry.name}`;
    if (entry.isDirectory()) found.push(...await walk(path)); else found.push(path);
  }
  return found;
}

test('T-ACT-SDK-01 every vendored SDK file matches its pin and nothing else is in the directory', async () => {
  assert.equal(manifest.package.name, '@discord/embedded-app-sdk');
  assert.equal(manifest.package.version, '2.5.0');
  for (const file of manifest.files) assert.equal(sha256(await readFile(resolve(root, file.path))), file.sha256, file.path);
  const present = (await walk(manifest.directory)).sort();
  assert.deepEqual(present, [...manifest.files.map(file => file.path), `${manifest.directory}/LICENSE.md`].sort());
  assert.equal(sha256(await readFile(resolve(root, manifest.directory, 'LICENSE.md'))), manifest.package.licenseSha256);
});

test('T-ACT-SDK-02 the shipped modules are exactly the static closure of the entries, with no network or dynamic loading', () => {
  const base = `${manifest.directory}/`;
  const read = path => existsSync(resolve(root, path)) ? readFileSync(resolve(root, path), 'utf8') : null;
  assert.deepEqual(moduleClosure(read, base, manifest.entries), manifest.files.map(file => file.path).sort());
  for (const file of manifest.files) {
    const text = read(file.path);
    assert.doesNotMatch(text, /\bfetch\s*\(|XMLHttpRequest|new\s+WebSocket|sendBeacon|importScripts/, file.path);
  }
  assert.equal(manifest.files.some(file => /tslib|lodash|decimal|patchUrlMappings|mock\.mjs/.test(file.path)), false);
});

test('T-ACT-SDK-03 bundled components are the reviewed four, with notices and the big-integer exception recorded', async () => {
  assert.deepEqual(manifest.bundledComponents.map(item => [item.name, item.license]).sort(),
    [['big-integer', 'Unlicense'], ['eventemitter3', 'MIT'], ['uuid', 'MIT'], ['zod', 'MIT']]);
  for (const item of manifest.bundledComponents) {
    assert.equal(sha256(await readFile(resolve(root, item.notice))), item.noticeSha256, item.notice);
    assert.equal(item.approval.startsWith('Scoped exception'), item.license !== 'MIT', item.name);
  }
  assert.equal(sha256(await readFile(resolve(root, manifest.package.notice))), manifest.package.noticeSha256);
  const pin = dependencies.activitySdk;
  for (const key of ['name', 'version', 'license', 'integrity', 'sha256']) assert.equal(pin[key], manifest.package[key], key);
  assert.equal(pin.manifest, 'legal/embedded-app-sdk.json');
  assert.equal(pin.automaticUpdates, false);
  const notices = await readFile(resolve(root, 'legal/THIRD-PARTY-NOTICES'), 'utf8');
  for (const item of [manifest.package, ...manifest.bundledComponents]) assert.ok(notices.includes(item.notice), item.notice);
});

test('T-ACT-SDK-05 every vendored file is tracked by Git, so a release carries it', { skip: !existsSync(resolve(root, '.git')) }, () => {
  // 22 October 2026: an ignore rule for dist/ kept four SDK modules out of the fe25c83 release.
  const listed = execFileSync('git', ['ls-files', '--', manifest.directory], { cwd: root, encoding: 'utf8' }).trim().split('\n').sort();
  assert.deepEqual(listed, [...manifest.files.map(file => file.path), `${manifest.directory}/LICENSE.md`].sort());
});

test('T-ACT-SDK-04 vendored bytes are protected from line-ending conversion', async () => {
  const attributes = await readFile(resolve(root, '.gitattributes'), 'utf8');
  assert.match(attributes, /^apps\/activity\/vendor\/\*\* -text$/m);
  assert.equal(relative(root, resolve(root, manifest.directory)).split(sep).join('/'), 'apps/activity/vendor/embedded-app-sdk');
});
