# 05 · Staff dashboard, commands, and design brief

## User experience goal

A **Sophie — Community Services** operations console for Aphelion, with Meridian's atmosphere, not a generic chatbot UI or a decorative skin that makes administration harder. The latest neon chibi protogen artwork is supplied in this pack and supersedes the earlier human avatar. The exact live-site stylesheet, palette, fonts and website imagery remain unverified; do not treat the generated artwork as a website export.

The dashboard and Discord commands are two clients of the same application operations. Controls appear according to capability, but the backend always authorises them independently. Never rely on a hidden button as security.

## Information architecture

| Area | Main screens and actions |
|---|---|
| Overview | Service health, admission/ticket failures, queue age, source freshness, backup status; no confidential case excerpts |
| Tickets | Permitted queues, case detail, participants, assignment, manual notes, canned replies, transcripts, closure |
| Shuttle | Draft content, stage preview, version history, publish/withdraw, session recovery, logged staff override |
| Members and roles | Ownership map, restorable-role allowlist, current eligibility, revocations, reconciliation exceptions |
| Automation | Static message/reaction rules, channels, cooldowns, previews, dry-run results |
| Knowledge | Sources, approved collections, sync status, rendered snapshots, review queue, invalidations, search preview |
| AI | Dedicated-channel policy, local model provenance, limits, queue/cancel, prompt versions, public-knowledge preview, evaluation |
| Identity and appearance | Sophie identity, selected asset-set version, avatar/banner/wordmark previews, quiet mode, static template previews and release approval |
| Integrations | Explicit adapter registration, scoped resource inventory, secrets references, connectivity tests |
| Operations | Audit, jobs/dead letters, migrations/build versions, retention/deletion status, backup/restore evidence |

**Tickets and Shuttle contain no AI button, summary, draft, recommendation, classification, or conversation-transfer control.** The AI page cannot point at a case, transcript path or staff-note collection. The no-ticket exclusion is displayed as a fixed safety boundary, not an editable preference.

## Staff capability model

Define capabilities rather than hard-coding a single universal staff role. Proposed groups are owner/operator, configuration editor, ticket responder, report moderator, onboarding staff and knowledge editor. Actual Discord role IDs and combinations are configured at discovery.

A knowledge editor can approve articles without reading cases. A report moderator can access only permitted report types. An operator can inspect job outcomes without default raw conversation access. Access to credentials is separate from editing message text.

Login uses Discord OAuth and a fixed guild allowlist. Display identity and effective access. Invalidate or recheck sessions after staff role changes, sensitive configuration changes and logout. Configuration changes show before/after values, validation results, author and publication time. [S09](11-SOURCES.md#s09); [S20](11-SOURCES.md#s20)

## Essential workflow designs

### Ticket detail

Left: permitted queue and filters. Centre: member-visible conversation and form fields. Right: participants, assignment, type and status. Staff-only notes have a clearly distinct restricted area and cannot be accidentally sent as a public reply. Transcript export states its audience and retention. No AI is present.

### Shuttle editor

Ordered finite steps with approved text, acknowledgements and Continue/Back/Ask staff behaviour. Preview member and staff views. Validate Discord message/component limits against the pinned implementation. Publishing creates an immutable definition version. A change-impact screen identifies active sessions before withdrawal/migration.

### Knowledge review

Show source, revision, rendered snapshot hash, category/namespace, effective audience, approval state, template-dependency changes and freshness. Search preview explains why a result was included or excluded without leaking excluded text to unauthorised editors. Publish, quarantine and delete actions are auditable.

### AI operations

Show model/runtime hashes, load status, queue length, measured memory/latency, context/output caps, user limits, permitted channels and the global disable switch. Label cold-loading, busy, unavailable and disabled distinctly. Test prompts run only against permitted knowledge; they do not import the current dashboard page into context.

Use draft/validate/publish for prompts and settings. A change to a source's audience, model artifact or tool scope must rerun appropriate tests. No API key or model endpoint may be silently substituted.

## Discord commands

| Command family | Purpose | AI allowed? |
|---|---|---|
| `/ticket open`, `claim`, `close`, `reopen`, `participant` | Human case operations | No |
| `/shuttle start`, `resume`, `status` | Deterministic onboarding | No |
| `/roles status`, staff `reconcile` | Role eligibility and safe repair | No |
| `/reply` | Human-selected canned text | No generation |
| `/lookup` | Direct permitted knowledge search | No model required |
| `/ask` | Dedicated-channel knowledge response | Only outside every ticket context |
| `/status` | Approved live service lookup | Prefer deterministic output |
| `/bot health`, staff `ai-disable` | Operational status and emergency control | No |

Command visibility is a convenience; the same backend checks apply even when a command appears in an unexpected channel. In a ticket, `/ask` produces a short static explanation and no model call. Avoid repeated unsolicited notices when someone mentions the bot in a ticket.

## Sophie asset placement and controls

Use the manifest's avatar for the bot identity and compact dashboard header. Use the wide banner on the welcome/about area, with live text and actions on an opaque surface. The full-body cutout suits non-sensitive welcome/help illustrations; the wide wordmark suits larger headers. Use `contain` sizing for the badge and a plain text fallback at narrow widths. Detailed placement rules and the actual file dimensions are in chapter 12.

The Identity and appearance page is not part of the AI configuration. Its editor can preview approved local asset IDs and static copy without reading cases or calling a model. Changes are versioned, validated, audited and rollbackable. Selecting a new release asset set requires review; do not add arbitrary image URLs, an executable SVG upload path, an image-generation button, automatic avatar changes, or a model-driven mascot at launch.

Keep decorative mascot use off case conversation panels by default. The ordinary bot avatar may still appear beside deterministic notices. Quiet mode suppresses optional hero/cutout art and neon effects while retaining identity text, focus indicators, operation status and all controls. No appearance setting changes AI routing or ticket access.

The four supplied PNGs are the identity references. Preview circle crops at small sizes, transparent edges on light and dark panels, mobile layout, subtitle legibility and missing-image fallback before publication. Do not claim the source cutout is already a platform-compliant sticker.

## Meridian design direction

Use a dark spatial shell with subdued space imagery and opaque work surfaces. Reserve neon for selected navigation, focus rings, restrained borders and primary actions. Use panel framing and small technical labels to suggest a reactivated station console. Do not put animated stars, heavy texture or glowing text behind transcripts, forms or logs.

The artwork establishes cyan/teal and magenta accents with charcoal and worn pale metal. It does not establish exact website colour values. During design discovery, record the actual site tokens and compare proposed adaptations in a static review. Keep a single theme layer with semantic variables such as `surface.canvas`, `surface.panel`, `text.primary`, `text.muted`, `accent.primary`, `focus.ring`, `status.error`, `space.backgroundOpacity` and `effects.enabled`.

Status must be expressed with text/icons as well as colour. Neon decorative accents and error/success colours have different roles; do not use the same visual signal ambiguously. Keep body type readable and reserve technical/monospaced treatment for identifiers or compact metadata.

Use locally served, rights-approved assets. Do not copy third-party art or font files merely because they appear on the website. Prefer installed/system font fallbacks until asset licences are approved. The planning pack contains the four conversation-generated Sophie PNGs, but no copied website art or font files. No software licence is assigned to the artwork by implication.

## Accessibility and working conditions

Target WCAG 2.2 AA for the dashboard; test keyboard navigation, focus visibility, labels/errors, reflow/zoom, screen-reader names and contrast. Ordinary text needs at least 4.5:1 contrast; large text can use 3:1. [S31](11-SOURCES.md#s31)

Provide an explicit quiet mode and respect reduced-motion settings. Nonessential interaction animation should be disableable; this is an additional product requirement, not a claim that that specific WCAG criterion is AA. [S32](11-SOURCES.md#s32)

Support narrow layouts for urgent staff actions. Dangerous buttons must not be adjacent without spacing and confirmation. Preview, failed-save, permission-denied, stale-data and offline states require design attention—not just the successful desktop screen.

## Dashboard implementation acceptance

Use one component vocabulary for forms, tables, dialogs, status banners, case participants, source citations and audit history. Avoid a heavyweight design system unless its licence/dependencies and need are approved. Production serves static compiled assets, not a development server.

Escape untrusted content, use a restrictive content security policy and no third-party analytics that capture case data. Navigation, analytics and diagnostic traces must not send ticket titles/messages to the AI worker. Visual review and accessibility evidence are release artifacts.
