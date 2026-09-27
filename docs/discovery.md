# Discovery and unresolved deployment inputs

P00–P03 evidence, 18 September 2026. Sanitised observations only. No host dump, credentials, case records, admissions evidence or private blacklist records were read or imported.

## Observed in this task

- At initial inspection, the fresh repository tracked README, LICENSE and `.gitattributes`; supplied planning/assets directories were untracked working files. They were subsequently preserved in local commit `349c956`, with reference checksums intact. No remote publication is implied by that local commit.
- Windows Server 2022 Standard, build 20348; Ryzen 7 9800X3D, 8 cores / 16 logical processors.
- 61.59 GiB usable RAM and approximately 34.46 GiB available at inspection. C: approximately 549.65 GiB free; D: approximately 897.55 GiB free. These are snapshots, not capacity reservations or load-test results.
- Existing BYOND and SS14 game workloads are running. Database/tunnel services are already present. Ports 8080 (all interfaces) and 8081 (loopback) are occupied. This is not a firewall exposure assessment.
- Defender reported service, antivirus and real-time protection enabled. No security settings changed.
- Existing Node executable: v24.19.0, SHA-256 `3602f2bb1a10f2cbab4c36886218a33c1ab3db87290e73b033c46c77147d0237`. Used for local development; distribution/bundled notices are not yet approved for release.
- Both supplied public sites responded with HTTP 200 from this host. `https://meridian-wiki.a13.info/api.php` returned siteinfo reporting MediaWiki 1.46.0, English, `/wiki/$1`, and Creative Commons Attribution-NonCommercial-ShareAlike 4.0 International. `parse`, `query+recentchanges` and `query+embeddedin` are advertised; parse advertises text, templates, revid, tocdata and sections. This confirms metadata discovery, not ingestion correctness or permission to index all content.
- All four selected PNG hashes, byte counts and dimensions matched both supplied manifests. Thirty original package checksums matched immediately; the missing in-pack AGENTS.md was restored from its byte-identical root copy, preserving the original checksum list. The root guidance now adds the current decision precedence.
- Original 39-task dependency graph had no cycles or missing references; 52 acceptance entries were specifications, not results. The original master document matched the chapters after internal-source-link normalisation.

## Settled product inputs

See [ADR 0001](decisions/0001-owner-policy.md): MIT repository, external human admission, Crew/Muzzled, fresh Shuttle after Whitelist loss, repeat visits, human blacklist enforcement, ticket audiences and indefinite case retention.

## Still required

| Input | Scope affected | Current behaviour |
|---|---|---|
| Production runtime distributions and packaging review | Production installation and redistribution | PostgreSQL exception accepted; pinned driver and isolated synthetic storage tests implemented |
| HTTPS origin, registered OAuth callback and confidential client credentials | Dashboard deployment | Auth backend tested locally with synthetic values; public TLS/proxy, ingress limits and live browser/provider compatibility remain unset |
| Test bot/application and guild | Gateway, role and component compatibility | Offline synthetic tests only |
| Guild/role/category IDs, hierarchy and effective permissions | All live Discord operations | IDs unset; delivery unavailable |
| Capability map for mute/configuration/operations | Production command/dashboard authorization | Versioned policy and signed loopback moderation route tested with a synthetic map; production assignments remain unset |
| Final ticket forms and attachment policy | Production case capture | No production storage or file acquisition |
| Closed-channel audience decision | Live case closure | Existing-audience read-only access is the [provisional offline default](case-lifecycle.md); historical sealed cases stay sealed |
| Draft Shuttle controls and resolved links | Published onboarding | Source preserved; adapted copy is draft |
| Host/service accounts, ACLs, data root and non-conflicting ports | Windows deployment | Temporary ACL-restricted test cluster only; no service installation |
| Off-host backup destination, RPO/RTO and recovery watermark | Restore and production cutover | No production-ready claim |
| Representative game-load budget and independent telemetry | AI activation | Model absent and AI disabled |
| Wiki collection approvals and content attribution policy | Knowledge ingestion | No live ingestion |
| Website tokens/artwork placement review | UI release | No exact website style values asserted |

The existing WUFF addendum remains unchanged. `config/example.json` incorporates its proposed 1-active/3-waiting/4-generation-thread/4-prompt-thread profile and 120-second lifetime from enqueue. These are evaluation inputs only, with approval false.
