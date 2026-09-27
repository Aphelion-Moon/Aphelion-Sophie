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

## Local AI candidate

The schema056 foundation has 37 focused unit/adapter checks and 12 isolated
PostgreSQL scenarios passing. The database fixture stopped cleanly. Synthetic browser
checks covered participation review/publication, disabled-state reporting, and
member opt-in/opt-out; the browser reported no console errors. No production data
or actual model was used. Source-bound results and the continuation are in
`GitHub/.agent_docs/aphelion-sophie`.

AI is not production-ready or live. Actual Discord/worker composition, knowledge,
recovery and enabled-feature acceptance remain in progress. Hyper-V is not installed;
the pinned Windows runtime includes LLVM OpenMP and needs a named licence-scope
decision. No host role, service, permission, deployment or model trial was changed.
The 15-second ceiling is implemented but has not been measured with a local model.
