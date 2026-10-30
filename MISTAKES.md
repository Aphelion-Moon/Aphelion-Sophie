# MISTAKES.md — Sophie

Log of agent mistakes: what happened, the root cause, and prevention.

## 2026-10-11 — Batch edit script stopped half-way

- **What happened:** A one-shot script that ported several test files to the Mistral provider aborted on an
  occurrence-count mismatch in `tests/installation.test.js`, after it had already rewritten earlier files.
  The remaining files were finished with a second pass; no wrong content was written.
- **Root cause:** The script wrote each file as it went, and the expected count came from a truncated
  search listing instead of an exact count.
- **Prevention:** Count occurrences with an exact search before scripting replacements, and validate every
  file's replacements before writing any of them.

## 2026-10-11 — Line-separator characters written into a regular expression

- **What happened:** A new source file was written with a regular expression meant to contain the escapes
  for U+2028 and U+2029. The file received the literal characters instead, which end a line inside a
  regular expression literal, so the module failed to parse. A syntax check caught it before any test ran.
- **Root cause:** The escape sequences were decoded on the way to the shell, before the file was written.
- **Prevention:** Use Unicode property classes (`\p{Zl}`, `\p{Zp}`) or build such characters in code, and
  syntax-check every new file immediately after writing it.

## 2026-10-11 — Provider port left a stale expectation in an unrun suite

- **What happened:** The Mistral port changed the default prices but one PostgreSQL integration check still
  expected a cost computed at the former provider's prices. It surfaced only when that suite was run for
  the member-notes work.
- **Root cause:** The port ran the unit tests and reported the integration suites as not run, without
  searching them for values derived from the changed defaults.
- **Prevention:** When a default changes, search every test and integration suite for values derived from
  it, and run the affected isolated-database suite before reporting the change as verified.

## 2026-10-11 — Sign-in failure attributed to a missing cookie

- **What happened:** The owner could not sign in to the dashboard. A reproduction showed that a callback
  without the sign-in cookie returns the owner's exact error, and that was reported as the located cause,
  with browser-side suggestions. The real cause was server-side: Discord adds an `iss` parameter to its
  redirect and the callback handler refused any parameter beyond `code` and `state`.
- **Root cause:** One matching reproduction was treated as the cause although several different checks
  return the same message, and the test callback was hand-built with only two parameters instead of the
  shape Discord really sends.
- **Prevention:** When one error message covers several checks, list every check that can produce it and
  eliminate each before naming a cause. Ask for the real failing request early, and build reproductions
  from it.

## 2026-10-11 — Error classification used a variable from another function's scope

- **What happened:** While scoping the Shuttle and case delivery recovery conflict codes to their own routes in
  `apps/core/http/dashboard-auth.js`, the new check read `path`, which exists only inside the request handler,
  from the server's error callback. Every failing dashboard request then threw inside its error handler and never
  answered, so unit tests hung instead of failing. The change was not committed or deployed.
- **Root cause:** A syntax check cannot detect an out-of-scope identifier, and the edit was made from a partial view
  of a long function without confirming where the variable was declared.
- **Prevention:** Before using a name inside a callback, find its declaration and confirm the enclosing scope. Run the
  focused HTTP tests for the edited server, with a timeout, before starting the long suites.

## 2026-10-30 — A new module imported another module

- **What happened:** The first version of `modules/member-records/index.js` imported `formatDuration` from
  `modules/onboarding/timing.js`. The focused tests passed, but `npm run check` failed with "forbidden module
  dependency". Nothing was committed or installed with the import.
- **Root cause:** The module boundary rule lives in `scripts/lib/repository-checks.mjs`, and AGENTS.md describes it only
  in general terms ("explicit module ownership"). The new module was written without checking the rule, and the check
  ran only after the focused tests.
- **Prevention:** A module under `modules/` imports only `contracts/` and its own files. Run `npm run check` together
  with the focused tests for any new module, not after them.

## 2026-10-30 — "Not finished" nearly shown for finished Shuttle runs

- **What happened:** The Staff test run first read a member's latest Activity run as finished only when
  `shuttle_activity_runs.completed_at_ms` was set. The `--plan` pass showed 11 unfinished runs and none finished, which
  was implausible for Staff testers, so it was caught before any post was made.
- **Root cause:** `completed_at_ms` arrived with migration 079 on 25 October. Runs that finished earlier have no
  completion time, and the session's own `state.status = 'complete'` is the authority.
- **Prevention:** For a column added by a later migration, treat NULL as "not recorded", not "did not happen", and read
  the state the older rows carry. Check a dry run's totals for plausibility before sending anything.
