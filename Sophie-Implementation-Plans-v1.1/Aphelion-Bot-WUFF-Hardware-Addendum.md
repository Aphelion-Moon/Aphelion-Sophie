# Aphelion Bot — WUFF hardware and shared-host addendum

**Prepared:** 18 September 2026  
**Applies to:** Aphelion Bot implementation plan v1.0  
**Status:** Proposed deployment refinement, based on the supplied Speccy report. No software has been installed, no benchmark has been run, and no server settings have been changed.

## Decision

Keep the application architecture, Windows-native deployment, and initial Phi-4-mini-instruct Q4_K_M / llama.cpp CPU evaluation baseline. The supplied inventory supports proceeding to a controlled pilot without first buying additional hardware. It does not establish production AI throughput or spare CPU capacity during busy game rounds.

Treat WUFF as a **shared production game and community-services host**, not a dedicated AI server. Protect the games and human administration before optimising AI throughput. AI remains completely excluded from all tickets, including The Shuttle, and all ticket-derived data.

This addendum records the previously missing hardware snapshot and proposes changes to discovery, inference settings, placement, and acceptance tests. It does not approve unresolved licensing, storage-engine, privacy, retention, or production-access decisions. Original plan files are unchanged.

## 1. Evidence supplied by the host report

The values below are reported observations, not measurements independently taken by this assessment. RAM availability, process usage and disk space are point-in-time values.

| Item | Reported observation | Planning consequence |
|---|---|---|
| Operating system | Windows Server 2022 Standard 64-bit | Retain the native service target. [H1] |
| Processor | AMD Ryzen 7 9800X3D; 8 cores / 16 threads | Establish a bounded CPU budget; do not allocate all logical processors to inference. [H2] |
| Memory | 62 GB total physical; 36 GB available; reported usage 40% | Sufficient reported headroom for a controlled small-model pilot, not a permanent reservation. [H3] |
| Storage | Two Samsung 990 PRO 1 TB SSDs; C: approximately 550 GB free; D: approximately 897 GB free; RAID reported as none | Use a separate approved D: application-data root; verify topology and keep off-host backups. [H4] |
| Graphics | ASPEED and ATI devices using Microsoft Basic Display Adapter | No validated AI accelerator is established by this inventory. Keep CPU-only execution. [H5] |
| Concurrent games | BYOND dd.exe around 2.02 GB; Robust.Server.exe around 6.05 GB | Test AI alongside both game workloads. Working-set figures do not establish their CPU demand. [H6] |
| Existing services | Wiki web service, MariaDB, SS14 PostgreSQL, Cloudflared, Docker Engine, WSL and other community services | Inventory ownership, ports, versions, credentials, backup schedules and resource limits before introducing new services. [H7] |
| Scheduled automation | Wiki Discord outbox, wiki authorisation sync, MediaWiki jobs, search reconciliation/Typesense task and backups | Inspect integration opportunities and avoid duplicate writers or overlapping heavy jobs. Task names do not prove API availability or correctness. [H8] |
| Port conflict | An existing listener on 0.0.0.0:8080 | Do not use an unmodified llama-server default port. Select and validate a different loopback port. [H9; W2] |

Do not sum process working sets to estimate a guaranteed free-memory budget. Preserve the report's own physical-memory figures and supplement them with representative-load measurements.

## 2. Proposed initial inference profile

These settings are starting hypotheses for testing, not production guarantees or instructions already applied to the server.

| Setting | Initial proposal |
|---|---|
| Model | Retain Phi-4-mini-instruct Q4_K_M GGUF, pinned publisher/revision/hash/chat template |
| Runtime | Pinned, licence-reviewed CPU build of llama.cpp; no GPU offload |
| Active generations | 1 |
| Waiting requests | Reduce the plan's initial maximum from 8 to **3**; no more than one outstanding request per member |
| Lifetime | Retain a proposed **120 seconds measured from enqueue**, including waiting; discard expired work before starting generation |
| Context | 4,096 tokens for the complete request and output budget |
| Maximum output | 512 tokens; reduce after usability measurement if appropriate |
| Generation threads | Start at 4 |
| Prompt-processing threads | Start at 4; configure separately rather than relying on auto-detection |
| Process scheduling | Windows Below Normal for inference; retain normal scheduling for core administration |
| Memory | Approximately 8 GB of inference planning allowance; measure actual process/host peaks rather than treating this as a proven footprint or an automatic hard-kill threshold |
| Host memory safeguard | Proposed admission floor: pause new AI work when available physical memory remains below 12 GB; use sustained samples and a higher recovery threshold to prevent flapping |
| Heavy background work | One bulk source/index job at a time; pause bulk indexing during inference, busy-game conditions, builds and backup windows where measurements justify it |
| Network | Dedicated verified loopback port and service authentication; no public model endpoint |
| Fallback | Direct authorised lookup or an unavailable/busy message; no cloud inference or cloud embeddings |

llama.cpp documents distinct generation and prompt-processing thread settings, context/output limits and affinity controls. Windows defines Below Normal scheduling. These are controls to test, not evidence of a reserved set of cores or guaranteed noninterference. [W2; W3]

Four software threads do not reserve four physical cores. Lower priority does not isolate memory bandwidth or storage traffic. Add CPU placement or rate controls only if measurement demonstrates a need, after verifying the actual logical-to-physical topology and all runtime worker pools. Do not change the game processes' affinity, priority, or configuration as an incidental bot deployment step.

AMD lists AVX2, AVX512 and AMD-V for the 9800X3D. Verify what the actual OS/runtime can use, then compare compatible CPU builds; do not force an instruction set merely because a model download example uses it. The report's incomplete instruction/virtualisation fields are not a sufficient reason to disable capabilities or change firmware. [H2; W1]

The chosen quantisation publisher lists Q4_K_M at about 2.49 GB. Runtime memory also needs to be measured; that download size is not the full process footprint. More available RAM alone does not justify changing the model, increasing context, or increasing concurrency. [W4]

## 3. Shared-host acceptance gate

Extend **T33 — Host contention and queue** beyond protecting the bot's own administration. The release must also respect the existing games and shared services.

Record an AI-disabled baseline and compare it with one AI request, a full bounded queue, cancellation, and a representative source update. Use comparable game workload conditions and repeat runs to distinguish background variation from a bot-induced change.

Measure game tick/update latency and relevant game-side load indicators, per-core CPU activity, bot administrative latency, wiki/search response time, available physical memory, paging pressure, storage latency, model first-token/full-response latency, and queue age. Aggregate host CPU utilisation alone is not the release criterion.

Start the model tests at 2 and 4 inference threads; test 6 only when the earlier profile meets the game-performance budget. Include prompt processing as well as generation. llama-bench can support model/thread experiments, but it does not replace the end-to-end shared-host test. [W5]

The owner/operator must approve a measured performance budget and baseline variation before AI activation. Existing game service objectives take precedence. When that budget is exceeded, stop admitting AI work and, where safe, cancel active generation. Do not stop or restart game services to make AI benchmarks pass.

A busy/disabled model must leave tickets, The Shuttle, membership operations and direct lookup functional. Failed or stale workload telemetry should conservatively prevent automatic AI admission, not fail the core application.

No tokens-per-second estimate, sustained concurrency promise, or production-readiness claim is established by this report.

## 4. Placement and integration refinements

### Data placement

Retain immutable releases and protected configuration where the deployment policy requires them. Propose **D:\AphelionBot\** as the data root, subject to operator approval and filesystem ACL tests. Use separate protected subdirectories for case artifacts, knowledge snapshots, models and bounded logs. The inference identity reads only model artifacts and its own minimal configuration; it cannot read case data or connector secrets.

Do not assume D: is otherwise idle: the report places existing wiki components there. Do not assume the two disks are a verified mirror. A local copy on another disk is not the off-host backup required by the plan. Preserve database-consistent backups, deletion/revocation ledgers and restore testing. [H4; H10]

### Existing services

Inspect the current wiki authorisation/outbox and search tasks before creating a second ingestion or notification path. Keep MediaWiki as the authoritative initial content source. Existing search infrastructure is a **candidate for approved read-only API integration**, not automatic permission to reuse its code, query unrestricted indexes, or import case data.

The report shows both MariaDB and an SS14 PostgreSQL service. Their presence does not approve either as the bot database, establish version compatibility, or authorise new access to game/wiki schemas. Preserve the MIT and infrastructure-licensing gate. After an explicit decision, use separate principals and dedicated bot storage boundaries; never hand existing service administrator credentials to the bot.

Retain native Windows deployment. The presence of WSL or Docker Engine does not establish Docker Desktop support, require a Linux deployment, or authorise changing the resources of existing containers/distributions.

Reuse only approved TLS/tunnel infrastructure. Check current listeners and Windows reserved port ranges before assigning the dashboard and inference ports. Do not terminate a conflicting process or repurpose its port. Port 8080 is already occupied in the supplied report. [H7–H9]

Coordinate new indexing/backup schedules with the existing jobs. Verify task timezone, last success, destination, retention and ownership; task names alone are not evidence of a working off-host backup. [H8]

## 5. Dashboard and deployment-control additions

Add separate status indicators for AI readiness, host-budget pauses, queue depth/oldest age, inference memory, and the selected thread profile. Preserve an independent AI disable switch and a maintenance pause for heavy knowledge imports.

Read workload health through a narrow local metrics interface; do not grant the model a shell, full process-control privileges, production game credentials, or unrestricted telemetry. Only the administrative control plane can approve resource-setting changes. Audit those changes without storing raw prompts or ticket content.

Preflight must reject a conflicting port, a missing approved data root, weak case-directory ACLs, unapproved dependencies, absent secret separation, or an unavailable telemetry/benchmark prerequisite for AI activation. The installer must not rewrite existing game, wiki, database, WSL, tunnel or firewall configuration implicitly.

## 6. Amend the existing task and test definitions

| Plan target | Amendment |
|---|---|
| README / requirements discovery | Mark the host model, reported RAM and disk snapshot as supplied. Keep sustained-load evidence, security verification, licensing and storage approval open. |
| P02 — Inventory and baseline Windows host | Attach a sanitised hardware summary; verify shared workload ownership, current ports, account boundaries, storage topology and schedule collisions. Do not attach the raw report to a repository. |
| P23 — Provision and benchmark local model | Use the starting profile above and run comparable game-loaded tests. Keep the existing model-lock and local-only hardening work. |
| P25 — AI controls and evaluation tooling | Add host-budget pause/recovery, queue-age visibility, bounded thread configuration and overload fallback. |
| P28 — Knowledge/AI isolation, quality and load suite | Require both game workloads and shared-service health in the load evidence. Preserve zero-ticket-data tests. |
| T33 — Host contention and queue | Pass only when the approved shared-host performance budget, queue bounds and cancellation behaviour hold. |
| T34 — AI outage independence | Retain unchanged; additionally exercise an automatic host-budget pause. |
| T37 — Preflight and secrets | Include the known default-port collision, approved D: root, and rejection of sensitive host-dump material in sample configuration or repository artifacts. |
| T38 — Native service reboot | Confirm bot recovery does not create duplicate workers or alter existing services. |
| T39 — Restore | Use a separate, delivery-disabled target; prove case ACLs and deletion/revocation replay remain effective with the chosen data root. |

## 7. Inventory limitations and safe handling

The report says both "Antivirus Disabled" and "Windows Defender Enabled", and also lists Defender services. Do not interpret that as a verified absence or presence of real-time protection. Add a read-only Get-MpComputerStatus check for the operator; the command reports protection status. No security setting should be changed from this inventory alone. [H11; W6]

The report labels the system Virtual while also showing physical-looking device details, Hyper-V/WSL activity and inconsistent virtualisation capability reporting. Verify topology and available CPU features in the deployment environment rather than assuming bare metal, a guest VM, or nested virtualisation. [H1; H2; H7]

The raw diagnostic export contains licence/serial information, account identifiers and host/network details. Keep it private and outside the repository, bot knowledge sources and model context. The addendum intentionally does not reproduce those identifiers. No claim is made that credentials were compromised.

## Source ledger

### Supplied sources

**H1:** WUFF.txt, OS section, lines 23–26.  
**H2:** WUFF.txt, CPU section, lines 2361–2382.  
**H3:** WUFF.txt, physical memory, lines 2436–2441.  
**H4:** WUFF.txt, storage and volume sections, lines 2507–2547.  
**H5:** WUFF.txt, graphics section, lines 2487–2506.  
**H6:** WUFF.txt, dd.exe lines 825–831 and Robust.Server.exe lines 1363–1369.  
**H7:** WUFF.txt, services lines 112–204; WSL processes lines 2109–2150.  
**H8:** WUFF.txt, scheduled tasks, lines 372–383.  
**H9:** WUFF.txt, TCP listeners, lines 3051–3054.  
**H10:** WUFF.txt, wiki web processes, lines 1021–1034.  
**H11:** WUFF.txt, security summaries lines 28–36 and Defender services lines 150–152.  
**P1:** Aphelion-Bot-Master-Plan.md v1.0, requirements/G0, local-model settings, Windows operations, P02/P23/P25/P28, and T33–T39. Read to compare the proposed changes; no original source was edited.

### External verification, accessed 18 September 2026

**W1:** [AMD Ryzen 7 9800X3D specifications](https://www.amd.com/en/products/processors/desktops/ryzen/9000-series/amd-ryzen-7-9800x3d.html) — architecture and listed instruction extensions, not a host benchmark.  
**W2:** [llama.cpp server documentation](https://github.com/ggml-org/llama.cpp/blob/master/tools/server/README.md) — runtime controls and default listener. Pin a release before translating these into commands.  
**W3:** [Microsoft Windows scheduling priorities](https://learn.microsoft.com/en-us/windows/win32/procthread/scheduling-priorities) — process/thread priority behaviour.  
**W4:** [Phi-4-mini-instruct GGUF publisher](https://huggingface.co/unsloth/Phi-4-mini-instruct-GGUF) and [original Microsoft model](https://huggingface.co/microsoft/Phi-4-mini-instruct) — artifact sizes, model identity and licence evidence; not local throughput.  
**W5:** [llama-bench documentation](https://github.com/ggml-org/llama.cpp/blob/master/tools/llama-bench/README.md) — model, prompt-processing and thread-count testing.  
**W6:** [Microsoft Get-MpComputerStatus](https://learn.microsoft.com/en-us/powershell/module/defender/get-mpcomputerstatus) — read-only antimalware status query.

All numeric operating thresholds in this addendum are proposed test inputs. Only the host facts expressly attributed to WUFF.txt are source-reported observations. No source establishes that this deployment has passed acceptance.
