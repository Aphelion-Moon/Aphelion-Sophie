# Sophie development handoff

Sophie provides deterministic community administration, Whitelist onboarding,
private cases, and website configuration. No AI may receive ticket or onboarding
session content. Current policy is in [the owner decisions](decisions/0001-owner-policy.md).

Use [the workplan](workplan.md) for remaining implementation and release gates.
The website supports role mapping, feature permissions, channel routing, and a
review/apply workflow. Lead ops is the initial configuration publisher. Whitelist
channels close one hour after completion or three days after inactivity; retained
records have no automatic expiry.

Staging uses a dedicated PostgreSQL database, separate owner/core credentials,
and a configurable host. Runtime files and credentials are stored privately outside
the repository. Verify current host status before operating it; do not bootstrap
or replace an existing database. Keep authored configuration and case history.

The standard launcher supports a protected credential file and a separate owner
pool. Native Windows service installation and SCM qualification remain unfinished.
Production recovery is deferred by the owner. This is not production approval.

See [verification](verification.md) for checks actually run against this source.
