# 06 · Security, privacy, and MIT adoption policy

## Security posture

Treat Discord messages, wiki content, external-service responses, attachments, browser requests and model output as untrusted inputs. The owner-approved permissions and application state decide what happens. Authentication and a model's instruction-following are not authorisation. OWASP recommends deny-by-default access and checks on every operation. [S20](11-SOURCES.md#s20)

This plan specifies engineering controls, not a legal-compliance certification. Retention, privacy notices and access policy require the appropriate owner review before production.

## Threat/control register

| Threat | Required control | Evidence |
|---|---|---|
| Model reads cases | Separate worker credentials/storage ACLs, no case tools, no ingestion route, fixed ticket deny | T22–T26 |
| Staff privilege change during an action | Fresh capability/access epoch check immediately before mutation or delivery | T04, T29 |
| Prompt injection in a wiki page | Untrusted-evidence treatment, independent tool policy, no privileged tools | T30 |
| Public answer leaks staff material | Destination audience constrains retrieval and final delivery | T29 |
| Case ID guessing or transcript URL sharing | Per-case checks, authenticated artifact access, private storage | T07, T10 |
| Revocation bypass through rejoin/retry | Eligibility epoch and allowlisted restoration; no blind reconciliation | T18–T21 |
| Duplicate Discord events or timeouts | Transactional state, idempotency identities, reconciliation and ambiguity handling | T13–T17, T36 |
| External connector accesses internal network | Fixed adapter endpoints, redirect/DNS/IP validation, network allowlist | T47 |
| Malicious file or rendered text | Size/type restrictions, quarantine, escaping, no executable preview | T10–T11 |
| Agent adds incompatible or unsafe dependencies | Locked versions, complete inventory, licence/notice review, no automatic approval | T02 |
| Model/queue starves administration | Separate processes/budgets, bounded queue, cancellation, admin-first health | T33–T34 |
| Backup restores deleted information | Tombstone/deletion ledger reapplied before serving or indexing restored data | T35, T39 |

## The non-AI ticket boundary

Classify every ingress context before forwarding content. Tickets include all registered case channels, their thread descendants, known transcript routes/artifacts and configured ticket categories. Consult the persistent case registry, not channel names alone. Recheck after channel moves and before sending delayed results. If classification cannot be established, deny AI.

Case records remain marked excluded after closure, movement, archival or reopening. A ticket does not become an AI channel by being moved into an otherwise allowed category. Administrative publication cannot override this through a channel allowlist. Source path/classification rules also prohibit ticket exports disguised as wiki collections.

Do not forward entire gateway events to the knowledge worker. Pass only a validated non-ticket request with minimal identity/destination fields. Generic error tracing, dashboard previews, scheduled jobs and feedback exports are included in this restriction.

Measure the boundary with sentinel text in synthetic tickets: no sentinel may occur in worker input, retrieval indexes, AI session storage, model request logs, evaluation data or generated outputs. Include a test where a queued response's channel becomes a ticket before delivery. [S21](11-SOURCES.md#s21); [S22](11-SOURCES.md#s22)

A malicious authorised user can manually retype sensitive material elsewhere; the application cannot perfectly recognise that. Set a clear no-private-case-material notice and avoid promising detection of arbitrary pasted text.

## Credentials and network boundaries

Store production credentials in an operator-approved secret mechanism with ACLs limited to the relevant service account. Do not put secrets in a repository, task prompt, screenshot, public `.env` file, process command line, model lock or sample configuration.

Core holds Discord and dashboard authentication secrets. Knowledge worker holds only its source credentials and local inference authentication. Inference has no connector or Discord credentials. Rotation invalidates old tokens and updates services through a documented operational path.

Expose only the authorised HTTPS dashboard endpoint. Database, worker control, health internals and inference remain loopback or protected local endpoints. Connector egress is restricted by adapter; no arbitrary URL tool. Revalidate redirects and DNS results, reject unexpected private/link-local destinations unless a particular internal endpoint is explicitly approved, and block credential forwarding to another host.

Use current TLS, fixed callback URLs, OAuth state, secure HttpOnly cookies, CSRF controls and strict origin handling. The source of a capability is authenticated application context, not a request body. [S09](11-SOURCES.md#s09)

## Data retention and minimisation

Before opening production tickets, fill in the retention schedule for messages/forms, attachments, transcripts, audit records, AI sessions, knowledge snapshots and backups. Specify the purpose, permitted readers, duration, deletion trigger and restore behaviour for each. Do not invent jurisdiction-specific retention obligations.

Proposed privacy defaults: no persistent cross-channel AI memory; no raw prompt logging; short-lived in-progress AI sessions; no age-check documents; no user profiling; no data used for training. Store only the admission decision/reference required by the existing gate, not evidence copies.

Case deletion and export remain audited, authorised operations. The deletion ledger must be usable after restore. Backups expire on a defined schedule; do not claim immediate physical erasure from every backup when only live data was deleted. Avoid putting raw secrets/case content in audit payloads or metrics labels.

Source-access revocation invalidates related chunks, citations, caches and queued replies. A knowledge refresh is not allowed to restore a tombstoned case export or withdrawn source automatically. [S21](11-SOURCES.md#s21)

## MIT requirement: adoption procedure

The user requires MIT for FOSS projects directly reused. Until the wider boundary is explicitly recorded, agents must not treat non-MIT infrastructure/tooling/indirect dependencies as approved. Continue planning and pure contract work; block the affected installation/release step, not unrelated work.

For each candidate, record project/package name, purpose, exact version or commit, download/build hash, top-level licence, relevant bundled/indirect licences, optional features enabled, notices, modifications, source location and approval status. Validate model weights and quantisation separately from the inference engine.

**MIT candidates:** Oceanic.js, Fastify, React, llama.cpp, Phi-4-mini-instruct, the selected MIT-labelled quantisation, and WinSW. pg-boss is a conditional MIT queue candidate. A candidate label does not approve its entire resolved tree. [S01](11-SOURCES.md#s01); [S02](11-SOURCES.md#s02); [S03](11-SOURCES.md#s03); [S04](11-SOURCES.md#s04); [S05](11-SOURCES.md#s05); [S06](11-SOURCES.md#s06); [S13](11-SOURCES.md#s13); [S17](11-SOURCES.md#s17)

**Known unresolved/non-MIT selections:** PostgreSQL uses the PostgreSQL License; TypeScript uses Apache-2.0. Node includes additional third-party notices. Prior discussion does not grant an exception. Review the Node/runtime distribution and all native binary components before release. [S14](11-SOURCES.md#s14); [S15](11-SOURCES.md#s15); [S16](11-SOURCES.md#s16)

Do not install the previously suggested discord.js or Vercel AI SDK for this baseline. Use Oceanic.js after its compatibility check and a small application-owned local HTTP adapter. Avoid optional voice/compression/native packages unless required and approved.

The repository should have `legal/DEPENDENCIES.json`, `legal/THIRD-PARTY-NOTICES`, and a recorded licence policy. Do not label generated application code MIT or choose a copyright holder on the owner's behalf without a publication decision. The direct-dependency rule and the licence for original Aphelion code are separate decisions.

## Conceptual reuse and agent rules

Features may be inspired by non-MIT projects, but code must be independently implemented from a behavioural specification. Do not translate or lightly rewrite non-MIT source and describe it as independent. Retain provenance for any actual MIT code reuse and its notices.

Agents must not fetch production conversations for development, paste secrets into model contexts, install arbitrary plugins, or deploy without the release approval. Supply synthetic fixtures and least-privilege development credentials. Scan lockfile changes and binaries, and review the final assembled distribution rather than only direct dependencies.

## Operational security controls

Record security-relevant changes: permissions, role ownership, model/source scope, published prompts, Shuttle overrides, transcript exports, retention policy, secret rotation and emergency stops. Prevent non-operator accounts from clearing audit history. Local host administrators remain trusted.

The emergency controls are independent: disable AI, pause source syncing, pause new tickets, disable role writes, and enter read-only maintenance mode. Each should fail safely and show a clear status. Disabling AI must not disable human support.

## Sophie artwork and presentation boundary

Track the four selected image files separately in `asset-manifest.json`, with source attachment identifiers, dimensions, alpha metadata and measured SHA-256. They are conversation-generated artwork, not an MIT software package. This update does not assert a copyright holder, exclusive ownership, a licence for the species name, or blanket third-party redistribution rights. Record any publication decision separately; do not copy website fonts or insignia because they resemble details in the images.

The artwork can be shown statically without enabling AI inference. Model workers receive neither case context nor administrative secrets through a brand-preview or image-selection path. Appearance controls accept approved asset IDs only. Static public assets and authenticated case artifacts must use separate roots and routes. Keep the earlier human artwork outside active release paths; retain historical originals separately rather than deleting them.

Use ordinary text labels for errors, access state and human ownership. Sophie's friendly face is not a security indicator and cannot establish that a request succeeded or that staff have reviewed a case.
