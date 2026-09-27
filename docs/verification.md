# Verification and release limits

The pre-AI baseline at `02e0e1ffe47049347a572c27ae695d65bb55bf08` passed these checks on 27 September 2026:

- Repository validation: 442 JavaScript modules, 31 reference checksums, and eight
  asset copies; module conventions passed.
- Unit suite: 418 passed, zero failed or skipped.
- Isolated configuration suite: 13 passed, including host shutdown, interrupted
  application, permissions, and retained configuration.
- Isolated staging suite: 16 passed, including signed ingress, Gateway lifecycle,
  maintenance, public onboarding panels, and Staff closure.

Both isolated database clusters stopped after their tests. These results establish
offline behavior, not private Discord/browser acceptance or production readiness.
The source specifications describe expected behavior; they are not execution logs.

Runtime data and credentials are private and excluded from Git. Operational records,
generated tooling, and further test output belong in the operator's external
agent-documents directory, not the published repository.

Production recovery is deferred. Windows service identities, SCM startup/shutdown,
host reboot qualification, and remaining production release gates are open.
No private ticket, form, attachment, transcript, or onboarding content was inspected.

## Live staging checks

On 27 September 2026, pinned build `d4ca16ab6286a4ef186733d6829828e74d3fc176`
passed 28 public HTTPS checks: protected-page redirects, login isolation, OAuth
application/callback selection, asset hashes, anonymous API rejection, and
unsigned interaction rejection. Discord accepted the signed endpoint verification.
The public avatar matches the approved PNG byte-for-byte.

The runtime passed all 55 migration and 71 restricted-table checks. The Gateway
is current; the host and connector own their expected loopback listeners; the
host error log is empty. Existing records and authored configuration are retained.
No private content was inspected. Authenticated browser and interactive Discord
acceptance remain separate from these public and operational checks.

## Historical local AI candidate

The schema056 foundation has 37 focused unit/adapter checks and 12 isolated
PostgreSQL scenarios passing. The database fixture stopped cleanly. Synthetic browser
checks covered participation review/publication, disabled-state reporting, and
member opt-in/opt-out; the browser reported no console errors. No production data
or actual model was used. Source-bound results and the continuation are in
`GitHub/.agent_docs/aphelion-sophie`.

The schema057 runtime/knowledge milestone has 47 focused unit/adapter/auth checks,
35 isolated AI/Gateway/knowledge scenarios and 17 composed staging scenarios passing.
The AI scenarios include retained schema056 Gateway/control preservation during
upgrade. Both database clusters stopped. Synthetic browser checks covered knowledge
review, required public-source confirmation, publication, withdrawal and cleared
withdrawn text; no console warnings/errors were observed. Repository validation
checked 469 modules, 40 tasks, 60 specifications, 31 reference checksums and eight
asset copies. These checks used synthetic data and no inference.

The owner approved the pinned llama.cpp b10977/LLVM OpenMP, Bartowski Phi-4-mini
Q4_K_M and Windows Server Core trial artifacts. Runtime and model SHA-256 values
were verified, and the exact base image was pulled. The owner separately approved
Hyper-V installation without automatic reboot. Installation returned success with
restart required. No reboot was issued by the agent. The operator subsequently
restarted WUFF and instructed continuation. The serving image built and its Docker
inspection confirmed Hyper-V, network none, four CPUs, 8 GiB, ContainerUser and zero
mounts/ports. Startup exited 0xC0000135 before model load. Static PE imports and a
separate contained check confirmed absent MSVCP140/VCRUNTIME140/VCRUNTIME140_1
DLLs. All owned trial containers were removed. These observations are not a
negative-access or confidentiality qualification.

The owner subsequently approved Microsoft Visual C++ x64 14.51.36247.0 inside
the disposable worker. Installation returned zero and the three required DLL
versions/hashes were recorded. Inference then started as ContainerUser. No host
runtime installation occurred. Earlier startup evidence is historical.

Phi-4-mini Q4_K_M produced one full greeting in 12.674 seconds but did not reliably
finish the synthetic screen; two later greetings hit the 14-second cutoff.
Shortening the diagnostic prompt and increasing internal batching did not establish
a pass. Official Qwen2.5-1.5B Q4_K_M, separately approved, completed the first five
cases in 4.424–4.986 seconds but produced invalid citations and spoke in a
reaction-only turn. Per-turn output constraints fixed those structural failures.
Five subsequent cases took 3.824–5.487 seconds, but one still invented community
policy. An eight-case grounding-example experiment took 4.099–5.920 seconds and
included a false claim to grant administrator roles; that prompt experiment was
reverted. Both models are unqualified. Valid JSON does not establish truthfulness.

These were network-disabled Hyper-V model probes with four CPUs, 8 GiB, no host
mounts/ports, and synthetic prompts only. The Zen 4 CPU backend loaded. Bounded
negative-access checks found no administrator identity, host checkout, protected
System32 write, Docker pipe or TEST-NET connection. This is not comprehensive
confidentiality or representative host-load qualification. Exact token counts
matched reported prompt usage in completed probes. No real application adapter,
queue/retrieval/delivery timing or live Discord behavior was exercised by these
PowerShell probes. All owned trial containers were removed; local images remain.

The current client limits outcomes, emoji and citations to the admitted turn,
removes citation choices when their evidence is trimmed, and explicitly disables
thinking in both count and generation requests. The latter option is covered by
adapter checks and pinned runtime documentation, not by the historical model runs.
Twenty-two focused runtime/turn checks pass. Source-bound reports and raw trial
logs are in `GitHub/.agent_docs/aphelion-sophie/worker-model-verification.json` and
`worker-model-trials.md`. The owner selected continued local-only exploration.

## Historical DeepSeek Flash screen

The owner subsequently selected the official DeepSeek Flash API and supplied a
local credential file, superseding the local-only direction. Research and 29
offline adapter/runtime/turn checks preceded the first key use. The credential was
read in-process and never printed or copied into Git. No live deployment occurred.

The official models endpoint identified DeepSeek-V4.1-Flash behind `deepseek-flash`.
Twenty synthetic cases through the real JavaScript adapter completed in
0.469–1.185 seconds. Effective outputs passed agent review for supported/absent/
conflicting evidence, fabricated authority, reaction-only behavior, disabled memory,
quiet requests and hostile source instructions. This is not owner character
acceptance, the 40 reviewed knowledge questions or a full Discord timing pass.

After the owner's cache optimization request, the client uses a stable authored
prefix, canonical reviewed-source ordering before history, late per-turn JSON
instructions, and opaque cache partitions shared within each qualified public
channel. Other channels/boundaries/releases remain separate; restricted contexts
are refused. Relevance still controls evidence trimming. Silence-only requests
skip the API. Non-thinking mode, bounded input/output, independent output checks,
request deadlines, cooldowns and no automatic retries/fallback remain enforced.

An interleaved twelve-call comparison used six matching synthetic questions per
configuration across three members. Cache hits increased from 41.7% to 63.6% of
input tokens; input fell from 5,528 to 5,030 tokens and cache misses from 3,224 to
1,830. Estimated combined cost at the checked peak prices fell about 32.2%. This
small comparison measures the combined layout/partition change, not guaranteed
production savings. The handoff reported 31 focused checks for its original hashes.
The combined verification index named in the earlier handoff did not yet exist;
the original raw quality/cache reports and `deepseek-research/setup.md` did exist.
The 28 September resumption preserves those hashes and indexes them separately
from current offline evidence in
`GitHub/.agent_docs/aphelion-sophie/deepseek-verification.json`.

AI is not production-ready or live. Flash passed the initial synthetic screen;
the 15-second receipt-to-delivery ceiling remains unqualified. Provider cache may
persist beyond local context TTL. Account-specific data handling, member disclosure
and hosted-model changes remain activation inputs; no zero-retention claim is made.
Qualified worker/service/restore wiring, durable effect recovery, source sync,
explicit-memory and named restricted-domain work, source/dialogue evaluation and
applicable enabled-feature acceptance remain open. No live schema migration,
service/ACL/network change or AI activation occurred in this milestone.

## DeepSeek foundation — 28 September 2026

The owner resumed implementation with a USD 20 monthly ceiling, Europe/Vienna
calendar, no separate daily money cap, and confirmed assistant replies within the
same 12-item/five-minute temporary context. The eight source and five evidence
hashes in the handoff matched before editing; copies remain outside the repository.

The schema058 candidate adds durable fenced reservations, dispatch intent,
reported-usage settlement and conservative unresolved charges. Invalid output is
accounted for before acceptance. Operator review can resolve unknown charges at
their full reservation and clear an accounting hold with a current evidence-bound
review; neither action activates AI or replays generation. Estimates use peak rates
and a byte-based input allowance, not a proven hard invoice ceiling. New opt-ins
require a separately approved external-processing notice; local-model consent does
not authorize Flash. The price-validity default is empty, keeping paid calls paused.

Prepared turns are immutable and bounded by the complete serialized provider body.
Confirmed replies inherit conversation and knowledge expiry/dependencies. Source
events cancel active work in the affected lane; delivery races compensate known
effects. Durable post-restart Discord effect ownership remains unfinished.

Foundation evidence at `6921df9`: 51 focused preparation/runtime/turn/participation checks
and 44 isolated AI/Gateway/knowledge/accounting scenarios pass, with zero failures
or skips. The disposable PostgreSQL cluster stopped. Repository validation checks
475 JavaScript modules, 40 original tasks, 60 specifications, 31 reference checksums
and eight asset copies. Synthetic browser checks covered budget review/publication,
uncertain-charge resolution, reviewed hold clearance and unavailable remote opt-in;
no console warnings/errors appeared in the final hold-control check. Browser data
was an in-memory fixture, not a live service or database acceptance test.

The source-bound index records actual commands, logs, hashes and historical evidence
separately. No paid calls, credential reads, package/runtime installation, live
schema/service/ACL changes, Discord effects or deployment occurred in this
resumption. Node remains 24.19.0; pg remains 8.23.0. Other database suites were not
rerun merely for their current-migration count update. The full application suite,
OS identity/egress/reboot tests, paid comparisons and actual Discord timing were
not run.

This is a foundation milestone, not full selected-feature readiness. The raw Flash
client is not a qualified worker: authenticated IPC, a trusted qualification adapter,
native identity and lifecycle integration remain open. Gathering/fair concurrency,
wiki import/sync and member lookup, durable effects, explicit-memory controls,
restricted audiences, reviewed source/character acceptance and live qualification
remain in the DS/SAI tracker. Real-member processing is blocked on the exact provider
agreement/settings and approved notice. No model or release was activated.

## Member direct knowledge lookup — 28 September 2026

Public answers now includes authenticated search over the existing reviewed public
knowledge library, with exact source extracts, links, authority, revision and
attribution. It operates without an inference worker, AI control store, model opt-in
or editorial permission. Current membership and source validity are checked again
before return; queries use POST and are not added to URLs or an application archive.
The page clears results on suspension, access refresh and account changes, and
rejects malformed results or executable links.

34 focused turn/lookup/dashboard checks and 18 isolated composed staging scenarios
pass, including member lookup with AI unavailable. The test database stopped.
Repository validation checks 476 modules with the original 40 tasks, 60 specifications,
31 reference checksums and eight asset copies. Synthetic browser search displayed
literal source text and attribution, cleared prior results on an empty search, and
reported no console warnings/errors. No actual wiki data or live service was used.

The exact source/command/log record is
`GitHub/.agent_docs/aphelion-sophie/deepseek-lookup-verification.json`; the combined
index links both milestones without attributing foundation checks to later code.
No schema, dependency or live deployment changed in this lookup milestone. Actual
MediaWiki discovery/import/synchronization, approved collection/rights, Discord
`/lookup` and reviewed-source release acceptance remain open. The owner was asked
for the unresolved wiki URL, source collections and reuse permission.
