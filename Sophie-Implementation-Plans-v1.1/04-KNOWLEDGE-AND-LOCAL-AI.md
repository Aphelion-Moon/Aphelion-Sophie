# 04 · MediaWiki knowledge and local CPU AI

## Boundaries before features

Community AI is separate from case handling. It runs only in explicitly approved non-ticket channels or a dedicated authorised dashboard preview. Direct messages, arbitrary reply-chain expansion, message-context AI actions, and user-uploaded documents are disabled initially.

No case connector exists. The worker cannot query case tables, fetch ticket links, access transcripts, read staff notes, classify support forms, or reuse ticket messages for evaluation/training. The dashboard has no case-side AI control, and an administrator cannot enable it through configuration. Human-authored ticket controls and static answers remain normal deterministic functions.

The system cannot reliably identify arbitrary text a person manually retypes or pastes into a permitted chat. Do not claim otherwise. Display a notice against submitting private case material, reject known ticket/transcript references without fetching them, accept no attachments initially, and test every system-controlled ingestion path. The enforceable guarantee is that the application never supplies its ticket data to AI.

## Initial profiles

| Profile | Function | Evidence and tools |
|---|---|---|
| Knowledge | Answer community questions with sources | Approved published collections only |
| Community chat | Optional casual conversation, clearly distinguished from policy | Bounded user conversation; no confidential source access |
| Live lookup | Return structured service facts with an observation time | Explicit read-only adapters; no generic URL/network access |
| Staff knowledge preview | Test public or separately approved staff documentation | Never cases, transcripts, or staff case notes |

Launch with Knowledge; activate casual chat only after evaluation and channel approval. Keep in-universe persona separate from official out-of-character policy. The assistant may explain an approved policy but cannot change eligibility, promise moderation outcomes, or grant exceptions.

`/lookup` returns direct matches even when the model is disabled. `/ask` retrieves evidence before generation. `/status` uses a deterministic live connector if one is configured. A **Contact staff** link can open a blank human-support form without copying the conversation or generating its content.

## Sophie persona, limited to presentation

Use the name Sophie and the selected chibi protogen identity for the allowed non-ticket experience. Suggested voice: warm, composed, capable, and lightly playful where appropriate. Keep evidence, permissions, honest uncertainty, and real operational state above persona. Do not invent memories of the station, personal relationships, moderation decisions or completed actions.

The knowledge profile gives sources and distinguishes generated answers from deterministic lookup. Casual character chat remains optional and gated as already specified. No image, chat-template or branding change can enable AI in support, reports, staff contact, or Shuttle cases. See `brand-profile.json`; it contains no tool grants and no ticket exception.

The hardware addendum is still the deployment overlay. This identity revision does not change the selected model, licence gates or local-only rule.

## MediaWiki discovery

The supplied live source is `https://meridian-wiki.a13.info/wiki/Main_Page`. The exact API script path, version, extensions and authentication are not verified. Do not assume `/w/api.php` or require a new wiki extension without checking.

In an authorised accessible environment, determine the API endpoint from site metadata/configuration, query site information, identify supported API modules, and record page/content rights. Use read-only credentials if required. MediaWiki exposes site metadata and rights information through its siteinfo API. [S26](11-SOURCES.md#s26)

Use capability detection rather than copying the latest documentation's fields blindly. Current parse documentation marks `sections` deprecated in favour of `tocdata`, but the live wiki may be older. Support the fields actually advertised by that installation. [S23](11-SOURCES.md#s23)

## Ingestion pipeline

1. Enumerate approved namespaces, pages, categories and redirect aliases. Default exclusions: talk/user/draft spaces, unapproved staff areas, case archives, and embedded external content.
2. Retrieve metadata and parsed article output through the API. Retain a source revision, fetch timestamp, approved snapshot hash, section hierarchy and canonical URL.
3. Sanitise without executing scripts or loading remote resources. Preserve headings, list structure, tables and row/column associations; exclude navigation and decorative skin markup.
4. Apply source classification and approval. Chunk only after the document has an audience and authority policy. A chunk inherits its parent's restrictions.
5. Build exact/alias and lexical indexes. Publish a new immutable index generation only after validation. Keep interrupted runs separate from the last known valid generation.
6. Synchronise incrementally with persisted continuation/cursors, change IDs, bounded overlap and deduplication. Treat deletions, moves, restrictions and approval withdrawals as first-class invalidations.
7. Reconcile the full approved inventory periodically. Change streams may be incomplete after a long outage; a cursor is not proof that the index is current.

MediaWiki's parse and recent-changes APIs support this approach. Follow its API etiquette for a descriptive user agent, bounded/batched work, continuation and backoff; respect API error/maxlag/Retry-After responses when applicable. Initial polling and batch sizes are proposed operational settings, not assumptions about this wiki's capacity. [S23](11-SOURCES.md#s23); [S24](11-SOURCES.md#s24); [S27](11-SOURCES.md#s27)

### Template and rendered-snapshot correctness

Track each document's template dependencies and reverse references. On a template or dependency change, re-render affected approved pages, including nested dependencies where exposed; a conservative wider refresh is safer when the dependency graph is incomplete. MediaWiki's embedded-in API helps discover transcluding pages. [S25](11-SOURCES.md#s25)

Approval belongs to the **rendered snapshot and dependency fingerprint**, not just the article revision number. Do not assume an old article revision necessarily reproduces the exact previously approved output after its templates change. Preserve the actual approved text/hash, detect changes, and require reapproval for authoritative policy content.

### Deletion, attribution, and conflict

Tombstone a restricted/deleted source before later jobs can reuse it. Invalidate retrieval results, derived chunks, caches and pending answers. Recheck evidence availability and audience before delivery.

Store canonical links, titles, revisions, author/rights metadata where appropriate, and content-attribution rules. Software licences do not establish article/image rights. Do not blindly ingest or republish complete articles into chat.

Configure an explicit authority order per topic: for example, owner-approved policy collection over an unreviewed discussion page. The exact precedence must be approved; it is not inferred from the website's visual prominence. Conflicting evidence produces a limited answer explaining the conflict or direct links, not a model-invented rule.

## Retrieval and response pipeline

Verify actor and destination, apply the non-ticket gate, choose approved collections, retrieve exact/alias/lexical matches, filter evidence, enforce a token budget, call the local model, validate its structured citation references, and recheck delivery scope.

The audience of the answer constrains its evidence. A staff member's access to a restricted article does not permit a public reply based on it. Keep public answer profiles public-source-only; add staff-document profiles only after dedicated access tests.

Citations are source IDs supplied by the application, mapped to validated canonical links. Reject invented source IDs. When there is no adequate evidence, return direct search results or a clear inability to verify the Aphelion-specific claim. Presence of a citation does not prove the cited text supports the answer; evaluation must check support.

Treat retrieved text as untrusted evidence, not privileged instructions. Apply independent tool authorisation and do not rely on the model's confidence or a prompt alone. OWASP recommends preserving access controls through retrieval and separately validating tool actions. [S21](11-SOURCES.md#s21); [S22](11-SOURCES.md#s22)

Start without semantic embeddings. Add them only if lexical evaluation shows meaningful missed questions; index only approved non-ticket sources and keep the same permission/deletion controls. Do not add an extra embedding runtime and native dependencies merely to complete an architecture diagram.

## Local model and runtime selection

**Selected evaluation baseline:** Microsoft Phi-4-mini-instruct, 3.8B parameters, Q4_K_M GGUF quantisation, served by llama.cpp. The model and llama.cpp have MIT project licences; verify the chosen quantised artifact separately. The published Unsloth GGUF repository is a candidate, not a trusted binary exemption. [S04](11-SOURCES.md#s04); [S05](11-SOURCES.md#s05); [S06](11-SOURCES.md#s06)

Create a model lock record containing original publisher, source revision, quantisation publisher/revision, exact filename, SHA-256, licence evidence, chat template, runtime build, permitted purpose and evaluation result. Download through a controlled provisioning step; runtime model auto-download/update is disabled. Verify that every build flag and optional library is represented in the dependency register.

| Parameter | Initial proposed setting |
|---|---|
| Execution | CPU only; no required GPU |
| Active generations | 1 |
| Waiting requests | Maximum 8 globally and 1 per member |
| Context | 4,096 tokens total, including evidence/history/output budget |
| Maximum output | 512 tokens; lower it if measured usability requires |
| Request lifetime | Proposed 120-second bound, then direct-source fallback; no speed promise |
| Memory reservation | Measure on host; initial planning headroom around 6–8 GB, not a guaranteed footprint |
| Threads | Derive from host inventory and load test; do not consume every logical CPU by default |
| Session expiry | Proposed 30 minutes inactivity; no cross-channel memory |
| Model payload retention | None after request/session expiry by default |
| Cloud fallback | Absent, including embeddings |

The proposed settings are not a production acceptance result. Benchmark cold load, prompt processing, time to first token, output rate, full latency, memory peak, queue behaviour and impact on concurrent administrative work. If the host cannot deliver acceptable behaviour, keep direct lookup and administration live and leave AI off. Do not silently swap in a differently licensed model.

## Inference service hardening

Bind to loopback, authenticate the worker, block external ingress, and disable web UI, shell/file/agent capabilities and unnecessary endpoints for the pinned build. The llama.cpp server documents Windows support and optional agent tools; these tools are unnecessary here. Select a build/configuration that permits disabling them and test that they are unreachable. [S30](11-SOURCES.md#s30)

Inference gets only the current permitted prompt, never database access. Avoid prompt logging in both the HTTP wrapper and model server. Cancellation stops local generation and clears queued payloads where possible. A disabled model or failed connector must not disable ticket administration.

## Evaluation and feedback

Use synthetic cases and approved public documentation, not real tickets. Maintain at least 40 reviewed launch questions covering rules, lore, procedures, exact identifiers, ambiguity, missing information, conflicting sources, malicious source instructions and access attempts.

Proposed release floor: zero prohibited data/tool actions; all emitted source IDs valid; at least 90% of answerable knowledge questions substantively supported and useful; appropriate abstention on all deliberately unanswerable/confidential prompts. An independent reviewer records misses. These are acceptance targets for the evaluation set, not claims of real-world accuracy.

Feedback records a request ID, source IDs, model/config version and a user-selected reason. Storing full text requires the retention policy. Staff fix authoritative source material or retrieval/prompt configuration through review; no automatic fine-tuning or harvesting of private Discord messages. Discord's Developer Policy restricts mining/scraping and using API message content to train AI models without its express permission. [S11](11-SOURCES.md#s11)

## Future service adapters

Inventory the actual platforms before implementing adapters. Approved website pages, selected repository documents/issues, and service-status endpoints are likely candidates. Use minimum-scope service credentials, timeouts, circuit breakers, cursor handling, provenance and audience mapping. An endpoint's credentials belong to its connector, not the model.

Do not add arbitrary browsing, shell, SQL, game administration, remote plugin installation, MCP auto-discovery or automatic writes. A later connector expansion requires its own permission/egress tests. A Wagtail connector should map into the same document contract when that deployment exists; no present dependency is created.
