# Aphelion-Sophie

Sophie is Aphelion's Community Services bot for native Windows Server 2022.
Tickets and Whitelist onboarding are deterministic, human-operated services:
**no AI receives ticket or onboarding-session content**.

The isolated staging host provides signed Discord commands, retained case history,
a protected website, and role/permission configuration with review and apply.
Whitelist channels close one hour after completion or three days after inactivity;
case records do not expire automatically.

See the [setup guide](docs/discord-staging-setup.md),
[configuration template](config/staging.example.json), [workplan](docs/workplan.md),
and [verification](docs/verification.md). Use Node.js 24.19.0 and the pinned dependencies:

    npm ci --ignore-scripts --omit=optional
    npm test
    npm run check

Runtime data and credentials belong outside this repository. No Windows service is
installed. Production deployment remains subject to the release gates; production
recovery is deferred. Original source code is MIT; asset and dependency rights are
recorded separately.
