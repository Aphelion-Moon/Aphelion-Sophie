# Ordinary ticket delivery review and recovery

Scope: P06, P09–P11, P17, P19 and P27; partial T01, T04–T07, T16, T22, T36 and T59 coverage. This adds Staff review for parked ordinary case-provisioning and answer-delivery jobs. Shuttle keeps its existing recovery interface. All exercised cases, answers, messages and credentials are synthetic; no dependency, capability-policy, live registration or production configuration change is added.

## Current authority and private review

`/ticket issues` returns at most five parked deliveries from cases the current responder can manage. Ordinary Staff cannot see or act on Head Admin contact issues, including when they opened that case themselves. Lead ops can manage that category. Requester status, claimed assignment, incoming role arrays, Administrator permission bits and copied issue IDs are not management authority.

The shared store authorizes the actual case at read and mutation boundaries, and again before returning metadata or committing repair. A later private interaction response queries the queue again under fresh authority. SQL filters the permitted categories before pagination; missing and unauthorized cursor boundaries have the same unavailable outcome. PostgreSQL timestamp precision is preserved at page boundaries. Historical issue handles remain available as permitted cursors after their jobs leave the parked state.

Each entry contains only routing references, case/category state, a bounded reason, possible-effect status and specific repair guidance. It contains no form questions, answers, message text, attachments, transcripts or notes. The reply suppresses all mentions. It is a list of parked jobs the responder can manage, not a system-health or successful-delivery claim.

## The three repair actions

| Action | What is recorded | What still requires worker verification |
|---|---|---|
| Recheck control | Audited request to make the existing parked job available again | Current membership, policy, case audience, original intent and external state |
| `/ticket recover issue:<reference> message:<ID>` | Exact verified Sophie message identity for the current pending answer/notice part | Fresh inspection and confirmation; remaining parts and responder notice |
| `/ticket choose issue:<reference> channel:<ID>` | A retained canonical candidate and the exact candidate set | Every other candidate sealed, then current permissions on the chosen channel |

An issue reference includes its retained revision. A repair must match the parked fence and revision. It records the actor grant, signed interaction, action, old fence, attempts, possible-effect marker, stable error, result ID and any selected candidate set/answer-part identity. Audit, receipt, reference adoption, issue revision and requeue commit together. Requeue advances the fence and resets only that job's attempt budget; it preserves its immutable effect, possible-send markers, global pause, rate limits and Gateway barriers.

Exact duplicate signed actions replay their retained receipt after current case authorization. A read-only replay check happens before fetching external evidence, so a committed message recovery remains repeatable even after the worker advances to a later part. A different action or result cannot reuse that interaction ID. Competing or outdated requests cannot act on a ready, leased, completed or newer parked job.

Unknown answer POSTs cannot be blindly rechecked. Staff must identify the matching Sophie message. The core adapter fetches only the supplied exact message ID in the recorded case channel, then checks its opaque proof, author, marker, original pinned payload, mention metadata and current private-channel permissions. A marker or supplied ID alone does not establish ownership or access. Changed, missing, cross-case or non-Sophie messages remain unresolved. There is no history scan, repost action or arbitrary message/URL endpoint.

For duplicate channels, selection uses the same constrained operation as Shuttle. Only retained candidates can be considered; an unregistered ID causes no channel fetch. An already opened case keeps its established destination. A newly discovered candidate invalidates the previous candidate set. The worker seals all other retained candidates before opening/confirming the chosen one; a missing or uninspectable candidate is not forgotten. Selection itself performs no Discord write and never confirms audience access.

Closed or departed cases cannot resume answer delivery through repair. Muzzled alone does not prevent ordinary support recovery and does not change Crew, Whitelist or Shuttle state. Provisioning rechecks preserve the existing lifecycle intent and use the normal case worker's current-policy restrictions. Repairs do not reopen cases, publish content, override admissions or restore roles.

## Persistence and evidence

Migration `023-case-delivery-issues.sql` adds `case_delivery_issues` and `case_delivery_actions`. Parking and issue creation share a transaction, including attempt exhaustion. Re-parking a newer fence advances the retained issue revision. Source joins bind the job's effect, guild, requester and case; Shuttle and unbound jobs cannot create ordinary issue records. Migration backfill retains only matching parked work without replaying it or inventing actions. Core has SELECT/INSERT/UPDATE; knowledge has no access and core has no DELETE.

Four contract tests cover signed bounded routing, closed presentation, pagination controls and explicit adapter injection. Y01–Y23 cover current audiences, requester/forged authority denial, exact message adoption, stale/duplicate/concurrent requests, final authority loss, changed/missing messages, ACL drift, Muzzled/departure/policy changes, transactional audit and parking failures, candidate sealing and immutable destinations, fresh proofs, pause/cooldown/fence preservation, metadata exclusion, precise pagination, signed loopback HTTP, migration backfill and lost commit acknowledgement. S31 exercises retained issue/audit/receipt/message identity across an isolated database restart with recreated authorization and delivery services. Actual full-suite execution results belong in [verification](verification.md).

Form authoring, participants and [conversation observations](case-conversations.md) are implemented separately. Remaining work includes unresolved or uninspectable external results, final copy, restricted notes, attachment acquisition and authenticated transcripts, dashboard parity, production composition, OS identity isolation, independent restore and live Discord permission/client checks. Rechecking cannot establish that an unidentifiable POST never happened. Previously confirmed messages are not continuously archived or monitored by this slice.

Rollback: stop recovery ingress and delivery, preserve migration 023, every issue/action/receipt, original effects, fences, selected candidate sets and message identities, and use compatible code. Do not clear unknown attempts, delete duplicate channels, reset authority epochs or downgrade to a migrator that rejects the retained schema. No production service, database, Discord state or source asset was changed.
