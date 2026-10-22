# 14: A user's edit makes an agent note the user's

**What to build:** once the user edits a note the agent created (or last edited), the note is the user's: `edit_note`, `trash` and `undo` (of its creation or any of its edits) refuse it with a clear error ("you edited this note in Zotero; it is now yours"), and `list_notes` reports `byLLM: false`. Detection: compare the note's current content with what the agent last wrote, using the same note-editor-reformatting-tolerant comparison ticket 05 uses for undo (Markdown-normalised). The lapse is permanent (record it in the registry so a later revert by the user doesn't hand it back). Embedded images and child items of such a note are covered too. Tags the agent added to that note stay agent-owned pairs (they're separate objects) — decide and document.

User decision 2026-10-22 (overrides the earlier rejection of SPEC suggestion #5).

**Blocked by:** 05, 13

**Status:** resolved

- [x] Unit tests for the ownership check with a user-edited note
- [x] Integration test: agent creates note → user edits via Zotero (`setNote`/`saveTx` through the eval plugin) → edit_note, trash, undo all refused; byLLM false
- [x] SPEC (Hard rule 1), README, manual checklist updated

## Comments

- **Built:** detection in `src/ownership/userEdits.ts` (`userTakenKeys`, pure apart from a `NoteReader`
  port and the registry), wired for tools in `src/ownership/agentOwned.ts` (`requireAgentOwned`,
  `agentOwnedKeys`, `requireUndoable`). New registry table `agent_notes` (schema version 2, created by
  `ensureSchema` on upgrade): the HTML the agent last wrote into each note and `userEditedAt`. Writers record
  it with `w.noteWritten` (create_note, edit_note, notes captured by import_paper) and `ctx.noteWritten`
  (undo of edit_note, so the restored version is the new baseline).
- **Seams tested** (chosen without the user): `userTakenKeys`/`requireNotUserTaken` against real SQLite +
  fake notes (`test/unit/user-edit-ownership.test.ts`, plus two cases in `note-versions.test.ts`), and the MCP
  tools end to end (`test/integration/user-edit-ownership.itest.ts`).
- **Detection happens when a tool looks** (edit_note, trash, undo, list_notes), not via a Notifier observer:
  an edit the user reverts before the agent touches or lists the note again goes unnoticed (it is then
  indistinguishable from no edit). Once noticed it is permanent. undo checks before its transaction
  (`changeLog().undoTarget`), so the recorded take-over survives the refusal.
- **Undo scope:** refused if the change created, edited or trashed a taken-over note or one of its embedded
  images (`keysUndoWouldChange`: `objects`, `noteVersions`, `data.trashed`). So undo of an import whose
  translator note the user edited is refused as a whole, and so is undo of a `trash` of such a note.
- **Tags (decided):** tag pairs the agent added to a taken-over note stay the agent's: `remove_tags` and undo
  of `add_tags`/`remove_tags` still work on them (separate objects; also lets the agent clean up its tags).
- **Legacy notes:** a note written before this change has no `agent_notes` row and is never considered taken
  over (no baseline to compare against).
- `edit_note.itest.ts` used to add images by editing the note's HTML through Zotero; that is now a user edit,
  so its tests add images via POST /safe-mcp/image instead. The old "changed in Zotero after" undo refusal
  remains in `editNoteUndoHandler` as a backstop, but tools now refuse earlier with the take-over message.
- **Review fix (2026-10-22):** comparison is now canonical HTML (`src/notes/canonicalNoteHtml.ts`), not
  Markdown: verified headless that the note editor doesn't save an agent note on open/close, so formatting-only
  edits count. Undo of edit_note keeps the HTML it replaces as a note version. A Notifier observer
  (`src/hooks/ownership-watch.ts`) records take-overs at save time and forgets tag pairs the user removes; the
  lazy check stays for edits made while the plugin was disabled.
