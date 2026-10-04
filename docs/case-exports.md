# Confirmed transcript exports

Scope: P06/P12/P19; partial T07/T10/T12/T22/T35/T36/T57. The shared core export
service and dashboard POST routes generate bounded parts of one selected-channel
ledger under an explicit policy. The owner approved **all currently authorized
readers, including members**, on 20 September 2026. The staging host now composes
these routes using its explicit export policy. This does not implement attachment
downloads, Staff-note exports, form-answer exports or a full multi-channel archive.

Review reuses the transcript reader's current case/opener/invitation and child
authorization. A separate policy selects eligible responders only or all current
readers; a disabled policy refuses before reading content. The implementation
ceilings are 100 observations, 200 capture gaps and 2 MiB **per part**, with smaller
configured limits allowed. Larger counts produce a continuation, which requires
another explicit review and confirmation. A part exceeding the byte limit still
fails explicitly; content is never cut to fit. These ceilings are implementation bounds, not approved production
retention or capacity settings. Retained data has no automatic expiry.

On 4 October 2026 the owner delegated larger-export scope. The selected local
implementation uses sequential single-channel parts. It introduces no migration,
grant, dependency, attachment download or multi-channel aggregation. Installed
staging remains pinned to `335a3f2`/schema069; these later export changes are not deployed.

Review returns hashes, counts, bytes, channel scope and exclusions, without body
content. Confirmation binds the exact content, policy version/hash, requesting
actor, exact input cursors, continuation and current case/audience snapshot.
Changes to this part's content, coverage, attachment status, continuation, audience
or policy require another review. Confirmation is an
explicit POST with a random request ID and reviewed hash. Current access is checked
again after committing the generation audit and before HTTP delivery; losing access
suppresses bytes even if the earlier generation attempt was recorded.

The two cursors advance independently but are returned as one continuation pair.
When one stream is exhausted, retain its last position while advancing the other;
do not reset it to `null`. For an unchanged ledger, following each returned pair
visits every retained observation and gap once. These are live views, not a frozen
snapshot across requests. Gap tokens sort lexically, so new gaps may sort before
an earlier position, and existing intervals may change between parts. Restart
from the beginning for a new view after changes; no part claims complete history.

The HTML artifact contains only escaped observations, inert embed/component text,
capture gaps and attachment status. It has no executable retained markup, external
styles/scripts/media or link URLs extracted from metadata. Its embedded CSP denies
external resources. It always labels history as partial and excludes other channels,
Staff notes, form answers and actual file bytes. Exporting a root never silently
aggregates child threads; each selected child requires its own current access.

## HTTP contract

- `POST /api/cases/export/review`: exact JSON fields `caseToken`, `channelId`,
  `after`, `gapsAfter`. Both cursors are required and nullable; use `null` to start.
- `POST /api/cases/export/download`: those fields plus `requestId`, `reviewHash`
  and `confirmed: true`.

Review echoes the cursor pair and returns `continuation: { after, gapsAfter }`
when more records remain, otherwise `null`. Cursors select positions only and are
bound to the case and channel; they grant no access. Each confirmed part uses a
new request ID. A lost response retries exactly the same cursor pair, request ID
and review hash. The client must not advance while that download remains uncertain.

Both require the existing authenticated session, exact Origin and CSRF token;
there are no query parameters, bearer artifact links or public GET downloads.
The listener returns a successful download as an attachment with a fixed-ID-only
filename including the review hash, UTF-8 HTML, byte length, no-store, nosniff and
sandbox/default-deny CSP. Distinct reviewed parts receive distinct filenames.
Denied/invalid/stale requests return the existing fixed JSON errors without content.
The [case browser](case-browser.md) provides review and explicit confirmation;
other compositions must explicitly supply the optional adapter and approved policy. The staging template uses the approved
current-reader audience with version 1 and the bounded implementation ceilings.

## Audit and failure semantics

Migration 031 adds policy-hash bindings and generation-attempt metadata: actor,
case/channel, request/review/content hashes, version, counts, byte size and time.
Each row now records one reviewed part; its review hash binds the cursor scope.
It does not copy message bodies or create a reusable download credential. Policy
versions cannot be rebound to different settings. Exact retries reuse one record;
a conflicting actor or review cannot replace it. A retry still reauthorizes and
rebuilds current bytes; if the source changed, the previous request cannot be used
to obtain an old snapshot. A fresh review and request are required.

Audit failure prevents delivery. A committed audit is **not** proof that the client
received the file. A lost commit acknowledgement can be retried with the same ID;
current authorization and source checks still apply. No Discord request occurs
while the audit transaction holds locks. Audits are independently retained and
have no cascading case foreign key or automatic deletion. Core lacks DELETE and
TRUNCATE; knowledge has no core access.

## Evidence and remaining gates

Current local pagination evidence: 16 focused unit checks, TR01–TR12 and EX01–EX10
pass, including 105 observations, both stream-exhaustion orders, per-part byte
failure, stale and cross-scope cursors, exact retries/collisions, current child and
member access, post-audit revocation, and account switching during a download.
Synthetic browser checks exercise unchecked confirmation, an uncertain response,
exact retry, next-part review and final handoff. A saved-file receipt and private
Discord/client acceptance are not claimed. Source-bound evidence:
`GitHub/.agent_docs/aphelion-sophie/paged-exports-2026-10-04/verification.json`.

Historical initial export evidence:
TR01–TR11 and EX01–EX08 pass with synthetic records on the isolated PostgreSQL
cluster; it stopped successfully. Tests include responder/member separation,
disabled policy before content reads, exact confirmation/retry, stale content and
audiences, child revocation, logout/role loss after audit, bounds, immutable policy
versions, rollback/collision, native loopback download/CSRF/headers and database
privileges/idempotent migrations. See [the scoped report](evidence/exports-verification.json).
This is not live browser/TLS, off-host restoration or completed G2 acceptance.

Remaining: live browser workflow acceptance, approved file-download policy,
multi-channel/frozen-archive design, controlled hash-verified attachment
downloads, operator artifact repair, live checks and independent recovery. Do not
weaken bounds or current authorization to export an oversized/unavailable case.

Rollback: stop/omit the optional export adapter before reverting backend and
dashboard files together. Existing review hashes must be reviewed again after
either version change. Retain migration 031, policies and generation audit; do not
perform a destructive down migration or erase a request to bypass a conflict.
No production database or Discord resource was changed.
