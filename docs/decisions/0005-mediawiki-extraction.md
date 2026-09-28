# ADR 0005 — Policies collection and bounded HTML extraction

Status: owner-approved dependency scope, 28 September 2026.

The owner supplied `https://meridian-wiki.a13.info/wiki/Policies` as the initial
MediaWiki collection and identified Discord `#rules` as a separate source.
Collect only Policies (observed page ID 878) and the revision metadata of its
rendered template dependencies. This does not approve whole-wiki crawling,
Discord history ingestion, case material or automatic publication.

The discovered API is `https://meridian-wiki.a13.info/api.php`; anonymous siteinfo
and the page both advertise CC BY-NC-SA 4.0. Preserve the content's licence,
attribution and contributor-history link, separately from MIT application code.
An editor must review the specific extracts, context and reuse basis before
publication. No wiki prose or artwork becomes application-licensed source.

The owner explicitly approved **parse5 8.0.1 (MIT)** with its sole indirect
runtime dependency **entities 8.1.0 (BSD-2-Clause)**, solely for bounded wiki HTML
extraction. This is a named exception for entities, not a general BSD exception.
Exact versions, archive hashes, npm integrity and preserved notices are recorded
in `legal/knowledge-packages.json`. Install scripts are disabled; no development
dependencies, renderer, browser, native runtime or provider SDK are selected.

Run parsing outside the interaction event loop with enforced worker termination
and memory limits. It neither executes HTML nor fetches embedded resources.
Explicit extraction retains headings, lists, qualification text, source anchors
and table relationships. Unsupported or oversized structures require review;
never silently truncate policy into apparently complete authoritative text.

Rendered bytes and template revision metadata both contribute to snapshot identity.
An unchanged page revision alone does not establish unchanged policy. Repeated
observations detect ordinary edit races, not a server-side atomic snapshot.
Collection creates review candidates only. Publication, source invalidation,
scheduled synchronization, production identities and deployment remain separate
implementation and qualification gates.
