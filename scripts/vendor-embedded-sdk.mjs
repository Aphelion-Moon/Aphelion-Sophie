// Copies Discord's Embedded App SDK into the Shuttle Activity client (P40/P43; owner decision of 22 October 2026).
//
//   node scripts/vendor-embedded-sdk.mjs [--from .local/embedded-app-sdk]
//
// The directory must hold the npm tarballs named below (for example from `npm pack @discord/embedded-app-sdk@2.5.0`).
// Each tarball is checked against its pinned npm integrity and SHA-256 before anything is read from it. Only the
// modules reachable from the SDK's DiscordSDK, Events and Constants entries are copied, byte for byte; the rest of the
// published output (URL patching with its 0BSD tslib helper, the mock, price and permission utilities) is not shipped.
// The dependencies Discord bundled into that output are identified by path and each must be an approved licence.
// Writes apps/activity/vendor/embedded-app-sdk/, legal/embedded-app-sdk.json and the licence notices it names.
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { moduleClosure } from '../apps/activity/module-closure.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const OUT = 'apps/activity/vendor/embedded-app-sdk';
const ENTRIES = ['Discord.mjs', 'schema/events.mjs', 'Constants.mjs'];
const DECISION = 'docs/decisions/0001-owner-policy.md (Shuttle Activity: SDK, testers and the ticket switch, 22 October 2026)';
const SDK = {
  name: '@discord/embedded-app-sdk', version: '2.5.0', license: 'MIT', file: 'embedded-app-sdk-2.5.0.tgz',
  url: 'https://registry.npmjs.org/@discord/embedded-app-sdk/-/embedded-app-sdk-2.5.0.tgz',
  integrity: 'sha512-FNoe5PbSkoKEbqPubaBmq6tlEMOftMjR3gu55YrdrrKmBfKKM4i9P/Z+Zxl0RZdJcKviBwVcTyYMMPM/aGex/w==',
  sha256: '9fea2ebe36dfd1126ad072ba343128db4143043c5b6a1f9bc212a0e3a7198470',
  licenseFile: 'package/LICENSE.md', notice: 'legal/notices/discord-embedded-app-sdk-2.5.0.txt',
};
// Discord's build bundles these under output/lib/<name>/. The output does not say which release of each it used, so
// each notice is the licence file from a pinned tarball of the same package.
const BUNDLED = [
  { name: 'zod', license: 'MIT', file: 'zod-3.25.76.tgz', licenseFile: 'package/LICENSE', notice: 'legal/notices/zod-3.25.76.txt',
    integrity: 'sha512-gzUt/qt81nXsFGKIFcC3YnfEAx5NkunCfnDlvuBSSFS02bcXu4Lmea0AFIUwbLWxWPx3d9p8S5QoaujKcNQxcQ==',
    sha256: '9e1f1a05f0dd0c1dab64ee91ceb9bf55cd44d35368c70edda80a2fdc70a88377' },
  { name: 'uuid', license: 'MIT', file: 'uuid-11.1.1.tgz', licenseFile: 'package/LICENSE.md', notice: 'legal/notices/uuid-11.1.1.txt',
    integrity: 'sha512-vIYxrBCC/N/K+Js3qSN88go7kIfNPssr/hHCesKCQNAjmgvYS2oqr69kIufEG+O4+PfezOH4EbIeHCfFov8ZgQ==',
    sha256: '82739fc18cf288807d2314f6f52fe8887c6359751569a8252572f16abb151141' },
  { name: 'eventemitter3', license: 'MIT', file: 'eventemitter3-5.0.4.tgz', licenseFile: 'package/LICENSE', notice: 'legal/notices/eventemitter3-5.0.4.txt',
    integrity: 'sha512-mlsTRyGaPBjPedk6Bvw+aqbsXDtoAyAzm5MO7JgU+yVRyMQ5O8bD4Kcci7BS85f93veegeCPkL8R4GLClnjLFw==',
    sha256: '21d4a36175672b9e6640c39a68613af73f9a4c47a4a4da39993e8cd085564eb6' },
  { name: 'big-integer', license: 'Unlicense', file: 'big-integer-1.6.52.tgz', licenseFile: 'package/LICENSE', notice: 'legal/notices/big-integer-1.6.52.txt',
    integrity: 'sha512-QxD8cf2eVqJOOz63z6JIN9BzvVs/dlySa5HGSBH5xtR8dPteIRQnBxxKqkNTiT6jbDTF6jAfrd4oMcND9RGbQg==',
    sha256: '5440c67085b1e873a083b873d49ab639591402120858bc4ab4dd9b40bafe1f87', exception: true },
];

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const fail = message => { throw new Error(message); };
// Notices are kept with LF line endings like every other file in legal/notices (see .gitattributes).
const asNotice = bytes => Buffer.from(bytes.toString('utf8').replace(/\r\n?/g, '\n'));

async function tarball(directory, pin) {
  const bytes = await readFile(resolve(directory, pin.file));
  if (`sha512-${createHash('sha512').update(bytes).digest('base64')}` !== pin.integrity || sha256(bytes) !== pin.sha256) fail(`Pin mismatch: ${pin.file}`);
  return { bytes, files: untar(gunzipSync(bytes)) };
}

/** Regular files of a ustar/pax archive. Links, devices and paths that leave package/ are refused. */
function untar(buffer) {
  const files = new Map();
  let offset = 0, paxPath = null;
  while (offset + 512 <= buffer.length) {
    const header = buffer.subarray(offset, offset + 512);
    if (header.every(byte => byte === 0)) break;
    const field = (start, length) => header.subarray(start, start + length).toString('utf8').replace(/\0[\s\S]*$/, '');
    const size = Number.parseInt(field(124, 12).trim() || '0', 8);
    const type = field(156, 1) || '0';
    const prefix = field(345, 155);
    const name = paxPath ?? (prefix ? `${prefix}/${field(0, 100)}` : field(0, 100));
    paxPath = null;
    const body = buffer.subarray(offset + 512, offset + 512 + size);
    if (type === 'x') paxPath = /\d+ path=([^\n]+)\n/.exec(body.toString('utf8'))?.[1] ?? null;
    else if (type === '0') {
      if (!name.startsWith('package/') || name.split('/').some(part => part === '..' || part === '')) fail(`Unsafe path: ${name}`);
      files.set(name, Buffer.from(body));
    } else if (type !== '5' && type !== 'g') fail(`Unsupported entry type ${type}: ${name}`);
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  return files;
}

const args = process.argv.slice(2);
const fromIndex = args.indexOf('--from');
const from = resolve(root, fromIndex >= 0 ? args[fromIndex + 1] : '.local/embedded-app-sdk');
const sdk = await tarball(from, SDK);
const metadata = JSON.parse(sdk.files.get('package/package.json').toString('utf8'));
if (metadata.name !== SDK.name || metadata.version !== SDK.version || metadata.license !== SDK.license) fail('SDK metadata mismatch');
const base = 'package/output/';
const shipped = moduleClosure(path => sdk.files.get(path)?.toString('utf8') ?? null, base, ENTRIES);
const components = new Set(shipped.filter(path => path.startsWith(`${base}lib/`)).map(path => path.slice(`${base}lib/`.length).split('/')[0]));
const expected = BUNDLED.map(item => item.name).sort();
if (JSON.stringify([...components].sort()) !== JSON.stringify(expected)) fail(`Bundled components changed: ${[...components].join(', ')}`);

await rm(resolve(root, OUT), { recursive: true, force: true });
const manifestFiles = [];
for (const path of shipped) {
  const relative = path.slice(base.length), bytes = sdk.files.get(path), target = resolve(root, OUT, relative);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, bytes);
  manifestFiles.push({ path: `${OUT}/${relative}`, bytes: bytes.length, sha256: sha256(bytes) });
}
const sdkLicence = sdk.files.get(SDK.licenseFile) ?? fail('SDK licence missing');
await writeFile(resolve(root, OUT, 'LICENSE.md'), sdkLicence);
const sdkNotice = asNotice(sdkLicence);
await writeFile(resolve(root, SDK.notice), sdkNotice);
const notices = [];
for (const item of BUNDLED) {
  const { files } = await tarball(from, item);
  const licence = asNotice(files.get(item.licenseFile) ?? fail(`Licence missing: ${item.name}`));
  const declared = JSON.parse(files.get('package/package.json').toString('utf8')).license;
  if (declared !== item.license) fail(`Licence changed: ${item.name} ${declared}`);
  await writeFile(resolve(root, item.notice), licence);
  notices.push({ name: item.name, license: item.license, path: `${OUT}/lib/${item.name}/`,
    modules: shipped.filter(path => path.startsWith(`${base}lib/${item.name}/`)).length,
    bundledVersion: 'Not stated in the SDK output', notice: item.notice, noticeSha256: sha256(licence),
    noticeFrom: `${item.file} (npm integrity ${item.integrity})`,
    approval: item.exception ? `Scoped exception for this bundled copy only: ${DECISION}` : 'MIT, covered by the SDK approval' });
}
const published = [...sdk.files.keys()].filter(path => path.startsWith(base) && path.endsWith('.mjs'));
const manifest = {
  schemaVersion: 1,
  generatedBy: 'scripts/vendor-embedded-sdk.mjs',
  package: { name: SDK.name, version: SDK.version, license: SDK.license, tarball: SDK.url, integrity: SDK.integrity,
    sha256: SDK.sha256, bytes: sdk.bytes.length, licenseSha256: sha256(sdkLicence), notice: SDK.notice, noticeSha256: sha256(sdkNotice) },
  decision: DECISION,
  entries: ENTRIES,
  directory: OUT,
  files: manifestFiles,
  modulesShipped: shipped.length,
  modulesNotShipped: published.length - shipped.length,
  notShipped: 'Everything not reachable from the entries, including utils/patchUrlMappings.mjs (the only module that calls fetch or WebSocket) with its bundled tslib helper (0BSD), the mock, PermissionUtils and PriceUtils with lodash.transform and decimal.js-light.',
  bundledComponents: notices,
  noticeLineEndings: 'Licence notices in legal/notices are stored with LF line endings; the copy beside the SDK is byte for byte.',
  automaticUpdates: false,
};
await writeFile(resolve(root, 'legal/embedded-app-sdk.json'), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(JSON.stringify({ shipped: shipped.length, notShipped: manifest.modulesNotShipped, components: expected }, null, 2));
