# Sophie's own memories

Owner decision of 20 October 2026 ("Sophie is supposed to be creating her own memories, it's not supposed to be just
user input"). This supersedes the 11 October rule that nothing is extracted from conversation. Member-written notes
remain as they were. The owner's choices are in the [decision log](decisions/0001-owner-policy.md).

## What she remembers

- **Member memories:** something a member said about themselves (pronouns, fursona, projects, likes). Exactly one subject.
- **Channel memories:** a notable moment, event or running joke, listing every member it mentions (up to four).

## How it works

- **No extra AI call.** While answering (or choosing to stay quiet or react), Sophie may add up to two `memories`
  to her normal JSON output. The schema offers this only when the turn is allowed to remember.
- **Names never reach storage.** The model sees members as turn labels ("Member 2") and must refer to them that way.
  Core maps each label to its member and stores `{1}`, `{2}` placeholders. A memory that names a label outside its
  subject list is rejected. Contact details, links and IDs are masked by the same redaction used for prompts. The
  rules tell Sophie never to save real names, physical locations, contact details, account names or identifiers.
  Since 24 October 2026 core also refuses, whatever the model says: a member memory about anyone but the member she is
  replying to; instructions for how she should behave; rank or authority claims; text naming a "real name" or where
  someone lives; and health (conditions, diagnoses, treatment; owner decision). A refused or malformed item is dropped
  and the reply is still delivered (`AI_OUTPUT_DROPPED_MEMORY`). Free-text names are not detected otherwise.
- **Who can be remembered.** A memory is kept only about members taking part in that conversation who have said Yes
  (one choice for the whole server since 23 October 2026), have no memory opt-out left over from before, and have no
  departure pending. A memory is used only while every member it names still says Yes; saying No hides it, and Yes again
  restores it. Since 24 October 2026 staff channels neither read nor write memories (owner decision), so case talk is
  never kept; memories written there earlier are no longer shown anywhere.
- **What a turn sees.** Up to eight of the requester's own member memories (owner decision, 24 October 2026: never
  another member's, which the model had repeated to others), plus four recent memories of that channel, in a "Sophie
  remembers" message. Members in the conversation keep their labels; anyone else reads as
  "a member". A memory deleted, edited or no longer usable before delivery cancels the reply.
- **Retention.** 90 days after Sophie last used a memory (owner choice). At most 40 member memories per member and 60
  channel memories per channel, least recently used removed first. Expired memories are deleted by the same timer as
  expired preferences.
- **Deletion and restores.** Every memory records each subject's preference epoch. Forgetting, editing or a preference
  save advances that epoch through the independent journal and re-stamps the member's remaining memories, so a restored
  database copy of a forgotten memory stays unusable. Leaving the server deletes every memory naming the member (unless
  they chose to keep their AI data), along with their memory opt-out.

- **Honesty (24 October 2026).** A sentence in her reply that claims a save, note, deletion or compliance that did not
  happen, or claims to remember something about another member, is removed by core before delivery
  (`AI_OUTPUT_CLAIM_REMOVED`); a reply left empty gets the owner wording `ai.reply.claim_removed`. When a memory naming
  the member is actually saved, core DMs them what was saved, with a button to their panel (owner decision: a DM rather
  than a public line). `AI_MEMORY_PROPOSED_<n>` is traced on every turn that may remember.

## Who controls it

- **Members** (`/sophie` in Discord, or the "Sophie and you" page, `ai.self`): see everything that names them, edit their
  member memories on the page, forget any one (a channel memory is deleted for everyone), forget everything, get a copy
  (memories included) or delete all their data. The separate memory switch was retired on 23 October 2026: memory follows
  the member's Yes or No.
- **Owner audit** (AI page, `ai.memory.audit`, granted on the Permissions page): list every memory with its subject IDs
  and delete any of them.

## Turning it on

Memory is off until all of these are done. Nothing here is done automatically. Status on 23 October 2026: the owner
accepted automatic memory; steps 1 and 3 are done in staging; notice revision 4 is drafted in
[ai-notice-r4.md](ai-notice-r4.md) and goes into the production install's processing policy (P50).

1. **Grant the control role** access to the new tables after migration 073:

       GRANT SELECT,INSERT,UPDATE,DELETE ON sophie_ai.memories TO <control role>;
       GRANT SELECT,INSERT,DELETE ON sophie_ai.memory_optouts TO <control role>;

   Preference saves re-stamp memories, so these grants are needed before deploying even while memory stays off; installed
   core refuses to start without them.
2. **Revise the notice** (revision 4) and **re-accept the processing policy** with `"automaticMemory": true` (and
   `"staffChannels": true` for staff channels). Both are part of the consent binding, so every member says Yes again
   under the new notice before Sophie reads their messages. Policies without them keep their current binding.
3. **Grant `ai.memory.audit`** on the Permissions page to whoever should audit memories.
4. Deploy the worker release with the new output schema (the worker package changed).

### Proposed notice text (replaces "What Sophie keeps")

> **What Sophie keeps**
> Sophie keeps short memories of her own from conversations she takes part in: things you tell her about yourself,
> such as your pronouns or projects, and notable moments in a channel that mention you. She writes them only in
> channels where you opted in, refers to members by an internal label rather than by name, and masks contact details,
> links and account identifiers. A memory is kept for 90 days after she last uses it. You can see, edit and delete
> what she remembers about you, or turn this off, on your AI preferences page; the server owner can also review and
> delete memories. The temporary conversation context is deleted after 5 minutes or when it is replaced. Sophie keeps
> your channel choices and the notice revision you accepted, so your opt-outs are enforced. If you leave the server,
> your AI preferences, notes, Sophie's memories that mention you, channel choices and personal AI activity records
> are deleted by default; you can choose to keep them on your preferences page.

The notice's other sections are unchanged. Memories are sent to Mistral as part of later prompts, under the same
processor terms as conversation text.

## Code

`modules/assistant/memories.js` (rules), `modules/assistant/output.js` and `apps/knowledge-worker/prompt-contract.js`
(output and schema), `apps/knowledge-worker/prompt.js` (prompt), `apps/core/discord/ai-turns.js` (turn flow),
`apps/core/storage/ai-memories.js` and migration 073 (storage), `apps/core/storage/ai-controls.js` and
`apps/core/http/ai-controls.js` (API), `apps/dashboard/ai-memories-view.js` (pages). Tests: `tests/ai-automatic-memory.test.js`
(MEM-01 to MEM-08) and `scripts/integration/ai-memories-suite.mjs` (MEM-S01 to MEM-S07).
