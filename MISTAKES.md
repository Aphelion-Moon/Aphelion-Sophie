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
