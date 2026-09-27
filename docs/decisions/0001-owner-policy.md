# ADR 0001 — Owner decisions for the fresh implementation

Status: accepted product decisions, supplied by the owner in this task on 18 September 2026. Scope: P00–P03, R01–R18. This record overrides conflicting recommendations in the preserved v1.1 pack. It does not authorise production deployment or approve an unnamed dependency.

## Repository and licences

This is a fresh implementation in Aphelion-Sophie. Original code will be published under the existing MIT LICENSE and copyright notice. The MIT adoption requirement covers directly reused FOSS projects. The owner subsequently approved the named PostgreSQL infrastructure exception; see ADR 0002. Other runtime/toolchain/indirect components still need an explicit, recorded scope review. No SQLite, TypeScript or model-artifact exception is inferred. Artwork and wiki content keep separate provenance/rights records.

One agent works in this task; do not follow the reference pack's delegation recommendations. Use JavaScript ESM/JSDoc, narrow injected contracts, native Windows, and one production Discord identity. Keep the separate Discord/BYOND integration unchanged.

## Admission, Crew and Muzzled

Humans complete admission and interviews privately before someone can join Discord. Current guild membership is the admission signal. Sophie must not perform age assessment, read admission evidence or build an interview system. Crew is a default role, not proof of a special admission tier.

Everyone currently in the guild should have Crew except Muzzled members. `/mute` applies the separate Muzzled role and removes Crew. A durable mute intent blocks Crew reconciliation and Whitelist delivery before external effects finish. Unmute must confirm Muzzled removal before Crew is returned. Staff authorisation, hierarchy and actual permission-overwrite behaviour still need staging checks.

Muzzled members cannot complete the Shuttle or receive its pending Whitelist grant. The foundation conservatively prevents step mutations while muted; partial progress is retained. After unmute they can resume, provided they have not lost Whitelist or left in the meantime. If muting invalidated an already queued grant, a fresh final acknowledgement is required.

## Shuttle and Whitelist

The owner supplied a rules entry and five pages in `Sophie-Implementation-Plans-v1.1/shuttle-onboarding.md`. Keep the original bytes. Adapt only legacy reaction/channel-unlocking instructions for the new private ticket/button flow. The imported presentation remains a draft until its controls, references and pagination have been reviewed.

Completing all five pages automatically requests the existing Whitelist role. Verify current guild membership, Muzzled status, session version and eligibility/access epochs immediately before delivery and after its response. Show completion only after the role is observed. Account linking and the in-game Get Whitelisted step remain with the existing integration.

Any Whitelist loss, for any reason, invalidates old completion and old queued grants. Leaving Discord also invalidates them. A member who returns must complete a new five-page run; never restore Whitelist from a snapshot or from an old complete session. A fresh, currently eligible run may earn it again without an additional staff clearance step. This supersedes the earlier suggestion that every staff removal would require manual clearance forever.

Existing Whitelisted members may repeat the experience without removing/regranting their role. A new repeat session uses the latest published copy, while each active session remains pinned to its own immutable definition. Losing Whitelist during a repeat requires a fresh run starting after that loss.

Blacklisting is documented and enforced privately by humans, by removing the person from Discord. There is no blacklist role, blacklist database, case lookup or bot-managed appeal workflow. A fresh membership check prevents delivery to a removed member. Sophie does not import blacklist reasons or internal documents.

## Staff and ticket audiences

The roles are Staff and lead ops. Role names document intent; runtime identity uses verified IDs, never name matching.

| Entry | Responder audience |
|---|---|
| Quick Help | Staff and lead ops |
| Admin Help | Staff and lead ops |
| Report a Staffer | Staff and lead ops |
| Tech Support | Staff and lead ops |
| Database Support | Staff and lead ops |
| Speak with the Head Admins | lead ops only |
| Shuttle assistance, staff-created contact, player-report use cases | Staff and lead ops |

Only Head Admin contact excludes ordinary Staff, per the owner's clarification. A requester retains access to their own case, including when they hold Staff; this does not grant access to restricted notes or management. A reported subject is never added automatically. Discord Administrator can bypass Discord channel overwrites; application authorisation does not treat that as a blanket dashboard capability.

## Retention and infrastructure

Retain closed case records, attachments and transcripts indefinitely, with no automatic age-based expiry. This does not imply unlimited capacity, guaranteed file capture, public exports or indefinite AI sessions. Attachment acquisition limits, storage quotas, capacity alerts and authorised exceptional deletion/restore handling still need implementation. Do not silently substitute finite case-retention defaults.

No test Discord application/guild or isolated Windows staging environment exists yet. No offsite backups currently exist. Offline development and synthetic tests may proceed; live integration, destructive failure/reboot tests and production cutover remain gated. Do not reinterpret the shared production game host as an isolated staging machine.

No AI sees tickets or onboarding sessions. Static artwork and approved copy remain ordinary presentation. The supplied source text is authored reference material, not a transcript or permission to issue its old reaction instructions.

## Production target and transcript exports — 20 September 2026

The owner clarified that the intended endpoint is setup on the production community
server **after all release gates**. An isolated staging host is a prerequisite,
not completion of that request. No independent off-host backup destination has
been selected. The owner can prepare a test Discord server and application if
Sophie can bootstrap the roles/channels it needs; local implementation of that
test-only setup path is authorized. Actual external setup still needs its exact
inputs and explicit operator action.

All currently authorized case readers, including members, may obtain a confirmed
transcript export of a ledger they can currently read. This does not expand case
or child-channel access, authorize public links, include Staff notes or file bytes,
or waive current authorization at delivery. The bounded implementation exports a
single selected channel with observations, attachment status and coverage gaps.
Attachment-download/scanning policy, larger-case export design and other release
gates remain separate.

## Isolated test-guild setup — 20 September 2026

The owner supplied an isolated test application/guild, installed the bot, corrected
its role placement and explicitly requested resumption. That authorizes the scoped
test bootstrap: dedicated roles/channels, current-owner Head Admin assignment and
the four fixed guild commands. This supersedes the earlier absence of test Discord
resources. It does not approve production deployment or changes to existing game/wiki
services. Dedicated test database, HTTPS ingress and live workflow acceptance remain
separate setup steps; no off-host backup destination has been selected.

## Persistent ticket navigation — 20 September 2026

After confirming the ticket destination works, the owner requested private
messages so ticket navigation does not disappear with ephemeral replies.
Send the opener one persistent DM containing static navigation text and the
verified channel link. Keep the ephemeral command response as a fallback when
DMs are blocked. This does not authorize forwarding ticket content, notifying
unrelated recipients, handling support conversations in DMs, or enabling AI.
Current membership, presence epoch and exact channel permissions still govern
delivery. Duplicate/reconciliation work must not repeatedly DM the opener.

## Backup destination, editor and configurable permissions — 20 September 2026

The owner selected `D:\Backups` for Sophie backups. This is the approved local
destination; it is not evidence of independent/off-host storage. Backup encryption,
separate key custody, recovery-point/recovery-time targets, backup retention and a
verified independent recovery copy remain release inputs. Do not infer automatic
expiry of case records or permission to alter other backup contents. The existing
backup tool creates new restricted child directories beneath its selected parent.

The owner will configure Shuttle guidance in the editor and explicitly confirmed
that adaptation includes adding, removing and reordering steps. This supersedes
the fixed-five requirement for new publications. Support a bounded 1–20-step
sequence, stable step identities and confirmation before removing draft content.
Versioned drafts, static pagination, publication review and pinned active runs
remain required. A new publication never rewrites an existing run's step count,
order or progress. Existing five-step source copy remains unchanged as a starter.

Closed tickets retain read-only access for their current authorized requester,
invited readers and configured responder roles. This approves the previous
provisional closure policy. Keep the existing Head Admin-only responder restriction;
closing cannot add ordinary Staff to that case type. Retain role grants as role
grants, not permanent user grants for everyone who happened to hold a rank.
Subsequent invitation removal, role loss, departure and revocation remain effective.
Untracked Discord overwrites and mere channel visibility are not authority to add
readers. Legacy sealed cases do not acquire a new audience automatically.

Permissions must be configurable through explicit role/channel mappings and
independently selected capability grants. Role names, built-in Staff/lead-ops
membership and Discord Administrator are not universal administrative grants.
The current implementation maps role/channel IDs in configuration but still has
fixed functional responder groups and lacks a reviewed permissions editor; these
are remaining implementation work, not a claim of full customization. Preserve
no-AI boundaries, current authorization, Head Admin privacy and BYOND role ownership.

The owner is available for a focused private-browser/member test when needed.
These decisions authorize continued local implementation and preparation; they do
not record a production deployment, live configuration change or release pass.

## Screens within Shuttle steps — 20 September 2026

The owner requested clearer screen separation and selected **Next/Back between
screens before acknowledging the step**. New authored boundaries are versioned
with their publication. Acknowledgement is available only on the last screen of
each step and is enforced by the domain transition, not merely the buttons.
Existing publications and sessions keep their original behavior. This remains
static authored guidance, with no AI access to onboarding sessions.

## Shuttle minimum-product priority — 20 September 2026

The owner changed the active objective to: “Focus on the Shuttle onboarding system
as the minimum product. Stop when we are ready for production deployment or
additional human testing is required.” This supersedes the previous instruction
to continue the broad administration backlog while waiting for private tests.
Keep existing work, but prioritize Shuttle and stop at its next concrete human
test boundary. This changes execution order and the stopping condition; it does
not waive privacy, role ownership, revocation, recovery or deployment-approval gates.
The existing pinned staging build already contains the screen/editor feedback
changes and is the current test target; local permission migrations are not a
prerequisite for that test.

## Persistent Onboarding page and shared wording — 20 September 2026

The owner reported disorienting replacement messages and visible internal markers.
One screen must remain in place and refresh like book pages, including Next/Back
within each step before acknowledgement. Keep backend diagnostics out of the normal
member journey while preserving truthful errors and current authorization.

The owner also requested an editor for bot system localizations and explicitly
selected **one shared set of wording** for the server. This is presentation data,
not per-member language selection or a path to case/onboarding content.

Use **Onboarding** in development and code. **The Shuttle** is only its public-facing
name. Rename implementation files/exports and current source-content paths; preserve
stored protocol/database identifiers and old endpoint aliases to keep existing data
and controls usable. This request authorizes that scoped naming migration. The
preserved reference pack and historical SQL migrations remain immutable.

Continue local implementation and validation until the next required private test.
These changes do not authorize production deployment, new capability grants or
permission-policy activation. See [implementation](../onboarding-experience.md).

## Onboarding staging upgrade authorization — 20 September 2026

After reviewing implementation commit 119084b and the schema-052 upgrade boundary,
the owner explicitly authorized proceeding. This covers preserving the existing
isolated schema-046 database with compatible tools, verifying a quarantined restore,
applying migrations 047–052, adding the restricted core grant for the new wording
table, and restarting the existing test host/connector on pinned 119084b. Verify
retained data, unchanged runtime configuration and current Gateway/public assets.
It does not authorize production cutover, permission-candidate activation, new
publisher capability grants or changes to unrelated services. Human acceptance
remains a separate private retest after upgrade verification.

## Onboarding channel lifecycle and login feedback — 27 September 2026

The owner reports private test batches 1–4 confirmed (editor/login, controls and
completion, Whitelist delivery and role exclusions); batch 5, shared wording, is
untested. This is bounded feedback, not a full production acceptance record.

The owner requests recovery when an Onboarding channel was manually deleted,
a command to close existing Onboarding channels, a public entry embed/button with
website-editable copy, and a separate login page that precedes dashboard pages.
The owner explicitly selected channel cleanup **one hour after completion** and
**three days when stale**. Retained records still have no automatic expiry.
Pending grants and unresolved help remain protected from automatic cleanup; manual
closure must cancel unfinished grants and retain late-effect compensation.

Implement and validate this scoped follow-up. Keep current membership, epochs,
Muzzled exclusion, human-only support and pinned publications intact. The existing
staging upgrade authorization covered 053; deploying the new 054 build and registering
new subcommands requires its own live-action authorization. No production approval,
new capability grants or permission-policy activation is implied.

## Whitelist command and staging 054 authorization — 27 September 2026

The owner explicitly approved the remaining staging upgrade and requested all public
/shuttle commands become /whitelist. This authorizes the scoped schema-053
preservation/quarantined restore, forward migration to 054, pinned host restart,
and in-place guild command rename with close/panel registration. Existing internal
identifiers and component IDs remain stable for retained runs. Historical payload
matching remains byte-compatible; new default instructions use /whitelist. Stored
authored wording and publications are preserved. No production cutover, unrelated
commands, new publisher grants or permission-candidate activation is authorized.

## Whitelist arrival and dashboard test feedback — 27 September 2026

The owner requests a ready destination before the arrival reply, one Begin Whitelist
link without a provisioning retry button, explicit automatic closure in completion
copy, navigation limited to permitted pages after sign-in, and editor presentation
consistent with the supplied Meridian About page. Implement scoped local changes
and validate with synthetic data. Keep current server-side authorization and
revocation checks; avoid the duplicate initial browser session request instead.
Do not overwrite authored copy or pinned payloads. The existing asset/font licence
boundary remains in force. The earlier 054 staging upgrade is complete; replacing
its selected build is a separate live-service action requiring authorization.

## Feedback build deployment authorization — 27 September 2026

After reviewing commit 036c3db and its validation summary, the owner instructed
“Deploy and proceed.” This authorizes replacing the existing isolated staging
build with pinned 036c3db, orderly host/connector/database restart, and public and
metadata-only verification. Schema 054, configuration, commands and grants stay
unchanged. The scoped deployment completed; private client acceptance remains open.
No production cutover, custom-font licence exception or unrelated service change
is authorized.


## Full website configuration — 27 September 2026

The owner selected “Full website configuration and apply workflow”: editable
Crew/base, Whitelist, Muzzled, Staff/lead ops, independent feature grants and case
routing, with review and actual application from the website. This supersedes the
candidate-only permission editor scope. The initial permissions publisher is
**Lead ops only**, explicitly selected by the owner. Preserve current authorization,
Head Admin privacy, external role ownership and the no-AI case boundary. Changing
Whitelist requires fresh completion; never transfer a snapshot. Local implementation,
synthetic verification and commits are authorized. Deployment of schema055 and the
configurable host is a separate live-service action; the previous “Deploy and
proceed” approval was completed on pinned036c3db/schema054.
See [configuration workflow](../permission-configuration.md).


## Configuration deployment approval — 27 September 2026

After the pinned a5e0232/schema055 candidate and validation were presented, the
owner instructed “Approved, proceed.” This authorizes this isolated staging
upgrade, preservation and quarantine restore, migration055, the configurable host
with separate owner/core pools, the new guarded core request-table grant, and the
previously selected Lead ops-only permissions publisher at capability version2.
The deployment completed with 779 Git file hashes, 70 unchanged existing tables,
55 migration/71 restricted runtime-table checks, current Gateway and 32 public
HTTPS checks. No private content was inspected. Other grants, command registration
and unrelated services remain unchanged. Live private apply/ACL acceptance and
production gates are still open; this approval is not a production cutover.
See [live evidence](../evidence/website-configuration-live.json).

## Private Apply acceptance and service continuation — 27 September 2026

After being told that the remaining live configuration acceptance gap was a
deliberate Save/Approve/Apply and resulting Discord behavior check, the owner
responded "That's done. Work on the rest now please." Record that as owner-reported
completion of this check; it is not a comprehensive production release pass.

When asked for independent backup and encryption-key custody destinations, the
owner replied "Skip production recovery for now. Handle the rest." Defer that
work without inventing a destination, activating restores or marking recovery
gates passed. Continue local Windows service preparation and focused validation.
Installing services or changing live identities, ACLs or deployment still requires
the explicit scoped authorization required by the current working instructions.

Per the owner's new storage instruction, new generated plans, evidence, service
templates and agent tooling belong in `GitHub/.agent_docs/aphelion-sophie`.
Existing in-repository evidence is retained as historical; the current continuation
is [the external workplan](../../../.agent_docs/aphelion-sophie/workplan.md).
