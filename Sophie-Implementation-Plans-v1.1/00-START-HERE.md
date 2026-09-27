# Sophie — Aphelion community-services bot

## Implementation handoff

**Plan version:** 1.1 · **Prepared:** 18 September 2026 · **Target:** Windows Server 2022

**Status:** Implementation plan, not a deployed application or completed security audit. No repository, Discord configuration, production service, or existing bot has been changed by preparing this pack.

## Version 1.1: identity and assets

The bot is **Sophie** (she/her), designated **Community Services**. Her selected visual identity is the **neon chibi protogen** in the four bundled images. It replaces the earlier human character design. Read `12-SOPHIE-IDENTITY-AND-ASSETS.md` for naming, presentation, asset placement and proposed editorial guidance.

This revision updates the editable plans, agent instructions, configuration sketch, tasks, tests, master document and offline reader. It does not add AI to any ticket, alter access rules, approve software licences, or deploy anything. Original v1.0 files outside this versioned pack are untouched.

The existing `Aphelion-Bot-WUFF-Hardware-Addendum.md` is included unchanged and remains the shared-host deployment overlay for this revision. Its proposed resource settings take precedence over the generic v1.0 runtime defaults retained in the core plan/configuration sketch. This branding revision does not silently merge or approve those hardware proposals; see `CHANGELOG.md`.

## The decision

Build one self-hosted administrative application with one production Discord identity, a staff web dashboard, and independently testable feature modules. Replace the current Carl.Bot and Tickets Bot responsibilities. Keep Discord/BYOND integration with the existing separate bot.

Move The Shuttle into a persistent, private, interactive onboarding ticket. Provide separate community AI chat, knowledge answers, and read-only service lookups. Start with MediaWiki and a local CPU model; do not wait for Wagtail.

**There is no AI in tickets.** This supersedes all earlier proposals for AI ticket replies, explanations, drafting, summaries, classification, triage, sentiment analysis, or case retrieval. The prohibition includes support, reports, staff-created tickets, and The Shuttle. Ticket messages, forms, attachments, transcripts, and staff notes are excluded from AI ingestion and model context. This is a product invariant, not an administrator-toggleable setting.

## Read this pack in order

| File | Purpose |
|---|---|
| `01-REQUIREMENTS-AND-DECISIONS.md` | Scope, settled decisions, missing deployment inputs, and release gates |
| `02-ARCHITECTURE-AND-DATA.md` | Module boundaries, process isolation, contracts, persistence, and recovery |
| `03-TICKETS-SHUTTLE-AND-ROLES.md` | Human-run ticketing, deterministic onboarding, role restoration, and chat automation |
| `04-KNOWLEDGE-AND-LOCAL-AI.md` | MediaWiki connector, local model, retrieval, non-ticket chat, and future integrations |
| `05-DASHBOARD-AND-DESIGN.md` | Staff screens, commands, permissions, Meridian-inspired visual specification |
| `06-SECURITY-PRIVACY-AND-LICENSING.md` | Threat controls, data separation, retention, and MIT dependency policy |
| `07-WINDOWS-OPERATIONS-AND-CUTOVER.md` | Native services, health, backups, installation gates, and migration/rollback |
| `08-IMPLEMENTATION-WORKPLAN.md` | Sequencing, agent responsibilities, task definitions, and useful later features |
| `09-ACCEPTANCE-AND-TESTS.md` | Test cases, release criteria, recovery and AI-exclusion tests |
| `10-AGENT-HANDOFF.md` | Copy-ready lead-agent brief and contribution rules |
| `11-SOURCES.md` | Primary-source research and verification limitations |
| `12-SOPHIE-IDENTITY-AND-ASSETS.md` | Selected protogen identity, supplied asset catalogue, placement and voice guidance |
| `Aphelion-Bot-WUFF-Hardware-Addendum.md` | Existing shared-host refinements; retained as the deployment overlay |
| `asset-manifest.json` / `brand-profile.json` | Measured asset metadata, stable references and bounded identity guidance |
| `assets/sophie/neon-chibi-v1/` | Four original PNG assets, copied without alteration |
| `CHANGELOG.md` | Revision scope, precedence and handoff notes |
| `backlog.json` | Machine-readable tasks, dependencies, deliverables, and test links |
| `test-cases.json` | Machine-readable acceptance cases; these are specifications, not executed results |
| `config.example.json` | Non-executable configuration sketch with safe defaults and unresolved fields |
| `dependency-register.json` | Candidate dependencies, licence evidence, and approval status |
| `AGENTS.md` | Repository instructions to use when creating the implementation repository |

The offline HTML reader contains the complete plan and task/test specifications. Markdown files are the editable source of truth; regenerate the reader after changing them.

## First release boundaries

**Administration release:** Dashboard, normal support/report tickets, staff-initiated cases, Shuttle progression, join roles, conservative role restoration, approved canned responses, simple reactions/responses, audit and recovery.

**Knowledge release:** Exact and lexical lookup over approved MediaWiki content, followed by a local model answering from that evidence in dedicated non-ticket channels. AI failure must not impair administration. AI can launch after administration rather than delay the replacement bots.

**Later, gated additions:** Allowlisted website/GitHub/status connectors, semantic retrieval if evaluation warrants it, suggestions, scheduled announcements, and other community utilities. Every external connector is opt-in. Wagtail is a future adapter, not a migration task in this project.

## Decisions that are fixed

- Sophie, she/her, Community Services; use the supplied neon chibi protogen assets, not the former human design.
- Single production guild and bot identity; separate staging credentials are permitted and never used in production.
- Native Windows Server 2022 deployment, no required Linux VM or Docker Desktop.
- MediaWiki is the live knowledge source supplied by the owner.
- Initial model selection: Phi-4-mini-instruct, Q4_K_M GGUF, via llama.cpp, subject to artifact verification and CPU evaluation.
- New directly reused FOSS application projects must be MIT. A non-MIT component is not approved merely because it was suggested earlier.
- No external AI provider or cloud embedding fallback at launch.
- Dashboard visual direction follows the Meridian website brief: space framing, restrained neon, cassette-futurist surfaces, and readable working panels.
- No historical ticket migration; existing membership eligibility still needs a controlled baseline.

## What the first agent does

Read `AGENTS.md` and the requirement file. Produce the discovery and licensing evidence for tasks P00–P03. Work only in the implementation repository or an authorised staging environment. Start the repository, contract tests, and synthetic fixtures without pretending production credentials, current load measurements, or licence approvals are available. The sanitised WUFF inventory and Sophie artwork are already supplied; verify their integration rather than requesting them again.

Do not silently choose PostgreSQL, a TypeScript compiler, or another non-MIT component. Do not replace reliable persistence with an improvised database merely to evade the approval question. The storage choice is a deliberately visible gate. A logical transaction/outbox design is supplied so the architecture work can proceed.

## Unverified inputs—not reasons to restart planning

The WUFF inventory snapshot and the four Sophie assets are supplied. Current representative-load measurements, service-account verification, actual Discord IDs/permissions, exact Shuttle copy, ticket forms, exact website tokens/additional assets, database approval, and retention policy still require discovery. Do not invent them.

Both supplied websites failed to load in this planning environment. The connector endpoint, wiki version/extensions, and website CSS/assets remain unverified. This does not establish that the public services are down. Use an authorised accessible environment or an owner-provided export to finish those checks.

## Completion means evidence

Deliver small reviewable changes with tests, licence provenance, rollback notes, and updated documentation. A planning checkbox is not proof of a passing test. The release ledger must identify the build, model hash, configuration version, tester, results, and unresolved defects.
