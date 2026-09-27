# Staff case queue and ownership

This slice implements the case queue, claim/unclaim and reassignment portions of P05/P06/P09–P11/P17, with partial T04–T07/T09/T16/T22/T36 coverage. It adds no dependency, role ownership, live service or AI path. [Ordinary ticket intake](case-intake.md) is implemented separately. [Answer delivery](case-intake-delivery.md) and [explicit participants](case-participants.md) are now implemented separately. Notes, manual tags/priorities, canned replies, attachment/transcript capture and dashboard parity remain open. Exact owner-authored ticket questions remain an open input.

## Shared operations

| Command | Behavior |
|---|---|
| `/ticket queue [state:active\|closed\|failed]` | Up to five authorized cases, oldest first, with Refresh/Next controls. Active includes pending, open and closing. |
| `/ticket claim case:ID@VERSION` | Assign an unassigned open case to the current responder. |
| `/ticket unclaim case:ID@VERSION` | Release the caller's own assignment, including on a closing or retained historical case. |
| `/ticket assign case:ID@VERSION member:MEMBER reason:handoff\|coverage` | Assign an open case to a current responder for its actual case type, preserving the prior assignee and actor in the audit. |

The queue's Claim/Unclaim buttons use the same application operations as the slash commands. Commands return private, mention-suppressed metadata. `/ticket status` also shows the assignee and whether their recorded authority is still current. Loading the registration definition does not register any command with Discord.

`apps/core/storage/case-staff.js` owns queue filtering and assignment transactions. `apps/core/storage/case-lookup.js` supplies the shared narrow metadata lookup used by lifecycle and ownership operations. The Discord adapter resolves a signed actor and reauthorizes again when a reply is rendered. Future dashboard routes must call these same services after authenticating the actor.

## Permissions and versioning

Assignment records responsibility; it grants neither Discord channel access nor application capabilities. Current case policy still decides every operation. Head Admin contact is visible/manageable only to lead ops responders; ordinary Staff cannot become its responder by being its requester, knowing a case ID/token, holding Administrator, or appearing in an incoming role snapshot. Reassignment independently resolves the selected member's current identity/roles and checks both parties before committing. A timed-out, Muzzled, absent or unauthorized recipient cannot be newly assigned.

The assignment stores the validated recipient's authority epoch and policy version. If that authority is revoked, the retained assignee stays visible with a review indication. A later role return does not silently validate the older grant; Staff can explicitly reassign it under the new authority. This is metadata observed at the time of the check, not a guarantee that the recipient's permissions can never subsequently change. Ownership is never consulted as an access entitlement.

Assignment mutations and lifecycle requests share the case's resource version. The actor, original target, reason code, previous assignee, resulting assignee, new version and interaction receipt commit together. Duplicate signed requests retain one action. Concurrent claims, stale buttons and receipt collisions cannot overwrite newer ownership or closure. Unclaiming does not cancel a pending close/reopen, alter a help pause, change reading progress, or enqueue a role/channel write. These are database-only actions, so there is no fictitious external confirmation step.

## Bounded queue and privacy

The queue accepts only the three fixed state filters. SQL restricts the result set to case types the current actor can manage; it does not expose counts of restricted cases. Each displayed case is checked against the immutable case policy version and current authorization, with another permission check before returning the page. A missing/inaccessible case receives an opaque denial; raw role arrays or serialized actor copies do not establish identity.

Ordering is stable by creation time and case ID. Pagination uses the retained 48-character case operation token, with a guild-scoped uniqueness constraint; a cursor can still anchor the next page after its case moves to a different state. A cursor for a missing or unauthorized case is stale and reveals no case metadata. Tokens are routing data, never access credentials. Controls remain within Discord's existing 100-character custom-ID bound even for the maximum supported case ID. A future case table must keep conversation/form/note/file content separate from this metadata path.

Explicit [participant changes](case-participants.md) are a separate retained use case. They share the case version with assignment and lifecycle operations and can change channel access; assigning a responder still does not.

## Storage, verification and remaining gates

Migration 017 adds the nullable canonical assignee grant and retained `case_staff_actions`, plus unique guild/case operation tokens. Existing cases stay unassigned and receive no invented audit. An existing token collision must fail migration for operator review. Core needs SELECT/INSERT/UPDATE on the new table; it has no DELETE, and the knowledge identity has no access. Applied migrations 001–016 remain unchanged.

Five contract/adapter tests and K01–K14 cover bounded signed inputs, queue permissions, private rendering, optimistic versions, competing claims, assignment recipient restrictions, role loss/return, transactional rollback, migration and stable pagination. K13 uses an actual loopback HTTP receiver with generated signing keys and simulated Discord responses. S25 restarts the isolated PostgreSQL cluster, recreates authorization and core services, then checks retained assignment/audit/receipt state, current authority, revocation and explicit reassignment. Execution counts and hashed source evidence are recorded in [verification](verification.md); none of these tests uses real case data or proves live Discord/OS isolation.

Live capability/role mappings, command registration, production composition, Windows identities/ACLs, owner form copy and independent recovery remain gates. Existing provisional [closed-case audience policy](case-lifecycle.md) is unchanged. No production changes were performed.

Rollback: stop command handling and restore compatible code after review. Preserve migration 017, canonical assignments, all staff/lifecycle audits, interaction receipts, case versions, tokens, exclusions and authority epochs. Do not delete ownership history or run earlier code that ignores shared case versions against this schema. No down migration is supplied.
