# Verification and release limits

The current source passed these checks on 27 September 2026:

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
