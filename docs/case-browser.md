# Case record reader and confirmed exports

The `/cases` workspace lets a signed-in member or responder open one retained
ledger using its Discord channel ID. Copy the ID from the case channel or thread
with Discord Developer Mode enabled. A channel ID only selects a record: the
server resolves it within the session's guild and performs the existing case,
membership, participant, Head Admin and selected-child checks before returning
the case token or any content. Unknown and unauthorized ledgers fail closed.

The browser displays five observations and 25 gaps per page, with independent
forward paging. Reopen the channel to return to the beginning. Observations remain
separate events; an edit or deletion does not erase an earlier event. Attachment
status is visible, but file bytes, Staff notes and submitted forms are excluded.
History is always labelled partial. The API retains its existing escaped HTML
field and adds equivalent inert structured page data; the browser inserts only
text nodes and never uses the HTML field.

**Review export from this position** describes one part of the selected channel,
starting at the current observation and gap positions, with counts, bytes,
policy version, content hash and exclusions. A separate unchecked confirmation
enables **Confirm and download**. The server rebuilds the exact reviewed artifact,
reauthorizes before and after its audit commit, and rejects changed reviews.
The configured count/byte limits apply to each part. After a successful browser
handoff, **Review next export part** advances both streams using the server's
continuation. It keeps the last position of any exhausted stream, requires a new
unchecked confirmation, and uses a distinct filename. Reopen the channel to start
over. Each part is a live view; later observations or gap changes may require a
new export from the beginning. All current readers, including members, use the
same approved policy. See [the export contract](case-exports.md).

The browser uses same-origin requests and session-bound CSRF for both export POSTs.
It checks the fixed attachment filename including the review hash, type and byte length before initiating a
download, then releases its temporary object URL. Confirmation says only that the
file was handed to the browser, never that it was saved. A lost response retains
the exact request for an explicit retry while the page remains active. Stale or
denied requests require reopening/reviewing; a new review is a new generation
attempt. Downloaded copies cannot be recalled by later permission changes.
The account identity is checked again after fetching a part and before handing
it to the browser; an account switch during the fetch suppresses the handoff.

Account changes, failed access checks, logout and hiding/leaving the page clear
rendered records and reviews. Late responses cannot repopulate a hidden page or
deliver its file. Focus and periodic checks reread the current page under current
authorization. No case content, case selection, export request or credential is
written to browser storage. Quiet mode remains an appearance-only preference.

## Evidence and limits

The 4 October 2026 paged-export change passed 16 focused unit checks, 22 isolated
transcript/export scenarios and the composed member-export and AI exclusion
scenarios. Synthetic browser verification covered confirmation reset, exact retry
after an uncertain response, continuation after access refresh, a gap-only final
part and the final browser handoff. Completed cursor positions survive ordinary
access refresh and suspension; retained content, reviews and pending downloads
are cleared on suspension. Each resumed operation rechecks current authority.
Evidence: `GitHub/.agent_docs/aphelion-sophie/paged-exports-2026-10-04/verification.json`.
The export candidate is local; installed staging remains `335a3f2`/schema069.

Historical reader evidence:
On 20 September 2026, 35 focused controller/transport/asset/editor tests passed;
TR01–TR12 and EX01–EX08 passed against isolated PostgreSQL and loopback HTTP. TR12
adds channel selection, unknown/invalid IDs, private child access, Head Admin
denial and logout races. The temporary database stopped successfully. The existing
source-bound export report now covers this build; historical full-suite reports
remain historical.

In-app Chromium exercised a separate synthetic-only preview: keyboard channel
submission, independent observation/gap pages, escaped-looking payload as literal
text with zero active elements, review focus, unchecked confirmation, keyboard
checkbox confirmation, download handoff, cancellation and case-denial clearing.
At a 390-pixel viewport override, measured content width equalled the 375-pixel
available document width; controls and copy remained usable. The override and
temporary tab were cleared. These are synthetic UI checks, not live Discord case
acceptance, saved-file receipt, full accessibility certification or G2 approval.

The isolated foreground host was restarted after its retained Gateway lease
expired. Current Gateway health, the public `/cases` page (200/no-store) and
anonymous channel-lookup denial (403) were verified. Origin HTML matches the
source bytes. The edge adds an inline challenge script to the public HTML; the
original strict CSP remains present and does not permit inline scripts. Public
HTML is therefore not claimed byte-identical to the source. Owner execution of
the actual signed-command and authenticated export flow remains pending.

No dependency, migration, role grant or licence change. Rollback by reverting the
reader assets/routes and compatible additive page payload. Keep all observations,
export audits and files. Production still requires the documented release gates;
file-download/scanning policy, multi-channel/frozen archives, artifact operations,
other Staff dashboard controls and independent recovery remain open.
