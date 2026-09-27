# Private attachment acquisition

Scope: P06/P10–P12/P19; partial T10/T11/T12/T16/T22/T23/T33/T35/T36/T57.
This component retains bounded file copies from observed case attachments in a
private core vault. It provides no file download, inline preview, transcript
endpoint, scanner, archive expansion or AI handoff. All copies are unscanned and
quarantined. Production limits, access policy and Windows ACLs are still gates.

## Explicit policy and source boundary

`createCaseAttachments` receives a narrow current-policy reader and activation
check. No policy or a disabled composition leaves reference jobs pending and
performs no network or file write. Policy requires an approval reference,
file/count/storage bounds, a total request deadline, a type allowlist,
indefinite retention and unscanned quarantine. Synthetic test approval labels
are not operator approval. Runtime composition must read the actual current
configuration; a cached policy snapshot cannot stand in for that callback.

The implementation bounds are at most 32 MiB per file, twenty references per
message observation, 1 TiB of accounted reservations and a 1–30 second request
deadline. These are configurable development ceilings, not chosen production
values. Policy may allow PNG, JPEG and UTF-8 text with matching filename
extensions. Empty files, active formats, archives and unknown types are currently
unavailable. Signature/text checks reject obvious mismatches; they do not parse
images, detect polyglots, prove safety or replace malware scanning.

Only the observed attachment's `url` can be used. It must be an HTTPS
`cdn.discordapp.com/attachments/{channel}/{attachment}/{filename}` path with both
IDs matching the retained reference. Optional signing parameters are limited to
`ex`, `is` and `hm`. Arbitrary message links, embeds, proxy URLs, credentials,
ports, fragments, path escapes and redirect parameters are rejected before I/O.
The connection uses one validated public IPv4 DNS result, ordinary TLS hostname
verification, no cookies/token and no redirects. The narrow core adapter takes
native HTTPS and DNS functions explicitly; no network service is activated here.

Discord describes [signed attachment URLs and their expiry](https://docs.discord.com/developers/reference#signed-attachment-cdn-urls).
References may expire or become inaccessible before capture. No generic URL
refresher or history fetcher is added; a later observed attachment is a new
reference. Unavailable files remain visible as failed capture records.

Responses must have the expected media type, no non-identity content encoding,
and a matching Content-Length if supplied. The actual streamed size must match
the observed size. Bytes are checked while streaming, and the deadline remains
active through response consumption. Failures expose stable codes only, never
the original network error, signed URL or file body.

## Durable intent, capacity and recovery

Migration 030 adds core-only attachment jobs, attempt records and vault capacity.
Each observed attachment ordinal queues a reference job in the same transaction
as the message observation and Gateway cursor. Backfill queues prior references
without inventing a file copy. Metadata jobs contain source identifiers only;
the worker retrieves the reference from the separate retained conversation.
Partial edits that omit attachments and later message deletion do not remove
jobs or files. Another observation with attachments keeps a separate reference;
there is no cross-message content deduplication claim.

Claims have fences and a 60-second lease. Each attempt reserves the entire
declared file size before network I/O; competing workers update the same vault
counter atomically. At most three attempts can allocate slots per reference.
Policy and lease are rechecked at acquisition and retention boundaries. The
attempt pins a policy hash, policy data and source hash. A changed policy cannot
silently mark an old in-flight request as authorized retention.

A valid numeric CDN Retry-After persists a pause shared by the vault's workers,
including when the reporting lease expires before its response. Claims and the
last pre-request check respect it. An unreadable or excessive rate limit durably
pauses all acquisition for that vault until operator review. Failure to persist a known
pause suspends that worker for review. This acquisition pause is independent of
Discord role/message delivery; neither worker clears the other's barrier.

The vault uses generated 48-hex slot names, never supplied filenames or paths.
Writes use an exclusive temporary file, incremental validation/SHA-256, a file
sync and an exclusive hard link to publish the completed blob. A late writer
cannot overwrite a completed slot. Node documents the platform-dependent
guarantees of [file sync](https://nodejs.org/docs/latest-v24.x/api/fs.html#filehandlesync);
this is not evidence of power-loss or filesystem restoration safety on this host.

Successful retention requires an opaque process-local file proof bound to the
reserved job/slot, size, type and source. A recreated worker can hash and inspect
a completed earlier slot, then finish the database transition without another
download or reservation. A lost COMMIT acknowledgement checks retained status.
Expired workers cannot commit through an old fence. Partial or corrupt slots
cannot become successful captures by name alone.

Capacity accounting is deliberately conservative: reservations for failed,
partial, uncertain and unselected late slots are retained. Completed blobs are
never automatically deleted. A normal failed write cleans up only the temporary
file it created; a process crash may leave a temporary slot behind. Operator
inventory and single-reference hash verification now have a
[read-only staging tool](attachment-operations.md). Safe orphan reconciliation,
capacity alerts and repair/requeue controls remain open. Moving the vault or restoring the database independently
requires reconciliation and the independent restore watermark; do not simply
reset the counter or point an old database at a new directory.

## Permissions and acceptance limits

Files live outside web-public assets and knowledge storage. The application
exposes no artifact read/download method or public bearer link. Future downloads
must validate current case/child audiences, approved export policy and the saved
hash, and enforce attachment disposition without inline active content. A job
token or filesystem slot is not authorization. OS ACLs must exclude knowledge,
inference and web-public service identities; JavaScript path checks and file modes
are not proof of Windows account isolation.

Retention does not expire on closure, member departure, message deletion or age.
Core table DELETE and knowledge schema access are denied in synthetic tests.
URLs, filenames and bytes never enter the Discord outbox, receipt metadata,
Gateway lifecycle metadata or knowledge/inference storage.

Six contract checks exercise bounded configuration, CDN identity/DNS, response
boundaries, slot integrity and content rejection. CA01–CA23 exercise actual
synthetic PostgreSQL and local files, including races, rollback, lost acknowledgements,
policy changes, capacity, migration preservation and native loopback HTTP with
a deadline and durable rate-limit handling. S38 checks two isolated database
restarts with the same synthetic vault, retained cooldown/pause and a fresh adapter.
Actual full-run results are in [verification](verification.md).
These do not test live CDN/TLS, production limits, Windows service ACLs, an
independent filesystem restore, malware scanning or artifact downloads.

Rollback: stop acquisition before reverting its composition. Preserve migration
030, reference/attempt/capacity records, quarantined files and prior observations.
Do not delete slots, lower recorded usage or claim pending references were archived.
Dependencies, licences, production services and original reference/assets are unchanged.
