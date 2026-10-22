# 14: A user's edit makes an agent note the user's

**What to build:** once the user edits a note the agent created (or last edited), the note is the user's: `edit_note`, `trash` and `undo` (of its creation or any of its edits) refuse it with a clear error ("you edited this note in Zotero; it is now yours"), and `list_notes` reports `byLLM: false`. Detection: compare the note's current content with what the agent last wrote, using the same note-editor-reformatting-tolerant comparison ticket 05 uses for undo (Markdown-normalised). The lapse is permanent (record it in the registry so a later revert by the user doesn't hand it back). Embedded images and child items of such a note are covered too. Tags the agent added to that note stay agent-owned pairs (they're separate objects) — decide and document.

User decision 2026-10-22 (overrides the earlier rejection of SPEC suggestion #5).

**Blocked by:** 05, 13

**Status:** ready-for-agent

- [ ] Unit tests for the ownership check with a user-edited note
- [ ] Integration test: agent creates note → user edits via Zotero (`setNote`/`saveTx` through the eval plugin) → edit_note, trash, undo all refused; byLLM false
- [ ] SPEC (Hard rule 1), README, manual checklist updated
