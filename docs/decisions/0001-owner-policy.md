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

### Relay service trial authorized and stopped — 28 September 2026

The owner replied “Approved, proceed.” to `GitHub/.agent_docs/aphelion-sophie/windows-relay-control/operational-proposal.md`, SHA-256 b5188dd2aa645da88c6f403a4659a03c979a8e247b2256d799ce56116a11002a. This authorizes only its exact service/child-ACL/firewall/diagnostic/rollback scope; it excludes existing ancestor ACL changes, containers and AI activation.

Candidate files and wrapper matched their pinned hashes. SCM configuration and rule readback succeeded. The first inference service launch failed before its diagnostic/native entrypoint: Node lstat returned EPERM on C:\Aphelion. The original trial forbids changing that existing ancestor, so execution stopped. Secondary wrapper Event Log errors exposed omitted source registration in the sc-create diagnostic procedure. Both services, all 12 rules and all new directories were removed; existing three Sophie service states/files and six existing ancestor descriptors match preflight. No candidate processes remained.

The proposed amendment is `GitHub/.agent_docs/aphelion-sophie/windows-relay-service-trial/ancestor-amendment.md`, with exact before/after ACLs in `ancestor-acl-proposal.json`. It remains unapproved and unapplied. Approve the exact non-inheriting metadata-access amendment for the two relay SIDs on five existing ancestor directories, correct wrapper event-source registration, then repeat the authorized trial. Actual identity, private pipe, custody, process and network denials remain unqualified. Guest/public-projection, provider/account, publication/actual-answer and Test Discord Server activation gates remain open. No host reboot is authorized.

### OS-account worker isolation replaces Hyper-V relays — 29 September 2026

**Confirmed by the owner on 29 September 2026**, who also authorized implementation on the WUFF host
(the dedicated game-server host that also runs Sophie's staging). Other game services on WUFF must not be
disturbed. The owner also directed that every remaining reference to Sophie's former name be removed.

Reconstructed from the owner's own unpushed commit 7f55156 ("death to hyper-v"), which removed the
Hyper-V/Docker worker container, native pipe companion, relays and egress bridge approved on 28 September,
and recorded the rationale only in `docs/verification.md`. That commit had no decision entry. This entry
records the direction so that later work does not follow the superseded relay next step.

Selected design: the worker runs as its own WinSW-wrapped Manual service, `aphelion-bot-ai-worker`, under
the virtual account `NT SERVICE\aphelion-bot-ai-worker`. It reuses the existing pinned wrapper, Node
runtime and package layout. The supervisor may only query, start and stop that service. The worker reads
its boot/lease files and the provider key, and nothing under `trust\`. Its outbound traffic is blocked
except TCP 443, and in process the worker accepts only public IPv4 provider addresses. Loopback control and
inference channels stay authenticated and encrypted. Qualification is three operator receipts: service
account identity, file ACL scope and firewall egress scope, each hashed into the release evidence.

The owner's authorization covers running `ops/windows/Setup-InferenceAccount.ps1`, changing Sophie's
service wrappers and ACLs, and preparing the Test Discord Server deployment. It does not cover rebooting
the host or touching any non-Sophie service. The provider/account, publication/actual-answer, consent and budget gates are unchanged.
Historical HCS/relay evidence stays preserved and does not qualify this design.

### Test Discord Server fresh start and staging services — 29 September 2026

The owner supplied a new Discord application (`aphelion-sophie`) for the Test Discord Server and chose a
**fresh start** over migrating the previous application's policies in place. The documented bootstrap
created new zero-permission Sophie Test roles, a case category and a lobby, and registered the six guild
commands. A new `sophie_stage_bot` database was migrated to schema 063. The previous staging database
was first renamed from the former project prefix to `sophie_*`, with every retained row verified
unchanged. It is kept as `sophie_stage_archive_20260929`, with runtime logins revoked.

The owner also directed that the staging PostgreSQL cluster and tunnel connector run as Manual services
under their own virtual accounts (`aphelion-bot-postgres`, `aphelion-bot-tunnel`). This supersedes
decision 0004's "separate foreground connector, no Windows service" rule for staging only. The pinned
cloudflared hash and the tunnel's ingress rules are unchanged. PostgreSQL runs from Sophie's own
hash-verified copy of the reviewed 17.11 build, so it shares no binaries or identity with the game
servers' clusters.

The owner directed removal of every reference to the project's former name. That covers the database,
roles, local checkout, agent documents and host artifacts. Superseded material is archived on `D:\Backups`
rather than destroyed, and the obsolete egress service is uninstalled. No game service was stopped or
changed. The provider/account, publication/actual-answer, consent and budget gates remain open, and the
worker stays stopped until an owner starts it from the dashboard.

### Remaining test preparation authorized — 30 September 2026

The owner approved `GitHub/.agent_docs/aphelion-sophie/pretest-staging-proposal-2026-09-30.json`
with “Apply the prepared test update.” Scope: additive schema 064 with retained staging state,
a distinct restricted knowledge-editor login, independent private preference journal, versioned
AI/dashboard operator grants for the existing configured leadOps role, protected installation
renewal and only Sophie's staging service starts. Preserve current settings and archived records.
The worker remains stopped for owner dashboard action. No real-message processing clearance,
automatic publication/consent, production or game-service changes are authorized by this update.

### Blocker repair and preparation — 30 September 2026

The owner requested resolution of remaining blockers through repairs and preparation, explicitly
allowing commits and up to two GPT-6.1 Sol subagents at XHigh for this pass. This supersedes the older
model/effort restriction for this bounded work. One implementation owner retains all edits; the two
independent reviews are read-only. Local fixes, safe isolated checks and reviewable operator preparation
are in scope. Existing requirements for explicit live-service/permission changes, source publication,
provider processing clearance and owner-started worker activation remain unchanged. No host reboot or
non-Sophie service change is authorized.

### Prepared staging repair approved — 30 September 2026

The owner replied “Approved, proceed. Please continue until we can have our AI chat test.” to the
prepared `blocker-preparation-2026-09-30.json` staging repair. This authorizes the scoped worker-directory
grants, pinned7a152ca package renewal and Sophie core/supervisor restarts described there. The repair
was applied and verified on retained schema064. It leaves the worker stopped for the selected owner
dashboard workflow and real-message processing denied. No production or non-Sophie service action,
provider switch, source publication or fabricated qualification/consent follows from this approval.

The owner reports EU location, has not identified an API processing agreement, and asked whether a
disclosure/disclaimer is sufficient. This is a request for guidance, not acceptance of provider terms
or a waiver of DS-01. The provider enquiry is updated for EU processor/transfer requirements and remains
unsent. Existing synthetic-check authority is unchanged; actual worker and Discord acceptance remain open.

### Agreements and matching consent support requested — 30 September 2026

The owner requested creation of the agreements, disclosures and matching system support. The owner
identified an individual operator in the Netherlands and supplied a privacy contact; those details are
recorded in the external draft packet. This authorizes drafting and local implementation, not signing
for DeepSeek, sending correspondence, accepting unknown terms, or replacing DS-01 with a blanket waiver.
Members retain mandatory rights and ordinary community access if they decline or withdraw consent.

The schema065/source candidate binds remote consent to exact notice text and reviewed processing
evidence, preserves the latest acceptance snapshot, supports private export and keeps withdrawal
available during notice/provider outage. Schema2 processing approval requires separate reviewed
agreement, Discord service-provider, retention/deletion and transfer evidence. Drafts and legacy
schema1 approval are insufficient. No automatic notice publication or live migration is authorized by
this drafting request. The installed source7a152ca/schema064 and prior acceptance gates remain in place.

### Local identifier redaction for DeepSeek — 4 October 2026

The owner clarified that the requested anonymous memory work concerns avoiding transmission of
personally identifying member data to DeepSeek, rather than autonomous memory extraction. When
presented with the limits of automated anonymisation, the owner selected: **Keep free-form chat;
redact identifiers and retain privacy gates.** Local redaction is a minimisation measure, not proof
that arbitrary messages or resulting memories are anonymous or that EU compliance is established.

Apply bounded local redaction before eligible temporary context is stored, and independently to
outbound provider text. Preserve local identity for consent, deletion, revocation and delivery.
Use a private per-worker secret for the provider's channel pseudonym; the provider API key is not
an appropriate secret for that purpose. Same-worker channel grouping remains intentional for the
existing cache and audience boundaries. No reverse name map or new personal-text archive is needed.

Existing provider, exact-notice consent, source publication, budget and qualification gates remain.
Tickets and onboarding stay excluded before content or identity-alias processing. The two explicit
member preferences remain local and automatic long-term extraction remains off. No new persistent
memory category, live deployment, migration, processing clearance or worker activation is selected.

### Delete member AI data on departure by default — 4 October 2026

The owner selected: **Delete all data when leaving server unless they specifically choose to retain
in settings.** In this AI privacy workstream this applies to member-specific AI preferences, channel
consent and personal activity records. It does not change the permanent human case-record policy.
The explicit retention setting defaults to false and is protected by the independent preference
journal. Retaining saved data does not retain temporary context, authorize further processing or
restore active channel consent after rejoining; existing expiry limits continue to apply.

Record confirmed departures durably with core membership authority, then clean AI data through the
separate AI control identity. Retries and restarts must preserve pending deletion. An older consistent
database restore must not restore deleted settings or authorize AI processing. Keep only minimal
deletion/replay fences after successful erasure; accounting totals may remain without personal
activity records. Unresolved provider charges and unknown or failed external-effect cleanup remain
pending until their outcome is resolved, including effects that used the departing member's context
for another requester. Do not silently discard those obligations or claim immediate erasure from
backups, Discord copies or the provider.

Schema066, its narrowly scoped AI control grants, independent-journal health, matching notice and
retention annex, and worker/Discord acceptance require separate deployment qualification. This
decision authorizes the local implementation, not live migration, privilege changes or activation.

### Prepared schema066 staging update approved — 4 October 2026

The owner replied **Approved, proceed.** to the prepared staging proposal in
`GitHub/.agent_docs/aphelion-sophie/test-readiness-2026-10-04/deployment-proposal.json`.
This authorizes deployment of pinned commit `5f60a24099daa0031100dd626068fca6500e053b`,
migrations 065/066, the seven listed AI-control grants, independent-journal and installation
receipt renewal, and starts of Sophie's PostgreSQL, tunnel, supervisor and core services.
The worker must remain stopped, processing disabled and publications unchanged.

The scoped update was applied and verified. A protected, hash-verified cold recovery point was
preserved before mutation; its separate journal copy must never overwrite current deletion history
during database recovery. All 72 original rows across 101 tables were preserved by the migrations.
Only the seven approved grants were added; actual core, control and knowledge identities qualified.
Fresh configured identity/ACL/firewall evidence replaced the assembler's September evidence reference.
Journal bytes and identity were preserved. Installed package, service-child identity, loopback
listeners, recovered supervisor, current Gateway and anonymous dashboard checks passed.

This approval does not authorize worker startup, provider correspondence or paid requests, notice or
source publication, member processing, production/game-service changes or a host reboot. Actual worker
file/network denial, physical stop, Discord privacy/answer acceptance and measured latency remain open.
Evidence: `GitHub/.agent_docs/aphelion-sophie/deployment-5f60a24-2026-10-04/verification.json`.


### Pinned schema069 deployment and delegated export scope — 4 October 2026

After reviewing the pinned 335a3f2/schema069 deployment packet, the owner said, “Approved, proceed. Decide scope for me.” This authorizes that exact staging update, retaining the stopped worker, disabled processing, current publications and privacy gates. It does not supply DeepSeek contractual facts or authorize worker/provider/member processing. The scoped deployment and preservation evidence is in `GitHub/.agent_docs/aphelion-sophie/deployment-335a3f2-2026-10-04/verification.json`.

The owner also delegated the larger-export scope. The selected implementation is paged single-channel parts, keeping existing content exclusions and per-part count/byte limits. Each part requires explicit review and confirmation under current case, child and session authority. A continuation advances both retained streams without repeating an exhausted stream. Parts are current ledger views, not a globally frozen or complete-history archive. Multi-channel aggregation, attachment bytes and public artifact links remain outside this scope. This authorizes local implementation, not deployment of the subsequent export changes.

### Mistral provider trial — 11 October 2026

The owner reported that the planned DeepSeek use is blocked on EU data-protection grounds and, after
comparing Mistral with other hosted options, said: “Lets give mistral a try.” Offered a start on the code
port “with synthetic tests only (no key, no paid calls, no deploy)” using a pinned-model identity gate,
the owner replied: “Yes, proceed. I'll look into my side of things.” This supersedes the DeepSeek Flash
selection as the remote provider. It authorizes the local Mistral integration and synthetic checks only.

Use official `https://api.mistral.ai/v1/chat/completions` with the dated model `mistral-small-2603`
(Mistral Small 4); never a `-latest` alias. No provider SDK or new dependency is selected. Mistral reports
no build fingerprint, so the accepted-identity list holds exact returned model IDs and the worker holds on
any other returned model. The owner accepted that this is weaker than the previous fingerprint check: it
detects alias or model substitution, not a rebuild behind the same ID. Reasoning is disabled, JSON mode is
validated locally, and the existing channel-scoped private cache partition is sent as `prompt_cache_key`.

The DeepSeek client is replaced, not kept as a selectable alternative; it remains in Git history. A
processing policy, worker release or worker identity naming `deepseek` is now rejected. The provider is
part of the consent binding, so acceptance of a DeepSeek notice can never authorize Mistral processing.
The USD 20 monthly ceiling, 15-second turn ceiling, redaction, participation, consent and qualification
gates are unchanged. Default prices follow the model card (USD 0.15 input, 0.60 output per million tokens,
cached input at 10%); uncredited cache use is charged as uncached input.

This does not supply a provider key, authorize paid or live requests, accept Mistral's terms or processing
agreement, establish EU compliance, publish a notice, deploy, change service identities/ACLs/firewall, or
start the worker. DS-01 evidence must be collected afresh for Mistral. Unverified until a live call: the
usage field names, `reasoning_effort` and mid-conversation system messages on this model, and latency
within the 15-second ceiling. An installed budget policy keeps its recorded DeepSeek prices until replaced.

### Mistral compliance handoff received — 11 October 2026

The owner supplied “Discord Chat Bot — EU Compliance & Setup Handoff” and asked for the documentation to
be updated. It is preserved at
`GitHub/.agent_docs/aphelion-sophie/mistral-port-2026-10-11/owner-compliance-handoff-2026-10-11.md`, with
an evidence mapping in `ds-01-mistral-evidence-status.md` beside it.

Owner-reported status: a Zero Data Retention (ZDR) request has been submitted to Mistral support and
awaits review; the training opt-out is in force; until ZDR is approved Mistral's default retention
applies (reported as 30 rolling days for abuse monitoring) and must be disclosed. Mistral's ZDR
documentation, checked the same day, lists `/v1/chat/completions` as covered on paid plans and excludes
stateful products; the worker calls only that endpoint, and only the default EU host.

This is input to DS-01, not its completion, and not acceptance of provider terms or a statement that EU
compliance is established. Open: the paid plan and whether the processing agreement covers it and an
individual operator; sub-processor review; the ZDR outcome and proof; whether cached prompt prefixes
(`prompt_cache_key`) are retained under ZDR; a public privacy policy addressing the Message Content
intent; the exact consent notice, including the interim retention window if launch precedes ZDR; and an
AI disclosure in each enabled channel.

The handoff describes a generic bot. Where it differs from recorded decisions, nothing changes: personal
chat memory and automatic learning stay off, no `/forget` command, moderation endpoint, provider SDK,
Discord library or alternative hosting is selected, and tickets and onboarding stay excluded. Each would
need its own explicit decision. No key use, paid request, publication, deployment or activation follows.

### Member notes, Mistral key and test-server preparation — 11 October 2026

The owner supplied a Mistral API key file path and instructed: “Research a best-choice RAG or persistent
personal memory for Sophie that matches our compliance needs. Implement your decision. Prepare Sophie with
the new memory system and AI support for use on the test discord server (id: 1551010228642910318).” The
guild ID matches the installed staging mapping.

This supersedes the earlier position that personal memory stays off, for one named category only:
**member-written notes**. A member may save up to eight one-line notes about themselves (200 characters
each) beside the two existing response settings, in the same record with the same 90-day expiry, export,
deletion, default deletion on leaving and independent restore journal. Nothing is extracted from
conversation; automatic learning, summaries, embeddings and vector stores remain off and unselected.
Saved settings and notes reach inference only when the member ticks the separate sharing switch, only
for that member's own turn, only in a channel where they hold current consent to the exact notice, and
after the existing identifier redaction. Notes changed, unshared, deleted, expired or restored before
delivery cancel the turn. Document retrieval stays on the reviewed knowledge path; no change is selected.
Research and options: `GitHub/.agent_docs/aphelion-sophie/memory-2026-10-11/decision.md`.

Supplying the key authorizes bounded synthetic live checks with it; these were run and are recorded in
`docs/verification.md`. The key was read from the owner's file by the check script and was not printed,
logged, copied or committed. Two prompt changes accompany the memory work: Sophie is told when a member
addressed her directly, and what to say when asked to remember something or about an unseen conversation.

“Prepare for use on the test server” is taken as authority to prepare the exact candidate, notice draft,
provider evidence and processing-policy draft, and a deployment proposal. It is not taken as acceptance
of the DS-01 evidence, approval of the notice text, or approval to migrate the staging database, replace
the installed provider key, renew trust, start services or the worker, or process member messages. Those
follow the established reviewed-proposal and recorded-approval steps. No fabricated evidence receipt,
consent or qualification is created. Tickets and onboarding remain excluded.

### Mistral and member-notes staging deployment approved — 11 October 2026

Shown the proposal in `GitHub/.agent_docs/aphelion-sophie/test-server-readiness-2026-10-11/deployment-proposal.md`
and asked “Do you approve deploying `77b9d07` to staging as proposed, with the worker left stopped until
your policy is accepted?”, the owner replied: “I've already sent the ZDR request to Mistral. I approve the
policy edits and new deployment. Thank you.” This authorizes that exact staging update: pinned commit
`77b9d076e247a14bdeb20ba14a264f9d6ad23705`, migration 070, replacement of the installed provider key with the
owner's Mistral key, fresh source-bound trust for release `sophie-mistral-77b9d07` with accepted identity
`mistral-small-2603`, journal receipt renewal, and starts of Sophie's PostgreSQL, tunnel, supervisor and
core. It also approves the recorded Mistral and member-notes decisions and the drafted notice edits.

It is not recorded as acceptance of a processing policy. The notice still has sixteen unfilled facts, two
evidence files are still the owner's to supply, and acceptance is made by the owner running the policy
builder with `--accept`. No policy was installed, so opt-in and channel activation remain unavailable.

The scoped update was applied and verified the same day. A protected recovery point
(`D:\Backups\sophie-staging\schema070-77b9d07-20261011`) was verified before mutation, including the previous
provider credential and a separate journal copy that must never overwrite current deletion history. All
111 rows across 103 tables were preserved, no grant was added, and the one source file the candidate
deletes was removed from the package. The worker is stopped. This approval does not authorize worker
start, publications, member processing, worker isolation trials, production or game-service changes, or
a host reboot. Evidence: `GitHub/.agent_docs/aphelion-sophie/deployment-77b9d07-2026-10-11/verification.json`.

### Sign-in fix staging deployment approved — 11 October 2026

Told that dashboard sign-in failed because the callback handler refused Discord's `iss` parameter, that the
fix was committed as `66a69f8`, changed one file and needed a restart of core and supervisor, and asked
“Do you approve deploying `66a69f8` to staging?”, the owner replied: “Approved, proceed.” This authorizes
that exact source-only update: pinned `66a69f87af0fa29d6d9282ec4ee7c1f2fbbdcf7f`, fresh evidence and trust for
release `sophie-mistral-66a69f8`, journal receipt renewal, and a restart of Sophie's core and supervisor.

It was applied and verified the same day with PostgreSQL and the tunnel left running, the worker stopped,
no migration, no key change and no processing policy. Evidence:
`GitHub/.agent_docs/aphelion-sophie/deployment-66a69f8-2026-10-11/`. Worker start, publications, member
processing, policy acceptance and game-service changes remain outside this approval.

### Mistral processing policy accepted — 12 October 2026

Shown a draft processing policy (provider `mistral`, domain `public`, notice revision 3) with evidence receipts for
Mistral's Data Processing Addendum (effective 27 July 2026), Discord's Developer Terms of Service and Developer Policy
(effective 8 July 2024), retention and deletion, and international transfers, and asked to accept now with Mistral's
abuse-monitoring retention disclosed or to wait for its zero-data-retention answer, the owner replied: “Go ahead and
finalize, get us live.” The owner had earlier stated: “I have already sent an inquiry to Mistral regarding zero data
retention.”

This accepts policy evidence hash `3ff06663603339f82984f73fe3618e47aa435d47a1a96fbcb5610d791412cf5c`, valid until
10 January 2027, and authorizes installing it on staging with fresh trust for release `sophie-mistral-11c87c3`, a
restart of core and supervisor, and channel activation of a reviewed public channel by the owner through the dashboard.
Receipts are operator records of reviewed public documents, not legal opinions. Retention remains an open gap until
Mistral confirms zero data retention; the notice and receipts must then be revised and re-accepted. Restricted
channels, image or tool use, and production remain outside this approval. Evidence:
`GitHub/.agent_docs/aphelion-sophie/processing-policy-2026-10-12/`.

### AI consent survives Gateway reconnects within the same membership — 12 October 2026

Every core restart opened a new Gateway session, which advances every member's presence epoch because departures
during the outage cannot be observed; AI consent was bound to that epoch, so each restart silently withdrew every
member's opt-in. Asked whether to bind consent to the member's Discord join time instead, the owner replied: "Make
the fix." (after: "I shouldn't have to repeat this opt-in process every single time.")

AI admission now also accepts a consent whose presence epoch differs when the member's current Discord join time
precedes the consent's `updated_at`: the consent was given during the current membership. Any leave and rejoin,
observed or not, moves the join time past the consent and still voids it; an observed departure still disables and
by default deletes consents. An unknown join time refuses. No migration; case, onboarding and Whitelist presence
rules are unchanged. Commit on `codex/sophie-social-ai` with the AI observation read reduction of the same day.

### Dashboard views may reuse a role check for 1.5 seconds — 12 October 2026

The owner asked why every dashboard button took so long. Each API request observed the actor's Discord roles twice
(principal and capability, about four sequential Discord reads each), and a page load makes seven to eight requests.
Offered (A) a server-side queue instead of the busy refusal, (B) one request per page load, and (C) reuse of the
role observation for read-only views, the owner chose C only.

Dashboard GET requests (views) may now reuse the same member's most recent fully validated present-member role
observation for at most 1.5 seconds while the Gateway continuity stamp, which includes the Gateway sequence, is
unchanged. Reuse applies to principal resolution and to the AI capabilities (`ai.control`, `ai.personality.publish`,
`ai.knowledge.publish`, `ai.self`) and `answers.read` only. Case, contact, permission and automation reads, every
POST (action), every Discord command or interaction, and every moderation target still read Discord afresh; an absence
is never reused and a reused observation is never re-recorded. The storage suites showed that unrestricted view reuse
would also let a removed Staff member read case notes and labels for up to 1.5 seconds, contrary to the case-access
rules, so the agent narrowed the scope to the slow AI pages. Accepted trade-off: a role removed in Discord without a
Gateway event can still view, but not change, the AI pages for up to 1.5 seconds. Tests: `DA-VIEW-01` to
`DA-VIEW-04`; the dashboard-auth suite's browser actions now authenticate as POST, as browsers do.

### Worker self-restart, dashboard queue and single-load, and reply re-verification pacing — 12 October 2026

After the first working replies, the owner wrote: "Go ahead with the faster dashboard options. You can also let the
worker restart itself. Fix the paperwork and the reply timing as well."

- **Worker self-restart.** A running worker that loses readiness (one late heartbeat makes the supervisor quiesce
  it) is relaunched in place by core with the same approved release and a new boot, without re-disabling AI, so the
  owner's Go-live activation stays in force. At most three relaunches per ten minutes; a failed relaunch or a fourth
  loss records the slot as failed and disables AI, exactly as start-up recovery does. An owner request (pending
  phase) always takes precedence. This is the only path that moves a slot to a new boot while AI is enabled.
- **Dashboard queue (option A).** The single administrative request slot now queues up to eight requests for up to
  eight seconds instead of refusing them; one request still runs at a time, and a full queue, a long wait or
  shutdown still answers `DASHBOARD_BUSY`. Competing case writes are serialized and refused by their version checks.
- **Dashboard single load (option B).** The AI page loads its saved state through one `/api/ai/overview` request.
  Each part authorizes its own capability; a part the actor may not read is withheld and the page treats that as
  changed access.
- **Reply re-verification pacing.** Delivered replies are re-verified at most every ten seconds instead of every
  second, and not while a message is being handled, so periodic checks no longer exhaust Discord's five reads per
  second and starve new messages. Explicit withdrawals (opt-out, departure, message edit or delete) still mark the
  reply for cleanup and are removed at once; a definite "no longer current" result is removed on its next check.

### AI stack rebuild: Gateway state, two checks, plain worker service, persistent Go live — 12 October 2026

After Sophie stopped answering follow-up messages, the owner asked for an audit of the whole AI stack against other
projects (`GitHub/.agent_docs/aphelion-sophie/ai-stack-audit-2026-10-12.md`). Shown the four recommended decisions,
the owner replied: "Implement all recommended decisions, and any additional fixes or improvements that you stumble on
along the way." This supersedes the "Reply re-verification pacing" bullet above, the "qualification expiry remains at
most 24 hours" rule, and the worker start/stop operations of 30 September and 12 October.

1. **Turns read Gateway state and check authorization exactly twice.** Core keeps an in-memory projection of roles,
   channels, members, emojis and message revisions from Gateway events (`apps/core/discord/guild-state.js`); a READY
   resets it, a RESUMED keeps it, and observations are refused while the Gateway is not current. A member the Gateway
   has not described is read once over REST and then kept current by events. The checks are admission (request,
   fragments; history as it is read) and one pre-delivery check over every dependency, with `beginDelivery`
   re-checking the request atomically. No Discord REST read happens per turn for a known member. Rule 3 of `AGENTS.md`
   is unchanged: Gateway state is current, pushed state, not an old snapshot, and access-granting paths
   (Whitelist, cases, Shuttle, moderation) keep their own fresh reads.
2. **Delivered replies are not re-verified.** A sent reply is withdrawn only by an explicit event: opt-out (now an
   explicit withdrawal committed with the consent change), departure, or an edit or delete of a message it drew on.
   A reply that lands after the deadline is kept. Disabling AI or withdrawing a knowledge source no longer deletes
   earlier replies.
3. **The worker is an ordinary service.** The supervisor service, its control protocol, boot and lease files, the
   worker start/stop queue and the unused local-inference code are removed. The worker runs alongside core under its
   own account, reads its own trust file and the provider key, and connects to core over the loopback channel with a
   per-installation key (two concurrent turns). It retries while core restarts and WinSW restarts it if it exits.
   Trust and journal receipts no longer expire: integrity is checked against the installed manifest when each role
   starts. Only core holds the Discord token; only the worker holds the provider key.
4. **Go live persists.** Nothing re-disables AI on a restart. At start-up, active channel qualifications follow the
   installed worker release through the owner database role, so a deployment does not require a new Go live; a
   disable stays in force, and audience, consent, notice and budget are still checked on every turn.

Fixes found on the way: any member, role or channel event cancelled every in-flight turn and opened a fresh context
lane, so Sophie forgot conversations; an untargeted invalidation (consent change, AI disable, knowledge publication,
Gateway disconnect) wiped all context and marked every delivered reply in the guild for deletion; one failed or
cancelled turn paused the provider for five seconds and dropped the next members' turns; inference ran one turn at a
time across the whole server; the AI page denied every owner after a successful load (fixed earlier the same day).

Not authorized by this entry: production, game-service changes, a host reboot, new dependencies, restricted channels,
or a change to consent, notice, budget, retention or ticket exclusion. The staging conversion (retire the supervisor
service, upgrade the worker wrapper, write `trust\worker.json`) is a deployment the operator runs.
### Addressing Sophie by name; member interval paces unprompted turns only — 12 October 2026

After the hosting conversion the owner wrote that Sophie "still doesn't speak up when she's being addressed without a
ping or reply", and on being told that "mentions/replies only" addressing was one of the owner-selected rules,
replied: "It was an owner rule, you can relax it." A message that calls Sophie by name ("Sophie, …", "hey Sophie",
"…, Sophie?" or a question that names her) now counts as addressing her, like a mention or a reply; talking about her
in passing or a possessive ("Sophie's avatar") does not, and the model may still choose silence. The channel's member
interval now paces unprompted participation only: a message aimed at Sophie is limited by one turn per member at a
time (quick follow-ups join the turn being gathered) and the ingress flood limit. The five channel behaviours,
consent, exclusions and the proactive limits are unchanged.
### Personality direction and silence guidance — 12 October 2026

The owner described the character they want: "Chaotic gremlin that can straighten her back and stand up straight long
enough to answer a question appropriately"; "She can be chatty, she can be terse, she shouldn't punctuate every
statement with a question"; with the Aphelion lore and the community's LGBTQ+, furry and Space Station 13 background
as material. The fixed prompt rules no longer tell Sophie to prefer short replies or silence on every turn: the
published character sets her voice and length, the silence guidance applies when nobody asked her in, and she does not
end replies with a question by reflex. A character draft is in
`GitHub/.agent_docs/aphelion-sophie/personality-2026-10-12/` for the owner to review and publish through the dashboard
character editor; publication remains the owner's act. The draft keeps every existing limit (bot not staff, no invented
memories or lore authority, no pile-ons, no cases) and adds that Sophie does not stoke drama about other servers.
The owner then corrected the draft's safe-for-work line: "One reason I selected Mistral was because it cares less about
that"; "She can be freaky if she wants to be"; "The entire server is age restricted and ID check's at the door." The
draft now allows crude, suggestive and explicit adult talk, and keeps two limits: nothing sexual involving minors or
characters presented as minors, and no sexual content aimed at someone who did not invite it (dropped at once on request).

After publishing the new character, Sophie refused every message (`QUALIFICATION_MISMATCH`): Go live bound each channel to the
character and configuration published at activation, and the earlier persistence rule covered releases only. Offered to
make Go live follow publications, the owner replied: "Yeah go ahead please, thank you." At start-up and after every
control change, active channels now follow the published character and configuration (owner database role), provided the
configuration still lists the channel with a mode other than ignore; a disable stays in force.
### Conversational follow-ups — 12 October 2026

The owner reported that Sophie "doesn't follow conversational flow in the designated channel": a follow-up without her
name was skipped (`AI_ADMISSION_SKIPPED_NO_PERMITTED_OUTCOME`, the unprompted reply interval). For two minutes after
Sophie answers a member, that member's next message in the channel addresses her unless it mentions or replies to
someone else; anyone else speaking ends the exchange. Installed as `1354730` (source `f40dac8`).

### Synced public knowledge — 12 October 2026

The owner asked for Sophie to "answer questions about information on our main website, wiki, and github, particularly
our Repos". Shown the choice between automatic publication and per-change review, the owner chose **automatic
publication**; for GitHub the owner chose **documentation plus recent activity**. Scope:

- Meridian wiki (`meridian-wiki.a13.info`): every non-redirect article in the main namespace, re-checked every 30
  minutes; `Songs/` pages (instrument song sheets, largely third-party works) and pages over the extractor limits are left
  out. Authority is `policy` for pages in a Policies/Rules category, `lore` for Lore, otherwise `reference`.
- Main website (`meridian.a13.info`; `a13.info` itself is behind Cloudflare Access): the sitemap pages and the `/docs/`
  tree, honouring `robots.txt`, every 3 hours. `/lore` is `lore`, the rest `reference`.
- GitHub (`Aphelion-Moon`): the organisation's own public repositories, not forks: overview, README, CONTRIBUTING and
  Markdown files directly under `docs/` (except Aphelion-Sophie's internal engineering records), plus recent releases,
  open issues and pull requests, and recently merged pull requests, every 3 hours. Public repositories accept issues from
  anyone, so activity text is kept only from authors GitHub reports as owner, member, collaborator or earlier
  contributor.

Synced documents are published without a review click, cited with their link, licence and attribution, and expire seven
days after their last successful check. A page that disappears leaves retrieval at the next complete check. Withdrawing
a synced document in the dashboard excludes it permanently; re-publishing it by hand makes it an owner-maintained
document the sync no longer touches. Retrieval now matches any query word (with a minimum overlap), ranks titles and
headings above body text, uses the last few lines of conversation, and returns at most two passages per document. No
dependency, migration, credential or provider change.

### The wiki is the rulebook — 13 October 2026

The owner: "The wiki IS the authority for policy, it's not posted anywhere else." Sophie's fixed rules now say the
community's wiki is its official and only rulebook: when supplied policy evidence answers a question she states the rule
and cites it rather than sending the member to the wiki or to staff. Abstaining without policy evidence is unchanged.
The prompt budget rose from 16 KB to 32 KB, because at 16 KB every turn lost its whole conversation history.

### Shuttle message groups — 20 October 2026

The owner asked for the Shuttle to stop sending each step as one embed-heavy message: "an embed posted and kept at the
top of ticket which tracks users current status", then each step "as actual messages, followed by a fresh embed to
navigate", with the previous step's messages and navigation card deleted on every change. Faster page turns were part of
the same request. Shown the plan, the owner chose:

- **Write verification:** trust the message Discord returns for this bot's own create or edit while the Gateway records
  no member, authority, role, channel or guild change (the authority boundary already used by the AI lane). A message is
  read back only when that boundary moved or a write was uncertain. This replaces "a fresh read must match" after every
  write in [Shuttle screens](../shuttle-screens.md). An unconfirmed edit is still inspected before another write.
- **Transport:** the in-progress shared rate-limit registry and queueing change ships first.
- **Link previews:** chosen per message by the author, off by default ("Previews should be able to be enabled for a
  specific message, instead of just a hard always yes or no").
- **Click feedback:** Continue, Back and Check completion update their own card at once ("Opening…").
- **No Ask Staff:** "Remove the 'ask-staff' button from this process." Members can no longer raise a help request from
  the Shuttle. Requests, alerts, pauses and the Staff queue recorded before then are still handled; old buttons answer
  that they are out of date and record nothing.

A part create whose response was lost may be sent once more with the same Discord nonce within 60 seconds; Discord
documents nonce enforcement as duplicate suppression "in the past few minutes". After that it parks for review as before.
This keeps a single timeout during a step change from stranding the member; it is called out for owner confirmation.

### Staff take no part in the Shuttle — 20 October 2026

The owner: "Staff should not have to intervene in the Shuttle process at all." Shown the four places where a run could
wait on Staff, the owner chose:

- **Earlier help pauses:** resume them automatically. Migration 072 releases every pause and closes open help requests
  as resolved (rows kept, no Staff resolution record); unsent Staff notices are withdrawn; the "pause on help" rule is
  retired from the editor and drafts.
- **Lost posts and channel creates:** carry on automatically. A Shuttle message or channel create still unanswered two
  minutes after it started is given up: a step is posted again, a status card starts the run again at the same
  progress, a channel is created again. Duplicate channels keep the channel already opened, or else the oldest, and
  the others are sealed. Rarely, a member may see a duplicate message.
- **Whitelist delivery failures:** retry on their own, without a Staff ping. Delivery-problem alerts are no longer
  recorded.

Parking itself is unchanged, so a Staff recheck still works, but any parked Shuttle job (Whitelist grant or
reconciliation, Shuttle message, Shuttle channel) is rechecked automatically two minutes after it parks, doubling with
each recheck up to fifteen minutes. Only a global rate-limit halt stays with the operator. Muzzled still blocks the
Shuttle; that is moderation, not Shuttle intervention.

### Role and channel checks follow the authority boundary — 20 October 2026

After the first staging walk-through the owner reported "significant lag and stutter throughout navigating the pages"
and asked for stale navigation cards to be fixed proactively. The traces showed every Continue retried once after
`OBSERVATION_INVALIDATED` (about 5 s per click) and page renders needing two to five attempts. Role, member and channel
observations were checked against the Gateway continuity, which every dispatch advances. With AI message events on, the
"Opening…" edit of the clicked card, each post of a step and any chat in the server overtook them.

Implementation decision under the owner's request, extending the write-verification choice in "Shuttle message groups"
above:
- Role, member and channel observations (roles, case channels, actor authorization) are checked against the authority
  boundary. It advances on every member, authority, role, channel or guild event and on every reconnect, and it is
  absent while any dispatch is still being processed.
- Message reads (Shuttle message inspection, transcripts, automation sources, direct notices, child threads) keep the
  full continuity.
- Dashboard view reuse stays bound to the full continuity, per "Dashboard views may reuse a role check for 1.5 seconds".

Without the boundary adapter (any journal that does not record it), the full continuity applies as before. No access
rule changed: every check still reads Discord afresh, and any authority change still voids it.

### Faster isolated database tests — 20 October 2026

The owner: "Thirteen minutes per build is excessive", and asked for the storage tests to be audited and condensed. Shown
the audit, the owner chose:
- **Durability:** relax it on the synthetic throwaway test clusters only (`fsync`, `synchronous_commit`,
  `full_page_writes` off). This replaces the earlier harness rule of keeping `fsync` on. Staging and production are
  unchanged.
- **Condensing:** merge exact duplicates only, keeping every requirement and test ID covered.

The audit found no scenario that duplicates another; colliding scenario IDs (`CA01`–`CA13` in three suites, `PA01`–`PA10`
in two) name distinct checks. Details: [storage](../storage.md) and the
[storage test inventory](../storage-test-inventory.md).

### Production-test preparation: artwork, Shuttle wording, channel title and category — 20 October 2026

The owner: "We also need to clean-up random references to staff helps in onboarding, such as `once any outstanding
Staff help is resolved`. The onboarding tickets should have a specifically configurable category that they show up in.
The title of the tickets for onboarding should be `[Discord_Username]'s Shuttle`. For now, as well, I want you to
remove all of her custom art and assets, as well as removing references to them." The owner also directed that all
branches be merged into `main` and work continue there; `codex/sophie-social-ai` was fast-forwarded into `main` and
`staging/admission-trace` (deployment ports whose runtime code matches main) was merged keeping main's content.

- **Artwork.** Sophie's four PNGs, both asset manifests and brand profiles, the brand-profile contract and the
  dashboard avatar are removed; the dashboard shows "Sophie / Community Services" as text. This supersedes the
  identity-asset rules of chapter 12 and the earlier "do not change source artwork" instruction. The planning
  pack's prose is kept as a superseded record. Sophie's published character still calls her a neon chibi protogen;
  that is personality text, changed only by the owner through the character editor.
- **Staff-help wording.** Member-facing Shuttle replies no longer mention Staff help, and the Shuttle case type is
  labelled "Shuttle". Wording kept only to recognise messages posted before Ask Staff was removed is unchanged.
- **Channel title.** A new Shuttle channel is titled "<Discord username>'s Shuttle" from a fresh member read; the
  username is not stored. Discord's channel-name rules apply to how it is shown.
- **Category.** `casePolicy.shuttleCategoryId` is optional and chosen on the Permissions page. Unset keeps Shuttle
  channels in the case category. Setting or changing it is a case-policy change applied through the reviewed apply
  flow, and the category is recorded as a case exclusion for AI and automation.

No migration, dependency or new Discord permission. Not deployed.

### Sophie keeps her own memories — 20 October 2026

After the AI review the owner wrote: "Sophie is supposed to be creating her own memories, it's not supposed to be just
user input." This supersedes the 11 October position that nothing is extracted from conversation (option B of that
research was then rejected). Asked four questions, the owner chose:

- **Scope:** both member memories (what a member says about themselves) and channel memories (moments, events, running
  jokes), each tied to the members it mentions.
- **Control:** saved and used at once; each member can see, edit and delete what names them, and the owner can review
  and delete any memory.
- **Exclusions:** identifiers only: real names, locations, contact details and account IDs. The recommended wider
  exclusion of sensitive topics was declined.
- **Retention:** 90 days after a memory was last used; deleted on leaving unless the member keeps their AI data.

Implementation decisions: memories ride on the existing reply output (no second provider call); members are stored as
subjects with placeholders, never names or turn labels; a member can turn memory off; the restore fence reuses the
independent preference journal. Memory stays off until the owner re-accepts a processing policy with
`automaticMemory: true` and a notice that discloses it; that changes the consent binding, so members opt in again.
Details and the proposed notice text: [Sophie's own memories](../ai-memory.md). Not deployed; no policy change made.

### The Shuttle becomes an Activity — 21 October 2026

The owner's developer suggested a Discord Activity for onboarding. The owner asked for the Shuttle to become "an
interactive visual novel, presenting the same information in a more immersive way", animated with ASCII art, with a
main page like a video game's (ARC Raiders as the example), following the Aphelion art and style guidance. The owner
reviewed the V1 plan ("Shuttle Visual Novel V1", its ten decisions D1–D10) and answered; four follow-up questions were
answered the same day.

- **D1 Activity surface.** "I can enable the activity surface." The owner enables Activities on Sophie's existing
  Discord application, which creates Discord's default Launch entry-point command. The Embedded App SDK (MIT,
  © 2024 Discord Inc.) is approved as a direct dependency: pinned with its hash, bundled, never auto-updated, with its
  transitive and bundled licences reviewed when it is added.
- **D2 Artwork.** "Make all the new art yourself. Remove any guidance which instructs you not to do so." The coding
  agent makes the Activity's art: ASCII scenes, colour masks, effects and the Rules post banner. This supersedes, for
  new art, the 20 October removal and the rule that no artwork is added without a new owner decision; AGENTS.md and
  P36 are updated to match. Each asset gets a provenance record (made by the coding agent at owner direction, date,
  commit); that record notes that machine-made art may not attract copyright in every jurisdiction. This is authored
  source art: Sophie's AI still gains no image generation, and the Shuttle has no AI path.
- **D3 Sophie.** "Sophie can just be included as a 'radio voice' for the intents of the story, we don't need to show
  her face." Follow-up: she reads all of the published copy. Lines appear as radio transmissions from
  Sophie · Community Services. No new copy, no portrait or likeness, and no synthesized voice, since the Shuttle stays
  AI-free. A radio sound may accompany her lines (D10). These lines are the published static copy, not her AI
  character, memories or replies.
- **D4 Font.** Cozette (MIT) draws the scene grid, pinned with its hash; the scene validator checks that every
  character used is in the font. Implementation decision: dialogue and interface text use the platform's own fonts
  (nothing bundled, no licence step). Website fonts remain unverified.
- **D5 Rules post.** "I want to have an embed that I can post into our Rules channel which launches the application
  for people, or guides them to it. I want it to reflect the feel of the new activity." The public Shuttle entry panel
  becomes this post, styled like the Activity. Its Board the Shuttle button answers with Discord's launch-activity
  response, and a second route gives the text version to anyone whose client cannot open Activities. Copy stays
  editable from the dashboard. Members need permission to use Activities in that channel; the spike confirms what
  Discord requires. Where the Activity was launched grants nothing: every action checks current eligibility.
- **D6 Presence.** Allowed. Implementation decision under that choice: presence names the Activity area and the
  current stop only, never Whitelist, Muzzled or other eligibility state.
- **D7 Tickets.** The owner asked whether the whole ticket system could go. Shown that tickets also carry Quick Help,
  Admin Help, Report a Staffer, Tech and Database Support, Head Admin contact and player reports, and that the
  published Shuttle copy sends feedback to #open-a-ticket, the owner chose: **the Shuttle leaves tickets.** New runs
  no longer open a private Shuttle case or channel. The run lives in Sophie's database and is shown in the Activity,
  with the text version from the Rules post as the fallback, and it stops counting against case quotas. Every other
  ticket type is unchanged. Existing Shuttle cases, channels' records, transcripts and capture ledgers are kept with no
  automatic expiry; runs already in a channel keep the 20 October channel rules until they close, and moving a
  run in progress keeps its step. For new runs the record is the run itself: its receipts, acknowledgement and
  Whitelist grant records, with no automatic expiry.
- **D8 Production.** "We can just work on the production activity." Shown that enabling Activities gives every member
  a Launch command at once, the owner chose the live application with a tester gate. Everyone except named testers
  (configured user IDs) sees a closed "not boarding yet" screen until the owner opens it. Automated tests still use
  synthetic data. Each production deploy and the opening remain recorded owner approvals. Still open: production
  ingress. ADR 0004 approves cloudflared for isolated staging only, so the production hostname and connector need the
  owner's choice before the first production deploy.
- **D9 Main page.** All recommendations: V1 offers Board/Continue, Settings, Text mode and Credits; Station log and a
  Codex are reserved and hidden; a public landing page is deferred. The owner expects the Activity to grow into
  general information and community navigation of resources, so the main page is built as a registry of sections
  with fixed action kinds. Information comes from MediaWiki (the current source) and approved knowledge. An AI-backed
  section would need its own decision, and Shuttle state never enters such a path.
- **D10 Sound.** "Use open source sounds. Provide me with options to select from for each one that you need."
  Follow-up: CC0 and CC-BY. This is the recorded scope decision for audio assets: CC0 1.0 and CC BY 3.0/4.0 only;
  NC, ND, SA and unclear licences are excluded. Each sound is pinned with its source URL, author, licence and SHA-256,
  and CC-BY sounds are credited on the Credits screen and in a notices file. The coding agent proposes options for
  each sound cue; nothing is bundled until the owner picks. Sound starts only after the member interacts, with volume
  and mute in Settings.

Plan tasks P40–P44 are in the [workplan](../workplan.md). No code, migration, dependency, permission or production
change has been made.

### Shuttle Activity sounds chosen — 21 October 2026

The owner picked one sound for each of the 23 proposed cues in a private picker page offering CC0 and CC BY options.
On the title theme the owner wrote: "I want you to use Outer Space Loop for after whitelist is confirmed at the end of
the onboarding process. I really enjoyed that track. Otherwise, Suspension is good for the title theme." That adds a
24th cue, **MUS-02 Arrival theme**, which plays only after Discord confirms Whitelist; Suspension stays the title
theme. 23 sounds are CC0 1.0; Suspension (kjartan_abel) is CC BY 4.0 and is credited on the Credits screen and in
`legal/THIRD-PARTY-NOTICES`. The choices, sources, authors and licences are in
`legal/shuttle-activity-sounds.json`. No audio has been fetched, changed or bundled yet, so no file hash is recorded.

### Audio encoding tool for the Shuttle Activity — 21 October 2026

The owner later downloaded the 24 originals; their hashes and formats were verified and pinned in
`legal/shuttle-activity-sounds.json`. They are mostly WAV (158 MB) and must be converted to ship. Shown five routes
(FFmpeg LGPL, opus-tools, LAME, the Windows AAC encoder, no encoder), the owner chose: "Record FFmpeg (a pinned LGPL
Windows build, used only at build time on the dev machine) as the encoding tool: Ogg Opus for every sound with an MP3
fallback for older iPhones."

- **Scope.** This is the recorded scope decision for a non-MIT toolchain: FFmpeg, the LGPL variant of BtbN's Windows
  build (no `--enable-gpl`, no nonfree components). This build is configured with `--enable-version3`, so its
  effective licence is LGPL-3.0-or-later (corrected after download; first recorded as 2.1-or-later). It runs only on the development machine
  to convert the chosen sounds. It is not redistributed, bundled, installed as a service or run on the production
  host, and its licence does not extend to the converted audio, which keeps each sound's own licence.
- **Pinned build.** `ffmpeg-n9.0.2-17-g2a571b6068-win64-lgpl-9.0.zip` from release `autobuild-2026-09-30-13-08`
  (171,535,354 bytes; SHA-256 `6b264b9e6019103f601d98c292bd332fd87acf1c5e941ddff4fb71760fe63432`, matching both the
  release's `checksums.sha256` and GitHub's asset digest). It is the last build of September 2026, which the
  publisher keeps for two years. No automatic updates; a different build needs a new record.
- **Output.** Ogg Opus for every sound, plus an MP3 copy of each served only to clients that cannot play Ogg Opus
  (Safari and iOS before 18.4; Discord supports iOS 16 and later). Cuts, fades, loudness and loop points are applied
  during conversion or stored as data. Any change to the CC BY track is stated in its credit.
- **Downloaded and checked.** At the owner's request the zip was downloaded into `.local/tools/ffmpeg/` (ignored by
  Git). Its SHA-256 matched the value above. `libopus` and `libmp3lame` are present, and GPL-only and nonfree
  libraries are disabled. The archive carries only FFmpeg's LGPL-3.0 text, not notices for its statically linked
  libraries; those were not reviewed one by one because nothing is redistributed, and that review is required before
  any redistribution. Details: `legal/ffmpeg-build-time-encoder.json`.

### Shuttle Activity sounds approved — 21 October 2026

The 24 sounds were converted to Ogg Opus with MP3 fallbacks (build `618ef40`, see
[Shuttle Activity sounds](../shuttle-activity-sounds.md)). The owner auditioned every one on a private page, in both
formats and with each loop and its seam, and approved all 24 with no requested changes. The approved files are the
outputs whose hashes are pinned in `legal/shuttle-activity-sounds.json`; changing the edit data needs a new audition.

### Shuttle Activity application and hostname — 21 October 2026

The owner: "For Sophie, we're going to keep the current bot details, and then we will make a separate application
for testing down the road. Cloudflare connector is online … The activity can go at `onboarding.a13.info`. I can't
enable the Activity at the moment because we don't have our URL Mapping configured."

- **Application.** The Activity is built on the Discord application Sophie uses now. A separate testing application
  comes later; until then the D8 tester gate is the only protection, so Activities stay disabled until the closed
  "not boarding yet" screen is served.
- **Hostname.** `onboarding.a13.info`, through the running Cloudflare connector: the `aphelion-bot-tunnel` service,
  pinned cloudflared 2026.7.3, tunnel `sophie-staging`. This extends ADR 0004's single-hostname ingress to a second
  hostname and settles D8's open ingress choice. Proposed route: `onboarding.a13.info` → `http://127.0.0.1:38124`,
  placed before the catch-all, with a proxied DNS record pointing at the tunnel. Port 38123 is taken by the
  connector's metrics listener.
- **Not done.** The supplied token verifies as an active account token but has no Cloudflare Tunnel, DNS or zone
  permission, so no tunnel or DNS change was made and nothing serves the hostname yet. The token was used only in
  request headers and was not recorded.
- **Order.** Serve the closed screen on the route, then set the URL mapping (root `/` → `onboarding.a13.info`), then
  enable Activities, so a member who finds the new Launch command sees "not boarding yet" instead of an error.
- **Update, 22 October 2026.** The owner enabled Activities before the route existed, then supplied a token with
  Cloudflare Tunnel Edit, DNS Edit and Zone Read and asked: "Add the route and DNS record, then start the closed
  screen." The `sophie-staging` configuration went from version 2 to 3 with only the new rule added before the
  catch-all (backup of version 2 in `.local/cloudflare/`), and a proxied CNAME for `onboarding.a13.info` points at the
  tunnel. No other tunnel, rule or record changed. The closed screen (`apps/activity/closed-host.mjs`) was started on
  `127.0.0.1:38124` as a process of the coding session, not as a service, so it stops if that session ends; running
  it as a service is a separate approval. Public HTTPS checks passed for both hostnames.
- **Service, 22 October 2026.** The owner: "Approved: commit this work, then add the closed screen as a Manual service
  alongside the aphelion-bot services, using the existing setup pattern, and start it." `aphelion-bot-activity` now
  runs as `NT SERVICE\aphelion-bot-activity` with the pinned Node runtime and the reviewed WinSW wrapper, from a
  hash-recorded copy of commit `b9f7c11` (`ops/windows/Setup-ActivityService.ps1`). Its first start failed on
  `node.exe` permissions and the closed screen was down for about a minute; it was restored, fixed and handed over.

### Shuttle Activity: SDK, testers and the ticket switch — 22 October 2026

The owner asked to "finish the rest of the work" and answered three questions:

- **Embedded App SDK.** Approved: pin `@discord/embedded-app-sdk` 2.5.0 (MIT) and its dependencies with hashes and
  bundle them with the Activity client. One dependency, `big-integer`, is under the Unlicense (a public-domain
  dedication); this is its recorded scope exception. No other non-MIT component is approved by this.
- **Testers.** The owner and current holders of the configured lead ops role pass the closed screen while the
  Activity is in testing. Membership is checked on every request from Sophie's current role reads, never from the
  client or a stored list.
- **Ticket switch.** New Shuttle runs stop opening a ticket channel as part of the opening (P44), not before. Until
  then the channel Shuttle keeps working for members.

### Shuttle Activity deployed in testing — 22 October 2026

Owner: "Approved: deploy core with migration 074 and the Activity in testing on port 38125, re-register commands, then
switch onboarding.a13.info from the closed screen to core."

- **Installed** `fe25c83` (schema 073 → 074) at 01:27–01:28 UTC with a cold recovery point
  (`D:\Backups\sophie-staging\schema074-fe25c83-20261022`): 163 files, migration 074 with `SELECT, INSERT, UPDATE` on
  `sophie_core.shuttle_activity_runs` for the core identity only, and the runtime block
  `activity: { origin: https://onboarding.a13.info, port: 38125, status: testing }`; no other configuration, credential,
  policy or dependency change. The release also carries `ff09c10`'s channel-create fix (on `main`, never installed).
- **Incident.** Core did not start: four pinned SDK modules under `lib/uuid/dist/` had never reached Git because the
  repository ignores `dist/`. Core was down 01:27:58–01:31:41 UTC (3 min 43 s). The four files were placed in the
  installed package from their recorded pins and core started. `b6af5d8` commits them (with a test that every vendored
  file is tracked), and a source-only update installed it at 01:35 UTC (core restarted, 35 s), so the release, Git and
  the signed package manifest agree again. Installation, boundary and dashboard checks passed.
- **Commands** re-registered at about 01:37 UTC: the six guild commands were updated in place; `/whitelist post` exists.
- **Route.** `sophie-staging` tunnel configuration version 4 points `onboarding.a13.info` at `127.0.0.1:38125`
  (version 3 backed up in `.local/cloudflare/`); other rules unchanged. Public checks passed. The closed-screen service
  (`aphelion-bot-activity`, 38124) stays installed and running for rollback.
- Deployment folders: `.agent_docs/aphelion-sophie/deployment-fe25c83-2026-10-22` and `deployment-b6af5d8-2026-10-22`.
  The Activity is still in testing; the opening and the rules post are separate approvals.

### Shuttle Activity second pass: moments, viewscreens and arrival links — 22 October 2026

After testing `a723a49` in the test Discord, the owner asked for: Sophie to speak a little on every page, not only at
the start of a stop; sounds that filter in instead of starting together; more floor detail and a real window wall in
The Brochure; the baggage belt to run with the bags; somewhere to pop up imagery at Board the Shuttle and Admire the
Lights; links to newly opened Discord sections at Disembarking; SS13 easter eggs throughout; and "plenty more details
and moments" from the script. The owner approved the plan and answered four questions:

- **SS13 references: shared culture only.** Space carp, Ian, the clown, greytide, robust toolboxes, wet floor signs,
  the HoP, LOOC, Tip of the Round, radio channels. No NanoTrasen, CentCom, Syndicate or Lavaland, and no SS13 sprites or
  sounds: all art is original ASCII by the coding agent with provenance, and the one approved sound set is unchanged.
- **Pop-ups: ASCII art plus links.** Viewscreens show original ASCII art and up to six https link cards opened through
  Discord's confirmation; no third-party images are copied (the xkcd comic and the Wikipedia article are links only).
- **Arrival links: both.** Channels named in the copy become chips, and a curated arrival list is edited in the
  dashboard (Activity layout, guidance publishers). Core lists only channels the member can view at that moment, from
  their current roles and each channel's overwrites; a hidden channel's name never reaches the client.
- **Delivery: all at once.** Build everything, then one deployment (migration 075) to the test Discord for the owner's
  review. This answer is the recorded approval for that one deployment; the opening and the rules post stay separate
  approvals.

The Activity layout editor is the P44 per-stop scene picker. It is presentation data only: it changes which scene a
stop shows, what each section stages and which channels are listed, never a run, a permission or the published copy.

- **Installed** `052864c` (schema 074 → 075) at 11:50–11:51 UTC with a cold recovery point
  (`D:\Backups\sophie-staging\schema075-052864c-20261022`): 43 files, migration 075 with `SELECT, INSERT, UPDATE` on
  `sophie_core.activity_layouts` for the core identity only; no configuration, credential, policy, command, route or
  dependency change. Services were down about 40 seconds. All checks passed. Folder
  `.agent_docs/aphelion-sophie/deployment-052864c-2026-10-22`.

### Shuttle Activity layout: reading column and status window — 22 October 2026

After reviewing `052864c` in the test Discord the owner asked for: no overlapping interface on the title screen; no
glyph or placement artefacts (thin coloured lines beside the departures board); the extra-material pop-ups beside or
above the reading box rather than over the scene; bags that move through the baggage hall cleanly, with more variety and
a working weight scanner; scene details no longer hidden behind the reading box; the menu button fixed to a corner of
the window; Ten Thousand tied to the right page; and "the main chat box ... on the left", keeping the scene area clear,
with "a status window / viewport, which usually just has the sophie placeholder, which will re-populate with the bonus
information if it exists for the current step". Mid-way the owner added that the status window "should be fixed size".

- The Activity now has a reading column on the left (the status window, then the splash prompt, the menu or the
  transmission) and the scene alone on the right; on phones the scene sits above the column. Landscape scenes are 96 by
  40 cells to fit that area and were re-laid so nothing is drawn under text.
- The status window has a fixed size. By default it shows Sophie's radio: her name, callsign and a voice meter that
  moves while she speaks. She is still not depicted (identity rules, 20 October 2026); a portrait or likeness there would
  need its own owner decision. When the section being read has extra material, the window shows that instead.

- **Installed** `2063a50` on 22 October 2026 at 12:34 UTC on the owner's approval ("Approved: install the layout pass
  (source-only update) in the test Discord."): 14 files, no migration or configuration change; core and the worker were
  down 33 seconds. All checks passed. Folder `.agent_docs/aphelion-sophie/deployment-2063a50-2026-10-22`.

### Shuttle Activity third pass: richer scenes, station board and boarding pass — 22 October 2026

After reviewing `2063a50` the owner asked for:

- a higher-detail Aphelion station on the title;
- centring fixes for The Brochure's book, wet floor sign and the strip under the departures board;
- Wolfgate as a second destination on the baggage belt, with the named SS 13 and SS 14 origin servers;
- denied bags pushed into a disposal chute, labelled for the section;
- a burning BLASTWAVE bag with a firebot;
- two people talking the LOOC section through;
- the claim terminal moved up and left of the belt;
- a different scene for each section of Board the Shuttle (a landing bay, people taking seats, a viewport of the
  shuttle hitting a sea lion with turbulence in the cabin);
- a livelier Admire the Lights, with two crew playing out "Ten Thousand" in space;
- a re-laid Disembarking whose push-to-talk box gives way to server statistics or information about the member;
- Sophie's radio running for a time tied to the page's text: "Not too long, but a little bit longer."

The owner approved the plan and answered three questions:

- **Arrival information: both.** The Disembarking scene shows the server's approximate member and online counts. The
  status window shows the member's own boarding pass (display name, join date, Whitelist status) at the last stop and
  on arrival. Core reads both from Discord, keeps them in memory only and sends the pass to that member alone; no
  member detail enters a scene.
- **Radio length: half the typing time.** About half the page's typing time at the chosen speed, from 2 s to 6 s, then
  the 1.5 s trail-off.
- **Lucky ten thousand: all four exchanges,** rotating: water in a banana, a monkey cube, a welder and a fuel tank, and
  Ian the corgi.

A moment can now name a scene of its own, so a section changes scene; the layout editor offers it per section. The
format gains `dialogue` and `conveyor` effects, sprite `hold`, `rest`, `clip` and the beat clock, text alignment and
the `{crew}`/`{online}` counts. All art is still original ASCII by the coding agent with provenance; SS13 references
remain shared culture only. The held seam fix `21a0575` ships with this build.

- **Installed** `0d446fe` on 22 October 2026 at 14:26 UTC on the owner's approval ("Approved: install the third pass
  (source-only update, including the seam fix) in the test Discord."): 28 files, no migration or configuration change;
  core and the worker were down 33 seconds. All checks passed. Folder `.agent_docs/aphelion-sophie/deployment-0d446fe-2026-10-22`.

### The Shuttle as a story — 22 October 2026

After reviewing `0d446fe`, the owner pointed out props and people that are introduced and never cleared away: the
chatting pairs, the janitor, and the checklist. The owner asked for:

- an adversarial review of each step's plot and details;
- a plan for a coherent flow;
- story-oriented replacements for every step, informed by how visual novels split what the environment shows from
  what characters say.

The first draft read to the owner as "AI generated. All of it." The owner asked for a second pass that is "easily
empathizable, casual, and shitposty", and noted that "this presentation isn't formal anyways", so the rules and policy
sections may be rewritten too. The owner approved the plan and answered:

- **The guidance itself is rewritten.** One text serves the Activity, the channel Shuttle and the text version, and a
  guidance publisher publishes it as a new Shuttle version through the editor.
  - This replaces D3's "no new copy" for the Shuttle.
  - The copy stays static and authored. No AI is involved; Sophie is still a radio voice with no likeness.
- **Two named companions travel with the member.** Rook, a returning player, and Pip, a first-timer, meet at the
  baggage belt, board and sit together, play out Ten Thousand, and part at the door.
- **The must-know facts sit on in-world signs**, written in the same casual voice. A meaning checklist test keeps every
  point of the original guidance, and the owner reviews the wording.
- **New sound cues** for the story's moments are picked by the owner from a second Sound Picker (CC0 only). They go
  through the same hashing and encoding pipeline.

The draft lives in `content/onboarding/story.md` and is built by `scripts/build-onboarding-story.mjs`. The original
draft (`definition.json`, from the preserved source) is unchanged, and the moments keep both sets of headings until the
new version is published.

### Story sounds chosen and approved — 22 October 2026

The owner picked the story's sounds in the second Sound Picker and sent the originals with a SHA-256 list. All 17
hashes matched, and every sound is CC0, checked on its own page.

- **Reading of the SC-12 note.** The owner's note was "Option 2 as the extinguisher, option 5 as the bag itself
  catching on fire." It became two cues:
  - SC-12 is the extinguisher (Freesound 561328);
  - a new SC-21 is the flamethrower (Freesound 831929), played as the BLASTWAVE bag lights itself again.
- **AMB-06 replaced.** The arrival concourse (Freesound 757318) replaces the New laboratory ambience chosen on
  21 October.
- **SC-07 still open.** The owner turned down every first-round option for the launch roll as "too loud, sharp, high
  pitchy, and high-techy" and asked for "a low rocket take off". A second round is on the picker. Until a pick is
  encoded, the launch plays without it.

The 17 sounds were cut and levelled by the same analysis as the 21 October set and encoded by
`scripts/build-shuttle-sounds.mjs`. The rebuild reproduced the 23 unchanged approved outputs byte for byte. The owner
auditioned the 17 on a private page in both formats, with loops and seams, and approved all of them without changes.
The record is `legal/shuttle-activity-sounds.json` (`review.story`).

- **SC-07 chosen.** In the second round the owner picked "Deep 04 low rumbling, drone" by cabled_mess (Freesound
  338367, CC0 1.0, checked on its page). The owner sent it without a hash list, so its SHA-256 was computed on receipt
  and pinned. It plays for 7 s from 0.8 s into the forward view, swelling in and dying away as the rail drops into
  stars. It awaits the owner's audition and is not in the installed build.
- **Installed** `135f2a6` on 22 October 2026 at 16:11 UTC on the owner's approval ("Approved: install the fourth pass
  (source-only update, including the 17 story sounds) in the test Discord."). 52 files were written and the 2 replaced
  AMB-06 outputs removed; there was no migration or configuration change. Core and the worker were down 33 seconds,
  and all checks passed. The story copy is not published yet. Folder
  `.agent_docs/aphelion-sophie/deployment-135f2a6-2026-10-22`.
- **SC-07 approved and installed.** The audition page saved no verdict for SC-07, so the owner approved it in chat:
  "SC-07 is approved. Install it (source-only update) in the test Discord." `a620ce0` was installed at 16:20 UTC:
  6 files, no removal, no migration or configuration change. Core and the worker were down 33 seconds, and all
  checks passed. Folder `.agent_docs/aphelion-sophie/deployment-a620ce0-2026-10-22`.

### Host-only Shuttle publishing — 22 October 2026

The dashboard's Shuttle editor needs a Discord sign-in. The owner asked for "a method for localhost to make these
modifications", and approved the design: "I approve the host-only publishing command as you described it
(administrator-only, same checks and audit, never over the tunnel)."

- **Server administrator access is an authority for publishing Shuttle guidance**, separate from Discord. It needs an
  elevated session and core's database login, which only administrators can read.
- **The guild owner is the recorded author.** The command accepts only a user whom Sophie last recorded as the guild
  owner, and re-reads that record for every operation. It makes no Discord call and never loads the token.
- **The same store as the dashboard.** The command uses the same validation, revision, hash and publication checks.
  Its audit rows are marked `local-operator`.
- **No route.** There is no listener, no HTTP route and nothing reachable through the tunnel. A "trust localhost" route
  was rejected: the tunnel makes every public request look local.
- **Approval still applies.** Each publication with it is still a recorded owner approval. See
  `docs/shuttle-publishing.md`.
- **Installed and first used.** `cf0c125` was installed at 16:57 UTC on the owner's approval ("Continue: prepare the
  install, install, then publish the story."): 3 files, no route, service or configuration change. Core was down
  33 seconds and all checks passed, including that neither public host serves the command. The command then
  published the story copy:
  - saved draft revision 3 (`c9bd3e11…`), which the review found valid;
  - published it as Shuttle version 3 (`7f45693f…`) at 17:00 UTC, with the owner as author;
  - the publication's hash equals the committed `content/onboarding/story-draft.json`;
  - existing runs keep version 2 (0 active, 6 complete).

  Folder `.agent_docs/aphelion-sophie/deployment-cf0c125-2026-10-22`.

### Shuttle Activity fifth pass: picked designs, full-page title and depth — 22 October 2026

The owner reviewed the installed story build and asked for: a reworked BLASTWAVE fire (new sprites, a longer burn, a
longer wait before it relights); walkers going behind standing objects; a full-page main page "with the menu built
into the ASCII design"; an updated launch post; NO RUNNING integrated and centred on its sign; no story text naming
buttons that no longer exist (the last stop's "Complete Shuttle"); "a couple of mothroaches"; an audit of the art
against other ASCII art, with an artifact to pick between designs; and similar polish across the Activity.

- **Design picker.** The coding agent drew three original alternatives for 40 asset groups (creatures, people,
  machines, props, signage, the title screen, the logo and the post banner) beside each current design, with an audit
  panel naming the techniques used (references for technique only; nothing copied). The owner picked in a private
  artifact; notes on a pick were followed (the crowd mixes every option; every bag and traffic design is used; the
  clown wears the big shoes; the scanner gets the gate design's lamps; the feedback terminal uses the other designs'
  colours; the title keeps the rainbow stripes and the station is drawn in more detail). Kept as they were, by pick:
  the sea lion, the logo, the launch post banner, the departures board, the section strip and the game monitor.
- **Main page.** No reading column on the splash and menu: the hangar fills the window, and the page lays the splash
  prompt and the real menu over the art's terminal window (a new scene `slots.menu` region). The menu stays real
  buttons with keyboard, screen-reader names and 44 px targets (40 px on phones); 1 to 9 pick a choice.
- **Depth.** A scene layer can be a standing object (`front: true`): sprites and belt items never draw on its cells,
  speech bubbles still do. Every standing prop is marked; a test lists them per scene.
- **The fire.** A 24-second cycle on the wall clock: flames for 15 seconds, the firebot rolls out of its dock, foams the
  bag for 2 seconds (SC-12), rolls back; smoke, then cold until a spark at 23 seconds (SC-21).
- **Mothroaches.** Three, as SS13 culture only: under the lounge benches, along the baggage lockers, and on a deck lamp.
  The lounge's wet floor sign (no janitor ever works there) became a MOTHROACH CROSSING sign, by pick.
- **Story.** The last stop and the boarding call describe finishing instead of naming a button ("Finish this last stop
  and we'll request your Whitelist role"), and the unused entry part (a "Start Shuttle" button that does not exist) is
  removed. The meaning checklist still requires agreeing at the end. This needs a new published Shuttle version.
- **Launch post.** New default wording in Sophie's voice; the banner stays (the owner kept the current one in the
  picker, after first asking for a new one); one Board the Shuttle button.

The owner approved the plan; installing the build and publishing the story as version 4 each needed their own
approval.

- **Installed and published.** On the owner's approval ("Approved: install the fifth pass (source-only update) in the
  test Discord, then publish the fixed story as Shuttle version 4 with the host-only command."):
  - `ceb46cb` was installed at 18:55 UTC: 15 files, no migration, route, service or configuration change; core was
    down 33 seconds and all checks passed;
  - the host-only command published the story as Shuttle version 4 (`887fddc7…`) at 18:57 UTC, with the owner as
    author; runs in progress keep version 3.

  Folder `.agent_docs/aphelion-sophie/deployment-ceb46cb-2026-10-22`.
- **Audit.** The owner then asked for "an audit of the entire activity", with the updates installed and published
  afterwards. The audit fixed the scenes to match the story (the cape in locker 12; the gate and its light on phones)
  and polished the phone layouts. It changed no copy, so nothing was published. Installed as `f6c787e` at 19:16 UTC.

### Shuttle Activity sixth pass: staging that follows the reader — 22 October 2026

The owner tested the audit build (`f6c787e`) and sent 22 notes. They asked for the trends, a comparison with other
simple visual novels, and a workplan. The owner approved the plan, and chose a click-to-continue mark, the heading
"Real questions are welcome" and Beepsky's line in the copy.

- **Trends.**
  1. Events don't follow the reader: the sea lion is hit before it can be read about, the confetti pops on entry, and
     the 18+ light should speak on its page.
  2. Effects have no visible cause: confetti, litter, an idle monkey.
  3. Actors break the stage: vanishing mid-screen, hiding behind props, crossing flight paths.
  4. Holes are left in the floor where things were.
  5. Automatic paging the author can't steer splits signs and misplaces lines.
  6. Small regressions (the radio meter in lockstep), plus missing logic and personal touches.
- **Compared with simple visual novels.** Ren'Py's defaults, Ace Attorney and kinetic novels:
  - the writer places every text-box break;
  - staging happens on the line being read;
  - everyone who speaks is on stage;
  - a click-to-continue mark ends each box;
  - auto mode and skipping read text are standard;
  - a lint runs before release.
- **Adopted now:**
  - author page breaks, with signs kept whole and pages flowing across Discord message boundaries;
  - text-synced moments;
  - Beepsky as an on-stage speaker;
  - the click-to-continue mark;
  - a staging lint in the tests.
- **Candidates for later:** auto mode, skipping read pages, small non-gating choices.
- **Story version 5** (needs approval to publish):
  - Beepsky's 18+ line;
  - "Read that last bit again" rewritten to flow on;
  - the sea-lion section re-staged across pages 5 to 7 under "Real questions are welcome", with "We crush sea-lions
    with shuttles" as the punchline before the THUMP;
  - "Finish this last stop…" removed.
- **The terminal title** shows the member's own Discord username (`name@aphelion`). It is shown only to them and never
  stored or logged.
- **What the staging lint found beyond the notes** (same kinds of fault, fixed in this pass):
  - Pip vanished behind each seat back on the way to their seat; they now walk the front row in front of the seats.
  - Rook and Pip were hidden by the ground crew at the foot of the ramp; the crew now stand behind the boarders.
  - The carp school shared the pointed greytide's lane; the greytide now drifts out level.
  - The lounge's mothroach walked over a dropped hat; the hat is off its path.
  - Floor holes around the help desk, the bay's luggage, the door's cart wheels, the wet floor sign's legs and the
    monkey: each prop now clears only its own cells.
- **Installed and published.** On the owner's approval ("Approved: install the sixth pass (source-only update) in the
  test Discord, then publish story version 5 with the host-only command."):
  - `a0eb904` was installed at 21:14 UTC: 17 files, no migration, route, service or configuration change; core was
    down 33 seconds and all checks passed;
  - the host-only command published the story as Shuttle version 5 (`66da6827…`) at 21:15 UTC, with the owner as
    author; runs in progress keep their version.

  Folder `.agent_docs/aphelion-sophie/deployment-a0eb904-2026-10-22`.

### Simple AI controls, contexts, staff channels, code and the move to the main server — 23 October 2026

The owner asked for Sophie's AI settings to be controlled from Discord with a simple yes or no, for longer replies, for
code questions, for separate handling of staff, support and chat channels, for memories to work, and for the deployment
to the main server. Answers given in this session, quoted where they were typed:

- **One choice for the whole server.** The panel is offered "Both" as a private (ephemeral) reply and by DM, "but the
  'do you want sophie to interact with you? yes / no' should apply to the entire discord." The single Yes covers
  replies, the member's own notes and Sophie's memories, explained in one notice. Per-channel opt-in, the separate
  note-sharing switch and the separate memory switch are retired. Saying No withdraws Sophie's replies that used the
  member's messages in every channel. Members can get a copy of everything Sophie keeps (memories included), make her
  forget her memories, delete everything (No at once, then the departure erasure), and keep or delete their data on
  leaving. A member without a choice who mentions or replies to Sophie gets one static, non-AI "Set up Sophie"
  invitation a day at most.
- **Reply length is configurable per context.** Each channel belongs to chat, support or staff; each context has an
  owner-written brief, longest reply (up to 5,500 characters), output budget, deadline (up to 30 s), code search
  switch and game. A long reply stays one Discord message (text in embeds), so one effect still withdraws it; the plan's
  "split into several messages" was replaced by this because it keeps erasure and withdrawal unchanged.
- **Several API keys: not adopted.** Mistral's limits apply to the workspace or organisation, shared by every key, and a
  key carries no context. Context switching is handled by the contexts above, on one key.
- **Named staff channels.** "Yes, named staff channels." A private channel qualifies only when its context is Staff and
  the accepted processing policy declares `staffChannels`. Case, ticket and onboarding channels and their threads stay
  excluded. Each staff member still needs their own Yes. Staff memories are recalled only in staff channels, and staff
  contexts default to no code search.
- **Code and community sources.** "All public repo's, plus our wolfgate repo here at:
  https://github.com/VanguardControl/Wolfgate. It should also be prepared to use our website: https://meridian.a13.info
  and our wiki: https://meridian-wiki.a13.info", and "Also include our new Wolfgate Guidebook into the available
  resources: https://panel.a13.info/guide/wolfgate". The owner supplied a read-only GitHub token (a new credential, held
  only by core and sent only to api.github.com). Code search uses GitHub's code search inside a fixed allowlist
  (public non-fork Aphelion-Moon repositories and VanguardControl/Wolfgate) and reads at most two line windows; nothing
  is cloned or executed and no model chooses what is fetched. Wolfgate's terms are taken from its LEGAL.md (AGPL-3.0
  for later contributions, MIT for earlier ones).
- **Rule authority (amends "The wiki is the rulebook", 13 October).** "The Wolfgate ruleset is applicable to questions
  about SS14/Wolfgate, if there is a gap in policy then defer to the SS13/Meridian Rift wiki." The Guidebook entries
  under its current rules root are policy; its other upstream rulesets are reference.
- **Memory policy accepted.** "I accept the new memory processing policy, please document that." Recorded as acceptance
  of automatic memory under the single-Yes notice (draft: [ai-notice-r4.md](../ai-notice-r4.md)); the processing policy
  is generated with that notice and the new worker profile hash, and the install packet quotes this acceptance.
- **Services start at boot.** "Set services to restart at reboot." Done on 23 October: PostgreSQL `auto`; core, worker,
  tunnel and the closed-screen service `delayed-auto`; core depends on PostgreSQL; the supervisor stays disabled.
  Rollback and before/after values: `.agent_docs/aphelion-sophie/service-autostart-2026-10-23`.
- **Merge.** "I approve merging into main." `docs/shuttle-activity-plan` was fast-forwarded into `main` and, after a
  secret scan of the 254 unpushed commits found no secret, pushed to origin (`02e0e1f..e00550b`). Work continues on
  `main`.
- **Production scope.** "I reviewed the story, it's good enough to do some closed testing on production." and
  "Production deployment should have the onboarding activity and sophie AI functional, with memory support, with the new
  on-discord systems." The install moves from the test Discord to the main server (one application, one interactions
  URL), with a fresh production database. It covers the Shuttle Activity behind the tester gate, Sophie's AI with memory
  and `/sophie` only; tickets, cases, moderation, Crew assignment and Whitelist delivery wait for the cutover (P30/P31)
  and the existing bot keeps its roles. The guild ID, tester role and channels are still needed from the owner.
- **Dashboard sign-in.** It failed because Discord now reports the Activity's scope as well; the fix (`15252f9`) is
  bundled with the production install by the owner's choice ("Bundle it later").

### Production inputs and the #ask-sophie exception — 23 October 2026

The owner supplied the main server's guild, roles and channels (recorded in
`.agent_docs/aphelion-sophie/production-inputs-2026-10-23`, checked with the bot account): #ask-sophie is support,
#staff-chatter is staff (private), #main-bots is chat. Lead Ops is the Activity tester gate and holds the AI controls.
"Tickets should end up in 1528558928382918777 which is the same category that #ask-sophie is in." Asked whether to move
the channel or add an exception, the owner chose: "Keep #ask-sophie where it is. Add a code exception that allows that one
channel ID inside the ticket category, with everything else there staying excluded." The configuration's
`aiChannelExceptions` names exact channels (at most five, never the category itself); a named channel inside the protected
category is usable by the AI, while the category, every other channel in it (new tickets included) and any channel Sophie's
own case records exclude stay refused. Automation gets no exception. On Discord permissions: "Sophie has manage roles from
our bot-grouping rank, not her personal rank. So don't worry about that." Production mode refuses role, channel and
permission writes in code regardless.

### Production install of 791e2fe in the main server — 23 October 2026

On the owner's approval ("Approved: run the 791e2fe production install packet (new production database, install,
commands moved to the main server, story published), then the checks."), `791e2fe` was installed at 00:59 UTC in the
Activity-and-AI production mode for the main Aphelion server:

- a new database, `sophie_prod_main`, with five new identities, 76 migrations and 306 grants copied from staging plus the
  076 grants, each identity verified; staging's database is untouched;
- 65 files written and 1 removed; trust v2 from the production configuration; the pre-start check confirmed the runtime,
  policy (notice revision 4), databases and credentials are the reviewed ones; core was down about a minute;
- `/sophie` and `/lookup` registered in the main server, Sophie's six commands removed from the test Discord;
- checks passed: service boundaries, installation (main server gateway current, 76 migrations, no role jobs, dashboard
  and Activity routes), public hosts.

The story publication was refused (`LOCAL_OPERATOR_AUTHOR_UNKNOWN`): the host-only publisher needs the owner to be known
in the new database, which happens at their first dashboard sign-in. It is re-run then, unchanged. AI is off until the
owner publishes the character, budget and channel settings and goes live. Folder
`.agent_docs/aphelion-sophie/deployment-791e2fe-production-2026-10-23`; backup
`D:\Backups\sophie-staging\production-791e2fe-20261023`.

On the owner's request ("Port Sophie's Character setup over please.") the published character was copied from staging
(revision 2) into the production database as revision 1, unchanged (digest `8ee3c4ad…`), attributed to the owner, with AI
still disabled (`port-character.mjs` in the deployment folder). The budget and channel settings are still to be published.

### Production channel settings and story — 23 October 2026

On the owner's request ("Yes, port the budget from staging and publish the drafted channel settings (#ask-sophie
support, #staff-chatter staff, #main-bots chat). I'll go live on the dashboard myself."):

- **Budget not ported.** The owner had already published production budget revision 1 from the dashboard at 01:03 UTC.
  It equals staging's except for a later price review date (1 December 2026 against 31 October), so it was kept.
- **Channels published** as configuration revision 2 (01:06 UTC, attributed to the owner, digest `12e2ff81…`), on top of
  the owner's revision 1, which listed no channels; its contexts, deadline, reactions and enabled flag were kept unchanged.
  Channels: #ask-sophie (1562980657293164601) support, answers questions; #staff-chatter (1528121657464721490) staff,
  when mentioned; #main-bots (1530200440032202802) chat, when mentioned. Each was re-read with the bot account first (a text
  channel; private only for staff; #ask-sophie the one excepted channel in the ticket category; no recorded case).
- **Story published** into production as version 1 (digest `f826e709…`), now that the owner is known in the database.

AI stays disabled and no channel is qualified: Go live in each channel is the owner's, on the dashboard.

### Production fix b336843 installed — 23 October 2026

The first live #ask-sophie turn was refused before reaching Mistral: core's check of the worker's prepared turn, the budget
estimate and the `provider_attempts` constraint still stopped at 512 output tokens, below the support and staff contexts'
1,024. Fixed in `b336843` (migration 077). On the owner's approval ("Approved: build and run the b336843 production fix
packet (four source files plus migration 077 on sophie_prod_main), then the checks. I'll Go live again afterwards."), it was
installed at 01:27 UTC: four files written, migration 077 applied to `sophie_prod_main` with core stopped, new trust from the
same production runtime and policy (profile hash unchanged), all checks passed. The release changes, so the owner goes live
again in each channel. Folder `.agent_docs/aphelion-sophie/deployment-b336843-production-2026-10-23`; backup
`D:\Backups\sophie-staging\production-b336843-20261023`; `rollback.ps1` reverts 077 and restores 791e2fe.

### Production fix 1e02c98 installed — 23 October 2026

After `b336843`, #ask-sophie turns reached Mistral and were billed, but nothing was posted: Discord delivery still refused
an AI deadline more than 15 seconds away, so a support turn (25 s) answered after one second was dropped
(`AI_TURN_UNCERTAIN_DELIVER_…_AI_DEADLINE_EXPIRED`). The owner also reported that the "Set up Sophie" invitation, a channel
reply, was visible to everyone. `1e02c98` sets the delivery bound to the longest turn (30 s) and sends the invitation to the
member by DM only (closed DMs leave the channel silent); its wording now says the member mentioned Sophie in the server.
On the owner's approval ("Approved: run the 1e02c98 production fix packet (three source files, no migration), then the
checks. I'll Go live again afterwards."), it was installed at 01:41 UTC: three files written, no migration, new trust from the
same production runtime and policy. The first installation and public checks ran while core was still starting and saw 503;
re-run a minute later, all passed. The owner goes live again in each channel. Folder
`.agent_docs/aphelion-sophie/deployment-1e02c98-production-2026-10-23`; `rollback.ps1` restores b336843.

### After go-live: review, workplan and the launch post — 24 October 2026

Live testing on 23 October found two made-up answers (that "CI" meant GitHub continuous integration; that Sophie could
play song requests) and single links on multi-source answers. The owner asked for one Opus sub-agent at extra-high effort
to review the memory and personality design adversarially, allowed direct testing of Sophie's input and output, and asked
for a workplan. Owner answers of 24 October:

- **Launch post:** "Yes, post-only". Production gets `/whitelist` with only `post`, for Lead Ops, so the Shuttle Activity
  launch post can be posted while the Activity stays behind its tester gate; no other `/whitelist` action and no Whitelist
  grant (built as `7394de5`, not installed).
- **Glossary:** "Extract from wiki". The reviewer proposed a seed list from the wiki and the Guidebook (review section 4);
  the owner approves it before publication.
- **CI:** the owner says CI is Combat Intent in community policy; the published wiki calls it Combat Indicator (CI) and
  no published passage says "combat intent". The canonical name is an open owner decision.

The review (`.agent_docs/aphelion-sophie/sophie-probe-2026-10-24/review.md`) found, among others, that Sophie is given
memories about every member in a conversation and repeats them to others (no production memory has been saved yet, so
none has leaked), that memory capture rarely fires and she claims saves that did not happen, and that she invents
community facts behind real citations. Workplan tasks P51-P55 carry the fixes. Until the memory privacy fix (P52) ships,
AI stays off or automatic memory stays unused.

### Memory privacy and honesty (P52) — 24 October 2026

The owner asked to "Start P52: requester-only memories, no staff memories, drop invalid memory items instead of the reply,
and only claim saves that happened", and answered:

- **Save notice:** a ping and an ephemeral reply were asked for; Discord allows ephemeral messages only in answer to a
  command or button, so the owner chose **"DM the member"**. Core DMs the member what was saved, from the stored text.
- **False claims:** **"Remove the sentence"**. The rest of the reply is delivered; an emptied reply gets fixed wording.
- **Health:** **"Never keep health"**. Conditions, diagnoses and treatment are refused as memories in code; a member may add
  such a note themselves with /sophie. This narrows the 20 October choice that declined a sensitive-data exclusion.

Built in `5137d5b` and `26f72b7`, not installed. A turn reads only the requester's own member memories; staff channels
neither read nor write memories; malformed items, surplus citations and a missing citations field are dropped instead of
the reply; member memories must be about the member being replied to, and instructions, rank claims, real names and home
locations are refused.

### Production install of 26f72b7 — 24 October 2026

On the owner's approval ("Approved: run the 26f72b7 production packet (eleven source files, no migration; /whitelist post
plus P52 memory privacy and honesty) and register /whitelist with only post in the main server, then the checks. I'll Go
live again afterwards."), `26f72b7` was installed over `1e02c98` at 14:10 UTC on 23 October (host clock; the owner's
24 October): eleven files written, no migration, new trust from the same production runtime and policy (profile hash
unchanged). All checks passed on the first run (pre-start, service boundaries, 29 installed checks, public hosts). The main
server's commands are now `/lookup`, `/sophie` and `/whitelist` with only `post`. AI was off at install; the owner goes
live again in each channel. Folder `.agent_docs/aphelion-sophie/deployment-26f72b7-production-2026-10-24`; backup
`D:\Backups\sophie-staging\production-26f72b7-20261024`; `rollback.ps1` removes `/whitelist` and restores 1e02c98. The
earlier `7394de5` packet was never run and is marked superseded.

### Shuttle story revision 1 — 24 October 2026

The owner rewrote the Shuttle story (`content/onboarding/story-revised-1.md`) and asked for the file and the story process to
be cleaned up. Owner answers: "Everything removed was intentional. Adapt to it." (the refresher line for members already
Whitelisted, "We are not changing ourselves for you", the permanent invite link and Wolfgate's early-development note leave
the story and its meaning checklist), and "journey" is swapped for "ride" (the ban on stock phrasing stays).

`content/onboarding/story.md` now holds the revision, cleaned for format only: the header comment restored, sign cards
rejoined into single quote blocks, whitespace normalised, two plain quotes made paragraphs (only signs are quote blocks),
and typos fixed (its/it's, let's, who's, reasons, a missing full stop). Reworded checklist points take the new wording.
Scene beats follow the reworded headings and phrases (the original pre-story text keeps its own keys), and Beepsky's
speech in the departure lounge scene now says the revision's line. Not published: production still shows story version 1
until the owner approves an install (the scene and moments ship with the source) and a story publication.

### Production install of a65ee31 and Shuttle version 2 — 24 October 2026

On the owner's approval ("Approved: run the a65ee31 production packet (two Activity content files, no migration), then the
checks, then publish story revision 1 as Shuttle version 2. I'll Go live again afterwards."), `a65ee31` was installed over
`26f72b7` at 15:45 UTC on 23 October (host clock): the departure lounge scene and the moments map, no migration, new trust
from the same production runtime and policy. All checks passed on the first run. Story revision 1 was then published as
Shuttle version 2 (author the owner, digest `d095fb01…`); runs already under way keep version 1. Folder
`.agent_docs/aphelion-sophie/deployment-a65ee31-production-2026-10-24`; `rollback.ps1` restores 26f72b7 and
`rollback-story.mjs` would republish the version 1 text.

### Story updates dispose of progress; Reset journey — 24 October 2026

The owner asked: "Add a 'reset journey' button to the Settings page. When we update the Story, we should be disposing of
all prior progress saves. I don't want someone coming back to and finishing an outdated Onboarding story." and "Once you
have it made, install and publish it". This replaces the earlier rule that runs in progress keep their version, for the
Activity: a run still being read continues only on the latest published version; publishing a new version sets aside
Activity runs still being read on older versions (records kept); the Activity's Settings has Reset journey. Runs waiting on
their Whitelist grant, finished runs and Onboarding-channel runs keep their version. Built in `7d3e2ee` and installed at
16:00 UTC on 23 October (host clock); all checks passed. The story is unchanged (version 2); the one version 1 run in
progress at install is no longer offered and its member starts version 2 at the first stop. Folder
`.agent_docs/aphelion-sophie/deployment-7d3e2ee-production-2026-10-24`; `rollback.ps1` restores a65ee31.

### Scene dialogue, the THUMP, and Staff testers — 24 October 2026

Owner review of story version 2: scene conversations still used the old lines (Pack Your Bags, Admire the Lights, and others),
the sea lion was hit before the *THUMP* page, and "expand the allowed testers to Staff (1528124823874703470) now, please",
then "Create and install and publish the new updates". `da5b48a` updates every scene conversation to the story's lines
(Pack Your Bags, Board the Shuttle, Admire the Lights, Disembarking; Beepsky already matched), moves the strike to the page that
opens with *THUMP.*, and makes `shuttle.activity.test` an optional configured capability. Installed at 16:50 UTC on
23 October (host clock) with a production runtime that differs from the reviewed one only by granting it to Staff; all
checks passed. Testers are now the server owner, Lead Ops and Staff. The story itself is unchanged (version 2). Folder
`.agent_docs/aphelion-sophie/deployment-da5b48a-production-2026-10-24`; `rollback.ps1` restores 7d3e2ee (and its runtime).

### Incident: Activity unavailable after da5b48a, fixed with capability policy version 2 — 24 October 2026

After the da5b48a install (16:50 UTC, host clock) the owner reported "Something went wrong on our side" at the link step;
nobody could test. Cause: the new runtime added the Staff tester grant to capability policy **version 1**, which production
had already recorded without it. A recorded policy version is immutable, so every authorization failed with
`CAPABILITY_POLICY_IMMUTABLE`, reported by the Activity as `ACTIVITY_REQUEST_UNAVAILABLE` (dashboard sign-in and AI
admission were affected the same way; AI was off). Fix at 17:02 UTC: a configuration-only install of the same da5b48a code
with the runtime's capability policy at version 2; all checks passed, and a rolled-back dry run of the registration confirms
version 2 records cleanly. Rule from now on: any change to the capability policy's content bumps its version, and every
packet's preflight checks the new version is newer than production's recorded one. Folder
`.agent_docs/aphelion-sophie/deployment-da5b48a-policy2-production-2026-10-24`.

### Shuttle story revision 2 and the UPSTREAM bag — 24 October 2026

The owner sent revision 2 ("I removed a step from Boarding. Clean up the script, the story, and the pacing") and asked to
"relabel the Blastwave bag to Upstream". The "No one is forcing you to get on the shuttle" section is removed on purpose,
and with it the checklist points on being decent to the people who are, boarding voluntarily and not boarding to drive
people out. Cleanup: the editor's auto-capitalisation undone ("...is", "a desk", "can I post"), the SS14 import steps
numbered 1-2, the SS14 rules line made one plain link, and the new Wolfgate sign's link described as the Guidebook (its first
draft repeated the Meridian website's description). The Brochure was 59 characters over its 5,000 limit; to fit it,
"(still early days)" left the WHO TO BUG sign (it contradicted the new Wolfgate description) and the two Wolfgate lines were
shortened (4,991 characters). The baggage hall's burning bag now reads UPSTREAM (art and alt text; internal ids unchanged).
Pacing checked page by page; the sea lion is still hit only on the *THUMP.* page. Not installed or published.

### Sophie grants Whitelist in production — 24 October 2026

A Staff playtester without the game Whitelist reached the end of the Shuttle and waited, until the owner added the role by
hand. That was the 23 October production split (Activity and AI only; the existing bot owns Whitelist). Owner answer to
"How should finishing the Shuttle in production handle the Whitelist role?": **"Sophie grants it now"**, as she did on the
test server. This narrows the 23 October split and, with the owner's decision, the AGENTS.md rule to keep the existing bot's
role ownership intact: Sophie now *adds* Whitelist at the end of a Shuttle run in the main server, after the same current
eligibility and Muzzled checks; she never removes it, runs no member reconciliation and touches no other role, which stay
with the existing bot. Implementation: the production transport may add only the Whitelist role (one PUT route), a worker
that handles only `whitelist.grant` runs in production, and the Activity queues the grant.

### Production install of 366b6cb and Shuttle version 3 — 24 October 2026

On the owner's approval ("Approved: run the 366b6cb production packet (seven files: Whitelist grants in production, the
UPSTREAM bag), then the checks, then publish story revision 2 as Shuttle version 3. I'll Go live again afterwards."),
`366b6cb` was installed over `da5b48a` at 18:17 UTC on 23 October (host clock): Sophie grants Whitelist in production, the
UPSTREAM bag. Same runtime and capability policy (version 2, confirmed recorded). All checks passed; story revision 2 was
published as Shuttle version 3 (`44dbda58…`) and reset the one Activity run in progress on version 2. Folder
`.agent_docs/aphelion-sophie/deployment-366b6cb-production-2026-10-24`; `rollback.ps1` restores da5b48a.

### Production install of be0fe69: Activity failures log their kind — 24 October 2026

On the owner's approval ("Approved: run the be0fe69 production packet (one file: Activity failures log their kind), then the
checks. I'll Go live again afterwards."), `be0fe69` was installed over `366b6cb` at 19:09 UTC on 23 October (host clock).
An unexpected Activity request failure now logs `ACTIVITY_REQUEST_UNAVAILABLE_<kind>` (contract or library code, SQLSTATE
or error class; never a message, ID or payload). Same runtime, capability policy version 2 and story (Shuttle version 3).
All checks passed. Folder `.agent_docs/aphelion-sophie/deployment-be0fe69-production-2026-10-24`; `rollback.ps1` restores
366b6cb.
