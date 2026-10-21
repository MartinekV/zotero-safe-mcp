# 05: edit_note with version history and undo

**What to build:** `edit_note` for owned notes only; the previous HTML is saved to `note_versions` under the new `changeId`; `undo` of an edit restores the previous version. The `[LLM]` tag is kept on edit.

**Blocked by:** 04

**Status:** ready-for-agent

- [ ] Editing a user's note is refused
- [ ] Unit tests for version save/restore logic; undo of edit then undo of create works in order
