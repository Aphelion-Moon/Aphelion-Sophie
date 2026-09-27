# 01 · Requirements and decision register

## Scope contract

The words **must**, **must not**, and **release gate** define acceptance conditions. Numeric defaults marked **proposed** require testing or owner approval; they are not measured service guarantees.

| ID | Requirement | Acceptance location |
|---|---|---|
| R01 | One self-hosted bot identity for the production Aphelion guild; native Windows Server 2022 | T01, T38 |
| R02 | Support, player reports, staff-created tickets, forms, category-specific permissions | T06–T12 |
| R03 | Shuttle is a private, persistent, interactive ticket; no channel-unlocking chain | T13–T19 |
| R04 | No AI in any ticket or any ticket-derived data pipeline | T22–T26 |
| R05 | Join roles and allowlisted role restoration; no privilege resurrection | T18–T21 |
| R06 | Simple configured reactions/responses and manually approved canned answers | T45 |
| R07 | Web dashboard plus Discord commands calling the same application operations | T03–T05, T42 |
| R08 | Separate AI chat, knowledge and lookup in explicitly approved non-ticket contexts | T22, T27–T34 |
| R09 | MediaWiki connector now; Wagtail only a future adapter | T27–T30 |
| R10 | Local CPU inference initially; no cloud fallback or telemetry containing prompts | T31–T34 |
| R11 | Newly adopted application projects are MIT; unresolved licensing is not silently approved | T02 |
| R12 | Extensible feature modules and external-service adapters without a microservice platform | T46 |
| R13 | Leave Discord/BYOND integration and its role ownership with the existing bot | T21 |
| R14 | No historical ticket import, but preserve current member eligibility during cutover | T40–T41 |
| R15 | Meridian visual direction, accessibility, reduced effects, and no unverified asset copying | T42–T43 |
| R16 | Backups, deletion propagation, auditing, service recovery, and rollback | T35–T41, T44 |
| R17 | Sophie (she/her), Community Services, with the latest neon chibi protogen asset set; no legacy human artwork in active branding | T49–T50 |
| R18 | Branding is independent of AI; static assets/templates never create ticket or Shuttle AI paths | T22–T26, T51–T52 |

## Authoritative changes from earlier discussion

The earlier AI-in-ticket and staff case-summary proposals are withdrawn. No AI handoff states, AI reply editor, auto-triage, ticket semantic search, transcript ingestion, or ticket-to-knowledge automation should be implemented. Human staff may use ordinary case tools and static canned answers. A support-entry button in a separate AI chat opens a blank ordinary form; it transfers no conversation, AI-generated description, or proposed classification.

TypeScript, discord.js, the Vercel AI SDK, and PostgreSQL were previously suggested. They are not implicitly accepted under the later MIT condition. The provisional code baseline is JavaScript ESM with JSDoc and runtime schema validation. Strong contracts remain required. TypeScript is optional only after an explicit build-tool licence approval. [S15](11-SOURCES.md#s15)

## Sophie identity decision

Sophie is the chosen name, not an acronym. The latest user-directed neon chibi protogen image set is the visual reference. It does not establish new game lore, staff permissions, a voice/audio feature, or AI inside tickets. See `12-SOPHIE-IDENTITY-AND-ASSETS.md` and the versioned asset manifest. Proposed tone and layout rules are editorial/implementation recommendations, not additional user-supplied lore.

Keep `aphelion-bot` and existing technical identifiers stable unless an explicit migration is approved. Changing display branding does not authorise renaming Windows services, folders, database schemas, OAuth callbacks, or a live Discord application.

## Candidate technology decisions

| Decision | Status | Instruction |
|---|---|---|
| JavaScript ESM, explicit contracts, dependency injection | Planned | Do not install the TypeScript compiler by default |
| Oceanic.js for Discord | MIT candidate | Pin a released version, omit optional voice support, run compatibility tests [S01](11-SOURCES.md#s01) |
| Fastify backend and React dashboard | MIT candidates | Review full resolved dependency tree; top-level licences alone are insufficient [S02](11-SOURCES.md#s02); [S03](11-SOURCES.md#s03) |
| llama.cpp + Phi-4-mini-instruct | MIT candidates | Verify binary, model and quantisation licences independently [S04](11-SOURCES.md#s04); [S05](11-SOURCES.md#s05); [S06](11-SOURCES.md#s06) |
| Native Node.js LTS | Runtime gate | Node 24 is an LTS line at research time; verify patch/platform support and bundled notices [S12](11-SOURCES.md#s12); [S14](11-SOURCES.md#s14) |
| WinSW service wrapper | MIT candidate | Pin a supported compatible release; do not select a prerelease merely because it is on the default branch [S13](11-SOURCES.md#s13) |
| PostgreSQL + pg-boss | Conditional only | PostgreSQL is not MIT. pg-boss being MIT does not approve the database [S16](11-SOURCES.md#s16); [S17](11-SOURCES.md#s17); [S18](11-SOURCES.md#s18) |
| Storage engine and indexing implementation | Open gate | Choose once licence scope is recorded; keep one production backend, not multiple adapters without a need |
| Hosted AI SDK/cloud inference | Excluded from launch | Use a small direct local HTTP adapter |

These are candidate selections, not an assertion that the full installation is MIT-only or already vetted.

## Release gates

**G0 — Environment and licence decision.** Record CPU/RAM/storage headroom; production/test guild IDs; required roles; source access; owner-approved scope for platform tooling and indirect licences. Choose and approve one transactional storage implementation. No deployment or unapproved dependency installation passes this gate.

**G1 — Foundation.** Configuration validation, role-based authorisation, durable state, migrations, outbox recovery, service health, and dashboard login pass using synthetic fixtures and staging credentials.

**G2 — Human administration.** Ticket ACLs, Shuttle progression, revocation-safe membership, transcripts, and operational recovery pass. The whole release functions with inference absent.

**G3 — Knowledge.** The approved MediaWiki snapshot/index and direct lookup pass attribution, permission, deletion, template-change, and source-authority tests. No live AI is required.

**G4 — Local AI.** Model provenance, host resource limits, evaluation, no-ticket boundary, no cloud egress, and public-output controls pass. AI is still separately disableable.

**G5 — Production cutover.** Restore drill, retention approval, existing-member baseline, bot-responsibility transfer, and operator sign-off are complete. G2 may cut over independently of G4.

## Discovery inputs

| Input | How to obtain it | Safe behaviour until known |
|---|---|---|
| CPU, RAM, other host workloads | Sanitised WUFF snapshot supplied in the hardware addendum; verify current load and topology | No latency promise; AI disabled until tested |
| Guild, channel and role IDs | Authorised Discord configuration review | Empty allowlists; deny activation |
| Admission prerequisite | Confirm the existing age/interview status signal and its owner | Never infer eligibility from old s1–s5 roles |
| Whitelist role ownership | Agree boundary with the existing BYOND bot | No writes to externally owned roles |
| Shuttle text and ticket forms | Use owner-provided final copy/configuration | Fixtures clearly marked non-production |
| Role restoration baseline | Review current members and approved role list | No bulk restore or blanket re-onboarding |
| MediaWiki endpoint/version | API discovery in an accessible authorised environment | Endpoint unset; source disabled |
| Sophie name/artwork | Supplied identity chapter and four hash-recorded PNGs | Use the selected protogen; test crops/readability before release |
| Website design/assets | Read actual stylesheet/assets or approved export | Exact site tokens remain unverified; Sophie artwork is not a CSS/site-asset export |
| Privacy/retention | Owner and appropriate policy reviewer | Production ticket storage blocked until approved |
| Dashboard hostname/TLS | Existing hosting inventory and operator approval | Loopback staging only |

## Decision log to complete in discovery

D01: Does MIT-only cover platform runtimes, development tooling, and all indirect components? Record exact scope and any named exceptions; silence is not approval.

D02: Approved storage engine, driver, queue library, search method, migration tool, and backup method.

D03: Required staff access groups per ticket type; human reporter, reported subject, and case participant are distinct concepts.

D04: Admission prerequisite, final membership role, revocation behaviour, and policy for grandfathered members.

D05: Retention periods, maximum attachments/storage, case export policy, and backup expiry.

D06: Sophie name and four selected reference assets are supplied. Exact website tokens, additional artwork rights, production asset placement/crops, permitted AI channels, public knowledge collections, and service connector inventory remain to be recorded.

D07: Tested CPU limits and owner-approved usability thresholds for AI activation. Apply the existing WUFF addendum as the proposed shared-host overlay.

D08 (identity fixed; implementation review open): Sophie, she/her, Community Services, neon chibi protogen. Owner review of production copy, asset placement and publication details remains part of the release process.

## Out of scope

AI inside tickets, automatic moderation decisions, age assessment by models, training on Discord messages, unrestricted code tools, arbitrary plugin upload, historical ticket migration, a new wiki, game account linking, multi-guild SaaS, economy/levelling, and a visual programming platform.
