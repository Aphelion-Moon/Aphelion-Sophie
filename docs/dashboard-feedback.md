# Dashboard and Shuttle feedback follow-up

Scope: P05/P08/P13/P14; T13/T14/T19/T42/T43. Implements the owner's September 20
feedback and explicit Next/Back decision. No new dependency, capability grant,
AI path or production deployment. Migration 046 adds only a bounded OAuth return
path; application changes also support optional versioned screen metadata.

- Background Shuttle, form and permission-editor access checks do not enter the
  saving/busy state. Focus and visibility bursts share a one-minute check cadence.
  Transient failures preserve editable copy; confirmed permission loss clears it.
  Mutations still reauthorize and wait for any pending identity check.
- Session hints use one fresh Discord observation per request. Active visible
  pages renew the local cookie/session for up to one hour ahead, capped at twelve
  hours from login. Expired/revoked sessions cannot renew. Current permissions,
  Gateway continuity, configuration version, CSRF and logout remain enforced.
- Sign-in binds a known dashboard return path to its one-use server-side flow.
  External, arbitrary and duplicate return targets are rejected.
- Navigation is grouped into Community, Casework and Configuration. Native
  disclosures support keyboard use, current-section marking and outside/Escape
  dismissal. Workspace controls stay separate from service navigation.
- Each Shuttle step can have 1–5 explicit screens, at most 1,800 characters each
  and 5,000 characters including separators per step. Add, reorder and confirmed
  removal preserve boundaries in drafts and publications. New runs navigate one
  screen at a time and acknowledge only the final screen. Back from a step's first
  screen returns to the previous step's final screen. All controls retain current
  authority, pause, version, nonce and revocation fences. Screen navigation cannot
  queue Whitelist delivery. Older publications/runs keep their original layout.
- A local DOM renderer previews common Discord formatting: emphasis, underline,
  strike, code, quotes, lists, headings/subtext, safe links and spoilers. It uses
  text nodes, never HTML injection, remote embeds, images or mention resolution.
  Fonts and Discord-client-specific syntax may differ. See Discord's
  [formatting reference](https://support.discord.com/hc/en-us/articles/210298617-Markdown-Text-101-Chat-Formatting-Bold-Italic-Underline).

Evidence is recorded in [feedback verification](evidence/dashboard-feedback-verification.json).
The targeted unit checks, actual PostgreSQL/loopback OAuth and simulated Discord
scenarios, migration preservation and synthetic browser inspection are developer
evidence. They do not replace the owner's private-browser/Discord acceptance.

Retest on isolated staging: switch away and back while editing, inspect Markdown,
add two screens within one step, save/review/publish synthetic copy, and start a
new Discord run. Confirm Next/Back within the step, acknowledgement on its final
screen, and the original behavior of a previously open run. Sign out on Ticket
forms, sign in again, and confirm that page returns. Keep the editor open past
one hour to check renewal. Report behavior without copying private case content.

Rollback must retain schema 046 and any new screen-aware definitions/sessions.
Schema-045/fixed-screen executables cannot read them. Stop the isolated runtime
and use a compatible repair build; never downgrade/delete retained state or
activate the quarantined backup. The earlier schema-045 launcher is only usable
before migration. The current public shell may be withheld without altering
stored publications, but authentication/runtime compatibility remains required.

The later [Onboarding experience update](onboarding-experience.md) keeps a persistent
Discord message, removes routine progress replies, adds shared system wording and
renames development interfaces. The schema-046 evidence above remains historical.
