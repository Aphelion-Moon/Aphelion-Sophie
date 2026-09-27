import { readFile } from 'node:fs/promises';
import { validateOfflineConfiguration } from '../../platform/configuration/index.js';

const productionRequested = process.argv.includes('--production');
const config = JSON.parse(await readFile(new URL('../../config/example.json', import.meta.url), 'utf8'));
validateOfflineConfiguration(config);
const blockers = [
  'Isolated staging is implemented and has live Gateway, OAuth, ticket-navigation and DM evidence; full production workflow and independent recovery acceptance remain incomplete.',
  'Production Node/PostgreSQL distributions and bundled runtime notices still require release review.',
  'Production guild, role/capability mapping, existing-member baseline and responsibility transfer still require review.',
  'Production Windows service packaging, separate identities, filesystem ACLs, resource measurements and reboot recovery are unverified.',
  'Approved Shuttle/form copy, attachment acquisition/download policy, complete Staff workflows and human privacy/accessibility acceptance remain open.',
  'Encrypted isolated restoration is tested, but off-host backups, independent latest control history, activation and rollback qualification remain open.',
];
console.log(JSON.stringify({
  mode: 'offline_foundation',
  configurationValid: true,
  productionReady: false,
  deliveryEnabled: false,
  assistantEnabled: false,
  blockers,
  verificationSheetSource: 'docs/release-verification.json',
}, null, 2));
if (productionRequested) process.exitCode = 2;
