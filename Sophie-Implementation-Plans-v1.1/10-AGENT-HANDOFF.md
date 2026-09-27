# 10 · Lead-agent handoff

## Copy-ready assignment

Build **Sophie**, Aphelion's self-hosted Discord administration application, from this plan in a new or explicitly designated repository. The owner has approved planning and wants implementation organised for agents. Preparing this pack did not authorise changes to an arbitrary connected repository or production deployment.

Read `00-START-HERE.md`, `01-REQUIREMENTS-AND-DECISIONS.md`, `12-SOPHIE-IDENTITY-AND-ASSETS.md`, the WUFF hardware addendum, and `AGENTS.md` first. Use `backlog.json` for work ordering and `test-cases.json` for acceptance. Begin with P00–P03, recording unresolved environment inputs rather than inventing them. Work in staging with synthetic data and a distinct test application token.

The application serves one production guild through one bot identity. It replaces Carl.Bot's selected roles/reactions/responses and Tickets Bot's support/forms. It provides a private deterministic Shuttle ticket. Discord/BYOND integration remains in the existing separate bot.

**Do not implement AI in tickets.** No case replies, summaries, drafting, explanations, classification, triage, embedding, transcript ingestion, staff-note retrieval, training or AI-generated handoff forms. This includes The Shuttle. The exclusion is permanent in configuration and covers background jobs, dashboard previews, logs and source ingestion. AI remains limited to approved non-ticket chat, public/approved documentation lookup and explicitly scoped read-only service tools.

Use MediaWiki now; discover the owner's actual API capabilities. Preserve source/approval/version metadata and rendered template dependencies. Do not build or wait for Wagtail.

Evaluate Phi-4-mini-instruct Q4_K_M with llama.cpp locally on CPU. Pin and verify artifact/runtime hashes and licences, apply limits, and test real host performance. No hosted inference/embedding fallback. If AI is not ready, administration and direct lookup must still be usable.

New directly reused FOSS projects must be MIT. Oceanic.js, Fastify, React, llama.cpp and WinSW are candidates subject to full version/dependency review. JavaScript ESM/JSDoc is the baseline; TypeScript and PostgreSQL are not approved by implication. Resolve the platform/indirect licence scope and choose one approved transactional persistence implementation before installing it. Do not write an improvised database to avoid the question.

Sophie uses she/her, the designation Community Services, and the supplied neon chibi protogen identity. Import the four exact asset files through `asset-manifest.json`; do not use the earlier human avatar or regenerate substitutes. Apply chapter 12 to the dashboard and static message templates. Branding is independent of AI: cases and The Shuttle remain human-operated and deterministic.

The dashboard follows the Meridian space/neon/cassette-futurist direction. Sophie artwork and the sanitised host addendum are already supplied. Exact website tokens/additional assets, live wiki capabilities and workload measurements still need verification. Do not treat the artwork as evidence of actual site CSS or game-lore canon.

Deliver reviewed feature slices with explicit contracts, tests, source/licence records, migration and rollback notes, and updated operations documentation. Do not deploy or retire existing bots until the relevant release gates and operator approval are recorded.

## Agent lanes

The lead controls the shared contracts, dependency decision, configuration/permission schemas and migration ordering. A platform agent handles persistence/auth/service boundaries; a tickets/onboarding agent handles deterministic workflows; a dashboard agent handles staff interfaces and accessibility; a knowledge agent handles MediaWiki and lookup; a local inference agent handles model packaging/evaluation; an independent reviewer tests security and recovery.

Do not let agents independently add packages, change role ownership, or rewrite shared policy to make their feature easier. Coordinate schema migrations and public contracts before parallel implementation. A security-sensitive reviewer should not merely repeat the implementer's happy-path tests.

## First delivery

A discovery report containing the known inputs, remaining blocking decisions, dependency/licence evidence, database decision, and actual host/site observations; a repository skeleton using only approved tooling; synthetic fixtures; and failing acceptance tests for the central invariants. Work may stop at a particular gate while unrelated approved tasks proceed.

## Final implementation delivery

Reproducible release bundle, source and lockfiles, third-party notices, model lock, configuration schema, native service/install scripts, safe secret setup instructions, backup/restore/rollback tools, operator runbook, release/test ledger, current-member cutover ledger, versioned Sophie brand profile/assets/provenance, and known limitations. Do not label generated scripts production-ready until exercised in the target staging environment.
