# Publishing Shuttle guidance from the server

Scope: owner decision of 22 October 2026 ("Host-only Shuttle publishing" in the decision log). Shuttle guidance is
normally published in the dashboard's Shuttle editor by a signed-in guidance publisher. This command does the same from
the server itself, for an administrator, without a Discord sign-in.

## What it is

`apps/core/shuttle-publishing.mjs`, with its logic in `apps/core/operator/local-shuttle-publisher.js`.

- **Authority: server administrator access.**
  - It runs only in an elevated Windows session: High or System mandatory level, checked with `whoami /groups`.
  - It needs core's database login and runtime settings, `C:\Aphelion\Sophie\staging\core.json` and `runtime.json`.
    Only SYSTEM, Administrators and the owner's account can read these; not even the core service can.
  - The database login must be core's own least-privilege identity (`checkRuntimeDatabase`).
- **Author: the guild owner.** `--author` must be a user whom Sophie last recorded as the guild owner (present, not a
  bot, on the current capability policy).
  - That record is read from `sophie_core.actor_authority`, with no Discord call.
  - It is re-read for every operation: if it changes, or stops saying owner, the operation is refused.
  - The owner is the recorded author of the draft and the publication.
- **Same rules as the dashboard.** Saving, review and publishing use the dashboard's own store
  (`createOnboardingAuthoringStore`):
  - the same draft validation, revision and hash checks;
  - the same publication checks;
  - existing runs keep their version.
- **Audit.** Each action writes the usual `sophie_core.shuttle_editor_actions` row. Its `result` is marked
  `origin: "local-operator"`; dashboard rows are unmarked.
- **What it never does.** It never loads the Discord token, starts a listener, or becomes reachable through the tunnel.

## Use

Run it with the installed runtime in an elevated PowerShell. Every run prints one JSON line, or `{"fault":"CODE"}`.

```bash
C:\Aphelion\Sophie\package\runtime\node.exe C:\Aphelion\Sophie\package\source\apps\core\shuttle-publishing.mjs status --config C:\Aphelion\Sophie\staging\runtime.json --database C:\Aphelion\Sophie\staging\core.json --confirm-guild <guild id> --author <owner id>
```

| Mode | Extra options | What it does |
|---|---|---|
| `status` | none | Prints the latest draft revision and hash, the latest version and its status. Never prints guidance. |
| `save` | `--document <draft.json>` | Saves the document as the next draft revision, then prints the editor's review: valid or not, the version it would become, each stage's message count, and the runs on the current version. Publishes nothing. |
| `publish` | `--revision <n> --sha256 <hash> --expect-version <n> --expect-status <none\|published\|withdrawn>` | Publishes exactly that reviewed revision, if it is still the latest draft with that hash and the latest version is still the one expected. |

The document is the editor's draft format: `{ "helpPauses": false, "stages": [{ "id", "title", "body" }] }`. For the
story, `node scripts/build-onboarding-story.mjs` writes it to `content/onboarding/story-draft.json`.

Each publication is still a recorded owner approval. Withdrawing a version stays in the dashboard.

## Installed and used

- Installed as `sophie-mistral-cf0c125` on 22 October 2026 (16:57 UTC).
- First used the same day to publish the story copy: draft revision 3 became Shuttle version 3 at 17:00 UTC, with the
  owner as author. See verification.md.

## Tests

- `tests/local-shuttle-publisher.test.js`, T-LOCAL-PUB-01..04:
  - the shared store, marked local operator, with the owner as author;
  - only the recorded owner on the current policy;
  - authorisation for this actor, capability and definition only, while the record is unchanged;
  - an elevated session required.
- Storage scenario E25 (`scripts/integration/onboarding-authoring-suite.mjs`): a real save and publish as the owner,
  with marked audit rows and no Discord call; a lead editor and an unknown user are refused; a stale publish is
  refused.
