# Quick Help staging verification repair

20 September 2026; P06/P17/P19, partial T04–T07/T16/T22/T36/T59.

The owner reported a recorded request followed by an unavailable destination.
Metadata-only inspection found two Quick Help cases open, with confirmed channel
provisioning, matching parent/marker and exact intended permission overwrites.
Quick Help intentionally has no input form. This does not prove a separate
ordinary member can see the channel; the guild owner bypasses channel ACLs.

Both welcome notices had retained message IDs, but delivery was parked with
`CASE_INTAKE_MESSAGE_CHANGED`. Programmatic comparison of Sophie's own static
notices found matching content, title, description, footer and mentions. Discord
had added a non-visible `content_scan_version` embed field. The shared own-message
verifier now accepts that field only as a nonnegative safe integer. Unknown
fields, changed visible content, malformed scan metadata, wrong ownership and
unexpected mentions still fail verification. No message body was printed or
provided to an AI model.

The separate destination failure has not yet been reproduced. Its adapter now
emits only a fixed stage and allowlisted error code through the runtime fault
sink. It never emits case/user identifiers, message text, tokens or raw errors.
Logging failure cannot change the private response. Membership, continuity,
authorization and exact channel-proof checks remain unchanged.

Validation: 21 focused contract/adapter tests; 67 isolated PostgreSQL intake,
delivery and recovery scenarios (B01–B21, X01–X23, Y01–Y23); and all 10 composed
staging scenarios pass. X02 now includes Discord scan metadata. RT04 now clicks
the signed destination control and verifies both a ready channel link and a
denial with a safe diagnostic after ACL drift. Both temporary clusters stopped.
See the source-bound [intake](evidence/intake-verification.json) and
[staging](evidence/staging-verification.json) reports. Full suites were not run.

The owner subsequently clicked **Check ticket** and confirmed the ready
destination works. A further `/ticket open` attempt correctly hit the two-open-case
limit. No underlying destination fault was reproduced and no authorization check
was relaxed. The owner then requested [persistent ticket DMs](ticket-direct-notices.md).
An authorized responder can use `/ticket issues` and **Recheck** for the
two parked notices. Their existing message IDs must be inspected and confirmed,
without posting duplicate notices or resetting database state by hand.

No dependency, licence, migration, permission-policy or production deployment
change. Rollback: stop staging using its documented stop file, revert this code
change, wait for lease expiry and restart; retain cases, messages and audit state.
Production release and recovery gates remain open.
