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

## Full AI workstream and configurable participation — 27 September 2026

After reviewing `sophie-ai-workplan-v0.3.md`, the owner requested Sophie's AI side
fully ready, rather than treating a public-only pilot as completion. Implement the
plan's character, knowledge, operating controls, explicit-memory and named
restricted-context work, with each capability's actual activation gates preserved.
Optional semantic retrieval and file publication still require their stated need
and separate scope decisions; they are not silently enabled by "fully ready."

The owner selected five configurable channel behaviors: conversational participation;
answer sufficiently supported questions; mentions/replies only; read/react with
speech only when asked; and ignore. This supersedes the plan's exclusion of ambient
participation only within explicitly configured channels and individually opted-in
sources. It does not authorize server-wide listening, historical imports, tickets,
onboarding content, unconsented sources, or cross-boundary conversation sharing.
Unknown channels default to ignore. Participation, consent, audience, retention and
worker authority remain separate settings.

The first local-model trial has a maximum 15-second end-to-end response lifetime,
including queueing, retrieval, generation and delivery. Expired work is discarded;
an acknowledgement is not a substitute for a timely answer. The owner's possible
future provider API key is a contingency, not approval to transmit Discord content
to a cloud model now. Keep local-only execution and no automatic cloud fallback.

Local implementation, focused synthetic checks, commits and regeneration of
protected generated artifacts are authorized. The original source artwork and
hardware addendum remain preserved. Up to two GPT-5.6 Luna Max sub-agents may assist
with bounded independent work in this workstream. New generated plans, research,
evidence and tooling belong in the external agent-documents directory. Existing
knowledge-release requirements (including the 40 reviewed questions and stated
quality thresholds) remain applicable to generated knowledge answers; social-only
tests need not invent knowledge questions. New AI activation gates use `SAI-G*`
names and do not replace the original release gates.

No live deployment, service/identity/ACL/hypervisor changes, new dependency exception,
platform-policy clearance or release pass is inferred. Production recovery remains
deferred as previously requested. The missing external continuation is reconstructed
from retained source/evidence with uncertainties identified, not historical work
marked unperformed.
### Local AI trial artifacts — 27 September 2026

The owner explicitly approved the candidates in the external local-worker proposal:
llama.cpp b10977 Windows CPU (SHA-256
`bdbb1ee5368b44112fa3fa9b3ac168a15d0d492e5c2f9fbe2074dd2f4628a4b9`), including the
named Apache 2.0 with LLVM exceptions scope for its bundled LLVM OpenMP runtime;
Bartowski's Phi-4-mini-instruct Q4_K_M conversion at
`7ff82c2aaa4dde30121698a973765f39be5288c0` (published SHA-256
`01999f17c39cc3074afae5e9c539bc82d45f2dd7faa3917c66cbef76fce8c0c2`); and the named
Windows Server Core image
`sha256:e10503b9a4f7faafa30aa0f5d0e8e7f7ca30a4496b3b87d61178b4d7c6815fb5`
using the existing Docker Engine. This authorizes candidate preparation and synthetic
qualification, not live AI activation, new general dependency exceptions, Hyper-V
installation, host reboot, cloud processing or production deployment.

The owner subsequently authorized enabling Hyper-V with management tools **without
automatic reboot**. This is a scoped host-role installation approval; reboot and
live AI activation remain separate operations.

### Container-only Microsoft C++ runtime — 27 September 2026

After the operator restart and contained startup diagnosed missing Microsoft C++
DLLs, the owner approved the reviewed container-only runtime proposal. This names
Microsoft Visual C++ v14 Redistributable x64 14.51.36247.0 under its Microsoft
licence, SHA-256
`843068991daaa1f73ad9f6239bce4d0f6a07a51f18c37ea2a867e9beca71295c`.
Installation as ContainerAdministrator is permitted only inside a disposable,
network-disabled Hyper-V worker container with the proposed resource limits;
inference returns to ContainerUser. This authorizes synthetic qualification with
the existing approved model/runtime/image pins. It does not authorize host runtime
installation, image redistribution, service/ACL/network changes or live AI activation.

### Smaller local model trial — 27 September 2026

After the Phi-4-mini trial failed to reliably finish within the response budget,
the owner selected the smaller local trial. This approves official
Qwen/Qwen2.5-1.5B-Instruct-GGUF at revision
`91cad51170dc346986eccefdc2dd33a9da36ead9`, file
`qwen2.5-1.5b-instruct-q4_k_m.gguf`, SHA-256
`6a1a2eb6d15622bf3c96857206351ba97e1af16c30d7a74ee38970e434e9407e`, under Apache 2.0.
Reuse the approved llama.cpp/Windows/Microsoft runtime pins and the four-CPU,
8-GiB Hyper-V envelope for synthetic preparation and qualification only. This is
a named model exception, not a general licence exception or approval for cloud
processing, live AI activation, larger host resource limits or image redistribution.

### Continue local-only exploration — 27 September 2026

After Phi-4-mini failed the response budget and Qwen2.5-1.5B met the small synthetic
timing screen but failed truthfulness/conduct checks, the owner selected
"Continue exploring local-only models." Continue local research and preparation
within existing authority; preserve failed results and the 15-second total-turn
ceiling. No cloud/API plan or remote Discord-content processing is selected.
New non-MIT model derivatives still need their named scope decision. Neither
completed trial qualifies a model for live use.

### DeepSeek Flash provider selection — 27 September 2026

The owner supplied a local credential-file path and explicitly instructed use of
DeepSeek Flash after researching and optimizing its integration. This supersedes
the preceding local-only exploration direction for this provider. It authorizes
the named remote API integration and bounded synthetic credential/model checks;
no further confirmation of that key use is required. Preserve local operation as
an alternative and never add automatic fallback between providers.

Use official `https://api.deepseek.com` with `deepseek-flash`, currently documented
as DeepSeek-V4.1-Flash. This is a mutable hosted model alias, not an immutable model
artifact; record observed model identity/fingerprint and requalify provider changes.
No provider SDK or new package dependency is selected. The secret stays outside
Git and diagnostic output. Only the inference identity receives the provider key.

The attached Gemini recommendations are review input, not permission to add vector
stores, automatic summaries, persistent personal memory or broaden eligible content.
Tickets/onboarding remain excluded. Existing participation, per-member consent,
current authorization, restricted-domain and release gates remain in force. The
15-second response ceiling is retained unless the owner changes it. This selection
does not deploy or activate live AI, approve sensitive/restricted context export,
waive provider data-handling review, or change service identities/ACLs.

The owner subsequently requested intelligent cache use to reduce cost and permit
more use. Optimize the authorized public-context request path: stable authored and
reviewed-source prefixes, one opaque provider cache partition per qualified public
channel/boundary/release, and measured token accounting. This also scopes the
provider's user_id safety/scheduling grouping at channel level. It does not merge
channels or restricted audiences, expand retained context, change participation
limits, add automatic summaries, pad requests or authorize background cache warming.

### DeepSeek workplan resumption — 28 September 2026

The owner reviewed `sophie-deepseek-workplan-v1.md` and explicitly resumed its
implementation, including commits and protected artifact rebuilds. The selected
spending ceiling is **USD 20 per calendar month in Europe/Vienna**. A separate
USD 1 daily money ceiling was not selected. Attempt/flood limits remain bounded
technical controls, not permission to increase participation or spend.

The owner selected temporary retention of validated, confirmed-delivered Sophie
replies inside the existing 12-item total/five-minute conversation ceiling. Each
derived reply expires no later than its earliest required conversational source;
edits, deletion, consent loss and source withdrawal invalidate its dependencies.
This does not enable automatic extraction or persistent personal memory.

Up to two GPT-5.6 Luna Max sub-agents are allowed for bounded independent work,
with one implementation owner per worktree. Preserve the paused candidate and
historical evidence; track DS tasks alongside existing P/T/SAI identifiers and
use `SAI-G*` for AI gates. The external continuation remains authoritative.
Existing named-provider synthetic authorization remains recorded; no new paid
comparison allowance, provider/account clearance, live provisioning, service or
ACL changes, migration deployment or AI activation is inferred from resumption.

### Initial explicit preferences and Discord rules — 28 September 2026

The owner selected two initial member-saved preference types: **reply length** and
**preferred language**, with inspection, editing and deletion controls. This
does not permit free-text biographies, inferred facts, sensitive records or
automatic extraction. Remote use remains disabled until its data-use and
restore/deletion gates are qualified. A preference never overrides destination
policy; the separately supplied Discord rules require English in Discord.

The owner supplied `aphelion-discord-rules.txt` as the approved rule text for a
separate source publication. Preserve its wording and provenance independently
from the MediaWiki Policies collection. The source channel is
`https://discord.com/channels/1527801651346411590/1528112081172172901` and contains
six separately maintained messages. Sophie is not in the main server yet; the
owner-supplied copy is provenance, not a claim of live channel verification.
Publication review is still required; do not substitute the wiki URL or ingest
Discord history to reconstruct those rules.

### Pinned Node runtime bundle — 28 September 2026

The owner approved the named Node.js 24.19.0 Windows x64 runtime proposal for
private Sophie packaging and synthetic qualification, including the embedded
non-MIT components under their retained original notices. The executable SHA-256
is `3602f2bb1a10f2cbab4c36886218a33c1ab3db87290e73b033c46c77147d0237`;
the exact scope and provenance are in `legal/node-runtime.json` and the external
`node-distribution-24.19.0/runtime-scope-proposal.md`.

This approves the exact binary and bundled notices, not separate adoption of
its components, TypeScript/SQLite application tooling, future runtime versions,
host replacement, service/ACL changes, container provisioning, redistribution
or deployment. Keep the vendor LICENSE and supplemental notices with each
private runtime copy. Node 24.21.0 remains an unselected maintenance candidate.

### Fixed Windows pipe companion — 28 September 2026

The owner explicitly approved the Windows helper proposal at
`GitHub/.agent_docs/aphelion-sophie/windows-pipe-companion/proposal.md`, SHA-256
`1ba4de7a88c711ed5b9973870a5cc76da715a01f3f222a8a97e6233cb605c6e9`.
This permits an original MIT C# pipe companion and the named installed Microsoft
.NET Framework 4.8.1/compiler 4.8.9236.0 for local builds and bounded synthetic
qualification, including explicit permissions on newly created test pipes.
The exact installed inputs and exclusions are recorded in
`legal/windows-pipe-toolchain.json`. JavaScript retains application policy,
authorization, encrypted protocols, accounting and provider interaction.

This is a narrow language/toolchain exception. It does not authorize changes to
existing permissions, accounts, services, installed software, containers or
deployment; it does not approve WinSW, NuGet dependencies or redistribution of
Microsoft runtime/compiler files. Actual service identities, installed-file
protection, worker-image compatibility and Hyper-V mapping remain operational
qualification gates. The proposal's source review is not a runtime test pass.

### Scoped Windows installation trial — 28 September 2026

The owner replied “You may proceed” to the request for the scoped Windows trial
and exact WinSW exception in
`GitHub/.agent_docs/aphelion-sophie/windows-pipe-installation/operational-trial-proposal.md`
(SHA-256 `d74129293d456e345b56ad15d50401e07c513f31feee5bb70b0fc1b125708afe`).
`legal/windows-installation-trial.json` records the named Manual trial services,
dedicated paths, existing pinned Server Core base, Hyper-V resource/network limits,
and exact private WinSW 2.12.0 NET461 bundle, including Apache-2.0 log4net 2.0.12
and MIT YamlDotNet 8.1.2. Its retained licence/security review still applies.

This extends the earlier local-helper approval only for the proposed synthetic
installation trial. Preserve pre-existing services, paths, shared ancestor and
Engine permissions. Stop at the first incompatible OS/runtime boundary; no
Framework binary copying, version substitution or host runtime replacement is
authorized. Paid requests, real Discord/main-guild activity, production databases,
game-service changes, reboot, firewall weakening and redistribution remain
excluded. Approval permits the trial; it does not establish operational readiness.

### Pinned guest Framework amendment — 28 September 2026

The owner approved the container Framework amendment (SHA-256
`ddbbfaf70a491435ee3597aff74129f0cf48c8f9ebabde30b1cefd5cb7ae579c`) at
`GitHub/.agent_docs/aphelion-sophie/windows-installation-trial-2026-09-28/runtime-amendment.md`.
This permits the Framework 4.8 runtime and bundled x64 csc 4.8.4161.0 already in
the exact approved Server Core image to build and qualify the original worker
helper and focused synthetic drivers. Complete its loaded-assembly/configuration
inventory first. Keep separate exact host/guest runtime profiles; host 4.8.1 pins
remain unchanged. Only original MIT outputs and evidence may leave the container,
not Microsoft runtime/compiler binaries. No installer, image/runtime upgrade,
NuGet/System.Core dependency or broader language change is approved. After this
runtime gate passes, continue the already approved Windows trial and its existing
OS-boundary stop conditions. See `legal/windows-guest-toolchain.json`.

### Fixed installation root amendment — 28 September 2026

The owner approved the fixed-root amendment at
`GitHub/.agent_docs/aphelion-sophie/windows-service-trial/installation-root-amendment.md`
(SHA-256 `06657e70367e36e00b56fb51865e7b05d48616304a2439fefec1a57454fbd162`).
Use `C:\Aphelion\Sophie` for the protected host installation, with the existing
fixed guest paths. Create only the absent dedicated parent/tree and repoint the
three already owned Manual diagnostic services, preserving their identities.
Preserve the old ProgramData tree and all shared ancestor permissions. Keep the
protected-file rejection rules intact; this is a layout change, not a permission
exception. Resume the previously approved synthetic service/file/pipe/HCS checks;
all other exclusions and OS-boundary stop conditions remain in force. Approval
and evidence are distinct; `legal/windows-installation-trial.json` records the
overlay without altering the original proposal or its hash.

### Private WinSW clean-exit build amendment — 28 September 2026

The owner approved `GitHub/.agent_docs/aphelion-sophie/windows-fixed-root-trial/wrapper-amendment.md`.
`legal/windows-wrapper-build.json` pins its hash and scope. This permits a private
WinSW 2.12.0 NET461 rebuild from the recorded upstream commit with the one-line
SCM Connect access fix, using the named installed SDK 10.0.400 / build runtime
10.0.11 and exact reviewed build packages/notices. Only necessary SDK, target,
reference-pack and analyzer pinning metadata may change. Preserve warnings and
checks; reject dependency resolution outside the recorded package set. This is
a narrow build-tool/distribution exception, not a change to Sophie's application
language policy or runtime. Record the derived wrapper hash before replacing
only the three owned stopped trial wrappers. Keep their identities and service,
SCM and shared-path permissions unchanged. Qualify clean/nonzero child exit and
operator stop, then resume the existing synthetic Windows trial. All prior
exclusions, operational stop conditions and release gates remain in force.

### Actual-owner HCS diagnostic amendment — 28 September 2026

The owner replied “Approved, proceed.” to the bounded HCS diagnostic at
`GitHub/.agent_docs/aphelion-sophie/windows-hcs-trial/diagnostic-amendment.md`
(SHA-256 `304f06e4af5d192ba475daab043bec99f83d0cd8bf08d33409424e7212105bda`).
`legal/windows-hcs-diagnostic.json` records its exact scope: existing core/egress
virtual accounts create disposable test pipes with actual role ownership and
owner-full/VM-group-data DACLs; a separate supervisor observes the associated
proxy process and runs restricted-token controls. At most two pinned synthetic
containers were permitted, with the second conditional on a complete first pass.
Only one identical-DACL reapply on a disposable pipe was permitted after an
accepted WRITE_DAC open, followed by unchanged host owner/DACL verification and
a stop. No production descriptor, profile, permissions or membership change was
authorized; the observed VM group is not an approved production identity.

The first run reached that stop condition: WRITE_DAC open accepted, identical
DACL reapply denied with Win32 5, host owner/DACL unchanged. Later guest checks
and the second container did not run. This approval does not waive the failed
forbidden-open gate or authorize further operational variations. HCS remains
unqualified; resolve the transport contract through a concrete recorded decision.

### Test Discord Server target with AI — 28 September 2026

The owner requested continued work toward testing Sophie on the Test Discord
Server and explicitly selected “Include AI; resolve its gates first.” The next
trial target is that test server, not the main server or an administration-only
substitute. Continue scoped implementation, research and local synthetic checks.
Preserve the existing containment, provider/account, publication, consent and
selected-capability gates. This does not turn the failed HCS diagnostic into a
pass, approve a proposed new operational variation, or activate real AI processing.

### Handle-rights observation authorization and consumed limit — 28 September 2026

The owner approved the exact one-container observation proposal recorded in
`legal/windows-hcs-handle-observation.json`. The attempt created one container
but stopped before start at a runner configuration guard. Cleanup is verified;
no guest rights were measured. This approval preserved all earlier failed
acceptance gates and did not authorize an architecture or permission change.
The replacement runner is corrected and checked offline; a second container
requires its own authorization under the explicit consumed limit.

### Completed replacement observation — 28 September 2026

The owner approved the corrected one-container replacement recorded in
`legal/windows-hcs-handle-retry.json`. The complete core/egress matrix returned
ten accepted forbidden opens; the existing gate remains failed. Data, host
owner/DACL and outsider controls passed; all operational cleanup is verified.
No further container or transport-contract change follows from this approval.
The separate per-purpose relay design in the external transport-decision.md
is a recommendation awaiting an owner decision, not an implemented or qualified
replacement. Associated vmwp identity and guest rights cannot populate a receipt.

### Relay source implementation approved — 28 September 2026

The owner approved the separate per-purpose relay architecture for local source
implementation and synthetic checks, recorded in `legal/windows-relay-implementation.json`.
This does not authorize service/account/permission/firewall installation, another
container or provider/Discord activation. Historical direct-HCS failures remain.
The existing worker reconnects after orderly probes and replies; the literal
fresh-boot-after-disconnect wording requires clarification before the final
repeated-session controller is selected. No silent contract amendment is made.

### Graceful relay reuse approved; no host restart — 28 September 2026

The owner approved fully drained FIN/ACK/confirmation connections continuing in
the same isolated AI worker boot. This supersedes the literal every-disconnect
fresh-boot wording in the preserved relay proposal. Unexpected disconnect, expiry,
revocation, helper failure or uncertain closure still invalidates the affected
worker boot. Normal completion neither exits the relay helper nor restarts the
worker. A fresh worker boot means replacing Sophie's isolated worker container;
it never means rebooting Windows or altering existing game services. No Windows
host restart is authorized. The original proposal bytes and failed HCS evidence
remain preserved. Local source/synthetic scope and operational gates are unchanged.

### Relay controller implementation checkpoint — 28 September 2026

Installed per-boot relay control is implemented: distinct private supervisor control pipes authenticate relay owners and the supervisor using OS descriptors; native grants bind installation, worker, release, profile, evidence, boot and operation. Persistent relay processes accept fresh boots after confirmed quiescence. Partial startup failure drains both purposes, qualification is bounded, and uncertain closure remains failed. No Windows host restart is part of this workflow.

Static installed owner profiles are version 3 with a zero boot placeholder; the
worker receives its real boot through the existing bootstrap contract. Private
relay control receives independently fixed release bindings and a fresh boot and
operation, never application keys. Successful drained exchanges may reuse a boot;
faults require a fresh worker boot. The 4,096-grant per-process replay budget fails
closed when exhausted. Operator renewal may restart only Sophie service processes;
no host reboot, automatic SCM restart or game-service change is authorized.
Qualification expiry remains at most 24 hours. Per-purpose package roots allow
independent network policy without blocking the egress application runtime.

Separately authorize and qualify the exact two relay service identities, filesystem/process/private-pipe/network boundaries, then the changed guest build/public HCS projection and installed composition. Provider/account clearance, publication/actual-answer review and remaining AI acceptance gates still precede Test Discord Server activation. No installed qualification receipt or production readiness is implied by local synthetic checks. See `GitHub/.agent_docs/aphelion-sophie/windows-relay-control/operational-proposal.md`. This checkpoint does not expand operational authorization.
