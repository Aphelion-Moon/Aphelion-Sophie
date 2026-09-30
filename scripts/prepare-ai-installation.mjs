#!/usr/bin/env node
// Operator tool: writes installation.manifest for a staged package and the per-role trust files that
// apps/installation/configuration.js loads. Input is one bounded JSON file; nothing is fetched or executed.
//
//   node scripts/prepare-ai-installation.mjs <input.json>
//
// input.json:
//   { "packageRoot": "...",             staged package containing source\ and runtime\
//     "outputDirectory": "...",         receives trust\core.json and trust\supervisor.json (restricted folder)
//     "release": { "name": "...", "workerId": "<sha256>", "releaseHash": "<sha256>" },
//     "acceptedFingerprints": ["..."],  DeepSeek system fingerprints accepted by the worker
//     "evidence": { "service-account-identity": "<file>", "file-acl-scope": "<file>", "firewall-egress-scope": "<file>" },
//     "core": "<file>" }                core runtime block (runtime, databases, credentials); read, never printed
//
// Output files contain the control key and, for core, Discord/database credentials. Keep outputDirectory
// outside Git, copy the files into C:\Aphelion\Sophie\trust, then rerun ops/windows/Setup-InferenceAccount.ps1
// so each file is readable only by its own service SID. Receipts expire after 24 hours by design.
import { createHash, randomBytes } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { deepSeekProfileHash } from '../apps/knowledge-worker/deepseek-client.js';
import { canonicalAiWorkerRelease } from '../modules/assistant/worker-release.js';
import { installationChecks } from '../apps/installation/qualification.js';
import { verifyInstallationManifest } from '../apps/installation/configuration.js';
import { canonicalProcessingPolicy } from '../modules/assistant/processing-policy.js';

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const LIFETIME = 86400000;

async function manifest(packageRoot) {
  const lines = [];
  async function walk(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isSymbolicLink()) throw Error(`Symlink in package: ${path}`);
      if (entry.isDirectory()) await walk(path);
      else if (entry.name !== 'installation.manifest') lines.push(`${sha256(await readFile(path))} ${relative(packageRoot, path).split(sep).join('/')}`);
    }
  }
  for (const top of ['runtime', 'source']) await walk(join(packageRoot, top));
  return lines.sort().join('\n') + '\n';
}

const [inputPath] = process.argv.slice(2);
if (!inputPath) { console.error('usage: node scripts/prepare-ai-installation.mjs <input.json>'); process.exit(2); }
const input = JSON.parse(await readFile(inputPath, 'utf8'));
const text = await manifest(input.packageRoot);
for (const role of ['core', 'supervisor']) await verifyInstallationManifest({ role, text, packageRoot: input.packageRoot,
  hash: async path => { const bytes = await readFile(path); return { sha256: sha256(bytes), size: bytes.length }; } });
await writeFile(join(input.packageRoot, 'source', 'installation.manifest'), text, { flag: 'w' });

const installationId = randomBytes(32).toString('hex'), expires = Date.now() + LIFETIME;
const acceptedFingerprints = [...input.acceptedFingerprints];
const checks = {};
for (const name of installationChecks) checks[name] = sha256(await readFile(input.evidence[name]));
const profileHash = deepSeekProfileHash({ acceptedFingerprints });
const qualification = { installationId, releaseHash: input.release.releaseHash, profileHash, expiresAt: expires, checks };
const release = canonicalAiWorkerRelease({ name: input.release.name, workerId: input.release.workerId, releaseHash: input.release.releaseHash,
  profileHash, evidenceHash: sha256(JSON.stringify(qualification)), provider: 'deepseek', domain: 'public' });
const shared = { version: 1, installationId, expires, manifest: sha256(text), release, qualification, keys: { core: randomBytes(32).toString('hex') } };
const core = JSON.parse(await readFile(input.core, 'utf8'));
if(core.processingPolicy)core.processingPolicy=canonicalProcessingPolicy(core.processingPolicy);

await mkdir(join(input.outputDirectory, 'trust'), { recursive: true });
await writeFile(join(input.outputDirectory, 'trust', 'core.json'), JSON.stringify({ ...shared, role: 'core', core }) + '\n', { flag: 'wx' });
await writeFile(join(input.outputDirectory, 'trust', 'supervisor.json'), JSON.stringify({ ...shared, role: 'supervisor', acceptedFingerprints }) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ release, expiresAt: new Date(expires).toISOString(), manifestEntries: text.split('\n').length - 1 }, null, 2));
