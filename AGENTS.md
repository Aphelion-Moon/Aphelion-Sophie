# AGENTS.md — Sophie / Aphelion administrative bot

## Source of truth

Current owner decisions are in `docs/decisions/0001-owner-policy.md`; current implementation ordering and evidence are in `docs/workplan.json`, `docs/verification.md` and the external continuation linked by the owner decisions. These supersede conflicting recommendations in the preserved `Sophie-Implementation-Plans-v1.1` reference pack. For the AI workstream the owner permits up to two GPT-5.6 Luna sub-agents at Max effort for bounded independent work; use one implementation owner per worktree. Do not change the original hardware addendum or source artwork.

The latest requirement is **no AI in tickets**. Read the numbered plans and decision log. Earlier suggestions for AI case assistance are obsolete. Do not reintroduce them as optional settings.

Human admission happens before Discord entry. Crew is the default role except while Muzzled. Muzzled blocks Shuttle completion and Whitelist delivery. Every loss of Whitelist, including leaving, requires a fresh Shuttle run; never restore it from a snapshot. Blacklisting stays with humans removing Discord access; do not import their records. Only Head Admin contact excludes ordinary Staff. Case records, attachments and transcripts have no automatic expiry. Original repository code is MIT under the existing LICENSE; this does not approve a non-MIT dependency or relicense artwork.

## Non-negotiable boundaries

1. No model sees ticket messages, forms, attachments, transcripts, staff notes, or onboarding-session content. No AI replies, drafting, summaries, triage, case classification, embeddings or training. No case connector, tool or dashboard preview path. Synthetic ticket sentinels must never enter AI storage or requests.
2. AI is opt-in in approved non-ticket contexts only. Check before ingestion and again before delivery. Closed/moved cases and child threads remain excluded. Do not auto-transfer chat into a support form.
3. Never grant access based on a model response, component ID, reaction, channel visibility or an old role snapshot. Use current eligibility, versioned state and revocation epochs.
4. Keep the existing Discord/BYOND bot's responsibilities and role ownership intact.
5. New directly reused FOSS projects must be MIT. Unknown/non-MIT dependencies, runtimes, toolchains and model artifacts require a recorded scope decision. No implicit exception and no relabelled code translation.
6. The runtime is Windows Server 2022; do not require Docker Desktop, Linux, a GPU or a cloud AI provider.
7. MediaWiki is the current source. Wagtail is not deployed and is not a prerequisite.
8. Only core holds the Discord token; knowledge and inference identities have no case-store or transcript access.

## Sophie identity and asset rules

Use Sophie (she/her), Community Services, and the latest neon chibi protogen. Read chapter 12, `asset-manifest.json` and `brand-profile.json`. Only the four bundled protogen assets are active; do not substitute the older human artwork or invent missing brand files. Source PNGs are preserved byte-for-byte; any later exports need their own provenance and visual checks.

Branding is shared presentation, not an AI dependency. Tickets/Shuttle can show the normal bot avatar and static approved templates, never a generative mascot, ticket-summary control or AI data path. Style cannot change permission checks, state transitions or truthfulness. The approved AI workstream permits persistent owner-published character and approved knowledge, with separately gated explicit personal memory and named restricted contexts. It permits configurable participation in explicitly enabled, individually opted-in non-ticket contexts. Do not add image generation, voice, animation, autonomous personality changes, model training, invented lore authority or a second bot identity.

Website CSS/fonts/official insignia remain unverified. New exact style values are proposals, not extracted site facts. Keep technical identifiers stable unless an explicit migration is approved. The original WUFF addendum remains the hardware overlay; do not publish the raw host dump or alter existing game services.

## Engineering practices

Use explicit module ownership, injected narrow interfaces, JavaScript ESM/JSDoc and runtime contracts unless an approved decision changes the tooling. No global service locator or opaque singleton managers. No generic tool that executes shell, SQL, arbitrary URLs or unreviewed plugins.

Separate domain state from Discord rendering. Commit intended side effects durably with state. Expect duplicate events, timeouts and late external effects; use idempotency, reconciliation, current-policy checks and compensation. Never claim a database transaction makes Discord exactly-once.

Keep configuration as bounded data, not executable code or untrusted compiler schemas. Share use cases between commands and dashboard routes. Authorise on every operation, not just in the UI. Keep logs minimal and redacted.

## Development and review

Use synthetic data and staging credentials. No production secrets, real player reports, age-check documents or transcripts in prompts, fixtures or screenshots. Do not make production changes without recorded operator approval.

A PR includes task/requirement/test IDs; scope; dependency/licence changes; permission and migration impact; tests actually run and skipped; rollback procedure; and documentation updates. Use small reviewable commits. A test specification is not a passed test.

At each implementation milestone, update `docs/workplan.json` and regenerate `docs/workplan.md` with `node scripts/build-workplan.mjs`. Record implemented scope, actual test evidence, remaining work and the next step; distinguish offline verification from live release approval. Update `docs/verification.md` and its source-bound reports when the verified build changes.

Pin approved versions and hashes. Review transitive/bundled licences and model quantisation separately. Do not auto-update dependencies/models in production.

## Completion

Follow the release gates in `Sophie-Implementation-Plans-v1.1/01-REQUIREMENTS-AND-DECISIONS.md` and the current decision record. Administration can ship with AI disabled. Stop only the work affected by an unresolved gate, document the blocker, and continue unrelated approved tasks without inventing missing facts.
