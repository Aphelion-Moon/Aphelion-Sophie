import fs from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';

const root = resolve(import.meta.dirname, '..');
const args = process.argv.slice(2);
if (args.length && (args.length !== 2 || args[0] !== '--output' || !args[1])) throw Error('RELEASE_OUTPUT_ARGUMENT_INVALID');
const output = args.length ? resolve(args[1]) : resolve(root, 'docs/release-verification.json');
const read = async path => JSON.parse(await fs.readFile(resolve(root, path), 'utf8'));
const catalogue = await read('docs/acceptance-cases.json'), workplan = await read('docs/workplan.json');
const baseline = execFileSync('git', ['rev-parse', '--short=12', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
const rows = [];
const add = (id, title, scope, kind, readiness, prerequisite, operator, procedure, expected, existing, source, gate = 'G2') =>
  rows.push({ id, title, scope, kind, gate, readiness, prerequisite, operator, procedure, expected, existing, source,
    result: 'Not run', actual: '', evidence: '', reviewer: '', runDate: null, runContext: '' });
const decisions = [
  ['D01', 'Runtime and licence scope', 'Admin launch', 'Owner / release reviewer', 'Exact production Node/PostgreSQL distributions and bundled notices; named infrastructure exceptions only.', 'Review pinned versions, hashes, direct/indirect notices and Windows service wrapper before adoption.', 'Signed scope record covers each shipped component; unapproved or changed hashes block activation.', 'Original code MIT; PostgreSQL exception and pg tree reviewed. cloudflared exception covers isolated staging only.', 'G0'],
  ['D02', 'Storage, queue and backup method', 'Admin launch', 'Owner / operator', 'Production backup method and restore tooling remain unfinished.', 'Confirm the single PostgreSQL backend, driver, migration process, backup method and responsible operator.', 'One reviewed production backend and executable backup/restore procedure with provenance.', 'PostgreSQL + pinned pg + repository outbox/migrations implemented; no alternate backend approval.', 'G0'],
  ['D03', 'Production roles and capability map', 'Admin launch', 'Owner / Head Admin', 'Production IDs, privately accepted capability mapping and single-writer role ownership agreement.', 'Map Staff, lead ops, Crew, Muzzled, Whitelist and BYOND-owned roles to verified IDs. Review every command/API capability and the installed candidate/apply/reconciliation workflow.', 'Owner-approved versioned map; only Head Admin contact excludes ordinary Staff responders; reported subject is not invited.', 'Closed read-only audience and configurable permission controls are implemented. Independent current mapping, live negative authorization and production cutover acceptance remain open.', 'G0'],
  ['D04', 'Existing-member admission and cutover', 'Admin launch', 'Owner / existing-bot operator', 'Reviewed live-member baseline and conflict procedure.', 'Review current member eligibility and responsibility transfer. Never infer completion from legacy progress roles.', 'Current membership remains the admission signal; preserve approved existing access; every Whitelist loss requires a fresh Shuttle.', 'Crew/Muzzled/fresh-run policy already approved. Baseline import and cutover not implemented.', 'G5'],
  ['D05', 'Files, storage and backup policy', 'Admin launch', 'Owner / operator', 'D:\\Backups selected locally. Independent recovery copy, key custody, retention, recovery targets and attachment policy remain open.', 'Use D:\\Backups for local bundles. Decide independent recovery copy/key custody, backup retention, RPO/RTO, file size/count/type/storage limits, quarantine/download rules and capacity response. Supply no credentials in this sheet.', 'Written bounded policy, approved destination and retention, accountable operator; capacity never silently deletes case history.', 'Indefinite case retention and confirmed exports for all current readers are already approved. Do not reopen these decisions.', 'G5'],
  ['D06', 'Source, connector and artwork rights', 'Admin launch', 'Owner / content reviewer', 'Production asset placement and connector scope review. Wiki permissions are conditional on G3.', 'Approve exact shipped artwork placements and sources. Separately approve any knowledge collections and connectors before enabling them.', 'No unverified website assets or source rights. Optional knowledge stays disabled until its approvals exist.', 'Four selected protogen PNGs preserved; exact website CSS/fonts remain unverified.', 'G0'],
  ['D07', 'Selected AI processing and qualification', 'Optional AI', 'Owner / operator', 'Official DeepSeek Flash is selected. Resolve DS-01 processing/deletion/transfer evidence, exact notice, approved sources, individual consent and separately authorized worker qualification.', 'Review each SAI-G capability separately. Verify the pinned provider/model, runtime/release/profile, actual worker isolation and stop, budget/queue/deadline behavior, source-bound answer quality and measured end-to-end latency under representative host load.', 'Only the exact reviewed capability/data scope activates. No automatic provider/model fallback; administration remains responsive. Redaction is minimisation, not proof of free-form anonymity or processing clearance.', 'Pinned5f60a24/schema066 staging is installed with the worker stopped and processing disabled. Configured identity/ACL evidence is distinct from actual worker denial/stop and live acceptance. Local models are historical alternatives requiring separate selection.', 'G4'],
  ['D08', 'Final identity, copy and placement', 'Admin launch', 'Owner / accessibility reviewer', 'Owner will author Shuttle guidance in the adaptive editor. Final published guidance and seven form categories need approval.', 'Review final static copy, URLs, question order, avatar crops, quiet mode and member/Staff screens in the real clients.', 'Recorded approval of the exact published versions and assets; live text labels remain usable without artwork.', 'Sophie, she/her, Community Services and the neon chibi protogen identity are fixed.', 'G2'],
];
for (const [id, title, scope, operator, prerequisite, procedure, expected, existing, gate] of decisions)
  add(id, title, scope, 'Owner decision', scope === 'Optional AI' ? 'Disabled track' : 'Needs decision', prerequisite, operator, procedure, expected, existing, 'docs/decisions/0001-owner-policy.md; 01-REQUIREMENTS-AND-DECISIONS.md', gate);

add('H01', 'Test identities and safe evidence', 'Admin launch', 'Test setup', 'Needs people', 'Consenting test accounts; synthetic guidance/forms; isolated guild only.', 'Owner / Staff',
  'Prepare requester, unrelated member/reported subject, Staff, lead ops and non-member actors. Test ordinary access without guild-owner/Administrator bypass. Use a private browser.',
  'Record actor roles and configuration. Store only redacted metadata, hashes and evidence locations here; never credentials, real reports or admission evidence.',
  'The isolated bot/guild and private-browser owner login work. Independent member/Staff privacy checks remain open.', 'docs/staging-operations.md');
add('H02', 'Saved ticket links and welcome recovery', 'Admin launch', 'Live check', 'Acceptance pending', 'Select current synthetic cases and authorized actors in the current test guild. Respect current quotas; historical case counts are not current state.', 'Requester / authorized Staff',
  'Confirm current saved-link DMs open the intended channels. Inspect /ticket issues or /case-delivery and review any parked welcome notice before Recheck. Verify one existing notice per selected ticket without duplicate sends.',
  'DM links remain available; welcome records confirm through current policy. Blocked DMs leave a private command fallback. No public case link or automatic repeat.',
  'Historical Quick Help navigation and two DM receipts are recorded. The test guild was subsequently reset; current case/job state and independent client acceptance must be observed afresh.', 'docs/evidence/ticket-direct-notices-live.json; docs/ticket-staging-diagnosis.md; docs/decisions/0001-owner-policy.md');
add('H03', 'Private-browser reader and export', 'Admin launch', 'Live check', 'Ready to test', 'Existing synthetic case; requester account; no browser cookies shared.', 'Requester / Staff',
  'Post synthetic test text in the case, enter its channel ID in /cases, inspect observations/gaps, review export and explicitly confirm. Open the download locally. Then remove reader access and retry.',
  'Export contains only the selected authorized channel, gaps and attachment status; no notes or file bytes. Revoked and unrelated readers receive no content.',
  'Synthetic browser/HTTP/export checks pass; owner live export acceptance remains unrecorded.', 'docs/case-browser.md; docs/case-exports.md');
add('H04', 'Publish and exercise all intake copy', 'Admin launch', 'Live check', 'Needs copy', 'D08; seven authored forms plus Shuttle definition.', 'Owner / Staff / requester',
  'Publish approved synthetic versions, then test Quick Help (no form), all ordinary form categories, player reports, Staff contact selection and every Shuttle step on desktop/mobile.',
  'Correct questions and controls appear; forms retain submitted version; reported subject gains no access; Head Admin contact excludes ordinary Staff.',
  'Editors and offline delivery paths exist; production copy and full live modal compatibility remain open.', 'docs/case-intake-delivery.md; docs/case-contacts.md; docs/workplan.json');

const knowledge = new Set([27, 28, 29, 30, 47]), ai = new Set([31, 32, 33, 48, 52]);
const prerequisites = new Map([
  [7, 'Restricted notes are implemented offline; complete live multi-account checks and file-download routes before full acceptance.'],
  [11, 'File acquisition is disabled in staging; approve D05 and finish download/scanning policy and composition.'],
  [24, 'Configured staging service identities/ACLs exist. Obtain explicit operator scope and current trust for actual worker file/network denial and physical-stop probes; synthetic database denial or configured ACL readback alone is insufficient.'],
  [35, 'Implement approved exceptional deletion and backup/restore handling; knowledge withdrawal is conditional on G3.'],
  [38, 'Staging service composition is installed. A host reboot, failure drill and production packaging require separate explicit authorization; current staging approval does not cover a reboot.'],
  [39, 'Qualify the implemented isolated backup/restore tool, add independent control history and choose off-host destination.'],
  [40, 'Implement reviewed existing-member baseline import and conflict handling.'],
  [41, 'Complete responsibility ledger and rollback tooling; retain old tickets.'],
  [44, 'Configured scheduling/DST behavior is not implemented.'],
  [45, 'Curated replies and static automation configuration/recovery are implemented with browser and synthetic delivery evidence. Complete independent current-source/client/permission acceptance; activation remains separately authorized.'],
  [57, 'Finish attachment operations/capacity alerts and retained-artifact recovery.'],
  [58, 'Independent recovery watermark/control history is not implemented; no off-host destination exists.'],
]);
const implementationTests = new Set([7, 11, 35, 39, 40, 41, 44, 57, 58]);
const operators = new Set([1, 2, 12, 15, 16, 17, 18, 21, 24, 35, 36, 37, 38, 39, 40, 41, 44, 46, 58, 60]);
const evidence = {
  1: 'Staging configuration rejects production scope; full environment-binding release matrix remains open.',
  4: 'Versioned permission editing, reviewed application and reconciliation are implemented; selective grants and queued revocation have synthetic evidence. Current-case readership remains separate; private owner/member mapping and live negative acceptance remain open.',
  13: 'One-step and twenty-step published journeys complete at their pinned final step and observed Whitelist delivery in isolated PostgreSQL. Existing runs retain their version; independent live tests remain open.',
  19: 'Adaptive Shuttle editor supports add/reorder/confirmed removal with saved publication review and retained versions. 58 focused checks, 54 database scenarios and synthetic mobile/browser checks pass; owner private-browser acceptance remains open.',
  3: 'Owner private-browser login works; synthetic state/CSRF/session checks pass. Live negative multi-account checks remain.',
  5: 'Shared ticket, moderation and Shuttle command/dashboard operations are implemented locally through schema069. Reviewed confirmation, current authority, receipt replay and proof-bound recovery have focused/database/browser evidence. The schema069 candidate is undeployed; independent route/client acceptance remains open.',
  6: 'Historical Quick Help opening/navigation passed before the later test-guild reset. Current category/recovery client paths need independent acceptance.',
  7: 'Restricted notes have synthetic member denial, Head Admin isolation, role-loss, retry, browser-clearing and core-restore evidence. Installed staging is pinned5f60a24/schema066; the local schema069 candidate is undeployed. Full live T07 and controlled file-download policy remain open.',
  10: 'Synthetic authenticated reader/export and browser tests pass. Full live cross-account/download review remains.',
  16: 'Synthetic uncertain-channel/recovery tests pass; live/operator rehearsal not recorded.',
  22: 'Qualified synthetic Gateway AI excludes case channels/artifacts and cancels late answers after destination restriction. Completed-admission P19-RT22 passes; one earlier intermittent AI_TURN_UNAVAILABLE remains unexplained. Actual worker and full live exclusions remain open.',
  23: 'Authenticated synthetic form/message/note/attachment/transcript routes and a restricted knowledge identity have sentinel exclusion evidence. No attachment-byte download route exists pending policy; actual process/storage boundary acceptance remains open.',
  26: 'Core-owned Contact staff opens the existing public category chooser privately after current membership checks. Selected ordinary forms are blank; Quick Help retains its no-form entry. Signed HTTP and composed PostgreSQL checks retain only explicitly entered answers, without AI source text or message IDs. The model cannot supply controls. Independent live acceptance and the full hidden-path inspection remain open.',
  34: 'Administration runs with inference absent in isolated staging. Full failure/load acceptance remains.',
  36: 'Offline reply recovery passes: /ticket issues metadata, audited Recheck, verified own-message adoption, old/concurrent revision denial and revoked-author withdrawal. Unknown sends cannot be blindly repeated. CR01–CR36 and RT01–RT10 pass; independent release failure rehearsal remains. See docs/case-replies.md.',
  39: 'Encrypted snapshot/retained-file restoration passes local PostgreSQL drills, including authored reply requests/audit, concurrent writes and operator CLI. Off-host storage, key custody and full release recovery remain open; see docs/recovery-bundles.md and docs/case-replies.md.',
  45: 'Configuration, source review, recovery and public-answer selection have synthetic HTTP/database/browser evidence. Stale authority, uncertain sends, exact receipts, revocation and quarantined jobs remain enforced. Full live T45 and owner publication/activation remain open; see docs/static-automation.md and current P18 evidence.',
  58: 'Local transactional control history and restored-ledger hashes are tested; tool-managed restores fence runtime, jobs and sessions. Independent durability, latest-state verification and replay are not implemented; see docs/recovery-controls.md. No full T58 pass.',
  49: 'Fixed brand-profile and source hash validation cover four selected assets and eight preserved copies. Local static placement review loads every original asset; owner distribution/placement approval remains open.',
  50: 'Local developer review covers small/circular avatar crops, light/dark alpha, 320 CSS-pixel reflow, live-text fallback, keyboard quiet mode and failed images. Actual zoom, independent accessibility and Discord upload acceptance remain open.',
  59: 'Owner observed the configured two-open-case limit; atomic race/restart matrix remains an offline result.',
};
for (const item of catalogue.cases) {
  const n = Number(item.id.slice(1)), scope = knowledge.has(n) ? 'Optional knowledge' : ai.has(n) ? 'Optional AI' : 'Admin launch';
  const gate = knowledge.has(n) ? 'G3' : ai.has(n) ? 'G4' : [39, 40, 41, 58].includes(n) ? 'G5' : [1, 2, 37].includes(n) ? 'G0' : [3, 4, 5, 36, 46, 60].includes(n) ? 'G1' : 'G2';
  const prerequisite = scope !== 'Admin launch' ? 'Enable only after separate owner scope, sources/artifacts and implementation approval. No dependency on this track for administration.' :
    prerequisites.get(n) ?? (operators.has(n) ? 'Reviewed isolated environment and operator-controlled fixture/failure plan. Obtain separate approval before any host reboot, destructive drill or production action.' : 'H01 identities and approved synthetic content. Finish the relevant UI/use cases before claiming full coverage.');
  const replyProcedure = n === 19 ? ' In the Shuttle editor add, reorder and remove steps (confirm or cancel). Test 1 and 20 steps, saved-version reuse, stale edits and exact retry. Review and publish; an existing run keeps its old count/order while a new run uses the new version. Owner supplies final guidance. Check mobile and keyboard use.' : n === 4 ? ' Configure an independent editor role without Staff membership. Verify only its selected actions work, case access does not expand, and role removal or a newer grant policy blocks queued actions.' : n === 5 ? ' At /case-replies, check review, confirmation, stale-case warning, status, exact retry, paging and privacy clearing. Compare /ticket reply with the current case reference, human text and confirm True/False. Check attribution, suppressed mentions, separate notes and closed/revoked denial. After uncertainty, inspect history before invoking a new command.' :
    n === 10 ? ' Check delivered reply attribution in conversation/export; unsent or cancelled draft text and restricted notes must not appear in member output.' :
    n === 36 ? ' For replies, rehearse lost POST/DELETE and lease takeover in isolated staging. Use /ticket issues and Recheck; unknown sends must require /ticket recover with a matching bot message ID. Check wrong IDs, old/concurrent revisions, revoked operators/authors, withdrawal and retained audit. Never reset send flags or repost uncertainty.' :
    n === 45 ? ' Review publisher authority, public-source attestation, stale edits, protected/moved/closed channels, priority/stop and cooldown dry-runs. Samples create no jobs. After separate owner authorization for the current build/source, test isolated activation, expiry, source deletion, permission loss, bot loops, mention/preview suppression, reaction ownership and post-send withdrawal. In recovery, test wrong/missing effects, stale versions, revoked publisher, lost/late responses, exact retry, retained audit and paused/quarantined jobs. Never reset an uncertain send. Check private-case separation and metadata-only receipts. Check public answers after departure/withdrawal; in /case-replies and /ticket answer test review, Cancel/Confirm, copied/duplicate clicks, expiry, role/audience/source changes and privacy clearing. Use synthetic data.' : '';
  add(item.id, item.title, scope, 'Acceptance test', scope !== 'Admin launch' ? 'Disabled track' : implementationTests.has(n) ? 'Needs implementation' : 'Acceptance pending',
    prerequisite, operators.has(n) ? 'Operator / developer reviewer' : 'Owner / Staff / requester', item.procedure + replyProcedure,
    item.expected + (n === 45 ? ' Publication requires current authority and eligible channels. Cases are excluded before matching; replay never duplicates jobs or resets cooldowns. Preview never sends/retains samples. Delivery respects permissions/deadlines; unknown sends never repeat. Recovery requires current authority and an exact existing effect; absence stays uncertain. Stale controls fail, exact receipts replay once, audit is retained and barriers/quarantine persist. Workers confirm or withdraw recovered effects. Existing reactions remain untouched. Public-answer review, author confirmation, cancellation and privacy checks hold.' : ''),
    evidence[n] ?? 'Specification retained; partial automated milestone evidence is in docs/verification.md. No full release pass recorded.',
    `docs/acceptance-cases.json#${item.id}; docs/verification.md`, gate);
}

const knowledgeTasks = new Set(['P20', 'P21', 'P22', 'P39']), aiTasks = new Set(['P23', 'P24', 'P25', 'P28', 'P32']);
for (const task of workplan.tasks.filter(task => task.status !== 'complete')) {
  const scope = task.id === 'P31' ? 'After G5 approval' : knowledgeTasks.has(task.id) ? 'Optional knowledge' : aiTasks.has(task.id) ? 'Optional AI' : ['P33', 'P34'].includes(task.id) ? 'Later extension' : 'Admin launch';
  const gate = ['P01', 'P02', 'P03'].includes(task.id) ? 'G0' : ['P04', 'P05', 'P06', 'P07'].includes(task.id) ? 'G1' : ['P26', 'P30', 'P31', 'P35'].includes(task.id) ? 'G5' : knowledgeTasks.has(task.id) ? 'G3' : aiTasks.has(task.id) ? 'G4' : 'G2';
  add(task.id, task.title, scope, 'Build prerequisite', task.id === 'P31' ? 'Awaiting G5' : scope === 'Admin launch' ? task.status === 'planned_not_started' ? 'Needs implementation' : 'Work remains' : 'Disabled track',
    (task.remaining_scope ?? [task.implementation_note ?? 'See current workplan.']).join(' '), 'Developer / operator',
    (task.remaining_scope ?? task.deliverables ?? []).join('; '), `Complete the approved task scope and record evidence for ${(task.acceptance_tests ?? []).join(', ')}. Do not treat a partial milestone as full task completion.`,
    `Workplan status: ${task.status}. ${task.implementation_note ?? ''}`, `docs/workplan.json#${task.id}`, gate);
}

const gates = [
  ['G0', 'Environment and licence decision', 'Admin launch', 'Approved production host resources, IDs/roles, platform and indirect licences, one transactional backend.'],
  ['G1', 'Foundation', 'Admin launch', 'Configuration, authentication, durable state, migrations, outbox recovery, health and dashboard login pass on the release build.'],
  ['G2', 'Human administration', 'Admin launch', 'Ticket ACLs, Shuttle, revocation-safe membership, transcripts and recovery pass with inference absent. Zero security/data-boundary failures.'],
  ['G3', 'Knowledge', 'Optional knowledge', 'Approved MediaWiki/index/direct lookup pass rights, authority, audience, template and deletion tests.'],
  ['G4', 'Selected non-ticket AI', 'Optional AI', 'Exact selected provider/runtime/profile, actual OS isolation and stop, no-ticket boundaries, processing/notice/consent, approved egress, budget/resource limits and source-bound quality pass. Each selected SAI-G capability retains its separate data/qualification/activation gate; redaction is not anonymity clearance.'],
  ['G5', 'Production cutover', 'Admin launch', 'Restore and rollback rehearsal, retention policy, existing-member baseline, responsibility transfer and operator release approval complete.'],
];
for (const [id, title, scope, expected] of gates) add(id, title, scope, 'Release sign-off', scope === 'Admin launch' ? 'Gate open' : 'Disabled track',
  'All applicable prerequisite rows must have accepted evidence for this exact release build. A spreadsheet entry is not deployment authorization.', 'Owner / release operator',
  'Review the complete evidence packet, zero-failure security results, outstanding defects and rollback procedure. Record the exact approved scope and build.', expected,
  'No full release gate is marked passed. G3/G4 remain disabled and do not gate an administration-only release.', '01-REQUIREMENTS-AND-DECISIONS.md#Release-gates', id);

const sources = ['scripts/build-release-verification.mjs', 'docs/acceptance-cases.json', 'docs/workplan.json', 'docs/decisions/0001-owner-policy.md', 'docs/verification.md', 'Sophie-Implementation-Plans-v1.1/01-REQUIREMENTS-AND-DECISIONS.md'];
const hashes = Object.fromEntries(await Promise.all(sources.map(async path => [path, createHash('sha256').update(await fs.readFile(resolve(root, path))).digest('hex')])));
const requirementsText = await fs.readFile(resolve(root, 'Sophie-Implementation-Plans-v1.1/01-REQUIREMENTS-AND-DECISIONS.md'), 'utf8');
const requirements = [...requirementsText.matchAll(/^\| (R\d{2}) \| (.+?) \| (.+?) \|$/gm)].map(([, id, title, coverage]) => {
  const tests = [];
  for (const match of coverage.matchAll(/T(\d{2})(?:[–-]T(\d{2}))?/g))
    for (let n = Number(match[1]); n <= Number(match[2] ?? match[1]); n++) tests.push(`T${String(n).padStart(2, '0')}`);
  // Preserve the source wording while showing the later owner's selected-provider decision.
  if (id === 'R10') return { id, title: 'Exact approved inference provider and runtime; no automatic fallback or prompt-containing telemetry', referenceTitle: title,
    decisionSource: 'docs/decisions/0001-owner-policy.md#deepseek-flash-provider-selection--27-september-2026', tests };
  return { id, title, tests };
});
for (const row of rows) row.requirements = requirements.filter(item => item.tests.includes(row.id)).map(item => item.id);
const manifest = { schemaVersion: 1, baseline, recordedAt: new Date().toISOString(), productionReady: false,
  context: 'Single-sheet human release ledger. Synthetic content only. Record commit, environment/guild, schema, config/capability versions and actor fixture; include runtime/model/source generation hashes when applicable.',
  resultsPolicy: 'Not run is not a pass. Record actual outcome, evidence location, reviewer, date and run context. Optional tracks require separate activation approval. Sheet results never activate production.',
  requirementPolicy: 'Current owner decisions supersede conflicting reference-pack wording. R10 retains its original title for traceability; local model-specific checks apply only to a separately selected alternative.',
  selectedAiCapabilities: workplan.ai_workstream.capabilities,
  sources: hashes, requirements, rows };
if (new Set(rows.map(row => row.id)).size !== rows.length || catalogue.cases.length !== 60 || requirements.length !== 18 ||
  requirements.some(item => !item.tests.length || item.tests.some(id => !rows.some(row => row.id === id)))) throw Error('RELEASE_COVERAGE_INVALID');
// Results apply to an exact reviewed build. Never erase or carry them into a newly
// generated baseline; reconciliation belongs to the human review workflow.
try {
  const previous = JSON.parse(await fs.readFile(output, 'utf8'));
  if (previous.schemaVersion !== 1 || !Array.isArray(previous.rows) || previous.rows.some(row => row.result !== 'Not run' ||
      ['actual', 'evidence', 'reviewer', 'runDate', 'runContext'].some(key => row[key] !== '' && row[key] !== null && row[key] !== undefined))) {
    throw Error('RELEASE_HUMAN_RESULTS_RECONCILIATION_REQUIRED');
  }
} catch (error) { if (error.code !== 'ENOENT') throw error; }
await fs.writeFile(output, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(JSON.stringify({ rows: rows.length, acceptanceTests: catalogue.cases.length, decisions: decisions.length, gates: gates.length, incompleteTasks: workplan.tasks.filter(task => task.status !== 'complete').length, productionReady: false }));
