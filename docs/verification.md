# Verification and release limits

## Relay source checkpoint — 28 September 2026

Implemented the local relay session primitive, v2 distinct role/boot identity profiles, private/public pipe mapping, exact data-pipe owner/DACL checks, keyless relay entrypoints and supervisor readiness/physical-close seams. Installed supervisor refuses a missing relay controller. The final per-boot controller is not implemented; no installed activation is claimed.

Pinned Framework/C# build passed. Five native transport groups passed (both-purpose 1 MiB duplex/final drain, role/boot and capacity denial, backpressure stop, abnormal disconnect and exact owned helper loss). Native malformed-frame/profile checks and JS owner/secret-field rejection passed. Nine focused supervisor/control tests passed; after cancellation propagation changed, C23/C24 both passed, and six focused shutdown checks passed after ordering relay closure before worker removal. Repository checker passed 561 modules. An initial test assertion used the wrong status shape; it was corrected to inspect the actual journal and the failure log retained.

The native relay forwards the existing transport envelope without application parsing or secrets. It verifies a private descriptor through a disposable READ_CONTROL connection before announcing its listener, rechecks the data handle, and retains both handles until pending I/O drains. The tested primitive handles one connection; it does not settle the pending repeated-session contract. Synthetic tests under the local identity do not qualify distinct installed relay accounts or HCS. Existing supervisor control-pipe descriptors are preserved; exact owner/one-peer descriptors apply to data pipes. No services/accounts, shared ACLs, firewall, containers, provider or Discord operation occurred. No application/database full suite or guest build ran. See `GitHub/.agent_docs/aphelion-sophie/windows-relay/implementation.md` and `relay-source-verification.json`.

Resolve the pending owner choice: allow fully drained graceful connections within the same boot (recommended to match existing worker probe/reply behavior), or require a new boot after each completed connection. Unexpected disconnects must revoke the boot either way. Then implement separately authenticated per-boot arm records (never supervisor rewrites of static owner profiles), the concrete relay controller, source/package integration and focused composition evidence; prepare exact service/account/ACL/network/lifecycle changes for separate operational approval. Existing HCS failures, provider/account clearance and other Test Discord Server AI gates remain open. Full workplan and AI test-server readiness remain false.

## Completed HCS rights matrix — 28 September 2026

Completed the approved replacement HCS observation on core and egress. All ten forbidden opens succeeded with corresponding guest handle rights, so the direct transport remains unqualified. Prepared an explicit per-purpose relay transport decision; no application or installed permission change.

Each pipe passed five fresh exact-data-rights/descriptor/echo checks. Actual host owner/DACL and restricted-outsider controls passed; owner/DACL bytes remained unchanged after all connections. Guest/container exit 2 records the failed acceptance checks. Container removed, observed vmwp PID absent, services Manual/stopped with zero exit codes, XML/permissions restored and no owned processes/containers remain.

Both endpoints reported WRITE_DAC 0x00140080, WRITE_OWNER 0x00180080, DELETE 0x00110080, CREATE_PIPE_INSTANCE 0x00100084 and generic-write 0x00120196 on accepted guest handles. Normal data handles were exactly 0x00120183. No guest management operation was attempted; these masks do not establish host authority or an effective opener. The associated vmwp primary identity is unqualified. See `GitHub/.agent_docs/aphelion-sophie/windows-hcs-trial/access-retry/result.md` and `hcs-handle-matrix-verification.json`. Guest compilation and runtime were measured; no application/database suite, provider request or Discord activation occurred.

Review GitHub/.agent_docs/aphelion-sophie/windows-hcs-trial/transport-decision.md to select separate per-purpose untrusted relays for local implementation. Do not repeat the same direct-HCS matrix or qualify a proxy SID from guest masks/associated primary tokens. Replacement architecture and its new public/private contract require the owner decision; installation and operational qualification remain separate. Provider/account, protected mounts, termination/recovery, installed composition, publication/actual answers, preference/restricted-context and Test Discord Server activation gates remain open. AI test-server readiness remains false.

## HCS observation stopped before start — 28 September 2026

Executed the approved one-container HCS handle-rights attempt. Host service identity/owner/DACL and restricted-outsider controls passed; the runner rejected container configuration before guest start. Preserved the failure and prepared a corrected replacement runner.

Docker records create/destroy only. All three services are Manual/stopped with zero exit codes, XML and permissions restored, and no owned processes/containers remain. The absent ExposedPorts guard defect reproduces offline; corrected exposure and approval controls pass. The current rejected inspect was not saved. All guest requested/granted measurements are unrun; the earlier forbidden-open failure remains failed.

See `GitHub/.agent_docs/aphelion-sophie/windows-hcs-trial/access-observation/result.md` and `hcs-handle-observation-verification.json`. No guest runtime, paid provider call, application/database suite or Discord activation occurred. The corrected runner captures inspect before validation and distinguishes missing/empty port maps from exposed ports. Native probe sources/binaries and production code are unchanged.

Authorize one replacement observation using GitHub/.agent_docs/aphelion-sophie/windows-hcs-trial/access-retry-review/proposal.md; the prior one-container limit is consumed and no retry ran. Retain the transport gate until evidence supports an explicit decision. Provider/account clearance, protected mounts, termination/recovery, installed composition, publication/actual-answer review, preference/restricted-context gates and exact Test Discord Server activation remain open. Test-server AI readiness remains false.

## Test Discord Server AI preparation — 28 September 2026

Owner selected the Test Discord Server with AI included. Prepared an original external read-only NtQueryObject handle-rights probe and a bounded one-container observation package; no application or deployment change.

Pinned host compilation with warnings as errors passes. Local fresh-pipe controls report data access 0x00120183 and owner-authorized WRITE_DAC access 0x00140080. Initial exact-mask assumption failure is retained; corrected control permits only synchronization/read-attributes additions and still distinguishes management rights. New guest/container run is unexecuted; prior HCS forbidden-open failure remains unchanged. Current public provider terms do not establish actual account clearance.

The application requests explicit data rights and verifies a role/proxy DACL; literal forbidden-open rejection is also a recorded operational gate. The new probe observes granted rights without changing that gate or attempting guest management operations. A guest handle mask would not establish host authority or the effective opener. Public HCS/VSMB documentation supports investigating the separate layers, not asserting their measured behavior. See `GitHub/.agent_docs/aphelion-sophie/windows-hcs-trial/access-review/review.md` and `hcs-handle-preparation-verification.json`. No application/database suite, new service/container run, paid provider call or Discord deployment occurred.

Review GitHub/.agent_docs/aphelion-sophie/windows-hcs-trial/access-review/proposal.md for one additional observational container and permission to collect the remaining mask observations while recording all failed open checks. The prior amendment stop condition is not waived. Resolve the transport contract from evidence; no production proxy identity or qualification receipt yet. Provider/account evidence, protected mounts, termination/recovery, installed composition, approved publication/actual answers, preference/restricted-context gates and the exact Test Discord Server deployment remain open. Test-server AI readiness and production readiness remain false.

## Actual-owner HCS diagnostic stops at forbidden-open gate — 28 September 2026

Executed the approved external HCS diagnostic with actual core/egress virtual-account pipe creators and a protected role-owner-full/VM-group-data descriptor. Application source, installed profiles and permissions are unchanged. Source and host/guest executable hashes recorded before probe execution.

Both host role owners/DACLs, Node/native service identities and first-instance guards pass. Separate supervisor restricted-token outsider checks deny data, all forbidden masks and extra server creation. Guest core owner/DACL projection and eight-byte echo pass. A subsequent WRITE_DAC open returns a valid handle on a fresh connection; the one permitted identical-DACL reapply returns Access Denied (5). Host owner/DACL bytes remain unchanged. The trial stops; later guest masks, guest egress/extra-instance checks and the conditional second container are not run. Container/proxy removed; all services exit zero and remain Manual/stopped; XML and permission snapshots restored/unchanged.

The narrower external descriptor names the actual corresponding service as object owner, with only owner full access and S-1-5-83-0 data access. The VM group remains a diagnostic candidate, not an approved production proxy identity. The separate supervisor observed vmwp.exe PID 14000 / creation 134350904234206303 and its VM-specific primary SID, not the effective opening token. The guest WRITE_DAC request used a fresh host connection after the baseline echo; its single SetSecurityInfo request reapplied only the already verified exact DACL and returned 5. No owner or ACE change was requested. Host owner/DACL bytes were unchanged afterward. Neither accepted open alone nor this one operation denial establishes all guest rights or final containment.

Source-bound report: `GitHub/.agent_docs/aphelion-sophie/windows-hcs-narrow-verification.json`; readable result and raw logs: `windows-hcs-trial/narrow/result.md`. Host Framework compilation passed with warnings as errors; the exact pinned guest toolchain compiled the driver and printed its binary hash before launch. The runner deliberately failed HCS_GUEST_BOUNDARY_FAILED; no failed assertion was waived. No broad application/database tests, final installed application, real provider or Discord run occurred. Existing application/worker bytes remain bound to 8c8cbfd. The original amendment stays immutable; `legal/windows-hcs-diagnostic.json` records approval.

HCS isolation remains unqualified because the existing guest forbidden-open gate still fails, despite the separately measured descriptor-write denial. Resolve the Windows/HCS transport contract before proposing further operational diagnostics or application changes; do not weaken assertions, broaden grants, substitute authentication or create an owner receipt. The approved stop condition has been reached and the conditional second-container gate was not met. Installed composition, guest mounts/credentials, worker physical termination/uncertain-create, provider/account, publication/actual-answer, preference-journal and Discord gates remain open. Field-test and production readiness remain false.

## Patched wrapper passes; HCS forbidden-open gate — 28 September 2026

Owner-approved private WinSW 2.12.0 rebuild changes only the clean-exit SCM open to Connect. Pinned SDK/runtime/packages and required NET461 build metadata used; warnings/analyzers retained. Derived wrapper 9dba15b5cc15f9f51190bc8d35bfeb3f870276fdb53902d1cb7b95dc502f603f installed in the three owned services with unchanged identities and ACLs. Application source and installed guards are unchanged.

All three actual service diagnostics pass identity, protected-marker and pipe creation/close checks, companion drained stop and clean SCM exit. Core/egress deny cross-role, provider, bootstrap and supervisor-state reads. Child exit 7 is preserved; operator stop delivers SIGINT and exits cleanly. Host file fixtures verify held write/rename denial, post-close rename, reparse/owner/inheritance/writable-DACL rejection, and bootstrap unlink with a retained snapshot. A Hyper-V diagnostic preserves both exact pipe DACLs and echoes with 0x00120183/anonymous SQOS. A second probe accepts its first forbidden WRITE_DAC open and stops; no descriptor mutation was attempted. Both containers removed; three services Manual/stopped.

The first HCS server was the trusted supervisor using the exact core/egress DACL entries. It was a native diagnostic, not the final worker or application entrypoint. The guest was S-1-5-93-2-2; both observed vmwp.exe primary tokens included S-1-5-83-0, while their S-1-5-83-1-* primary SIDs differed. Those are associated-process observations, not effective-open-token evidence. The second probe stopped immediately after a valid WRITE_DAC handle was returned. It did not attempt SetSecurityInfo, later masks or an extra server instance. Exact DACL text and byte exchange are insufficient to qualify access isolation. The unused second listener timed out during bounded cleanup.

Build preparation corrected NET461 trimming metadata, explicit private restore configuration and the package-root separator. No analyzer/assertion was disabled; resolved archives matched the seven approved package hashes. Fixture setup initially hit the owner-setting privilege limit; the eventual wrong-owner check used a file actually created by the core service, then moved into the dedicated protected fixture. Its protected read-only descriptor retained core ownership and was rejected. Test-only descriptor restoration and directory sharing-error expectations were corrected; final fixture descriptors and service XML were verified.

Reports: `GitHub/.agent_docs/aphelion-sophie/windows-wrapper-verification.json` and `windows-hcs-verification.json`. HCS source/compiler inputs and outputs are retained; probe guest binary hashes were not exported, so no final executable/image receipt is claimed. Existing app/worker artifacts remain bound to 8c8cbfd; their application bytes did not change. No broad repository/database suite, final installed application or real provider/Discord trial ran. Prior proposal files remain immutable for their approval hashes; current scope is in `legal/windows-wrapper-build.json`.

The wrapper gate is passed for synthetic diagnostics. HCS access isolation remains unqualified: a WRITE_DAC open request was accepted, and the associated vmwp primary SID changes by VM and is not proof of the effective opener. Review GitHub/.agent_docs/aphelion-sophie/windows-hcs-trial/diagnostic-amendment.md for bounded disposable-pipe checks under actual core/egress creators and a narrower candidate group DACL. No production descriptor/profile change or owner receipt is approved by those observations. Remaining installed composition, guest mounts/credentials, worker physical termination/uncertain-create, provider/account, publication/actual-answer, preference-journal and Discord gates remain open. Field-test and production readiness remain false.

## Approved fixed root and WinSW clean-exit gate — 28 September 2026

Approved fixed host root changed to C:\Aphelion\Sophie in native and JavaScript profiles. Created only the new protected parent/tree and repointed the three owned Manual diagnostic services with unchanged identities. Preserved the old ProgramData trial tree and shared ancestor descriptors; no protection rule was relaxed.

Host and guest helpers rebuilt. Actual core service passes parent/child user and service SID, protected-root/own-marker, cross-role read and own-marker write denial, service-SID pipe create/close, and companion readiness/drained stop checks. Guest checks pass 36 native assertions, 11 boundary groups, four stream groups and two cross-profile rejection assertions. Host stream checks and six installation configuration checks pass. WinSW then fails clean-child-exit reporting because it requests full SCM access; the bounded driver stops the wrapper. Egress/supervisor were not started. Three services are Manual/stopped, no owned processes or containers remain.

The first new-root driver attempt encountered the wrapper log lock and stopped its own service during cleanup; it is not a test pass. The corrected driver waited for exit and captured the successful core diagnostic, then timed out on SCM state. The wrapper log identifies SignalStopped → ServiceManager.Open(All), matching upstream WinSW issue #1136. Operator cleanup succeeded. No exit code was disguised and no SCM/service DACL or account was changed. The diagnostic ran service-probe.mjs, not the final installed application entrypoint. New guest compile and transport containers were removed.

Current source-bound report: `GitHub/.agent_docs/aphelion-sophie/windows-fixed-root-verification.json`. Prepared worker package and host source/helper inventories are recorded there; no new worker image or qualified owner receipt is claimed. No broad application or database suite was rerun. The root proposal remains immutable for its approved hash; the approval overlay is in `legal/windows-installation-trial.json`. Historical entries below describe earlier candidates and superseded next steps.

The fixed-root amendment is implemented. Review the private WinSW clean-exit build amendment at GitHub/.agent_docs/aphelion-sophie/windows-fixed-root-trial/wrapper-amendment.md: one SCM access-mask call-site fix, exact SDK/package inputs and unchanged service permissions. The stock-wrapper qualification is blocked; no patched wrapper has been built or installed. After that gate, continue the already approved egress/supervisor, HCS, mount, credential, physical-termination and uncertain-create checks. Full installed application, provider/account, publication/actual-answer, preference-journal and Discord gates remain open. Field-test and production readiness remain false.

## Windows service trial: shared-ancestor path gate — 28 September 2026

Three approved Manual diagnostic services and the new protected ProgramData trial tree are provisioned. Core parent/native-child identity checks pass after requesting TOKEN_DUPLICATE with TOKEN_QUERY for enabled service membership; worker-only checks still request QUERY. No service/process DACL was widened.

Guest-specific and host helper builds pass. Final guest build passes 36 native assertions, 11 boundary groups, four stream groups and two runtime/role rejection checks; host stream checks pass. Actual core service identity passes; protected-root validation then rejects the existing ProgramData Users metadata-write ACE (0x116). Egress/supervisor were installed but not started. All three services are Manual/stopped; no owned trial processes remain. The guest containers were removed. The bounded diagnostic uses synthetic marker files and test pipe names, with no live credentials, database, provider or Discord connection. Final application-wrapper configurations are prepared but not activated.

The first service failure identified a query-only primary token passed to WindowsPrincipal.IsInRole, which needs to duplicate it into an identification token. That source fix was compiled and the same core identity check passed. The subsequent file failure is a separate measured OS-layout mismatch: ProgramData grants BUILTIN\Users write-EA and write-attributes on the shared directory. The protection rule and existing ancestor ACLs are unchanged. Source-bound reports: `GitHub/.agent_docs/aphelion-sophie/windows-guest-framework-verification.json` and `windows-service-trial-verification.json`. Earlier source-bound images/packages remain historical; no application/database suite was rerun.

Review the concrete fixed-root amendment at GitHub/.agent_docs/aphelion-sophie/windows-service-trial/installation-root-amendment.md. It proposes C:\Aphelion\Sophie while preserving the guard, existing shared ACLs and old trial artifacts. Service/WinSW and guest Framework approvals remain valid. Installed file/pipe/HCS, mounts, credential custody, physical termination and uncertain-create gates are not passed. Provider, publication/actual-answer, preference-journal and Discord gates remain independent. Field-test and production readiness remain false.

## Pinned guest Framework helper — 28 September 2026

Separate compile-time host and Server Core worker runtime pins. Guest helper builds with the exact image-bundled compiler and rejects installed host roles. Host Framework 4.8.1 pins remain unchanged; no runtime fallback or Microsoft binary copying.

Exact guest CLR/assembly/compiler/configuration inventory recorded; GAC and Framework64 System hashes match. Guest build and 36 native assertions pass. Actual ContainerUser Node/helper tests pass 11 boundary groups, four stream groups and both cross-profile rejection checks in bounded network-disabled Hyper-V containers. Host build and stream checks pass. Owned trial containers removed. No application-wide or database suite was repeated for this native/runtime packaging change. Current evidence is in `GitHub/.agent_docs/aphelion-sophie/windows-guest-framework-verification.json`.

Continue the already approved service/file/HCS/mount/termination trial with the guest-specific package. Service tokens, installed protected-file acceptance, exact HCS identity/access, mount/credential isolation and uncertain-create disposition remain unqualified. No further approval is needed for the recorded service/WinSW/guest Framework scope. Stop at any new incompatible OS boundary. Provider, publication/actual-answer, preference-journal and Discord gates remain independent. Field-test and production readiness remain false.

## Authorized Windows trial: guest runtime gate — 28 September 2026

Owner approved the exact synthetic Windows trial and WinSW bundle scope. The pinned worker source/runtime/helper package built into an actual Windows image; one bounded Hyper-V runtime probe executed. No application source changed.

Host compiler/Framework/Node and WinSW hashes matched. ContainerUser executed approved Node 24.19.0 in a four-CPU/eight-GiB Hyper-V container with network none, no mounts and no published ports. Guest Framework release 528449 differs from the host-pinned 533325; helper startup correctly rejected with PIPE_START_FAILED_1:PIPE_RUNTIME_CHANGED. Owned container removal and absence confirmed. No services, installation root/ACLs or existing data changed.

The image is `sha256:57d72d3461ba88d96c995225e5ba5c8b2fd1af964b86f11bb4bfe0f299930b15`, built from source candidate `d2187602a07a5f942d447afed5cdc77c306adee0` and the previously approved pinned Server Core base. The recorded failure is the helper's exact-runtime guard; pipe/API compatibility on the guest remains untested. Framework64 file hashes were collected; the initial probe did not hash the separate GAC System path. No Microsoft binaries were copied, no Framework upgrade was installed, and no provider/Discord request was made. The image is retained for diagnosis; the one runtime container is removed. No application suite was rerun for these approval/evidence-only repository edits.

The approved trial stopped at its first incompatible runtime boundary. Review GitHub/.agent_docs/aphelion-sophie/windows-installation-trial-2026-09-28/runtime-amendment.md for the exact bundled guest Framework 4.8/compiler exception. WinSW and the named service/ACL trial are already approved; do not ask again. After a qualified guest build, resume service tokens, protected files, HCS masks, mount/credential isolation, physical termination and uncertain-create qualification. Provider/account, publication/actual-answer, preference-journal and Discord gates remain open. Report: `GitHub/.agent_docs/aphelion-sophie/windows-installation-trial-verification.json`. Field-test and production readiness remain false. The preceding helper/package evidence remains bound to its original source candidate.

## Installed profiles and role composition — 28 September 2026

Fixed installed profiles validate independent protected owner records, retained file handles, source/runtime manifests, parent/service identities and expiring authority. Core, supervisor, egress and worker payloads compose the native adapter; core isolates database readers and replaces lifecycle ownership on configuration Apply. Worker trust uses a separate read-only mount. Control proof binding now tolerates readiness before native write acknowledgement.

Pinned nine-source x64 helper build; 36 native descriptor/path/profile assertions; 11 companion and four stream PASS groups; six installation configuration checks; three composed scenarios with four actual synthetic companions; 15 isolated PostgreSQL privilege checks with owned cluster stopped; 51 focused repository checks (50 control/supervisor/worker plus new trust-mount regression). No installed-service, container, real provider or Discord qualification.

The PostgreSQL check used the existing disposable-cluster runner and tested table writes, REFERENCES/TRIGGER, sequence use/update, schema creation, ownership and cross-schema leakage. The composition scenarios exercise a metered synthetic loopback TLS turn, core configuration Apply ownership replacement and supervisor recovery before RPC admission. They use native synthetic profiles and injected database/Docker collaborators; they do not establish installed Windows custody. Initial native composition exposed the control proof/ready race; DS04-C22 now protects that ordering. No dependency, migration, remote-processing approval or consent-notice default changed.

Source-bound evidence and prepared worker package: `GitHub/.agent_docs/aphelion-sophie/pipe-installation-verification.json`. Fixed profile/manifest contract: `GitHub/.agent_docs/aphelion-sophie/windows-pipe-installation/installation-contract.md`. Packaging retains the approved Node executable/notices and original helper; no Microsoft Framework files are copied. Foreground payloads are not SCM wrappers. The worker's existing forced-exit watchdog is not positive physical-close evidence.

Authorize the concrete Windows trial and exact SCM wrapper scope in GitHub/.agent_docs/aphelion-sophie/windows-pipe-installation/operational-trial-proposal.md. Actual service tokens, protected-file acceptance, HCS proxy/guest identities and masks, Framework compatibility, mount/credential isolation, physical termination and uncertain-create disposition remain unqualified. Final host SCM packaging, installed-core/database and actual Discord acceptance remain open. Provider/account clearance, preference journal custody and publication/actual-answer gates remain independent. Field-test and production readiness remain false. No live services/accounts, existing ACLs, credentials, provider calls, Discord effects or existing databases changed. No broad suite, performance claim or full release qualification was attempted. Earlier milestone entries below describe their historical builds and are superseded for current implementation status.

## Synthetic Windows companion and encrypted transport — 28 September 2026

Original MIT C# companion verifies pinned parent/runtime and protected overlapped stdio, enforces role/boot endpoint registration, bounds multiplexed credit streams, and confirms native closure. A bounded JavaScript Duplex/server adapter is injected at control, inference and egress seams. Synthetic profiles derive only unique test namespaces; installed profiles remain unavailable.

Pinned csc build and three loaded Framework hashes verified. Ten native primitive checks, restricted-token generic-write/instance denial plus explicit-data acceptance, interrupted-frame poisoning, 1 MiB duplex/final-byte flow, stalled-reader cancellation, parent/helper exit, malformed/oversized commands and namespace cleanup passed. Existing encrypted control/inference and worker TLS carried two metered synthetic provider turns; wrong control key rejected. No real provider, database, Discord, container or installed-service changes.

The stream protocol acknowledges writes before accepting another write and retains native completion through closure. Client confirmation followed by listener EOF prevents a queued final acknowledgement from being discarded. A parent close receipt bounds late credits without reusing connection IDs. Interrupted output permanently rejects subsequent frames, including STOPPED. The startup check rejects ordinary synchronous Node pipes via documented completion-port association; event-based I/O suppresses completion-port packets. SetSecurityInfo returns D:PAI on this host; verification permits only the AUTO_INHERITED bookkeeping bit while requiring protection and exactly the expected non-inherited ACEs. No rights were broadened.

The access test temporarily restricted only its own thread token and used a new test pipe. It proves the tested access masks, not separation between installed service accounts or HCS identities. No account, existing file ACL, service, credential or host runtime was changed. Existing primitive evidence is retained in its original files; refreshed evidence uses separate companion check artifacts. No full application/database suite, paid provider call, latency benchmark or container run was performed.

Source-bound report: `GitHub/.agent_docs/aphelion-sophie/pipe-companion-verification.json`; implementation/protocol note: `GitHub/.agent_docs/aphelion-sophie/windows-pipe-companion/implementation.md`. Complete installed role profiles and protected-installation verification, fixed service entrypoints, and the helper/package manifest. The current companion explicitly accepts synthetic profiles only. Actual service identities/ACLs, HCS/Hyper-V proxy mapping, worker-image Framework compatibility, mounts/credentials, operational termination and unresolved-create disposition still require their separate operational trial. Installed-core/database and actual Discord acceptance remain open.

## Native pipe primitives and accounting capacity — 28 September 2026

The owner approved the fixed C#/.NET pipe companion scope; see legal/windows-pipe-toolchain.json. The first original native component creates protected descriptors and first-instance listeners, connects with explicit data rights and anonymous impersonation level, bounds I/O buffers to 64 KiB and retains native operation state through observed completion/cancellation. Ten focused synthetic checks pass, including bidirectional exact bytes, namespace collision with spare capacity, pending-read/accept cancellation, close/EOF and namespace release. Pinned csc compilation succeeded; loaded CLR, mscorlib and System bytes match the approved inventory. The first check exposed an expected-flags mistake: GetNamedPipeInfo returns server plus remote-rejection bits (9). The collision test was improved to leave spare capacity so it proves first-instance rejection rather than only an exhausted instance count. Initial test-harness unawaited-call compiler warnings were corrected. That milestone covered low-level same-identity primitives only; the later companion milestone above supersedes its implementation status. It did not establish installed-service access or production containment. No Framework/compiler files are copied into Sophie.

A separate existing-runner PostgreSQL qualification seeded 199,999 resolved synthetic attempts and reached the 200,000-row boundary through two concurrent reservations. Exactly one succeeded in a 122.429 ms combined operation; rejection at capacity took 44.088 ms and left spending unchanged. A 500-row retention batch took 98.042 ms, preserved all 200,002 then-existing replay receipts, kept expired messages ineligible and allowed fresh admission. These are individual host-local observations, not percentiles, sustained load, service timing or the 15-second Discord-turn gate. The owned cluster stopped; no existing database, provider, paid request or Discord service was used. Accounting source was unchanged. No application-wide/database suite was repeated.

Source-bound evidence: `GitHub/.agent_docs/aphelion-sophie/native-capacity-verification.json` and `accounting-capacity-verification.json`. Complete parent/stdio verification, registered role/boot companion protocol, bounded multiplex/credit flow and JavaScript Duplex integration. Qualify final-byte drain, cross-service access denials and the full encrypted transport. Then complete fixed service entrypoints and trusted installation checks. Actual service identities/ACLs, mounts/credentials, Hyper-V mapping, worker-image runtime compatibility, physical termination, unresolved-create disposition and Discord/installed-core acceptance remain open. Provider framing, approved prices, actual transport crash/rollover and installed-service capacity/latency remain unqualified. The single synthetic host capacity run is not an end-to-end timing or production load guarantee.

## Preference attachment and runtime scope — 28 September 2026

Fixed native browser attachment download shares current self-authorized preference inspection and rejects unavailable or quarantined state. 14 focused checks pass. An actual in-app browser download produced the expected 218-byte synthetic JSON file; contents/hash verified. Late session loss, query selectors and unavailable/quarantined stores reject without an attachment. No database/provider/Discord/live-service change. Browser verification used current dashboard assets and a synthetic API fixture; HTTP checks used the real listener with synthetic auth/store collaborators. The blob export had no completed download-event evidence; a plain attachment control worked. The new native attachment download is verified from the returned file bytes, with no claim of a universal old-browser defect. All fixture processes and the tab stopped. Database/application-wide checks were not rerun. Independent journal identity/location/ACL and restore exclusion require operator qualification. Browser attachment download is verified with synthetic data. Remote preference use stays disabled pending provider/data clearance; no conversational extraction.

Owner approved the exact Node 24.19.0 Windows x64 executable and original bundled notices for private packaging and synthetic qualification. Official archive/executable hashes and valid OpenJS signature verified; original aggregate plus seven supplemental notices retained. Static PE imports inspected. No host runtime replacement, container build, service/ACL change or operational qualification. See legal/node-runtime.json and the current owner decision. Exact Windows pipe creation/client-access adapter and its implementation/toolchain scope remain open, followed by fixed service entrypoints and trusted installation checks. Service identities/ACLs, mounts/credentials, Hyper-V communication, actual Node/image compatibility, physical termination and unresolved-create disposition require qualification. Database-coordinator/installed-service and Discord acceptance remain open. AI remains disabled. Source-bound evidence: `GitHub/.agent_docs/aphelion-sophie/runtime-export-verification.json`; source and actual browser evidence: `preference-export-2026-09-28.md`.

## Encrypted inference and control — 28 September 2026

Mandatory encrypted v2 inference/control frames protect prompt/reply content and purpose-key handoff while preserving fresh peer challenges, bounded accounting and lifecycle control. Node built-in HKDF-SHA256 and AES-256-GCM derive separate per-channel/direction keys. Every frame, including the initial handshake, is encrypted; a fixed 16-byte tag authenticates direction, protocol, length and sender salt before JSON parsing. Monotonic message counters and the existing mutually fresh session binding reject replay. Legacy peers fail closed, so core, control services and worker source must be upgraded together.

66 focused IPC, control, native, worker-package and egress checks pass. Actual host-local Windows pipes and synthetic TLS cover a metered turn; captured traffic excludes plaintext content and grants. Tampering, reflection, cross-profile traffic, replay and valid legacy HMAC frames are rejected. No actual Docker/Hyper-V or live provider qualification. No new dependency, migration or runtime adoption. Database/application/browser checks were not rerun. The Windows default pipe DACL does not establish confidentiality or cross-service access; encryption closes the content exposure but leaves pipe access, availability, endpoint identity and secret-file custody as explicit installation gates. It provides no forward secrecy if a root key is later compromised, and JavaScript strings are not claimed to be securely erased. Fixed service entrypoints and trusted installation/qualification inputs remain unfinished. Node/image distribution and bundled-notice scope, actual service identities and pipe/file ACLs, mounts/credentials, Hyper-V communication, physical termination and unresolved-create operator disposition require qualification. Database-coordinator/installed-service and actual Discord acceptance remain open. No service, ACL, credential, host network, provider or Discord change. AI remains disabled. Source-bound evidence: `GitHub/.agent_docs/aphelion-sophie/ipc-encryption-verification.json`; design and primary references: `windows-ipc-encryption-2026-09-28.md`.

## Authenticated control and worker lifecycle — 28 September 2026

Authenticated role-scoped control sessions and revisioned jobs compose core launch/stop, a separate egress observer, purpose-specific boot keys, expiring readiness and signed worker-lease renewal with the durable supervisor. Supervisor restart invalidates pinned clients and completes removal-only recovery before opening endpoints. Core alone may prepare/create/start/quiesce; both roles receive only their own channel key. Three-second role readiness gates five-second worker leases, with no healing after expiry. Quiesce preempts a pending start and retains physical-removal uncertainty. A failed boot does not disable the egress observer for a different fresh boot.

53 focused checks pass: 21 control/lifecycle scenarios and 32 existing IPC/native/package/architecture checks. Actual host-local Windows pipes and temporary boot files carry one metered synthetic turn through worker-owned TLS to a loopback endpoint. Egress loss revokes authority and confirms synthetic Engine removal; no actual Docker/Hyper-V or live provider qualification. Initial fixture failures were corrected: teardown order, an unread test socket, missing lease.start(), and waiting for the durable removal receipt. Review found and corrected startup admission before recovery completion; pending quiesce requests are now bounded and accepting stop immediately fences new role grants/readiness. A focused regression also confirms failed boot cleanup retains durable retry ownership. No database/application/browser rerun, paid/live provider request, actual Docker or Discord effect; no service, runtime, ACL, migration or credential change.

Fixed service entrypoints and trusted installation/qualification inputs remain unfinished. Node/image distribution, actual identities/ACLs/mounts/credentials, Hyper-V communication, physical termination and unresolved-create operator disposition require qualification. Database-coordinator/installed-service and actual Discord acceptance remain open. Qualification callbacks are still injected; synthetic true callbacks do not establish OS permission or containment evidence. HMAC does not encrypt key handoff, so qualified local pipe confidentiality is mandatory. All fixture listeners closed. After explicit owner approval, the three initial leftover fixture directories were removed by deleting their exact journal files and then verified-empty folders; their absence was verified. AI remains disabled. Evidence: `GitHub/.agent_docs/aphelion-sophie/supervisor-control-verification.json` and `windows-supervisor-control-2026-09-28.md`.

## Supervisor journal and restart recovery — 28 September 2026

Kernel-held Windows supervisor ownership, bounded revisioned on-disk journal and composed container lifecycle with intent-before-effect, removal-only restart recovery and preserved uncertain creates. The journal is explicitly provisioned outside guest mounts, validates bounded checksummed records and rejects stale or invalid transitions. New owners recover by revoking old boot files and removing the observed registered slot; they never resume a stored start. Start approval is bounded and late completion is fenced. Journal or boot cleanup failure still permits an attempt to remove a known owned worker, while retaining unresolved state and blocking replacement.

44 focused checks pass, including actual Windows files/pipes, abrupt termination of six test-only Node processes and a synthetic Engine HTTP endpoint. No real Docker/Hyper-V or service qualification. The initial 42-check run passed; running-worker/journal-failure and acknowledged-create-ID recovery regressions were added and all 44 passed. All test-owned processes, listeners and temporary directories closed. No database, full application, browser, provider, actual Docker or Discord check; no live service, image, runtime, ACL, migration or credential change.

Authenticated supervisor control protocol/client, service entrypoints, core/egress readiness and lease scheduling remain unfinished. Node/image distribution, actual identities/ACLs/mounts/credentials, Hyper-V pipes, physical termination and unresolved-create operator disposition require qualification. An unacknowledged create with no container ID cannot be cleared merely because inspection is empty. Atomic file publication and checksums are not power-loss, rollback or ACL qualification. Named-pipe ownership is not caller authentication. Evidence: `GitHub/.agent_docs/aphelion-sophie/supervisor-recovery-verification.json` and `windows-supervisor-recovery-2026-09-28.md`. AI remains disabled and field-test readiness is open.

## Registered container adapter and boot publication — 28 September 2026

Worker source package and authenticated reverse pipes, plus a fixed-slot privileged Docker adapter and atomic bootstrap/qualification-lease publication with terminal revocation. Only the supervisor implementation may import the Docker adapter; it cannot import core/case modules. Create/start uncertainty consumes launch authority until matching owned removal and observed absence. Unexpected environment or mount profiles are rejected. Unique boot metadata is atomically published; signed leases additionally require fresh qualification. Expiry/revocation cannot heal. The supervisor journal/control service and physical lifecycle composition are not yet implemented.

30 focused checks pass using a synthetic loopback Engine API, actual Windows temporary files and existing host-local pipe tests; no actual Docker/Hyper-V or service qualification. Sixteen cases exercise the new supervisor code, including reconciliation after a lost deletion reply. The first run had one test-order error, corrected by testing unauthorized start before removal consumes prepared authority; both assertions remain. Initial and successful logs are preserved. No database, full application, browser, live provider, daemon or Discord checks; no service/image/runtime/ACL/credential provisioning.

Durable supervisor ownership/recovery journal, authenticated control protocol, separate egress/core composition and service lifecycle adapter remain unfinished. Runtime distribution, image, identities/ACLs/mounts/credentials, Hyper-V pipes and physical termination require actual OS qualification. File flush/rename proves neither power-loss durability nor Windows permissions. The Docker uncertainty marker is in-memory only, and HTTP shutdown is not container termination. Evidence: `GitHub/.agent_docs/aphelion-sophie/supervisor-foundation-verification.json` and `windows-supervisor-foundation-2026-09-28.md`. AI remains disabled; field-test readiness is not achieved.

## Worker source package and reverse inference pipes — 28 September 2026

Worker-initiated authenticated inference pipes, fixed-path container entrypoint and short-lived signed qualification leases; fixed-destination egress and worker-owned TLS retained. Core owns the boot-specific inbox; the guest connects and authenticates before waiting for an independently authorized turn. Per-turn accounting and the original deadlines remain intact. The fixed entrypoint requires distinct IPC/egress/lease keys, a current signed lease bound to the registered qualification evidence, and provider-only credential storage. Lease expiry uses an independent monotonic timer; stale, altered or late records cannot revive a revoked process.

46 focused checks pass, including actual host-local Windows pipes, metered reverse connections, cancellation and signed lease replay/expiry/stalled-read checks; container executable and OS isolation remain unqualified. The first new response fixture omitted application/json and was corrected. No full application/database/browser rerun for this transport/bootstrap change; no live provisioning, provider call or Discord effect. The source package contains no runtime binary or credential and has not been built or launched as an image.

Concrete privileged supervisor and atomic lease/bootstrap writer, runtime distribution qualification, exact identities/ACLs/mounts/credentials and Hyper-V pipe mapping, physical termination and composed OS qualification remain open. No field-test approval is claimed. Evidence: `GitHub/.agent_docs/aphelion-sophie/worker-package-verification.json` and `windows-worker-package-candidate-2026-09-28.md`.

## Fixed-destination worker egress — 28 September 2026

Authenticated fixed-destination host egress bridge and worker-owned TLS pipe connector, composed with the bounded single-socket HTTPS transport. A separate host bridge authenticates the current public worker boot before resolving only api.deepseek.com. It rejects special-purpose/non-IPv4 answers and connects to a checked numeric address at port 443. TLS and the provider credential remain inside the worker; the bridge forwards bounded encrypted bytes without content logs. Stop/revocation retains the slot until physical closure. The worker transport has no direct-network fallback when this connector is selected.

36 focused checks pass using actual host-local Windows pipes and synthetic loopback TLS, including authentication/replay, certificate/hostname rejection, address and byte limits, reuse and physical cancellation. Not Hyper-V or production isolation qualification. Database, full application and browser suites were not rerun for this transport-only change. All synthetic listeners and sockets closed. No dependency/runtime, service, network, ACL, credential, database, provider or Discord change.

Concrete worker package, host/guest inference transport and registered Windows lifecycle supervisor; actual Hyper-V pipe mapping, identities/ACLs/egress/credential and process-tree termination qualification; runtime candidate qualification and activation remain open. AI stays disabled. Source-bound evidence: `GitHub/.agent_docs/aphelion-sophie/egress-verification.json`; operational candidate details: `windows-egress-candidate-2026-09-28.md` in that directory.

## Temporary prepared-request diagnostics — 28 September 2026

The worker fingerprints its final immutable outbound blocks with a random per-worker
key. Comparison material crosses only the authenticated internal protocol. It never
enters provider fields, persistent storage, log labels or dashboard output. Core
keeps at most one comparison per existing conversation lane, tied to retained source
revisions. Expiry, eviction, edits/deletion, source or consent loss and context reset
discard it. Revalidation rejects stale sources and an invalidation during comparison
cannot restore an old comparison basis.

Authenticated channel inspection shows first changed block, ordered block byte sizes
and preparation time. Operator/channel/control/source authority is checked again;
disabled AI has no diagnostic result. Browser results clear on expiry and suspension.
A preparation comparison does not prove provider dispatch, cache eviction or a token
boundary. The selected request layout and provider payload remain unchanged.

77 focused checks and 76 isolated AI/knowledge/Gateway scenarios pass, with 19 composed
staging scenarios; both disposable databases stopped. Synthetic browser display and
timed expiry passed. The final asynchronous invalidation fix has focused regression
coverage. Actual provider cache/latency, model answers and Windows isolation remain
unqualified. No schema, dependency/runtime, service, credential, live provider/Discord
or deployment change. Evidence: `GitHub/.agent_docs/aphelion-sophie/diagnostics-verification.json`.

## AI worker operating controls — 28 September 2026

Schema063 retains desired and active worker revisions and the last authenticated
worker acknowledgement. Reviewed apply binds the registered release and current
configuration/personality/budget/control revisions. Stop disables processing before
external work. A single session owner drains the previous AI lane, requires positive
physical-quiescence evidence, and checks a freshly qualified worker probe before
attaching the replacement. Failed or superseded starts cannot activate processing.
An exact lost-response retry returns its receipt without cancelling its own launch.
At the 1,000-request limit, one final stop remains available; failed terminal stop
recovery reuses that intent without growing history. Apply always leaves AI disabled.

44 focused checks, 75 isolated AI/knowledge/Gateway scenarios and 19 composed
staging scenarios pass; both disposable databases stopped. The native pipe probe
does not call the provider. RT19 verifies signed administration survives an optional
worker-coordination outage. Synthetic browser review/apply/stop displays the expected
revisions, acknowledgement and disabled state; this uses a simulated lifecycle API.
Unrelated migration-count assertions changed without rerunning their suites.

The coordinator requires an injected registered lifecycle adapter. The concrete
Windows service adapter, actual process-tree termination, identities/ACLs/egress,
credential custody and runtime candidate remain unqualified. No live migration,
grant, credential, service, provider call, Discord effect or deployment changed.
Evidence: `GitHub/.agent_docs/aphelion-sophie/worker-operations-verification.json`.
The injected lifecycle contract still permits a hung call to hold shutdown and its
ownership lock open. Production qualification must implement bounded cancellation
and physical termination; this coordinator intentionally does not detach an unknown
live worker. At terminal history capacity, later stop requests coalesce without
retaining each later requester or request ID.

## Native worker transport and accounting retention — 28 September 2026

Boot-specific Windows named pipes now compose the authenticated worker protocol.
The worker owns a fixed-origin HTTPS agent with one reusable socket, bounded
headers/body/deadline, no paid-POST retries or redirects, and physical teardown.
Qualification remains mandatory; these pipes do not establish OS isolation.

18 IPC/native checks pass, including actual local Windows pipes, synthetic socket
reuse, cancellation, oversized response rejection and startup/shutdown races.
Fresh worker readiness precedes the greeting that permits prompt transfer. A
required revocation signal cancels physical work and closes the listener/pool;
qualification is checked again before returning a result. Stalled qualification
checks are bounded and cancellation preserves accounting uncertainty.
65 isolated AI/knowledge/Gateway scenarios pass; the database stopped. Accounting
cleanup removes at most 500 resolved details older than 90 days per batch, keeps
unresolved charges and replay receipts, and preserves referenced budget periods.
New reservations stop at 200,000 retained attempt rows per guild. Daily/monthly
aggregate retention is 90/400 days, subject to outstanding references/reservations.
The hard-cap performance boundary and production DELETE grants were not qualified.

All 40 historical launch-question source locators were reviewed. Three wording or
citation findings were corrected; 27 support and 13 abstention expectations remain.
This is not model-answer acceptance, fresh source publication or owner approval.
Evidence: `GitHub/.agent_docs/aphelion-sophie/worker-native-verification.json` and
`launch-question-owner-review-2026-09-28.md` in that directory.

Actual TLS/egress, service identities, pipe ACLs/confidentiality, credential custody,
hard process termination, AI-only apply/replacement controls and runtime maintenance
qualification remain open. No provider call, source publication, live database
grant/migration, service installation, runtime upgrade or deployment occurred.

## Discord lookup and unattended refresh — 28 September 2026

Signed `/lookup` shares the dashboard's deterministic reviewed-source use case.
Queries are bounded one-use core values outside routing metadata. Membership,
non-case channel/parent and source validity are rechecked before a private exact
source response. It works without an inference worker. No command was registered
on Discord. Native-process knowledge composition provides qualified serialized
Policies refresh and cancellation, with no automatic publication authority.

61 focused checks, 64 isolated AI/knowledge/Gateway scenarios and 18 composed
staging scenarios pass; both databases stopped. An initial new staging assertion
used the wrong denial wording; the exact existing wording now passes. Preference
review fixes constrain inline expiry to the current member and preserve journal
conflicts. They are covered by the focused and isolated checks above.

Evidence: `GitHub/.agent_docs/aphelion-sophie/knowledge-completion-verification.json`.
Actual Windows knowledge identity, registration, reviewed source publication and
the 40-question release gate remain open. All network/Discord checks here used
synthetic adapters or loopback fixtures; no paid provider or live service changed.

## Gathering edits — 28 September 2026

Eligible complete edits now replace their own gathering revision after Gateway
commit and fresh authority checks. Original receipt time, deadline, root owner,
absolute gathering ceiling and size limits remain fixed. Partial, conflicting,
changed-scope and late edits cancel. Edits after freeze never start a second call.
43 focused checks and 63 isolated AI/knowledge/Gateway scenarios pass; the database
stopped. Actual provider concurrency and Discord timing remain unqualified.
Source-bound evidence: `GitHub/.agent_docs/aphelion-sophie/ai-edits-verification.json`.

## Explicit local response preferences — 28 September 2026

Schema062 adds member-saved reply length and language only, authenticated self
inspection/replacement/export/deletion, 90-day expiry and a separately qualified
non-content restore watermark. Journal/database disagreement quarantines prior
values; expiry maintenance is independent of inference. External use remains off.

28 focused checks, 62 isolated AI/knowledge scenarios and 18 composed staging
scenarios pass; disposable databases stopped. Synthetic browser save, edit and
delete passed with no console warnings/errors. The download action produced no
browser download event, so completed file export remains unverified. A malformed
select option found during browser testing was corrected. Source-bound evidence:
`GitHub/.agent_docs/aphelion-sophie/ai-preferences-verification.json`.

Independent journal provisioning, identity/ACL/restore-exclusion qualification,
backup retention and provider data clearance remain open. No live migration,
service or grant changes. Unrelated migration-count assertions were updated;
their suites were not rerun.

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

## Policies collection and structured extraction — 28 September 2026

The owner selected the public Policies page and approved parse5 8.0.1 (MIT) with
entities 8.1.0 (BSD-2-Clause), scoped in ADR 0005. The exact npm archives matched
their integrity values, notices are preserved, install scripts were disabled,
and the npm advisory query returned no entries for these two versions. Existing
pg pins and the Node runtime are unchanged.

Anonymous API discovery confirmed MediaWiki 1.46.0 and the page's advertised
CC BY-NC-SA 4.0 content licence. The fixed-origin collector reads page 878 only,
plus revision metadata for its transclusions, and compares repeated page,
template, licence and rendered-content observations. It rejects redirects,
missing/deleted/moved sources, changed observations and oversized responses.

Fourteen focused collector/extractor checks pass. Actual public collection at
revision 14796 found 52 templates; local extraction retained 174 headings and
25 tables with 257 rows. The disposable parser worker has a termination deadline,
V8 heap/stack limits and no inherited environment. These are bounded parsing
controls, not OS isolation or an atomic MediaWiki snapshot guarantee.

Raw snapshots and structured extracts remain outside Git, explicitly unreviewed.
No source was published, scheduled, sent to a model or deployed. Durable import
storage, review/publication integration, immediate source invalidation and the
40-question knowledge release gate remain open. The source-bound report is
`../.agent_docs/aphelion-sophie/mediawiki-verification.json`; the umbrella index
retains previous milestone evidence without claiming its tests were rerun.

## Durable Policies imports and publication review — 28 September 2026

Migration059 adds bounded immutable snapshot/extraction storage and fenced manual
refresh. Changed rendered or template content revokes existing publication epochs
before extraction. Review hashes bind the source generation, preventing a source
reversion from reviving an old publication or uncommitted review. Retrieval, review
and publication check artifact integrity and five-minute source freshness. A fresh
identical check can restore eligibility after a transient failure, but cannot undo
manual staleness, withdrawal or an observed source change.

Publication receipts retain their request hash across migration and return confirmed
duplicate results even after source expiry or change. Withdrawal retries resolve
only the matching current tombstone. The dashboard renders structured text and
table context, preserves wiki attribution/binding on edits, and requires separate
publication confirmation. Slow or failed source collection leaves the administrative
HTTP request slot available.

38 focused checks and 51 isolated AI/knowledge/accounting scenarios pass with zero
failures or skips. The database stopped. Synthetic browser checks covered source
refresh/review, literal markup, lists/tables, explicit publication and retained wiki
binding on edit; no console warnings/errors appeared. Browser checks used an
in-memory fixture, not a deployed service. The source-bound report is
`../.agent_docs/aphelion-sophie/mediawiki-import-verification.json`.

No live migration, grants, service/ACL/network changes, provider calls, Discord
effects or actual source publications occurred. Other storage suites and full
release qualification were not rerun. Worker/service composition, unattended wiki
refresh, Discord `/lookup`, reviewed extracts and the 40-question knowledge gate
remain open. This milestone does not activate AI or complete the workplan.

## Authenticated worker-stream foundation — 28 September 2026

The new broker and worker exchange mutually fresh authenticated challenges before
transferring a bounded prompt. HMAC frames bind direction, session and sequence;
worker/boot/release/provider-profile hashes must match the separately qualified
expected identity. The transport is injected, and `current()` requires an explicit
trusted qualification check. The server accepts only public scoped prompts and
fixed preparation/generation messages, with one prepared or physical request at
a time. Core-only accounting and delivery metadata does not cross the boundary.

Core acknowledges durable dispatch before the provider POST and settles usage
before accepting output. Cancellation/expiry closes the stream and preserves any
uncertain charge; an uncooperative underlying request keeps its physical slot.
Denied budgets and silence discard preparation. Runtime stop closes the broker.

40 focused IPC/adapter/scheduler checks pass, including wrong keys and identities,
cross-connection greeting/request replay, tampered/oversized/unexpected frames,
revocation before network handoff, cancelled preparation, deadline expiry and
usage reporting for malformed paid output. These checks use synthetic loopback
streams and mocked provider transport. Source-bound evidence is in
`../.agent_docs/aphelion-sophie/worker-ipc-verification.json`.

HMAC framing does not encrypt the stream or establish an OS identity boundary.
The native private connector, service identities, ACLs, egress, provider credential
custody, transport-pool teardown and hard process termination remain unqualified.
No listener/service, credentials, dependency/runtime upgrade, live provider call,
migration or Discord effect was installed or performed. Database suites were not
rerun for this non-storage slice; earlier evidence remains separately source-bound.

## Gathering and channel fairness — 28 September 2026

Schema061 adds fenced gathering receipts without stored content. Three compatible
conversational fragments may share one paced turn, within 750 ms quiet / 1.5 s
absolute / 4 KiB bounds. The first receipt fixes the deadline. Every fragment is
independently authorized; freeze checks the complete receipt set and revisions.
Larger valid single questions bypass gathering. A separate ingress flood bound
limits metadata events. The scheduler rotates channels and keeps cancelled physical
requests in their slots; synthetic two-slot mode still allows one per channel.
Runtime concurrency remains one. Edited gathering sources currently cancel the turn;
in-place fragment replacement and actual worker/timing qualification remain open.

40 focused runtime/turn/observation checks and 56 isolated AI/knowledge/Gateway
scenarios pass; the disposable database stopped. Source-bound evidence is in
`GitHub/.agent_docs/aphelion-sophie/ai-gathering-verification.json`. No live schema,
grants, provider requests or Discord effects. Unrelated migration-count assertions
were updated without rerunning their suites.

## Durable AI effects — 28 September 2026

Migration060 replaces transient effect ownership with fixed-target, fenced receipts.
Intent precedes Discord dispatch; positive late receipts remain available for exact
cleanup. Unknown sends stay parked without history searches or retries. Deterministic
automation admission takes precedence. Cleanup uses bounded source/member revision
metadata and public-source identifiers, with no message or generated text archive.
An unavailable AI recovery store cannot prevent administration from starting.

25 focused turn/observation checks, 55 isolated AI/knowledge/Gateway scenarios and
18 composed staging scenarios pass. Both disposable database clusters stopped.
13 IPC tests pass after preventing a worker from releasing possible spend through
an undispatched assertion after final dispatch authorization. Evidence and source
hashes are in `GitHub/.agent_docs/aphelion-sophie/ai-effects-verification.json`.
No live schema, grants, provider calls or Discord effects were performed. Other
migration-count assertions changed without rerunning unrelated suites. Actual
Windows/service/effect qualification and active worker apply remain open.

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
